/**
 * test-database.js
 * Verifica se todas as tabelas existem e CRUD funciona no PostgreSQL.
 *
 * Uso:  node tests/test-database.js
 *
 * Requer: DATABASE_URL no .env (ou variável de ambiente)
 */

import 'dotenv/config';
import pg from 'pg';

// ── Config ──────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('\x1b[31m✘ DATABASE_URL não definida. Crie um .env ou exporte a variável.\x1b[0m');
  console.log('  Exemplo: DATABASE_URL=postgresql://bot:senha_segura@localhost:5432/conectiva_bot');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 10000,
});

// ── Helpers ─────────────────────────────────────────────
let passed = 0;
let failed = 0;

const log = (label, ok, detail = '') => {
  const icon = ok ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[31m✘ FAIL\x1b[0m';
  console.log(`  ${icon}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (ok) passed++;
  else failed++;
};

const separator = (title) => {
  console.log(`\n\x1b[36m━━━ ${title} ━━━\x1b[0m`);
};

// ── Testes ──────────────────────────────────────────────

async function testConnection() {
  separator('1. Conexão com PostgreSQL');

  try {
    const start = Date.now();
    const { rows } = await pool.query('SELECT NOW() AS now, current_database() AS db, version() AS version');
    const elapsed = Date.now() - start;

    log('Conectou ao PostgreSQL', true, `${elapsed}ms`);
    log('Database', true, rows[0].db);
    log('Versão', true, rows[0].version.split(',')[0]);
  } catch (err) {
    log('Conexão com PostgreSQL', false, err.message);
    throw err; // Não dá pra continuar sem BD
  }
}

async function testTablesExist() {
  separator('2. Verificar tabelas existem');

  const expectedTables = [
    'sessions',
    'messages',
    'interactions_log',
    'ai_actions_log',
    'escalations',
    'negotiation_rules',
  ];

  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  const existingTables = rows.map((r) => r.table_name);

  for (const table of expectedTables) {
    log(`Tabela "${table}" existe`, existingTables.includes(table));
  }

  // Tabelas extras (informativo)
  const extras = existingTables.filter((t) => !expectedTables.includes(t));
  if (extras.length > 0) {
    console.log(`  ℹ Tabelas extras encontradas: ${extras.join(', ')}`);
  }
}

async function testIndexes() {
  separator('3. Verificar indexes');

  const expectedIndexes = [
    'idx_sessions_telefone',
    'idx_sessions_status',
    'idx_sessions_cpf',
    'idx_sessions_expires',
    'idx_sessions_canal',
    'idx_messages_session',
    'idx_messages_created',
    'idx_interactions_session',
    'idx_interactions_intencao',
    'idx_interactions_status',
    'idx_ai_actions_session',
    'idx_ai_actions_interaction',
    'idx_escalations_status',
    'idx_escalations_prioridade',
    'idx_escalations_session',
    'idx_negotiation_ativo',
  ];

  const { rows } = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`
  );
  const existingIndexes = rows.map((r) => r.indexname);

  let indexPassed = 0;
  for (const idx of expectedIndexes) {
    const exists = existingIndexes.includes(idx);
    if (exists) indexPassed++;
  }

  log(`Indexes presentes`, indexPassed === expectedIndexes.length,
    `${indexPassed}/${expectedIndexes.length} indexes`);

  // Listar os faltantes se houver
  const missing = expectedIndexes.filter((i) => !existingIndexes.includes(i));
  if (missing.length > 0) {
    console.log(`  ⚠ Indexes faltantes: ${missing.join(', ')}`);
  }
}

async function testCRUDSessions() {
  separator('4. CRUD — sessions');

  const client = await pool.connect();
  let sessionId = null;

  try {
    await client.query('BEGIN');

    // CREATE
    const { rows: created } = await client.query(
      `INSERT INTO sessions (canal, telefone, nome_cliente, status, expires_at)
       VALUES ('whatsapp', '5511999990000', 'Teste CRUD', 'ativa', NOW() + INTERVAL '30 minutes')
       RETURNING *`
    );
    sessionId = created[0].id;
    log('INSERT session', !!sessionId, `id=${sessionId.slice(0, 8)}...`);

    // READ
    const { rows: read } = await client.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    log('SELECT session', read.length === 1 && read[0].nome_cliente === 'Teste CRUD');

    // UPDATE
    const { rows: updated } = await client.query(
      `UPDATE sessions SET cpf_cnpj = '12345678901', total_mensagens = 5, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [sessionId]
    );
    log('UPDATE session', updated[0].cpf_cnpj === '12345678901' && updated[0].total_mensagens === 5);

    // Verificar CHECK constraint
    try {
      await client.query(
        `INSERT INTO sessions (canal, telefone, status) VALUES ('invalido', '000', 'ativa')`
      );
      log('CHECK constraint canal', false, 'Deveria ter rejeitado canal inválido');
    } catch (err) {
      log('CHECK constraint canal', err.message.includes('check') || err.message.includes('violates'),
        'Canal inválido rejeitado');
    }

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    log('CRUD sessions', false, err.message);
  } finally {
    client.release();
  }
}

async function testCRUDMessages() {
  separator('5. CRUD — messages');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Criar sessão de teste primeiro
    const { rows: session } = await client.query(
      `INSERT INTO sessions (canal, telefone, status, expires_at)
       VALUES ('site', 'visitor-test', 'ativa', NOW() + INTERVAL '30 minutes')
       RETURNING id`
    );
    const sid = session[0].id;

    // CREATE mensagem entrada
    const { rows: msg1 } = await client.query(
      `INSERT INTO messages (session_id, direcao, conteudo, canal)
       VALUES ($1, 'entrada', 'Olá, preciso de ajuda', 'site')
       RETURNING *`,
      [sid]
    );
    log('INSERT mensagem entrada', !!msg1[0].id && msg1[0].direcao === 'entrada');

    // CREATE mensagem saída
    const { rows: msg2 } = await client.query(
      `INSERT INTO messages (session_id, direcao, conteudo, canal)
       VALUES ($1, 'saida', 'Olá! Como posso ajudar?', 'site')
       RETURNING *`,
      [sid]
    );
    log('INSERT mensagem saída', !!msg2[0].id && msg2[0].direcao === 'saida');

    // READ — ordenadas por created_at
    const { rows: msgs } = await client.query(
      `SELECT direcao, conteudo FROM messages WHERE session_id = $1 ORDER BY created_at`,
      [sid]
    );
    log('SELECT mensagens', msgs.length === 2 && msgs[0].direcao === 'entrada', `${msgs.length} mensagens`);

    // CHECK constraint direcao
    try {
      await client.query(
        `INSERT INTO messages (session_id, direcao, conteudo) VALUES ($1, 'invalido', 'test')`,
        [sid]
      );
      log('CHECK constraint direcao', false, 'Deveria ter rejeitado');
    } catch (err) {
      log('CHECK constraint direcao', true, 'Direção inválida rejeitada');
    }

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    log('CRUD messages', false, err.message);
  } finally {
    client.release();
  }
}

async function testCRUDInteractions() {
  separator('6. CRUD — interactions_log');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: session } = await client.query(
      `INSERT INTO sessions (canal, telefone, status, expires_at)
       VALUES ('whatsapp', '5511888880000', 'ativa', NOW() + INTERVAL '30 minutes')
       RETURNING id`
    );
    const sid = session[0].id;

    // CREATE
    const { rows: interaction } = await client.query(
      `INSERT INTO interactions_log
         (session_id, intencao, confianca, mensagem_cliente, resposta_ia,
          acao_mk, mk_endpoint, mk_sucesso, mk_resposta, status,
          tempo_classificacao_ms, tempo_mk_ms, tempo_resposta_ms)
       VALUES ($1, 'SEGUNDA_VIA', 0.95, 'Quero segunda via', 'Gerando boleto...',
               'SEGUNDA_VIA', 'WSMKSegundaViaCobranca', true, '{"boleto":"ok"}', 'sucesso',
               120, 340, 520)
       RETURNING *`,
      [sid]
    );
    log('INSERT interaction', !!interaction[0].id && interaction[0].intencao === 'SEGUNDA_VIA');

    // READ
    const { rows: read } = await client.query(
      'SELECT * FROM interactions_log WHERE session_id = $1',
      [sid]
    );
    log('SELECT interaction', read.length === 1);
    log('JSONB mk_resposta', typeof read[0].mk_resposta === 'object', JSON.stringify(read[0].mk_resposta));

    // CHECK constraint confianca
    try {
      await client.query(
        `INSERT INTO interactions_log (session_id, intencao, confianca, mensagem_cliente, resposta_ia)
         VALUES ($1, 'TEST', 1.5, 'test', 'test')`,
        [sid]
      );
      log('CHECK constraint confianca (0-1)', false, 'Deveria ter rejeitado 1.5');
    } catch (err) {
      log('CHECK constraint confianca (0-1)', true, 'Valor > 1 rejeitado');
    }

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    log('CRUD interactions_log', false, err.message);
  } finally {
    client.release();
  }
}

async function testCRUDAiActions() {
  separator('7. CRUD — ai_actions_log');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: session } = await client.query(
      `INSERT INTO sessions (canal, telefone, status, expires_at)
       VALUES ('whatsapp', '5511777770000', 'ativa', NOW() + INTERVAL '30 minutes')
       RETURNING id`
    );
    const sid = session[0].id;

    const { rows: interaction } = await client.query(
      `INSERT INTO interactions_log (session_id, intencao, confianca, mensagem_cliente, resposta_ia)
       VALUES ($1, 'FATURAS', 0.9, 'teste', 'teste')
       RETURNING id`,
      [sid]
    );
    const iid = interaction[0].id;

    // CREATE
    const { rows: action } = await client.query(
      `INSERT INTO ai_actions_log
         (session_id, interaction_id, acao, descricao, status, dados_entrada, dados_saida, tempo_ms)
       VALUES ($1, $2, 'FATURAS_PENDENTES', 'Consultar faturas via n8n', 'sucesso',
               '{"cd_cliente": 123}', '{"faturas": []}', 250)
       RETURNING *`,
      [sid, iid]
    );
    log('INSERT ai_action', !!action[0].id && action[0].acao === 'FATURAS_PENDENTES');

    // JSONB dados
    log('JSONB dados_entrada', typeof action[0].dados_entrada === 'object');
    log('JSONB dados_saida', typeof action[0].dados_saida === 'object');

    // READ com JOIN
    const { rows: joined } = await client.query(
      `SELECT a.acao, a.tempo_ms, i.intencao
       FROM ai_actions_log a
       JOIN interactions_log i ON a.interaction_id = i.id
       WHERE a.session_id = $1`,
      [sid]
    );
    log('JOIN ai_actions ↔ interactions', joined.length === 1 && joined[0].intencao === 'FATURAS');

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    log('CRUD ai_actions_log', false, err.message);
  } finally {
    client.release();
  }
}

async function testCRUDEscalations() {
  separator('8. CRUD — escalations');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: session } = await client.query(
      `INSERT INTO sessions (canal, telefone, status, expires_at)
       VALUES ('whatsapp', '5511666660000', 'aguardando_humano', NOW() + INTERVAL '30 minutes')
       RETURNING id`
    );
    const sid = session[0].id;

    // CREATE
    const { rows: esc } = await client.query(
      `INSERT INTO escalations
         (session_id, motivo, prioridade, historico_conversa, dados_cliente, status)
       VALUES ($1, 'Cliente solicitou atendente', 'alta',
               '[{"direcao":"entrada","conteudo":"Quero falar com humano"}]',
               '{"telefone":"5511666660000","nome":"João"}',
               'pendente')
       RETURNING *`,
      [sid]
    );
    log('INSERT escalation', !!esc[0].id && esc[0].prioridade === 'alta');
    log('JSONB historico_conversa', Array.isArray(esc[0].historico_conversa));
    log('JSONB dados_cliente', typeof esc[0].dados_cliente === 'object');

    // UPDATE — assign
    const { rows: assigned } = await client.query(
      `UPDATE escalations SET atendente_designado = 'Maria', status = 'em_atendimento', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [esc[0].id]
    );
    log('UPDATE assign atendente', assigned[0].atendente_designado === 'Maria' && assigned[0].status === 'em_atendimento');

    // UPDATE — resolve
    const { rows: resolved } = await client.query(
      `UPDATE escalations SET status = 'resolvido', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [esc[0].id]
    );
    log('UPDATE resolver escalation', resolved[0].status === 'resolvido');

    // CHECK constraint prioridade
    try {
      await client.query(
        `INSERT INTO escalations (session_id, motivo, prioridade) VALUES ($1, 'test', 'urgente')`,
        [sid]
      );
      log('CHECK constraint prioridade', false, 'Deveria ter rejeitado "urgente"');
    } catch (err) {
      log('CHECK constraint prioridade', true, 'Prioridade inválida rejeitada');
    }

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    log('CRUD escalations', false, err.message);
  } finally {
    client.release();
  }
}

async function testNegotiationRules() {
  separator('9. Dados seed — negotiation_rules');

  try {
    const { rows } = await pool.query(
      `SELECT * FROM negotiation_rules WHERE ativo = true ORDER BY dias_atraso_min`
    );

    log('Regras de negociação existem', rows.length >= 4, `${rows.length} regras`);

    if (rows.length >= 4) {
      log('Regra 1-30 dias (5%, 2x)', rows[0].desconto_max_percent == 5 && rows[0].parcelas_max === 2);
      log('Regra 31-90 dias (10%, 4x)', rows[1].desconto_max_percent == 10 && rows[1].parcelas_max === 4);
      log('Regra 91-180 dias (15%, 6x)', rows[2].desconto_max_percent == 15 && rows[2].parcelas_max === 6);
      log('Regra 181+ dias (escalonar)', rows[3].acao === 'escalonar_humano');
    }

    // CHECK constraint dias_range
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO negotiation_rules (dias_atraso_min, dias_atraso_max, acao) VALUES (100, 50, 'teste')`
      );
      log('CHECK constraint dias_range', false, 'Deveria ter rejeitado min > max');
      await client.query('ROLLBACK');
    } catch (err) {
      log('CHECK constraint dias_range', true, 'min > max rejeitado');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  } catch (err) {
    log('Negotiation rules', false, err.message);
  }
}

async function testCascadeDelete() {
  separator('10. CASCADE DELETE');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Criar sessão com dados relacionados
    const { rows: session } = await client.query(
      `INSERT INTO sessions (canal, telefone, status, expires_at)
       VALUES ('whatsapp', '5511555550000', 'ativa', NOW() + INTERVAL '30 minutes')
       RETURNING id`
    );
    const sid = session[0].id;

    // Criar mensagem, interaction, action, escalation
    await client.query(
      `INSERT INTO messages (session_id, direcao, conteudo) VALUES ($1, 'entrada', 'teste cascade')`,
      [sid]
    );
    const { rows: inter } = await client.query(
      `INSERT INTO interactions_log (session_id, intencao, confianca, mensagem_cliente, resposta_ia)
       VALUES ($1, 'TEST', 0.8, 'teste', 'teste')
       RETURNING id`,
      [sid]
    );
    await client.query(
      `INSERT INTO ai_actions_log (session_id, interaction_id, acao, status) VALUES ($1, $2, 'TEST', 'sucesso')`,
      [sid, inter[0].id]
    );
    await client.query(
      `INSERT INTO escalations (session_id, motivo, prioridade) VALUES ($1, 'teste cascade', 'baixa')`,
      [sid]
    );

    // Contar antes do DELETE
    const countBefore = async (table) => {
      const { rows } = await client.query(`SELECT count(*)::int AS c FROM ${table} WHERE session_id = $1`, [sid]);
      return rows[0].c;
    };

    const before = {
      messages: await countBefore('messages'),
      interactions: await countBefore('interactions_log'),
      actions: await countBefore('ai_actions_log'),
      escalations: await countBefore('escalations'),
    };

    log('Dados criados antes do DELETE', before.messages > 0 && before.interactions > 0,
      `msgs=${before.messages}, ints=${before.interactions}, acts=${before.actions}, esc=${before.escalations}`);

    // DELETE sessão
    await client.query('DELETE FROM sessions WHERE id = $1', [sid]);

    const after = {
      messages: await countBefore('messages'),
      interactions: await countBefore('interactions_log'),
      actions: await countBefore('ai_actions_log'),
      escalations: await countBefore('escalations'),
    };

    log('CASCADE deletou messages', after.messages === 0);
    log('CASCADE deletou interactions_log', after.interactions === 0);
    log('CASCADE deletou ai_actions_log', after.actions === 0);
    log('CASCADE deletou escalations', after.escalations === 0);

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    log('CASCADE DELETE', false, err.message);
  } finally {
    client.release();
  }
}

// ── Main ────────────────────────────────────────────────
async function main() {
  console.log('\x1b[1m\x1b[35m');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    TESTE - Banco de Dados PostgreSQL         ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  try {
    await testConnection();
    await testTablesExist();
    await testIndexes();
    await testCRUDSessions();
    await testCRUDMessages();
    await testCRUDInteractions();
    await testCRUDAiActions();
    await testCRUDEscalations();
    await testNegotiationRules();
    await testCascadeDelete();
  } catch (err) {
    console.error(`\n\x1b[31m  ERRO FATAL: ${err.message}\x1b[0m\n`);
  }

  // Resumo
  console.log('\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log(`  Total: ${passed + failed} testes | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
  console.log('\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main();
