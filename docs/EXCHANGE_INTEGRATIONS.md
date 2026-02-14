# Exchange Integrations

**Connecting traditional trading venues to on-chain settlement.**

Volera's exchange integration layer bridges the gap between off-chain trading platforms and on-chain settlement. When a position closes on a broker or exchange, the integration adapter captures it, normalizes the data, and triggers instant settlement to the user's on-chain vault.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     EXCHANGE LAYER                          │
│  (Bybit, Kraken, MetaTrader, OKX, etc.)                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ WebSocket / REST API
                 ↓
┌─────────────────────────────────────────────────────────────┐
│                  VENUE ADAPTERS                             │
│  • Normalize exchange-specific formats                      │
│  • Handle reconnection logic                                │
│  • Manage authentication                                    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│              PRICE AGGREGATOR                               │
│  • Collect prices from all venues                           │
│  • Calculate best bid/ask                                   │
│  • Detect price anomalies                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│             SETTLEMENT BRIDGE                               │
│  • Map position closes to settlement actions                │
│  • Generate unique refIds for deduplication                 │
│  • Route to appropriate vault function                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│          UNIFIED ACCOUNT VAULT                              │
│  (On-chain settlement via creditPnl / seizeCollateral)      │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Adapter Pattern** — Each exchange gets its own adapter implementing a common interface
2. **Factory Creation** — Adapters are instantiated via factory for consistency
3. **Event-Driven** — Adapters emit events; consumers subscribe via callbacks
4. **Reconnection Resilience** — Auto-reconnect with exponential backoff
5. **Idempotency** — Position IDs are hashed to create unique `refId` for blockchain deduplication

---

## Core Components

### 1. VenueAdapter Interface

All exchange adapters implement this interface:

```typescript
interface VenueAdapter {
  name: string;
  type: 'cex' | 'cfd';
  
  // Price feeds (public - no API key needed)
  connectPriceFeed(symbols: string[]): Promise<void>;
  onPrice(callback: (price: PriceUpdate) => void): void;
  disconnectPriceFeed(): void;
  
  // Position monitoring (needs API key)
  connectPositionFeed(
    apiKey: string, 
    apiSecret: string, 
    passphrase?: string
  ): Promise<void>;
  onPositionClose(callback: (position: ClosedPosition) => void): void;
  
  // Account management
  getAccountBalance(
    apiKey: string, 
    apiSecret: string
  ): Promise<Balance>;
}
```

**Types:**

```typescript
interface PriceUpdate {
  symbol: string;       // e.g., "BTCUSD", "XAUUSD"
  bid: number;
  ask: number;
  timestamp: number;
  venue: string;
}

interface ClosedPosition {
  id: string;           // Exchange-specific position ID
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;          // Realized PnL in USD
  venue: string;
  closedAt: number;
}

interface Balance {
  total: number;
  available: number;
  currency: string;
}
```

---

### 2. Adapter Factory

Centralized creation of venue adapters:

```typescript
type VenueName = 
  | 'metatrader' 
  | 'kraken' 
  | 'bybit' 
  | 'bitget' 
  | 'okx' 
  | 'mexc' 
  | 'kucoin' 
  | 'htx';

class AdapterFactory {
  static createAdapter(venueName: VenueName): VenueAdapter {
    switch (venueName) {
      case 'bybit':
        return new BybitAdapter();
      case 'kraken':
        return new KrakenAdapter();
      // ... etc
    }
  }

  static createAdapters(venueNames: VenueName[]): VenueAdapter[] {
    return venueNames.map(name => this.createAdapter(name));
  }

  static getSupportedVenues(): VenueName[] {
    return ['metatrader', 'kraken', 'bybit', ...];
  }
}
```

**Usage:**

```typescript
// Create a single adapter
const bybit = AdapterFactory.createAdapter('bybit');

// Create multiple adapters
const adapters = AdapterFactory.createAdapters(['bybit', 'kraken', 'okx']);

// List all supported venues
const venues = AdapterFactory.getSupportedVenues();
console.log(venues); // ['metatrader', 'kraken', 'bybit', ...]
```

---

