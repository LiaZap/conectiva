import { query } from '../config/database.js';

export async function saveMessage({ session_id, direcao, conteudo, canal }) {
  const { rows } = await query(
    `INSERT INTO messages (session_id, direcao, conteudo, canal)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [session_id, direcao, conteudo, canal]
  );
  return rows[0];
}

export async function saveInteraction({
  session_id,
  intencao,
  confianca,
  mensagem_cliente,
  resposta_ia,
  acao_mk,
  mk_endpoint,
  mk_sucesso,
  mk_resposta,
  status,
  tempo_ia_ms,
  tempo_mk_ms,
  tempo_total_ms,
  os_criada,
  boleto_gerado,
  desbloqueio_executado,
  contrato_criado,
  metadata,
}) {
  const { rows } = await query(
    `INSERT INTO interactions_log
       (session_id, intencao, confianca, mensagem_cliente, resposta_ia,
        acao_mk, mk_endpoint, mk_sucesso, mk_resposta, status,
        tempo_classificacao_ms, tempo_mk_ms, tempo_resposta_ms,
        os_criada, boleto_gerado, desbloqueio_executado, contrato_criado, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      session_id,
      intencao,
      confianca,
      mensagem_cliente,
      resposta_ia,
      acao_mk,
      mk_endpoint,
      mk_sucesso,
      mk_resposta ? JSON.stringify(mk_resposta) : null,
      status || 'processando',
      tempo_ia_ms,
      tempo_mk_ms,
      tempo_total_ms,
      os_criada,
      boleto_gerado ?? false,
      desbloqueio_executado ?? false,
      contrato_criado ?? false,
      metadata ? JSON.stringify(metadata) : '{}',
    ]
  );
  return rows[0];
}

export async function saveAction({
  session_id,
  interaction_id,
  acao,
  descricao,
  status,
  dados_entrada,
  dados_saida,
  tempo_ms,
}) {
  const { rows } = await query(
    `INSERT INTO ai_actions_log
       (session_id, interaction_id, acao, descricao, status,
        dados_entrada, dados_saida, tempo_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      session_id,
      interaction_id,
      acao,
      descricao,
      status || 'executando',
      dados_entrada ? JSON.stringify(dados_entrada) : null,
      dados_saida ? JSON.stringify(dados_saida) : null,
      tempo_ms,
    ]
  );
  return rows[0];
}

export async function saveEscalation({
  session_id,
  motivo,
  prioridade,
  historico_conversa,
  dados_cliente,
  os_mk,
}) {
  const { rows } = await query(
    `INSERT INTO escalations
       (session_id, motivo, prioridade, historico_conversa, dados_cliente, os_mk)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      session_id,
      motivo,
      prioridade || 'media',
      historico_conversa ? JSON.stringify(historico_conversa) : null,
      dados_cliente ? JSON.stringify(dados_cliente) : null,
      os_mk,
    ]
  );
  return rows[0];
}
