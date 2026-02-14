import WebSocket from 'ws';
import { createHmac } from 'crypto';
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

/**
 * Kraken Exchange Adapter
 * 
 * API Documentation: https://docs.kraken.com/api/
 * 
 * Public WebSocket: wss://ws.kraken.com/v2
 * REST API: https://api.kraken.com/0/public/* (public), /0/private/* (authenticated)
 * 
 * Symbols: BTC/USD, ETH/USD, XBT/USD (perps)
 * Note: Kraken uses "XBT" for Bitcoin in some contexts
 */

export class KrakenAdapter implements VenueAdapter {
  public readonly name = 'Kraken';
  public readonly type = 'cex' as const;

  private ws: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private restBaseUrl = 'https://api.kraken.com';
  private wsUrl = 'wss://ws.kraken.com/v2';
  
  private priceCallbacks: Array<(price: PriceUpdate) => void> = [];
  private positionCallbacks: Array<(position: ClosedPosition) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Connect to Kraken public price feed
   */
  public async connectPriceFeed(symbols: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          console.log('[Kraken] WebSocket connected');
          
          // Subscribe to ticker for symbols
          // Kraken V2 format
          this.ws!.send(JSON.stringify({
            method: 'subscribe',
            params: {
              channel: 'ticker',
              symbol: symbols
            }
          }));

          this.startHeartbeat();
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handlePublicMessage(data.toString());
        });

        this.ws.on('error', (error) => {
          console.error('[Kraken] WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('[Kraken] WebSocket closed');
          this.stopHeartbeat();
          this.attemptReconnect(symbols);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle public WebSocket messages (ticker data)
   */
  private handlePublicMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Kraken V2: { channel: "ticker", type: "update", data: [...] }
      if (message.channel === 'ticker' && message.type === 'update') {
        for (const tick of message.data) {
          const priceUpdate: PriceUpdate = {
            symbol: tick.symbol,
            bid: parseFloat(tick.bid),
            ask: parseFloat(tick.ask),
            timestamp: Date.now(),
            venue: this.name
          };

          this.priceCallbacks.forEach(cb => cb(priceUpdate));
        }
      } else if (message.method === 'pong') {
        // Heartbeat response
      }
    } catch (error) {
      console.error('[Kraken] Failed to parse message:', error);
    }
  }

  /**
   * Handle authenticated WebSocket messages (positions, trades)
   */
  private handleAuthMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Kraken position close event
      if (message.channel === 'executions' && message.type === 'update') {
        for (const execution of message.data) {
          if (execution.exec_type === 'trade' && execution.liquidity_ind === 'taker') {
            // This is a simplified example - real implementation needs
            // to track open positions and match closes
            const position: ClosedPosition = {
              id: execution.order_id,
              symbol: execution.symbol,
              side: execution.side === 'buy' ? 'long' : 'short',
              entryPrice: 0, // Would need to track from open
              exitPrice: parseFloat(execution.price),
              size: parseFloat(execution.qty),
              pnl: 0, // Would calculate from entry/exit
              venue: this.name,
              closedAt: Date.now()
            };

            this.positionCallbacks.forEach(cb => cb(position));
          }
        }
      }
    } catch (error) {
      console.error('[Kraken] Failed to parse auth message:', error);
    }
  }

  /**
   * Reconnection logic
   */
  private attemptReconnect(symbols: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Kraken] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[Kraken] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
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
        this.ws.send(JSON.stringify({ method: 'ping' }));
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
    // Get WebSocket token from REST API
    const tokenResponse = await this.getWebSocketToken(apiKey, apiSecret);
    const token = tokenResponse.token;

    return new Promise((resolve, reject) => {
      try {
        this.authWs = new WebSocket(this.wsUrl);

        this.authWs.on('open', () => {
          console.log('[Kraken] Authenticated WebSocket connected');
          
          // Subscribe to executions (position fills)
          this.authWs!.send(JSON.stringify({
            method: 'subscribe',
            params: {
              channel: 'executions',
              token
            }
          }));

          resolve();
        });

        this.authWs.on('message', (data: WebSocket.Data) => {
          this.handleAuthMessage(data.toString());
        });

        this.authWs.on('error', (error) => {
          console.error('[Kraken] Auth WebSocket error:', error);
          reject(error);
        });

        this.authWs.on('close', () => {
          console.log('[Kraken] Auth WebSocket closed');
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get WebSocket authentication token
   */
  private async getWebSocketToken(apiKey: string, apiSecret: string): Promise<any> {
    const nonce = Date.now().toString();
    const path = '/0/private/GetWebSocketsToken';
    const postData = `nonce=${nonce}`;

    const signature = this.createSignature(path, postData, nonce, apiSecret);

    const response = await fetch(`${this.restBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'API-Key': apiKey,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: postData
    });

    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.result;
  }

  /**
   * Create Kraken API signature
   */
  private createSignature(path: string, postData: string, nonce: string, secret: string): string {
    const hash = createHmac('sha256', nonce + postData).digest();
    const hmac = createHmac('sha512', Buffer.from(secret, 'base64'));
    hmac.update(path);
    hmac.update(hash);
    return hmac.digest('base64');
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
    const nonce = Date.now().toString();
    const path = '/0/private/Balance';
    const postData = `nonce=${nonce}`;

    const signature = this.createSignature(path, postData, nonce, apiSecret);

    const response = await fetch(`${this.restBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'API-Key': apiKey,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: postData
    });

    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.statusText}`);
    }

    const data = await response.json();
    const usdBalance = parseFloat(data.result.ZUSD || '0');

    return {
      total: usdBalance,
      available: usdBalance,
      currency: 'USD'
    };
  }
}
