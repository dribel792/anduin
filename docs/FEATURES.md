# Anduin Features

Comprehensive feature list for instant on-chain settlement infrastructure.

---

## Core Settlement

**Instant PnL settlement for realized profits and losses.**

When a user closes a position on a connected venue, Anduin settles the PnL to their on-chain balance in seconds. Winners receive USDC immediately to their wallet; losers have collateral seized and returned to the broker pool.

**Key Capabilities:**
- **Collateral/PnL split** — User funds separated into at-risk collateral and never-seizable winnings
- **refId deduplication** — Every settlement has a unique reference ID preventing double-settlement
- **Instant execution** — Settlement completes in seconds, not hours or days
- **Atomic operations** — Settlement succeeds completely or reverts entirely (no partial states)

**Status:** ✅ Built  
**Contracts:** `UnifiedAccountVault.sol`  
**Tests:** 58 passing (UnifiedAccountVault test suite)

---

## Self-Governed Vaults

**Smart contract custody with no admin override on withdrawals.**

User funds are held in self-governed smart contracts, not broker omnibus accounts. Users can always withdraw their available balance (collateral minus margin in use) without requiring admin approval.

**Key Capabilities:**
- **No custodian** — Protocol governs funds, not any single party
- **Always withdrawable** — Users withdraw available balance 24/7
- **On-chain auditable** — All balances, settlements, and transactions verifiable on-chain
- **Transparent insurance** — Insurance pool balance publicly visible
- **Role-based permissions** — Narrowly scoped roles (settlement, broker, admin) with explicit boundaries

**Status:** ✅ Built  
**Contracts:** `UnifiedAccountVault.sol`, `HubVault.sol`, `MarginVault.sol`  
**Tests:** Full suite covering deposit, withdraw, permission enforcement

---

## Insurance Waterfall

**Multi-layer safety net for underwater accounts.**

When a user's trading loss exceeds their deposited collateral, Anduin's insurance waterfall activates to protect the broker/venue from shortfalls.

**Waterfall (in order):**
1. **User collateral** — Seize all available user collateral first
2. **Insurance pool** — Cover remaining shortfall from insurance reserves
3. **Broker stake** — Use broker's deposited stake (skin in the game)
4. **Socialized loss** — Track remaining loss for admin resolution (last resort)

**Funding:**
- Insurance premiums (0.5-2% annually on user deposits)
- Settlement fees
- Direct deposits from Anduin or partners
- Netting fees

**Status:** ✅ Built  
**Contracts:** `UnifiedAccountVault.sol` (insurance fund functions)  
**Tests:** Shortfall coverage, insurance depletion, waterfall logic  
**Docs:** [INSURANCE_FUND.md](INSURANCE_FUND.md)

---

## Cross-Broker Netting

**Capital efficiency through obligation netting between venues.**

Instead of gross settlement (venue A pays venue B $100K, venue B pays venue A $85K), Anduin nets obligations into a single transfer (venue A pays venue B $15K). Reduces capital requirements by 60-80%.

**Key Capabilities:**
- **Configurable netting windows** — Hourly, daily, or on-demand
- **Guarantee deposits** — Each venue deposits collateral to participate
- **Default fund** — Shared safety pool for venue defaults
- **Atomic execution** — All net transfers execute on-chain simultaneously
- **Deduplication** — refId prevents duplicate netting rounds

**Example:**
```
Gross obligations:
  Kraken → Bybit: $100K
  Bybit → Kraken: $85K
  
Net settlement:
  Kraken → Bybit: $15K
  
Capital saved: $170K (92%)
```

**Status:** ✅ Built (V2 architecture)  
**Contracts:** `ClearingVault.sol`, `MarginVault.sol`  
**Tests:** Netting logic, guarantee deposit enforcement, default handling

---

## Cross-Venue Portfolio Margin

**One deposit, trade on multiple venues with unified risk management.**

