# Volera Exchange/Broker Integration Adapters

This directory contains modular adapters for integrating with 8 major cryptocurrency exchanges and CFD brokers. The adapters provide real-time price feeds and position monitoring infrastructure for the Volera settlement system.

## Architecture Overview

The integration system is built on a common interface pattern that allows seamless switching between venues and aggregation of data across multiple sources.

### Core Components

1. **VenueAdapter Interface** (`types.ts`) - Common interface for all venues
2. **Settlement Bridge** (`bridge.ts`) - Maps off-chain position closes to on-chain settlement calls
3. **Adapter Factory** (`adapter-factory.ts`) - Creates venue adapters by name
4. **Price Aggregator** (`price-aggregator.ts`) - Aggregates and normalizes prices across venues

### File Structure

```
services/integrations/
├── types.ts              # Common interfaces (VenueAdapter, PriceUpdate, etc.)
├── bridge.ts             # Settlement bridge (venue → on-chain)
├── adapter-factory.ts    # Factory pattern for adapter creation
├── price-aggregator.ts   # Multi-venue price aggregation
├── adapters/
│   ├── metatrader.ts    # MetaTrader 5 (CFD brokers like JFD)
│   ├── kraken.ts        # Kraken exchange
│   ├── bybit.ts         # Bybit exchange
│   ├── bitget.ts        # Bitget exchange
│   ├── okx.ts           # OKX exchange
│   ├── mexc.ts          # MEXC exchange
│   ├── kucoin.ts        # KuCoin exchange
│   └── htx.ts           # HTX (Huobi) exchange
└── README.md            # This file
```

## Supported Venues

| Venue | Type | Symbols | WebSocket | REST API |
|-------|------|---------|-----------|----------|
| **MetaTrader** | CFD | XAUUSD, XAGUSD, EURUSD | Custom MT5 bridge | Custom |
| **Kraken** | CEX | BTC/USD, ETH/USD | wss://ws.kraken.com/v2 | api.kraken.com |
| **Bybit** | CEX | BTCUSDT, ETHUSDT | wss://stream.bybit.com/v5 | api.bybit.com/v5 |
| **Bitget** | CEX | BTCUSDT, ETHUSDT | wss://ws.bitget.com/v2 | api.bitget.com/api/v2 |
| **OKX** | CEX | BTC-USDT-SWAP | wss://ws.okx.com:8443 | www.okx.com/api/v5 |
| **MEXC** | CEX | BTCUSDT, ETHUSDT | wss://wbs.mexc.com/ws | api.mexc.com/api/v3 |
| **KuCoin** | CEX | BTC-USDT, ETH-USDT | Dynamic (token-based) | api.kucoin.com/api/v1 |
| **HTX** | CEX | btcusdt, ethusdt | wss://api.huobi.pro/ws | api.huobi.pro |

## Quick Start

### 1. Basic Price Feed

```typescript
import { KrakenAdapter } from './adapters/kraken';

const kraken = new KrakenAdapter();

// Subscribe to price updates
kraken.onPrice((price) => {
  console.log(`${price.symbol}: bid=${price.bid}, ask=${price.ask}`);
});

// Connect to price feed (no API key needed for public data)
await kraken.connectPriceFeed(['BTC/USD', 'ETH/USD']);
```

### 2. Multi-Venue Price Aggregation

```typescript
import { PriceAggregator } from './price-aggregator';
import { AdapterFactory } from './adapter-factory';

const aggregator = new PriceAggregator();

// Add multiple venues
const venues = ['kraken', 'bybit', 'okx'];
venues.forEach(venueName => {
  const adapter = AdapterFactory.createAdapter(venueName);
  aggregator.addAdapter(adapter);
});

// Subscribe to aggregated prices (best bid/ask across all venues)
aggregator.onAggregatedPrice((price) => {
  console.log(`${price.symbol}: best bid=${price.bestBid}, best ask=${price.bestAsk}`);
  console.log(`Spread: ${price.spread}, Venues: ${Object.keys(price.venues).join(', ')}`);
});

// Connect all adapters
await aggregator.connectAll(['BTCUSDT', 'ETHUSDT']);
```

### 3. Position Monitoring (Authenticated)

```typescript
import { BybitAdapter } from './adapters/bybit';

const bybit = new BybitAdapter();

// Subscribe to position close events
bybit.onPositionClose((position) => {
  console.log(`Position closed: ${position.symbol}, PnL: $${position.pnl}`);
});

// Connect with API credentials
await bybit.connectPositionFeed(
  process.env.BYBIT_API_KEY!,
  process.env.BYBIT_API_SECRET!
);
```

### 4. Settlement Bridge (Map to On-Chain)

