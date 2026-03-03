# Anduin — Sprint 1 Tickets
# Focus: Deploy-ready + Multi-asset collateral + Batch settlement

Last updated: 2026-02-28
Scope: Everything needed to deploy to Base Sepolia and run a real broker demo

---

## BLOCKER

### AND-000: Fund Deployer Wallet
**Owner:** Max | **Estimate:** Manual | **Status:** BLOCKED (waiting on Max)

Fund the deployer EOA with ~0.1 ETH on Base Sepolia (free from faucet).
- Faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
- Needed before any contract deployment

---

## BLOCK A — Core Contracts

### AND-001: batchSettle() on UnifiedAccountVault
**Priority:** HIGH | **Estimate:** 0.5 day | **Status:** TODO

**Background:**
Currently each settlement = 1 on-chain transaction. Since all assets are in the same vault,
we can process N settlements in a single transaction by accepting an array.

**Implementation:**
```solidity
struct Settlement {
    address user;
    int256 amount;      // positive = credit, negative = seize
    bytes32 refId;
    uint256 symbolId;
}

function batchSettle(Settlement[] calldata settlements) external onlySettlementRole {
    for (uint i = 0; i < settlements.length; i++) {
        Settlement calldata s = settlements[i];
        require(!usedRefIds[s.refId], "duplicate refId");
        usedRefIds[s.refId] = true;
        if (s.amount >= 0) {
            balances[s.user] += uint256(s.amount);
        } else {
            uint256 debit = uint256(-s.amount);
            require(balances[s.user] >= debit, "insufficient balance");
            balances[s.user] -= debit;
        }
        emit Settled(s.user, s.amount, s.refId, s.symbolId);
    }
}
```

**Edge cases:**
- [ ] Empty array: no-op, no revert
- [ ] Duplicate refId within same batch: revert entire batch (atomicity)
- [ ] Duplicate refId from previous batch: revert
- [ ] Partial insufficient balance: revert entire batch
- [ ] Array too large (gas limit): add max batch size constant (e.g. 500)
- [ ] Mixed credits and debits in same batch: must work
- [ ] Zero amount settlement: allow (idempotent no-op, refId consumed)
- [ ] Paused contract: revert entire batch
- [ ] Guards (oracle/trading hours): check once before loop or per-settlement? → per-settlement

**Tests required:**
- [ ] Happy path: batch of 10 mixed credits/debits
- [ ] Empty batch
- [ ] Duplicate refId mid-batch reverts whole tx
- [ ] Insufficient balance mid-batch reverts whole tx
- [ ] Max batch size boundary
- [ ] Gas benchmark: 1 vs 10 vs 100 vs 500 settlements

**Files:**
- `contracts/src/UnifiedAccountVault.sol`
- `contracts/test/UnifiedAccountVault.t.sol`

---

### AND-002: USDx Collateral Accounting — Multi-Asset Vault
**Priority:** HIGH | **Estimate:** 2 days | **Status:** TODO

**Background:**
Today the vault only accepts USDC. Max's model: user deposits ETH (or WBTC, USDT etc.)
on Base, system credits them an internal accounting unit (USDx) at current USD value,
revalued every ~10 seconds via Chainlink. USDx is NOT a token — it's internal accounting.

User's USDx balance = their purchasing power across any integrated platform
(Hyperliquid, Polymarket, eToro, etc.)

**New contract: MultiCollateralVault.sol**

```solidity
struct CollateralConfig {
    address token;          // ERC20 address (or address(0) for native ETH)
    address chainlinkFeed;  // USD price feed
    uint8 decimals;
    uint16 ltvBps;          // loan-to-value, e.g. 8000 = 80%
    uint16 liquidationBps;  // liquidation threshold, e.g. 8500 = 85%
    bool enabled;
}

// Internal accounting — NOT a token
mapping(address => uint256) public usdxBalance;        // 18 decimals, USD value
mapping(address => CollateralBalance[]) public collateral; // raw token holdings

function deposit(address token, uint256 amount) external;
function depositETH() external payable;
function withdraw(address token, uint256 amount) external;
function getUsdxBalance(address user) external view returns (uint256);
function revalue(address user) external;               // called by keeper every ~10s
function batchRevalue(address[] calldata users) external; // keeper efficiency
function liquidate(address user) external;             // when LTV breached
```

**Revaluation logic:**
1. For each collateral token user holds
2. Fetch Chainlink price (must be < 60s stale)
3. Compute USD value × LTV ratio
4. Update usdxBalance
5. Emit RevalueEvent(user, oldBalance, newBalance, timestamp)

**Edge cases:**
- [ ] Oracle stale (>60s): freeze revaluation, do not update balance downward
- [ ] Oracle returns 0: revert revalue call
- [ ] ETH deposit: wrap as WETH internally or track separately
- [ ] Deposit unsupported token: revert
- [ ] Deposit 0 amount: revert
- [ ] Withdraw more than deposited: revert
- [ ] Withdraw while balance is used as margin: revert or partial allow
- [ ] LTV breach during revalue: flag for liquidation, do NOT auto-seize yet
- [ ] Liquidation: transfer collateral to insurance fund, zero usdxBalance
- [ ] Price spike up: update usdxBalance up immediately
- [ ] Price crash down: update usdxBalance down, trigger liquidation check
- [ ] Multiple collateral tokens: sum all USD values
- [ ] Reentrancy on withdraw: use checks-effects-interactions + ReentrancyGuard
- [ ] Flash loan attack on deposit+revalue+withdraw: timelock or block-delay

