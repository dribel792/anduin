import { createHash } from 'crypto';
import { ClosedPosition } from './types';

/**
 * Settlement Bridge: Maps venue position closes to on-chain settlement calls
 * 
 * This is the critical piece that translates off-chain trading events into
 * on-chain state changes in the VoleraSettlement contract.
 */

export interface SettlementAction {
  type: 'credit' | 'seize' | 'seizeCapped';
  user: string;           // User address
  amount: number;         // Amount in USD (6 decimals for USDC)
  refId: string;          // Unique reference ID for deduplication
  position: ClosedPosition;
}

export class SettlementBridge {
  private processedRefs: Set<string> = new Set();

  /**
   * Generate a unique reference ID for a position
   * refId = keccak256(venue + positionId)
   */
  private generateRefId(venue: string, positionId: string): string {
    const hash = createHash('sha256');
    hash.update(`${venue}:${positionId}`);
    return '0x' + hash.digest('hex').slice(0, 64); // 32 bytes as hex
  }

  /**
   * Convert a closed position to a settlement action
   * 
   * Rules:
   * - Profit → creditPnl(user, amount, refId)
   * - Loss → seizeCollateral(user, amount, refId) or seizeCollateralCapped
   */
  public mapPositionToSettlement(
    position: ClosedPosition,
    userAddress: string,
    cappedSeizure: boolean = false
  ): SettlementAction | null {
    const refId = this.generateRefId(position.venue, position.id);

    // Check for duplicate
    if (this.processedRefs.has(refId)) {
      console.warn(`[SettlementBridge] Duplicate refId detected: ${refId}`);
      return null;
    }

    this.processedRefs.add(refId);

    const amount = Math.abs(position.pnl);

    if (position.pnl > 0) {
      // Profit - credit the user
      return {
        type: 'credit',
        user: userAddress,
        amount,
        refId,
        position
      };
    } else if (position.pnl < 0) {
      // Loss - seize collateral
      return {
        type: cappedSeizure ? 'seizeCapped' : 'seize',
        user: userAddress,
        amount,
        refId,
        position
      };
    }

    // Break-even, no action needed
    return null;
  }

  /**
   * Batch process multiple positions
   */
  public batchMapPositions(
    positions: ClosedPosition[],
    userAddress: string,
    cappedSeizure: boolean = false
  ): SettlementAction[] {
    return positions
      .map(pos => this.mapPositionToSettlement(pos, userAddress, cappedSeizure))
      .filter((action): action is SettlementAction => action !== null);
  }

  /**
   * Check if a position has already been processed
   */
  public isProcessed(venue: string, positionId: string): boolean {
    const refId = this.generateRefId(venue, positionId);
    return this.processedRefs.has(refId);
  }

  /**
   * Clear processed refs (use with caution - for testing only)
   */
  public clearProcessedRefs(): void {
    this.processedRefs.clear();
  }
}

/**
 * Example usage:
 * 
 * const bridge = new SettlementBridge();
 * const action = bridge.mapPositionToSettlement(closedPosition, userAddress);
 * 
 * if (action) {
 *   switch (action.type) {
 *     case 'credit':
 *       await contract.creditPnl(action.user, action.amount, action.refId);
 *       break;
 *     case 'seize':
 *       await contract.seizeCollateral(action.user, action.amount, action.refId);
 *       break;
 *     case 'seizeCapped':
 *       await contract.seizeCollateralCapped(action.user, action.amount, action.refId);
 *       break;
 *   }
 * }
 */
