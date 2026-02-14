# Volera — Instant Settlement Infrastructure

**On-chain settlement infrastructure for crypto trading platforms.**

Volera enables instant, verifiable settlement for derivatives and tokenized securities. When a trade closes, PnL settles to the trader's wallet in seconds. When a trader wants their position as a token, it's delivered atomically against payment.

---

## The Problem

When a trader closes a position on a crypto platform, the profit or loss is "realized" — but the actual money movement is anything but instant:

- **Delays:** Profits can take hours to days to reach a trader's wallet
- **Counterparty risk:** Funds sit in broker-controlled omnibus accounts
- **No transparency:** Traders can't verify their PnL was processed correctly
- **No portability:** Positions are stuck on the platform — no way to take them on-chain

This is the plumbing problem of crypto trading. Everyone builds the shiny front-end. Nobody fixes the pipes.

---

## What Volera Does

### Pillar 1: Issuance (Phase 2)
Regulated issuance of tokenized securities, structured products, and derivatives:
- **Delta-one trackers:** Equities, indices, commodities, precious metals
- **Yield products:** Covered calls, auto-callables, buffered notes
- **Securitized perps:** Mirror notes with explicit leverage and funding pass-through
- **On-demand tokenization:** Non-tokenized by default, tokenized when user withdraws to wallet

### Pillar 2: Instant Settlement (MVP — This Repo)
On-chain PnL settlement in seconds:
- **Win:** USDC credited to trader's on-chain PnL balance (withdrawable immediately)
- **Loss:** Collateral seized and returned to broker pool
- **DVP:** Security tokens delivered atomically against payment

### Pillar 3: Prime / Cross-Venue Netting (Phase 2)
One deposit → credit usable across multiple venues:
- Pre-trade margin checks
- Cross-venue position netting (60%+ margin savings)
- Hourly/daily settlement with default waterfall
- **[Architecture Doc](docs/PRIME_ARCHITECTURE.md)**

---

## Upcoming Features (Phase 2)

### 🔒 Private Settlements
Hide settlement amounts from public blockchain view while maintaining verifiability:
- Commitment-based settlement (amounts hidden)
- Encrypted memos for user verification
- Regulator-auditable
- **[Architecture Doc](docs/PRIVATE_SETTLEMENTS.md)**

### ⚡ Batch Settlements
Net multiple trades into single on-chain transaction for HFT traders:
- 5-minute settlement windows
- Off-chain netting with Merkle proofs
- 88-96% gas savings
- Claim-based settlement (lazy execution)
- **[Architecture Doc](docs/BATCH_SETTLEMENTS.md)**

### 💎 Multi-Collateral Support
Accept ETH, WBTC, and other tokens as collateral:
- Oracle-based margin calculation
- LTV ratios per token (ETH 80%, WBTC 75%)
- Automated liquidations
- Margin calls when ratio < 120%
- **[Architecture Doc](docs/MULTI_COLLATERAL.md)**

---

## How Instant Settlement Works

```
Trader Wallet ←→ UnifiedAccountVault (Base L2)
                         ↑
                   Broker Bridge
                         ↑
                  Trading Platform
```

1. **Trader deposits collateral** (USDC) into an on-chain vault
2. **Trader trades** on a connected platform as normal
3. **Trade closes** — broker reports realized PnL
4. **Volera settles instantly:**
   - **Profit →** USDC credited to trader's PnL balance
   - **Loss →** Collateral seized to broker pool
5. **Trader withdraws** whenever they want — no delays

### The Key Insight

Volera splits user funds into two buckets:
- **Collateral** — at-risk capital that can be seized on losses
- **PnL** — winnings that are *never* seizable, only withdrawable

This separation means traders always keep their profits, and platforms always recover their losses. Enforced in the smart contract — no trust required.

---

## Security Token Delivery (DVP)

Beyond PnL settlement, Volera handles atomic delivery of security tokens:

| Flow | Description |
|------|-------------|
| **BUY** | User locks USDC → receives security token in wallet |
| **SELL** | User locks token → receives USDC |
| **TOKENIZE** | Off-chain position → token delivered to wallet (no payment) |
| **DETOKENIZE** | Token deposited → off-chain position restored |

This enables the "non-tokenized by default, tokenized on-demand" model: users trade normally on the platform, and only tokenize when they want to withdraw their position to DeFi.

---

## Architecture

| Component | What | Tech |
|-----------|------|------|
| **UnifiedAccountVault** | Core vault: collateral/PnL sub-ledgers, broker pool | Solidity 0.8.24 |
| **SecurityTokenVault** | DVP settlement for security tokens | Solidity 0.8.24 |
| **TradingHoursGuard** | Trading hours, halts, earnings blackouts | Solidity 0.8.24 |
| **OracleGuard** | Price validation (Chainlink/Pyth) | Solidity 0.8.24 |
| **Broker Bridge** | Polls broker, executes settlements | TypeScript, viem |
| **Indexer** | On-chain event processing | TypeScript, SQLite |
| **Recon Engine** | Broker ↔ on-chain reconciliation | TypeScript |
| **API Gateway** | REST API for frontend/ops | Express |
| **Dashboard** | Real-time monitoring | Next.js, wagmi |

