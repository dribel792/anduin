# Anduin API Server

REST API for managing PnL settlements on Base blockchain.

## Features

- **Settlement Management**: Create, execute, and track settlements
- **Vault Operations**: Deposits, withdrawals, balance queries
- **Client Onboarding**: API key management, configuration
- **Insurance Fund**: Monitor and manage insurance reserves
- **Netting Engine**: Bilateral and multilateral netting for capital efficiency
- **Security**: API key auth, rate limiting, CORS, helmet
- **Blockchain Integration**: viem-based interaction with Base

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
# Network
NETWORK=testnet  # or mainnet
RPC_URL=https://sepolia.base.org

# Security
KEEPER_PRIVATE_KEY=0x...
JWT_SECRET=your-secret-key-here
ADMIN_API_KEYS=admin-key-1,admin-key-2

# Server
PORT=3000
NODE_ENV=development

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000  # 1 minute
RATE_LIMIT_MAX_REQUESTS=100
```

3. Deploy contracts first (see `scripts/deploy/`)

4. Start the server:
```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Settlements
- `POST /api/v1/settlements` - Create settlement
- `GET /api/v1/settlements` - List settlements
- `GET /api/v1/settlements/:id` - Get settlement details
- `POST /api/v1/settlements/batch` - Batch settlement with merkle proof

### Vaults
- `GET /api/v1/vaults` - List all vaults
- `GET /api/v1/vaults/:address/balance` - Get vault balance
- `GET /api/v1/vaults/:address/positions` - Get open positions
- `POST /api/v1/vaults/:address/deposit` - Deposit to vault
- `POST /api/v1/vaults/:address/withdraw` - Withdraw from vault

### Clients
- `POST /api/v1/clients` - Onboard new client (admin)
- `GET /api/v1/clients` - List clients (admin)
- `GET /api/v1/clients/:id` - Get client details
- `PUT /api/v1/clients/:id` - Update client config (admin)

### Insurance
- `GET /api/v1/insurance` - Insurance fund status
- `POST /api/v1/insurance/deposit` - Deposit to insurance fund (admin)
- `GET /api/v1/insurance/history` - Insurance history (admin)

### Netting
- `POST /api/v1/netting/calculate` - Calculate netting
- `POST /api/v1/netting/execute` - Execute netted settlement
- `GET /api/v1/netting/history` - Netting history

## Authentication

All API endpoints (except `/health` and `/api`) require an API key:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:3000/api/v1/vaults
```

Admin endpoints require an admin API key (set in `ADMIN_API_KEYS` env var).

## Example Usage

### Create Settlement
```bash
curl -X POST http://localhost:3000/api/v1/settlements \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "client-1",
    "vaultAddress": "0x...",
    "amount": "100.50",
    "type": "credit"
  }'
```

### Get Vault Balance
```bash
curl http://localhost:3000/api/v1/vaults/0x.../balance?client=0x... \
  -H "X-API-Key: your-api-key"
```

### Batch Settlement with Netting
```bash
curl -X POST http://localhost:3000/api/v1/settlements/batch \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "vaultAddress": "0x...",
    "settlements": [
      { "clientId": "client-1", "amount": "100" },
      { "clientId": "client-2", "amount": "-50" }
    ]
  }'
```

## Architecture

```
services/api/
├── server.ts              # Express app setup
├── config.ts              # Configuration management
├── routes/                # API route handlers
│   ├── settlements.ts
│   ├── vaults.ts
│   ├── clients.ts
│   ├── insurance.ts
│   └── netting.ts
├── middleware/            # Express middleware
│   ├── auth.ts            # API key authentication
│   └── validation.ts      # Zod request validation
└── services/              # Business logic
    ├── blockchain.ts      # viem client & contract calls
    ├── settlement-engine.ts
    └── netting-engine.ts
```

## Security

- **API Keys**: Each client gets a unique API key
- **Rate Limiting**: Configurable per-IP rate limits
- **CORS**: Configured for production domains
- **Helmet**: Security headers
- **Input Validation**: Zod schemas for all requests
- **Private Key Security**: Keeper key stored in env, never exposed

## Monitoring

Use the dashboard (`services/dashboard/`) to monitor:
- Settlement volume and status
- Vault balances
- Insurance fund health
- Netting efficiency
- System health

## Production Deployment

1. Use environment variables (not `.env` file)
2. Enable HTTPS (use reverse proxy like nginx)
3. Set `NODE_ENV=production`
4. Use a proper database (replace in-memory storage)
5. Set up monitoring and alerting
6. Regularly rotate API keys
7. Use a multisig for admin operations
