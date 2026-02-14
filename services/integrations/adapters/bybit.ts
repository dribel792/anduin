import WebSocket from 'ws';
import { createHmac } from 'crypto';
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

/**
 * Bybit Exchange Adapter
 * 
 * API Documentation: https://bybit-exchange.github.io/docs/
 * 
 * Public WebSocket: wss://stream.bybit.com/v5/public/linear
 * Private WebSocket: wss://stream.bybit.com/v5/private
 * REST API: https://api.bybit.com/v5
 * 
 * Symbols: BTCUSDT, ETHUSDT (linear perpetuals)
 */

export class BybitAdapter implements VenueAdapter {
  public readonly name = 'Bybit';
  public readonly type = 'cex' as const;

  private ws: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private restBaseUrl = 'https://api.bybit.com/v5';
  private publicWsUrl = 'wss://stream.bybit.com/v5/public/linear';
  private privateWsUrl = 'wss://stream.bybit.com/v5/private';
  
  private priceCallbacks: Array<(price: PriceUpdate) => void> = [];
  private positionCallbacks: Array<(position: ClosedPosition) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Connect to Bybit public price feed
   */
  public async connectPriceFeed(symbols: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.publicWsUrl);

        this.ws.on('open', () => {
          console.log('[Bybit] WebSocket connected');
          
          // Subscribe to tickers
          this.ws!.send(JSON.stringify({
            op: 'subscribe',
            args: symbols.map(s => `tickers.${s}`)
          }));

          this.startHeartbeat();
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handlePublicMessage(data.toString());
        });

        this.ws.on('error', (error) => {
          console.error('[Bybit] WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('[Bybit] WebSocket closed');
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

      if (message.topic && message.topic.startsWith('tickers.')) {
        const tick = message.data;
        const priceUpdate: PriceUpdate = {
          symbol: tick.symbol,
          bid: parseFloat(tick.bid1Price),
          ask: parseFloat(tick.ask1Price),
          timestamp: parseInt(tick.time) || Date.now(),
          venue: this.name
        };

        this.priceCallbacks.forEach(cb => cb(priceUpdate));
      } else if (message.op === 'pong') {
        // Heartbeat response
      }
    } catch (error) {
      console.error('[Bybit] Failed to parse message:', error);
    }
  }

  /**
   * Handle authenticated WebSocket messages
   */
  private handleAuthMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Bybit execution (order fill) event
      if (message.topic === 'execution') {
        for (const execution of message.data) {
          if (execution.execType === 'Trade') {
            const position: ClosedPosition = {
              id: execution.orderId,
              symbol: execution.symbol,
              side: execution.side === 'Buy' ? 'long' : 'short',
              entryPrice: 0, // Would need position tracking
              exitPrice: parseFloat(execution.execPrice),
              size: parseFloat(execution.execQty),
              pnl: parseFloat(execution.closedPnl || '0'),
              venue: this.name,
              closedAt: parseInt(execution.execTime)
            };

            this.positionCallbacks.forEach(cb => cb(position));
          }
        }
      }
    } catch (error) {
      console.error('[Bybit] Failed to parse auth message:', error);
    }
  }

  /**
   * Reconnection logic
   */
  private attemptReconnect(symbols: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Bybit] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[Bybit] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      this.connectPriceFeed(symbols);
    }, delay);
  }

  /**
   * Start heartbeat (ping every 20s, Bybit disconnects after 30s idle)
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'ping' }));
      }
      if (this.authWs && this.authWs.readyState === WebSocket.OPEN) {
        this.authWs.send(JSON.stringify({ op: 'ping' }));
      }
    }, 20000);
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
        this.authWs = new WebSocket(this.privateWsUrl);

        this.authWs.on('open', () => {
          console.log('[Bybit] Authenticated WebSocket connected');
          
          // Authenticate
          const expires = Date.now() + 10000;
          const signature = createHmac('sha256', apiSecret)
            .update(`GET/realtime${expires}`)
            .digest('hex');

          this.authWs!.send(JSON.stringify({
            op: 'auth',
            args: [apiKey, expires.toString(), signature]
          }));

          // Subscribe to execution (order fills)
          this.authWs!.send(JSON.stringify({
            op: 'subscribe',
            args: ['execution']
          }));

          resolve();
        });

        this.authWs.on('message', (data: WebSocket.Data) => {
          this.handleAuthMessage(data.toString());
        });

        this.authWs.on('error', (error) => {
          console.error('[Bybit] Auth WebSocket error:', error);
          reject(error);
        });

        this.authWs.on('close', () => {
          console.log('[Bybit] Auth WebSocket closed');
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
    const params = `accountType=UNIFIED&coin=USDT`;
    const signString = timestamp + apiKey + params;
    
    const signature = createHmac('sha256', apiSecret)
      .update(signString)
      .digest('hex');

    const response = await fetch(
      `${this.restBaseUrl}/account/wallet-balance?${params}`,
      {
        headers: {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': '5000'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Bybit API error: ${response.statusText}`);
    }

    const data = await response.json();
    const usdtBalance = data.result.list[0]?.coin.find((c: any) => c.coin === 'USDT');

    return {
      total: parseFloat(usdtBalance?.walletBalance || '0'),
      available: parseFloat(usdtBalance?.availableToWithdraw || '0'),
      currency: 'USDT'
    };
  }
}
