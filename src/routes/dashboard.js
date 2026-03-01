import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

/**
 * Converte o parâmetro ?periodo= em cláusula SQL de data.
 * Retorna { clause, params, nextIdx } para encadear com outros filtros.
 */
function buildPeriodFilter(periodo, table = 's', startIdx = 1) {
  const col = `${table}.created_at`;
  switch (periodo) {
    case 'hoje':
      return { clause: `${col} >= CURRENT_DATE`, params: [], nextIdx: startIdx };
    case 'semana':
      return { clause: `${col} >= DATE_TRUNC('week', CURRENT_DATE)`, params: [], nextIdx: startIdx };
    case 'mes':
      return { clause: `${col} >= DATE_TRUNC('month', CURRENT_DATE)`, params: [], nextIdx: startIdx };
    default:
      return { clause: `${col} >= CURRENT_DATE - INTERVAL '30 days'`, params: [], nextIdx: startIdx };
  }
}

// ============================================================
// GET /api/metrics/overview
// ============================================================
router.get('/api/metrics/overview', async (req, res) => {
  try {
    const pf = buildPeriodFilter(req.query.periodo);

    const [totals, activeNow] = await Promise.all([
      query(
        `SELECT
           COUNT(*)::int AS total_atendimentos,
           COUNT(*) FILTER (WHERE s.resolvida_por = 'ia')::int AS total_automaticos,
           COUNT(*) FILTER (WHERE s.status = 'aguardando_humano' OR s.resolvida_por = 'humano')::int AS total_escalonados,
           ROUND(
             COUNT(*) FILTER (WHERE s.resolvida_por = 'ia')::numeric
             / NULLIF(COUNT(*) FILTER (WHERE s.status IN ('finalizada','expirada')), 0) * 100, 1
           ) AS taxa_resolucao_automatica
         FROM sessions s WHERE ${pf.clause}`,
        pf.params
      ),
      query(
        `SELECT COUNT(*)::int AS sessoes_ativas_agora
         FROM sessions WHERE status = 'ativa' AND expires_at > NOW()`
      ),
    ]);

    const avgTime = await query(
      `SELECT ROUND(AVG(i.tempo_resposta_ms))::int AS tempo_medio_resposta_ms
       FROM interactions_log i WHERE ${pf.clause.replace('s.created_at', 'i.created_at')}`,
      pf.params
    );

    res.json({
      success: true,
      data: {
        ...totals.rows[0],
        tempo_medio_resposta_ms: avgTime.rows[0].tempo_medio_resposta_ms || 0,
        sessoes_ativas_agora: activeNow.rows[0].sessoes_ativas_agora,
      },
    });
  } catch (err) {
    console.error('[metrics] overview erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/metrics/by-channel
// ============================================================
router.get('/api/metrics/by-channel', async (req, res) => {
  try {
    const pf = buildPeriodFilter(req.query.periodo);
    const { rows } = await query(
      `SELECT s.canal, COUNT(*)::int AS total
       FROM sessions s WHERE ${pf.clause}
       GROUP BY s.canal ORDER BY total DESC`,
      pf.params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[metrics] by-channel erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/metrics/by-intent
// ============================================================
router.get('/api/metrics/by-intent', async (req, res) => {
  try {
    const pf = buildPeriodFilter(req.query.periodo);
    const { rows } = await query(
      `SELECT s.intencao_principal AS intencao, COUNT(*)::int AS total
       FROM sessions s WHERE ${pf.clause} AND s.intencao_principal IS NOT NULL
       GROUP BY s.intencao_principal ORDER BY total DESC`,
      pf.params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[metrics] by-intent erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/metrics/resolution-rate (por dia, para gráfico de linha)
// ============================================================
router.get('/api/metrics/resolution-rate', async (req, res) => {
  try {
    const pf = buildPeriodFilter(req.query.periodo);
    const { rows } = await query(
      `SELECT
         DATE(s.created_at) AS dia,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE s.resolvida_por = 'ia')::int AS automaticos,
         ROUND(
           COUNT(*) FILTER (WHERE s.resolvida_por = 'ia')::numeric
           / NULLIF(COUNT(*), 0) * 100, 1
         ) AS taxa
       FROM sessions s WHERE ${pf.clause}
       GROUP BY DATE(s.created_at) ORDER BY dia`,
      pf.params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[metrics] resolution-rate erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/metrics/mk-apis (chamadas por endpoint MK)
// ============================================================
router.get('/api/metrics/mk-apis', async (req, res) => {
  try {
    const pf = buildPeriodFilter(req.query.periodo, 'i');
    const { rows } = await query(
      `SELECT
         i.mk_endpoint AS endpoint,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE i.mk_sucesso = true)::int AS sucesso,
         COUNT(*) FILTER (WHERE i.mk_sucesso = false)::int AS erro
       FROM interactions_log i
       WHERE ${pf.clause} AND i.mk_endpoint IS NOT NULL
       GROUP BY i.mk_endpoint ORDER BY total DESC`,
      pf.params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[metrics] mk-apis erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/metrics/performance (tempos médios por dia)
// ============================================================
router.get('/api/metrics/performance', async (req, res) => {
  try {
    const pf = buildPeriodFilter(req.query.periodo, 'i');
    const { rows } = await query(
      `SELECT
         DATE(i.created_at) AS dia,
         ROUND(AVG(i.tempo_classificacao_ms))::int AS avg_ia_ms,
         ROUND(AVG(i.tempo_mk_ms) FILTER (WHERE i.tempo_mk_ms > 0))::int AS avg_mk_ms,
         ROUND(AVG(i.tempo_resposta_ms))::int AS avg_total_ms,
         COUNT(*)::int AS total_interacoes
       FROM interactions_log i WHERE ${pf.clause}
       GROUP BY DATE(i.created_at) ORDER BY dia`,
      pf.params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[metrics] performance erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/metrics/top-escalations (top motivos)
// ============================================================
router.get('/api/metrics/top-escalations', async (req, res) => {
  try {
    const pf = buildPeriodFilter(req.query.periodo, 'e');
    const { rows } = await query(
      `SELECT
         e.motivo,
         e.prioridade,
         COUNT(*)::int AS total
       FROM escalations e WHERE ${pf.clause}
       GROUP BY e.motivo, e.prioridade ORDER BY total DESC LIMIT 20`,
      pf.params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[metrics] top-escalations erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
