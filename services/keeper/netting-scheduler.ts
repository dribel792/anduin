/**
 * Netting Scheduler
 * 
 * Runs netting rounds on a schedule to optimize capital efficiency
 */

import * as dotenv from 'dotenv';
import { getKeeperConfig } from './config';

dotenv.config();

const config = getKeeperConfig();

interface PendingNettingSettlement {
  clientId: string;
  amount: number;
  vaultAddress: `0x${string}`;
}

const pendingSettlements: PendingNettingSettlement[] = [];

/**
 * Collect pending settlements for netting
 */
function collectPendingSettlements(): PendingNettingSettlement[] {
  // TODO: Query API or database for pending settlements
  // This is a placeholder
  return [...pendingSettlements];
}

/**
 * Calculate netting
 */
function calculateNetting(settlements: PendingNettingSettlement[]) {
  // Group by vault
  const byVault = new Map<string, PendingNettingSettlement[]>();
  
  for (const settlement of settlements) {
    const vault = settlement.vaultAddress;
    if (!byVault.has(vault)) {
      byVault.set(vault, []);
    }
    byVault.get(vault)!.push(settlement);
  }
  
  // Net within each vault
  const nettedResults = [];
  let totalSavings = 0;
  
  for (const [vault, vaultSettlements] of byVault.entries()) {
    const originalVolume = vaultSettlements.reduce((sum, s) => sum + Math.abs(s.amount), 0);
    
    // Sum amounts per client
    const clientBalances = new Map<string, number>();
    for (const s of vaultSettlements) {
      const current = clientBalances.get(s.clientId) || 0;
      clientBalances.set(s.clientId, current + s.amount);
    }
    
    // Create netted settlements
    const netted = Array.from(clientBalances.entries())
      .filter(([_, amount]) => amount !== 0)
      .map(([clientId, amount]) => ({
        clientId,
        amount,
        vaultAddress: vault as `0x${string}`,
      }));
    
    const nettedVolume = netted.reduce((sum, s) => sum + Math.abs(s.amount), 0);
    const savings = originalVolume - nettedVolume;
    totalSavings += savings;
    
    nettedResults.push({
      vault,
      originalVolume,
      nettedVolume,
      savings,
      savingsPercent: (savings / originalVolume) * 100,
      settlements: netted,
    });
  }
  
  return {
    results: nettedResults,
    totalSavings,
  };
}

/**
 * Execute netting round
 */
async function executeNettingRound() {
  console.log(`\n🔄 Starting netting round...`);
  
  const pending = collectPendingSettlements();
  
  if (pending.length === 0) {
    console.log(`   No pending settlements to net`);
    return;
  }
  
  console.log(`   Pending settlements: ${pending.length}`);
  
  const netting = calculateNetting(pending);
  
  console.log(`   Total savings: $${netting.totalSavings.toFixed(2)} USDC`);
  
  for (const result of netting.results) {
    console.log(`\n   Vault: ${result.vault}`);
    console.log(`   - Original volume: $${result.originalVolume.toFixed(2)}`);
    console.log(`   - Netted volume: $${result.nettedVolume.toFixed(2)}`);
    console.log(`   - Savings: $${result.savings.toFixed(2)} (${result.savingsPercent.toFixed(1)}%)`);
    console.log(`   - Settlements after netting: ${result.settlements.length}`);
    
    // TODO: Execute batch settlement via API or blockchain
    // For now, just log
  }
  
  // Clear pending (in production, remove only after successful execution)
  pendingSettlements.length = 0;
  
  console.log(`\n✅ Netting round complete\n`);
}

/**
 * Main scheduler loop
 */
async function main() {
  console.log(`\n📊 Netting Scheduler Starting...`);
  console.log(`   Network: ${config.network}`);
  console.log(`   Schedule: Every ${config.nettingInterval / 1000}s\n`);
  
  // Run netting on schedule
  setInterval(async () => {
    try {
      await executeNettingRound();
    } catch (error: any) {
      console.error(`❌ Netting round failed:`, error);
    }
  }, config.nettingInterval);
  
  console.log(`✅ Netting scheduler running\n`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n👋 Netting scheduler shutting down...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n👋 Netting scheduler shutting down...`);
  process.exit(0);
});

main().catch((error) => {
  console.error(`❌ Fatal error:`, error);
  process.exit(1);
});
