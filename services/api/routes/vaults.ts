/**
 * Vaults Routes
 * 
 * Manage vault balances, deposits, and withdrawals
 */

import { Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateBody, validateParams, depositSchema, withdrawSchema, addressSchema } from '../middleware/validation';
import {
  getVaultBalance,
  getClientPositions,
  depositToVault,
  withdrawFromVault,
} from '../services/blockchain';
import { config } from '../config';
import { z } from 'zod';

const router = Router();

/**
 * GET /api/v1/vaults
 * List all vaults
 */
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const vaults = [
      { name: 'UnifiedAccountVault', address: config.contracts.unifiedAccountVault, type: 'unified' },
      { name: 'SecurityTokenVault', address: config.contracts.securityTokenVault, type: 'security' },
      { name: 'BatchSettlementVault', address: config.contracts.batchSettlementVault, type: 'batch' },
      { name: 'PrivateSettlementVault', address: config.contracts.privateSettlementVault, type: 'private' },
    ];
    
    res.json({
      success: true,
      count: vaults.length,
      vaults,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/vaults/:address/balance
 * Get vault balance for client
 */
router.get('/:address/balance', validateParams(z.object({ address: addressSchema })), async (req: AuthenticatedRequest, res) => {
  try {
    const { address } = req.params;
    const clientAddress = (req.query.client as string) || req.clientId;
    
    if (!clientAddress) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Client address required',
      });
    }
    
    const balance = await getVaultBalance(address as `0x${string}`, clientAddress as `0x${string}`);
    
    res.json({
      success: true,
      vaultAddress: address,
      clientAddress,
      balance,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/vaults/:address/positions
 * Get open positions for client
 */
router.get('/:address/positions', validateParams(z.object({ address: addressSchema })), async (req: AuthenticatedRequest, res) => {
  try {
    const { address } = req.params;
    const clientAddress = (req.query.client as string) || req.clientId;
    
    if (!clientAddress) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Client address required',
      });
    }
    
    const positions = await getClientPositions(address as `0x${string}`, clientAddress as `0x${string}`);
    
    res.json({
      success: true,
      vaultAddress: address,
      clientAddress,
      ...positions,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/vaults/:address/deposit
 * Trigger deposit to vault
 */
router.post('/:address/deposit', validateParams(z.object({ address: addressSchema })), validateBody(depositSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { address } = req.params;
    const { amount, clientAddress } = req.body;
    
    const targetClient = clientAddress || req.clientId;
    
    if (!targetClient) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Client address required',
      });
    }
    
    const result = await depositToVault({
      vaultAddress: address as `0x${string}`,
      amount,
      clientAddress: targetClient as `0x${string}`,
    });
    
    res.status(201).json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Deposit Error',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/vaults/:address/withdraw
 * Trigger withdrawal from vault
 */
router.post('/:address/withdraw', validateParams(z.object({ address: addressSchema })), validateBody(withdrawSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { address } = req.params;
    const { amount, clientAddress } = req.body;
    
    const targetClient = clientAddress || req.clientId;
    
    if (!targetClient) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Client address required',
      });
    }
    
    const result = await withdrawFromVault({
      vaultAddress: address as `0x${string}`,
      amount,
      clientAddress: targetClient as `0x${string}`,
    });
    
    res.status(201).json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Withdrawal Error',
      message: error.message,
    });
  }
});

export default router;
