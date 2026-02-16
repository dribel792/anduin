# Anduin Documentation Index

Complete technical documentation for Anduin's instant on-chain settlement infrastructure.

---

## Start Here

**👉 [ARCHITECTURE.md](ARCHITECTURE.md)** — Start here for system overview, smart contracts, and technical architecture.

This is the master architecture document consolidating V1 (single-venue MVP), V2 (on-chain-only settlement), and V3 (cross-venue portfolio margin with reinsurance). Read this first to understand how Anduin works.

---

## Core Documentation

### Product & Features
- **[FEATURES.md](FEATURES.md)** — Comprehensive feature list with status, contracts, and descriptions
- **[PRODUCT.md](PRODUCT.md)** — Product overview, target customers, revenue model, and roadmap

### Technical Architecture
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Complete system architecture (V1/V2/V3), smart contracts, equity engine, insurance, netting
- **[INSURANCE_FUND.md](INSURANCE_FUND.md)** — Insurance waterfall, shortfall handling, funding sources, admin functions
- **[EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md)** — 8 venue adapters, integration guide, adapter pattern

### Advanced Features
- **[BATCH_SETTLEMENTS.md](BATCH_SETTLEMENTS.md)** — Merkle-proof based netting for HFT traders (88-96% gas savings)
- **[PRIVATE_SETTLEMENTS.md](PRIVATE_SETTLEMENTS.md)** — Commitment-based settlement with hidden amounts for large traders
- **[MULTI_COLLATERAL.md](MULTI_COLLATERAL.md)** — ETH/WBTC collateral support with oracle-based margin (planned)

### Operational
- **[OPERATIONAL_INFRASTRUCTURE.md](OPERATIONAL_INFRASTRUCTURE.md)** — Keeper service, monitoring, alerting, DevOps
- **[edge-cases.md](edge-cases.md)** — Safety features, circuit breaker, oracle failover, production checklist

---

## Reading Guide by Audience

### For Brokers Evaluating Anduin

**Goal:** Understand the business case and integration requirements.

1. **[PRODUCT.md](PRODUCT.md)** — What Anduin does, who it's for, revenue model
2. **[FEATURES.md](FEATURES.md)** — What features are available, what's planned
3. **[ARCHITECTURE.md](ARCHITECTURE.md) (Overview + How It Works)** — High-level flow: deposit, equity updates, settlement
4. **[INSURANCE_FUND.md](INSURANCE_FUND.md)** — How your venue is protected from liquidation shortfalls
5. **[EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md)** — What APIs you need to provide, integration timeline

**Time:** 30-45 minutes

---

### For Developers Integrating

**Goal:** Understand the contracts, APIs, and integration steps.

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — Full technical architecture: smart contracts, equity engine, keeper service
2. **[EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md)** — Adapter pattern, venue API requirements, examples
3. **[OPERATIONAL_INFRASTRUCTURE.md](OPERATIONAL_INFRASTRUCTURE.md)** — Keeper service, monitoring, alerting
4. **[edge-cases.md](edge-cases.md)** — Safety features, production deployment checklist
5. **Contract code** — Read `contracts/src/` for implementation details

**Time:** 1-2 hours (plus contract code review)

---

### For Investors / Due Diligence

**Goal:** Understand the moat, safety, and scalability.

1. **[PRODUCT.md](PRODUCT.md)** — Market opportunity, revenue model, roadmap
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — System design, security model, trust assumptions
3. **[INSURANCE_FUND.md](INSURANCE_FUND.md)** — Risk management, waterfall, insurance pool funding
4. **[FEATURES.md](FEATURES.md)** — What's built vs. planned, technology maturity
5. **[edge-cases.md](edge-cases.md)** — Safety mechanisms, circuit breaker, oracle failover
6. **[OPERATIONAL_INFRASTRUCTURE.md](OPERATIONAL_INFRASTRUCTURE.md)** — Monitoring, alerting, DevOps maturity

**Time:** 1-2 hours

---

### For Researchers / Technical Deep Dive