### Smart Contract Functions

```solidity
// UnifiedAccountVault (PnL Settlement)
function depositCollateral(uint256 amt) external;
function withdrawCollateral(uint256 amt) external;
function withdrawPnL(uint256 amt) external;
function creditPnl(address user, uint256 amt, bytes32 refId) external;
function seizeCollateral(address user, uint256 amt) external;

// SecurityTokenVault (DVP)
function initiateBuy(address token, uint256 amount, uint256 maxUsdc, bytes32 refId) external;
function initiateSell(address token, uint256 amount, uint256 minUsdc, bytes32 refId) external;
function executeTokenize(address user, address token, uint256 amount, bytes32 refId) external;
function executeDetokenize(address user, address token, uint256 amount, bytes32 refId) external;
```

---

## Safety Features

Volera implements enterprise-grade safety mechanisms to protect against edge cases and attacks:

| Feature | Status | Description |
|---------|--------|-------------|
| **Circuit Breaker** | ✅ | Auto-pause if settlement volume spikes (prevents runaway settlements) |
| **Underwater Accounts** | ✅ | Insurance fund + socialized loss tracking for insufficient collateral |
| **Oracle Failover** | ✅ | Graceful degradation to last-known-good price (max 5 min age) |
| **Timelock Controller** | ✅ | 24h delay on critical admin changes (prevents instant key compromise) |
| **Withdrawal Cooldown** | ✅ | Configurable delay prevents flash loan attacks (default: disabled) |
| **Missing Events** | ✅ | Complete event coverage for monitoring and compliance |
| **Multi-Collateral** | ⏸️ | Haircuts for ETH/WBTC collateral (design complete, deferred to post-MVP) |
| **Withdrawal Queue** | ⏸️ | Handle broker insolvency edge cases (design complete, deferred) |

**[Full Documentation](docs/edge-cases.md)**

### Production Deployment Checklist

Before going live:
- ✅ Configure circuit breaker threshold for expected volumes
- ✅ Set withdrawal cooldown (recommended: 1 block minimum)
- ✅ Fund insurance pool with appropriate reserves
- ✅ Deploy TimelockController and transfer admin
- ✅ Configure oracle failover max age (recommended: 5 min)
- ✅ Set up monitoring for CircuitBreakerTriggered and Shortfall events

---

## Why Base L2

- **Low fees:** Settlements cost fractions of a cent
- **Fast finality:** Transactions confirm in seconds
- **USDC native:** Circle's USDC is natively issued on Base
- **EVM compatible:** Standard tooling, easy integration

---

## Current Status

**MVP** — Full stack built, pending testnet deployment.

| Component | Status |
|-----------|--------|
| UnifiedAccountVault | ✅ 57 tests passing |
| SecurityTokenVault | ✅ Contract written |
| TradingHoursGuard | ✅ Contract written |
| OracleGuard | ✅ Contract written |
| Backend services | ✅ Built |
| Frontend dashboard | ✅ Built |
| Base Sepolia deployment | ⏳ Pending |
| Security audit | ⏳ Planned (€17k budget) |

---

## Business Model

| Revenue Stream | Description |
|----------------|-------------|
| **Setup fee** | €250k per broker integration |
| **Platform fee** | €10-30k MRR |
| **Settlement fee** | 0.5-2.0 bps on notional |
| **Tokenization fee** | Per-token fee on DVP |

---

## Moat

1. **Audit-grade reconciliation** — Exactly-once settlement, breaks aging, replay tooling
2. **Safety infrastructure** — Caps, cooldowns, pause circuits, timelock governance
3. **Network effects** — Shared issuance tokens, multi-broker liquidity
4. **Liability transfer** — We take on operational risk and SLAs

A broker could fork the contracts. They can't fork:
- Months of ops tooling and incident response
- Compliance templates and audit history
- The network of other platforms sharing liquidity

---

## Project Structure

```
volera-settlement/
├── contracts/
│   └── src/
│       ├── UnifiedAccountVault.sol   # Core PnL settlement
│       ├── SecurityTokenVault.sol    # DVP for security tokens
│       ├── TradingHoursGuard.sol     # Trading hours & halts
│       ├── OracleGuard.sol           # Price validation
│       ├── VoleraSecurity.sol        # ERC20 security token
│       └── MockUSDC.sol              # Testnet USDC
├── services/
│   ├── bridge/                       # Broker Bridge
│   ├── indexer/                      # Event indexer
│   ├── recon/                        # Reconciliation
│   ├── api/                          # API Gateway
│   └── mock-broker/                  # Mock broker for testing
├── frontend/                         # Next.js dashboard
├── tickets/                          # Backlog
├── research/                         # Competitor analysis, specs
└── docs/                             # Architecture docs
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

# Start services (needs .env configured)
cd services && npm run dev

# Start frontend
cd frontend && npm run dev
```

---

## Who This Is For

- **Crypto trading platforms** wanting instant, verifiable settlement
- **Brokers** looking to reduce counterparty risk
- **Institutional desks** needing auditable settlement records
- **Platforms** where traders deserve their money faster

---

## Contact

Building Volera. Reach out if you're a platform that moves money too slowly.