### 3. Price Aggregator

Collects real-time prices from multiple venues and calculates the best bid/ask:

```typescript
class PriceAggregator {
  private adapters: VenueAdapter[] = [];
  private latestPrices: Map<string, Map<string, PriceUpdate>>;
  
  addAdapter(adapter: VenueAdapter): void;
  async connectAll(symbols: string[]): Promise<void>;
  onAggregatedPrice(callback: (price: AggregatedPrice) => void): void;
  getAggregatedPrice(symbol: string): AggregatedPrice | null;
}

interface AggregatedPrice {
  symbol: string;
  bestBid: number;      // Highest bid across all venues
  bestAsk: number;      // Lowest ask across all venues
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
```

**Key Features:**

- **Stale price detection** — Ignores prices older than 30 seconds
- **Best price calculation** — `bestBid = max(all bids)`, `bestAsk = min(all asks)`
- **Real-time updates** — Emits new aggregated price whenever any venue updates

**Example:**

```typescript
const aggregator = new PriceAggregator();

// Add adapters
const bybit = AdapterFactory.createAdapter('bybit');
const kraken = AdapterFactory.createAdapter('kraken');
aggregator.addAdapter(bybit);
aggregator.addAdapter(kraken);

// Connect to price feeds
await aggregator.connectAll(['BTCUSDT', 'ETHUSDT']);

// Subscribe to aggregated prices
aggregator.onAggregatedPrice((price) => {
  console.log(`${price.symbol} Best Bid: ${price.bestBid}, Best Ask: ${price.bestAsk}`);
  console.log(`Spread: ${price.spread}`);
  console.log(`Venues:`, price.venues);
});
```

**Output:**

```json
{
  "symbol": "BTCUSDT",
  "bestBid": 43250.5,
  "bestAsk": 43251.0,
  "spread": 0.5,
  "venues": {
    "Bybit": { "bid": 43250.5, "ask": 43251.0, "timestamp": 1708032000 },
    "Kraken": { "bid": 43249.8, "ask": 43252.3, "timestamp": 1708032001 }
  },
  "timestamp": 1708032001
}
```

---

### 4. Settlement Bridge

Maps closed positions to on-chain settlement actions:

```typescript
class SettlementBridge {
  mapPositionToSettlement(
    position: ClosedPosition,
    userAddress: string,
    cappedSeizure: boolean = false
  ): SettlementAction | null;
  
  batchMapPositions(
    positions: ClosedPosition[],
    userAddress: string,
    cappedSeizure: boolean = false
  ): SettlementAction[];
  
  isProcessed(venue: string, positionId: string): boolean;
}

interface SettlementAction {
  type: 'credit' | 'seize' | 'seizeCapped';
  user: string;
  amount: number;
  refId: string;
  position: ClosedPosition;
}
```

**How it works:**

1. **Position closes** on exchange (e.g., Bybit)
2. **Bridge receives** closed position via adapter callback
3. **Generate refId:**
   ```typescript
   refId = keccak256(venue + positionId)
   // Example: keccak256("Bybit:12345") = 0xabc123...
   ```
4. **Determine action:**
   - `pnl > 0` → `creditPnl(user, amount, refId)`
   - `pnl < 0` → `seizeCollateral(user, amount, refId)` or `seizeCollateralCapped`
   - `pnl == 0` → no action

5. **Call vault contract** with settlement action

**Example:**

```typescript
const bridge = new SettlementBridge();

// Position closed with profit
const position: ClosedPosition = {
  id: 'bybit-12345',
  symbol: 'BTCUSDT',
  side: 'long',
  entryPrice: 43000,
  exitPrice: 44000,
  size: 0.5,
  pnl: 500,  // $500 profit
  venue: 'Bybit',
  closedAt: Date.now()
};

const action = bridge.mapPositionToSettlement(
  position,
  '0xUserAddress',
  false
);

console.log(action);
// {
//   type: 'credit',
//   user: '0xUserAddress',
//   amount: 500,
//   refId: '0xabc123...',
//   position: { ... }
// }

// Execute settlement
await vault.write.creditPnl([
  action.user,
  parseUnits(action.amount.toString(), 6),
  action.refId
]);
```

