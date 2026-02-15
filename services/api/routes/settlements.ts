/**
 * Settlements Routes
 * 
 * Handle settlement creation, listing, and batch operations
 */

import { Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { createSettlementSchema, batchSettlementSchema } from '../middleware/validation';
import {
  createSettlement,
  executeSettlement,
  getSettlement,
  listSettlements,
} from '../services/settlement-engine';
import { executeBatchSettlement } from '../services/netting-engine';

const router = Router();

/**
 * POST /api/v1/settlements
 * Submit a new settlement
 */
router.post('/', validateBody(createSettlementSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { clientId, vaultAddress, amount, type, metadata } = req.body;
    
    // Create settlement
    const settlement = await createSettlement({
      clientId,
      vaultAddress,
      amount,
      type,
      metadata,
    });
    
    // Execute immediately
    const executed = await executeSettlement(settlement.id);
    
    res.status(201).json({
      success: true,
      settlement: executed,
    });
  } catch (error: any) {
    console.error('Error creating settlement:', error);
    res.status(500).json({
      error: 'Settlement Error',
      message: error.message || 'Failed to create settlement',
    });
  }
});

/**
 * GET /api/v1/settlements
 * List settlements with filters
 */
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { clientId, status, fromDate, toDate } = req.query;
    
    const settlements = listSettlements({
      clientId: clientId as string,
      status: status as any,
      fromDate: fromDate ? new Date(fromDate as string) : undefined,
      toDate: toDate ? new Date(toDate as string) : undefined,
    });
    
    res.json({
      success: true,
      count: settlements.length,
      settlements,
    });
  } catch (error: any) {
    console.error('Error listing settlements:', error);
    res.status(500).json({
      error: 'Server Error',
      message: error.message || 'Failed to list settlements',
    });
  }
});

/**
 * GET /api/v1/settlements/:id
 * Get settlement details
 */
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    
    const settlement = getSettlement(id);
    
    if (!settlement) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Settlement not found: ${id}`,
      });
    }
    
    res.json({
      success: true,
      settlement,
    });
  } catch (error: any) {
    console.error('Error getting settlement:', error);
    res.status(500).json({
      error: 'Server Error',
      message: error.message || 'Failed to get settlement',
    });
  }
});

/**
 * POST /api/v1/settlements/batch
 * Submit batch settlement with merkle proof
 */
router.post('/batch', validateBody(batchSettlementSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { vaultAddress, settlements } = req.body;
    
    // Convert to nettable format
    const nettableSettlements = settlements.map((s: any) => ({
      clientId: s.clientId,
      amount: parseFloat(s.amount),
      vaultAddress,
    }));
    
    // Execute batch with netting
    const result = await executeBatchSettlement({
      settlements: nettableSettlements,
      vaultAddress,
    });
    
    res.status(201).json({
      success: true,
      transactionHash: result.transactionHash,
      netting: result.nettingResult,
    });
  } catch (error: any) {
    console.error('Error processing batch settlement:', error);
    res.status(500).json({
      error: 'Batch Settlement Error',
      message: error.message || 'Failed to process batch settlement',
    });
  }
});

export default router;
