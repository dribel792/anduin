# Deployment Scripts

Scripts for deploying Anduin settlement contracts to Base.

## Prerequisites

1. Build contracts:
```bash
cd contracts
forge build
```

2. Set up environment variables (create `.env` in project root):
```bash
# For testnet
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
DEPLOYER_PRIVATE_KEY=0x...

# For mainnet
BASE_MAINNET_RPC_URL=https://mainnet.base.org
USE_EXISTING_USDC=true  # Use real USDC on mainnet

# For verification
BASESCAN_API_KEY=your_api_key
```

## Deploy to Testnet (Base Sepolia)

```bash
npx ts-node scripts/deploy/deploy-testnet.ts
```

This will:
- Deploy MockUSDC for testing
- Deploy all vault contracts
- Deploy guard contracts
- Save addresses to `deployments/base-sepolia.json`

## Deploy to Mainnet (Base)

⚠️ **USE WITH CAUTION** - This deploys to mainnet with real funds!

```bash
npx ts-node scripts/deploy/deploy-mainnet.ts
```

Features:
- Interactive confirmation prompts
- Balance checks before deployment
- Uses real USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
- Gas estimation
- Saves addresses to `deployments/base-mainnet.json`

## Verify Contracts on Basescan

After deployment, verify contracts:

```bash
# Testnet
npx ts-node scripts/deploy/verify-contracts.ts --network testnet

# Mainnet
npx ts-node scripts/deploy/verify-contracts.ts --network mainnet
```

## Post-Deployment

1. **Transfer ownership**: Move contract ownership to a multisig or timelock
2. **Fund insurance vault**: Deposit initial capital to the insurance fund
3. **Configure API**: Update `services/api/config.ts` with deployed addresses
4. **Test thoroughly**: Run settlement tests on testnet before mainnet use

## Deployment Addresses

Addresses are saved to:
- Testnet: `deployments/base-sepolia.json`
- Mainnet: `deployments/base-mainnet.json`

These files are used by the API server and keeper service to interact with the contracts.
