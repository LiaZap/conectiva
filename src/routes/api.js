import { Router } from 'express';
import { query } from '../config/database.js';
import * as sessionService from '../services/session.js';
import * as logger from '../services/logger.js';
import { sendText } from '../services/whatsapp.js';
import { execute as n8nExecute } from '../services/n8n.js';
import { emit, emitToSession, EVENTS } from '../websocket/events.js';

const router = Router();

// ============================================================
// SESSIONS
// ============================================================

// GET /api/sessions - Listar sessões com filtros e paginação
// Por padrão mostra apenas sessões das últimas 24h (exceto se filtros específicos forem passados)
router.get('/api/sessions', async (req, res) => {
  try {
    const { status, canal, intencao, data_inicio, data_fim, todas, limit = 50, offset = 0 } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status)      { conditions.push(`s.status = $${idx++}`);              params.push(status); }
    if (canal)       { conditions.push(`s.canal = $${idx++}`);               params.push(canal); }
    if (intencao)    { conditions.push(`s.intencao_principal = $${idx++}`);   params.push(intencao); }
    if (data_inicio) { conditions.push(`s.created_at >= $${idx++}`);         params.push(data_inicio); }
    if (data_fim)    { conditions.push(`s.created_at <= $${idx++}`);         params.push(data_fim); }

    // Filtro padrão: últimas 24h (exceto se 'todas=true' ou filtros de data foram passados)
    if (!todas && !data_inicio && !data_fim) {
      conditions.push(`s.updated_at > NOW() - INTERVAL '24 hours'`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(`SELECT COUNT(*) FROM sessions s ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await query(
      `SELECT s.* FROM sessions s ${where} ORDER BY s.updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      params
    );

    res.json({ success: true, data: rows, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) {
    console.error('[api] GET /sessions erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sessions/:id - Detalhe completo
router.get('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const session = await sessionService.findById(id);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão não encontrada' });

    const [messages, interactions, actions] = await Promise.all([
      query('SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC', [id]),
      query('SELECT * FROM interactions_log WHERE session_id = $1 ORDER BY created_at ASC', [id]),
      query('SELECT * FROM ai_actions_log WHERE session_id = $1 ORDER BY created_at ASC', [id]),
    ]);

    res.json({
      success: true,
      data: {
        session,
        messages: messages.rows,
        interactions: interactions.rows,
        actions: actions.rows,
      },
    });
  } catch (err) {
    console.error('[api] GET /sessions/:id erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sessions/:id/actions - Timeline de ações da IA
router.get('/api/sessions/:id/actions', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM ai_actions_log WHERE session_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[api] GET /sessions/:id/actions erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sessions/:id/takeover - Humano assume a conversa
router.post('/api/sessions/:id/takeover', async (req, res) => {
  try {
    const { id } = req.params;
    const { atendente } = req.body || {};

    const session = await sessionService.findById(id);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão não encontrada' });

    const updated = await sessionService.update(id, {
      status: 'aguardando_humano',
      resolvida_por: 'humano',
    });

    emit(EVENTS.ESCALONAMENTO, { session_id: id, motivo: 'Takeover manual', atendente });
    // Emitir atualização de sessão para todos os clientes
    emit(EVENTS.SESSAO_ATUALIZADA, { session_id: id, status: 'aguardando_humano', atendente });

    res.json({ success: true, data: updated, message: 'Conversa assumida com sucesso. O bot não responderá mais nesta sessão.' });
  } catch (err) {
    console.error('[api] POST /sessions/:id/takeover erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sessions/:id/release - Devolver sessão ao bot
router.post('/api/sessions/:id/release', async (req, res) => {
  try {
    const { id } = req.params;

    const session = await sessionService.findById(id);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão não encontrada' });

    const updated = await sessionService.update(id, {
      status: 'ativa',
      resolvida_por: null,
    });

    emit(EVENTS.SESSAO_ATUALIZADA, { session_id: id, status: 'ativa' });

    res.json({ success: true, data: updated, message: 'Sessão devolvida ao bot.' });
  } catch (err) {
    console.error('[api] POST /sessions/:id/release erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sessions/:id/send - Humano envia mensagem ao cliente
router.post('/api/sessions/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Mensagem não pode ser vazia' });
    }

    const session = await sessionService.findById(id);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão não encontrada' });

    // Auto-assumir: se a sessão não está em modo humano, assumir automaticamente
    if (session.status !== 'aguardando_humano') {
      await sessionService.update(id, { status: 'aguardando_humano', resolvida_por: 'humano' });
      emit(EVENTS.SESSAO_ATUALIZADA, { session_id: id, status: 'aguardando_humano' });
    }

    // Enviar mensagem via WhatsApp (ou outro canal)
    if (session.canal === 'whatsapp' && session.telefone) {
      const result = await sendText(session.telefone, message.trim());
      if (!result.success) {
        return res.status(502).json({ success: false, error: 'Falha ao enviar mensagem via WhatsApp', details: result.error });
      }
    }

    // Gravar mensagem no banco
    await logger.saveMessage({
      session_id: id,
      direcao: 'saida',
      conteudo: message.trim(),
      canal: session.canal,
    });

    // Emitir evento para o dashboard (atualizar chat em tempo real)
    emit(EVENTS.RESPOSTA_ENVIADA, { session_id: id, resposta: message.trim(), remetente: 'humano' });
    emitToSession(id, EVENTS.RESPOSTA_ENVIADA, { resposta: message.trim(), direcao: 'saida', remetente: 'humano' });

    res.json({ success: true, message: 'Mensagem enviada com sucesso' });
  } catch (err) {
    console.error('[api] POST /sessions/:id/send erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sessions/:id/close - Finalizar sessão
router.post('/api/sessions/:id/close', async (req, res) => {
  try {
    const { id } = req.params;

    const session = await sessionService.findById(id);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão não encontrada' });

    const updated = await sessionService.update(id, { status: 'finalizada' });

    emit(EVENTS.SESSAO_ENCERRADA, { session_id: id, motivo: 'finalizada_manual' });

    res.json({ success: true, data: updated, message: 'Sessão finalizada.' });
  } catch (err) {
    console.error('[api] POST /sessions/:id/close erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/sessions/:id - Excluir sessão e dados relacionados
router.delete('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const session = await sessionService.findById(id);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão não encontrada' });

    // Excluir dados relacionados em ordem (FKs)
    await query('DELETE FROM ai_actions_log WHERE session_id = $1', [id]);
    await query('DELETE FROM interactions_log WHERE session_id = $1', [id]);
    await query('DELETE FROM messages WHERE session_id = $1', [id]);
    await query('DELETE FROM escalations WHERE session_id = $1', [id]);
    await query('DELETE FROM sessions WHERE id = $1', [id]);

    emit(EVENTS.SESSAO_ENCERRADA, { session_id: id, motivo: 'excluida' });

    res.json({ success: true, message: 'Sessão e dados excluídos.' });
  } catch (err) {
    console.error('[api] DELETE /sessions/:id erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// ESCALATIONS
// ============================================================

// GET /api/escalations - Listar escalonamentos com filtros e paginação
router.get('/api/escalations', async (req, res) => {
  try {
    const { status, prioridade, data_inicio, data_fim, limit = 50, offset = 0 } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status)      { conditions.push(`e.status = $${idx++}`);      params.push(status); }
    if (prioridade)  { conditions.push(`e.prioridade = $${idx++}`);  params.push(prioridade); }
    if (data_inicio) { conditions.push(`e.created_at >= $${idx++}`); params.push(data_inicio); }
    if (data_fim)    { conditions.push(`e.created_at <= $${idx++}`); params.push(data_fim); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(`SELECT COUNT(*) FROM escalations e ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await query(
      `SELECT e.*, s.telefone, s.nome_cliente, s.canal
       FROM escalations e
       JOIN sessions s ON s.id = e.session_id
       ${where}
       ORDER BY
         CASE e.prioridade WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
         e.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      params
    );

    res.json({ success: true, data: rows, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) {
    console.error('[api] GET /escalations erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/escalations/:id/assign - Designar atendente
router.post('/api/escalations/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { atendente } = req.body;
    if (!atendente) return res.status(400).json({ success: false, error: 'Campo atendente é obrigatório' });

    const { rows } = await query(
      `UPDATE escalations
       SET atendente_designado = $2, status = 'em_atendimento', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, atendente]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Escalonamento não encontrado' });

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[api] POST /escalations/:id/assign erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/escalations/:id/resolve - Marcar como resolvido
router.post('/api/escalations/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await query(
      `UPDATE escalations SET status = 'resolvido', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Escalonamento não encontrado' });

    // Finalizar sessão vinculada
    await sessionService.update(rows[0].session_id, { status: 'finalizada', resolvida_por: 'humano' });

    // Emitir evento de sessão encerrada
    emit(EVENTS.SESSAO_ENCERRADA, { session_id: rows[0].session_id, motivo: 'resolvido_humano' });

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[api] POST /escalations/:id/resolve erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// CUSTOMERS (AC4 - Integração cadastral MK)
// ============================================================

// GET /api/customers/search?doc=CPF_OU_CNPJ - Consultar cliente no MK por CPF/CNPJ
router.get('/api/customers/search', async (req, res) => {
  try {
    const { doc } = req.query;
    if (!doc) return res.status(400).json({ success: false, error: 'Parâmetro doc (CPF/CNPJ) é obrigatório' });

    const result = await n8nExecute({
      action: 'CONSULTAR_CLIENTE',
      params: { doc: doc.replace(/\D/g, '') },
      session_id: 'api-dashboard',
    });

    if (!result.success) {
      return res.status(502).json({ success: false, error: 'Erro ao consultar MK', details: result.error });
    }

    res.json({ success: true, data: result.data, tempo_ms: result.tempo_ms });
  } catch (err) {
    console.error('[api] GET /customers/search erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/customers/:cdCliente/faturas - Faturas do cliente no MK
router.get('/api/customers/:cdCliente/faturas', async (req, res) => {
  try {
    const { cdCliente } = req.params;

    const result = await n8nExecute({
      action: 'FATURAS_PENDENTES',
      params: { cd_cliente: cdCliente },
      session_id: 'api-dashboard',
    });

    if (!result.success) {
      return res.status(502).json({ success: false, error: 'Erro ao consultar faturas', details: result.error });
    }

    res.json({ success: true, data: result.data, tempo_ms: result.tempo_ms });
  } catch (err) {
    console.error('[api] GET /customers/:id/faturas erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/customers/:cdCliente/conexoes - Conexões do cliente no MK
router.get('/api/customers/:cdCliente/conexoes', async (req, res) => {
  try {
    const { cdCliente } = req.params;

    const result = await n8nExecute({
      action: 'CONEXOES_CLIENTE',
      params: { cd_cliente: cdCliente },
      session_id: 'api-dashboard',
    });

    if (!result.success) {
      return res.status(502).json({ success: false, error: 'Erro ao consultar conexões', details: result.error });
    }

    res.json({ success: true, data: result.data, tempo_ms: result.tempo_ms });
  } catch (err) {
    console.error('[api] GET /customers/:id/conexoes erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/customers/:cdCliente/contratos - Contratos do cliente no MK
router.get('/api/customers/:cdCliente/contratos', async (req, res) => {
  try {
    const { cdCliente } = req.params;

    const result = await n8nExecute({
      action: 'CONTRATOS_CLIENTE',
      params: { cd_cliente: cdCliente },
      session_id: 'api-dashboard',
    });

    if (!result.success) {
      return res.status(502).json({ success: false, error: 'Erro ao consultar contratos', details: result.error });
    }

    res.json({ success: true, data: result.data, tempo_ms: result.tempo_ms });
  } catch (err) {
    console.error('[api] GET /customers/:id/contratos erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/customers/:cdCliente/update - Registrar solicitação de atualização cadastral
router.post('/api/customers/:cdCliente/update', async (req, res) => {
  try {
    const { cdCliente } = req.params;
    const { descricao, email, telefone, observacao } = req.body;

    if (!descricao) {
      return res.status(400).json({ success: false, error: 'Campo descricao é obrigatório' });
    }

    const result = await n8nExecute({
      action: 'ATUALIZAR_CADASTRO',
      params: {
        cd_cliente: cdCliente,
        tipo_atendimento: 'ATUALIZACAO_CADASTRO',
        descricao,
        email: email || '',
        telefone: telefone || '',
        observacao: observacao || '',
      },
      session_id: 'api-dashboard',
    });

    if (!result.success) {
      return res.status(502).json({ success: false, error: 'Erro ao registrar atualização no MK', details: result.error });
    }

    res.json({
      success: true,
      message: 'Solicitação de atualização cadastral registrada',
      data: result.data,
      tempo_ms: result.tempo_ms,
    });
  } catch (err) {
    console.error('[api] POST /customers/:id/update erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
