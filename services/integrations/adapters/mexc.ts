import WebSocket from 'ws';
import { createHmac } from 'crypto';
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

/**
 * MEXC Exchange Adapter
 * 
 * API Documentation: https://mexcdevelop.github.io/apidocs/
 * 
 * WebSocket: wss://wbs.mexc.com/ws
 * REST API: https://api.mexc.com/api/v3
 * 
 * Symbols: BTCUSDT, ETHUSDT (spot and futures)
 */

export class MEXCAdapter implements VenueAdapter {
  public readonly name = 'MEXC';
  public readonly type = 'cex' as const;

  private ws: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private restBaseUrl = 'https://api.mexc.com/api/v3';
  private wsUrl = 'wss://wbs.mexc.com/ws';
  
  private priceCallbacks: Array<(price: PriceUpdate) => void> = [];
  private positionCallbacks: Array<(position: ClosedPosition) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Connect to MEXC public price feed
   */
  public async connectPriceFeed(symbols: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          console.log('[MEXC] WebSocket connected');
          
          // Subscribe to book tickers (best bid/ask)
          symbols.forEach(symbol => {
            this.ws!.send(JSON.stringify({
              method: 'SUBSCRIPTION',
              params: [`spot@public.bookTicker.v3.api@${symbol}`]
            }));
          });

          this.startHeartbeat();
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handlePublicMessage(data.toString());
        });

        this.ws.on('error', (error) => {
          console.error('[MEXC] WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('[MEXC] WebSocket closed');
          this.stopHeartbeat();
          this.attemptReconnect(symbols);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle public WebSocket messages
   */
  private handlePublicMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.c === 'spot@public.bookTicker.v3.api' && message.d) {
        const tick = message.d;
        const priceUpdate: PriceUpdate = {
          symbol: tick.s,
          bid: parseFloat(tick.b),
          ask: parseFloat(tick.a),
          timestamp: tick.t || Date.now(),
          venue: this.name
        };

        this.priceCallbacks.forEach(cb => cb(priceUpdate));
      } else if (message.msg === 'PONG') {
        // Heartbeat response
      }
    } catch (error) {
      console.error('[MEXC] Failed to parse message:', error);
    }
  }

  /**
   * Handle authenticated WebSocket messages
   */
  private handleAuthMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // MEXC order update event
      if (message.c === 'spot@private.orders.v3.api' && message.d) {
        const order = message.d;
        if (order.S === 'FILLED') {
          const position: ClosedPosition = {
            id: order.i,
            symbol: order.s,
            side: order.S === 'BUY' ? 'long' : 'short',
            entryPrice: 0, // Would need position tracking
            exitPrice: parseFloat(order.p),
            size: parseFloat(order.q),
            pnl: 0, // Would calculate from position
            venue: this.name,
            closedAt: order.t
          };

          this.positionCallbacks.forEach(cb => cb(position));
        }
      }
    } catch (error) {
      console.error('[MEXC] Failed to parse auth message:', error);
    }
  }

  /**
   * Reconnection logic
   */
  private attemptReconnect(symbols: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[MEXC] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[MEXC] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      this.connectPriceFeed(symbols);
    }, delay);
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: 'PING' }));
      }
      if (this.authWs && this.authWs.readyState === WebSocket.OPEN) {
        this.authWs.send(JSON.stringify({ method: 'PING' }));
      }
    }, 30000);
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
   * Connect to authenticated position feed
   */
  public async connectPositionFeed(
    apiKey: string,
    apiSecret: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.authWs = new WebSocket(this.wsUrl);

        this.authWs.on('open', () => {
          console.log('[MEXC] Authenticated WebSocket connected');
          
          // Authenticate with API key
          const timestamp = Date.now();
          const signature = createHmac('sha256', apiSecret)
            .update(`${apiKey}${timestamp}`)
            .digest('hex');

          this.authWs!.send(JSON.stringify({
            method: 'LOGIN',
            params: {
              apiKey,
              signature,
              timestamp
            }
          }));

          // Subscribe to order updates
          this.authWs!.send(JSON.stringify({
            method: 'SUBSCRIPTION',
            params: ['spot@private.orders.v3.api']
          }));

          resolve();
        });

        this.authWs.on('message', (data: WebSocket.Data) => {
          this.handleAuthMessage(data.toString());
        });

        this.authWs.on('error', (error) => {
          console.error('[MEXC] Auth WebSocket error:', error);
          reject(error);
        });

        this.authWs.on('close', () => {
          console.log('[MEXC] Auth WebSocket closed');
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Subscribe to position close events
   */
  public onPositionClose(callback: (position: ClosedPosition) => void): void {
    this.positionCallbacks.push(callback);
  }

  /**
   * Get account balance
   */
  public async getAccountBalance(apiKey: string, apiSecret: string): Promise<Balance> {
    const timestamp = Date.now().toString();
    const params = `timestamp=${timestamp}`;
    
    const signature = createHmac('sha256', apiSecret)
      .update(params)
      .digest('hex');

    const response = await fetch(
      `${this.restBaseUrl}/account?${params}&signature=${signature}`,
      {
        headers: {
          'X-MEXC-APIKEY': apiKey
        }
      }
    );

    if (!response.ok) {
      throw new Error(`MEXC API error: ${response.statusText}`);
    }

    const data = await response.json();
    const usdtBalance = data.balances.find((b: any) => b.asset === 'USDT');

    return {
      total: parseFloat(usdtBalance?.free || '0') + parseFloat(usdtBalance?.locked || '0'),
      available: parseFloat(usdtBalance?.free || '0'),
      currency: 'USDT'
    };
  }
}
