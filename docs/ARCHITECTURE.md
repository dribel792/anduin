# Anduin Architecture

## Overview

Anduin is instant on-chain settlement infrastructure for crypto exchanges and brokers. Users deposit collateral once into a self-governed smart contract, their equity appears on all connected venues, and realized PnL settles in seconds. Anduin sits in front of venue risk management—providing cross-venue portfolio margin, reinsurance for liquidation shortfalls, and capital-efficient netting.

**Core Principle:** Venues keep their existing margin engines and liquidation systems. Anduin manages cross-venue equity propagation, prevents overspend, and covers shortfalls through a transparent insurance waterfall.

---

## How It Works (V3 Architecture)

### The Flow

```
┌──────────┐         ┌──────────────────────┐
│   User   │ deposits│      HubVault        │
│  Wallet  │────────▶│  (self-governed SC)  │
│          │  $50K   │                      │
└──────────┘         │  collateral: $50K    │
                     │  insurance: $100K    │
                     └──────────┬───────────┘
                                │
                      Anduin propagates $50K
                      to both venues via API
                                │
                     ┌──────────┴──────────┐
                     ▼                     ▼
              ┌─────────────┐      ┌─────────────┐
              │   Kraken    │      │    Bybit     │
              │             │      │              │
              │ Balance:$50K│      │ Balance:$50K │
              │ Own margin  │      │  Own margin  │
              │ Own liq     │      │  Own liq     │
              │ Own risk    │      │  Own risk    │
              └──────┬──────┘      └──────┬───────┘
                     │                     │
                     │   position data     │
                     └────────┬────────────┘
                              ▼
                     ┌────────────────┐
                     │  Anduin Keeper │
                     │                │
                     │ • Post-trade   │
                     │   checks       │
                     │ • Equity       │
                     │   updates      │
                     │ • Overspend    │
                     │   detection    │
                     │ • Insurance    │
                     │   claims       │
                     └────────────────┘
```

### Step-by-Step

#### 1. Deposit
User deposits $50K USDC into HubVault (on-chain).  
Anduin keeper detects deposit event.  
Keeper calls venue APIs:
- `Kraken API: creditBalance(userId, $50K)`
- `Bybit API: creditBalance(userId, $50K)`

User now sees $50K on Kraken AND $50K on Bybit.

#### 2. Pre-Trade (Venue Handles)
User submits order on Kraken: Long 1 BTC ($10K margin).  
Kraken's own risk engine checks: user has $50K, needs $10K → APPROVED.  
Trade executes. Kraken reports position to Anduin.

#### 3. Post-Trade Check (Anduin)
Anduin receives trade notification from Kraken.  
Anduin checks cross-venue margin:
- Kraken margin used: $10K
- Bybit margin used: $0
- Total margin: $10K
- Total collateral: $50K
- → Portfolio healthy. No action.

If user had opened $40K on Kraken AND $40K on Bybit:
- Total margin: $80K > $50K collateral
- → OVERSPEND DETECTED
- → Anduin reduces balance on one/both venues
- → Venue's own risk engine sees reduced balance → forces position reduction

#### 4. Equity Updates (Event-Driven)

**Triggers (not time-based):**
- Price change > X% on any position's underlying
- Position opened or closed on any venue
- Every N minutes as heartbeat fallback (e.g., 5 min)
- Deposit/withdrawal
- Manual trigger by user or admin

**Example:**  
Event: BTC price moves 2% (trigger threshold reached)

Anduin reads all positions across all venues:
- Kraken: Long BTC, unrealized PnL = +$15K
- Bybit: Short BTC, unrealized PnL = -$12K

Anduin calculates per-venue equity update:

**Bybit new equity:**
```
= collateral ($50K)
  + own unrealized PnL (-$12K)
  + 50% haircut on Kraken positive PnL (+$7.5K)
= $45.5K
```
→ Anduin updates Bybit: `setBalance(userId, $45.5K)`  
→ Bybit sees $45.5K equity, user is safe  
→ WITHOUT Anduin: Bybit would see $50K - $12K = $38K (closer to liquidation)

**Kraken new equity:**
```
= collateral ($50K)
  + own unrealized PnL (+$15K)
  + 50% haircut on Bybit negative PnL (-$6K)
= $59K
```
→ Anduin updates Kraken: `setBalance(userId, $59K)`

