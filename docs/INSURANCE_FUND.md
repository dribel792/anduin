# Insurance Fund

**Protecting the system from underwater accounts and socialized losses.**

The insurance fund is Volera's safety mechanism that covers trading losses when a user's collateral is insufficient. It acts as the second line of defense in the settlement waterfall, preventing individual user shortfalls from impacting other traders.

---

## Overview

When a trader incurs a loss larger than their deposited collateral, the system has three options:

1. **Seize available user collateral** (primary)
2. **Draw from the insurance fund** (secondary)
3. **Socialize remaining losses** (last resort)

The insurance fund sits between these layers, absorbing shortfalls before they propagate to other users.

---

## The Waterfall

```
┌──────────────────────────────────────────────┐
│  LOSS SETTLEMENT WATERFALL                   │
├──────────────────────────────────────────────┤
│                                              │
│  1. User Collateral                          │
│     ├─ If sufficient → seize full amount     │
│     └─ If insufficient → seize all available │
│                                              │
│  2. Insurance Fund                           │
│     ├─ Cover shortfall from insurance fund   │
│     └─ If insufficient → drain fund to zero  │
│                                              │
│  3. Socialized Losses                        │
│     └─ Track remaining loss as socialized    │
│        (no immediate action, noted for admin)│
│                                              │
└──────────────────────────────────────────────┘
```

This design ensures:
- Users never lose more than their collateral
- Broker pool is protected from individual trader blowups
- System remains solvent even in extreme market conditions

---

## Implementation

The insurance fund mechanism is implemented in `UnifiedAccountVault.sol` through the `seizeCollateralCapped()` function.

### State Variables

```solidity
/// @notice Insurance fund to cover underwater accounts
uint256 public insuranceFund;

/// @notice Accumulated socialized losses when insurance fund is insufficient
uint256 public totalSocializedLosses;
```

### Core Function: `seizeCollateralCapped()`

```solidity
function seizeCollateralCapped(
    address user,
    uint256 amount,
    bytes32 refId
) external onlySettlement whenNotPaused nonReentrant 
  returns (uint256 seized, uint256 shortfall)
```

**Parameters:**
- `user` — Address of the trader with a loss
- `amount` — Total loss amount to recover
- `refId` — Unique reference ID for deduplication (prevents double-settlement)

**Returns:**
- `seized` — Amount actually seized from user's collateral
- `shortfall` — Amount that couldn't be seized (covered by insurance or socialized)

**Flow:**

1. **Check for duplicate settlement** using `refId`
2. **Seize available collateral:**
   ```solidity
   uint256 availableCollateral = collateral[user];
   seized = amount > availableCollateral ? availableCollateral : amount;
   shortfall = amount - seized;
   ```

3. **Handle shortfall (if any):**
   - If `insuranceFund >= shortfall` → Cover fully from insurance
   - If `insuranceFund < shortfall` → Use all insurance + socialize remainder

4. **Emit events:**
   - `CollateralSeized(user, seized, refId)` — for on-chain seized amount
   - `Shortfall(user, shortfall, coveredByInsurance, socialized)` — for insurance/socialized breakdown

---

## Example Scenarios

### Scenario 1: Sufficient Collateral ✅

```
User collateral:     $5,000
Trading loss:        $3,000
Insurance fund:      $50,000

Result:
├─ Seized:           $3,000 (from user)
├─ Insurance used:   $0
└─ Socialized:       $0

Final state:
├─ User collateral:  $2,000
├─ Insurance fund:   $50,000
└─ Broker pool:      +$3,000
```

### Scenario 2: Partial Shortfall (Insurance Covers) ✅

```
User collateral:     $1,000
Trading loss:        $5,000
Insurance fund:      $50,000

Result:
├─ Seized:           $1,000 (from user)
├─ Shortfall:        $4,000
├─ Insurance used:   $4,000
└─ Socialized:       $0

Final state:
├─ User collateral:  $0
├─ Insurance fund:   $46,000
└─ Broker pool:      +$5,000
```

### Scenario 3: Insurance Fund Depleted ⚠️