Users deposit once into Anduin's HubVault, and their equity appears on all connected venues. When they profit on one venue and lose on another, Anduin automatically adjusts balances to reflect portfolio-level risk—reducing margin requirements by 40-70% compared to siloed collateral.

**Key Capabilities:**
- **Single deposit** — Deposit $50K once, trade with $50K on multiple venues simultaneously
- **Real-time equity engine** — Aggregates positions across all venues, recalculates equity in real-time
- **Event-driven updates** — Equity recalculation triggered by price moves, trades, deposits, not just timers
- **50% haircut** — Conservative haircut on cross-venue positive PnL to protect insurance pool
- **Overspend detection** — Prevents users from opening more positions than collateral allows
- **Automatic intervention** — Reduces venue balances to trigger venue's own liquidation when needed

**Example:**
```
Without Anduin:
- Deposit $50K on Kraken + $50K on Bybit = $100K total
- Open $40K position on each venue
- BTC moves 10%: Kraken +$4K, Bybit -$4K
- Bybit balance: $46K (close to liquidation)

With Anduin:
- Deposit $50K once
- Shown as $50K on both venues
- Same positions
- BTC moves 10%:
  - Bybit equity = $50K - $4K + 50% × $4K = $48K ✅
  - Kraken equity = $50K + $4K - 50% × $4K = $52K ✅
- Both venues stay healthy automatically
```