**Why 50% haircut on positive PnL:**
- Price could reverse before next update
- Latency between venues (prices not perfectly synced)
- Execution risk on liquidation (can't close instantly)
- Conservative = insurance pool stays solvent

Haircut is configurable: start at 50%, can adjust per asset, per venue, per volatility regime.

#### 5. Overspend Protection

Scenario: User opens too many positions across venues.

Anduin detects: total margin > allowed % of collateral  
Actions (in order):
1. Stop accepting new positions: tell venues to freeze new orders
2. If margin exceeds hard limit: reduce balance on venues  
   → Venue's own liquidation kicks in
3. Anduin does NOT liquidate directly  
   → The venue's engine handles it with its existing logic

#### 6. Insurance / Reinsurance

Scenario: Bybit liquidates user. Position closed at loss.  
User's balance on Bybit wasn't enough to cover.  
Bybit has a shortfall of $5K.

**Anduin covers:**
1. HubVault: deduct from user's remaining collateral (cross-venue)
2. If user collateral insufficient: insurance pool covers it
3. Anduin transfers $5K to Bybit via API or ClearingVault
4. Bybit is made whole. No loss for the venue.

This is the **reinsurance pitch:**  
*"Connect to Anduin → your liquidation shortfalls are covered"*

#### 7. Settlement (End of Day / Netting Window)

Accumulated PnL across venues gets netted:
- Kraken owes Bybit: $100K (aggregate from all users)
- Bybit owes Kraken: $85K
- Net: Kraken → Bybit: $15K

ClearingVault executes the net transfer.  
HubVaults updated accordingly.

---

## Smart Contracts

### HubVault.sol (Global, Per-User Accounting)

**One contract for all users** (gas efficient, simpler management).

**State:**
```solidity
mapping(address => uint256) public collateral;        // user deposits
mapping(address => mapping(address => uint256)) public venueAllocations;  
// venueAllocations[user][venue] = current equity shown to venue

mapping(address => bool) public registeredVenues;     // approved venues
uint256 public insurancePool;                         // reinsurance fund
uint256 public totalDeposits;                         // sum of all user collateral

// Deduplication
mapping(bytes32 => bool) public processedEvents;
```

**User Functions:**
```solidity
depositCollateral(uint256 amount)
  → User deposits USDC. Always allowed.
  → Emits event that keeper picks up to propagate to venues.

withdrawAvailable(uint256 amount)
  → User withdraws. Available = collateral - totalMarginInUse.
  → Keeper propagates reduced balance to venues.
  → NO admin can block this.
```

**Keeper Functions (onlyKeeper):**
```solidity
updateVenueAllocation(address user, address venue, uint256 newEquity, bytes32 eventId)
  → Updates what a venue should show as user's equity.
  → Called after equity recalculation with haircuts.
  → Deduped by eventId.

processShortfall(address user, address venue, uint256 amount, bytes32 refId)
  → Covers liquidation shortfall from venue.
  → Waterfall: user collateral → insurance pool → socialized.
  → Transfers USDC to venue's settlement address.

lockCrossVenueMargin(address user, uint256 totalMargin)
  → Records total margin in use across all venues.
  → Prevents user from withdrawing more than available.
```

**Insurance Functions:**
```solidity
depositInsurance(uint256 amount) → anyone can deposit
```

**Governance (timelocked):**
```solidity
registerVenue(address venue)
removeVenue(address venue)
setHaircutBps(uint256 bps)  // e.g., 5000 = 50%
setKeeperAddress(address keeper)
```

### ClearingVault.sol (Cross-Venue Netting)

Tracks net obligations between venues:
- Records cross-venue settlements
- Executes netting on schedule or trigger
- Funded by venue guarantee deposits + default fund

No more per-venue MarginVault. HubVault is the single source of truth.  
Venues interact via API, not smart contracts.

---

## Equity Engine

The keeper service calculates equity updates in real-time:

```
┌──────────────────────────────────────┐
│            Anduin Keeper             │
│                                      │
│  ┌──────────┐  ┌──────────────────┐  │
│  │ Price    │  │ Position         │  │
│  │ Monitor  │  │ Monitor          │  │
│  │          │  │                  │  │
│  │ Watches  │  │ Reads positions  │  │
│  │ oracles  │  │ from all venues  │  │
│  │ + venue  │  │ via WebSocket    │  │
│  │ feeds    │  │ + REST           │  │
│  └────┬─────┘  └────────┬─────────┘  │
│       │                 │            │
│       ▼                 ▼            │
│  ┌──────────────────────────────┐    │
│  │      Equity Engine           │    │
│  │                              │    │
│  │  For each user:              │    │
│  │  1. Aggregate positions      │    │
│  │  2. Mark-to-market (oracle)  │    │
│  │  3. Calculate per-venue eq.  │    │
│  │  4. Apply 50% haircut on     │    │
│  │     cross-venue +PnL         │    │
│  │  5. Check overspend          │    │
│  │  6. Determine action         │    │
│  └────────────┬─────────────────┘    │
│               │                      │
│       ┌───────┴───────┐             │
│       ▼               ▼             │
│  ┌─────────┐   ┌────────────┐       │
│  │ Venue   │   │ On-Chain   │       │
│  │ API     │   │ Settler    │       │
│  │ Client  │   │            │       │
│  │         │   │ Updates    │       │
│  │ Updates │   │ HubVault   │       │
│  │ equity  │   │ state      │       │
│  │ on      │   │            │       │
│  │ venues  │   │ Processes  │       │
│  │         │   │ shortfalls │       │
│  └─────────┘   └────────────┘       │
└──────────────────────────────────────┘
```

**Equity Update Triggers:**

| Trigger | Condition | Latency |
|---------|-----------|---------|
| Price move | Underlying moves > X% since last update | Real-time |
| Trade event | User opens/closes position on any venue | Immediate post-trade |
| Heartbeat | Fallback timer (every 5 min) | 5 min max |
| Deposit/withdraw | User adds or removes collateral | Immediate |
| Manual | Admin or user requests recalculation | On demand |
| Volatility spike | VIX equivalent or funding rate spike | Real-time |

Price move thresholds configurable per asset:
- BTC: 1% move triggers update (volatile)
- Gold: 0.5% (less volatile, tighter)
- Stablecoins: 0.1% (should almost never trigger)

---

## Insurance Waterfall

When a venue liquidates a user and there's a shortfall:

**Waterfall (in order):**
1. **User collateral** — Seize available collateral first
2. **Insurance pool** — Cover shortfall from insurance reserves
3. **Socialized losses** — Track remaining loss (requires admin intervention)

**Example:**
```
User collateral:     $1,000
Trading loss:        $5,000
Insurance fund:      $50,000

Result:
├─ Seized:           $1,000 (from user)
├─ Insurance used:   $4,000 (from fund)
└─ Broker pool:      +$5,000 (fully covered)
```

**Insurance Pool Funding:**
- Insurance premiums (0.5-2% annually on user deposits)
- Settlement fees
- Direct deposits
- Netting fees

**Monitoring:**
- Track `insuranceFund` balance (recommend 5-10% of total collateral)
- Alert on `totalSocializedLosses > 0`
- Watch `Shortfall` events for underwater accounts

---

## Netting

Cross-venue netting via **ClearingVault** reduces capital requirements by 60-80%.

**How it works:**
```
Accumulated PnL across venues:
  Kraken owes Bybit: $100K (aggregate from all users)
  Bybit owes Kraken: $85K
  
  Net: Kraken → Bybit: $15K
  
  ClearingVault executes the net transfer.
  Gross settlement: $185K → Net settlement: $15K
  Capital savings: 92%
```

**Netting Windows:**
- Configurable (hourly, daily, or on-demand)
- Executed on-chain with deduplication
- Venue guarantee deposits protect against default

---

## Security

### Self-Governance
- **HubVault:** Users always withdraw available balance (no admin override)
- **Insurance pool:** Transparent on-chain balance
- **Settlement:** Every action has refId dedup + event logs

### Keeper Trust
- Keeper is the only off-chain component with on-chain write access
- **Keeper can:** Update allocations, process shortfalls, lock margin
- **Keeper CANNOT:** Withdraw user funds, reduce collateral, access insurance pool directly
- Keeper actions are bounded: allocation updates must net to ≤ collateral + haircut PnL

### Venue Trust
- Venues cannot access HubVault directly
- Venues report positions; Anduin verifies against oracle prices
- If venue reports false positions, Anduin's oracle cross-check catches it

### Risk Parameters
- **Haircut:** 50% default (configurable per asset/venue)
- **Max allocation per venue:** Configurable (e.g., no more than 80% of collateral to one venue)
- **Overspend threshold:** Total margin > X% of collateral triggers action
- **Insurance pool minimum:** Must cover Y% of total deposits

---

## V2 On-Chain Alternative (MarginVault + ClearingVault)

For venues that want **pure smart contract settlement** without the meta-risk layer, V2 offers on-chain-only settlement.

### Architecture

```
┌─────────────────────────────┐
│      ClearingVault           │
│   (Cross-broker netting)     │
│                              │
│  obligations[BrokerA→B]: $X  │
│  obligations[BrokerB→A]: $Y  │
│  defaultFund: $Z             │
└──────┬──────────┬────────────┘
       │          │
settle net   settle net
       │          │
┌──────┴───┐  ┌───┴──────┐
│MarginVault│  │MarginVault│
│ (Kraken)  │  │  (Bybit)  │
│           │  │           │
│ SELF-GOV  │  │ SELF-GOV  │
│           │  │           │
│ balances: │  │ balances: │
│  UserA:$50K│  │  UserD:$30K│
│  UserB:$30K│  │  UserE:$45K│
│           │  │           │
│brokerStake│  │brokerStake│
│  $500K    │  │  $300K    │
└───────────┘  └───────────┘
```

### Key Differences from V3

| Feature | V2 (On-Chain) | V3 (Hub + API) |
|---------|---------------|----------------|
| Venue interaction | Smart contract | API-based |
| Per-venue vault | Yes (MarginVault) | No (HubVault only) |
| Cross-venue equity | Via ClearingVault | Real-time via keeper |
| Integration effort | High (SC integration) | Low (REST API) |
| Flexibility | Lower (SC upgrade needed) | Higher (keeper config) |
| Gas costs | Higher | Lower |
| Decentralization | Higher | Lower |

**When to use V2:**
- Venue wants full on-chain transparency
- Regulatory requirement for smart contract settlement
- No trust in off-chain keeper model

**When to use V3:**
- Fast integration required (weeks not months)
- Real-time equity updates needed
- Multiple venues to integrate quickly
- Lower gas costs desired

---

## Migration Path

### From V1 (UnifiedAccountVault) to V3

V1 is the **single-venue MVP:**
- One vault per broker
- Simple PnL settlement (credit/seize)
- No cross-venue features
- Entry-level product for venues testing the waters

**Migration:**
1. User data exports from UnifiedAccountVault
2. Deploy HubVault
3. Migrate user balances via keeper
4. Connect venue APIs
5. Activate cross-venue equity engine

### From V2 to V3

**Coexistence:**
- V2 contracts (MarginVault, ClearingVault) remain deployable
- Venues can choose on-chain (V2) or API-based (V3)
- V3 is the premium product for scale

**Migration:**
1. Deploy HubVault alongside existing MarginVaults
2. Connect keeper to venue APIs
3. Migrate users gradually (opt-in)
4. Retire MarginVaults once fully migrated

---

## Product Offerings

| Product | Description | Target |
|---------|-------------|--------|
| **V1 - UnifiedAccountVault** | Single-venue instant settlement | Entry-level brokers, testing |
| **V2 - MarginVault + ClearingVault** | On-chain cross-venue settlement | DeFi-native venues, compliance |
| **V3 - HubVault + Keeper** | Real-time cross-venue portfolio margin | Growth-stage exchanges, prime brokers |

---

## Revenue Model

| Revenue Stream | Description | Pricing |
|---------------|-------------|---------|
| Settlement fees | Per-settlement fee on realized PnL | 1-5 bps |
| Insurance premium | % of user deposits, charged to venues | 0.5-2% annually |
| Equity update service | Per-user monthly fee to venues | $1-5/user/month |
| Netting fees | Fee on capital saved through netting | 0.5-1 bps of netted amount |
| Integration fee | One-time venue onboarding | $25K-100K |

---

## Venue Integration Requirements

**What a venue needs to provide:**

| Requirement | Type | Purpose |
|------------|------|---------|
| Balance API | REST | Set/update user balance |
| Position feed | WebSocket | Real-time position data |
| Order freeze API | REST | Stop new orders for a user |
| Settlement callback | Webhook | Notify Anduin of liquidations |
| API key | Auth | Secure communication |

**What a venue gets:**

| Benefit | Description |
|---------|-------------|
| More volume | Users trade bigger (portfolio margin) |
| Less risk | Insurance covers liquidation shortfalls |
| New users | Access Anduin's user network |
| Capital efficiency | Cross-venue netting reduces obligations |

---

## Open Questions

1. **Venue API standardization** — Each venue has different APIs. Standardize vs. build adapters per venue?
2. **Oracle selection** — Which oracle for mark-to-market? Chainlink? Venue's own prices? Weighted average?
3. **Haircut calibration** — 50% is a starting point. Vary by asset volatility? Historical VaR?
4. **Insurance pool bootstrapping** — Who seeds it initially? Anduin? First venues? Mix?
5. **Regulatory** — Is the reinsurance function regulated? Depends on jurisdiction.
6. **Dispute resolution** — What if a venue disagrees with Anduin's equity update?