```
User collateral:     $500
Trading loss:        $10,000
Insurance fund:      $2,000

Result:
├─ Seized:           $500 (from user)
├─ Shortfall:        $9,500
├─ Insurance used:   $2,000 (all remaining)
├─ Socialized:       $7,500 ❗
└─ Socialized total: $7,500 (tracked on-chain)

Final state:
├─ User collateral:      $0
├─ Insurance fund:       $0
├─ Broker pool:          +$2,500
└─ totalSocializedLosses: $7,500
```

**Note:** Socialized losses are tracked but not immediately enforced. The admin must decide how to handle them (replenish insurance fund, adjust broker fees, etc.).

---

## Admin Functions

### Deposit to Insurance Fund

```solidity
function depositInsuranceFund(uint256 amount) 
    external onlyAdmin whenNotPaused nonReentrant
```

- Admin transfers USDC into the insurance fund
- Typically funded from:
  - Trading fees
  - Broker revenue share
  - Protocol reserves

**Event:**
```solidity
event InsuranceFundDeposited(uint256 amount);
```

### Withdraw from Insurance Fund

```solidity
function withdrawInsuranceFund(uint256 amount) 
    external onlyAdmin nonReentrant
```

- Admin can withdraw USDC from the insurance fund
- Use cases:
  - Rebalancing reserves
  - Emergency liquidity extraction
  - Migration to new contract version

**Event:**
```solidity
event InsuranceFundWithdrawn(uint256 amount);
```

---

## Events

### `Shortfall`

Emitted when a user's collateral is insufficient to cover their loss.

```solidity
event Shortfall(
    address indexed user,
    uint256 amount,
    uint256 coveredByInsurance,
    uint256 socialized
);
```

**Example:**
```javascript
// User had $1,000 collateral but lost $8,000
// Insurance fund had $3,000
Shortfall(
    user: 0x123...,
    amount: 7000,          // Total shortfall
    coveredByInsurance: 3000,
    socialized: 4000       // Remaining loss tracked on-chain
)
```

### `InsuranceFundDeposited`

```solidity
event InsuranceFundDeposited(uint256 amount);
```

### `InsuranceFundWithdrawn`

```solidity
event InsuranceFundWithdrawn(uint256 amount);
```

---

## Monitoring & Alerts

### Key Metrics to Track

1. **Insurance Fund Balance**
   ```solidity
   uint256 public insuranceFund;
   ```
   - Recommended minimum: 5-10% of total user collateral
   - Alert if falls below 2% of collateral

2. **Total Socialized Losses**
   ```solidity
   uint256 public totalSocializedLosses;
   ```
   - Should remain zero under normal conditions
   - Any non-zero value requires admin intervention

3. **Shortfall Rate**
   - Track frequency of `Shortfall` events
   - High frequency indicates:
     - Insufficient user margin requirements
     - Volatile market conditions
     - Inadequate insurance fund

### Recommended Alerts

| Condition | Severity | Action |
|-----------|----------|--------|
| `insuranceFund < 2%` of total collateral | 🔴 Critical | Replenish immediately |
| `insuranceFund < 5%` of total collateral | 🟡 Warning | Schedule replenishment |
| `totalSocializedLosses > 0` | 🔴 Critical | Investigate, replenish insurance |
| 3+ `Shortfall` events in 24h | 🟡 Warning | Review margin requirements |

---

## Gas Optimization

The `seizeCollateralCapped()` function is designed for minimal gas usage:

- **Single SSTORE** for `insuranceFund` (when used)
- **No loops** — O(1) complexity
- **Efficient math** — no unnecessary calculations
- **Conditional logic** — insurance fund only touched when needed

Typical gas cost: **~50,000 gas** (similar to standard `seizeCollateral`)

---

## Security Considerations

### ✅ Idempotency

The `refId` mechanism ensures a settlement cannot be processed twice:

```solidity
if (usedRefIds[refId]) revert DuplicateRefId();
usedRefIds[refId] = true;
```

This prevents:
- Accidental double-debiting
- Replay attacks
- System accounting errors

### ✅ Reentrancy Protection

All insurance fund functions use `nonReentrant` modifier from OpenZeppelin.

