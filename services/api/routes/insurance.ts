/**
 * Insurance Routes
 * 
 * Manage insurance fund
 */

import { Router } from 'express';
import { AuthenticatedRequest, requireAdmin } from '../middleware/auth';
import { validateBody, insuranceDepositSchema } from '../middleware/validation';
import { getInsuranceFundBalance, depositToVault } from '../services/blockchain';
import { config } from '../config';

const router = Router();

// In-memory insurance history (TODO: Move to database)
interface InsuranceEvent {
  id: string;
  type: 'deposit' | 'withdrawal' | 'shortfall';
  amount: string;
  transactionHash?: string;
  createdAt: Date;
  metadata?: any;
}

const insuranceHistory: InsuranceEvent[] = [];

/**
 * GET /api/v1/insurance
 * Get insurance fund status
 */
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const balance = await getInsuranceFundBalance();
    
    res.json({
      success: true,
      balance,
      currency: 'USDC',
      fundAddress: config.contracts.unifiedAccountVault,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/insurance/deposit
 * Deposit to insurance fund
 */
router.post('/deposit', requireAdmin, validateBody(insuranceDepositSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { amount } = req.body;
    
    const result = await depositToVault({
      vaultAddress: config.contracts.unifiedAccountVault,
      amount,
      clientAddress: config.contracts.unifiedAccountVault, // Deposit to vault itself
    });
    
    // Record event
    const event: InsuranceEvent = {
      id: `INS-${Date.now()}`,
      type: 'deposit',
      amount,
      transactionHash: result.transactionHash,
      createdAt: new Date(),
    };
    
    insuranceHistory.push(event);
    
    res.status(201).json({
      success: true,
      event,
      transactionHash: result.transactionHash,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Deposit Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/insurance/history
 * Get insurance fund history
 */
router.get('/history', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { type, fromDate, toDate } = req.query;
    
    let filtered = insuranceHistory;
    
    if (type) {
      filtered = filtered.filter(e => e.type === type);
    }
    
    if (fromDate) {
      const from = new Date(fromDate as string);
      filtered = filtered.filter(e => e.createdAt >= from);
    }
    
    if (toDate) {
      const to = new Date(toDate as string);
      filtered = filtered.filter(e => e.createdAt <= to);
    }
    
    res.json({
      success: true,
      count: filtered.length,
      events: filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message,
    });
  }
});

export default router;
