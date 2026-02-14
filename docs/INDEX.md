# Volera Documentation Index

**Complete technical documentation for the Volera settlement infrastructure.**

---

## 📖 Table of Contents

### Core Documentation

#### [INSURANCE_FUND.md](INSURANCE_FUND.md)
The insurance fund mechanism that protects against underwater accounts.

**Topics:**
- Waterfall: user collateral → insurance fund → socialized losses
- `seizeCollateralCapped()` function deep-dive
- Admin deposit/withdraw functions
- Example scenarios (sufficient collateral, partial shortfall, fund depletion)
- Monitoring and alerts
- Integration guide
- Security considerations

**Read this if:**
- You need to understand how underwater accounts are handled
- You're setting up monitoring for shortfall events
- You're integrating settlement logic into a broker bridge
- You want to know when/how to replenish the insurance fund

---

#### [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md)
Exchange and broker integration adapters for connecting trading venues to on-chain settlement.

**Topics:**
- Architecture overview (adapter pattern, factory, price aggregator, settlement bridge)
- All 8 supported venues: Bybit, Kraken, OKX, Bitget, MEXC, KuCoin, HTX, MetaTrader 5
- VenueAdapter interface specification
- Price aggregation across multiple venues
- Settlement bridge: mapping position closes to on-chain actions
- How to onboard a new exchange
- Configuration examples
- Testing and monitoring

**Read this if:**
- You're integrating a new trading venue
- You need real-time price feeds across multiple exchanges
- You want to understand how position closes trigger on-chain settlements
- You're building the broker bridge service

---

### Architecture & Design

#### [ARCHITECTURE.md](ARCHITECTURE.md)
High-level system architecture and component overview.

**Topics:**
- System components and data flow
- Smart contract architecture
- Backend services (bridge, indexer, recon, API)
- Frontend dashboard
- Deployment architecture
- Tech stack decisions

**Read this if:**
- You're new to Volera and need a system overview
- You're onboarding engineers
- You need to understand how all the pieces fit together

---

#### [PRIME_ARCHITECTURE.md](PRIME_ARCHITECTURE.md)
Prime brokerage features: cross-venue netting and shared margin.

**Topics:**
- Multi-venue position netting (60%+ margin savings)
- Pre-trade margin checks
- Hourly/daily settlement cycles
- Default waterfall
- Prime vault design

**Status:** Phase 2 (design complete, not yet implemented)

**Read this if:**
- You want to understand the vision for cross-venue margin
- You're planning multi-broker integrations
- You need margin efficiency for HFT traders

---

#### [PRIVATE_SETTLEMENTS.md](PRIVATE_SETTLEMENTS.md)
Privacy-preserving settlement mechanism.

**Topics:**
- Commitment-based settlement (amounts hidden on-chain)
- Encrypted memos for user verification
- Zero-knowledge proofs for regulatory audits
- Privacy vs transparency trade-offs

**Status:** Phase 2 (design complete, not yet implemented)

**Read this if:**
- You need to hide settlement amounts from public view
- You're dealing with institutional clients who require privacy
- You want to understand zkSNARK integration

---

#### [BATCH_SETTLEMENTS.md](BATCH_SETTLEMENTS.md)
Batch settlement for high-frequency traders.

**Topics:**
- 5-minute settlement windows
- Off-chain netting with Merkle proofs
- 88-96% gas savings
- Claim-based settlement (lazy execution)
- Batch vault design

**Status:** Phase 2 (design complete, not yet implemented)

**Read this if:**
- You have HFT traders with hundreds of trades per day
- You need to reduce gas costs dramatically
- You want to understand Merkle proof settlements

---

#### [MULTI_COLLATERAL.md](MULTI_COLLATERAL.md)
Multi-collateral support with oracle-based margin.

**Topics:**
- ETH, WBTC, and other tokens as collateral
- LTV ratios and haircuts per token
- Oracle integration (Chainlink/Pyth)
- Automated liquidations
- Margin calls when health ratio drops

**Status:** Phase 2 (design complete, not yet implemented)

**Read this if:**
- You want to accept ETH or WBTC as collateral
- You need to understand margin calculation with multiple assets
- You're building liquidation bots

---

### Operational Documentation

#### [edge-cases.md](edge-cases.md)
Safety features and edge case handling.

