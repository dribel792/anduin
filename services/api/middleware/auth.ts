/**
 * Authentication Middleware
 * 
 * API key-based authentication for clients
 */

import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import * as jwt from 'jsonwebtoken';

// In-memory API keys (TODO: Move to database)
const clientApiKeys = new Map<string, { clientId: string; name: string; active: boolean }>();

// Initialize with some test keys
clientApiKeys.set('test-key-1', { clientId: 'client-1', name: 'Test Client 1', active: true });
clientApiKeys.set('test-key-2', { clientId: 'client-2', name: 'Test Client 2', active: true });

export interface AuthenticatedRequest extends Request {
  clientId?: string;
  clientName?: string;
  isAdmin?: boolean;
}

/**
 * Authenticate API requests
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Include X-API-Key header.',
    });
  }
  
  // Check admin keys
  if (config.adminApiKeys.includes(apiKey)) {
    req.isAdmin = true;
    req.clientId = 'admin';
    req.clientName = 'Admin';
    return next();
  }
  
  // Check client keys
  const client = clientApiKeys.get(apiKey);
  
  if (!client) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key.',
    });
  }
  
  if (!client.active) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'API key is inactive.',
    });
  }
  
  req.clientId = client.clientId;
  req.clientName = client.name;
  
  next();
}

/**
 * Require admin role
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.isAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required.',
    });
  }
  
  next();
}

/**
 * Generate API key for a client
 */
export function generateApiKey(clientId: string, clientName: string): string {
  const apiKey = `anduin_${Buffer.from(`${clientId}:${Date.now()}`).toString('base64')}_${Math.random().toString(36).substr(2, 9)}`;
  
  clientApiKeys.set(apiKey, {
    clientId,
    name: clientName,
    active: true,
  });
  
  return apiKey;
}

/**
 * Revoke an API key
 */
export function revokeApiKey(apiKey: string): boolean {
  const client = clientApiKeys.get(apiKey);
  
  if (!client) {
    return false;
  }
  
  client.active = false;
  clientApiKeys.set(apiKey, client);
  
  return true;
}

/**
 * List all API keys (admin only)
 */
export function listApiKeys(): Array<{ apiKey: string; clientId: string; name: string; active: boolean }> {
  return Array.from(clientApiKeys.entries()).map(([apiKey, client]) => ({
    apiKey,
    ...client,
  }));
}

/**
 * Generate JWT token (for future use)
 */
export function generateJWT(payload: any, expiresIn: string = '24h'): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

/**
 * Verify JWT token (for future use)
 */
export function verifyJWT(token: string): any {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (error) {
    return null;
  }
}