### ✅ Admin-Only Access

Only the designated admin can deposit/withdraw from the insurance fund:

```solidity
modifier onlyAdmin() {
    if (msg.sender != admin) revert Unauthorized();
    _;
}
```

### ⚠️ Centralization Risk

The admin has unilateral control over the insurance fund. Mitigations:

- **Multisig admin** — Require 3/5 signatures for withdrawals
- **Timelock** — 24-48 hour delay on large withdrawals
- **On-chain limits** — Cap withdrawal amounts per day
- **Public monitoring** — All events are on-chain and auditable

---

## Integration Guide

### For Settlement Services

When processing a loss where user may be underwater:

```typescript
import { parseUnits } from 'viem';

// Calculate loss amount
const lossAmount = parseUnits('5000', 6); // $5,000 USDC

// Use seizeCollateralCapped instead of seizeCollateral
const { seized, shortfall } = await vault.write.seizeCollateralCapped([
  userAddress,
  lossAmount,
  refId
]);

// Handle result
if (shortfall > 0) {
  console.warn(`Insurance fund used: ${shortfall} USDC`);
  
  // Alert admin if fund is low
  const fundBalance = await vault.read.insuranceFund();
  if (fundBalance < MIN_THRESHOLD) {
    await alertAdmin('Insurance fund low, replenish needed');
  }
}
```

### For Frontend Dashboards

Display insurance fund health:

```typescript
const insuranceFund = await vault.read.insuranceFund();
const totalCollateral = await vault.read.collateral(/* sum all users */);
const socializedLosses = await vault.read.totalSocializedLosses();

const healthRatio = (insuranceFund / totalCollateral) * 100;

// Show warning if health < 5%
if (healthRatio < 5) {
  showWarning('Insurance fund health low');
}

// Show critical if socialized losses exist
if (socializedLosses > 0) {
  showCritical(`Socialized losses detected: ${socializedLosses}`);
}
```

---

## Future Enhancements

### Auto-Replenishment

Automatically fund insurance from trading fees:

```solidity
// In settlement contract:
uint256 feeToInsurance = tradingFee * 0.2; // 20% of fees
vault.depositInsuranceFund(feeToInsurance);
```

### Dynamic Insurance Ratio

Adjust insurance target based on market volatility:

```solidity
// Low volatility: 5% target
// High volatility: 15% target
uint256 targetRatio = calculateVolatilityAdjustedTarget();
```

### Insurance Fund Staking

Let users stake USDC into the insurance fund for yield:

- Users earn a share of trading fees
- Staked funds are locked for 7-30 days
- Provides organic insurance fund growth

---

## FAQ

**Q: What happens if the insurance fund runs out?**

A: Losses are tracked as "socialized" in `totalSocializedLosses`. The system continues operating, but the admin should replenish the fund ASAP to prevent cascading failures.

**Q: Can users see the insurance fund balance?**

A: Yes, `insuranceFund` is a public state variable. Anyone can query it.

**Q: Does using the insurance fund affect gas costs?**

A: Minimally. The capped seizure function has similar gas costs to standard seizure.

**Q: Who funds the insurance fund initially?**

A: Typically the protocol operator or broker. It can be seeded from trading fees, DAO treasury, or investor capital.

**Q: Can the insurance fund be negative?**

A: No. The contract prevents this by tracking shortfalls in `totalSocializedLosses` instead.

---

## Summary

The insurance fund is Volera's **safety net** — it protects the broker pool from individual trader blowups and prevents socialized losses from impacting other users.

**Key Takeaways:**

✅ Three-tier waterfall: collateral → insurance → socialized  
✅ Fully on-chain and transparent  
✅ Admin-managed with event logging  
✅ Gas-efficient implementation  
✅ Critical for maintaining system solvency  

**Recommended Practices:**

- Maintain insurance fund at 5-10% of total collateral
- Monitor `Shortfall` events closely
- Alert on any non-zero `totalSocializedLosses`
- Use multisig for admin operations
- Replenish from trading fees automatically

The insurance fund is not just a feature — it's a **fundamental risk management tool** that keeps Volera resilient in volatile markets.
