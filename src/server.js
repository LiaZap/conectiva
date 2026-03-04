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
import settingsRouter from './routes/settings.js';
import { expireStale } from './services/session.js';
import { loadAll as loadSettings } from './services/settings.js';
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
    'https://conectiva.bahflash.tech',  // Dashboard domínio próprio
    process.env.DASHBOARD_ORIGIN,       // Permitir domínio personalizado adicional
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

// ── Dashboard estático (produção) ──
if (config.nodeEnv === 'production') {
  const dashPath = join(__dirname, '..', 'dashboard', 'dist');
  // Servir na raiz (para domínio próprio: conectiva.bahflash.tech)
  app.use(express.static(dashPath));
  // Manter compatibilidade com /dashboard/ (legado EasyPanel)
  app.use('/dashboard', express.static(dashPath));
  app.get('/dashboard/*', (_req, res) => {
    res.sendFile(join(dashPath, 'index.html'));
  });
}

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
app.use(settingsRouter);

// Health check
const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
});
redis.on('error', (err) => {
  console.error('[redis] Erro de conexão:', err.message);
});

// Health check (EasyPanel/Docker usam /health)
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
  // Sempre retorna 200 para não ser reiniciado pelo health check do EasyPanel/Docker
  res.status(200).json({ status: healthy ? 'ok' : 'degraded', checks });
});

// ── SPA catch-all (domínio próprio — todas rotas não-API servem o index.html) ──
if (config.nodeEnv === 'production') {
  const dashPath = join(__dirname, '..', 'dashboard', 'dist');
  app.get('*', (req, res, next) => {
    // Não interceptar rotas de API, webhook, widget ou health
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook') ||
        req.path.startsWith('/widget') || req.path.startsWith('/health') ||
        req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(join(dashPath, 'index.html'));
  });
}

// Error handler global
app.use((err, _req, res, _next) => {
  console.error('[server] Erro não tratado:', err);
  res.status(500).json({ success: false, error: 'Erro interno do servidor' });
});

// Expirar sessões a cada 1 minuto
const expireInterval = setInterval(() => expireStale().catch((err) => {
  console.error('[server] Erro ao expirar sessões:', err.message);
}), 60_000);