**Goal:** Understand the technical innovations and design tradeoffs.

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — Complete architecture (V1/V2/V3 comparison)
2. **[BATCH_SETTLEMENTS.md](BATCH_SETTLEMENTS.md)** — Merkle-proof netting, gas optimization
3. **[PRIVATE_SETTLEMENTS.md](PRIVATE_SETTLEMENTS.md)** — Commitment-based privacy, zero-knowledge proofs
4. **[MULTI_COLLATERAL.md](MULTI_COLLATERAL.md)** — Oracle-based margin, liquidation mechanisms
5. **[edge-cases.md](edge-cases.md)** — Edge case handling, attack vectors, safety mechanisms
6. **Contract tests** — Read `contracts/test/` for 203 test cases covering all scenarios

**Time:** 3-4 hours (plus contract code deep dive)

---

## Documentation by Category

### Smart Contracts
- [ARCHITECTURE.md](ARCHITECTURE.md#smart-contracts) — All contracts overview
- `UnifiedAccountVault.sol` — Single-venue PnL settlement (V1)
- `HubVault.sol` — Cross-venue portfolio margin (V3)
- `MarginVault.sol` — Per-venue vault (V2)
- `ClearingVault.sol` — Cross-venue netting (V2/V3)
- `SecurityTokenVault.sol` — DVP for security tokens
- `OracleGuard.sol` — Oracle failover and price validation
- `TradingHoursGuard.sol` — Trading hours, halts, earnings blackouts

### Off-Chain Services
- [OPERATIONAL_INFRASTRUCTURE.md](OPERATIONAL_INFRASTRUCTURE.md) — Keeper, API, monitoring
- [EXCHANGE_INTEGRATIONS.md](EXCHANGE_INTEGRATIONS.md) — Venue adapters (Bybit, Kraken, OKX, etc.)

### Safety & Security
- [edge-cases.md](edge-cases.md) — Circuit breaker, oracle failover, timelock, withdrawal cooldown
- [INSURANCE_FUND.md](INSURANCE_FUND.md) — Waterfall, shortfall coverage, socialized losses

### Product & Business
- [PRODUCT.md](PRODUCT.md) — Product overview, target customers, revenue model
- [FEATURES.md](FEATURES.md) — Feature matrix with status

### Advanced Features (Designed, Not Yet Implemented)
- [BATCH_SETTLEMENTS.md](BATCH_SETTLEMENTS.md) — Merkle-proof netting
- [PRIVATE_SETTLEMENTS.md](PRIVATE_SETTLEMENTS.md) — Commitment-based privacy
- [MULTI_COLLATERAL.md](MULTI_COLLATERAL.md) — Multi-asset collateral

---

## Quick Reference

### Key Metrics
- **203 tests passing** across all contracts
- **8 exchange adapters** (Bybit, Kraken, OKX, Bitget, MEXC, KuCoin, HTX, MT5)
- **3 product tiers** (V1 single-venue, V2 on-chain, V3 cross-venue)
- **5 revenue streams** (settlement fees, insurance premium, equity updates, netting, integration)

### Architecture Tiers
- **V1 (UnifiedAccountVault)** — Single-venue instant settlement (entry-level)
- **V2 (MarginVault + ClearingVault)** — On-chain cross-venue settlement (compliance-focused)
- **V3 (HubVault + Keeper)** — Real-time cross-venue portfolio margin (growth product)

### Contact
- **GitHub:** [anduin-settlement](https://github.com/yourusername/anduin-settlement)
- **Docs:** This directory
- **Contracts:** `contracts/src/`
- **Tests:** `contracts/test/`
- **Services:** `services/`

---

## Archive

Older architecture documents have been archived for reference:

- `archive/ARCHITECTURE_V2.md` — V2 architecture (MarginVault + ClearingVault)
- `archive/ARCHITECTURE_V3.md` — V3 architecture (HubVault + meta-risk layer)
- `archive/PRIME_ARCHITECTURE.md` — Early cross-venue design

These have been consolidated into the current [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Contributing

When adding new documentation:
1. Add the doc to the appropriate category above
2. Update reading guides if it's a core doc
3. Link from ARCHITECTURE.md or FEATURES.md if relevant
4. Keep this index up to date

---

**Last Updated:** 2025-02-16  
**Version:** V3 architecture (HubVault + cross-venue equity)
