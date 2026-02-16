# Anduin

**Instant on-chain settlement infrastructure for crypto exchanges and brokers.**

Anduin enables instant, verifiable PnL settlement for derivatives trading. Users deposit collateral once into a self-governed smart contract, their equity appears on all connected venues, and realized profits settle to their wallet in seconds. Cross-venue portfolio margin reduces capital requirements by 40-70%.

---

## What Anduin Does

When a trader closes a position on a connected exchange, Anduin settles the PnL to their on-chain balance instantly:

- **Win:** USDC credited to trader's PnL balance (withdrawable immediately)
- **Loss:** Collateral seized and returned to broker pool
- **Cross-venue:** One deposit trades on multiple venues with unified risk management

**The Key Insight:** Anduin splits user funds into two buckets:
- **Collateral** — At-risk capital that can be seized on losses
- **PnL** — Winnings that are never seizable, only withdrawable

This separation means traders always keep their profits, and venues always recover their losses. Enforced in the smart contract—no trust required.

---

## Architecture (V3)

Anduin V3 provides real-time cross-venue portfolio margin via **HubVault** (global smart contract) + **Keeper** (equity engine):

```
User deposits $50K into HubVault (on-chain)
         ↓
Keeper propagates $50K to all venues via API
         ↓
User trades on Kraken AND Bybit simultaneously
         ↓
Keeper aggregates positions, recalculates equity in real-time
         ↓
Venues see updated balances reflecting portfolio-level risk
         ↓
When user profits/loses: instant settlement to HubVault
```

**How venues integrate:**
- Provide REST API to set user balance
- Provide WebSocket feed for real-time positions
- Provide API to freeze new orders (overspend protection)
- Webhook to notify Anduin of liquidations

No smart contract integration required—just REST APIs.

---

## Smart Contracts

All contracts written in Solidity 0.8.24, deployed on Base (L2).

| Contract | Purpose | Status |
|----------|---------|--------|
| **UnifiedAccountVault** | Single-venue PnL settlement (V1 MVP) | ✅ 58 tests |
| **HubVault** | Cross-venue portfolio margin (V3) | 🏗️ Designed |
| **MarginVault** | Per-venue settlement (V2 on-chain alternative) | 🏗️ Designed |
| **ClearingVault** | Cross-venue netting | 🏗️ Designed |
| **SecurityTokenVault** | Atomic delivery vs payment for security tokens | ✅ Built |
| **BatchSettlementVault** | Merkle-proof netting for HFT (88-96% gas savings) | 🏗️ Designed |
| **PrivateSettlementVault** | Commitment-based hidden amounts | 🏗️ Designed |
| **OracleGuard** | Price validation + oracle failover | ✅ Built |
| **TradingHoursGuard** | Trading hours, halts, earnings blackouts | ✅ Built |
| **AnduinSecurity** | ERC20 security token | ✅ Built |

**Test Coverage:** 203 tests passing

---

## Exchange Integrations

**8 venue adapters** built with modular integration pattern:

1. **Bybit** — WebSocket positions, REST balance updates
2. **Kraken** — WebSocket positions, REST balance updates
3. **OKX** — USDT/Coin perpetuals
4. **Bitget** — USDT futures
5. **MEXC** — Perpetuals
6. **KuCoin** — Futures (WebSocket with token auth)
7. **HTX** — Linear swaps (WebSocket with gzip)
8. **MetaTrader 5** — Forex, gold, indices (REST via EA bridge)

**Capabilities:**
- Real-time price aggregation (best bid/ask across all venues)
- Automatic settlement when positions close
- Auto-reconnection with exponential backoff
- Idempotent settlement (refId deduplication)

**[Full Integration Docs →](docs/EXCHANGE_INTEGRATIONS.md)**

---

