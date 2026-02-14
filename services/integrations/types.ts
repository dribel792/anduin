/**
 * Common interfaces for venue adapters
 */

export interface VenueAdapter {
  name: string;
  type: 'cex' | 'cfd';
  
  // Price feeds (public - no API key needed)
  connectPriceFeed(symbols: string[]): Promise<void>;
  onPrice(callback: (price: PriceUpdate) => void): void;
  disconnectPriceFeed(): void;
  
  // Position monitoring (needs API key)
  connectPositionFeed(apiKey: string, apiSecret: string, passphrase?: string): Promise<void>;
  onPositionClose(callback: (position: ClosedPosition) => void): void;
  
  // Account management (needs admin API key from venue)
  getAccountBalance(apiKey: string, apiSecret: string): Promise<Balance>;
}

export interface PriceUpdate {
  symbol: string;       // e.g., "BTCUSD", "XAUUSD"
  bid: number;
  ask: number;
  timestamp: number;
  venue: string;
}

export interface ClosedPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;          // Realized PnL in USD
  venue: string;
  closedAt: number;
}

export interface Balance {
  total: number;
  available: number;
  currency: string;
}
