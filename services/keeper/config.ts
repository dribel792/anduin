/**
 * Keeper Configuration
 */

import * as dotenv from 'dotenv';

dotenv.config();

export interface KeeperConfig {
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
  keeperPrivateKey: string;
  
  // Polling
  pollInterval: number; // ms
  nettingInterval: number; // ms
  healthCheckInterval: number; // ms
  
  // Retry logic
  maxRetries: number;
  retryBackoffMs: number;
  
  // Gas management
  maxGasPrice: bigint; // wei
  gasLimit: bigint;
  
  // Monitoring
  alertWebhook?: string;
}

export function getKeeperConfig(): KeeperConfig {
  const network = (process.env.NETWORK || 'testnet') as 'testnet' | 'mainnet';
  
  if (!process.env.RPC_URL || !process.env.KEEPER_PRIVATE_KEY) {
    throw new Error('Missing required environment variables: RPC_URL, KEEPER_PRIVATE_KEY');
  }
  
  return {
    network,
    rpcUrl: process.env.RPC_URL,
    keeperPrivateKey: process.env.KEEPER_PRIVATE_KEY,
    
    // Polling intervals
    pollInterval: parseInt(process.env.KEEPER_POLL_INTERVAL || '10000', 10), // 10s default
    nettingInterval: parseInt(process.env.NETTING_INTERVAL || '3600000', 10), // 1 hour default
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000', 10), // 1 min default
    
    // Retry logic
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    retryBackoffMs: parseInt(process.env.RETRY_BACKOFF_MS || '1000', 10),
    
    // Gas management
    maxGasPrice: BigInt(process.env.MAX_GAS_PRICE || '100000000000'), // 100 gwei default
    gasLimit: BigInt(process.env.GAS_LIMIT || '500000'),
    
    // Monitoring
    alertWebhook: process.env.ALERT_WEBHOOK,
  };
}