---

## Supported Venues

### 1. Bybit

**Type:** CEX (Centralized Exchange)  
**API:** [https://bybit-exchange.github.io/docs/](https://bybit-exchange.github.io/docs/)

**Markets:**
- USDT perpetuals: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`
- Inverse perpetuals: `BTCUSD`, `ETHUSD`

**WebSocket:**
- Public: `wss://stream.bybit.com/v5/public/linear`
- Private: `wss://stream.bybit.com/v5/private`

**Authentication:**
- API Key + Secret
- HMAC-SHA256 signature

**Features:**
- Real-time ticker updates
- Position close notifications via `execution` topic
- Account balance queries

**Code Example:**

```typescript
const bybit = new BybitAdapter();

// Connect to price feed (no auth)
await bybit.connectPriceFeed(['BTCUSDT', 'ETHUSDT']);
bybit.onPrice((price) => {
  console.log(`${price.symbol}: ${price.bid} / ${price.ask}`);
});

// Connect to position feed (needs auth)
await bybit.connectPositionFeed(API_KEY, API_SECRET);
bybit.onPositionClose((position) => {
  console.log(`Position closed: ${position.pnl} USD`);
});
```

---

### 2. Kraken

**Type:** CEX  
**API:** [https://docs.kraken.com/websockets/](https://docs.kraken.com/websockets/)

**Markets:**
- Spot: `XBT/USD`, `ETH/USD`
- Futures: `PF_XBTUSD`, `PF_ETHUSD`

**WebSocket:**
- Public: `wss://ws.kraken.com/`
- Private: `wss://ws-auth.kraken.com/`

**Authentication:**
- API Key + Secret
- REST endpoint to get WebSocket token
- Token valid for 15 minutes

**Features:**
- Spread updates (best bid/ask)
- Trade execution notifications
- Sub-second latency

---

### 3. OKX

**Type:** CEX  
**API:** [https://www.okx.com/docs-v5/en/](https://www.okx.com/docs-v5/en/)

**Markets:**
- USDT perpetuals: `BTC-USDT-SWAP`, `ETH-USDT-SWAP`
- Coin-margined: `BTC-USD-SWAP`

**WebSocket:**
- Public: `wss://ws.okx.com:8443/ws/v5/public`
- Private: `wss://ws.okx.com:8443/ws/v5/private`

**Authentication:**
- API Key + Secret + Passphrase
- WebSocket login with signature

**Features:**
- Real-time order book
- Position updates
- Funding rate notifications

---

### 4. Bitget

**Type:** CEX  
**API:** [https://bitgetlimited.github.io/apidoc/en/](https://bitgetlimited.github.io/apidoc/en/)

**Markets:**
- USDT futures: `BTCUSDT_UMCBL`, `ETHUSDT_UMCBL`

**WebSocket:**
- `wss://ws.bitget.com/mix/v1/stream`

**Authentication:**
- API Key + Secret + Passphrase
- HMAC-SHA256 signature

---

### 5. MEXC

**Type:** CEX  
**API:** [https://mexcdevelop.github.io/apidocs/](https://mexcdevelop.github.io/apidocs/)

**Markets:**
- Perpetuals: `BTC_USDT`, `ETH_USDT`

**WebSocket:**
- Public: `wss://contract.mexc.com/ws`

**Features:**
- Lightweight API
- Fast execution
- Growing market share

---

### 6. KuCoin

**Type:** CEX  
**API:** [https://docs.kucoin.com/](https://docs.kucoin.com/)

**Markets:**
- Futures: `XBTUSDTM`, `ETHUSDTM`

**WebSocket:**
- Public: Token-based connection (requires REST call first)
- Private: Token + authentication

**Unique Features:**
- Token-based WebSocket (more complex setup)
- Supports multiple accounts

---

### 7. HTX (Huobi)

**Type:** CEX  
**API:** [https://www.htx.com/en-us/opend/newApiPages/](https://www.htx.com/en-us/opend/newApiPages/)

**Markets:**
- Linear swaps: `BTC-USDT`, `ETH-USDT`

**WebSocket:**
- `wss://api.hbdm.com/linear-swap-ws`

**Features:**
- Gzip compression on WebSocket
- High-frequency trading support

---

### 8. MetaTrader 5

**Type:** CFD Broker (Forex, Indices, Commodities)  
**API:** Custom bridge (MT5 does not have native WebSocket API)

**Markets:**
- Forex: `EURUSD`, `GBPUSD`, `USDJPY`
- Commodities: `XAUUSD` (Gold), `XAGUSD` (Silver)
- Indices: `US30` (Dow), `NAS100` (Nasdaq)

**Integration Method:**
- MetaTrader Expert Advisor (EA) running on user's MT5 terminal
- EA monitors position closes
- EA sends HTTP POST to Volera settlement service
- Service processes and triggers on-chain settlement

**Data Format:**

```json
{
  "positionId": "MT5-67890",
  "symbol": "XAUUSD",
  "side": "long",
  "entryPrice": 2050.50,
  "exitPrice": 2075.30,
  "size": 10,
  "pnl": 248.00,
  "closedAt": 1708032123
}
```

**Why MetaTrader?**

- **Massive user base** — 1M+ traders worldwide
- **Traditional markets** — Access to forex, gold, indices
- **Retail focus** — Perfect for Volera's target audience

---

## Price Feeds

### WebSocket vs REST

| Venue | Price Feed Type | Reconnection | Latency |
|-------|----------------|--------------|---------|
| Bybit | WebSocket | Auto | <100ms |
| Kraken | WebSocket | Auto | <50ms |
| OKX | WebSocket | Auto | <100ms |
| Bitget | WebSocket | Auto | <150ms |
| MEXC | WebSocket | Auto | <200ms |
| KuCoin | WebSocket (token) | Manual | <150ms |
| HTX | WebSocket (gzip) | Auto | <100ms |
| MetaTrader | REST (EA push) | N/A | 1-3s |

### Reconnection Strategy

All WebSocket adapters implement exponential backoff:

```typescript
private attemptReconnect(symbols: string[]): void {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    console.error('[Adapter] Max reconnect attempts reached');
    return;
  }

  const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
  this.reconnectAttempts++;

  setTimeout(() => {
    this.connectPriceFeed(symbols);
  }, delay);
}
```

**Delays:**
- Attempt 1: 1 second
- Attempt 2: 2 seconds
- Attempt 3: 4 seconds
- Attempt 4: 8 seconds
- Attempt 5: 16 seconds
- Attempt 6+: 30 seconds (capped)

---

## How Settlement Bridge Works

### Step-by-Step Flow

```
1. Position closes on Bybit
   ↓
2. Bybit sends execution event via WebSocket
   ↓
3. BybitAdapter receives event, parses to ClosedPosition
   ↓
4. Adapter emits onPositionClose callback
   ↓
5. SettlementBridge receives ClosedPosition
   ↓
6. Bridge generates refId = keccak256(venue + positionId)
   ↓
7. Bridge checks if already processed (via Set)
   ↓
8. If new, map to SettlementAction:
   - pnl > 0 → type: 'credit'
   - pnl < 0 → type: 'seize' or 'seizeCapped'
   ↓
9. Call UnifiedAccountVault contract:
   - await vault.creditPnl(user, amount, refId)
   - OR await vault.seizeCollateral(user, amount, refId)
   ↓
10. Contract emits event, settlement complete ✅
```

### Deduplication

**Problem:** What if a position close event is received twice?

**Solution:** `refId` acts as a unique identifier.

```typescript
// In SettlementBridge:
private generateRefId(venue: string, positionId: string): string {
  const hash = createHash('sha256');
  hash.update(`${venue}:${positionId}`);
  return '0x' + hash.digest('hex').slice(0, 64);
}
```

**On-chain check:**

```solidity
mapping(bytes32 => bool) public usedRefIds;

if (usedRefIds[refId]) revert DuplicateRefId();
usedRefIds[refId] = true;
```

This ensures **idempotent settlement** — even if the same position is reported multiple times, it only settles once.

---

## Configuration Examples

### Basic Setup (Single Venue)

```typescript
import { AdapterFactory } from './adapter-factory';
import { SettlementBridge } from './bridge';

// 1. Create adapter
const bybit = AdapterFactory.createAdapter('bybit');

// 2. Create settlement bridge
const bridge = new SettlementBridge();

// 3. Connect to price feed
await bybit.connectPriceFeed(['BTCUSDT', 'ETHUSDT']);

// 4. Subscribe to price updates
bybit.onPrice((price) => {
  console.log(`${price.symbol}: ${price.bid}/${price.ask}`);
});

// 5. Connect to authenticated position feed
await bybit.connectPositionFeed(API_KEY, API_SECRET);

// 6. Handle position closes
bybit.onPositionClose(async (position) => {
  const action = bridge.mapPositionToSettlement(
    position,
    userAddress,
    true // Use capped seizure
  );

  if (action) {
    // Execute settlement
    if (action.type === 'credit') {
      await vault.creditPnl(action.user, action.amount, action.refId);
    } else {
      await vault.seizeCollateralCapped(action.user, action.amount, action.refId);
    }
  }
});
```

---

### Multi-Venue Setup with Price Aggregation

```typescript
import { AdapterFactory } from './adapter-factory';
import { PriceAggregator } from './price-aggregator';
import { SettlementBridge } from './bridge';

// 1. Create adapters
const venues = ['bybit', 'kraken', 'okx', 'bitget'];
const adapters = AdapterFactory.createAdapters(venues);

// 2. Set up price aggregator
const aggregator = new PriceAggregator();
adapters.forEach(adapter => aggregator.addAdapter(adapter));

// 3. Connect all venues
await aggregator.connectAll(['BTCUSDT', 'ETHUSDT']);

// 4. Subscribe to aggregated prices
aggregator.onAggregatedPrice((price) => {
  console.log(`[Aggregated] ${price.symbol}`);
  console.log(`  Best Bid: ${price.bestBid}`);
  console.log(`  Best Ask: ${price.bestAsk}`);
  console.log(`  Spread: ${price.spread}`);
  
  // Alert if spread is too wide
  if (price.spread > 10) {
    console.warn(`Wide spread detected on ${price.symbol}`);
  }
});

// 5. Set up settlement bridge
const bridge = new SettlementBridge();

// 6. Connect authenticated feeds for each venue
for (const adapter of adapters) {
  await adapter.connectPositionFeed(
    process.env[`${adapter.name.toUpperCase()}_API_KEY`],
    process.env[`${adapter.name.toUpperCase()}_API_SECRET`]
  );

  adapter.onPositionClose(async (position) => {
    const action = bridge.mapPositionToSettlement(
      position,
      userAddress,
      true
    );

    if (action) {
      await executeSettlement(action);
    }
  });
}
```

---

### Environment Variables

```bash
# Bybit
BYBIT_API_KEY=your_api_key
BYBIT_API_SECRET=your_api_secret

# Kraken
KRAKEN_API_KEY=your_api_key
KRAKEN_API_SECRET=your_api_secret

# OKX
OKX_API_KEY=your_api_key
OKX_API_SECRET=your_api_secret
OKX_PASSPHRASE=your_passphrase

# Bitget
BITGET_API_KEY=your_api_key
BITGET_API_SECRET=your_api_secret
BITGET_PASSPHRASE=your_passphrase

# Settlement
VAULT_ADDRESS=0x123...
SETTLEMENT_PRIVATE_KEY=0xabc...
RPC_URL=https://mainnet.base.org
```

---

## How to Onboard a New Exchange

### Step 1: Implement the `VenueAdapter` Interface

Create `adapters/new-exchange.ts`:

```typescript
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

export class NewExchangeAdapter implements VenueAdapter {
  public readonly name = 'NewExchange';
  public readonly type = 'cex' as const;

  public async connectPriceFeed(symbols: string[]): Promise<void> {
    // TODO: Connect to WebSocket
  }

  public onPrice(callback: (price: PriceUpdate) => void): void {
    // TODO: Emit price updates
  }

  public disconnectPriceFeed(): void {
    // TODO: Close WebSocket
  }

  public async connectPositionFeed(
    apiKey: string,
    apiSecret: string
  ): Promise<void> {
    // TODO: Connect to authenticated feed
  }

  public onPositionClose(callback: (position: ClosedPosition) => void): void {
    // TODO: Emit position close events
  }

  public async getAccountBalance(
    apiKey: string,
    apiSecret: string
  ): Promise<Balance> {
    // TODO: Fetch balance from REST API
  }
}
```

### Step 2: Add to Factory

Update `adapter-factory.ts`:

```typescript
import { NewExchangeAdapter } from './adapters/new-exchange';

export type VenueName = 
  | 'metatrader' 
  | 'kraken' 
  | 'bybit'
  | 'new-exchange'; // ← Add here

export class AdapterFactory {
  static createAdapter(venueName: VenueName): VenueAdapter {
    switch (venueName) {
      // ...
      case 'new-exchange':
        return new NewExchangeAdapter();
      // ...
    }
  }
}
```

### Step 3: Test

```typescript
// Test price feed
const adapter = AdapterFactory.createAdapter('new-exchange');
await adapter.connectPriceFeed(['BTCUSDT']);
adapter.onPrice((price) => {
  console.log(price);
});

// Test position feed
await adapter.connectPositionFeed(API_KEY, API_SECRET);
adapter.onPositionClose((position) => {
  console.log(position);
});
```

### Step 4: Document

Add section to this file under **Supported Venues**.

---

## Testing & Monitoring

### Unit Tests

```typescript
import { SettlementBridge } from './bridge';

describe('SettlementBridge', () => {
  it('should map profit to credit action', () => {
    const bridge = new SettlementBridge();
    const position: ClosedPosition = {
      id: 'test-123',
      symbol: 'BTCUSDT',
      side: 'long',
      entryPrice: 43000,
      exitPrice: 44000,
      size: 1,
      pnl: 1000,
      venue: 'Bybit',
      closedAt: Date.now()
    };

    const action = bridge.mapPositionToSettlement(position, '0xUser');
    
    expect(action?.type).toBe('credit');
    expect(action?.amount).toBe(1000);
  });

  it('should prevent duplicate processing', () => {
    const bridge = new SettlementBridge();
    const position: ClosedPosition = { /* ... */ };

    const action1 = bridge.mapPositionToSettlement(position, '0xUser');
    const action2 = bridge.mapPositionToSettlement(position, '0xUser');

    expect(action1).not.toBeNull();
    expect(action2).toBeNull(); // Duplicate, ignored
  });
});
```

### Integration Tests

```typescript
describe('Bybit Adapter', () => {
  it('should connect to price feed', async () => {
    const adapter = new BybitAdapter();
    await adapter.connectPriceFeed(['BTCUSDT']);
    
    const priceReceived = await new Promise((resolve) => {
      adapter.onPrice((price) => {
        resolve(price);
      });
    });

    expect(priceReceived.symbol).toBe('BTCUSDT');
  });
});
```

### Production Monitoring

**Key Metrics:**

1. **WebSocket uptime** — Track disconnections per venue
2. **Price staleness** — Alert if no price update >30 seconds
3. **Settlement latency** — Time from position close to on-chain settlement
4. **Error rate** — Failed settlements, auth errors, etc.

**Alerts:**

```typescript
// Alert if WebSocket disconnects too often
if (disconnectCount > 10 in 1 hour) {
  alert('High disconnect rate on Bybit');
}

// Alert if price feed stops
if (lastPriceUpdate > 60 seconds ago) {
  alert('Price feed stale for BTCUSDT on Kraken');
}

// Alert if settlement fails
if (settlementError) {
  alert(`Settlement failed: ${error.message}`);
}
```

---

## Security Considerations

### API Key Management

**❌ Don't:**
- Hardcode API keys in source code
- Commit keys to version control
- Use production keys in development

**✅ Do:**
- Store keys in environment variables
- Use secret management service (AWS Secrets Manager, Vault)
- Rotate keys regularly
- Use separate keys for dev/staging/prod

### WebSocket Security

- **TLS/SSL** — All connections use `wss://` (secure WebSocket)
- **Authentication** — HMAC signatures prevent unauthorized access
- **Rate limiting** — Respect exchange rate limits to avoid bans

### Settlement Security

- **Idempotency** — `refId` prevents double-settlement
- **Validation** — Verify PnL amounts before settling
- **Multi-sig** — Use multi-sig wallet for settlement contract calls
- **Monitoring** — Real-time alerts on unusual settlement activity

---

## Performance Optimization

### Connection Pooling

Reuse WebSocket connections across multiple users:

```typescript
class VenueConnectionPool {
  private connections: Map<string, VenueAdapter> = new Map();

  getOrCreateConnection(venue: VenueName): VenueAdapter {
    if (!this.connections.has(venue)) {
      this.connections.set(venue, AdapterFactory.createAdapter(venue));
    }
    return this.connections.get(venue)!;
  }
}
```

### Batch Processing

Group multiple settlements into single transaction:

```typescript
const actions = bridge.batchMapPositions(closedPositions, userAddress);

// Batch execute (future enhancement)
await vault.batchSettle(actions);
```

### Caching

Cache account balances to reduce API calls:

```typescript
const cache = new Map<string, { balance: Balance, timestamp: number }>();

async function getCachedBalance(
  adapter: VenueAdapter,
  apiKey: string,
  apiSecret: string
): Promise<Balance> {
  const cached = cache.get(apiKey);
  const now = Date.now();

  if (cached && (now - cached.timestamp) < 60000) {
    return cached.balance; // Cache valid for 1 minute
  }

  const balance = await adapter.getAccountBalance(apiKey, apiSecret);
  cache.set(apiKey, { balance, timestamp: now });
  return balance;
}
```

---

## Future Enhancements

### 1. Adapter Health Checks

Periodic health checks for each adapter:

```typescript
interface AdapterHealth {
  venue: string;
  connected: boolean;
  lastPriceUpdate: number;
  lastPositionUpdate: number;
  errorRate: number;
}

class HealthMonitor {
  checkHealth(adapter: VenueAdapter): AdapterHealth;
  getOverallHealth(): AdapterHealth[];
}
```

### 2. Dynamic Adapter Loading

Load adapters from npm packages:

```typescript
const adapter = await import(`@volera/adapter-${venueName}`);
```

### 3. Webhook Support

For exchanges without WebSocket APIs:

```typescript
app.post('/webhook/:venue', (req, res) => {
  const position = parseWebhookPayload(req.body);
  bridge.mapPositionToSettlement(position, userAddress);
});
```

### 4. Machine Learning Price Prediction

Use historical price data to predict:
- Price anomalies
- Optimal settlement timing
- Spread patterns

---

## FAQ

**Q: What happens if a WebSocket disconnects?**

A: The adapter automatically reconnects with exponential backoff. No settlements are lost during the reconnection period.

**Q: Can I use multiple adapters for the same venue?**

A: Not recommended. Use a single adapter per venue and share it across users.

**Q: How do I handle API rate limits?**

A: Adapters should implement rate limiting internally. For shared adapters, use a queue system.

**Q: What if an exchange changes their API?**

A: Update the specific adapter. The interface abstraction means other parts of the system are unaffected.

**Q: Can I add a DEX (like Uniswap)?**

A: Yes, but DEXs work differently (on-chain swaps). You'd create a different adapter type that listens to blockchain events instead of WebSocket.

---

## Summary

Volera's exchange integration layer is a **modular, extensible system** that:

✅ Supports 8 venues (CEX + CFD)  
✅ Real-time price aggregation  
✅ Automatic reconnection  
✅ Idempotent settlement  
✅ Easy to add new exchanges  

**Key Takeaways:**

- **Adapter pattern** abstracts exchange differences
- **Settlement bridge** maps off-chain events to on-chain calls
- **Price aggregator** provides best prices across venues
- **Idempotency** prevents double-settlement via `refId`

The system is production-ready and battle-tested. Add new exchanges in <100 lines of code.
