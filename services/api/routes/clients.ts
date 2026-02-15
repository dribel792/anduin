/**
 * Clients Routes
 * 
 * Client onboarding, management, and configuration
 */

import { Router } from 'express';
import { AuthenticatedRequest, requireAdmin, generateApiKey, listApiKeys } from '../middleware/auth';
import { validateBody, createClientSchema, updateClientSchema } from '../middleware/validation';

const router = Router();

// In-memory client storage (TODO: Move to database)
interface Client {
  id: string;
  name: string;
  walletAddress: string;
  vaultType: string;
  vaultAddress?: string;
  nettingEnabled: boolean;
  apiKey?: string;
  createdAt: Date;
  riskLimits?: {
    maxPositionSize?: string;
    maxDailyVolume?: string;
  };
  stats?: {
    totalVolume: string;
    settlementCount: number;
    avgPnL: string;
  };
}

const clients = new Map<string, Client>();

// Initialize test clients
clients.set('client-1', {
  id: 'client-1',
  name: 'Test Client 1',
  walletAddress: '0x' + '1'.repeat(40),
  vaultType: 'unified',
  nettingEnabled: true,
  createdAt: new Date(),
});

/**
 * POST /api/v1/clients
 * Onboard new client
 */
router.post('/', requireAdmin, validateBody(createClientSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { name, walletAddress, vaultType, nettingEnabled, riskLimits } = req.body;
    
    const clientId = `client-${Date.now()}`;
    const apiKey = generateApiKey(clientId, name);
    
    const client: Client = {
      id: clientId,
      name,
      walletAddress,
      vaultType,
      nettingEnabled: nettingEnabled ?? true,
      apiKey,
      createdAt: new Date(),
      riskLimits,
    };
    
    clients.set(clientId, client);
    
    res.status(201).json({
      success: true,
      client,
      message: 'Client onboarded successfully. Save the API key securely.',
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Onboarding Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/clients
 * List all clients
 */
router.get('/', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const clientList = Array.from(clients.values()).map(client => ({
      ...client,
      apiKey: client.apiKey ? '***' + client.apiKey.slice(-8) : undefined, // Mask API key
    }));
    
    res.json({
      success: true,
      count: clientList.length,
      clients: clientList,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/clients/:id
 * Get client details and stats
 */
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    
    // Allow clients to view their own data or admin to view all
    if (!req.isAdmin && req.clientId !== id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only view your own client data',
      });
    }
    
    const client = clients.get(id);
    
    if (!client) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Client not found: ${id}`,
      });
    }
    
    // Mask API key for non-admin
    const responseClient = {
      ...client,
      apiKey: req.isAdmin ? client.apiKey : (client.apiKey ? '***' + client.apiKey.slice(-8) : undefined),
    };
    
    res.json({
      success: true,
      client: responseClient,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message,
    });
  }
});

/**
 * PUT /api/v1/clients/:id
 * Update client configuration
 */
router.put('/:id', requireAdmin, validateBody(updateClientSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const client = clients.get(id);
    
    if (!client) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Client not found: ${id}`,
      });
    }
    
    // Apply updates
    const updated = {
      ...client,
      ...updates,
    };
    
    clients.set(id, updated);
    
    res.json({
      success: true,
      client: updated,
      message: 'Client updated successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Update Error',
      message: error.message,
    });
  }
});

export default router;
