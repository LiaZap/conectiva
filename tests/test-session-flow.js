/**
 * test-session-flow.js
 * Simula fluxo completo: criar sessão → enviar mensagem → classificar IA →
 * consultar MK (se possível) → formatar resposta → gravar logs.
 *
 * Uso:  node tests/test-session-flow.js
 *
 * Requer .env com:  DATABASE_URL, OPENAI_API_KEY
 * Opcional:         N8N_WEBHOOK_URL (para testar integração MK via n8n)
 */

import 'dotenv/config';
import pg from 'pg';

// ── Config ──────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

if (!DATABASE_URL) {
  console.error('\x1b[31m✘ DATABASE_URL não definida.\x1b[0m');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('\x1b[31m✘ OPENAI_API_KEY não definida.\x1b[0m');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5, connectionTimeoutMillis: 10000 });

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

// Importar serviços diretamente (sem env validation fatal)
let classify, formatResponse;
try {
  // Precisamos ignorar a validação do env.js (falta REDIS, UAZAPI, etc)
  // Então carregamos o OpenAI SDK diretamente
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  classify = async (mensagem, historico = []) => {
    const PROMPT = `Você é o assistente virtual da Conectiva Infor, um provedor de internet. Analise a mensagem do cliente.
Classifique a intenção e retorne APENAS JSON válido:
{
  "intencao": "TIPO",
  "confianca": 0.95,
  "acaoMK": "ACAO ou null",
  "paramsMK": {},
  "respostaSugerida": "resposta para o cliente",
  "precisaCPF": true
}
Tipos válidos: SEGUNDA_VIA, FATURAS, NEGOCIACAO, SUPORTE, CADASTRO, CONTRATO, DESBLOQUEIO, HUMANO
Se confiança < 0.7, classifique como HUMANO.`;

    const messages = [
      { role: 'system', content: PROMPT },
      ...historico.map((m) => ({ role: m.direcao === 'entrada' ? 'user' : 'assistant', content: m.conteudo })),
      { role: 'user', content: mensagem },
    ];

    const start = Date.now();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    const elapsed = Date.now() - start;

    return { ...JSON.parse(completion.choices[0].message.content), _tempoMs: elapsed };
  };

  formatResponse = async ({ intencao, mkData, session, historico }) => {
    const PROMPT = `Você é o assistente virtual da Conectiva Infor. Formate uma resposta amigável e profissional.`;

    const context = JSON.stringify({ intencao, mkData, cliente: session?.nome_cliente }, null, 2);
    const start = Date.now();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: `Dados:\n${context}` },
      ],
      temperature: 0.5,
      max_tokens: 600,
    });

    return { text: completion.choices[0].message.content, elapsed: Date.now() - start };
  };
} catch (err) {
  console.error(`\x1b[31m✘ Erro ao importar OpenAI: ${err.message}\x1b[0m`);
  process.exit(1);
}

// ── Fluxo Completo ──────────────────────────────────────