## Key Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Core Settlement** | ✅ Built | Instant PnL settlement, collateral/PnL split, refId dedup |
| **Self-Governed Vaults** | ✅ Built | No custodian, always withdrawable, on-chain auditable |
| **Insurance Waterfall** | ✅ Built | User collateral → insurance pool → broker stake → socialized loss |
| **Cross-Broker Netting** | ✅ Built | 60-80% capital reduction, configurable windows |
| **Cross-Venue Portfolio Margin** | 🚧 Planned | (V3) One deposit trade everywhere, 50% haircut, real-time equity engine |
| **Reinsurance** | 🚧 Planned | (V3) Covers venue liquidation shortfalls |
| **Exchange Adapters** | ✅ Built | 8 venues, modular adapter pattern, REST + WebSocket |
| **Security Token DVP** | ✅ Built | Atomic delivery vs payment, tokenize/detokenize |
| **Batch Settlements** | 🏗️ Designed | Merkle proof netting, 88-96% gas savings |
| **Private Settlements** | 🏗️ Designed | Commitment-based hidden amounts |
| **Safety** | ✅ Built | Circuit breaker, oracle failover, timelock governance, trading hours guard |
| **Monitoring** | 🏗️ Partial | Dashboard, admin panel, alerting |

**[Full Feature List →](docs/FEATURES.md)**

---

## Safety Features

Anduin implements enterprise-grade safety mechanisms:

| Feature | Description |
|---------|-------------|
| **Circuit Breaker** | Auto-pause if settlement volume spikes (prevents runaway settlements) |
| **Oracle Failover** | Graceful degradation to last-known-good price (max 5 min age) |
| **Timelock Controller** | 24h delay on critical admin changes (prevents instant key compromise) |
| **Withdrawal Cooldown** | Configurable delay prevents flash loan attacks (default: disabled) |
| **Insurance Fund** | Multi-layer waterfall for underwater accounts |
| **Socialized Loss Tracking** | Transparent handling of extreme shortfalls |

**[Full Safety Docs →](docs/edge-cases.md)**

---

## Revenue Model

| Revenue Stream | Pricing |
|---------------|---------|
| Settlement fees | 1-5 bps on realized PnL |
| Insurance premium | 0.5-2% annually on user deposits |
| Equity update service | $1-5/user/month to venues |
| Netting fees | 0.5-1 bps of netted amount |
| Integration fee | $25K-100K per venue (one-time) |

**Example Revenue (Year 1):**
- 5 venues, 10K users, $500M deposits, $50B monthly volume
- **Total Annual Revenue: ~$8M**

---

## Product Tiers

| Product | Description | Target |
|---------|-------------|--------|
| **V1 - UnifiedAccountVault** | Single-venue instant settlement | Entry-level brokers, testing |
| **V2 - MarginVault + ClearingVault** | On-chain cross-venue settlement | DeFi-native venues, compliance |
| **V3 - HubVault + Keeper** | Real-time cross-venue portfolio margin | Growth-stage exchanges, prime brokers |

**Current Focus:** V1 MVP (UnifiedAccountVault) + 8 exchange adapters

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Contracts | Solidity 0.8.24, Foundry |
| Chain | Base (L2), USDC native |
| Services | TypeScript, Node.js, viem |
| Exchange Integration | WebSocket + REST adapters |
| Database | SQLite (MVP) → Postgres later |
| Frontend | Next.js, wagmi, viem |
| Monitoring | Prometheus, Grafana (planned) |

---

## Project Structure

