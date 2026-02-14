import WebSocket from 'ws';
import { createHmac } from 'crypto';
import { inflate } from 'zlib';
import { promisify } from 'util';
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

const inflateAsync = promisify(inflate);

/**
 * HTX (Huobi) Exchange Adapter
 * 
 * API Documentation: https://www.htx.com/en-us/opend/newApiPages/
 * 
 * WebSocket: wss://api.huobi.pro/ws (public), wss://api.huobi.pro/ws/v2 (private)
 * REST API: https://api.huobi.pro
 * 
 * Symbols: btcusdt, ethusdt (lowercase)
 * 
 * Note: HTX WebSocket sends gzip-compressed messages
 */

export class HTXAdapter implements VenueAdapter {
  public readonly name = 'HTX';
  public readonly type = 'cex' as const;

  private ws: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private restBaseUrl = 'https://api.huobi.pro';
  private publicWsUrl = 'wss://api.huobi.pro/ws';
  private privateWsUrl = 'wss://api.huobi.pro/ws/v2';
  
  private priceCallbacks: Array<(price: PriceUpdate) => void> = [];
  private positionCallbacks: Array<(position: ClosedPosition) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Decompress HTX WebSocket messages (gzip)
   */
  private async decompressMessage(data: Buffer): Promise<string> {
    try {
      const decompressed = await inflateAsync(data);
      return decompressed.toString();
    } catch (error) {
      throw new Error(`Failed to decompress message: ${error}`);
    }
  }

  /**
   * Connect to HTX public price feed
   */
  public async connectPriceFeed(symbols: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.publicWsUrl);

        this.ws.on('open', () => {
          console.log('[HTX] WebSocket connected');
          
          // Subscribe to BBO (best bid/offer)
          symbols.forEach(symbol => {
            this.ws!.send(JSON.stringify({
              sub: `market.${symbol.toLowerCase()}.bbo`,
              id: Date.now().toString()
            }));
          });

          this.startHeartbeat();
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', async (data: WebSocket.Data) => {
          if (Buffer.isBuffer(data)) {
            const decompressed = await this.decompressMessage(data);
            this.handlePublicMessage(decompressed);
          }
        });

