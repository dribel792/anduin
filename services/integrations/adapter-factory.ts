import { VenueAdapter } from './types';
import { MetaTraderAdapter } from './adapters/metatrader';
import { KrakenAdapter } from './adapters/kraken';
import { BybitAdapter } from './adapters/bybit';
import { BitgetAdapter } from './adapters/bitget';
import { OKXAdapter } from './adapters/okx';
import { MEXCAdapter } from './adapters/mexc';
import { KuCoinAdapter } from './adapters/kucoin';
import { HTXAdapter } from './adapters/htx';

/**
 * Factory to create venue adapters by name
 */

export type VenueName = 
  | 'metatrader' 
  | 'kraken' 
  | 'bybit' 
  | 'bitget' 
  | 'okx' 
  | 'mexc' 
  | 'kucoin' 
  | 'htx';

export class AdapterFactory {
  /**
   * Create an adapter by venue name
   */
  static createAdapter(venueName: VenueName): VenueAdapter {
    switch (venueName) {
      case 'metatrader':
        return new MetaTraderAdapter();
      case 'kraken':
        return new KrakenAdapter();
      case 'bybit':
        return new BybitAdapter();
      case 'bitget':
        return new BitgetAdapter();
      case 'okx':
        return new OKXAdapter();
      case 'mexc':
        return new MEXCAdapter();
      case 'kucoin':
        return new KuCoinAdapter();
      case 'htx':
        return new HTXAdapter();
      default:
        throw new Error(`Unknown venue: ${venueName}`);
    }
  }

  /**
   * Create multiple adapters
   */
  static createAdapters(venueNames: VenueName[]): VenueAdapter[] {
    return venueNames.map(name => this.createAdapter(name));
  }

  /**
   * Get all supported venue names
   */
  static getSupportedVenues(): VenueName[] {
    return ['metatrader', 'kraken', 'bybit', 'bitget', 'okx', 'mexc', 'kucoin', 'htx'];
  }
}
