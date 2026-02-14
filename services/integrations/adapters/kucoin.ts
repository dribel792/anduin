import WebSocket from 'ws';
import { createHmac } from 'crypto';
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

/**
 * KuCoin Exchange Adapter
 * 
 * API Documentation: https://www.kucoin.com/docs/
 * 
 * WebSocket: Dynamic URL (requires token from REST API)
 * REST API: https://api.kucoin.com/api/v1
 * 
 * Symbols: BTC-USDT, ETH-USDT (spot and futures)
 * 
 * Note: KuCoin WebSocket requires a token obtained from REST API first
 */

export class KuCoinAdapter implements VenueAdapter {
  public readonly name = 'KuCoin';
  public readonly type = 'cex' as const;

  private ws: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private restBaseUrl = 'https://api.kucoin.com/api/v1';
  private wsUrl: string = '';
  
  private priceCallbacks: Array<(price: PriceUpdate) => void> = [];
  private positionCallbacks: Array<(position: ClosedPosition) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Get WebSocket connection details (public endpoint)
   */
  private async getPublicWebSocketToken(): Promise<{ endpoint: string; token: string }> {
    const response = await fetch(`${this.restBaseUrl}/bullet-public`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`KuCoin API error: ${response.statusText}`);
    }

    const data = await response.json();
    const instance = data.data.instanceServers[0];
    
    return {
      endpoint: `${instance.endpoint}?token=${data.data.token}`,
      token: data.data.token
    };
  }

  /**
   * Connect to KuCoin public price feed
   */
  public async connectPriceFeed(symbols: string[]): Promise<void> {
    const { endpoint } = await this.getPublicWebSocketToken();
    this.wsUrl = endpoint;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(endpoint);

        this.ws.on('open', () => {
          console.log('[KuCoin] WebSocket connected');
          
          // Subscribe to ticker
          symbols.forEach(symbol => {
            this.ws!.send(JSON.stringify({
              id: Date.now(),
              type: 'subscribe',
              topic: `/market/ticker:${symbol}`,
              privateChannel: false,
              response: true
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
          console.error('[KuCoin] WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('[KuCoin] WebSocket closed');
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

      if (message.type === 'message' && message.topic?.startsWith('/market/ticker:')) {
        const tick = message.data;
        const priceUpdate: PriceUpdate = {
          symbol: message.subject,
          bid: parseFloat(tick.bestBid),
          ask: parseFloat(tick.bestAsk),
          timestamp: tick.time || Date.now(),
          venue: this.name
        };

        this.priceCallbacks.forEach(cb => cb(priceUpdate));
      } else if (message.type === 'pong') {
        // Heartbeat response
      }
    } catch (error) {
      console.error('[KuCoin] Failed to parse message:', error);
    }
  }

  /**
   * Handle authenticated WebSocket messages
   */
  private handleAuthMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // KuCoin order fill event
      if (message.type === 'message' && message.topic === '/spotMarket/tradeOrders') {
        const order = message.data;
        if (order.status === 'done') {
          const position: ClosedPosition = {
            id: order.orderId,
            symbol: order.symbol,
            side: order.side === 'buy' ? 'long' : 'short',
            entryPrice: 0, // Would need position tracking
            exitPrice: parseFloat(order.price),
            size: parseFloat(order.size),
            pnl: 0, // Would calculate from position
            venue: this.name,
            closedAt: order.ts
          };

          this.positionCallbacks.forEach(cb => cb(position));
        }
      }
    } catch (error) {
      console.error('[KuCoin] Failed to parse auth message:', error);
    }
  }

  /**
   * Reconnection logic
   */
  private attemptReconnect(symbols: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[KuCoin] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[KuCoin] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      this.connectPriceFeed(symbols);
    }, delay);
  }

  /**
   * Start heartbeat (KuCoin requires ping every 50s)
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          id: Date.now(),
          type: 'ping'
        }));
      }
      if (this.authWs && this.authWs.readyState === WebSocket.OPEN) {
        this.authWs.send(JSON.stringify({
          id: Date.now(),
          type: 'ping'
        }));
      }
    }, 40000); // 40 seconds to be safe
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
   * Get private WebSocket token
   */
  private async getPrivateWebSocketToken(apiKey: string, apiSecret: string, passphrase: string): Promise<{ endpoint: string; token: string }> {
    const timestamp = Date.now().toString();
    const signString = timestamp + 'POST' + '/api/v1/bullet-private';
    const signature = createHmac('sha256', apiSecret)
      .update(signString)
      .digest('base64');

    const passphraseSignature = createHmac('sha256', apiSecret)
      .update(passphrase)
      .digest('base64');

    const response = await fetch(`${this.restBaseUrl}/bullet-private`, {
      method: 'POST',
      headers: {
        'KC-API-KEY': apiKey,
        'KC-API-SIGN': signature,
        'KC-API-TIMESTAMP': timestamp,
        'KC-API-PASSPHRASE': passphraseSignature,
        'KC-API-KEY-VERSION': '2'
      }
    });

    if (!response.ok) {
      throw new Error(`KuCoin API error: ${response.statusText}`);
    }

    const data = await response.json();
    const instance = data.data.instanceServers[0];
    
    return {
      endpoint: `${instance.endpoint}?token=${data.data.token}`,
      token: data.data.token
    };
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
      throw new Error('KuCoin requires passphrase for authentication');
    }

    const { endpoint } = await this.getPrivateWebSocketToken(apiKey, apiSecret, passphrase);

    return new Promise((resolve, reject) => {
      try {
        this.authWs = new WebSocket(endpoint);

        this.authWs.on('open', () => {
          console.log('[KuCoin] Authenticated WebSocket connected');
          
          // Subscribe to order updates
          this.authWs!.send(JSON.stringify({
            id: Date.now(),
            type: 'subscribe',
            topic: '/spotMarket/tradeOrders',
            privateChannel: true,
            response: true
          }));

          resolve();
        });

        this.authWs.on('message', (data: WebSocket.Data) => {
          this.handleAuthMessage(data.toString());
        });

        this.authWs.on('error', (error) => {
          console.error('[KuCoin] Auth WebSocket error:', error);
          reject(error);
        });

        this.authWs.on('close', () => {
          console.log('[KuCoin] Auth WebSocket closed');
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
    const signString = timestamp + 'GET' + '/api/v1/accounts';
    const signature = createHmac('sha256', apiSecret)
      .update(signString)
      .digest('base64');

    const response = await fetch(`${this.restBaseUrl}/accounts`, {
      headers: {
        'KC-API-KEY': apiKey,
        'KC-API-SIGN': signature,
        'KC-API-TIMESTAMP': timestamp,
        'KC-API-PASSPHRASE': '', // Would need passphrase signature
        'KC-API-KEY-VERSION': '2'
      }
    });

    if (!response.ok) {
      throw new Error(`KuCoin API error: ${response.statusText}`);
    }

    const data = await response.json();
    const usdtAccount = data.data.find((a: any) => a.currency === 'USDT' && a.type === 'trade');

    return {
      total: parseFloat(usdtAccount?.balance || '0'),
      available: parseFloat(usdtAccount?.available || '0'),
      currency: 'USDT'
    };
  }
}
