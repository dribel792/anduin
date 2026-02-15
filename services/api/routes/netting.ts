/**
 * Netting Routes
 * 
 * Calculate and execute netting
 */

import { Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateBody, calculateNettingSchema, executeNettingSchema } from '../middleware/validation';
import { multilateralNetting, optimizeNetting, executeBatchSettlement } from '../services/netting-engine';

const router = Router();

// In-memory netting history (TODO: Move to database)
interface NettingRound {
  id: string;
  originalVolume: number;
  nettedVolume: number;
  savings: number;
  savingsPercent: number;
  settlementsCount: number;
  transactionHash?: string;
  executedAt: Date;
}

const nettingHistory: NettingRound[] = [];

/**
 * POST /api/v1/netting/calculate
 * Calculate netting for a set of positions
 */
router.post('/calculate', validateBody(calculateNettingSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { settlements } = req.body;
    
    const result = optimizeNetting(settlements);
    
    res.json({
      success: true,
      strategy: result.strategy,
      netting: result.result,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Calculation Error',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/netting/execute
 * Execute netted settlement
 */
router.post('/execute', validateBody(executeNettingSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { vaultAddress, settlements } = req.body;
    
    const result = await executeBatchSettlement({
      settlements,
      vaultAddress,
    });
    
    // Record netting round
    const round: NettingRound = {
      id: `NET-${Date.now()}`,
      originalVolume: result.nettingResult.originalVolume,
      nettedVolume: result.nettingResult.nettedVolume,
      savings: result.nettingResult.savings,
      savingsPercent: result.nettingResult.savingsPercent,
      settlementsCount: result.nettingResult.settlements.length,
      transactionHash: result.transactionHash,
      executedAt: new Date(),
    };
    
    nettingHistory.push(round);
    
    res.status(201).json({
      success: true,
      transactionHash: result.transactionHash,
      netting: result.nettingResult,
      round,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Execution Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/netting/history
 * Get past netting rounds
 */
router.get('/history', async (req: AuthenticatedRequest, res) => {
  try {
    const { fromDate, toDate, limit } = req.query;
    
    let filtered = nettingHistory;
    
    if (fromDate) {
      const from = new Date(fromDate as string);
      filtered = filtered.filter(r => r.executedAt >= from);
    }
    
    if (toDate) {
      const to = new Date(toDate as string);
      filtered = filtered.filter(r => r.executedAt <= to);
    }
    
    // Sort by most recent first
    filtered.sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());
    
    if (limit) {
      filtered = filtered.slice(0, parseInt(limit as string, 10));
    }
    
    // Calculate aggregate stats
    const totalSavings = filtered.reduce((sum, r) => sum + r.savings, 0);
    const avgSavingsPercent = filtered.length > 0
      ? filtered.reduce((sum, r) => sum + r.savingsPercent, 0) / filtered.length
      : 0;
    
    res.json({
      success: true,
      count: filtered.length,
      rounds: filtered,
      aggregates: {
        totalSavings,
        avgSavingsPercent,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message,
    });
  }
});

export default router;
