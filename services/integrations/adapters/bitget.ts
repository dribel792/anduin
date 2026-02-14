import WebSocket from 'ws';
import { createHmac } from 'crypto';
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

/**
 * Bitget Exchange Adapter
 * 
 * API Documentation: https://www.bitget.com/api-doc/
 * 
 * WebSocket: wss://ws.bitget.com/v2/ws/public
 * REST API: https://api.bitget.com/api/v2
 * 
 * Symbols: BTCUSDT, ETHUSDT (USDT perpetuals)
 */

export class BitgetAdapter implements VenueAdapter {
  public readonly name = 'Bitget';
  public readonly type = 'cex' as const;

  private ws: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private restBaseUrl = 'https://api.bitget.com/api/v2';
  private publicWsUrl = 'wss://ws.bitget.com/v2/ws/public';
  private privateWsUrl = 'wss://ws.bitget.com/v2/ws/private';
  
  private priceCallbacks: Array<(price: PriceUpdate) => void> = [];
  private positionCallbacks: Array<(position: ClosedPosition) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Connect to Bitget public price feed
   */
  public async connectPriceFeed(symbols: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.publicWsUrl);

        this.ws.on('open', () => {
          console.log('[Bitget] WebSocket connected');
          
          // Subscribe to tickers
          this.ws!.send(JSON.stringify({
            op: 'subscribe',
            args: symbols.map(s => ({
              instType: 'USDT-FUTURES',
              channel: 'ticker',
              instId: s
            }))
          }));

          this.startHeartbeat();
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handlePublicMessage(data.toString());
        });

        this.ws.on('error', (error) => {
          console.error('[Bitget] WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('[Bitget] WebSocket closed');
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

      if (message.action === 'snapshot' || message.action === 'update') {
        const tick = message.data[0];
        if (tick) {
          const priceUpdate: PriceUpdate = {
            symbol: message.arg.instId,
            bid: parseFloat(tick.bestBid),
            ask: parseFloat(tick.bestAsk),
            timestamp: parseInt(tick.ts) || Date.now(),
            venue: this.name
          };

          this.priceCallbacks.forEach(cb => cb(priceUpdate));
        }
      } else if (message.event === 'pong') {
        // Heartbeat response
      }
    } catch (error) {
      console.error('[Bitget] Failed to parse message:', error);
    }
  }

  /**
   * Handle authenticated WebSocket messages
   */
  private handleAuthMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Bitget order fill event
      if (message.arg?.channel === 'fills') {
        for (const fill of message.data) {
          const position: ClosedPosition = {
            id: fill.orderId,
            symbol: fill.instId,
            side: fill.side === 'buy' ? 'long' : 'short',
            entryPrice: 0, // Would need position tracking
            exitPrice: parseFloat(fill.price),
            size: parseFloat(fill.size),
            pnl: parseFloat(fill.pnl || '0'),
            venue: this.name,
            closedAt: parseInt(fill.ts)
          };

          this.positionCallbacks.forEach(cb => cb(position));
        }
      }
    } catch (error) {
      console.error('[Bitget] Failed to parse auth message:', error);
    }
  }

  /**
   * Reconnection logic
   */
  private attemptReconnect(symbols: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Bitget] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[Bitget] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
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
        this.ws.send('ping');
      }
      if (this.authWs && this.authWs.readyState === WebSocket.OPEN) {
        this.authWs.send('ping');
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
    apiSecret: string,
    passphrase?: string
  ): Promise<void> {
    if (!passphrase) {
      throw new Error('Bitget requires passphrase for authentication');
    }

    return new Promise((resolve, reject) => {
      try {
        this.authWs = new WebSocket(this.privateWsUrl);

        this.authWs.on('open', () => {
          console.log('[Bitget] Authenticated WebSocket connected');
          
          // Authenticate
          const timestamp = Date.now().toString();
          const sign = createHmac('sha256', apiSecret)
            .update(timestamp + 'GET' + '/user/verify')
            .digest('base64');

          this.authWs!.send(JSON.stringify({
            op: 'login',
            args: [{
              apiKey,
              passphrase,
              timestamp,
              sign
            }]
          }));

          // Subscribe to fills
          this.authWs!.send(JSON.stringify({
            op: 'subscribe',
            args: [{
              instType: 'USDT-FUTURES',
              channel: 'fills',
              instId: 'default'
            }]
          }));

          resolve();
        });

        this.authWs.on('message', (data: WebSocket.Data) => {
          this.handleAuthMessage(data.toString());
        });

        this.authWs.on('error', (error) => {
          console.error('[Bitget] Auth WebSocket error:', error);
          reject(error);
        });

        this.authWs.on('close', () => {
          console.log('[Bitget] Auth WebSocket closed');
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
    const method = 'GET';
    const requestPath = '/api/v2/mix/account/accounts?productType=USDT-FUTURES';
    
    const signString = timestamp + method + requestPath;
    const sign = createHmac('sha256', apiSecret)
      .update(signString)
      .digest('base64');

    const response = await fetch(`${this.restBaseUrl}/mix/account/accounts?productType=USDT-FUTURES`, {
      headers: {
        'ACCESS-KEY': apiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': '', // Would need passphrase here too
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Bitget API error: ${response.statusText}`);
    }

    const data = await response.json();
    const account = data.data;

    return {
      total: parseFloat(account.equity || '0'),
      available: parseFloat(account.available || '0'),
      currency: 'USDT'
    };
  }
}