**Keeper service (off-chain):**
- Poll Chainlink every 10s
- Call batchRevalue() for all active users
- Flag users below liquidation threshold
- Call liquidate() for underwater positions

**Tests required:**
- [ ] Deposit USDC, check usdxBalance = amount × LTV
- [ ] Deposit ETH, check usdxBalance = ETH price × LTV
- [ ] Deposit WBTC, check usdxBalance = BTC price × LTV
- [ ] Revalue after price increase
- [ ] Revalue after price decrease → liquidation flag
- [ ] Stale oracle: revalue reverts
- [ ] Liquidation flow
- [ ] Withdraw full balance
- [ ] Withdraw partial
- [ ] Withdraw while underwater: revert
- [ ] Reentrancy attempt on withdraw

**Files:**
- New: `contracts/src/MultiCollateralVault.sol`
- New: `contracts/src/IChainlinkFeed.sol`
- New: `contracts/test/MultiCollateralVault.t.sol`
- New: `services/src/keeper.ts` (revalue loop)

---

### AND-003: Deployment Scripts
**Priority:** HIGH | **Estimate:** 0.5 day | **Status:** TODO

Write Foundry deployment scripts for Base Sepolia:

**Scripts:**
```
contracts/script/
  Deploy.s.sol              — deploy all contracts in order
  DeployMockUSDC.s.sol      — testnet only
  DeployUnifiedVault.s.sol
  DeployMultiCollateral.s.sol
  DeploySecurityTokenVault.s.sol
  DeployOracleGuard.s.sol
  DeployTradingHoursGuard.s.sol
  SetupRoles.s.sol          — grant settlement/admin roles
  Verify.s.sol              — verify all on Basescan
```

Each script:
- Reads config from env (RPC, private key, existing addresses)
- Logs deployed addresses
- Saves addresses to `deployments/base-sepolia.json`
- Verifies on Basescan

**Edge cases:**
- [ ] Already deployed: check if address exists before redeploying
- [ ] Role setup idempotent: `grantRole` is idempotent, safe to rerun
- [ ] Missing env vars: fail fast with clear error message

**Files:**
- `contracts/script/*.s.sol`
- `deployments/base-sepolia.json`

---

## BLOCK B — Services & Off-chain

### AND-004: SecurityTokenVault Service Layer
**Priority:** HIGH | **Estimate:** 1 day | **Status:** TODO

The issuance product (DVP settlement) has contracts and tests but zero off-chain plumbing.

**New service: security-bridge.ts**
```typescript
// Mirrors broker's DVP instructions to SecurityTokenVault
interface DVPInstruction {
  type: 'BUY' | 'SELL' | 'TOKENIZE' | 'DETOKENIZE';
  user: Address;
  tokenAddress: Address;
  amount: bigint;
  usdcAmount: bigint;
  refId: string;
}

class SecurityBridge {
  async executeDVP(instruction: DVPInstruction): Promise<TxHash>
  async processBatch(instructions: DVPInstruction[]): Promise<TxHash[]>
  async getTokenBalance(user: Address, token: Address): Promise<bigint>
  async getPendingInstructions(): Promise<DVPInstruction[]>
}
```

**Update indexer.ts:**
- Listen to SecurityTokenVault events (BuySideSettled, SellSideSettled, etc.)
- Store in `security_settlements` table

**Update recon.ts:**
- Compare broker DVP records vs on-chain token balances
- Alert on mismatches

**Update api.ts:**
- `GET /security/balances/:user`
- `GET /security/settlements`
- `POST /security/dvp` — submit DVP instruction

**Edge cases:**
- [ ] DVP instruction arrives before token is registered: queue, retry
- [ ] Insufficient USDC in vault for BUY: reject with clear error
- [ ] Token daily mint limit hit: reject, alert broker
- [ ] Duplicate refId: reject
- [ ] Bridge tx fails (gas): retry with backoff, max 3 attempts
- [ ] Indexer misses event (reorg): replay from last checkpoint

**Files:**
- New: `services/src/security-bridge.ts`
- Updated: `services/src/indexer.ts`
- Updated: `services/src/recon.ts`
- Updated: `services/src/api.ts`

---

### AND-005: Keeper Service
**Priority:** HIGH | **Estimate:** 1 day | **Status:** TODO

Automated on-chain maintenance — runs as a background service.

**Responsibilities:**
1. **Revalue collateral** — call `batchRevalue()` every 10s for all active users
2. **Liquidations** — monitor LTV, call `liquidate()` for underwater positions
3. **Batch settlements** — accumulate settlements from brokers, flush every N seconds or M items
4. **Oracle health** — alert if Chainlink feed goes stale

