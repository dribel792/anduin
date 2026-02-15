/**
 * Deploy all Anduin contracts to Base mainnet
 * 
 * Usage:
 *   npx ts-node scripts/deploy/deploy-mainnet.ts
 * 
 * Environment variables required:
 *   - BASE_MAINNET_RPC_URL: RPC endpoint for Base mainnet
 *   - DEPLOYER_PRIVATE_KEY: Private key of deployer account
 *   - USE_EXISTING_USDC: Set to "true" to use existing USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 */

import { createWalletClient, createPublicClient, http, parseEther, formatEther, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

// Contract ABIs and bytecode
const getContractArtifact = (contractName: string) => {
  const artifactPath = path.join(__dirname, '../../contracts/out', `${contractName}.sol`, `${contractName}.json`);
  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
};

interface DeploymentAddresses {
  usdc: `0x${string}`;
  unifiedAccountVault: `0x${string}`;
  securityTokenVault: `0x${string}`;
  batchSettlementVault: `0x${string}`;
  privateSettlementVault: `0x${string}`;
  oracleGuard: `0x${string}`;
  tradingHoursGuard: `0x${string}`;
  deployedAt: number;
  network: string;
  deployer: `0x${string}`;
}

async function confirmStep(message: string): Promise<boolean> {
  const answer = await question(`${message} (yes/no): `);
  return answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y';
}

async function main() {
  console.log('🚀 Deploying Anduin contracts to Base mainnet...\n');
  console.log('⚠️  WARNING: This will deploy to MAINNET and consume real ETH!\n');

  const proceed = await confirmStep('Are you sure you want to continue?');
  if (!proceed) {
    console.log('Deployment cancelled.');
    process.exit(0);
  }

  // Validate environment
  const rpcUrl = process.env.BASE_MAINNET_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const useExistingUSDC = process.env.USE_EXISTING_USDC === 'true';

  if (!rpcUrl || !privateKey) {
    throw new Error('Missing required environment variables: BASE_MAINNET_RPC_URL, DEPLOYER_PRIVATE_KEY');
  }

  // Setup clients
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  });

  console.log(`\n📍 Deployer address: ${account.address}`);
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Deployer balance: ${formatEther(balance)} ETH`);

  // Estimate total gas needed (rough estimate)
  const estimatedGasNeeded = parseEther('0.05'); // ~0.05 ETH for all deployments
  if (balance < estimatedGasNeeded) {
    console.error(`\n❌ Insufficient balance! You need at least ${formatEther(estimatedGasNeeded)} ETH.`);
    process.exit(1);
  }

  const confirmBalance = await confirmStep(`\nBalance check OK. Continue with deployment?`);
  if (!confirmBalance) {
    console.log('Deployment cancelled.');
    process.exit(0);
  }

  const deployments: Partial<DeploymentAddresses> = {
    network: 'base-mainnet',
    deployer: account.address,
    deployedAt: Date.now(),
  };

  // 1. USDC address (use existing mainnet USDC)
  if (useExistingUSDC) {
    deployments.usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet USDC
    console.log(`\n1️⃣  Using existing USDC at: ${deployments.usdc}`);
  } else {
    console.log('\n1️⃣  Deploying MockUSDC (NOT RECOMMENDED FOR MAINNET)...');
    const confirmMock = await confirmStep('Are you SURE you want to deploy a mock USDC on mainnet?');
    if (!confirmMock) {
      console.log('Deployment cancelled. Set USE_EXISTING_USDC=true to use real USDC.');
      process.exit(0);
    }
    const mockUSDCArtifact = getContractArtifact('MockUSDC');
    const mockUSDCHash = await walletClient.deployContract({
      abi: mockUSDCArtifact.abi,
      bytecode: mockUSDCArtifact.bytecode.object,
      args: [],
    });
    const mockUSDCReceipt = await publicClient.waitForTransactionReceipt({ hash: mockUSDCHash });
    deployments.usdc = mockUSDCReceipt.contractAddress!;
    console.log(`✅ MockUSDC deployed at: ${deployments.usdc}`);
  }

  // 2. Deploy OracleGuard
  console.log('\n2️⃣  Deploying OracleGuard...');
  const oracleGuardArtifact = getContractArtifact('OracleGuard');
  const oracleGuardHash = await walletClient.deployContract({
    abi: oracleGuardArtifact.abi,
    bytecode: oracleGuardArtifact.bytecode.object,
    args: [],
  });
  console.log(`   Transaction hash: ${oracleGuardHash}`);
  const oracleGuardReceipt = await publicClient.waitForTransactionReceipt({ hash: oracleGuardHash });
  deployments.oracleGuard = oracleGuardReceipt.contractAddress!;
  console.log(`✅ OracleGuard deployed at: ${deployments.oracleGuard}`);

  // 3. Deploy TradingHoursGuard
  console.log('\n3️⃣  Deploying TradingHoursGuard...');
  const tradingHoursGuardArtifact = getContractArtifact('TradingHoursGuard');
  const tradingHoursGuardHash = await walletClient.deployContract({
    abi: tradingHoursGuardArtifact.abi,
    bytecode: tradingHoursGuardArtifact.bytecode.object,
    args: [],
  });
  console.log(`   Transaction hash: ${tradingHoursGuardHash}`);
  const tradingHoursGuardReceipt = await publicClient.waitForTransactionReceipt({ hash: tradingHoursGuardHash });
  deployments.tradingHoursGuard = tradingHoursGuardReceipt.contractAddress!;
  console.log(`✅ TradingHoursGuard deployed at: ${deployments.tradingHoursGuard}`);

  // 4. Deploy UnifiedAccountVault
  console.log('\n4️⃣  Deploying UnifiedAccountVault...');
  const unifiedAccountVaultArtifact = getContractArtifact('UnifiedAccountVault');
  const unifiedAccountVaultHash = await walletClient.deployContract({
    abi: unifiedAccountVaultArtifact.abi,
    bytecode: unifiedAccountVaultArtifact.bytecode.object,
    args: [deployments.usdc, account.address],
  });
  console.log(`   Transaction hash: ${unifiedAccountVaultHash}`);
  const unifiedAccountVaultReceipt = await publicClient.waitForTransactionReceipt({ hash: unifiedAccountVaultHash });
  deployments.unifiedAccountVault = unifiedAccountVaultReceipt.contractAddress!;
  console.log(`✅ UnifiedAccountVault deployed at: ${deployments.unifiedAccountVault}`);

  // 5. Deploy SecurityTokenVault
  console.log('\n5️⃣  Deploying SecurityTokenVault...');
  const securityTokenVaultArtifact = getContractArtifact('SecurityTokenVault');
  const securityTokenVaultHash = await walletClient.deployContract({
    abi: securityTokenVaultArtifact.abi,
    bytecode: securityTokenVaultArtifact.bytecode.object,
    args: [deployments.usdc, account.address],
  });
  console.log(`   Transaction hash: ${securityTokenVaultHash}`);
  const securityTokenVaultReceipt = await publicClient.waitForTransactionReceipt({ hash: securityTokenVaultHash });
  deployments.securityTokenVault = securityTokenVaultReceipt.contractAddress!;
  console.log(`✅ SecurityTokenVault deployed at: ${deployments.securityTokenVault}`);

  // 6. Deploy BatchSettlementVault
  console.log('\n6️⃣  Deploying BatchSettlementVault...');
  const batchSettlementVaultArtifact = getContractArtifact('BatchSettlementVault');
  const batchSettlementVaultHash = await walletClient.deployContract({
    abi: batchSettlementVaultArtifact.abi,
    bytecode: batchSettlementVaultArtifact.bytecode.object,
    args: [deployments.usdc, account.address],
  });
  console.log(`   Transaction hash: ${batchSettlementVaultHash}`);
  const batchSettlementVaultReceipt = await publicClient.waitForTransactionReceipt({ hash: batchSettlementVaultHash });
  deployments.batchSettlementVault = batchSettlementVaultReceipt.contractAddress!;
  console.log(`✅ BatchSettlementVault deployed at: ${deployments.batchSettlementVault}`);

  // 7. Deploy PrivateSettlementVault
  console.log('\n7️⃣  Deploying PrivateSettlementVault...');
  const privateSettlementVaultArtifact = getContractArtifact('PrivateSettlementVault');
  const privateSettlementVaultHash = await walletClient.deployContract({
    abi: privateSettlementVaultArtifact.abi,
    bytecode: privateSettlementVaultArtifact.bytecode.object,
    args: [deployments.usdc, account.address],
  });
  console.log(`   Transaction hash: ${privateSettlementVaultHash}`);
  const privateSettlementVaultReceipt = await publicClient.waitForTransactionReceipt({ hash: privateSettlementVaultHash });
  deployments.privateSettlementVault = privateSettlementVaultReceipt.contractAddress!;
  console.log(`✅ PrivateSettlementVault deployed at: ${deployments.privateSettlementVault}`);

  // Save deployment addresses
  const deploymentsPath = path.join(__dirname, '../../deployments/base-mainnet.json');
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\n📝 Deployment addresses saved to: ${deploymentsPath}`);

  console.log('\n✨ Deployment complete!\n');
  console.log('Summary:');
  console.log('--------');
  Object.entries(deployments).forEach(([key, value]) => {
    if (key !== 'deployedAt' && key !== 'network' && key !== 'deployer') {
      console.log(`${key}: ${value}`);
    }
  });

  console.log('\n💡 Next steps:');
  console.log('1. Verify contracts: npx ts-node scripts/deploy/verify-contracts.ts --network mainnet');
  console.log('2. Transfer ownership to a multisig/timelock');
  console.log('3. Configure the API server with these addresses');
  console.log('4. Fund the insurance vault\n');

  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    rl.close();
    process.exit(1);
  });