// ── Migrações automáticas ──
async function runMigrations() {
  try {
    // v2: CSAT + Resumo IA
    await query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS nota_satisfacao INTEGER');
    await query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS resumo_ia TEXT');
    // Atualizar CHECK constraint de status (adicionar 'aguardando_avaliacao')
    await query("ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check");
    await query("ALTER TABLE sessions ADD CONSTRAINT sessions_status_check CHECK (status IN ('ativa', 'aguardando_humano', 'finalizada', 'expirada', 'aguardando_avaliacao'))");
    console.log('[migration] Migrações v2 aplicadas (CSAT + Resumo IA)');

    // v3: Reincidência — detectar números que já entraram em contato
    await query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reincidencia BOOLEAN DEFAULT false');
    await query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_contatos_anteriores INTEGER DEFAULT 0');
    console.log('[migration] Migrações v3 aplicadas (Reincidência)');

    // v4: Tabela de configurações dinâmicas
    await query(`CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      categoria VARCHAR(50) NOT NULL,
      chave VARCHAR(100) NOT NULL,
      valor JSONB NOT NULL DEFAULT '{}',
      descricao TEXT,
      ordem INTEGER DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by VARCHAR(100),
      UNIQUE(categoria, chave)
    )`);

    // Seed: inserir dados padrão se tabela vazia
    const { rows: countRows } = await query('SELECT COUNT(*) FROM settings');
    if (parseInt(countRows[0].count) === 0) {
      const seed = [
        ['empresa', 'info_geral', JSON.stringify({ nome: 'Conectiva Internet', descricao: 'Provedor de internet por fibra óptica', total_clientes: '7 mil', total_empresas: '300+', km_fibra: '300+' }), 'Informações gerais da empresa', 1],
        ['empresa', 'valores', JSON.stringify({ lista: ['Transparência', 'Segurança', 'Comprometimento', 'Respeito', 'Ética', 'Qualidade'] }), 'Valores da empresa', 2],
        ['empresa', 'cobertura', JSON.stringify({ areas: ['Lagoa Santa', 'Matozinhos', 'Pedro Leopoldo', 'Capim Branco', 'Prudente de Morais', 'Funilândia', 'Contagem'] }), 'Áreas de cobertura', 3],
        ['planos', 'plano_600_mega', JSON.stringify({ nome: '600 MEGA', velocidade: '600', preco: 99.90, cod_mk: 1326, beneficios: ['Lev Educa'], emoji: '📶', destaque: false }), 'Plano 600 Mega', 1],
        ['planos', 'plano_800_mega', JSON.stringify({ nome: '800 MEGA', velocidade: '800', preco: 129.90, cod_mk: 1320, beneficios: ['Lev Educa', 'Deezer', 'Paramount+', 'Watch'], emoji: '📶', destaque: false }), 'Plano 800 Mega', 2],
        ['planos', 'plano_1_giga', JSON.stringify({ nome: '1 GIGA', velocidade: '1000', preco: 139.90, cod_mk: 1327, beneficios: ['Lev Educa', 'Deezer', 'Paramount+', 'Watch'], emoji: '🚀', destaque: true }), 'Plano 1 Giga', 3],
        ['lojas', 'loja_matozinhos', JSON.stringify({ cidade: 'Matozinhos', endereco: 'R. José Dias Corrêa, 87A — Centro', telefone: '(31) 3712-1294' }), 'Loja Matozinhos', 1],
        ['lojas', 'loja_lagoa_santa', JSON.stringify({ cidade: 'Lagoa Santa', endereco: 'R. Aleomar Baleeiro, 462 — Centro', telefone: '(31) 3268-4691' }), 'Loja Lagoa Santa', 2],
        ['lojas', 'loja_prudente', JSON.stringify({ cidade: 'Prudente de Morais', endereco: 'R. José de Souza, 83A — Centro', telefone: '' }), 'Loja Prudente de Morais', 3],
        ['contatos', 'telefones', JSON.stringify({ lista: [{ cidade: 'Matozinhos', numero: '(31) 3712-1294' }, { cidade: 'Lagoa Santa', numero: '(31) 3268-4691' }] }), 'Telefones de contato', 1],
        ['ia', 'personalidade', JSON.stringify({ nome_atendente: 'Ana', cargo: 'atendente', tom: 'natural, leve, empático e acolhedor', usar_emojis: true, max_emojis_por_msg: 3 }), 'Personalidade da IA', 1],
        ['ia', 'servicos_extras', JSON.stringify({ lista: ['Telefonia Móvel: Planos através de parcerias com Vivo e TIM', 'Combos: Internet + Telefonia com desconto', 'App Conectiva: Para consultar 2ª via de boleto e suporte rápido'] }), 'Outros serviços oferecidos', 2],
        ['regras', 'vencimentos', JSON.stringify({ dias_disponiveis: [10, 15, 20, 30] }), 'Dias de vencimento disponíveis', 1],
        ['regras', 'sessao', JSON.stringify({ timeout_minutos: 30 }), 'Regras de sessão', 2],
      ];
      for (const [cat, chave, valor, desc, ordem] of seed) {
        await query(
          'INSERT INTO settings (categoria, chave, valor, descricao, ordem) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [cat, chave, valor, desc, ordem]
        );
      }
      console.log('[migration] Seed de configurações inserido');
    }
    console.log('[migration] Migrações v4 aplicadas (Settings)');
  } catch (err) {
    console.error('[migration] Erro nas migrações:', err.message);
  }
}

// Iniciar
server.listen(config.port, async () => {
  console.log(`\n  🤖 Conectiva IA rodando na porta ${config.port}`);
  console.log(`  📡 WebSocket pronto`);
  console.log(`  🔒 Segurança: helmet + rate-limit + sanitização`);
  console.log(`  🌐 Ambiente: ${config.nodeEnv}\n`);
  await runMigrations();
  await loadSettings();
});

// Shutdown graceful
async function shutdown(signal) {
  console.log(`\n[server] Encerrando... (signal: ${signal})`);
  clearInterval(expireInterval);
  server.close();
  redis.disconnect();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});
