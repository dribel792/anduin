/**
 * Settlement Engine
 * 
 * Core logic for calculating PnL and executing settlements
 */

import { submitSettlement, getVaultBalance, generateRefId } from './blockchain';
import { config } from '../config';

export interface Position {
  id: string;
  clientId: string;
  symbol: string;
  venue: string; // Added for refId generation
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  openedAt: Date;
  closedAt?: Date;
  pnl?: number;
}

export interface Settlement {
  id: string;
  clientId: string;
  vaultAddress: `0x${string}`;
  amount: string;
  type: 'credit' | 'debit';
  status: 'pending' | 'confirmed' | 'failed';
  transactionHash?: string;
  refId: `0x${string}`; // Added refId
  createdAt: Date;
  confirmedAt?: Date;
  metadata?: {
    positionId?: string;
    symbol?: string;
    venue?: string;
    pnl?: number;
  };
}

// In-memory storage (TODO: Replace with database)
const settlements: Map<string, Settlement> = new Map();

/**
 * Calculate PnL for a position
 */
export function calculatePnL(position: Position): number {
  if (!position.exitPrice) {
    throw new Error('Cannot calculate PnL for open position');
  }
  
  const priceChange = position.exitPrice - position.entryPrice;
  const multiplier = position.side === 'long' ? 1 : -1;
  
  return priceChange * position.quantity * multiplier;
}

/**
 * Create a settlement request
 */
export async function createSettlement(params: {
  clientId: string;
  vaultAddress: `0x${string}`;
  amount: string;
  type: 'credit' | 'debit';
  venue: string;
  positionId: string;
  metadata?: any;
}): Promise<Settlement> {
  // Generate refId from venue and positionId
  const refId = generateRefId(params.venue, params.positionId);
  
  const settlement: Settlement = {
    id: generateSettlementId(),
    clientId: params.clientId,
    vaultAddress: params.vaultAddress,
    amount: params.amount,
    type: params.type,
    refId,
    status: 'pending',
    createdAt: new Date(),
    metadata: params.metadata,
  };
  
  settlements.set(settlement.id, settlement);
  
  return settlement;
}

/**
 * Execute a settlement on-chain
 */
export async function executeSettlement(settlementId: string): Promise<Settlement> {
  const settlement = settlements.get(settlementId);
  
  if (!settlement) {
    throw new Error(`Settlement not found: ${settlementId}`);
  }
  
  if (settlement.status !== 'pending') {
    throw new Error(`Settlement already processed: ${settlementId}`);
  }
  
  try {
    // Submit to blockchain with correct function signature
    const result = await submitSettlement({
      vaultAddress: settlement.vaultAddress,
      clientAddress: settlement.clientId as `0x${string}`, // Client address
      amount: settlement.amount,
      settlementType: settlement.type,
      refId: settlement.refId, // Include refId
    });
    
    // Update settlement
    settlement.status = result.status === 'success' ? 'confirmed' : 'failed';
    settlement.transactionHash = result.transactionHash;
    settlement.confirmedAt = new Date();
    
    settlements.set(settlementId, settlement);
    
    return settlement;
  } catch (error: any) {
    settlement.status = 'failed';
    settlements.set(settlementId, settlement);
    throw error;
  }
}

/**
 * Process position close and create settlement
 */
export async function processPositionClose(params: {
  position: Position;
  clientId: string;
  vaultAddress: `0x${string}`;
}): Promise<Settlement> {
  const pnl = calculatePnL(params.position);
  
  // Determine settlement type based on PnL
  const settlementType: 'credit' | 'debit' = pnl >= 0 ? 'credit' : 'debit';
  const amount = Math.abs(pnl).toFixed(6); // USDC has 6 decimals
  
  // Create settlement with venue and positionId for refId
  const settlement = await createSettlement({
    clientId: params.clientId,
    vaultAddress: params.vaultAddress,
    amount,
    type: settlementType,
    venue: params.position.venue,
    positionId: params.position.id,
    metadata: {
      positionId: params.position.id,
      symbol: params.position.symbol,
      venue: params.position.venue,
      pnl,
    },
  });
  
  // Execute immediately (or queue for batch processing)
  await executeSettlement(settlement.id);
  
  return settlement;
}

/**
 * Get settlement by ID
 */
export function getSettlement(settlementId: string): Settlement | undefined {
  return settlements.get(settlementId);
}

/**
 * List settlements with filters
 */
export function listSettlements(filters?: {
  clientId?: string;
  status?: Settlement['status'];
  fromDate?: Date;
  toDate?: Date;
}): Settlement[] {
  let results = Array.from(settlements.values());
  
  if (filters?.clientId) {
    results = results.filter(s => s.clientId === filters.clientId);
  }
  
  if (filters?.status) {
    results = results.filter(s => s.status === filters.status);
  }
  
  if (filters?.fromDate) {
    results = results.filter(s => s.createdAt >= filters.fromDate!);
  }
  
  if (filters?.toDate) {
    results = results.filter(s => s.createdAt <= filters.toDate!);
  }
  
  return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Generate unique settlement ID
 */
function generateSettlementId(): string {
  return `STL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
