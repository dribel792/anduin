import WebSocket from 'ws';
import { createHmac } from 'crypto';
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

/**
 * OKX Exchange Adapter
 * 
 * API Documentation: https://www.okx.com/docs-v5/
 * 
 * Public WebSocket: wss://ws.okx.com:8443/ws/v5/public
 * Private WebSocket: wss://ws.okx.com:8443/ws/v5/private
 * REST API: https://www.okx.com/api/v5
 * 
 * Symbols: BTC-USDT-SWAP, ETH-USDT-SWAP (perpetual swaps)
 */

export class OKXAdapter implements VenueAdapter {
  public readonly name = 'OKX';
  public readonly type = 'cex' as const;

  private ws: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private restBaseUrl = 'https://www.okx.com/api/v5';
  private publicWsUrl = 'wss://ws.okx.com:8443/ws/v5/public';
  private privateWsUrl = 'wss://ws.okx.com:8443/ws/v5/private';
  
  private priceCallbacks: Array<(price: PriceUpdate) => void> = [];
  private positionCallbacks: Array<(position: ClosedPosition) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Connect to OKX public price feed
   */
  public async connectPriceFeed(symbols: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.publicWsUrl);

        this.ws.on('open', () => {
          console.log('[OKX] WebSocket connected');
          
          // Subscribe to tickers
          this.ws!.send(JSON.stringify({
            op: 'subscribe',
            args: symbols.map(s => ({
              channel: 'tickers',
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
          console.error('[OKX] WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('[OKX] WebSocket closed');
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

      if (message.arg?.channel === 'tickers' && message.data) {
        for (const tick of message.data) {
          const priceUpdate: PriceUpdate = {
            symbol: message.arg.instId,
            bid: parseFloat(tick.bidPx),
            ask: parseFloat(tick.askPx),
            timestamp: parseInt(tick.ts) || Date.now(),
            venue: this.name
          };

          this.priceCallbacks.forEach(cb => cb(priceUpdate));
        }
      } else if (message.event === 'pong') {
        // Heartbeat response
      }
    } catch (error) {
      console.error('[OKX] Failed to parse message:', error);
    }
  }

  /**
   * Handle authenticated WebSocket messages
   */
  private handleAuthMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // OKX order fill event
      if (message.arg?.channel === 'orders' && message.data) {
        for (const order of message.data) {
          if (order.state === 'filled') {
            const position: ClosedPosition = {
              id: order.ordId,
              symbol: order.instId,
              side: order.side === 'buy' ? 'long' : 'short',
              entryPrice: 0, // Would need position tracking
              exitPrice: parseFloat(order.avgPx),
              size: parseFloat(order.sz),
              pnl: parseFloat(order.pnl || '0'),
              venue: this.name,
              closedAt: parseInt(order.uTime)
            };

            this.positionCallbacks.forEach(cb => cb(position));
          }
        }
      }
    } catch (error) {
      console.error('[OKX] Failed to parse auth message:', error);
    }
  }

  /**
   * Reconnection logic
   */
  private attemptReconnect(symbols: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[OKX] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[OKX] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
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
      throw new Error('OKX requires passphrase for authentication');
    }

    return new Promise((resolve, reject) => {
      try {
        this.authWs = new WebSocket(this.privateWsUrl);

        this.authWs.on('open', () => {
          console.log('[OKX] Authenticated WebSocket connected');
          
          // Authenticate
          const timestamp = (Date.now() / 1000).toString();
          const sign = createHmac('sha256', apiSecret)
            .update(timestamp + 'GET' + '/users/self/verify')
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

          // Subscribe to orders
          this.authWs!.send(JSON.stringify({
            op: 'subscribe',
            args: [{
              channel: 'orders',
              instType: 'SWAP'
            }]
          }));

          resolve();
        });

        this.authWs.on('message', (data: WebSocket.Data) => {
          this.handleAuthMessage(data.toString());
        });

        this.authWs.on('error', (error) => {
          console.error('[OKX] Auth WebSocket error:', error);
          reject(error);
        });

        this.authWs.on('close', () => {
          console.log('[OKX] Auth WebSocket closed');
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
    const timestamp = new Date().toISOString();
    const method = 'GET';
    const requestPath = '/api/v5/account/balance';
    
    const signString = timestamp + method + requestPath;
    const sign = createHmac('sha256', apiSecret)
      .update(signString)
      .digest('base64');

    const response = await fetch(`${this.restBaseUrl}/account/balance`, {
      headers: {
        'OK-ACCESS-KEY': apiKey,
        'OK-ACCESS-SIGN': sign,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': '', // Would need passphrase
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`OKX API error: ${response.statusText}`);
    }

    const data = await response.json();
    const usdtBalance = data.data[0]?.details.find((d: any) => d.ccy === 'USDT');

    return {
      total: parseFloat(usdtBalance?.eq || '0'),
      available: parseFloat(usdtBalance?.availBal || '0'),
      currency: 'USDT'
    };
  }
}