**Topics:**
- Circuit breaker (auto-pause on volume spikes)
- Underwater accounts (insurance fund + socialized losses)
- Oracle failover (graceful degradation)
- Timelock controller (24h delay on admin changes)
- Withdrawal cooldown (flash loan prevention)
- Missing events (complete event coverage)
- Multi-collateral (haircuts for different tokens)
- Withdrawal queue (broker insolvency)

**Read this if:**
- You're deploying to production
- You need to understand all the safety mechanisms
- You're setting up monitoring and alerting
- You want to know what can go wrong and how it's handled

---

## 📚 Documentation by Role

### For Smart Contract Developers

**Start here:**
1. [ARCHITECTURE.md](ARCHITECTURE.md) — System overview
2. [edge-cases.md](edge-cases.md) — Safety features
3. [INSURANCE_FUND.md](INSURANCE_FUND.md) — Underwater account handling

**Then explore:**
- [MULTI_COLLATERAL.md](MULTI_COLLATERAL.md) — Multi-asset margin
- [BATCH_SETTLEMENTS.md](BATCH_SETTLEMENTS.md) — Gas optimization
- [PRIVATE_SETTLEMENTS.md](PRIVATE_SETTLEMENTS.md) — Privacy features

---

### For Backend Engineers

**Start here:**
1. [ARCHITECTURE.md](ARCHITECTURE.md) — Component overview
2. [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md) — Venue adapters
3. [INSURANCE_FUND.md](INSURANCE_FUND.md) — Settlement logic

**Then explore:**
- [edge-cases.md](edge-cases.md) — Error handling
- [PRIME_ARCHITECTURE.md](PRIME_ARCHITECTURE.md) — Cross-venue features

---

### For Platform Integrators

**Start here:**
1. [ARCHITECTURE.md](ARCHITECTURE.md) — How it all works
2. [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md) — Add your exchange
3. [edge-cases.md](edge-cases.md) — Production safety

**Then explore:**
- [INSURANCE_FUND.md](INSURANCE_FUND.md) — Fund management
- [BATCH_SETTLEMENTS.md](BATCH_SETTLEMENTS.md) — HFT optimization

---

### For Operations / DevOps

**Start here:**
1. [edge-cases.md](edge-cases.md) — All safety mechanisms
2. [INSURANCE_FUND.md](INSURANCE_FUND.md) — Monitoring shortfalls
3. [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md) — WebSocket health

**Then explore:**
- [ARCHITECTURE.md](ARCHITECTURE.md) — Deployment architecture
- [PRIVATE_SETTLEMENTS.md](PRIVATE_SETTLEMENTS.md) — Privacy compliance

---

## 🔍 Quick Reference

### Key Contracts

| Contract | Purpose | Documentation |
|----------|---------|---------------|
| **UnifiedAccountVault** | PnL settlement, insurance fund | [INSURANCE_FUND.md](INSURANCE_FUND.md) |
| **SecurityTokenVault** | DVP for security tokens | [ARCHITECTURE.md](ARCHITECTURE.md) |
| **TradingHoursGuard** | Trading hours, halts | [edge-cases.md](edge-cases.md) |
| **OracleGuard** | Price validation | [edge-cases.md](edge-cases.md) |

### Key Services

| Service | Purpose | Documentation |
|---------|---------|---------------|
| **Venue Adapters** | Exchange integrations | [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md) |
| **Settlement Bridge** | Position → on-chain mapping | [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md) |
| **Price Aggregator** | Multi-venue best prices | [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md) |
| **Broker Bridge** | Poll broker, execute settlements | [ARCHITECTURE.md](ARCHITECTURE.md) |
| **Indexer** | Event processing | [ARCHITECTURE.md](ARCHITECTURE.md) |
| **Recon Engine** | Broker ↔ on-chain reconciliation | [ARCHITECTURE.md](ARCHITECTURE.md) |

### Key Features

