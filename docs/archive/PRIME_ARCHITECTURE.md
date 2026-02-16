# Anduin Prime Layer — Cross-Venue Trading Architecture

## Vision

**One deposit → trade everywhere**

Users fund a single smart contract ("prime account") and trade on multiple connected venues simultaneously. Cross-venue position netting, pre-trade margin checks, and periodic settlement with default waterfall.

---

## The Problem

### Current State (Siloed Liquidity)

```
User has $10,000 to trade

Option 1: Split across platforms
├─ Venue A: $3,000 deposited
├─ Venue B: $3,000 deposited  
├─ Venue C: $2,000 deposited
└─ Idle cash: $2,000 (unused)

Problems:
- Liquidity fragmented
- Can't use full buying power on any single venue
- Reconciliation nightmare (3 separate deposits/withdrawals)
```

### Prime Layer (Unified Liquidity)

```
User has $10,000 in Prime Account

Trade on all venues from single account:
├─ Venue A: Long 100 AAPL @ $150 = $15,000 notional
├─ Venue B: Short 50 AAPL @ $151 = $7,500 notional
└─ Venue C: Options strategies

Net exposure: $7,500 (venues A and B partially offset)
Required margin: $750 (10% of net exposure)
Available margin: $10,000 ✅

Benefits:
- Full buying power across all venues
- Cross-venue netting (reduces margin requirements)
- Single deposit, single withdrawal
```

---

## Architecture

### High-Level Flow

```
┌────────────────────────────────────────────────────────────────┐
│                      PRIME ACCOUNT                              │
│                  (Smart Contract on Base)                       │
│                                                                 │
│  User Balance: $100,000 USDC                                    │
│                                                                 │
│  Venue Allocations:                                             │
│  ├─ Venue A (Hyperliquid): $40,000 allocated                    │
│  ├─ Venue B (Vertex): $30,000 allocated                         │
│  ├─ Venue C (Drift): $20,000 allocated                          │
│  └─ Reserve: $10,000 (unallocated)                              │
│                                                                 │
│  Cross-Venue Positions:                                         │
│  ├─ Venue A: Long 200 AAPL @ $150 (+$30k notional)              │
│  ├─ Venue B: Short 100 AAPL @ $151 (-$15k notional)             │
│  └─ Net AAPL exposure: +$15k (50% netted)                       │
│                                                                 │
│  Margin Requirement: 10% of net = $1,500                        │
│  Available Margin: $100,000 ✅ (healthy)                        │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│                    VENUE CONNECTORS                             │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │   Venue A API    │  │   Venue B API    │  │  Venue C API │  │
│  │  - Pre-trade     │  │  - Pre-trade     │  │ - Pre-trade  │  │
│  │    margin check  │  │    margin check  │  │   margin check│ │
│  │  - Position sync │  │  - Position sync │  │ - Position   │  │
│  │  - Settlement    │  │  - Settlement    │  │   sync       │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│           │                     │                     │         │
└───────────┼─────────────────────┼─────────────────────┼─────────┘
            ▼                     ▼                     ▼
   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
   │   Venue A    │      │   Venue B    │      │   Venue C    │
   │ (Hyperliquid)│      │  (Vertex)    │      │   (Drift)    │
   └──────────────┘      └──────────────┘      └──────────────┘
```

---

## Core Components

### 1. Prime Account Smart Contract

```solidity
contract PrimeAccount {
    // User's collateral balance
    uint256 public totalBalance;
    
    // Per-venue allocations
    mapping(bytes32 => uint256) public venueAllocations;  // venueId => allocated amount
    
    // Cross-venue positions (for netting)
    struct Position {
        bytes32 symbolId;
        int256 quantity;        // Positive = long, negative = short
        uint256 avgPrice;
        bytes32 venueId;
    }
    mapping(address => Position[]) public userPositions;
    
    // Margin tracking
    uint256 public requiredMargin;
    uint256 public maintenanceMargin;
    
    // Venue registry
    mapping(bytes32 => VenueConfig) public venues;
    
    struct VenueConfig {
        string name;
        address connector;      // Connector contract/service
        bool enabled;
        uint16 marginMultiplier; // Basis points (10000 = 1x)
    }
}
```

### 2. Pre-Trade Margin Check

Before user places trade on any venue:

```typescript
async function checkPreTradeMargin(
  user: address,
  venue: string,
  symbol: string,
  quantity: number,
  price: number
): Promise<{ allowed: boolean; reason?: string }> {
  
  // 1. Get user's current positions across all venues
  const positions = await primeAccount.getUserPositions(user);
  
  // 2. Calculate net exposure after new trade
  const netExposure = calculateNetExposure(positions, {
    venue,
    symbol,
    quantity,
    price
  });
  
  // 3. Calculate required margin (10% of net exposure)
  const requiredMargin = netExposure * 0.10;
  
  // 4. Check available margin
  const availableMargin = await primeAccount.totalBalance(user);
  
  if (availableMargin < requiredMargin) {
    return {
      allowed: false,
      reason: `Insufficient margin: need $${requiredMargin}, have $${availableMargin}`
    };
  }
  
  return { allowed: true };
}
```

