/**
 * Keeper Health Check
 * 
 * Monitor keeper health and alert on failures
 */

import { createPublicClient, http, formatUnits } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { getKeeperConfig } from './config';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const config = getKeeperConfig();

const chain = config.network === 'mainnet' ? base : baseSepolia;
const account = privateKeyToAccount(config.keeperPrivateKey as `0x${string}`);

const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
});

interface HealthStatus {
  timestamp: Date;
  healthy: boolean;
  checks: {
    rpcConnection: boolean;
    keeperBalance: boolean;
    blockHeight: boolean;
  };
  metrics: {
    balance: string;
    blockNumber: bigint;
    gasPrice: string;
  };
  alerts: string[];
}

const healthHistory: HealthStatus[] = [];

/**
 * Run health checks
 */
async function runHealthChecks(): Promise<HealthStatus> {
  const checks = {
    rpcConnection: false,
    keeperBalance: false,
    blockHeight: false,
  };
  
  const alerts: string[] = [];
  
  try {
    // Check RPC connection
    const blockNumber = await publicClient.getBlockNumber();
    checks.rpcConnection = true;
    checks.blockHeight = true;
    
    // Check keeper balance
    const balance = await publicClient.getBalance({ address: account.address });
    const balanceEth = formatUnits(balance, 18);
    checks.keeperBalance = parseFloat(balanceEth) > 0.01;
    
    if (!checks.keeperBalance) {
      alerts.push(`Low keeper balance: ${balanceEth} ETH`);
    }
    
    // Check gas price
    const gasPrice = await publicClient.getGasPrice();
    const gasPriceGwei = formatUnits(gasPrice, 9);
    
    if (parseFloat(gasPriceGwei) > 100) {
      alerts.push(`High gas price: ${gasPriceGwei} gwei`);
    }
    
    const status: HealthStatus = {
      timestamp: new Date(),
      healthy: Object.values(checks).every(v => v),
      checks,
      metrics: {
        balance: balanceEth,
        blockNumber,
        gasPrice: gasPriceGwei,
      },
      alerts,
    };
    
    healthHistory.push(status);
    
    // Keep only last 100 health checks
    if (healthHistory.length > 100) {
      healthHistory.shift();
    }
    
    return status;
  } catch (error: any) {
    console.error(`❌ Health check error:`, error.message);
    
    return {
      timestamp: new Date(),
      healthy: false,
      checks,
      metrics: {
        balance: '0',
        blockNumber: BigInt(0),
        gasPrice: '0',
      },
      alerts: [`Health check failed: ${error.message}`],
    };
  }
}

/**
 * Save health report to file
 */
function saveHealthReport(status: HealthStatus) {
  const reportPath = path.join(__dirname, '../../logs/keeper-health.json');
  
  try {
    // Ensure logs directory exists
    const logsDir = path.dirname(reportPath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Convert BigInt to string for JSON
    const serializable = {
      ...status,
      metrics: {
        ...status.metrics,
        blockNumber: status.metrics.blockNumber.toString(),
      },
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(serializable, null, 2));
  } catch (error: any) {
    console.error(`Failed to save health report:`, error.message);
  }
}

/**
 * Alert on failures
 */
function sendAlerts(status: HealthStatus) {
  if (!status.healthy || status.alerts.length > 0) {
    console.error(`\n⚠️  KEEPER HEALTH ALERT\n`);
    console.error(`Timestamp: ${status.timestamp.toISOString()}`);
    console.error(`Healthy: ${status.healthy}`);
    console.error(`\nChecks:`);
    Object.entries(status.checks).forEach(([check, passed]) => {
      console.error(`  ${passed ? '✅' : '❌'} ${check}`);
    });
    
    if (status.alerts.length > 0) {
      console.error(`\nAlerts:`);
      status.alerts.forEach(alert => console.error(`  - ${alert}`));
    }
    
    console.error(`\n`);
    
    // TODO: Send to monitoring system (PagerDuty, Slack, etc.)
  }
}

/**
 * Main health check loop
 */
async function main() {
  console.log(`\n🏥 Keeper Health Check Starting...`);
  console.log(`   Network: ${config.network}`);
  console.log(`   Keeper: ${account.address}\n`);
  
  // Run initial check
  const initialStatus = await runHealthChecks();
  console.log(`Initial health check:`, initialStatus.healthy ? '✅ Healthy' : '❌ Unhealthy');
  saveHealthReport(initialStatus);
  sendAlerts(initialStatus);
  
  // Run periodic checks
  setInterval(async () => {
    const status = await runHealthChecks();
    
    console.log(`[${status.timestamp.toISOString()}] Health: ${status.healthy ? '✅' : '❌'} | Balance: ${status.metrics.balance} ETH | Block: ${status.metrics.blockNumber} | Gas: ${status.metrics.gasPrice} gwei`);
    
    saveHealthReport(status);
    sendAlerts(status);
  }, config.healthCheckInterval);
  
  console.log(`✅ Health check running (every ${config.healthCheckInterval / 1000}s)\n`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n👋 Health check shutting down...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n👋 Health check shutting down...`);
  process.exit(0);
});

main().catch((error) => {
  console.error(`❌ Fatal error:`, error);
  process.exit(1);
});
