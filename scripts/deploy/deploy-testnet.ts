/**
 * Deploy all Anduin contracts to Base Sepolia testnet
 * 
 * Usage:
 *   npx ts-node scripts/deploy/deploy-testnet.ts
 * 
 * Environment variables required:
 *   - BASE_SEPOLIA_RPC_URL: RPC endpoint for Base Sepolia
 *   - DEPLOYER_PRIVATE_KEY: Private key of deployer account
 */

import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Contract ABIs and bytecode (will be loaded from forge artifacts)
const getContractArtifact = (contractName: string) => {
  const artifactPath = path.join(__dirname, '../../contracts/out', `${contractName}.sol`, `${contractName}.json`);
  return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
};

interface DeploymentAddresses {
  mockUSDC: `0x${string}`;
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

async function main() {
  console.log('🚀 Deploying Anduin contracts to Base Sepolia...\n');

  // Validate environment
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    throw new Error('Missing required environment variables: BASE_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY');
  }

  // Setup clients
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  console.log(`📍 Deployer address: ${account.address}`);
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Deployer balance: ${formatEther(balance)} ETH\n`);

  if (balance < parseEther('0.01')) {
    console.warn('⚠️  Warning: Low balance! You may need more ETH for deployment.\n');
  }

  const deployments: Partial<DeploymentAddresses> = {
    network: 'base-sepolia',
    deployer: account.address,
    deployedAt: Date.now(),
  };

  // 1. Deploy MockUSDC
  console.log('1️⃣  Deploying MockUSDC...');
  const mockUSDCArtifact = getContractArtifact('MockUSDC');
  const mockUSDCHash = await walletClient.deployContract({
    abi: mockUSDCArtifact.abi,
    bytecode: mockUSDCArtifact.bytecode.object,
    args: [],
  });
  const mockUSDCReceipt = await publicClient.waitForTransactionReceipt({ hash: mockUSDCHash });
  deployments.mockUSDC = mockUSDCReceipt.contractAddress!;
  console.log(`✅ MockUSDC deployed at: ${deployments.mockUSDC}\n`);

  // 2. Deploy OracleGuard
  console.log('2️⃣  Deploying OracleGuard...');
  const oracleGuardArtifact = getContractArtifact('OracleGuard');
  const oracleGuardHash = await walletClient.deployContract({
    abi: oracleGuardArtifact.abi,
    bytecode: oracleGuardArtifact.bytecode.object,
    args: [],
  });
  const oracleGuardReceipt = await publicClient.waitForTransactionReceipt({ hash: oracleGuardHash });
  deployments.oracleGuard = oracleGuardReceipt.contractAddress!;
  console.log(`✅ OracleGuard deployed at: ${deployments.oracleGuard}\n`);

  // 3. Deploy TradingHoursGuard
  console.log('3️⃣  Deploying TradingHoursGuard...');
  const tradingHoursGuardArtifact = getContractArtifact('TradingHoursGuard');
  const tradingHoursGuardHash = await walletClient.deployContract({
    abi: tradingHoursGuardArtifact.abi,
    bytecode: tradingHoursGuardArtifact.bytecode.object,
    args: [],
  });
  const tradingHoursGuardReceipt = await publicClient.waitForTransactionReceipt({ hash: tradingHoursGuardHash });
  deployments.tradingHoursGuard = tradingHoursGuardReceipt.contractAddress!;
  console.log(`✅ TradingHoursGuard deployed at: ${deployments.tradingHoursGuard}\n`);

  // 4. Deploy UnifiedAccountVault
  console.log('4️⃣  Deploying UnifiedAccountVault...');
  const unifiedAccountVaultArtifact = getContractArtifact('UnifiedAccountVault');
  const unifiedAccountVaultHash = await walletClient.deployContract({
    abi: unifiedAccountVaultArtifact.abi,
    bytecode: unifiedAccountVaultArtifact.bytecode.object,
    args: [deployments.mockUSDC, account.address], // USDC address, owner
  });
  const unifiedAccountVaultReceipt = await publicClient.waitForTransactionReceipt({ hash: unifiedAccountVaultHash });
  deployments.unifiedAccountVault = unifiedAccountVaultReceipt.contractAddress!;
  console.log(`✅ UnifiedAccountVault deployed at: ${deployments.unifiedAccountVault}\n`);

  // 5. Deploy SecurityTokenVault
  console.log('5️⃣  Deploying SecurityTokenVault...');
  const securityTokenVaultArtifact = getContractArtifact('SecurityTokenVault');
  const securityTokenVaultHash = await walletClient.deployContract({
    abi: securityTokenVaultArtifact.abi,
    bytecode: securityTokenVaultArtifact.bytecode.object,
    args: [deployments.mockUSDC, account.address],
  });
  const securityTokenVaultReceipt = await publicClient.waitForTransactionReceipt({ hash: securityTokenVaultHash });
  deployments.securityTokenVault = securityTokenVaultReceipt.contractAddress!;
  console.log(`✅ SecurityTokenVault deployed at: ${deployments.securityTokenVault}\n`);

  // 6. Deploy BatchSettlementVault
  console.log('6️⃣  Deploying BatchSettlementVault...');
  const batchSettlementVaultArtifact = getContractArtifact('BatchSettlementVault');
  const batchSettlementVaultHash = await walletClient.deployContract({
    abi: batchSettlementVaultArtifact.abi,
    bytecode: batchSettlementVaultArtifact.bytecode.object,
    args: [deployments.mockUSDC, account.address],
  });
  const batchSettlementVaultReceipt = await publicClient.waitForTransactionReceipt({ hash: batchSettlementVaultHash });
  deployments.batchSettlementVault = batchSettlementVaultReceipt.contractAddress!;
  console.log(`✅ BatchSettlementVault deployed at: ${deployments.batchSettlementVault}\n`);

  // 7. Deploy PrivateSettlementVault
  console.log('7️⃣  Deploying PrivateSettlementVault...');
  const privateSettlementVaultArtifact = getContractArtifact('PrivateSettlementVault');
  const privateSettlementVaultHash = await walletClient.deployContract({
    abi: privateSettlementVaultArtifact.abi,
    bytecode: privateSettlementVaultArtifact.bytecode.object,
    args: [deployments.mockUSDC, account.address],
  });
  const privateSettlementVaultReceipt = await publicClient.waitForTransactionReceipt({ hash: privateSettlementVaultHash });
  deployments.privateSettlementVault = privateSettlementVaultReceipt.contractAddress!;
  console.log(`✅ PrivateSettlementVault deployed at: ${deployments.privateSettlementVault}\n`);

  // Save deployment addresses
  const deploymentsPath = path.join(__dirname, '../../deployments/base-sepolia.json');
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
  console.log('1. Verify contracts: npx ts-node scripts/deploy/verify-contracts.ts');
  console.log('2. Configure the API server with these addresses');
  console.log('3. Test settlement flows on testnet\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