```typescript
class KeeperService {
  async runRevalueLoop(): Promise<void>      // every 10s
  async runLiquidationCheck(): Promise<void> // every 30s
  async runSettlementFlush(): Promise<void>  // every 5s or 50 items
  async checkOracleHealth(): Promise<void>   // every 60s
}
```

**Edge cases:**
- [ ] Keeper wallet runs out of gas: alert + pause operations
- [ ] Revalue call reverts (stale oracle): skip + alert, do not crash loop
- [ ] Liquidation fails (gas spike): retry once, then alert
- [ ] Multiple keepers running simultaneously: use on-chain nonce locking or off-chain mutex
- [ ] Service restart mid-batch: replay from DB queue

**Files:**
- New: `services/src/keeper.ts`
- Updated: `services/src/index.ts` (register keeper loops)

---

### AND-006: Admin Panel Auth + Operations API
**Priority:** HIGH | **Estimate:** 1 day | **Status:** TODO

Currently admin panel is open to anyone. Settlement engine writes nothing to DB.

**Auth:**
- Simple API key auth for now (full OAuth overkill for MVP)
- `X-Admin-Key` header checked on all `/admin/*` routes
- Key stored in env, rotate manually

**Operations API endpoints:**
```
POST /admin/settle          — trigger manual settlement
POST /admin/pause           — pause vault (emergency)
POST /admin/unpause         — unpause vault
GET  /admin/positions       — all user positions
GET  /admin/recon           — latest recon report
POST /admin/liquidate/:user — manual liquidation trigger
GET  /admin/health          — service health check
GET  /admin/oracle          — oracle feed status
```

**DB integration:**
- All settlements written to `settlements` table on execution
- Recon diffs written to `recon_snapshots` table
- Liquidations written to `liquidations` table

**Edge cases:**
- [ ] Missing API key: 401
- [ ] Invalid API key: 401 (same response, don't distinguish)
- [ ] Pause while settlement in flight: complete current batch, then pause
- [ ] Manual liquidation on solvent user: revert with clear error

**Files:**
- Updated: `services/src/api.ts`
- Updated: `services/src/db.ts`
- Updated: `services/src/admin/index.html`

---

## BLOCK C — Testing & Review

### AND-007: Integration Test Suite
**Priority:** HIGH | **Estimate:** 1 day | **Status:** TODO

End-to-end tests covering the full flow on a local Anvil fork.

**Scenarios:**
1. User deposits USDC → trade → PnL settlement → withdraw
2. User deposits ETH → revalue → trade → PnL settlement
3. User deposits ETH → price drops → liquidation
4. Broker submits batch of 100 settlements → verify all balances
5. DVP: broker tokenizes position → user receives token → user sells token
6. Oracle goes stale → revalue frozen → keeper alerts
7. Double-settlement attempt (same refId) → rejected

**Files:**
- New: `contracts/test/Integration.t.sol`
- New: `services/test/e2e.test.ts`

---

### AND-008: Code Review Checklist
**Priority:** HIGH | **Estimate:** 0.5 day | **Status:** TODO (run before any deployment)

Before deploying to Base Sepolia, verify:

**Contracts:**
- [ ] No unchecked external calls
- [ ] All state changes before external calls (CEI pattern)
- [ ] ReentrancyGuard on all withdrawal functions
- [ ] Access control on every state-changing function
- [ ] No floating pragma (pin to 0.8.24)
- [ ] Events emitted for every state change
- [ ] No tx.origin usage
- [ ] Emergency pause covers all settlement paths
- [ ] Admin functions have 2-step ownership transfer

**Services:**
- [ ] No private keys in logs
- [ ] All DB queries use parameterized statements (no SQL injection)
- [ ] API key not logged
- [ ] Retry logic has max attempts + backoff
- [ ] No infinite loops without circuit breakers

**Files:**
- New: `docs/REVIEW-CHECKLIST.md`

---

## Ticket Summary

| ID | Title | Priority | Est | Blocks |
|----|-------|----------|-----|--------|
| AND-000 | Fund deployer wallet | BLOCKER | — | Everything |
| AND-001 | batchSettle() | HIGH | 0.5d | AND-005 |
| AND-002 | MultiCollateralVault | HIGH | 2d | AND-005 |
| AND-003 | Deployment scripts | HIGH | 0.5d | Deploy |
| AND-004 | SecurityTokenVault services | HIGH | 1d | — |
| AND-005 | Keeper service | HIGH | 1d | AND-001, AND-002 |
| AND-006 | Admin auth + ops API | HIGH | 1d | — |
| AND-007 | Integration tests | HIGH | 1d | All above |
| AND-008 | Code review checklist | HIGH | 0.5d | Deploy |
| **Total** | | | **~7.5 days** | |

---

## What we're NOT building (and why)
- **Private settlements** — Base has no native privacy. Net PnL opacity + opaque refIds is sufficient for MVP. ZK is a future enterprise feature.
- **Merkle proof batch settlement** — over-engineered. Simple array function (AND-001) achieves same result.
- **Cross-venue prime layer** — post first signed client.
