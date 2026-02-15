/**
 * Anduin API Server
 * 
 * Express.js REST API for settlement management
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { config } from './config';
import { authenticate } from './middleware/auth';

// Import routes
import settlementsRouter from './routes/settlements';
import vaultsRouter from './routes/vaults';
import clientsRouter from './routes/clients';
import insuranceRouter from './routes/insurance';
import nettingRouter from './routes/netting';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.nodeEnv === 'production' 
    ? ['https://anduin.finance', 'https://app.anduin.finance']
    : '*',
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (config.nodeEnv !== 'test') {
  app.use(morgan('combined'));
}

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    network: config.network,
    version: config.apiVersion,
  });
});

// API info (no auth required)
app.get('/api', (req, res) => {
  res.json({
    name: 'Anduin Settlement API',
    version: config.apiVersion,
    description: 'API for managing PnL settlements on Base',
    network: config.network,
    chainId: config.chainId,
    endpoints: {
      health: '/health',
      settlements: `/api/${config.apiVersion}/settlements`,
      vaults: `/api/${config.apiVersion}/vaults`,
      clients: `/api/${config.apiVersion}/clients`,
      insurance: `/api/${config.apiVersion}/insurance`,
      netting: `/api/${config.apiVersion}/netting`,
    },
    docs: 'https://docs.anduin.finance/api',
  });
});

// Apply authentication to all /api routes
app.use(`/api/${config.apiVersion}`, authenticate);

// Mount routes
app.use(`/api/${config.apiVersion}/settlements`, settlementsRouter);
app.use(`/api/${config.apiVersion}/vaults`, vaultsRouter);
app.use(`/api/${config.apiVersion}/clients`, clientsRouter);
app.use(`/api/${config.apiVersion}/insurance`, insuranceRouter);
app.use(`/api/${config.apiVersion}/netting`, nettingRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route not found: ${req.method} ${req.path}`,
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', err);
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.nodeEnv === 'development' ? err.message : 'An unexpected error occurred',
    ...(config.nodeEnv === 'development' && { stack: err.stack }),
  });
});

// Start server
const PORT = config.port;

app.listen(PORT, () => {
  console.log(`\n🚀 Anduin API Server`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Network: ${config.network} (Chain ID: ${config.chainId})`);
  console.log(`   Listening on: http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   API version: ${config.apiVersion}`);
  console.log(`\n📝 API Endpoints:`);
  console.log(`   POST   /api/${config.apiVersion}/settlements`);
  console.log(`   GET    /api/${config.apiVersion}/settlements`);
  console.log(`   GET    /api/${config.apiVersion}/settlements/:id`);
  console.log(`   POST   /api/${config.apiVersion}/settlements/batch`);
  console.log(`   GET    /api/${config.apiVersion}/vaults`);
  console.log(`   GET    /api/${config.apiVersion}/vaults/:address/balance`);
  console.log(`   POST   /api/${config.apiVersion}/vaults/:address/deposit`);
  console.log(`   POST   /api/${config.apiVersion}/vaults/:address/withdraw`);
  console.log(`   POST   /api/${config.apiVersion}/clients`);
  console.log(`   GET    /api/${config.apiVersion}/clients`);
  console.log(`   GET    /api/${config.apiVersion}/clients/:id`);
  console.log(`   PUT    /api/${config.apiVersion}/clients/:id`);
  console.log(`   GET    /api/${config.apiVersion}/insurance`);
  console.log(`   POST   /api/${config.apiVersion}/insurance/deposit`);
  console.log(`   GET    /api/${config.apiVersion}/insurance/history`);
  console.log(`   POST   /api/${config.apiVersion}/netting/calculate`);
  console.log(`   POST   /api/${config.apiVersion}/netting/execute`);
  console.log(`   GET    /api/${config.apiVersion}/netting/history\n`);
});

export default app;
