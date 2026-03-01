import { query } from '../config/database.js';
import { config } from '../config/env.js';
import { emit, EVENTS } from '../websocket/events.js';

/**
 * Busca sessão ativa por telefone/canal, ou cria uma nova.
 */
export async function findOrCreate({ telefone, canal, pushName }) {
  const ttl = config.sessionTtlMinutes;

  const { rows } = await query(
    `SELECT * FROM sessions
     WHERE telefone = $1 AND canal = $2 AND status = 'ativa' AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [telefone, canal]
  );

  if (rows.length > 0) {
    await query(
      `UPDATE sessions SET expires_at = NOW() + $2 * INTERVAL '1 minute', updated_at = NOW()
       WHERE id = $1`,
      [rows[0].id, ttl]
    );
    return rows[0];
  }

  const { rows: created } = await query(
    `INSERT INTO sessions (canal, telefone, nome_cliente, status, expires_at)
     VALUES ($1, $2, $3, 'ativa', NOW() + $4 * INTERVAL '1 minute')
     RETURNING *`,
    [canal, telefone, pushName || null, ttl]
  );
  console.log('[session] Nova sessão criada:', created[0].id);
  return created[0];
}

/**
 * Busca sessão por ID.
 */
export async function findById(id) {
  const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Atualiza campos da sessão.
 */
export async function update(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;

  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  sets.push('updated_at = NOW()');

  const { rows } = await query(
    `UPDATE sessions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...Object.values(fields)]
  );
  return rows[0];
}

/**
 * Incrementa total_mensagens.
 */
export async function incrementMessages(id) {
  await query(
    'UPDATE sessions SET total_mensagens = total_mensagens + 1, updated_at = NOW() WHERE id = $1',
    [id]
  );
}

/**
 * Busca histórico de mensagens da sessão (para enviar à IA).
 */
export async function getHistory(sessionId, limit = 20) {
  const { rows } = await query(
    'SELECT direcao, conteudo FROM messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
    [sessionId, limit]
  );
  return rows;
}

/**
 * Expira sessões que passaram do TTL.
 */
export async function expireStale() {
  // Buscar IDs antes de expirar para poder emitir evento
  const { rows } = await query(
    `UPDATE sessions SET status = 'expirada', updated_at = NOW()
     WHERE status = 'ativa' AND expires_at <= NOW()
     RETURNING id`
  );

  if (rows.length > 0) {
    console.log(`[session] ${rows.length} sessões expiradas`);
    for (const row of rows) {
      emit(EVENTS.SESSAO_ENCERRADA, { session_id: row.id, motivo: 'expirada' });
    }
  }

  return rows.length;
}
