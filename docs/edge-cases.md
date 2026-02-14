# Edge Case Safety Features

This document describes the 8 edge case safety features implemented in the Volera settlement contracts.

## 1. Circuit Breaker (CRITICAL) ✅

**Ticket:** VS-H006

**Purpose:** Auto-pause the vault if settlement volume spikes unexpectedly, preventing potential exploits or runaway settlements.

**Implementation:**
- Tracks all settlement volumes (both creditPnl and seizeCollateral) in a rolling time window
- Configurable threshold and window size (default: 1 hour window)
- When total volume within the window exceeds threshold, automatically pauses the vault
- Admin can configure via `configureCircuitBreaker(threshold, window)`
- `cleanupVolumeRecords()` allows gas optimization by removing old records

**Events:**
- `CircuitBreakerTriggered(uint256 volumeInWindow, uint256 threshold)`
- `CircuitBreakerConfigured(uint256 threshold, uint256 window)`

**Gas Optimization:** Old volume records outside the window should be periodically cleaned up using `cleanupVolumeRecords()`.

## 2. Underwater Account Handling (CRITICAL) ✅

**Ticket:** VS-H001

**Purpose:** Handle cases where a user's losses exceed their available collateral.

**Implementation:**
- New function `seizeCollateralCapped(user, amount, refId)` seizes up to available collateral
- Returns `(seized, shortfall)` where shortfall = amount that couldn't be seized
- Insurance fund (admin-managed) covers shortfalls when possible
- If insurance fund insufficient, tracks socialized losses
- Admin deposits to insurance fund via `depositInsuranceFund(amount)`
- Admin can withdraw via `withdrawInsuranceFund(amount)`

**Coverage priority:**
1. User's available collateral (seized first)
2. Insurance fund (covers shortfall if available)
3. Socialized losses (tracked in `totalSocializedLosses` if insurance insufficient)

**Events:**
- `Shortfall(address user, uint256 amount, uint256 coveredByInsurance, uint256 socialized)`
- `InsuranceFundDeposited(uint256 amount)`
- `InsuranceFundWithdrawn(uint256 amount)`

## 3. Multi-Collateral Haircuts (MEDIUM) ⏸️

**Status:** Design documented, implementation deferred

**Purpose:** Support multiple collateral types (ETH, BTC, etc.) with different haircuts for risk management.

**Design:**
- Add `mapping(address => CollateralConfig)` for different tokens
- Each config: haircut percentage, oracle for price conversion
- Aggregate collateral value = `sum(balance[token] * price[token] * (1 - haircut[token]))`
- See TODO comment in UnifiedAccountVault.sol for details

**Rationale:** Too complex for initial deployment. Single USDC collateral is sufficient for MVP.

## 4. Oracle Failover (MEDIUM) ✅

**Ticket:** VS-H004

**Purpose:** Gracefully degrade when oracles are temporarily unavailable, preventing settlement halts.

**Implementation:**
- OracleGuard tracks `lastValidPrice` and `lastValidTimestamp` on each successful fetch
- New `maxFallbackAge` config (default: 5 min) determines how long fallback is acceptable
- `getValidatedPrice()` returns `(price, timestamp, usedFallback)`:
  1. Try to fetch fresh price from oracle
  2. If fetch fails or price is stale/outside band → use last valid price
  3. If last valid price too old (beyond maxFallbackAge) → revert
- `updateReferencePrice()` updates both reference price and last valid price

**Configuration:**
- `setMaxFallbackAge(symbolId, maxAge)` - set how long fallback is acceptable

**Events:**
- `OracleFallbackUsed(bytes32 symbolId, uint256 price, uint256 age)` - emitted by caller when `usedFallback=true`

**External Functions:**
- `_fetchChainlinkPriceView()` and `_fetchPythPriceView()` - external wrappers to enable try/catch in internal logic

## 5. Timelock on Admin Actions (HIGH) ✅

**Ticket:** VS-H005

**Purpose:** Prevent instant admin key compromise by requiring 24h delay on critical admin changes.

**Implementation:**
- New `TimelockController.sol` contract
- Admin queues action → 24h delay → anyone can execute
- Critical functions (require timelock):
  - `setSettlement`
  - `setBroker`
  - `setAdmin`
  - `setOracleGuard`
  - `setTradingHoursGuard`
- Non-critical (no timelock):
  - `pause` / `unpause`
  - `setPerUserDailyCap` / `setGlobalDailyCap`
  - `setWithdrawalCooldownPeriod`
  - `configureCircuitBreaker`

**Usage:**
```solidity
// Queue an action
bytes memory data = abi.encodeWithSelector(vault.setSettlement.selector, newSettlement);
bytes32 actionId = timelock.queueAction(address(vault), data);

// Wait 24 hours...

// Execute
timelock.executeAction(actionId);
```

