# Anduin Architecture V3 — Meta-Risk Layer + Reinsurer

## Design Principle

**Anduin doesn't replace venue risk management. Anduin sits in front of it.**

Venues keep their own margin engines and liquidation systems unchanged.
Anduin manages cross-venue equity, prevents overspend, and reinsures shortfalls.

---

## How It Works

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

---

## Step-by-Step Flow

### 1. Deposit
```
User deposits $50K USDC into HubVault (on-chain).
Anduin keeper detects deposit event.
Keeper calls venue APIs:
  Kraken API: creditBalance(userId, $50K)
  Bybit API: creditBalance(userId, $50K)
User now sees $50K on Kraken AND $50K on Bybit.
```

### 2. Pre-Trade (Venue Handles)
```
User submits order on Kraken: Long 1 BTC ($10K margin).
Kraken's own risk engine checks: user has $50K, needs $10K → APPROVED.
Trade executes. Kraken reports position to Anduin.
```

### 3. Post-Trade Check (Anduin)
```
Anduin receives trade notification from Kraken.
Anduin checks cross-venue margin:
  Kraken margin used: $10K
  Bybit margin used:  $0
  Total margin:       $10K
  Total collateral:   $50K
  → Portfolio healthy. No action.

If user had opened $40K on Kraken AND $40K on Bybit:
  Total margin: $80K > $50K collateral
  → OVERSPEND DETECTED
  → Anduin reduces balance on one/both venues
  → Venue's own risk engine sees reduced balance → forces position reduction
```

### 4. Equity Updates (Event-Driven)

**Triggers (not just time-based):**
- Price change > X% on any position's underlying
- Position opened or closed on any venue
- Every N minutes as a heartbeat fallback (e.g., 5 min)
- Manually triggered by user or admin

```
Event: BTC price moves 2% (trigger threshold reached)

Anduin reads all positions across all venues:
  Kraken: Long BTC, unrealized PnL = +$15K
  Bybit:  Short BTC, unrealized PnL = -$12K

Anduin calculates per-venue equity update:

  Bybit new equity = collateral ($50K)
    + own unrealized PnL (-$12K)
    + 50% haircut on Kraken positive PnL (+$7.5K)
    = $45.5K
  → Anduin updates Bybit: setBalance(userId, $45.5K)
  → Bybit sees $45.5K equity, user is safe
  → WITHOUT Anduin: Bybit would see $50K - $12K = $38K (closer to liq)

  Kraken new equity = collateral ($50K)
    + own unrealized PnL (+$15K)
    + 50% haircut on Bybit negative PnL (-$6K)
    = $59K
  → Anduin updates Kraken: setBalance(userId, $59K)
```

