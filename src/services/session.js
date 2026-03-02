import { query } from '../config/database.js';
import { config } from '../config/env.js';
import { emit, EVENTS } from '../websocket/events.js';

/**
 * Busca sessão reutilizável por telefone/canal, ou cria uma nova.
 * Reutiliza sessões ativas, aguardando_humano, ou recentes (< 2h) mesmo expiradas.
 * Isso evita acúmulo de sessões duplicadas para o mesmo cliente.
 */
export async function findOrCreate({ telefone, canal, pushName }) {
  const ttl = config.sessionTtlMinutes;

  // 1. Buscar sessão ativa ou aguardando humano (não expirada)
  const { rows } = await query(
    `SELECT * FROM sessions
     WHERE telefone = $1 AND canal = $2 AND status IN ('ativa', 'aguardando_humano') AND expires_at > NOW()
     ORDER BY updated_at DESC LIMIT 1`,
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

  // 2. Buscar sessão recente (< 2h) mesmo expirada — reutilizar em vez de criar nova
  const { rows: recent } = await query(
    `SELECT * FROM sessions
     WHERE telefone = $1 AND canal = $2 AND status IN ('expirada', 'escalonada')
       AND updated_at > NOW() - INTERVAL '2 hours'
     ORDER BY updated_at DESC LIMIT 1`,
    [telefone, canal]
  );

  if (recent.length > 0) {
    await query(
      `UPDATE sessions SET status = 'ativa', expires_at = NOW() + $2 * INTERVAL '1 minute', updated_at = NOW()
       WHERE id = $1`,
      [recent[0].id, ttl]
    );
    console.log('[session] Sessão reativada:', recent[0].id);
    return { ...recent[0], status: 'ativa' };
  }

  // 3. Criar nova sessão somente se não existe nenhuma recente
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
