import { query } from '../config/database.js';
import { config } from '../config/env.js';
import { emit, EVENTS } from '../websocket/events.js';
import { generateSummary } from './ai.js';
import { sendText } from './whatsapp.js';
import * as logger from './logger.js';

/**
 * Busca sessão reutilizável por telefone/canal, ou cria uma nova.
 * Reutiliza sessões ativas, aguardando_humano, ou recentes (< 2h) mesmo expiradas.
 * Isso evita acúmulo de sessões duplicadas para o mesmo cliente.
 */
export async function findOrCreate({ telefone, canal, pushName }) {
  const ttl = config.sessionTtlMinutes;

  // 1. Buscar sessão ativa ou aguardando humano (não expirada) — excluir aguardando_avaliacao
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

// Mensagem de CSAT enviada quando a sessão expira
const CSAT_MESSAGE = `Oi! Aqui é a Ana, da *Conectiva* 😊

Vi que nossa conversa ficou parada. Espero ter conseguido te ajudar!

Antes de encerrar, *como você avalia o atendimento de hoje?*

Responde com uma nota de *1 a 5*:
1️⃣ Péssimo
2️⃣ Ruim
3️⃣ Regular
4️⃣ Bom
5️⃣ Excelente

Sua opinião ajuda a gente a melhorar! 💙`;

/**
 * Expira sessões que passaram do TTL.
 * Envia pesquisa CSAT por WhatsApp e gera resumo IA.
 */
export async function expireStale() {
  // Buscar sessões para expirar (com dados para o resumo/CSAT)
  const { rows } = await query(
    `UPDATE sessions SET status = 'expirada', updated_at = NOW()
     WHERE status = 'ativa' AND expires_at <= NOW()
     RETURNING *`
  );

  if (rows.length > 0) {
    console.log(`[session] ${rows.length} sessões expiradas`);
    for (const row of rows) {
      emit(EVENTS.SESSAO_ENCERRADA, { session_id: row.id, motivo: 'expirada' });

      // Gerar resumo IA em background
      generateAndSaveSummary(row.id, row).catch((err) =>
        console.error(`[session] Erro ao gerar resumo para ${row.id}:`, err.message)
      );

      // Enviar CSAT por WhatsApp (só se teve interação real — ≥2 mensagens)
      if (row.canal === 'whatsapp' && row.telefone && row.total_mensagens >= 2) {
        try {
          await sendText(row.telefone, CSAT_MESSAGE);
          await logger.saveMessage({ session_id: row.id, direcao: 'saida', conteudo: CSAT_MESSAGE, canal: 'whatsapp' });
          await startCSAT(row.id);
          console.log(`[session] CSAT enviada ao expirar sessão ${row.id}`);
        } catch (err) {
          console.error(`[session] Erro ao enviar CSAT para ${row.id}:`, err.message);
        }
      }
    }
  }

  return rows.length;
}

/**
 * Gera resumo IA e salva na sessão.
 */
export async function generateAndSaveSummary(sessionId, sessionData) {
  try {
    const historico = await getHistory(sessionId, 30);
    if (!historico || historico.length < 2) return null;

    const session = sessionData || await findById(sessionId);
    const resumo = await generateSummary(historico, session);

    if (resumo) {
      await query(
        'UPDATE sessions SET resumo_ia = $1 WHERE id = $2',
        [resumo, sessionId]
      );
      console.log(`[session] Resumo IA salvo para sessão ${sessionId}`);
    }

    return resumo;
  } catch (err) {
    console.error('[session] Erro ao gerar/salvar resumo:', err.message);
    return null;
  }
}

/**
 * Inicia pesquisa de satisfação para a sessão.
 * Muda status para 'aguardando_avaliacao'.
 */
export async function startCSAT(sessionId) {
  await query(
    `UPDATE sessions SET status = 'aguardando_avaliacao', updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );
  console.log(`[session] CSAT iniciada para sessão ${sessionId}`);
}

/**
 * Salva nota de satisfação.
 */
export async function saveCSAT(sessionId, nota) {
  const notaInt = parseInt(nota);
  if (isNaN(notaInt) || notaInt < 1 || notaInt > 5) return false;

  await query(
    'UPDATE sessions SET nota_satisfacao = $1, status = $2, updated_at = NOW() WHERE id = $3',
    [notaInt, 'finalizada', sessionId]
  );
  console.log(`[session] CSAT salva para sessão ${sessionId}: nota ${notaInt}`);
  return true;
}

/**
 * Busca sessão aguardando avaliação por telefone/canal.
 */
export async function findAwaitingCSAT(telefone, canal) {
  const { rows } = await query(
    `SELECT * FROM sessions
     WHERE telefone = $1 AND canal = $2 AND status = 'aguardando_avaliacao'
     AND updated_at > NOW() - INTERVAL '1 hour'
     ORDER BY updated_at DESC LIMIT 1`,
    [telefone, canal]
  );
  return rows[0] || null;
}
