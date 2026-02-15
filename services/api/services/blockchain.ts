/**
 * Blockchain Service
 * 
 * Handles all blockchain interactions using viem
 */

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, keccak256, encodePacked } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';

// Load contract ABIs
const getContractAbi = (contractName: string) => {
  const artifactPath = path.join(__dirname, '../../../contracts/out', `${contractName}.sol`, `${contractName}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return artifact.abi;
};

// Contract ABIs
export const ABIS = {
  USDC: getContractAbi('MockUSDC'), // Same interface as real USDC
  UnifiedAccountVault: getContractAbi('UnifiedAccountVault'),
  SecurityTokenVault: getContractAbi('SecurityTokenVault'),
  BatchSettlementVault: getContractAbi('BatchSettlementVault'),
  PrivateSettlementVault: getContractAbi('PrivateSettlementVault'),
  OracleGuard: getContractAbi('OracleGuard'),
  TradingHoursGuard: getContractAbi('TradingHoursGuard'),
};

// Blockchain clients
const chain = config.network === 'mainnet' ? base : baseSepolia;

export const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
});

const keeperAccount = privateKeyToAccount(config.keeperPrivateKey as `0x${string}`);

export const walletClient = createWalletClient({
  account: keeperAccount,
  chain,
  transport: http(config.rpcUrl),
});

/**
 * Generate refId as bytes32 from venue and positionId
 */
export function generateRefId(venue: string, positionId: string): `0x${string}` {
  return keccak256(encodePacked(['string', 'string'], [venue, positionId]));
}

/**
 * Get USDC balance of an address
 */
export async function getUSDCBalance(address: `0x${string}`): Promise<string> {
  const balance = await publicClient.readContract({
    address: config.contracts.usdc,
    abi: ABIS.USDC,
    functionName: 'balanceOf',
    args: [address],
  }) as bigint;
  
  return formatUnits(balance, 6); // USDC has 6 decimals
}

/**
 * Get vault balance for a client (using balances mapping, not balanceOf)
 */
export async function getVaultBalance(vaultAddress: `0x${string}`, clientAddress: `0x${string}`): Promise<string> {
  const balance = await publicClient.readContract({
    address: vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'balances',
    args: [clientAddress],
  }) as bigint;
  
  return formatUnits(balance, 6);
}

/**
 * Get broker pool balance
 */
export async function getBrokerPoolBalance(vaultAddress: `0x${string}`): Promise<string> {
  const balance = await publicClient.readContract({
    address: vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'brokerPool',
  }) as bigint;
  
  return formatUnits(balance, 6);
}

/**
 * Get insurance fund balance
 */
export async function getInsuranceFundBalance(vaultAddress: `0x${string}`): Promise<string> {
  const balance = await publicClient.readContract({
    address: vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'insuranceFund',
  }) as bigint;
  
  return formatUnits(balance, 6);
}

/**
 * Get socialized loss
 */
export async function getSocializedLoss(vaultAddress: `0x${string}`): Promise<string> {
  const loss = await publicClient.readContract({
    address: vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'socializedLoss',
  }) as bigint;
  
  return formatUnits(loss, 6);
}

/**
 * Submit a settlement transaction (creditPnl or seizeCollateral)
 */
export async function submitSettlement(params: {
  vaultAddress: `0x${string}`;
  clientAddress: `0x${string}`;
  amount: string;
  settlementType: 'credit' | 'debit';
  refId: `0x${string}`;
}) {
  const amountWei = parseUnits(params.amount, 6);
  
  const hash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: params.settlementType === 'credit' ? 'creditPnl' : 'seizeCollateral',
    args: [params.clientAddress, amountWei, params.refId],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Submit settlement with guards (creditPnlWithGuards or seizeCollateralWithGuards)
 */
export async function submitSettlementWithGuards(params: {
  vaultAddress: `0x${string}`;
  clientAddress: `0x${string}`;
  amount: string;
  settlementType: 'credit' | 'debit';
  refId: `0x${string}`;
  refPrice: string;
}) {
  const amountWei = parseUnits(params.amount, 6);
  const refPriceWei = parseUnits(params.refPrice, 6);
  
  const hash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: params.settlementType === 'credit' ? 'creditPnlWithGuards' : 'seizeCollateralWithGuards',
    args: [params.clientAddress, amountWei, params.refId, refPriceWei],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Submit batch settlement with merkle proof
 */
export async function submitBatchSettlement(params: {
  vaultAddress: `0x${string}`;
  batchId: `0x${string}`;
  merkleRoot: `0x${string}`;
  settlements: Array<{
    user: `0x${string}`;
    netAmount: bigint;
    isCredit: boolean;
  }>;
}) {
  const hash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.BatchSettlementVault,
    functionName: 'submitBatch',
    args: [params.batchId, params.merkleRoot, params.settlements],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Get client positions from vault
 */
export async function getClientPositions(vaultAddress: `0x${string}`, clientAddress: `0x${string}`) {
  const balance = await getVaultBalance(vaultAddress, clientAddress);
  
  return {
    balance,
    openPositions: [], // TODO: Parse from events
    totalPnL: '0',
  };
}

/**
 * Trigger deposit to vault (depositCollateral)
 */
export async function depositToVault(params: {
  vaultAddress: `0x${string}`;
  amount: string;
  fromAddress?: `0x${string}`; // If not provided, uses keeper
}) {
  const amountWei = parseUnits(params.amount, 6);
  const fromAddress = params.fromAddress || keeperAccount.address;
  
  // First approve USDC
  const approveHash = await walletClient.writeContract({
    address: config.contracts.usdc,
    abi: ABIS.USDC,
    functionName: 'approve',
    args: [params.vaultAddress, amountWei],
  });
  
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  
  // Then deposit
  const depositHash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'depositCollateral',
    args: [amountWei],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  
  return {
    transactionHash: depositHash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Trigger withdrawal from vault (withdrawCollateral)
 */
export async function withdrawFromVault(params: {
  vaultAddress: `0x${string}`;
  amount: string;
}) {
  const amountWei = parseUnits(params.amount, 6);
  
  const hash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'withdrawCollateral',
    args: [amountWei],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Withdraw PnL from vault
 */
export async function withdrawPnL(params: {
  vaultAddress: `0x${string}`;
  amount: string;
}) {
  const amountWei = parseUnits(params.amount, 6);
  
  const hash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'withdrawPnL',
    args: [amountWei],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Broker deposit to pool
 */
export async function brokerDeposit(params: {
  vaultAddress: `0x${string}`;
  amount: string;
}) {
  const amountWei = parseUnits(params.amount, 6);
  
  // First approve USDC
  const approveHash = await walletClient.writeContract({
    address: config.contracts.usdc,
    abi: ABIS.USDC,
    functionName: 'approve',
    args: [params.vaultAddress, amountWei],
  });
  
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  
  // Then deposit
  const depositHash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'brokerDeposit',
    args: [amountWei],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  
  return {
    transactionHash: depositHash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Broker withdraw from pool
 */
export async function brokerWithdraw(params: {
  vaultAddress: `0x${string}`;
  amount: string;
}) {
  const amountWei = parseUnits(params.amount, 6);
  
  const hash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'brokerWithdraw',
    args: [amountWei],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Deposit to insurance fund (admin only)
 */
export async function depositInsuranceFund(params: {
  vaultAddress: `0x${string}`;
  amount: string;
}) {
  const amountWei = parseUnits(params.amount, 6);
  
  // First approve USDC
  const approveHash = await walletClient.writeContract({
    address: config.contracts.usdc,
    abi: ABIS.USDC,
    functionName: 'approve',
    args: [params.vaultAddress, amountWei],
  });
  
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  
  // Then deposit
  const depositHash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'depositInsuranceFund',
    args: [amountWei],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  
  return {
    transactionHash: depositHash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Withdraw from insurance fund (admin only)
 */
export async function withdrawInsuranceFund(params: {
  vaultAddress: `0x${string}`;
  amount: string;
}) {
  const amountWei = parseUnits(params.amount, 6);
  
  const hash = await walletClient.writeContract({
    address: params.vaultAddress,
    abi: ABIS.UnifiedAccountVault,
    functionName: 'withdrawInsuranceFund',
    args: [amountWei],
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

/**
 * Get current gas price
 */
export async function getGasPrice(): Promise<bigint> {
  return await publicClient.getGasPrice();
}

/**
 * Estimate gas for a settlement
 */
export async function estimateSettlementGas(params: {
  vaultAddress: `0x${string}`;
  amount: string;
  refId: `0x${string}`;
}): Promise<bigint> {
  try {
    const amountWei = parseUnits(params.amount, 6);
    
    const gas = await publicClient.estimateContractGas({
      address: params.vaultAddress,
      abi: ABIS.UnifiedAccountVault,
      functionName: 'creditPnl',
      args: [keeperAccount.address, amountWei, params.refId],
      account: keeperAccount,
    });
    
    return gas;
  } catch (error) {
    // Return a safe default if estimation fails
    return BigInt(200000);
  }
}