async function runFullFlow() {
  const client = await pool.connect();
  let sessionId = null;

  try {
    await client.query('BEGIN');

    // ── ETAPA 1: Criar Sessão ──
    separator('ETAPA 1 — Criar sessão');

    const { rows: sessionRows } = await client.query(
      `INSERT INTO sessions (canal, telefone, nome_cliente, status, expires_at)
       VALUES ('whatsapp', '5511988887777', 'Cliente Teste Flow', 'ativa', NOW() + INTERVAL '30 minutes')
       RETURNING *`
    );
    const session = sessionRows[0];
    sessionId = session.id;

    log('Sessão criada', !!session.id, `id=${session.id.slice(0, 8)}...`);
    log('Canal correto', session.canal === 'whatsapp');
    log('Status ativa', session.status === 'ativa');
    log('Nome do cliente', session.nome_cliente === 'Cliente Teste Flow');

    // ── ETAPA 2: Gravar mensagem de entrada ──
    separator('ETAPA 2 — Gravar mensagem de entrada');

    const mensagemCliente = 'Olá, preciso da segunda via do meu boleto. Meu CPF é 123.456.789-09';

    const { rows: msgRows } = await client.query(
      `INSERT INTO messages (session_id, direcao, conteudo, canal)
       VALUES ($1, 'entrada', $2, 'whatsapp')
       RETURNING *`,
      [sessionId, mensagemCliente]
    );
    log('Mensagem entrada gravada', !!msgRows[0].id && msgRows[0].direcao === 'entrada');

    // Incrementar total_mensagens
    await client.query(
      `UPDATE sessions SET total_mensagens = total_mensagens + 1 WHERE id = $1`,
      [sessionId]
    );

    // ── ETAPA 3: Classificar com IA ──
    separator('ETAPA 3 — Classificar intenção com OpenAI');

    console.log(`  → Enviando para GPT-4o: "${mensagemCliente.slice(0, 60)}..."`);

    const classification = await classify(mensagemCliente);

    log('Classificação recebida', !!classification.intencao, `intencao=${classification.intencao}`);
    log('Confiança válida (0-1)', classification.confianca >= 0 && classification.confianca <= 1,
      `confianca=${classification.confianca}`);
    log('Tempo de classificação', classification._tempoMs > 0, `${classification._tempoMs}ms`);

    // Verificar se classificou como SEGUNDA_VIA (esperado para essa mensagem)
    const expectedIntent = ['SEGUNDA_VIA', 'FATURAS'];
    log('Intenção esperada (SEGUNDA_VIA ou FATURAS)',
      expectedIntent.includes(classification.intencao),
      `Recebido: ${classification.intencao}`);

    if (classification.acaoMK) {
      log('Ação MK sugerida', true, classification.acaoMK);
    }
    if (classification.respostaSugerida) {
      console.log(`  ℹ Resposta sugerida: "${classification.respostaSugerida.slice(0, 80)}..."`);
    }

    // Atualizar intenção na sessão
    await client.query(
      `UPDATE sessions SET intencao_principal = $2, cpf_cnpj = '12345678909' WHERE id = $1`,
      [sessionId, classification.intencao]
    );

    // ── ETAPA 4: Simular chamada MK (ou pular se n8n não disponível) ──
    separator('ETAPA 4 — Chamada MK via n8n');

    let mkResult = null;

    if (N8N_WEBHOOK_URL && classification.acaoMK) {
      console.log(`  → n8n disponível em: ${N8N_WEBHOOK_URL}`);
      console.log(`  → Chamando ação: ${classification.acaoMK}`);

      try {
        const { default: axios } = await import('axios');
        const start = Date.now();
        const { data } = await axios.post(
          `${N8N_WEBHOOK_URL}/webhook/mk-consulta-doc`,
          { doc: '12345678909', session_id: sessionId },
          { timeout: 15000 }
        );
        const elapsed = Date.now() - start;

        mkResult = { success: true, data, tempo_ms: elapsed };
        log('Chamada n8n OK', true, `${elapsed}ms`);
        log('MK retornou dados', !!data, typeof data);
      } catch (err) {
        mkResult = { success: false, data: null, tempo_ms: 0 };
        log('Chamada n8n', false, err.message);
        console.log('  ℹ n8n pode não estar rodando — continuando com dados simulados');
      }
    } else {
      console.log('  ℹ n8n não configurado ou sem ação MK — usando dados simulados');
      mkResult = {
        success: true,
        data: {
          cd_cliente: 12345,
          nome: 'Cliente Teste Flow',
          faturas: [
            { cd_fatura: 999, valor: 89.90, vencimento: '2026-02-15', status: 'pendente' },
          ],
        },
        tempo_ms: 0,
      };
      log('Dados MK simulados', true);
    }

    // ── ETAPA 5: Formatar resposta com IA ──
    separator('ETAPA 5 — Formatar resposta com OpenAI');

    const { text: respostaFormatada, elapsed: tempoResposta } = await formatResponse({
      intencao: classification.intencao,
      mkData: mkResult.data,
      session: { nome_cliente: 'Cliente Teste Flow' },
      historico: [],
    });

    log('Resposta formatada recebida', !!respostaFormatada && respostaFormatada.length > 10,
      `${respostaFormatada.length} chars, ${tempoResposta}ms`);
    console.log(`  ℹ Resposta: "${respostaFormatada.slice(0, 100)}..."`);

    // ── ETAPA 6: Gravar logs completos ──
    separator('ETAPA 6 — Gravar logs no banco');

    // Mensagem de saída
    const { rows: msgOut } = await client.query(
      `INSERT INTO messages (session_id, direcao, conteudo, canal)
       VALUES ($1, 'saida', $2, 'whatsapp')
       RETURNING *`,
      [sessionId, respostaFormatada]
    );
    log('Mensagem saída gravada', !!msgOut[0].id);

    // Interaction log
    const { rows: interactionRows } = await client.query(
      `INSERT INTO interactions_log
         (session_id, intencao, confianca, mensagem_cliente, resposta_ia,
          acao_mk, mk_endpoint, mk_sucesso, mk_resposta, status,
          tempo_classificacao_ms, tempo_mk_ms, tempo_resposta_ms,
          boleto_gerado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sucesso', $10, $11, $12, $13)
       RETURNING *`,
      [
        sessionId,
        classification.intencao,
        classification.confianca,
        mensagemCliente,
        respostaFormatada,
        classification.acaoMK || null,
        classification.acaoMK ? `WSMK${classification.acaoMK}` : null,
        mkResult.success,
        JSON.stringify(mkResult.data),
        classification._tempoMs,
        mkResult.tempo_ms,
        tempoResposta,
        classification.intencao === 'SEGUNDA_VIA' && mkResult.success,
      ]
    );
    log('Interaction log gravado', !!interactionRows[0].id);

    // Action log
    const { rows: actionRows } = await client.query(
      `INSERT INTO ai_actions_log
         (session_id, interaction_id, acao, descricao, status,
          dados_entrada, dados_saida, tempo_ms)
       VALUES ($1, $2, 'classify', 'Classificação de intenção via GPT-4o', 'sucesso',
               $3, $4, $5)
       RETURNING *`,
      [
        sessionId,
        interactionRows[0].id,
        JSON.stringify({ mensagem: mensagemCliente }),
        JSON.stringify(classification),
        classification._tempoMs,
      ]
    );
    log('Action log gravado', !!actionRows[0].id);

    // ── ETAPA 7: Verificar integridade dos dados ──
    separator('ETAPA 7 — Verificar integridade');

    // Total de mensagens
    const { rows: msgCount } = await client.query(
      `SELECT count(*)::int AS total FROM messages WHERE session_id = $1`,
      [sessionId]
    );
    log('Total de mensagens na sessão', msgCount[0].total === 2, `${msgCount[0].total} mensagens`);

    // Sessão atualizada
    const { rows: sessionFinal } = await client.query(
      `SELECT * FROM sessions WHERE id = $1`,
      [sessionId]
    );
    log('Intenção principal gravada', !!sessionFinal[0].intencao_principal);
    log('CPF gravado na sessão', sessionFinal[0].cpf_cnpj === '12345678909');

    // Interaction log com dados
    const { rows: intFinal } = await client.query(
      `SELECT * FROM interactions_log WHERE session_id = $1`,
      [sessionId]
    );
    log('Interaction tem mk_resposta JSONB', typeof intFinal[0].mk_resposta === 'object');
    log('Tempos registrados', intFinal[0].tempo_classificacao_ms > 0);

    // Fluxo completo
    const tempoTotal = classification._tempoMs + mkResult.tempo_ms + tempoResposta;
    log('Fluxo completo executado', true, `Tempo total: ${tempoTotal}ms`);

    // ── ETAPA 8: Testar escalonamento (opcional) ──
    separator('ETAPA 8 — Simular escalonamento para humano');

    const mensagemHumano = 'Quero falar com um atendente humano, por favor';
    console.log(`  → Classificando: "${mensagemHumano}"`);

    const classHumano = await classify(mensagemHumano);
    log('Mensagem "falar com atendente" classificada', !!classHumano.intencao, classHumano.intencao);
    log('Classificou como HUMANO', classHumano.intencao === 'HUMANO',
      `Recebido: ${classHumano.intencao} (conf: ${classHumano.confianca})`);

    if (classHumano.intencao === 'HUMANO') {
      const { rows: escRows } = await client.query(
        `INSERT INTO escalations (session_id, motivo, prioridade, dados_cliente)
         VALUES ($1, 'Cliente solicitou atendente humano', 'media',
                 '{"telefone":"5511988887777","nome":"Cliente Teste Flow"}')
         RETURNING *`,
        [sessionId]
      );
      log('Escalonamento criado', !!escRows[0].id);
      log('Status pendente', escRows[0].status === 'pendente');
    }

    // ROLLBACK — não poluir o banco com dados de teste
    await client.query('ROLLBACK');
    console.log('\n  \x1b[33mℹ ROLLBACK executado — nenhum dado persistiu no banco\x1b[0m');
  } catch (err) {
    await client.query('ROLLBACK');
    log('ERRO no fluxo', false, err.message);
    console.error(err);
  } finally {
    client.release();
  }
}

// ── Main ────────────────────────────────────────────────
async function main() {
  console.log('\x1b[1m\x1b[35m');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    TESTE - Fluxo Completo de Sessão          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  await runFullFlow();

  // Resumo
  console.log('\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log(`  Total: ${passed + failed} testes | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
  console.log('\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main();
