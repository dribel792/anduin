/**
 * Netting Engine
 * 
 * Calculate bilateral and multilateral netting to minimize settlement volumes
 */

import { MerkleTree } from 'merkletreejs';
import { keccak256, encodePacked } from 'viem';
import { submitBatchSettlement } from './blockchain';

export interface NettableSettlement {
  clientId: string;
  amount: number; // Positive = credit, negative = debit
  vaultAddress: `0x${string}`;
}

export interface NettingResult {
  originalVolume: number;
  nettedVolume: number;
  savings: number;
  savingsPercent: number;
  settlements: NettableSettlement[];
}

export interface MerkleProof {
  root: `0x${string}`;
  leaves: Array<{
    client: `0x${string}`;
    amount: string;
    proof: `0x${string}`[];
  }>;
}

/**
 * Calculate bilateral netting between two parties
 */
export function bilateralNetting(
  partyA: NettableSettlement,
  partyB: NettableSettlement
): NettableSettlement[] {
  if (partyA.vaultAddress !== partyB.vaultAddress) {
    throw new Error('Cannot net settlements from different vaults');
  }
  
  const netAmount = partyA.amount + partyB.amount;
  
  if (netAmount === 0) {
    // Complete offset - no settlement needed
    return [];
  }
  
  // Return single netted settlement
  return [{
    clientId: netAmount > 0 ? partyA.clientId : partyB.clientId,
    amount: Math.abs(netAmount),
    vaultAddress: partyA.vaultAddress,
  }];
}

/**
 * Calculate multilateral netting across multiple parties
 */
export function multilateralNetting(
  settlements: NettableSettlement[]
): NettingResult {
  // Group by vault
  const byVault = new Map<string, NettableSettlement[]>();
  
  for (const settlement of settlements) {
    const vault = settlement.vaultAddress;
    if (!byVault.has(vault)) {
      byVault.set(vault, []);
    }
    byVault.get(vault)!.push(settlement);
  }
  
  // Net within each vault
  const nettedSettlements: NettableSettlement[] = [];
  let originalVolume = 0;
  
  for (const [vault, vaultSettlements] of byVault.entries()) {
    // Sum all amounts per client
    const clientBalances = new Map<string, number>();
    
    for (const settlement of vaultSettlements) {
      originalVolume += Math.abs(settlement.amount);
      const current = clientBalances.get(settlement.clientId) || 0;
      clientBalances.set(settlement.clientId, current + settlement.amount);
    }
    
    // Create netted settlements for non-zero balances
    for (const [clientId, amount] of clientBalances.entries()) {
      if (amount !== 0) {
        nettedSettlements.push({
          clientId,
          amount,
          vaultAddress: vault as `0x${string}`,
        });
      }
    }
  }
  
  const nettedVolume = nettedSettlements.reduce((sum, s) => sum + Math.abs(s.amount), 0);
  const savings = originalVolume - nettedVolume;
  const savingsPercent = originalVolume > 0 ? (savings / originalVolume) * 100 : 0;
  
  return {
    originalVolume,
    nettedVolume,
    savings,
    savingsPercent,
    settlements: nettedSettlements,
  };
}

/**
 * Generate merkle tree and proofs for batch settlement
 */
export function generateMerkleProof(settlements: NettableSettlement[]): MerkleProof {
  // Create leaves: hash of (client, amount)
  const leaves = settlements.map(s => {
    const amountStr = Math.abs(s.amount).toString();
    return keccak256(
      encodePacked(
        ['address', 'uint256'],
        [s.clientId as `0x${string}`, BigInt(amountStr)]
      )
    );
  });
  
  // Build merkle tree
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot() as `0x${string}`;
  
  // Generate proofs for each leaf
  const leavesWithProofs = settlements.map((settlement, index) => {
    const proof = tree.getHexProof(leaves[index]) as `0x${string}`[];
    
    return {
      client: settlement.clientId as `0x${string}`,
      amount: Math.abs(settlement.amount).toString(),
      proof,
    };
  });
  
  return {
    root,
    leaves: leavesWithProofs,
  };
}

/**
 * Execute batch settlement with netting
 */
export async function executeBatchSettlement(params: {
  settlements: NettableSettlement[];
  vaultAddress: `0x${string}`;
}): Promise<{
  transactionHash: string;
  nettingResult: NettingResult;
}> {
  // Calculate netting
  const nettingResult = multilateralNetting(params.settlements);
  
  // Filter settlements for this vault
  const vaultSettlements = nettingResult.settlements.filter(
    s => s.vaultAddress === params.vaultAddress
  );
  
  if (vaultSettlements.length === 0) {
    throw new Error('No settlements for this vault after netting');
  }
  
  // Generate merkle proof
  const merkleProof = generateMerkleProof(vaultSettlements);
  
  // Submit to blockchain
  const result = await submitBatchSettlement({
    vaultAddress: params.vaultAddress,
    merkleRoot: merkleProof.root,
    settlements: merkleProof.leaves,
  });
  
  return {
    transactionHash: result.transactionHash,
    nettingResult,
  };
}

/**
 * Calculate optimal netting strategy
 * 
 * Determines whether bilateral or multilateral netting is more efficient
 */
export function optimizeNetting(settlements: NettableSettlement[]): {
  strategy: 'bilateral' | 'multilateral';
  result: NettingResult;
} {
  if (settlements.length <= 2) {
    // Bilateral netting
    const netted = settlements.length === 2 
      ? bilateralNetting(settlements[0], settlements[1])
      : settlements;
    
    const originalVolume = settlements.reduce((sum, s) => sum + Math.abs(s.amount), 0);
    const nettedVolume = netted.reduce((sum, s) => sum + Math.abs(s.amount), 0);
    
    return {
      strategy: 'bilateral',
      result: {
        originalVolume,
        nettedVolume,
        savings: originalVolume - nettedVolume,
        savingsPercent: ((originalVolume - nettedVolume) / originalVolume) * 100,
        settlements: netted,
      },
    };
  }
  
  // Multilateral netting
  const result = multilateralNetting(settlements);
  
  return {
    strategy: 'multilateral',
    result,
  };
}