| Feature | Status | Documentation |
|---------|--------|---------------|
| Insurance Fund | ✅ Implemented | [INSURANCE_FUND.md](INSURANCE_FUND.md) |
| Exchange Integrations | ✅ Implemented | [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md) |
| Circuit Breaker | ✅ Implemented | [edge-cases.md](edge-cases.md) |
| Oracle Failover | ✅ Implemented | [edge-cases.md](edge-cases.md) |
| Withdrawal Cooldown | ✅ Implemented | [edge-cases.md](edge-cases.md) |
| Timelock Controller | ✅ Implemented | [edge-cases.md](edge-cases.md) |
| Private Settlements | ⏸️ Phase 2 | [PRIVATE_SETTLEMENTS.md](PRIVATE_SETTLEMENTS.md) |
| Batch Settlements | ⏸️ Phase 2 | [BATCH_SETTLEMENTS.md](BATCH_SETTLEMENTS.md) |
| Multi-Collateral | ⏸️ Phase 2 | [MULTI_COLLATERAL.md](MULTI_COLLATERAL.md) |
| Prime Brokerage | ⏸️ Phase 2 | [PRIME_ARCHITECTURE.md](PRIME_ARCHITECTURE.md) |

---

## 🛠️ Common Tasks

### "I want to integrate a new exchange"

1. Read [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md) — "How to Onboard a New Exchange" section
2. Implement `VenueAdapter` interface for your exchange
3. Add to `AdapterFactory`
4. Test with provided examples
5. Document in the "Supported Venues" section

---

### "I want to understand how underwater accounts are handled"

1. Read [INSURANCE_FUND.md](INSURANCE_FUND.md) — "The Waterfall" section
2. Study the `seizeCollateralCapped()` code example
3. Review the example scenarios
4. Set up monitoring for `Shortfall` events

---

### "I'm deploying to production, what do I need to know?"

1. Read [edge-cases.md](edge-cases.md) — "Production Deployment Checklist"
2. Configure circuit breaker thresholds
3. Fund the insurance pool (recommend 5-10% of total collateral)
4. Set up monitoring for critical events:
   - `CircuitBreakerTriggered`
   - `Shortfall`
   - `InsuranceFundDeposited` / `InsuranceFundWithdrawn`
5. Deploy `TimelockController` and transfer admin role
6. Test failover scenarios

---

### "I want to reduce gas costs for HFT traders"

1. Read [BATCH_SETTLEMENTS.md](BATCH_SETTLEMENTS.md)
2. Understand off-chain netting and Merkle proofs
3. Note: Feature is designed but not yet implemented (Phase 2)
4. For now, optimize by batching multiple users' settlements in a single transaction

---

### "I need to add privacy features"

1. Read [PRIVATE_SETTLEMENTS.md](PRIVATE_SETTLEMENTS.md)
2. Understand commitment-based settlements
3. Review zkSNARK integration approach
4. Note: Feature is designed but not yet implemented (Phase 2)

---

## 📝 Contributing to Documentation

When adding new documentation:

1. **Place in `/docs/`** directory
2. **Add to this INDEX.md** under the appropriate section
3. **Link from README.md** if it's a major feature
4. **Use clear structure:** Overview → Implementation → Examples → FAQ
5. **Include code snippets** with comments
6. **Add ASCII diagrams** for visual flow
7. **Cross-reference** related docs

### Documentation Style Guide

- **Headers:** Use `##` for main sections, `###` for subsections
- **Code blocks:** Always specify language (```typescript, ```solidity)
- **Examples:** Show input, code, and output
- **Warnings:** Use **⚠️** emoji
- **Success:** Use **✅** emoji
- **Tables:** Use Markdown tables for comparisons
- **Links:** Use relative links within docs (e.g., `[Architecture](ARCHITECTURE.md)`)

---

## 🔗 External Resources

### Smart Contracts
- [Foundry Book](https://book.getfoundry.sh/) — Testing framework
- [OpenZeppelin Docs](https://docs.openzeppelin.com/) — Security patterns
- [Solidity Docs](https://docs.soliditylang.org/) — Language reference

### Base L2
- [Base Docs](https://docs.base.org/) — Chain documentation
- [Base Testnet](https://sepolia.basescan.org/) — Block explorer

### Oracles
- [Chainlink Price Feeds](https://docs.chain.link/data-feeds) — Oracle integration
- [Pyth Network](https://docs.pyth.network/) — Alternative oracle

### TypeScript & viem
- [viem Docs](https://viem.sh/) — Ethereum library
- [wagmi Docs](https://wagmi.sh/) — React hooks

---

## 📧 Questions?

If you can't find what you're looking for:

1. **Search this index** for keywords
2. **Check the README** for high-level overview
3. **Read relevant doc files** in full
4. **Ask in Discord** (if available)
5. **Open a GitHub issue** with documentation feedback

---

**Last updated:** 2026-02-14  
**Documentation version:** v1.0