### 3. Cross-Venue Netting

```typescript
function calculateNetExposure(positions: Position[]): Map<string, number> {
  const netBySymbol = new Map<string, number>();
  
  for (const pos of positions) {
    const current = netBySymbol.get(pos.symbol) || 0;
    netBySymbol.set(pos.symbol, current + pos.quantity * pos.avgPrice);
  }
  
  return netBySymbol;
}

// Example:
// Venue A: Long 100 AAPL @ $150 = +$15,000
// Venue B: Short 60 AAPL @ $151 = -$9,060
// Net: +$5,940 exposure (instead of $24,060 gross)
// Required margin: $594 (instead of $2,406)
```

### 4. Periodic Settlement

Every 1-6 hours, settle realized PnL:

```solidity
function settleVenue(bytes32 venueId) external onlySettlement {
    // 1. Fetch realized PnL from venue
    int256 venuePnL = IVenueConnector(venues[venueId].connector).getRealizedPnL();
    
    // 2. Update user balances
    for (address user in users) {
        int256 userPnL = getVenuePnLForUser(user, venueId);
        
        if (userPnL > 0) {
            // Credit winnings
            totalBalance[user] += uint256(userPnL);
        } else {
            // Deduct losses
            totalBalance[user] -= uint256(-userPnL);
        }
    }
    
    // 3. Check solvency
    require(totalBalance[user] >= maintenanceMargin[user], "User undercollateralized");
}
```

### 5. Default Waterfall

If user's margin falls below maintenance level:

```
1. Margin call (user has 1 hour to deposit)
2. If not topped up → close positions on venue with largest loss
3. If still undercollateralized → close next largest loss
4. If still underwater → use venue insurance fund
5. If insurance insufficient → socialize losses across venue users
6. Anduin backstop fund (last resort)
```

```solidity
function liquidateUser(address user) external onlyLiquidator {
    // 1. Get all positions sorted by PnL (worst first)
    Position[] memory positions = getUserPositionsSorted(user);
    
    // 2. Close positions until margin restored
    for (uint i = 0; i < positions.length; i++) {
        Position memory pos = positions[i];
        
        // Close position on venue
        IVenueConnector(venues[pos.venueId].connector).closePosition(user, pos.symbolId);
        
        // Check if margin restored
        if (getMarginRatio(user) > maintenanceMargin) break;
    }
    
    // 3. If still underwater, use insurance fund
    if (totalBalance[user] < 0) {
        uint256 deficit = uint256(-int256(totalBalance[user]));
        require(insuranceFund >= deficit, "Insurance fund depleted");
        insuranceFund -= deficit;
        totalBalance[user] = 0;
    }
}
```

---

## Venue Integration

### Venue Connector Interface

Each venue needs a connector implementing:

```solidity
interface IVenueConnector {
    // Pre-trade checks
    function checkMargin(address user, bytes32 symbol, int256 quantity) external view returns (bool);
    
    // Position sync
    function getPositions(address user) external view returns (Position[] memory);
    function getRealizedPnL(address user) external view returns (int256);
    
    // Order execution
    function placeOrder(address user, bytes32 symbol, int256 quantity, uint256 price) external returns (bytes32 orderId);
    function closePosition(address user, bytes32 symbol) external;
    
    // Settlement
    function settleUser(address user, int256 pnl) external;
}
```

### Example: Hyperliquid Connector