```
anduin/
├── contracts/
│   ├── src/
│   │   ├── UnifiedAccountVault.sol       # V1 PnL settlement
│   │   ├── HubVault.sol                  # V3 cross-venue vault (designed)
│   │   ├── MarginVault.sol               # V2 per-venue vault (designed)
│   │   ├── ClearingVault.sol             # Cross-venue netting (designed)
│   │   ├── SecurityTokenVault.sol        # DVP for security tokens
│   │   ├── BatchSettlementVault.sol      # Merkle netting (designed)
│   │   ├── PrivateSettlementVault.sol    # Commitment-based privacy (designed)
│   │   ├── OracleGuard.sol               # Price validation
│   │   ├── TradingHoursGuard.sol         # Trading hours enforcement
│   │   ├── AnduinSecurity.sol            # ERC20 security token
│   │   └── MockUSDC.sol                  # Testnet USDC
│   └── test/                             # 203 tests
├── services/
│   ├── bridge/                           # Broker Bridge (settlement executor)
│   ├── indexer/                          # Event indexer
│   ├── recon/                            # Reconciliation engine
│   ├── api/                              # API Gateway
│   ├── integrations/                     # 8 exchange adapters
│   │   ├── bybit/
│   │   ├── kraken/
│   │   ├── okx/
│   │   ├── bitget/
│   │   ├── mexc/
│   │   ├── kucoin/
│   │   ├── htx/
│   │   └── mt5/
│   └── mock-broker/                      # Mock broker for testing
├── frontend/                             # Next.js dashboard
├── docs/                                 # Technical documentation
│   ├── INDEX.md                          # Start here (reading guide)
│   ├── ARCHITECTURE.md                   # System architecture (V1/V2/V3)
│   ├── FEATURES.md                       # Feature matrix
│   ├── PRODUCT.md                        # Product overview
│   ├── INSURANCE_FUND.md                 # Insurance waterfall
│   ├── EXCHANGE_INTEGRATIONS.md          # Venue integration guide
│   ├── BATCH_SETTLEMENTS.md              # Merkle netting
│   ├── PRIVATE_SETTLEMENTS.md            # Privacy features
│   ├── MULTI_COLLATERAL.md               # Multi-asset collateral
│   ├── OPERATIONAL_INFRASTRUCTURE.md     # Keeper, monitoring
│   └── edge-cases.md                     # Safety features
├── tickets/                              # Backlog
└── research/                             # Competitor analysis, specs
```

---

## Quick Start

```bash
# Install dependencies
cd contracts && forge install
cd ../services && npm install
cd ../frontend && npm install

# Run tests
cd contracts && forge test
# Output: 203 tests passing

# Start services (needs .env configured)
cd services && npm run dev

# Start frontend
cd frontend && npm run dev
```

---

## Documentation

**📖 [Documentation Index →](docs/INDEX.md)**

**Start here:**
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System overview, smart contracts, equity engine
- **[FEATURES.md](docs/FEATURES.md)** — What's built vs. planned
- **[INSURANCE_FUND.md](docs/INSURANCE_FUND.md)** — Safety waterfall, shortfall handling
- **[EXCHANGE_INTEGRATIONS.md](docs/EXCHANGE_INTEGRATIONS.md)** — 8 venue adapters, integration guide

**Reading guides for:**
- Brokers evaluating Anduin (30-45 min)
- Developers integrating (1-2 hours)
- Investors / due diligence (1-2 hours)
- Researchers / technical deep dive (3-4 hours)

---

## Current Status

**MVP Complete** — Full stack built, pending testnet deployment.

| Component | Status |
|-----------|--------|
| UnifiedAccountVault | ✅ 58 tests passing |
| Exchange adapters (8 venues) | ✅ Built |
| Backend services | ✅ Built |
| Frontend dashboard | ✅ Built |
| Safety features | ✅ Built (circuit breaker, oracle failover, timelock) |
| V3 contracts (HubVault) | 🏗️ Designed (implementation pending) |
| Base Sepolia deployment | ⏳ Pending |
| Security audit | ⏳ Planned |

---

## Why Build This

**The Problem:**  
When a trader closes a position on a crypto platform, profits can take hours to days to reach their wallet. Funds sit in broker-controlled omnibus accounts. No transparency. No portability.

**The Solution:**  
On-chain settlement in seconds. Self-governed vaults. Cross-venue portfolio margin. Insurance for shortfalls. Transparent. Auditable. Non-custodial.

**The Moat:**
- Audit-grade reconciliation (exactly-once settlement, breaks aging, replay tooling)
- Safety infrastructure (caps, cooldowns, pause circuits, timelock governance)
- Network effects (shared liquidity, multi-broker netting)
- Liability transfer (we take on operational risk and SLAs)

A broker could fork the contracts. They can't fork months of ops tooling, compliance templates, and the network of venues sharing liquidity.

---

## Who This Is For

- **Crypto exchanges** wanting instant, verifiable settlement
- **Brokers** looking to reduce counterparty risk
- **Institutional desks** needing auditable settlement records
- **Venues** where traders deserve their money faster

---

## Contact

Building Anduin. Reach out if you're a venue that moves money too slowly.

**Repository:** [anduin-settlement](https://github.com/yourusername/anduin-settlement)  
**Documentation:** [docs/INDEX.md](docs/INDEX.md)  
**Contracts:** `contracts/src/`  
**Tests:** `contracts/test/` (203 passing)