**Why 50% haircut on positive PnL:**
- Price could reverse before next update
- Latency between venues (prices not perfectly synced)
- Execution risk on liquidation (can't close instantly)
- Conservative = insurance pool stays solvent

**Haircut is configurable:** Start at 50%, can adjust per asset, per venue, per volatility regime.

### 5. Overspend Protection

```
Scenario: User opens too many positions across venues.

Anduin detects: total margin > allowed % of collateral
Actions (in order):
  1. Stop accepting new positions: tell venues to freeze new orders
  2. If margin exceeds hard limit: reduce balance on venues
     → Venue's own liquidation kicks in
  3. Anduin does NOT liquidate directly
     → The venue's engine handles it with its existing logic
```

### 6. Insurance / Reinsurance

```
Scenario: Bybit liquidates user. Position closed at loss.
  User's balance on Bybit wasn't enough to cover.
  Bybit has a shortfall of $5K.

Anduin covers:
  1. HubVault: deduct from user's remaining collateral (cross-venue)
  2. If user collateral insufficient: insurance pool covers it
  3. Anduin transfers $5K to Bybit via API or ClearingVault
  4. Bybit is made whole. No loss for the venue.

This is the REINSURANCE pitch:
  "Connect to Anduin → your liquidation shortfalls are covered"
```

### 7. Settlement (End of Day / Netting Window)

```
Accumulated PnL across venues gets netted:
  Kraken owes Bybit: $100K (aggregate from all users)
  Bybit owes Kraken: $85K
  
  Net: Kraken → Bybit: $15K
  
  ClearingVault executes the net transfer.
  HubVaults updated accordingly.
```

---

## Smart Contract Architecture

### HubVault.sol (One Global, Per-User Accounting)

```
One contract for all users (gas efficient, simpler management).
Per-user balances tracked internally.

State:
  mapping(address => uint256) public collateral;        // user deposits
  mapping(address => mapping(address => uint256)) public venueAllocations;  
  // venueAllocations[user][venue] = current equity shown to venue
  
  mapping(address => bool) public registeredVenues;     // approved venues
  uint256 public insurancePool;                         // reinsurance fund
  uint256 public totalDeposits;                         // sum of all user collateral
  
  // Dedup
  mapping(bytes32 => bool) public processedEvents;

User Functions:
  depositCollateral(uint256 amount)
    → User deposits USDC. Always allowed.
    → Emits event that keeper picks up to propagate to venues.
    
  withdrawAvailable(uint256 amount)
    → User withdraws. Available = collateral - totalMarginInUse.
    → Keeper propagates reduced balance to venues.
    → NO admin can block this.

Keeper Functions (onlyKeeper):
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

Insurance Functions:
  depositInsurance(uint256 amount) → anyone can deposit
  
Governance (timelocked):
  registerVenue(address venue)
  removeVenue(address venue)
  setHaircutBps(uint256 bps)  // e.g., 5000 = 50%
  setKeeperAddress(address keeper)
```

### ClearingVault.sol (Cross-Venue Netting)

Same as V2 but simplified:
- Tracks net obligations between venues
- Executes netting on schedule or trigger
- Funded by venue guarantee deposits + default fund

### No More MarginVault Per Venue

In V3, the per-venue MarginVault is gone. The HubVault is the single source of truth.
Venues interact via API, not smart contracts. The on-chain component is just the HubVault
(holds funds) and ClearingVault (nets obligations).

---

## Equity Update Triggers

Instead of fixed time intervals, equity updates fire on events:

| Trigger | Condition | Latency |
|---------|-----------|---------|
| Price move | Underlying moves > X% since last update | Real-time |
| Trade event | User opens/closes position on any venue | Immediate post-trade |
| Heartbeat | Fallback timer (every 5 min) | 5 min max |
| Deposit/withdraw | User adds or removes collateral | Immediate |
| Manual | Admin or user requests recalculation | On demand |
| Volatility spike | VIX equivalent or funding rate spike | Real-time |

**Price move threshold is configurable per asset:**
- BTC: 1% move triggers update (volatile)
- Gold: 0.5% (less volatile, tighter)
- Stablecoins: 0.1% (should almost never trigger)

---

## Keeper Service Architecture

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

---

## Product Features

### Core Platform

1. **HubVault** — Self-governed smart contract holding user funds
   - Deposit/withdraw USDC anytime
   - On-chain, auditable, no admin override on withdrawals
   - Insurance pool for shortfall coverage

2. **Cross-Venue Equity Engine** — Real-time portfolio margin
   - Aggregates positions across all connected venues
   - Calculates equity with configurable haircuts (default 50%)
   - Event-driven updates (price moves, trades, heartbeat)
   - Overspend detection and automatic balance reduction

3. **Venue Credit Propagation** — Balance management
   - Propagates deposits to all connected venues via API
   - Updates equity on venues after recalculation
   - Reduces balances to trigger venue liquidation when needed
   - Freezes new orders when user approaches limits

4. **Reinsurance Pool** — Shortfall coverage
   - Covers venue liquidation shortfalls
   - Waterfall: user collateral → insurance pool → socialized
   - Funded by: insurance premiums, settlement fees, direct deposits

5. **Cross-Venue Netting** — Capital efficiency
   - Nets obligations between venues (ClearingVault)
   - Reduces gross settlement volume by 60-80%
   - Configurable netting windows

6. **Settlement Engine** — PnL settlement
   - Instant intra-venue settlement
   - Netted cross-venue settlement
   - Atomic on-chain execution with refId dedup

### Monitoring & Admin

7. **Portfolio Dashboard** — User-facing
   - Cross-venue portfolio view
   - Real-time equity, positions, PnL
   - Margin health indicator
   - Deposit/withdraw interface

8. **Venue Dashboard** — Venue-facing
   - Users connected via Anduin
   - Settlement status and history
   - Insurance claims
   - API health

9. **Admin Panel** — Anduin ops
   - Venue onboarding
   - Insurance pool management
   - Risk parameter configuration (haircuts, thresholds)
   - Emergency controls

10. **Alerting System**
    - User margin warnings (email/push)
    - Venue balance update failures
    - Insurance pool depletion alerts
    - Keeper health monitoring

### Venue Integration

11. **Venue Adapter SDK** — For exchanges to integrate
    - REST + WebSocket APIs
    - Balance propagation endpoints
    - Position reporting format
    - Settlement callbacks
    - Docs + sandbox for testing

12. **Venue Onboarding Kit**
    - API credentials setup
    - Test environment with mock positions
    - Integration verification checklist
    - Go-live runbook

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

What a venue needs to provide:

| Requirement | Type | Purpose |
|------------|------|---------|
| Balance API | REST | Set/update user balance |
| Position feed | WebSocket | Real-time position data |
| Order freeze API | REST | Stop new orders for a user |
| Settlement callback | Webhook | Notify Anduin of liquidations |
| API key | Auth | Secure communication |

What a venue gets:

| Benefit | Description |
|---------|-------------|
| More volume | Users trade bigger (portfolio margin) |
| Less risk | Insurance covers liquidation shortfalls |
| New users | Access Anduin's user network |
| Capital efficiency | Cross-venue netting reduces obligations |

---

## Security Model

### Self-Governance
- HubVault: users always withdraw available balance (no admin override)
- Insurance pool: transparent on-chain balance
- Settlement: every action has refId dedup + event logs

### Keeper Trust
- Keeper is the only off-chain component with on-chain write access
- Keeper can: update allocations, process shortfalls, lock margin
- Keeper CANNOT: withdraw user funds, reduce collateral, access insurance pool directly
- Keeper actions are bounded: allocation updates must net to ≤ collateral + haircut PnL

### Venue Trust
- Venues cannot access HubVault directly
- Venues report positions; Anduin verifies against oracle prices
- If venue reports false positions, Anduin's oracle cross-check catches it

### Risk Parameters
- Haircut: 50% default (configurable per asset/venue)
- Max allocation per venue: configurable (e.g., no more than 80% of collateral to one venue)
- Overspend threshold: total margin > X% of collateral triggers action
- Insurance pool minimum: must cover Y% of total deposits

---

## Migration from V2

V2 (MarginVault per venue) → V3 (HubVault + venue APIs):

1. HubVault replaces all MarginVaults
2. ClearingVault remains (simplified)
3. Venue interaction moves from on-chain to API-based
4. Keeper gains equity engine + venue API client
5. New: portfolio dashboard, venue adapter SDK

V2 contracts (MarginVault, ClearingVault) remain for venues that want pure on-chain settlement without the meta-risk layer. V3 is the premium product.

---

## Open Questions

1. **Venue API standardization** — Each venue has different APIs. How much do we standardize vs. build adapters per venue?
2. **Oracle selection** — Which oracle for mark-to-market? Chainlink? Venue's own prices? Weighted average?
3. **Haircut calibration** — 50% is a starting point. Should it vary by asset volatility? Historical VaR?
4. **Insurance pool bootstrapping** — Who seeds it initially? Anduin? First venues? Mix?
5. **Regulatory** — Is the reinsurance function regulated? Depends on jurisdiction.
6. **Dispute resolution** — What if a venue disagrees with Anduin's equity update?