**Functions:**
- `queueAction(target, data)` - queue an action, returns actionId
- `executeAction(actionId)` - execute after delay
- `cancelAction(actionId)` - admin can cancel queued action
- `canExecute(actionId)` - check if executable
- `timeUntilExecutable(actionId)` - get remaining time

**Events:**
- `ActionQueued(bytes32 actionId, address target, bytes data, uint256 executeAfter)`
- `ActionExecuted(bytes32 actionId, address target, bytes data)`
- `ActionCancelled(bytes32 actionId)`

## 6. Withdrawal Cooldown (HIGH) ✅

**Ticket:** VS-H002

**Purpose:** Prevent flash loan attacks where attacker deposits, executes exploit, and withdraws in same block.

**Implementation:**
- Track `lastDepositTimestamp[user]` on every `depositCollateral()`
- `withdrawCollateral()` and `withdrawPnL()` enforce cooldown check
- Configurable cooldown period (default: 0 = disabled)
- Admin sets via `setWithdrawalCooldownPeriod(period)`

**Security Model:**
- Default: disabled (0) for backwards compatibility
- Recommended production: 1 block minimum (instant for legitimate users, prevents same-block attacks)
- Conservative: 15 minutes or more for high-value deployments

**Events:**
- `WithdrawalCooldownEnforced(address user, uint256 remainingTime)`
- `WithdrawalCooldownPeriodSet(uint256 period)`

**Errors:**
- `WithdrawalCooldownActive(uint256 remainingTime)` - reverts with time remaining

## 7. Broker Insolvency Queue (MEDIUM) ⏸️

**Status:** Design documented, implementation deferred

**Purpose:** Handle edge case where broker pool is insufficient to cover PnL withdrawals.

**Design:**
- Queue PnL withdrawals when vault USDC insufficient
- Broker deposits more funds → process queue
- Users can cancel queued withdrawals
- Careful accounting required: vault USDC = collateral + pnl + brokerPool + queuedWithdrawals

**Rationale:** Current design prevents this scenario (creditPnl checks brokerPool balance). Complex accounting needed for proper implementation. Deferred to post-MVP.

## 8. Missing Events (EASY) ✅

**Ticket:** VS-H005

**Purpose:** Complete event coverage for all state-changing admin functions for monitoring and compliance.

**Implementation:**
Added events for all admin setters:
- `PerUserDailyCapSet(uint256 cap)`
- `GlobalDailyCapSet(uint256 cap)`
- `SettlementSet(address settlement)`
- `BrokerSet(address broker)`
- `AdminSet(address admin)`
- `TradingHoursGuardSet(address guard)`
- `OracleGuardSet(address guard)`
- `WithdrawalCooldownPeriodSet(uint256 period)`

All events now emitted in their respective setter functions.

## Summary

| # | Feature | Status | Severity | Contract |
|---|---------|--------|----------|----------|
| 1 | Circuit Breaker | ✅ Implemented | CRITICAL | UnifiedAccountVault |
| 2 | Underwater Accounts | ✅ Implemented | CRITICAL | UnifiedAccountVault |
| 3 | Multi-Collateral Haircuts | ⏸️ Deferred | MEDIUM | - |
| 4 | Oracle Failover | ✅ Implemented | MEDIUM | OracleGuard |
| 5 | Timelock Controller | ✅ Implemented | HIGH | TimelockController |
| 6 | Withdrawal Cooldown | ✅ Implemented | HIGH | UnifiedAccountVault |
| 7 | Broker Insolvency Queue | ⏸️ Deferred | MEDIUM | - |
| 8 | Missing Events | ✅ Implemented | EASY | UnifiedAccountVault |

**Total:** 6/8 implemented, 2 deferred with design documented

## Deployment Checklist

Before deploying to production:

1. ✅ All implemented features tested (81/81 tests passing)
2. ⚠️ Configure circuit breaker threshold and window for production volumes
3. ⚠️ Set withdrawal cooldown period (recommended: 1 block minimum)
4. ⚠️ Fund insurance pool with appropriate reserves
5. ⚠️ Deploy TimelockController and transfer admin to it
6. ⚠️ Configure oracle failover max age (recommended: 5 minutes)
7. ⚠️ Set up monitoring for CircuitBreakerTriggered events
8. ⚠️ Set up monitoring for Shortfall events (socialized losses)

## Future Work

- Implement multi-collateral support with haircuts (VS-H003)
- Implement withdrawal queue for broker insolvency edge cases (VS-H007)
- Add MEV protection for settlements
- Implement governance timelock for protocol upgrades
