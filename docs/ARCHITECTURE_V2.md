# Anduin Architecture V2 — Self-Governed Vault System

## Design Principle

**No single party controls user funds. The protocol is the custodian.**

Users deposit into smart contracts governed by immutable rules. Brokers/exchanges
interact through narrowly-scoped roles. Users can always withdraw their available balance.

---

## Contract Architecture

```
                    ┌─────────────────────────────┐
                    │      ClearingVault           │
                    │   (Cross-broker netting)     │
                    │                              │
                    │  obligations[BrokerA→B]: $X  │
                    │  obligations[BrokerB→A]: $Y  │
                    │  defaultFund: $Z             │
                    │                              │
                    │  GOVERNED BY: protocol rules  │
                    │  NO ADMIN OVERRIDE           │
                    └──────┬──────────┬────────────┘
                           │          │
                    settle net   settle net
                           │          │
              ┌────────────┴──┐  ┌───┴─────────────┐
              │  MarginVault  │  │   MarginVault    │
              │  (Kraken)     │  │   (Bybit)        │
              │               │  │                  │
              │  SELF-GOVERNED │  │  SELF-GOVERNED   │
              │               │  │                  │
              │  balances:    │  │  balances:       │
              │   UserA: $50K │  │   UserD: $30K    │
              │   UserB: $30K │  │   UserE: $45K    │
              │               │  │                  │
              │  brokerStake: │  │  brokerStake:    │
              │    $500K      │  │    $300K         │
              │               │  │                  │
              │  insuranceFund│  │  insuranceFund   │
              │    $50K       │  │    $30K          │
              └───────────────┘  └──────────────────┘
```

---

## MarginVault (One Per Broker)

### Roles (not admins — narrowly scoped permissions)

```solidity
// Roles are set at deployment and CANNOT be changed
// (or only via governance with timelock)

address public immutable broker;      // The exchange/broker
address public immutable settlement;  // Keeper/settlement engine
address public immutable oracle;      // Price feed oracle
address public clearingVault;         // For cross-broker settlements
```

### What each role can do

#### Users (anyone with a balance)
```solidity
// Deposit collateral — anyone, anytime
function depositCollateral(uint256 amount) external;

// Withdraw available balance — anytime
// Available = balance - marginInUse - pendingSettlements
function withdrawAvailable(uint256 amount) external;
// Reverts if amount > availableBalance(msg.sender)

// View functions
function balanceOf(address user) external view returns (uint256);
function availableBalance(address user) external view returns (uint256);
function marginInUse(address user) external view returns (uint256);
```

**Key: Users can ALWAYS withdraw their available balance. No one can freeze this.**

#### Settlement Role (Keeper)
```solidity
// Credit PnL to a user (they won)
// Funds come from brokerStake (broker is the counterparty)
function creditPnl(
    address user, 
    uint256 amount, 
    bytes32 refId
) external onlySettlement;

// Seize collateral from a user (they lost)  
// Funds go to brokerStake
// Capped at user's balance — cannot go negative
function seizeCollateral(
    address user, 
    uint256 amount, 
    bytes32 refId
) external onlySettlement returns (uint256 shortfall);

// Lock margin for an open position
function lockMargin(
    address user, 
    uint256 amount, 
    bytes32 positionId
) external onlySettlement;

// Unlock margin when position closes
function unlockMargin(
    address user, 
    uint256 amount, 
    bytes32 positionId
) external onlySettlement;

// Liquidate a position (margin ratio below threshold)
// Uses oracle price to determine if liquidation is valid
function liquidate(
    address user, 
    bytes32 positionId, 
    uint256 oraclePrice
) external onlySettlement;
```

**Key: Settlement role can ONLY move funds through defined operations. Every operation has a refId/positionId for dedup and auditability.**

#### Broker
```solidity
// Deposit into broker stake (their skin in the game)
function depositBrokerStake(uint256 amount) external onlyBroker;

// Withdraw from broker stake
// CONSTRAINT: Cannot withdraw below minimum stake requirement
// Minimum = f(total user balances, open positions)
function withdrawBrokerStake(uint256 amount) external onlyBroker;

// Deposit into insurance fund
function depositInsurance(uint256 amount) external onlyBroker;
```

