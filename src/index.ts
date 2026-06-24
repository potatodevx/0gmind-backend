import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import contextRouter from './routes/context';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AgentPass API',
    network: '0G Galileo Testnet',
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api/context', contextRouter);

// Root
app.get('/', (_req, res) => {
  res.json({
    name: 'AgentPass API',
    version: '1.0.0',
    description: 'Portable AI memory protocol on 0G Storage',
    endpoints: {
      health: 'GET /health',
      storeContext: 'POST /api/context/store',
      loadContext: 'POST /api/context/load',
      listContexts: 'GET /api/context/list',
      chatWithContext: 'POST /api/context/chat',
      contextMetadata: 'GET /api/context/:id/metadata',
      stats: 'GET /api/context/stats',
    },
    network: {
      chain: '0G Galileo Testnet',
      chainId: 16601,
      rpc: 'https://evmrpc-testnet.0g.ai',
      explorer: 'https://chainscan-galileo.0g.ai',
    },
  });
});

app.listen(PORT, () => {
  console.log(`AgentPass API running on port ${PORT}`);
  console.log(`Network: 0G Galileo Testnet`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

export default app;
