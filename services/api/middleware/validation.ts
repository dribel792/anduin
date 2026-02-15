/**
 * Request Validation Middleware
 * 
 * Zod-based request validation
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

/**
 * Ethereum address schema
 */
export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

/**
 * USDC amount schema (up to 6 decimals)
 */
export const amountSchema = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Invalid amount format');

/**
 * Settlement schemas
 */
export const createSettlementSchema = z.object({
  clientId: z.string().min(1),
  vaultAddress: addressSchema,
  amount: amountSchema,
  type: z.enum(['credit', 'debit']),
  metadata: z.any().optional(),
});

export const batchSettlementSchema = z.object({
  vaultAddress: addressSchema,
  settlements: z.array(z.object({
    clientId: z.string().min(1),
    amount: amountSchema,
  })).min(1),
});

/**
 * Vault schemas
 */
export const depositSchema = z.object({
  amount: amountSchema,
  clientAddress: addressSchema.optional(),
});

export const withdrawSchema = z.object({
  amount: amountSchema,
  clientAddress: addressSchema.optional(),
});

/**
 * Client schemas
 */
export const createClientSchema = z.object({
  name: z.string().min(1).max(100),
  walletAddress: addressSchema,
  vaultType: z.enum(['unified', 'security', 'batch', 'private']),
  nettingEnabled: z.boolean().default(true),
  riskLimits: z.object({
    maxPositionSize: amountSchema.optional(),
    maxDailyVolume: amountSchema.optional(),
  }).optional(),
});

export const updateClientSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  nettingEnabled: z.boolean().optional(),
  riskLimits: z.object({
    maxPositionSize: amountSchema.optional(),
    maxDailyVolume: amountSchema.optional(),
  }).optional(),
});

/**
 * Insurance schemas
 */
export const insuranceDepositSchema = z.object({
  amount: amountSchema,
});

/**
 * Netting schemas
 */
export const calculateNettingSchema = z.object({
  settlements: z.array(z.object({
    clientId: z.string().min(1),
    amount: z.number(),
    vaultAddress: addressSchema,
  })).min(2),
});

export const executeNettingSchema = z.object({
  vaultAddress: addressSchema,
  settlements: z.array(z.object({
    clientId: z.string().min(1),
    amount: z.number(),
    vaultAddress: addressSchema,
  })).min(1),
});

/**
 * Validate request body against schema
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated; // Replace with validated data
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request body',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      
      next(error);
    }
  };
}

/**
 * Validate request params against schema
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.params);
      req.params = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request parameters',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      
      next(error);
    }
  };
}

/**
 * Validate request query against schema
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.query);
      req.query = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid query parameters',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      
      next(error);
    }
  };
}