**Key: Broker can only manage THEIR OWN stake. Cannot touch user funds. Cannot reduce stake below safety threshold.**

#### Clearing Vault (for cross-broker settlements)
```solidity
// Transfer obligation to clearing layer
// Only callable by the registered ClearingVault contract
function transferToClearing(uint256 amount) external onlyClearingVault;

// Receive settlement from clearing layer  
function receiveFromClearing(uint256 amount) external onlyClearingVault;
```

### Insurance Waterfall (unchanged but clearer)

```
When seizeCollateral() finds user can't cover full loss:

1. Take what user has           → balances[user] -= available
2. Insurance fund covers gap    → insuranceFund -= shortfall  
3. Broker stake absorbs rest    → brokerStake -= remaining
4. If all depleted              → socializedLoss (last resort)

The broker's stake is their SKIN IN THE GAME.
If they send bad trades, their stake gets eaten.
This aligns incentives.
```

### Margin Locking (NEW)

```
When a user opens a position:
  lockMargin(user, requiredMargin, positionId)
  → marginInUse[user] += requiredMargin
  → availableBalance[user] = balance[user] - marginInUse[user]
  → User cannot withdraw locked margin

When position closes:
  unlockMargin(user, requiredMargin, positionId)
  → marginInUse[user] -= requiredMargin
  → Then creditPnl or seizeCollateral for the PnL
  → User can now withdraw their freed margin
```

---

## ClearingVault (One Global — Cross-Broker Netting)

### Purpose
Handles obligations BETWEEN brokers. Only holds guarantee deposits from brokers,
NOT user funds. Netting reduces gross obligations to net transfers.

### Structure

```solidity
contract ClearingVault {
    IERC20 public immutable usdc;
    
    // Registered broker vaults
    mapping(address => bool) public registeredVaults;
    
    // Guarantee deposits per broker vault
    mapping(address => uint256) public guaranteeDeposits;
    
    // Minimum guarantee requirement per broker
    mapping(address => uint256) public minimumGuarantee;
    
    // Pending obligations (vault A owes vault B)
    // Accumulated during a netting window, then settled
    struct Obligation {
        address fromVault;
        address toVault;
        uint256 amount;
        bytes32 refId;
    }
    Obligation[] public pendingObligations;
    
    // Default fund (shared safety net)
    uint256 public defaultFund;
    
    // Netting window (e.g., settle every hour or every N trades)
    uint256 public nettingWindowSeconds;
    uint256 public lastNettingTimestamp;
}
```

### Functions

```solidity
// Register a new broker vault (governance-controlled)
function registerVault(address vault) external onlyGovernance;

// Broker deposits guarantee (required to participate in netting)
function depositGuarantee(uint256 amount) external onlyRegisteredVault;

// Record a cross-broker obligation
// Called by keeper when a cross-broker trade settles
function recordObligation(
    address fromVault, 
    address toVault, 
    uint256 amount, 
    bytes32 refId
) external onlySettlement;

// Execute netting round
// Anyone can call this (permissionless, like a Chainlink keeper)
// Calculates net obligations, executes transfers
function executeNetting() external;

// Emergency: individual settlement (bypass netting)
function settleImmediate(
    address fromVault, 
    address toVault, 
    uint256 amount, 
    bytes32 refId
) external onlySettlement;
```

### Netting Logic (on-chain)

```
executeNetting() does:

1. Group all pending obligations
2. For each pair (A, B): 
   net = obligations[A→B] - obligations[B→A]
3. For each non-zero net:
   - fromVault.transferToClearing(netAmount)
   - toVault.receiveFromClearing(netAmount)
4. Clear pending obligations
5. Update lastNettingTimestamp

If a vault can't cover its net obligation:
1. Use their guarantee deposit
2. If insufficient: hit default fund
3. If insufficient: partial settlement + flag for resolution
```