```typescript
import { SettlementBridge } from './bridge';
import { BybitAdapter } from './adapters/bybit';

const bridge = new SettlementBridge();
const bybit = new BybitAdapter();

bybit.onPositionClose((position) => {
  // Map to settlement action
  const action = bridge.mapPositionToSettlement(
    position,
    userAddress,
    false // cappedSeizure
  );

  if (action) {
    console.log(`Settlement action: ${action.type}, amount: $${action.amount}`);
    
    // Execute on-chain settlement
    switch (action.type) {
      case 'credit':
        await contract.creditPnl(action.user, action.amount, action.refId);
        break;
      case 'seize':
        await contract.seizeCollateral(action.user, action.amount, action.refId);
        break;
      case 'seizeCapped':
        await contract.seizeCollateralCapped(action.user, action.amount, action.refId);
        break;
    }
  }
});
```

## How Price Feeds Work

### Public Price Data (No API Key Required)

All adapters support public price feeds via WebSocket or REST polling:

1. **WebSocket** (preferred) - Real-time tick data, lower latency
2. **REST Polling** (fallback) - Periodic API calls, higher latency

Price updates are delivered via callbacks:

```typescript
adapter.onPrice((price: PriceUpdate) => {
  // price.symbol: "BTCUSD"
  // price.bid: 50000.0
  // price.ask: 50001.0
  // price.timestamp: 1234567890
  // price.venue: "Kraken"
});
```

### Reconnection & Heartbeats

All adapters implement:
- **Exponential backoff** for reconnection (up to 10 attempts)
- **Heartbeat/ping-pong** to keep WebSocket connections alive
- **Error handling** with proper logging

## How Settlement Flow Works

### Off-Chain → On-Chain Mapping

When a user closes a trading position on a venue (CEX or CFD broker):

1. **Position Close Event** - Adapter receives position close notification
2. **ClosedPosition Object** - Contains PnL, entry/exit prices, symbol, etc.
3. **Settlement Bridge** - Maps to on-chain action:
   - **Profit** → `creditPnl(user, amount, refId)`
   - **Loss** → `seizeCollateral(user, amount, refId)` or `seizeCollateralCapped`
4. **RefId Generation** - `keccak256(venue + positionId)` for deduplication
5. **On-Chain Execution** - Smart contract updates user's collateral and PnL

### Deduplication

The settlement bridge tracks processed positions by `refId` to prevent double-settlement:

```typescript
const refId = keccak256(venue + positionId);
if (bridge.isProcessed(venue, positionId)) {
  return; // Already settled
}
```

## API Key Requirements

### Public Price Feeds
**No API key needed** - All venues support public WebSocket/REST for market data.

### Position Monitoring
**Requires user API credentials** - Each client must provide their own API key/secret to monitor their positions.

| Venue | API Key | API Secret | Passphrase |
|-------|---------|------------|------------|
| MetaTrader | ✅ | ✅ | ❌ |
| Kraken | ✅ | ✅ | ❌ |
| Bybit | ✅ | ✅ | ❌ |
| Bitget | ✅ | ✅ | ✅ |
| OKX | ✅ | ✅ | ✅ |
| MEXC | ✅ | ✅ | ❌ |
| KuCoin | ✅ | ✅ | ✅ |
| HTX | ✅ | ✅ | ❌ |

### Account Management
**Requires admin/read API keys** - For checking balances and account status.

**Important**: API keys should have **read-only** permissions when possible. Never store API keys in code - use environment variables:

```bash
# .env
KRAKEN_API_KEY=your_key_here
KRAKEN_API_SECRET=your_secret_here
```

## Adding a New Venue

To add support for a new exchange or broker:

### 1. Create Adapter File

```typescript
// adapters/newvenue.ts
import { VenueAdapter, PriceUpdate, ClosedPosition, Balance } from '../types';

export class NewVenueAdapter implements VenueAdapter {
  public readonly name = 'NewVenue';
  public readonly type = 'cex'; // or 'cfd'
  
  // Implement all VenueAdapter methods...
}
```

### 2. Implement Required Methods

Every adapter must implement:

```typescript
// Price feeds (public)
async connectPriceFeed(symbols: string[]): Promise<void>
onPrice(callback: (price: PriceUpdate) => void): void
disconnectPriceFeed(): void

// Position monitoring (authenticated)
async connectPositionFeed(apiKey: string, apiSecret: string, passphrase?: string): Promise<void>
onPositionClose(callback: (position: ClosedPosition) => void): void

// Account management
async getAccountBalance(apiKey: string, apiSecret: string): Promise<Balance>
```

### 3. WebSocket Best Practices

- Use **exponential backoff** for reconnection
- Implement **heartbeat/ping-pong** (typically every 20-30 seconds)
- Handle **gzip compression** if the venue uses it (e.g., HTX)
- Parse messages **defensively** with try/catch
- Log errors but don't crash

### 4. Add to Factory

```typescript
// adapter-factory.ts
case 'newvenue':
  return new NewVenueAdapter();
```

### 5. Update Documentation

Add the venue to the supported venues table in this README.

## Example Configuration

### Multi-Venue Setup

