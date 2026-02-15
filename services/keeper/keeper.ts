/**
 * Settlement Keeper
 * 
 * Automated bot that listens for position closes and triggers settlements
 */

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, keccak256, encodePacked } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { getKeeperConfig } from './config';

dotenv.config();

const config = getKeeperConfig();

// Load vault ABI
const getContractAbi = (contractName: string) => {
  const artifactPath = path.join(__dirname, '../../contracts/out', `${contractName}.sol`, `${contractName}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return artifact.abi;
};

const VAULT_ABI = getContractAbi('UnifiedAccountVault');

// Setup blockchain clients
const chain = config.network === 'mainnet' ? base : baseSepolia;
const account = privateKeyToAccount(config.keeperPrivateKey as `0x${string}`);

const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
});

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(config.rpcUrl),
});

interface PendingSettlement {
  id: string;
  clientAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  amount: string;
  type: 'credit' | 'debit';
  refId: `0x${string}`;
  venue: string;
  positionId: string;
  retryCount: number;
  lastAttempt?: Date;
}

const pendingSettlements: PendingSettlement[] = [];

/**
 * Generate refId as bytes32 from venue and positionId
 */
function generateRefId(venue: string, positionId: string): `0x${string}` {
  return keccak256(encodePacked(['string', 'string'], [venue, positionId]));
}

/**
 * Process position close event
 */
async function processPositionClose(event: any) {
  console.log(`📊 Position closed:`, event);
  
  // Calculate PnL
  const pnl = calculatePnL(event);
  
  // Generate refId
  const refId = generateRefId(event.venue, event.positionId);
  
  // Create settlement
  const settlement: PendingSettlement = {
    id: `STL-${Date.now()}`,
    clientAddress: event.clientAddress,
    vaultAddress: event.vaultAddress,
    amount: Math.abs(pnl).toFixed(6), // USDC has 6 decimals
    type: pnl >= 0 ? 'credit' : 'debit',
    refId,
    venue: event.venue,
    positionId: event.positionId,
    retryCount: 0,
  };
  
  console.log(`💰 Settlement created: ${settlement.id} - ${settlement.type} ${settlement.amount} USDC`);
  
  // Execute settlement
  await executeSettlement(settlement);
}

/**
 * Calculate PnL from position close event
 */
function calculatePnL(event: any): number {
  const { entryPrice, exitPrice, quantity, side } = event;
  const priceChange = exitPrice - entryPrice;
  const multiplier = side === 'long' ? 1 : -1;
  return priceChange * quantity * multiplier;
}

/**
 * Execute settlement on-chain
 */
async function executeSettlement(settlement: PendingSettlement) {
  try {
    console.log(`🔄 Executing settlement ${settlement.id}...`);
    
    // Estimate gas
    const gasPrice = await publicClient.getGasPrice();
    const gasEstimate = BigInt(200000); // Conservative estimate
    const gasCost = gasPrice * gasEstimate;
    
    console.log(`   Gas estimate: ${formatUnits(gasCost, 18)} ETH`);
    
    // Convert amount to wei (USDC has 6 decimals)
    const amountWei = parseUnits(settlement.amount, 6);
    
    // Call the correct contract function
    const functionName = settlement.type === 'credit' ? 'creditPnl' : 'seizeCollateral';
    
    const hash = await walletClient.writeContract({
      address: settlement.vaultAddress,
      abi: VAULT_ABI,
      functionName,
      args: [settlement.clientAddress, amountWei, settlement.refId],
    });
    
    console.log(`   Transaction hash: ${hash}`);
    
    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === 'success') {
      console.log(`✅ Settlement ${settlement.id} executed successfully`);
      console.log(`   Block: ${receipt.blockNumber}`);
      settlement.retryCount = 0;
    } else {
      throw new Error('Transaction reverted');
    }
  } catch (error: any) {
    console.error(`❌ Settlement ${settlement.id} failed:`, error.message);
    
    settlement.retryCount++;
    settlement.lastAttempt = new Date();
    
    if (settlement.retryCount < config.maxRetries) {
      console.log(`   Retry ${settlement.retryCount}/${config.maxRetries} scheduled`);
      pendingSettlements.push(settlement);
    } else {
      console.error(`   Max retries reached for settlement ${settlement.id}`);
      // TODO: Alert admin via notification system
    }
  }
}

/**
 * Retry failed settlements
 */
async function retryFailedSettlements() {
  const now = Date.now();
  
  for (let i = pendingSettlements.length - 1; i >= 0; i--) {
    const settlement = pendingSettlements[i];
    
    // Wait exponential backoff before retry
    const backoffMs = Math.min(1000 * Math.pow(2, settlement.retryCount), 60000);
    const timeSinceLastAttempt = settlement.lastAttempt 
      ? now - settlement.lastAttempt.getTime() 
      : Infinity;
    
    if (timeSinceLastAttempt >= backoffMs) {
      console.log(`🔁 Retrying settlement ${settlement.id}...`);
      
      pendingSettlements.splice(i, 1);
      await executeSettlement(settlement);
    }
  }
}

/**
 * Monitor keeper health
 */
async function healthCheck() {
  try {
    const balance = await publicClient.getBalance({ address: account.address });
    const balanceEth = formatUnits(balance, 18);
    
    console.log(`💰 Keeper balance: ${balanceEth} ETH`);
    
    if (parseFloat(balanceEth) < 0.01) {
      console.warn(`⚠️  Low balance! Keeper may not have enough gas for settlements.`);
      // TODO: Alert admin via notification system
    }
    
    console.log(`📊 Pending settlements: ${pendingSettlements.length}`);
    
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`📦 Latest block: ${blockNumber}`);
    
    return {
      healthy: true,
      balance: balanceEth,
      pendingSettlements: pendingSettlements.length,
      blockNumber,
    };
  } catch (error: any) {
    console.error(`❌ Health check failed:`, error.message);
    return {
      healthy: false,
      error: error.message,
    };
  }
}

/**
 * Main keeper loop
 */
async function main() {
  console.log(`\n🤖 Settlement Keeper Starting...`);
  console.log(`   Network: ${config.network}`);
  console.log(`   Keeper address: ${account.address}`);
  console.log(`   Poll interval: ${config.pollInterval}ms\n`);
  
  // Initial health check
  await healthCheck();
  
  // Start monitoring loop
  setInterval(async () => {
    try {
      // Retry failed settlements
      await retryFailedSettlements();
      
      // TODO: Poll exchange adapters for new position closes
      // This would integrate with services/integrations/
      
      // Health check every 10 polls
      if (Math.random() < 0.1) {
        await healthCheck();
      }
    } catch (error: any) {
      console.error(`❌ Keeper loop error:`, error);
    }
  }, config.pollInterval);
  
  // Periodic health check (every 5 minutes)
  setInterval(async () => {
    await healthCheck();
  }, 5 * 60 * 1000);
  
  console.log(`✅ Keeper running\n`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n👋 Keeper shutting down...`);
  console.log(`   Pending settlements: ${pendingSettlements.length}`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n👋 Keeper shutting down...`);
  console.log(`   Pending settlements: ${pendingSettlements.length}`);
  process.exit(0);
});

main().catch((error) => {
  console.error(`❌ Fatal error:`, error);
  process.exit(1);
});