---

## The Full Settlement Flow

### Intra-Broker (User A and User B both on Kraken)

```
1. User A profits $10K, User B loses $10K
2. Keeper calls on Kraken's MarginVault:
   seizeCollateral(UserB, $10K, refId1)  → brokerStake += $10K
   creditPnl(UserA, $10K, refId2)        → brokerStake -= $10K
3. Net effect on brokerStake: $0 (it's a wash)
4. Users' balances updated instantly. Done.
```

### Cross-Broker (User A on Kraken vs User D on Bybit)

```
1. User A profits $10K, User D loses $10K

2. On Bybit's MarginVault:
   seizeCollateral(UserD, $10K, refId)
   → UserD balance -= $10K
   → brokerStake += $10K

3. On ClearingVault:
   recordObligation(bybitVault, krakenVault, $10K, refId)
   → Added to pending obligations

4. When netting window closes (or immediately if configured):
   executeNetting()
   → Bybit net owes Kraken $10K (after all trades netted)
   → bybitVault.transferToClearing($10K)
   → krakenVault.receiveFromClearing($10K)

5. On Kraken's MarginVault:
   creditPnl(UserA, $10K, refId)
   → UserA balance += $10K
   → brokerStake -= $10K (replenished by clearing receipt)
```

---

## Why This Works

### For Users (Investors)
- **Self-custody**: Funds in a smart contract, not on an exchange's books
- **Always withdrawable**: Available balance accessible 24/7, no one can freeze it
- **Transparent**: Balance verifiable on-chain by anyone
- **Protected**: Insurance fund + broker stake + default fund waterfall
- **No counterparty risk**: Even if the broker goes bankrupt, your funds are in the contract

### For Brokers (Exchanges)
- **Not surrendering control**: They deposit their own stake and manage their own risk
- **Aligned incentives**: Their stake gets eaten if they send bad trades — skin in the game
- **Capital efficient**: Netting reduces obligations by 60-80%
- **Competitive advantage**: Offer self-custody trading that others can't
- **Auditable**: Every settlement is on-chain, transparent to regulators

### For the Network (Anduin)
- **Moat**: More brokers = better netting = more capital savings for everyone
- **Revenue**: Fees on settlements + clearing fees on netting
- **Trust-minimized**: No single party controls the system
- **Composable**: Any new broker can plug in permissionlessly (after governance registration)

---

## What Changes From V1

| Component | V1 (Current) | V2 (Hub-and-Spoke) |
|-----------|-------------|---------------------|
| Vault ownership | Admin-controlled | Self-governed by protocol |
| User withdrawals | Admin can freeze (pause) | Users always withdraw available |
| Fund custody | Broker controls | Smart contract controls |
| Cross-broker | Not possible | ClearingVault + netting |
| Margin tracking | Not tracked | lockMargin/unlockMargin |
| Broker incentive | Unclear | Stake = skin in the game |
| Insurance | Per-vault | Per-vault + shared default fund |
| Trust model | Trust the broker | Trust the code |

---

## Migration Path

1. Rename `UnifiedAccountVault` → `MarginVault`
2. Add margin locking (lockMargin/unlockMargin)
3. Add `withdrawAvailable()` (balance - marginInUse)
4. Remove admin pause on user withdrawals (only pause settlements if needed)
5. Add `transferToClearing()` / `receiveFromClearing()`
6. Build new `ClearingVault` contract
7. Update keeper to handle cross-broker settlement flow
8. Update tests (big effort)

---

## Open Questions

1. **Governance**: Who registers new vaults in ClearingVault? Multisig? DAO? Anduin team initially?
2. **Minimum stake**: How is broker minimum stake calculated? % of user deposits? Fixed?
3. **Netting frequency**: Real-time? Hourly? Daily? Configurable per pair?
4. **Oracle dependency**: What if oracle goes down during a liquidation?
5. **Upgrade path**: Are contracts upgradeable (proxy) or immutable? Immutable is more trustworthy but harder to fix bugs.
