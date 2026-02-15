/**
 * Verify deployed contracts on Basescan
 * 
 * Usage:
 *   npx ts-node scripts/deploy/verify-contracts.ts [--network testnet|mainnet]
 * 
 * Environment variables required:
 *   - BASESCAN_API_KEY: API key for Basescan
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

dotenv.config();

const execAsync = promisify(exec);

interface DeploymentAddresses {
  mockUSDC?: `0x${string}`;
  usdc?: `0x${string}`;
  unifiedAccountVault: `0x${string}`;
  securityTokenVault: `0x${string}`;
  batchSettlementVault: `0x${string}`;
  privateSettlementVault: `0x${string}`;
  oracleGuard: `0x${string}`;
  tradingHoursGuard: `0x${string}`;
  deployer: `0x${string}`;
}

async function verifyContract(
  contractAddress: string,
  contractPath: string,
  constructorArgs: string[],
  network: string
) {
  console.log(`\n🔍 Verifying ${contractPath} at ${contractAddress}...`);
  
  const argsString = constructorArgs.length > 0 
    ? `--constructor-args ${constructorArgs.join(' ')}` 
    : '';
  
  const chainId = network === 'mainnet' ? '8453' : '84532'; // Base mainnet : Base Sepolia
  
  try {
    const command = `cd contracts && forge verify-contract ${contractAddress} ${contractPath} --chain-id ${chainId} --watch ${argsString}`;
    console.log(`   Command: ${command}`);
    
    const { stdout, stderr } = await execAsync(command);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    
    console.log(`✅ Verified ${contractPath}`);
  } catch (error: any) {
    console.error(`❌ Failed to verify ${contractPath}:`, error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
  }
}

async function main() {
  const network = process.argv.includes('--network')
    ? process.argv[process.argv.indexOf('--network') + 1]
    : 'testnet';

  if (!['testnet', 'mainnet'].includes(network)) {
    throw new Error('Invalid network. Use --network testnet or --network mainnet');
  }

  console.log(`🚀 Verifying contracts on Base ${network}...\n`);

  // Load deployment addresses
  const deploymentsFile = network === 'mainnet' 
    ? 'base-mainnet.json' 
    : 'base-sepolia.json';
  const deploymentsPath = path.join(__dirname, '../../deployments', deploymentsFile);

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`Deployment file not found: ${deploymentsPath}`);
  }

  const deployments: DeploymentAddresses = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));

  // Verify each contract
  const usdcAddress = deployments.usdc || deployments.mockUSDC;
  
  if (!usdcAddress) {
    throw new Error('USDC address not found in deployments');
  }

  // MockUSDC (if deployed)
  if (deployments.mockUSDC) {
    await verifyContract(
      deployments.mockUSDC,
      'src/MockUSDC.sol:MockUSDC',
      [],
      network
    );
  }

  // OracleGuard
  await verifyContract(
    deployments.oracleGuard,
    'src/OracleGuard.sol:OracleGuard',
    [],
    network
  );

  // TradingHoursGuard
  await verifyContract(
    deployments.tradingHoursGuard,
    'src/TradingHoursGuard.sol:TradingHoursGuard',
    [],
    network
  );

  // UnifiedAccountVault
  await verifyContract(
    deployments.unifiedAccountVault,
    'src/UnifiedAccountVault.sol:UnifiedAccountVault',
    [usdcAddress, deployments.deployer],
    network
  );

  // SecurityTokenVault
  await verifyContract(
    deployments.securityTokenVault,
    'src/SecurityTokenVault.sol:SecurityTokenVault',
    [usdcAddress, deployments.deployer],
    network
  );

  // BatchSettlementVault
  await verifyContract(
    deployments.batchSettlementVault,
    'src/BatchSettlementVault.sol:BatchSettlementVault',
    [usdcAddress, deployments.deployer],
    network
  );

  // PrivateSettlementVault
  await verifyContract(
    deployments.privateSettlementVault,
    'src/PrivateSettlementVault.sol:PrivateSettlementVault',
    [usdcAddress, deployments.deployer],
    network
  );

  console.log('\n✨ Verification complete!\n');
  console.log('View verified contracts on Basescan:');
  const basescanUrl = network === 'mainnet' 
    ? 'https://basescan.org' 
    : 'https://sepolia.basescan.org';
  
  Object.entries(deployments).forEach(([key, value]) => {
    if (key !== 'deployedAt' && key !== 'network' && key !== 'deployer' && typeof value === 'string') {
      console.log(`${key}: ${basescanUrl}/address/${value}`);
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  });
