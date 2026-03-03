import 'dotenv/config';

const required = [
  'DATABASE_URL',
  'REDIS_URL',
  'N8N_WEBHOOK_URL',
  'OPENAI_API_KEY',
  'MK_BASE_URL',
  'MK_USER_TOKEN',
  'MK_PASSWORD',
  'UAZAPI_BASE_URL',
  'UAZAPI_TOKEN',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[env] Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  process.exit(1);
}

export const config = {
  // Servidor
  port: parseInt(process.env.PORT || '3000', 10),
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // PostgreSQL
  databaseUrl: process.env.DATABASE_URL,

  // Redis
  redisUrl: process.env.REDIS_URL,

  // n8n
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL,

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY,

  // MK Solutions
  mk: {
    baseUrl: process.env.MK_BASE_URL,
    userToken: process.env.MK_USER_TOKEN,
    password: process.env.MK_PASSWORD,
    cdServico: process.env.MK_CD_SERVICO || '9999',
  },

  // Uazapi (WhatsApp)
  uazapi: {
    baseUrl: process.env.UAZAPI_BASE_URL,
    token: process.env.UAZAPI_TOKEN,
  },

  // Sessão
  sessionTtlMinutes: parseInt(process.env.SESSION_TTL_MINUTES || '30', 10),

  // Notificações
  notifyGroupId: process.env.NOTIFY_GROUP_ID || '',         // ID do grupo WhatsApp para alertas (ex: 120363xxx@g.us)
  dashboardUrl: process.env.DASHBOARD_URL || '',             // URL pública do dashboard (ex: https://cusrzj.easypanel.host/dashboard)
};
