/**
 * API Server Configuration
 * 
 * All configuration is loaded from environment variables
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

export interface Config {
  // Server
  port: number;
  nodeEnv: string;
  apiVersion: string;
  
  // Blockchain
  rpcUrl: string;
  chainId: number;
  network: 'testnet' | 'mainnet';
  
  // Contract Addresses
  contracts: {
    usdc: `0x${string}`;
    unifiedAccountVault: `0x${string}`;
    securityTokenVault: `0x${string}`;
    batchSettlementVault: `0x${string}`;
    privateSettlementVault: `0x${string}`;
    oracleGuard: `0x${string}`;
    tradingHoursGuard: `0x${string}`;
  };
  
  // Security
  adminApiKeys: string[];
  jwtSecret: string;
  
  // Rate Limiting
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  
  // Keeper
  keeperPrivateKey: string;
  
  // Database (for future use)
  databaseUrl?: string;
}

/**
 * Load deployment addresses from deployments directory
 */
function loadDeploymentAddresses(network: 'testnet' | 'mainnet') {
  const filename = network === 'mainnet' ? 'base-mainnet.json' : 'base-sepolia.json';
  const deploymentsPath = path.join(__dirname, '../../deployments', filename);
  
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`Deployment file not found: ${deploymentsPath}. Run deployment scripts first.`);
  }
  
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
  
  return {
    usdc: deployments.usdc || deployments.mockUSDC,
    unifiedAccountVault: deployments.unifiedAccountVault,
    securityTokenVault: deployments.securityTokenVault,
    batchSettlementVault: deployments.batchSettlementVault,
    privateSettlementVault: deployments.privateSettlementVault,
    oracleGuard: deployments.oracleGuard,
    tradingHoursGuard: deployments.tradingHoursGuard,
  };
}

/**
 * Build configuration from environment variables
 */
export function getConfig(): Config {
  const network = (process.env.NETWORK || 'testnet') as 'testnet' | 'mainnet';
  
  // Validate required env vars
  const requiredVars = ['RPC_URL', 'KEEPER_PRIVATE_KEY', 'JWT_SECRET'];
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }
  
  const contracts = loadDeploymentAddresses(network);
  
  return {
    // Server
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    apiVersion: 'v1',
    
    // Blockchain
    rpcUrl: process.env.RPC_URL!,
    chainId: network === 'mainnet' ? 8453 : 84532, // Base mainnet : Base Sepolia
    network,
    
    // Contracts
    contracts,
    
    // Security
    adminApiKeys: (process.env.ADMIN_API_KEYS || '').split(',').filter(Boolean),
    jwtSecret: process.env.JWT_SECRET!,
    
    // Rate Limiting
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute default
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    },
    
    // Keeper
    keeperPrivateKey: process.env.KEEPER_PRIVATE_KEY!,
    
    // Database
    databaseUrl: process.env.DATABASE_URL,
  };
}

export const config = getConfig();