**Status:** 🚧 Planned (V3 architecture)  
**Contracts:** `HubVault.sol` (designed, implementation pending)  
**Services:** Keeper service with equity engine, venue API client  
**Docs:** [ARCHITECTURE.md](ARCHITECTURE.md#how-it-works-v3-architecture)

---

## Reinsurance

**Insurance coverage for venue liquidation shortfalls.**

When a venue liquidates a user and the user's collateral is insufficient to cover the loss, Anduin's insurance pool covers the shortfall. The venue is made whole—no loss for the exchange.

**Key Capabilities:**
- **Venue protection** — Venues never lose money on user liquidations
- **Cross-venue collateral** — User's collateral from other venues can cover shortfalls
- **Transparent waterfall** — User collateral → insurance pool → socialized loss
- **Automatic settlement** — Keeper detects shortfall, processes claim, transfers USDC to venue
- **On-chain tracking** — All insurance claims recorded on-chain with refId

**Pitch to venues:**  
*"Connect to Anduin → your liquidation shortfalls are covered"*

**Status:** 🚧 Planned (V3 architecture)  
**Contracts:** `HubVault.sol` (`processShortfall` function)  
**Services:** Keeper service monitors venue liquidations, processes claims

---

## Exchange Adapters

**Modular integration layer for 8+ trading venues.**

Anduin connects to multiple exchanges via a standardized adapter pattern. Each adapter normalizes venue-specific APIs into a common interface for the keeper service.

**Supported Venues:**
1. **Bybit** — WebSocket for positions, REST for balance updates
2. **Kraken** — WebSocket for positions, REST for balance updates
3. **OKX** — USDT/Coin perpetuals
4. **Bitget** — USDT futures
5. **MEXC** — Perpetuals
6. **KuCoin** — Futures (WebSocket with token auth)
7. **HTX** — Linear swaps (WebSocket with gzip compression)
8. **MetaTrader 5** — Forex, gold, indices (REST via EA bridge)

**Key Capabilities:**
- **Price aggregation** — Best bid/ask across all venues in real-time
- **Position monitoring** — Automatic settlement when positions close
- **Auto-reconnection** — Exponential backoff on WebSocket disconnects
- **Idempotent settlement** — `refId = keccak256(venue + positionId)` prevents duplicates
- **Easy onboarding** — Add new exchange in <100 lines of code

**Status:** ✅ Built  
**Services:** `services/integrations/` (8 venue adapters)  
**Docs:** [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md)

---

## Security Token DVP

**Atomic delivery vs payment for tokenized securities.**

Enables "non-tokenized by default, tokenized on-demand" model. Users trade off-chain positions on the platform, and only tokenize when they want to withdraw their position to DeFi.

**Flows:**
- **BUY** — User locks USDC → receives security token in wallet
- **SELL** — User locks token → receives USDC
- **TOKENIZE** — Off-chain position → token delivered to wallet (no payment)
- **DETOKENIZE** — Token deposited → off-chain position restored

**Key Capabilities:**
- **Atomic execution** — Token and payment transfer simultaneously (no partial states)
- **On-chain settlement** — All DVP transactions on-chain and auditable
- **Flexible tokenization** — Only tokenize when needed (reduces on-chain overhead)
- **refId deduplication** — Prevents double-execution of DVP orders

**Status:** ✅ Built  
**Contracts:** `SecurityTokenVault.sol`, `AnduinSecurity.sol` (ERC20 security token)  
**Tests:** DVP flows (buy, sell, tokenize, detokenize)

---

## Batch Settlements

**Off-chain netting with Merkle proofs for gas savings.**

For high-frequency traders, batch settlements aggregate multiple trades into a single on-chain transaction using Merkle trees. Users claim their net PnL when convenient instead of settling every trade individually.

**Key Capabilities:**
- **5-minute settlement windows** — Accumulate trades, settle in batches
- **Off-chain netting** — Calculate net PnL off-chain, publish Merkle root on-chain
- **Merkle proof claims** — Users claim their settlement with a Merkle proof
- **88-96% gas savings** — One transaction per batch vs. one per trade
- **Lazy execution** — Users claim when they want, not forced settlement
- **Fraud proofs** — Anyone can challenge invalid Merkle roots

**Example:**
```
Without batching:
- 100 trades → 100 on-chain transactions → $50 gas cost

With batching:
- 100 trades → 1 Merkle root + 1 claim → $2.50 gas cost
- Savings: 95%
```

**Status:** 🏗️ Designed  
**Contracts:** `BatchSettlementVault.sol` (designed, not implemented)  
**Docs:** [BATCH_SETTLEMENTS.md](BATCH_SETTLEMENTS.md)

---

## Private Settlements

**Commitment-based settlement with hidden amounts.**

For large traders who don't want settlement amounts visible on public blockchain. Uses cryptographic commitments to hide amounts while maintaining verifiability.

**Key Capabilities:**
- **Commitment-based** — Settlement amounts hidden in commitments
- **Encrypted memos** — User can decrypt to verify their settlement
- **Regulator-auditable** — Anduin can prove settlement amounts to regulators
- **On-chain verifiability** — Commitments recorded on-chain for transparency
- **refId deduplication** — Same anti-replay protection as public settlements

**Status:** 🏗️ Designed  
**Contracts:** `PrivateSettlementVault.sol` (designed, not implemented)  
**Docs:** [PRIVATE_SETTLEMENTS.md](PRIVATE_SETTLEMENTS.md)

---

## Safety

**Enterprise-grade safety mechanisms to protect against edge cases and attacks.**

Multiple layers of protection ensure the system remains stable under stress, prevents runaway settlements, and handles oracle failures gracefully.

**Key Features:**

### Circuit Breaker
Auto-pause settlements if volume spikes beyond configured threshold. Prevents runaway settlements from exploits or bugs.

**Status:** ✅ Built

### Oracle Failover
Graceful degradation to last-known-good price (max 5 min age) if oracle feed fails. Prevents liquidations during temporary oracle outages.

**Status:** ✅ Built  
**Contracts:** `OracleGuard.sol`

### Timelock Controller
24-hour delay on critical admin changes (e.g., changing settlement role). Prevents instant key compromise from draining funds.

**Status:** ✅ Built

### Withdrawal Cooldown
Configurable delay on withdrawals (default: disabled for UX). Can be enabled to prevent flash loan attacks.

**Status:** ✅ Built

### Trading Hours Guard
Enforces trading hours (e.g., no trading on weekends), earnings blackouts, and emergency halts for security tokens.

**Status:** ✅ Built  
**Contracts:** `TradingHoursGuard.sol`

### Missing Events Coverage
Complete event coverage for all state changes. Ensures monitoring and compliance systems have full visibility.

**Status:** ✅ Built

**Docs:** [edge-cases.md](edge-cases.md)

---

## Monitoring

**Real-time visibility into system health and user activity.**

Comprehensive monitoring infrastructure for users, venues, and Anduin operations.

### Portfolio Dashboard (User-Facing)
- Cross-venue portfolio view
- Real-time equity, positions, and PnL
- Margin health indicator
- Deposit/withdraw interface
- Settlement history

**Status:** ✅ Built  
**Tech:** Next.js, wagmi, viem

### Venue Dashboard (Venue-Facing)
- Users connected via Anduin
- Settlement status and history
- Insurance claims tracking
- API health monitoring

**Status:** 🏗️ Designed

### Admin Panel (Anduin Ops)
- Venue onboarding and removal
- Insurance pool management
- Risk parameter configuration (haircuts, thresholds)
- Emergency controls (pause, circuit breaker)

**Status:** ✅ Built  
**Tech:** Next.js, Express API

### Alerting System
- **User margin warnings** — Email/push notifications when margin health deteriorates
- **Venue balance update failures** — Alerts when venue API calls fail
- **Insurance pool depletion** — Warnings when insurance reserves drop below threshold
- **Keeper health monitoring** — Uptime checks for keeper service

**Status:** 🏗️ Designed  
**Planned:** Email, Telegram, PagerDuty integrations

---

## Multi-Collateral Support

**Accept ETH, WBTC, and other tokens as collateral.**

Expand beyond USDC-only collateral to support major crypto assets with oracle-based margin calculation.

**Key Capabilities:**
- **Oracle-based margin** — Chainlink price feeds for real-time valuation
- **LTV ratios per token** — ETH 80%, WBTC 75%, etc.
- **Automated liquidations** — Liquidate positions when collateral value drops
- **Margin calls** — Alert users when LTV ratio < 120%
- **Haircuts for volatility** — More volatile assets = lower LTV

**Status:** 🚧 Planned  
**Contracts:** Multi-collateral vault (design complete)  
**Docs:** [MULTI_COLLATERAL.md](MULTI_COLLATERAL.md)

---

## Summary Table

| Feature | Status | Contracts | Documentation |
|---------|--------|-----------|---------------|
| Core Settlement | ✅ Built | UnifiedAccountVault | README |
| Self-Governed Vaults | ✅ Built | UnifiedAccountVault, HubVault, MarginVault | ARCHITECTURE |
| Insurance Waterfall | ✅ Built | UnifiedAccountVault | INSURANCE_FUND |
| Cross-Broker Netting | ✅ Built | ClearingVault, MarginVault | ARCHITECTURE |
| Cross-Venue Portfolio Margin | 🚧 Planned | HubVault (designed) | ARCHITECTURE |
| Reinsurance | 🚧 Planned | HubVault (designed) | ARCHITECTURE |
| Exchange Adapters | ✅ Built | N/A (services layer) | EXCHANGE_INTEGRATIONS |
| Security Token DVP | ✅ Built | SecurityTokenVault | README |
| Batch Settlements | 🏗️ Designed | BatchSettlementVault (designed) | BATCH_SETTLEMENTS |
| Private Settlements | 🏗️ Designed | PrivateSettlementVault (designed) | PRIVATE_SETTLEMENTS |
| Safety (Circuit Breaker, Oracle Failover, etc.) | ✅ Built | OracleGuard, TradingHoursGuard | edge-cases |
| Monitoring (Dashboard, Admin Panel, Alerting) | 🏗️ Partial | N/A (frontend/services) | OPERATIONAL_INFRASTRUCTURE |
| Multi-Collateral Support | 🚧 Planned | Multi-collateral vault (designed) | MULTI_COLLATERAL |

**Legend:**
- ✅ Built — Contracts deployed or services operational
- 🏗️ Designed — Architecture complete, implementation pending
- 🚧 Planned — Design in progress or deferred to post-MVP
