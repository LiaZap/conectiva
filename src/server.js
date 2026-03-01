import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import { config } from './config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { query, closePool } from './config/database.js';
import Redis from 'ioredis';
import { init as initWS } from './websocket/events.js';
import webhookRouter from './routes/webhook.js';
import apiRouter from './routes/api.js';
import dashboardRouter from './routes/dashboard.js';
import authRouter from './routes/auth.js';
import { expireStale } from './services/session.js';
import {
  helmetMiddleware,
  generalLimiter,
  webhookLimiter,
  sanitizeBody,
} from './middleware/security.js';

// Express
const app = express();

// ── Segurança ──
app.use(helmetMiddleware);
app.set('trust proxy', 1); // Para rate-limit funcionar atrás de proxy/nginx

app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    process.env.DASHBOARD_ORIGIN,       // Permitir domínio personalizado
    process.env.WIDGET_ORIGIN,          // Permitir domínio do site com widget
  ].filter(Boolean),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
}));

// Widget: CORS aberto só para o endpoint do webhook/site (qualquer origem pode usar o widget)
app.use('/webhook/site', cors());

app.use(express.json({ limit: '1mb' }));
app.use(sanitizeBody);

// ── Widget estático ──
app.use('/widget', express.static(join(__dirname, '..', 'widget')));

// HTTP server
const server = createServer(app);

// WebSocket
initWS(server);

// ── Rate Limiting por rota ──
app.use('/webhook', webhookLimiter);
app.use('/api', generalLimiter);

// ── Rotas ──
app.use(authRouter);
app.use(webhookRouter);
app.use(apiRouter);
app.use(dashboardRouter);

// Health check
const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
});
redis.on('error', (err) => {
  console.error('[redis] Erro de conexão:', err.message);
});

// Rota raiz (evita 404 no health check padrão do EasyPanel)
app.get('/', (_req, res) => {
  res.json({ service: 'conectiva-bot', status: 'running' });
});

app.get('/health', async (_req, res) => {
  const checks = { postgres: false, redis: false };

  try {
    await query('SELECT 1');
    checks.postgres = true;
  } catch (_) { /* falhou */ }

  try {
    await redis.ping();
    checks.redis = true;
  } catch (_) { /* falhou */ }

  const healthy = checks.postgres && checks.redis;
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
});

// Error handler global
app.use((err, _req, res, _next) => {
  console.error('[server] Erro não tratado:', err);
  res.status(500).json({ success: false, error: 'Erro interno do servidor' });
});

// Expirar sessões a cada 1 minuto
const expireInterval = setInterval(() => expireStale().catch((err) => {
  console.error('[server] Erro ao expirar sessões:', err.message);
}), 60_000);

// Iniciar
server.listen(config.port, () => {
  console.log(`\n  🤖 Conectiva Bot rodando na porta ${config.port}`);
  console.log(`  📡 WebSocket pronto`);
  console.log(`  🔒 Segurança: helmet + rate-limit + sanitização`);
  console.log(`  🌐 Ambiente: ${config.nodeEnv}\n`);
});

// Shutdown graceful
async function shutdown() {
  console.log('\n[server] Encerrando...');
  clearInterval(expireInterval);
  server.close();
  redis.disconnect();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
