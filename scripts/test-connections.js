import { config } from '../src/config/env.js';
import { query, closePool } from '../src/config/database.js';
import Redis from 'ioredis';

const ok = (label) => console.log(`  ✔ ${label}`);
const fail = (label, err) => console.error(`  ✘ ${label}: ${err.message}`);

console.log('\n=== Teste de Conexões ===\n');
console.log(`Ambiente: ${config.nodeEnv}`);

let exitCode = 0;

// --- PostgreSQL ---
try {
  const { rows } = await query('SELECT NOW() AS now');
  ok(`PostgreSQL conectado (${rows[0].now})`);
} catch (err) {
  fail('PostgreSQL', err);
  exitCode = 1;
}

// --- Tabelas ---
try {
  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  const tables = rows.map((r) => r.table_name);
  ok(`Tabelas encontradas: ${tables.join(', ')}`);
} catch (err) {
  fail('Verificação de tabelas', err);
  exitCode = 1;
}

// --- Redis ---
const redis = new Redis(config.redisUrl, { lazyConnect: true, connectTimeout: 5000 });
try {
  await redis.connect();
  await redis.ping();
  ok('Redis conectado');
} catch (err) {
  fail('Redis', err);
  exitCode = 1;
} finally {
  redis.disconnect();
}

// --- Config carregado ---
console.log('\n--- Configuração ---');
console.log(`  MK Base URL:      ${config.mk.baseUrl}`);
console.log(`  n8n Webhook URL:  ${config.n8nWebhookUrl}`);
console.log(`  Uazapi URL:       ${config.uazapi.baseUrl}`);
console.log(`  OpenAI Key:       ${config.openaiApiKey.slice(0, 7)}...`);
console.log(`  Porta backend:    ${config.port}`);
console.log(`  Porta dashboard:  ${config.dashboardPort}`);

await closePool();

console.log(`\n=== ${exitCode === 0 ? 'Tudo OK' : 'Falhas detectadas'} ===\n`);
process.exit(exitCode);
