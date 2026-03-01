import pg from 'pg';
import { config } from './env.js';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[database] Erro inesperado no pool:', err.message);
});

/**
 * Executa uma query simples.
 * Uso: const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [id]);
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  if (config.nodeEnv === 'development') {
    console.log('[database] query', { text: text.slice(0, 80), duration: `${duration}ms`, rows: result.rowCount });
  }

  return result;
}

/**
 * Obtém um client do pool para transações.
 * Uso:
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     await client.query('INSERT ...', [...]);
 *     await client.query('COMMIT');
 *   } catch (err) {
 *     await client.query('ROLLBACK');
 *     throw err;
 *   } finally {
 *     client.release();
 *   }
 */
export async function getClient() {
  return pool.connect();
}

/**
 * Encerra o pool (para shutdown graceful).
 */
export async function closePool() {
  await pool.end();
  console.log('[database] Pool encerrado.');
}

export { pool };
