import WebSocket from 'ws';
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

/**
 * MetaTrader 5 Adapter (CFD Brokers like JFD)
 * 
 * MT5 Manager API provides:
 * - Real-time tick data for CFD symbols (XAUUSD, XAGUSD, EURUSD, etc.)
 * - Position monitoring via WebSocket
 * - Account balance queries
 * 
 * Note: MT5 Manager API requires special broker credentials.
 * This adapter assumes a REST/WebSocket bridge is available.
 * 
 * API Structure (conceptual - varies by broker):
 * - WebSocket: wss://mt5-bridge.broker.com/ws
 * - REST: https://mt5-bridge.broker.com/api/v1
 */

export class MetaTraderAdapter implements VenueAdapter {
  public readonly name = 'MetaTrader';
  public readonly type = 'cfd' as const;

  private ws: WebSocket | null = null;
  private restBaseUrl = process.env.MT5_API_URL || 'https://mt5-bridge.example.com/api/v1';
  private wsUrl = process.env.MT5_WS_URL || 'wss://mt5-bridge.example.com/ws';
  
  private priceCallbacks: Array<(price: PriceUpdate) => void> = [];
  private positionCallbacks: Array<(position: ClosedPosition) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Connect to MT5 price feed (tick data)
   * Symbols: XAUUSD, XAGUSD, EURUSD, GBPUSD, etc.
   */
  public async connectPriceFeed(symbols: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          console.log('[MetaTrader] WebSocket connected');
          
          // Subscribe to tick data for symbols
          this.ws!.send(JSON.stringify({
            type: 'subscribe',
            channel: 'ticks',
            symbols
          }));

          this.startHeartbeat();
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('error', (error) => {
          console.error('[MetaTrader] WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('[MetaTrader] WebSocket closed');
          this.stopHeartbeat();
          this.attemptReconnect(symbols);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.type === 'tick') {
        // MT5 tick data: { symbol, bid, ask, timestamp }
        const priceUpdate: PriceUpdate = {
          symbol: message.symbol,
          bid: parseFloat(message.bid),
          ask: parseFloat(message.ask),
          timestamp: message.timestamp || Date.now(),
          venue: this.name
        };

        this.priceCallbacks.forEach(cb => cb(priceUpdate));
      } else if (message.type === 'position_closed') {
        // Position closed event
        const position: ClosedPosition = {
          id: message.ticket.toString(),
          symbol: message.symbol,
          side: message.type === 0 ? 'long' : 'short', // MT5: 0=buy, 1=sell
          entryPrice: parseFloat(message.price_open),
          exitPrice: parseFloat(message.price_close),
          size: parseFloat(message.volume),
          pnl: parseFloat(message.profit),
          venue: this.name,
          closedAt: message.time_close * 1000 // MT5 uses seconds
        };

        this.positionCallbacks.forEach(cb => cb(position));
      }
    } catch (error) {
      console.error('[MetaTrader] Failed to parse message:', error);
    }
  }

  /**
   * Reconnection logic
   */
  private attemptReconnect(symbols: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[MetaTrader] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[MetaTrader] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      this.connectPriceFeed(symbols);
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // 30 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Subscribe to price updates
   */
  public onPrice(callback: (price: PriceUpdate) => void): void {
    this.priceCallbacks.push(callback);
  }

  /**
   * Disconnect price feed
   */
  public disconnectPriceFeed(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Connect to position feed (requires MT5 Manager API credentials)
   */
  public async connectPositionFeed(
    apiKey: string,
    apiSecret: string,
    passphrase?: string
  ): Promise<void> {
    // Authenticate and subscribe to position events
    if (!this.ws) {
      throw new Error('WebSocket not connected. Call connectPriceFeed first.');
    }

    this.ws.send(JSON.stringify({
      type: 'auth',
      api_key: apiKey,
      api_secret: apiSecret
    }));

    this.ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'positions'
    }));
  }

  /**
   * Subscribe to position close events
   */
  public onPositionClose(callback: (position: ClosedPosition) => void): void {
    this.positionCallbacks.push(callback);
  }

  /**
   * Get account balance (requires MT5 Manager API)
   */
  public async getAccountBalance(apiKey: string, apiSecret: string): Promise<Balance> {
    const response = await fetch(`${this.restBaseUrl}/account/balance`, {
      headers: {
        'X-API-Key': apiKey,
        'X-API-Secret': apiSecret
      }
    });

    if (!response.ok) {
      throw new Error(`MT5 API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      total: parseFloat(data.balance),
      available: parseFloat(data.margin_free),
      currency: data.currency || 'USD'
    };
  }
}