```typescript
import { AdapterFactory } from './adapter-factory';
import { PriceAggregator } from './price-aggregator';
import { SettlementBridge } from './bridge';

// Create adapters for 3 CEXes
const venues = ['kraken', 'bybit', 'okx'];
const adapters = venues.map(v => AdapterFactory.createAdapter(v));

// Price aggregation
const aggregator = new PriceAggregator();
adapters.forEach(adapter => aggregator.addAdapter(adapter));
await aggregator.connectAll(['BTCUSDT', 'ETHUSDT']);

// Settlement bridge
const bridge = new SettlementBridge();

// Position monitoring (for authenticated users)
const bybit = new BybitAdapter();
await bybit.connectPositionFeed(API_KEY, API_SECRET);

bybit.onPositionClose((position) => {
  const action = bridge.mapPositionToSettlement(position, userAddress);
  if (action) {
    // Execute on-chain settlement
    executeSettlement(action);
  }
});
```

## Testing

### 1. Test Public Price Feeds

```bash
# Run a single adapter
npx ts-node -e "
  import { KrakenAdapter } from './adapters/kraken';
  const k = new KrakenAdapter();
  k.onPrice(p => console.log(p));
  await k.connectPriceFeed(['BTC/USD']);
"
```

### 2. Test Price Aggregation

```typescript
// test-aggregator.ts
import { PriceAggregator } from './price-aggregator';
import { AdapterFactory } from './adapter-factory';

const agg = new PriceAggregator();
['kraken', 'bybit'].forEach(v => {
  agg.addAdapter(AdapterFactory.createAdapter(v));
});

agg.onAggregatedPrice(p => {
  console.log(`Best bid: ${p.bestBid}, Best ask: ${p.bestAsk}`);
});

await agg.connectAll(['BTCUSDT']);
```

### 3. Test Settlement Bridge

```typescript
import { SettlementBridge } from './bridge';

const bridge = new SettlementBridge();
const mockPosition = {
  id: '12345',
  symbol: 'BTCUSDT',
  side: 'long',
  entryPrice: 50000,
  exitPrice: 51000,
  size: 1,
  pnl: 1000,
  venue: 'Bybit',
  closedAt: Date.now()
};

const action = bridge.mapPositionToSettlement(mockPosition, '0x123...', false);
console.log(action); // { type: 'credit', amount: 1000, ... }
```

## Venue-Specific Notes

### MetaTrader (MT5)
- Requires custom bridge server (not standard REST/WebSocket)
- Broker credentials needed (not user credentials)
- Tick data format varies by broker (JFD, IC Markets, etc.)

### Kraken
- Uses "XBT" instead of "BTC" in some contexts
- WebSocket token required for private data
- Supports both spot and futures

### Bybit
- Disconnects after 30s idle - heartbeat every 20s
- Unified account model (USDT margin)
- Clean WebSocket V5 API

### Bitget
- Requires passphrase in addition to API key/secret
- Supports both spot and USDT futures
- Good documentation

### OKX
- Requires passphrase for authentication
- Uses instrument IDs like "BTC-USDT-SWAP"
- Complex auth signature scheme

### MEXC
- Simplest API among CEXes
- Book ticker provides best bid/ask
- Limited private WebSocket support

### KuCoin
- WebSocket requires dynamic token from REST API
- Token expires after 24 hours
- Ping required every 50 seconds

### HTX (Huobi)
- All WebSocket messages are gzip-compressed
- Uses ping/pong initiated by server
- Complex auth signature (needs exact timestamp format)

## Security Considerations

1. **Never hardcode API keys** - Use environment variables or secure vaults
2. **Use read-only API keys** when possible
3. **Validate all user inputs** before passing to adapters
4. **Rate limit** API calls to avoid bans
5. **Monitor for anomalies** - sudden PnL spikes, duplicate settlements, etc.
6. **Audit settlement actions** before executing on-chain
7. **Use multi-sig** for settlement contract admin functions

## Performance Tips

1. **WebSocket over REST** - Lower latency, fewer API calls
2. **Batch settlements** - Group multiple position closes into one transaction
3. **Price staleness checks** - Ignore prices older than 30 seconds
4. **Connection pooling** - Reuse WebSocket connections
5. **Lazy loading** - Only connect adapters when needed

## Troubleshooting

### WebSocket Disconnects Frequently
- Check heartbeat interval (should be < venue's timeout)
- Verify network stability
- Look for rate limiting (too many subscriptions)

### Missing Price Updates
- Confirm symbol format (BTC/USD vs BTCUSDT vs BTC-USDT-SWAP)
- Check WebSocket subscription confirmation
- Verify venue supports the symbol

### Authentication Failures
- Double-check API key permissions (read-only sufficient for monitoring)
- Verify signature generation (timestamp, encoding, etc.)
- Check if passphrase is required (Bitget, OKX, KuCoin)

### Duplicate Settlements
- Confirm refId generation is deterministic
- Check `isProcessed()` before settlement
- Audit on-chain refId tracking

## License

MIT

## Contributing

When adding a new venue adapter:
1. Follow the existing adapter patterns
2. Include JSDoc comments
3. Test with real WebSocket connections
4. Document venue-specific quirks
5. Update this README

## Support

For questions or issues, contact the Volera team or open an issue on GitHub.
