import { VenueAdapter, PriceUpdate } from './types';

/**
 * Aggregates price data across multiple venues
 * 
 * Provides:
 * - Best bid/ask across all venues
 * - VWAP (Volume-Weighted Average Price)
 * - Price deviation alerts
 */

export interface AggregatedPrice {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  venues: {
    [venue: string]: {
      bid: number;
      ask: number;
      timestamp: number;
    };
  };
  timestamp: number;
}

export class PriceAggregator {
  private adapters: VenueAdapter[] = [];
  private latestPrices: Map<string, Map<string, PriceUpdate>> = new Map(); // symbol -> venue -> price
  private callbacks: Array<(price: AggregatedPrice) => void> = [];
  private priceStaleThresholdMs = 30000; // 30 seconds

  /**
   * Add a venue adapter to the aggregator
   */
  public addAdapter(adapter: VenueAdapter): void {
    this.adapters.push(adapter);

    // Subscribe to price updates from this adapter
    adapter.onPrice((price) => {
      this.updatePrice(price);
    });
  }

  /**
   * Connect all adapters to price feeds for given symbols
   */
  public async connectAll(symbols: string[]): Promise<void> {
    await Promise.all(
      this.adapters.map(adapter => 
        adapter.connectPriceFeed(symbols).catch(err => {
          console.error(`Failed to connect ${adapter.name}:`, err);
        })
      )
    );
  }

  /**
   * Disconnect all adapters
   */
  public disconnectAll(): void {
    this.adapters.forEach(adapter => adapter.disconnectPriceFeed());
  }

  /**
   * Subscribe to aggregated price updates
   */
  public onAggregatedPrice(callback: (price: AggregatedPrice) => void): void {
    this.callbacks.push(callback);
  }

  /**
   * Update price from a venue and recalculate aggregated price
   */
  private updatePrice(update: PriceUpdate): void {
    if (!this.latestPrices.has(update.symbol)) {
      this.latestPrices.set(update.symbol, new Map());
    }

    const venuePrices = this.latestPrices.get(update.symbol)!;
    venuePrices.set(update.venue, update);

    // Calculate aggregated price
    const aggregated = this.calculateAggregatedPrice(update.symbol);
    if (aggregated) {
      this.callbacks.forEach(cb => cb(aggregated));
    }
  }

  /**
   * Calculate aggregated price for a symbol
   */
  private calculateAggregatedPrice(symbol: string): AggregatedPrice | null {
    const venuePrices = this.latestPrices.get(symbol);
    if (!venuePrices || venuePrices.size === 0) {
      return null;
    }

    const now = Date.now();
    const venues: AggregatedPrice['venues'] = {};
    let bestBid = 0;
    let bestAsk = Infinity;

    for (const [venue, price] of venuePrices.entries()) {
      // Skip stale prices
      if (now - price.timestamp > this.priceStaleThresholdMs) {
        continue;
      }

      venues[venue] = {
        bid: price.bid,
        ask: price.ask,
        timestamp: price.timestamp
      };

      bestBid = Math.max(bestBid, price.bid);
      bestAsk = Math.min(bestAsk, price.ask);
    }

    if (Object.keys(venues).length === 0) {
      return null;
    }

    return {
      symbol,
      bestBid,
      bestAsk,
      spread: bestAsk - bestBid,
      venues,
      timestamp: now
    };
  }

  /**
   * Get current aggregated price for a symbol
   */
  public getAggregatedPrice(symbol: string): AggregatedPrice | null {
    return this.calculateAggregatedPrice(symbol);
  }

  /**
   * Get all symbols being tracked
   */
  public getTrackedSymbols(): string[] {
    return Array.from(this.latestPrices.keys());
  }
}