```typescript
class HyperliquidConnector implements IVenueConnector {
  async getPositions(user: address): Promise<Position[]> {
    const response = await fetch(`https://api.hyperliquid.xyz/info`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'clearinghouseState',
        user
      })
    });
    
    const data = await response.json();
    return data.assetPositions.map(p => ({
      symbol: p.position.coin,
      quantity: parseFloat(p.position.szi),
      avgPrice: parseFloat(p.position.entryPx),
      venue: 'hyperliquid'
    }));
  }
  
  async placeOrder(user: address, symbol: string, quantity: number, price: number) {
    // Hyperliquid order placement
    // ...
  }
}
```

---

## Revenue Model

| Fee Type | Amount | Who Pays |
|----------|--------|----------|
| **Prime account setup** | €10k one-time | Venue (to integrate) |
| **Settlement fee** | 0.5 bps on notional | User (per settlement) |
| **Cross-venue netting savings** | 10% of margin saved | User (optional) |
| **SaaS monthly** | €5k/month | Venue |

**Example user savings:**
- Gross exposure: $100k across 3 venues
- Net exposure: $40k (60% netted)
- Margin saved: $6k
- Anduin fee (10%): $600
- **User net savings: $5.4k**

---

## Pilot Program

### Phase 1: 2-Venue Pilot (Hyperliquid + Vertex)

**Target users:** 10 HFT traders, $1M+ each

**Deliverables:**
1. PrimeAccount.sol deployed on Base
2. Hyperliquid + Vertex connectors
3. Pre-trade margin API
4. Settlement service (hourly)
5. Dashboard showing cross-venue positions

**Success metrics:**
- 90%+ uptime
- <100ms margin check latency
- Zero reconciliation breaks

### Phase 2: Add 3 More Venues

- Drift, dYdX, Apex Pro
- 50 users
- Daily settlement

### Phase 3: Mainnet + Institutional Onboarding

- 500+ users
- Institutional-grade SLAs
- Insurance fund
- Audited contracts

---

## Technical Challenges

### 1. **Position Sync Latency**

**Problem:** Venues report positions with 1-5s lag

**Solution:**
- Optimistic margin checks (approve trade, verify after)
- Rollback if margin invalid
- WebSocket subscriptions for real-time position updates

### 2. **Venue API Reliability**

**Problem:** Venue APIs go down, rate limits

**Solution:**
- Circuit breakers (halt trading if venue offline)
- Fallback to cached positions (max 30s old)
- Redundant API keys

### 3. **Cross-Venue Netting Complexity**

**Problem:** Different venues use different position formats

**Solution:**
- Standardized Position schema
- Per-venue adapters
- Unit tests for netting logic

### 4. **Settlement Timing**

**Problem:** Venues settle at different times (hourly vs daily)

**Solution:**
- Anduin settles hourly (most frequent)
- Per-venue settlement windows
- Net settlements before submitting on-chain

---

## Security & Risk Management

### 1. **Venue Default Risk**

If a venue goes insolvent:
- Isolate losses to that venue's users
- Insurance fund covers first $1M loss
- Socialize remaining losses pro-rata

### 2. **Smart Contract Risk**

- **Audits:** 2 independent audits before mainnet
- **Timelocks:** 48h delay on parameter changes
- **Pause circuit:** Emergency stop if exploit detected

### 3. **Oracle Manipulation**

- Use multiple oracles (Chainlink + Pyth)
- Reject if deviation > 5%
- Halt trading if oracle offline

### 4. **Front-Running**

- Pre-trade margin checks off-chain (private)
- Batch settlements (hide individual orders)

---

## Comparison to Alternatives

| Feature | Prime Layer | Venue-by-Venue | Aggregator (e.g., 1inch) |
|---------|------------|----------------|--------------------------|
| Cross-venue netting | ✅ Yes | ❌ No | ❌ No |
| Pre-trade margin | ✅ Yes | ❌ No | ❌ No |
| Single deposit | ✅ Yes | ❌ No (per venue) | ⚠️ Partial |
| Instant settlement | ✅ Yes (hourly) | ❌ Slow (days) | N/A |
| Insurance fund | ✅ Yes | ⚠️ Venue-specific | ❌ No |
| Gas cost | 💰 Low (batched) | 💰💰 High | 💰 Low |

---

## Go-to-Market

### Target Customers

1. **HFT traders** ($1M+ capital)
   - Pain: Liquidity fragmented across venues
   - Benefit: 60%+ margin savings via netting

2. **Market makers**
   - Pain: Managing inventory across venues
   - Benefit: Cross-venue hedging

3. **Institutional desks**
   - Pain: Reconciliation complexity
   - Benefit: Single deposit, auditability

### Sales Pitch

> **"Trade on Hyperliquid, Vertex, and dYdX with one deposit. 60% less margin required."**

**Elevator pitch:**
- Deposit once → trade everywhere
- Cross-venue position netting = 60% margin savings
- Instant settlement (hourly) = no withdrawal delays
- One dashboard, one reconciliation report

---

## Roadmap

| Quarter | Milestone |
|---------|-----------|
| **Q2 2026** | Deploy PrimeAccount.sol (testnet) |
| | Build Hyperliquid + Vertex connectors |
| | Pilot with 10 users |
| **Q3 2026** | Mainnet launch (2 venues) |
| | Add 3 more venues (Drift, dYdX, Apex) |
| | Onboard 50 users |
| **Q4 2026** | Institutional launch |
| | Insurance fund ($5M) |
| | 500+ users |
| **2027** | 10+ venues, 5,000+ users |

---

## Conclusion

**Anduin Prime Layer** solves the liquidity fragmentation problem:
- **One deposit → trade everywhere**
- **Cross-venue netting** = 60% margin savings
- **Instant settlement** = no withdrawal delays
- **Default waterfall** = protects venues and users

This is the **future of multi-venue trading** — and Anduin is building it.

---

## Next Steps

1. **Deploy PrimeAccount.sol** to Base Sepolia
2. **Build connectors** for Hyperliquid + Vertex
3. **Recruit 10 pilot users** ($1M+ each)
4. **Run 30-day pilot** (testnet)
5. **Audit + mainnet launch** (Q3 2026)
