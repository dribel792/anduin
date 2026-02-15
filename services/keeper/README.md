# Anduin Keeper Service

Automated settlement bot for Anduin. Monitors position closes, triggers settlements, and runs netting rounds.

## Components

1. **keeper.ts** - Main settlement bot
   - Listens for position close events
   - Calculates PnL
   - Triggers on-chain settlements
   - Handles retries with exponential backoff

2. **netting-scheduler.ts** - Netting automation
   - Collects pending settlements
   - Calculates optimal netting
   - Executes batch settlements

3. **health-check.ts** - Monitoring
   - Checks RPC connection
   - Monitors keeper balance
   - Alerts on failures
   - Logs health metrics

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment (`.env`):
```bash
# Network
NETWORK=testnet
RPC_URL=https://sepolia.base.org

# Keeper account
KEEPER_PRIVATE_KEY=0x...

# Intervals (ms)
KEEPER_POLL_INTERVAL=10000        # Poll every 10s
NETTING_INTERVAL=3600000          # Net every 1h
HEALTH_CHECK_INTERVAL=60000       # Health check every 1m

# Retry logic
MAX_RETRIES=3
RETRY_BACKOFF_MS=1000

# Gas management
MAX_GAS_PRICE=100000000000        # 100 gwei
GAS_LIMIT=500000

# Monitoring
ALERT_WEBHOOK=https://hooks.slack.com/...  # Optional
```

3. Ensure keeper has funds:
```bash
# Check balance
cast balance 0x... --rpc-url $RPC_URL

# Fund if needed
cast send 0x... --value 0.1ether --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

## Running

### Individual Services

```bash
# Settlement keeper
npm run keeper

# Netting scheduler
npm run netting

# Health monitor
npm run health
```

### All Services

```bash
# Run all three simultaneously
npm run dev
```

### Production

Use a process manager like PM2:

```bash
# Install PM2
npm install -g pm2

# Start keeper
pm2 start keeper.ts --name anduin-keeper --interpreter ts-node

# Start netting scheduler
pm2 start netting-scheduler.ts --name anduin-netting --interpreter ts-node

# Start health monitor
pm2 start health-check.ts --name anduin-health --interpreter ts-node

# Save configuration
pm2 save
pm2 startup
```

## How It Works

### Settlement Flow

1. **Position Close Event**
   - Exchange integration (e.g., Hyperliquid) emits position close
   - Keeper receives event with entry price, exit price, quantity

2. **PnL Calculation**
   - Calculate profit/loss: `(exitPrice - entryPrice) * quantity * side`
   - Determine settlement type (credit or debit)

3. **On-Chain Settlement**
   - Estimate gas cost
   - Submit transaction to vault
   - Wait for confirmation
   - Retry on failure with exponential backoff

### Netting Flow

1. **Collection Phase**
   - Collect all pending settlements for the netting window
   - Group by vault address

2. **Netting Calculation**
   - Sum amounts per client within each vault
   - Remove zero balances (fully offset)
   - Calculate savings vs. gross settlement

3. **Batch Execution**
   - Generate merkle tree of netted settlements
   - Submit batch settlement transaction
   - Record netting efficiency metrics

### Health Monitoring

- **Balance Check**: Ensure keeper has enough ETH for gas
- **RPC Check**: Verify connection to Base RPC
- **Block Height**: Confirm chain is progressing
- **Alert System**: Notify on failures (Slack, PagerDuty, etc.)

## Monitoring

Health status is saved to `../../logs/keeper-health.json`:

```json
{
  "timestamp": "2024-02-15T19:00:00.000Z",
  "healthy": true,
  "checks": {
    "rpcConnection": true,
    "keeperBalance": true,
    "blockHeight": true
  },
  "metrics": {
    "balance": "0.5",
    "blockNumber": "1234567",
    "gasPrice": "0.5"
  },
  "alerts": []
}
```

## Integration with API

The keeper can integrate with the API server (`services/api/`) to:
- Submit settlements via REST API
- Query pending settlements
- Access client configuration

## Security

- **Private Key**: Store keeper private key securely (env var, vault, HSM)
- **Gas Limits**: Set max gas price to prevent overspending
- **Rate Limiting**: Prevent excessive on-chain activity
- **Alerts**: Get notified of failures immediately

## Troubleshooting

### Keeper stops processing

1. Check balance: `cast balance 0x...`
2. Check health logs: `cat ../../logs/keeper-health.json`
3. Check RPC connectivity: `cast block latest --rpc-url $RPC_URL`
4. Review keeper logs for errors

### Settlements failing

1. Check gas price (may be too low/high)
2. Verify contract addresses in deployment config
3. Ensure keeper has settlement permissions
4. Check vault balance (sufficient for debits)

### High retry rate

- Gas price too high → Increase `MAX_GAS_PRICE`
- RPC issues → Use a more reliable RPC provider
- Contract reverts → Check vault state and permissions