        this.ws.on('error', (error) => {
          console.error('[HTX] WebSocket error:', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('[HTX] WebSocket closed');
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

      if (message.ping) {
        // Respond to ping immediately
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ pong: message.ping }));
        }
      } else if (message.ch && message.ch.includes('.bbo')) {
        const tick = message.tick;
        const symbol = message.ch.split('.')[1].toUpperCase();
        
        const priceUpdate: PriceUpdate = {
          symbol,
          bid: parseFloat(tick.bid),
          ask: parseFloat(tick.ask),
          timestamp: message.ts || Date.now(),
          venue: this.name
        };

        this.priceCallbacks.forEach(cb => cb(priceUpdate));
      }
    } catch (error) {
      console.error('[HTX] Failed to parse message:', error);
    }
  }

  /**
   * Handle authenticated WebSocket messages
   */
  private async handleAuthMessage(data: WebSocket.Data): Promise<void> {
    try {
      let message;
      if (Buffer.isBuffer(data)) {
        const decompressed = await this.decompressMessage(data);
        message = JSON.parse(decompressed);
      } else {
        message = JSON.parse(data.toString());
      }

      if (message.ping) {
        // Respond to ping
        if (this.authWs && this.authWs.readyState === WebSocket.OPEN) {
          this.authWs.send(JSON.stringify({ pong: message.ping }));
        }
      } else if (message.action === 'push' && message.ch === 'orders#*') {
        // Order update
        const order = message.data;
        if (order.orderStatus === 'filled') {
          const position: ClosedPosition = {
            id: order.orderId.toString(),
            symbol: order.symbol.toUpperCase(),
            side: order.type.includes('buy') ? 'long' : 'short',
            entryPrice: 0, // Would need position tracking
            exitPrice: parseFloat(order.tradePrice),
            size: parseFloat(order.tradeVolume),
            pnl: 0, // Would calculate from position
            venue: this.name,
            closedAt: order.tradeTime
          };

          this.positionCallbacks.forEach(cb => cb(position));
        }
      }
    } catch (error) {
      console.error('[HTX] Failed to parse auth message:', error);
    }
  }

  /**
   * Reconnection logic
   */
  private attemptReconnect(symbols: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[HTX] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[HTX] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      this.connectPriceFeed(symbols);
    }, delay);
  }

  /**
   * Start heartbeat (HTX uses ping/pong, no separate heartbeat needed)
   */
  private startHeartbeat(): void {
    // HTX sends ping, we respond with pong - no client-initiated heartbeat needed
    this.heartbeatInterval = setInterval(() => {
      // Just a placeholder to keep the pattern consistent
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
   * Create HTX API signature
   */
  private createSignature(
    method: string,
    host: string,
    path: string,
    params: any,
    secretKey: string
  ): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');

    const signString = `${method}\n${host}\n${path}\n${sortedParams}`;
    
    return createHmac('sha256', secretKey)
      .update(signString)
      .digest('base64');
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
          console.log('[HTX] Authenticated WebSocket connected');
          
          // Authenticate
          const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
          const params = {
            accessKey: apiKey,
            signatureMethod: 'HmacSHA256',
            signatureVersion: '2.1',
            timestamp
          };

          const signature = this.createSignature(
            'GET',
            'api.huobi.pro',
            '/ws/v2',
            params,
            apiSecret
          );

          this.authWs!.send(JSON.stringify({
            action: 'req',
            ch: 'auth',
            params: {
              ...params,
              signature
            }
          }));

          // Subscribe to order updates
          this.authWs!.send(JSON.stringify({
            action: 'sub',
            ch: 'orders#*'
          }));

          resolve();
        });

        this.authWs.on('message', async (data: WebSocket.Data) => {
          await this.handleAuthMessage(data);
        });

        this.authWs.on('error', (error) => {
          console.error('[HTX] Auth WebSocket error:', error);
          reject(error);
        });

        this.authWs.on('close', () => {
          console.log('[HTX] Auth WebSocket closed');
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
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
    const params = {
      AccessKeyId: apiKey,
      SignatureMethod: 'HmacSHA256',
      SignatureVersion: '2',
      Timestamp: timestamp
    };

    const signature = this.createSignature(
      'GET',
      'api.huobi.pro',
      '/v1/account/accounts',
      params,
      apiSecret
    );

    // First get account ID
    const accountResponse = await fetch(
      `${this.restBaseUrl}/v1/account/accounts?` + 
      new URLSearchParams({ ...params, Signature: signature })
    );

    if (!accountResponse.ok) {
      throw new Error(`HTX API error: ${accountResponse.statusText}`);
    }

    const accountData = await accountResponse.json();
    const spotAccount = accountData.data.find((a: any) => a.type === 'spot');
    
    if (!spotAccount) {
      throw new Error('No spot account found');
    }

    // Get balance
    const balanceParams = {
      AccessKeyId: apiKey,
      SignatureMethod: 'HmacSHA256',
      SignatureVersion: '2',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, '')
    };

    const balanceSignature = this.createSignature(
      'GET',
      'api.huobi.pro',
      `/v1/account/accounts/${spotAccount.id}/balance`,
      balanceParams,
      apiSecret
    );

    const balanceResponse = await fetch(
      `${this.restBaseUrl}/v1/account/accounts/${spotAccount.id}/balance?` +
      new URLSearchParams({ ...balanceParams, Signature: balanceSignature })
    );

    if (!balanceResponse.ok) {
      throw new Error(`HTX API error: ${balanceResponse.statusText}`);
    }

    const balanceData = await balanceResponse.json();
    const usdtBalance = balanceData.data.list.find((b: any) => b.currency === 'usdt' && b.type === 'trade');

    return {
      total: parseFloat(usdtBalance?.balance || '0'),
      available: parseFloat(usdtBalance?.balance || '0'),
      currency: 'USDT'
    };
  }
}
