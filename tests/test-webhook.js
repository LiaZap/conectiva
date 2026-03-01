/**
 * test-webhook.js
 * Simula payloads da Uazapi e do Site, e verifica se o webhook processa corretamente.
 *
 * Uso:  node tests/test-webhook.js
 *
 * Testa:
 *   - Normalização de payloads (Uazapi + Site)
 *   - Validação de CPF
 *   - Formatação de telefone
 *   - Envio HTTP real para o servidor (se rodando em localhost:3000)
 */

import axios from 'axios';

// ── Config ──────────────────────────────────────────────
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

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

// ── Importar normalizer e validators diretamente ────────
// (sem precisar do servidor rodando)
let normalizeUazapiPayload, normalizeSitePayload, normalizeChannel;
let isValidCPF, isValidCNPJ, formatPhone, extractCPFFromText, formatCPF;

try {
  const normalizer = await import('../src/utils/normalizer.js');
  normalizeUazapiPayload = normalizer.normalizeUazapiPayload;
  normalizeSitePayload = normalizer.normalizeSitePayload;
  normalizeChannel = normalizer.normalizeChannel;

  const validators = await import('../src/utils/validators.js');
  isValidCPF = validators.isValidCPF;
  isValidCNPJ = validators.isValidCNPJ;
  formatPhone = validators.formatPhone;
  extractCPFFromText = validators.extractCPFFromText;
  formatCPF = validators.formatCPF;
} catch (err) {
  console.error(`\x1b[31m✘ Erro ao importar utils: ${err.message}\x1b[0m`);
  process.exit(1);
}

// ── Testes de Normalização ──────────────────────────────

function testUazapiNormalization() {
  separator('1. Normalização de payload Uazapi');

  // Formato padrão Uazapi
  const payload1 = {
    data: {
      phone: '5511999998888',
      message: 'Olá, preciso de ajuda com meu boleto',
      pushName: 'João Silva',
      messageType: 'text',
    },
  };

  const result1 = normalizeUazapiPayload(payload1);
  log('Extrai telefone', result1.from === '5511999998888', result1.from);
  log('Extrai mensagem', result1.message === 'Olá, preciso de ajuda com meu boleto');
  log('Extrai pushName', result1.pushName === 'João Silva');
  log('Extrai messageType', result1.messageType === 'text');

  // Formato alternativo (sem wrapper "data")
  const payload2 = {
    phone: '5511888887777',
    text: 'Segunda via do boleto',
    senderName: 'Maria Santos',
  };

  const result2 = normalizeUazapiPayload(payload2);
  log('Formato sem "data" wrapper', result2.from === '5511888887777');
  log('Campo "text" como alternativo', result2.message === 'Segunda via do boleto');
  log('Campo "senderName" como alternativo', result2.pushName === 'Maria Santos');

  // Formato com caracteres especiais no telefone
  const payload3 = {
    data: {
      phone: '+55 (11) 99999-8888',
      message: 'teste',
    },
  };

  const result3 = normalizeUazapiPayload(payload3);
  log('Remove caracteres especiais do telefone', result3.from === '5511999998888', result3.from);

  // Formato com campo "from" (outra variante)
  const payload4 = {
    from: '5511777776666',
    body: 'mensagem via body',
    pushName: 'Pedro',
    type: 'chat',
  };

  const result4 = normalizeUazapiPayload(payload4);
  log('Campo "from" como alternativo', result4.from === '5511777776666');
  log('Campo "body" como alternativo', result4.message === 'mensagem via body');

  // Payload vazio / incompleto
  const payloadEmpty = {};
  const resultEmpty = normalizeUazapiPayload(payloadEmpty);
  log('Payload vazio não crasheia', resultEmpty.from === '' && resultEmpty.message === '');
}

function testSiteNormalization() {
  separator('2. Normalização de payload Site');

  const payload1 = {
    session_id: 'visitor-abc-123',
    message: 'Gostaria de saber sobre os planos',
    name: 'Visitante João',
  };

  const result1 = normalizeSitePayload(payload1);
  log('Extrai session_id como from', result1.from === 'visitor-abc-123');
  log('Extrai mensagem', result1.message === 'Gostaria de saber sobre os planos');
  log('Extrai name', result1.pushName === 'Visitante João');
  log('messageType sempre text', result1.messageType === 'text');

  // Campos alternativos
  const payload2 = {
    visitor_id: 'vis-456',
    text: 'Olá',
    nome: 'Maria',
  };

  const result2 = normalizeSitePayload(payload2);
  log('Campo "visitor_id" como alternativo', result2.from === 'vis-456');
  log('Campo "text" como alternativo', result2.message === 'Olá');
  log('Campo "nome" como alternativo', result2.pushName === 'Maria');

  // Sem nome → default "Visitante"
  const payload3 = { session_id: 'id-789', message: 'teste' };
  const result3 = normalizeSitePayload(payload3);
  log('Sem nome → default "Visitante"', result3.pushName === 'Visitante');
}

function testNormalizeChannel() {
  separator('3. normalizeChannel dispatcher');

  const whatsapp = normalizeChannel({ data: { phone: '5511999990000', message: 'oi' } }, 'whatsapp');
  log('Canal whatsapp → normalizeUazapiPayload', whatsapp.from === '5511999990000');

  const site = normalizeChannel({ session_id: 'abc', message: 'oi' }, 'site');
  log('Canal site → normalizeSitePayload', site.from === 'abc');

  // Canal inválido
  try {
    normalizeChannel({}, 'telegram');
    log('Canal inválido → throw', false, 'Não lançou erro');
  } catch (err) {
    log('Canal inválido → throw', err.message.includes('desconhecido'), err.message);
  }
}

// ── Testes de Validação ─────────────────────────────────

function testCPFValidation() {
  separator('4. Validação de CPF');

  // CPFs válidos
  log('CPF 529.982.247-25 válido', isValidCPF('529.982.247-25'));
  log('CPF 52998224725 válido (sem formatação)', isValidCPF('52998224725'));

  // CPFs inválidos
  log('CPF 111.111.111-11 inválido (repetido)', !isValidCPF('111.111.111-11'));
  log('CPF 000.000.000-00 inválido', !isValidCPF('000.000.000-00'));
  log('CPF 123.456.789-00 inválido (dígitos errados)', !isValidCPF('123.456.789-00'));
  log('CPF curto inválido', !isValidCPF('1234567'));
  log('CPF vazio inválido', !isValidCPF(''));
  log('CPF null inválido', !isValidCPF(null));
}

function testCNPJValidation() {
  separator('5. Validação de CNPJ');

  if (isValidCNPJ) {
    log('CNPJ 11.222.333/0001-81 válido', isValidCNPJ('11.222.333/0001-81'));
    log('CNPJ 11222333000181 válido (sem formatação)', isValidCNPJ('11222333000181'));
    log('CNPJ 00.000.000/0000-00 inválido', !isValidCNPJ('00.000.000/0000-00'));
    log('CNPJ repetido inválido', !isValidCNPJ('11.111.111/1111-11'));
  } else {
    console.log('  ℹ isValidCNPJ não exportado — pulando');
  }
}

function testPhoneFormatting() {
  separator('6. Formatação de telefone');

  log('Com +55 e formatação', formatPhone('+55 (11) 99999-8888') === '5511999998888', formatPhone('+55 (11) 99999-8888'));
  log('Já formatado', formatPhone('5511999998888') === '5511999998888');
  log('Sem DDI', formatPhone('11999998888') === '5511999998888', formatPhone('11999998888'));
  log('Com 9 dígitos (sem DDD — ambíguo)', formatPhone('999998888') === '999998888', formatPhone('999998888'));
}

function testCPFExtraction() {
  separator('7. Extração de CPF do texto');

  const cpf1 = extractCPFFromText('Meu CPF é 529.982.247-25, pode verificar?');
  log('Extrai CPF formatado do texto', cpf1 === '52998224725', cpf1);

  const cpf2 = extractCPFFromText('CPF: 52998224725');
  log('Extrai CPF sem formatação do texto', cpf2 === '52998224725', cpf2);

  const cpf3 = extractCPFFromText('Olá, meu nome é João');
  log('Sem CPF no texto → null', cpf3 === null);

  const cpf4 = extractCPFFromText('Meu CPF é 111.111.111-11');
  log('CPF inválido no texto → null', cpf4 === null, `Retornou: ${cpf4}`);
}

function testCPFFormatting() {
  separator('8. Formatação de CPF');

  if (formatCPF) {
    log('Formata CPF 52998224725', formatCPF('52998224725') === '529.982.247-25', formatCPF('52998224725'));
    log('CPF já formatado', formatCPF('529.982.247-25') === '529.982.247-25');
  } else {
    console.log('  ℹ formatCPF não exportado — pulando');
  }
}

// ── Testes de integração HTTP (requer servidor rodando) ──

async function testWebhookHTTP() {
  separator('9. Webhook HTTP — POST /webhook/whatsapp');

  const uazapiPayload = {
    data: {
      phone: '5511999990001',
      message: 'Boa noite, preciso da segunda via do meu boleto',
      pushName: 'Teste Webhook',
      messageType: 'text',
    },
  };

  try {
    console.log(`  → POST ${SERVER_URL}/webhook/whatsapp`);

    const start = Date.now();
    const { data, status } = await axios.post(`${SERVER_URL}/webhook/whatsapp`, uazapiPayload, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
    const elapsed = Date.now() - start;

    log('HTTP status 200', status === 200, `status=${status}`);
    log('Resposta success', data.success === true);
    log('Tempo de processamento', elapsed < 30000, `${elapsed}ms`);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log(`  \x1b[33mℹ Servidor não rodando em ${SERVER_URL} — pulando teste HTTP\x1b[0m`);
      console.log('  ℹ Inicie o servidor com: npm start');
    } else {
      log('Webhook WhatsApp', false, err.message);
    }
  }
}

async function testWebhookSiteHTTP() {
  separator('10. Webhook HTTP — POST /webhook/site');

  const sitePayload = {
    session_id: 'test-visitor-001',
    message: 'Gostaria de saber quais planos vocês oferecem',
    name: 'Visitante Teste',
  };

  try {
    console.log(`  → POST ${SERVER_URL}/webhook/site`);

    const start = Date.now();
    const { data, status } = await axios.post(`${SERVER_URL}/webhook/site`, sitePayload, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
    const elapsed = Date.now() - start;

    log('HTTP status 200', status === 200, `status=${status}`);
    log('Resposta success', data.success === true);
    log('Reply presente', !!data.reply && data.reply.length > 0, `${(data.reply || '').slice(0, 60)}...`);
    log('Tempo de processamento', elapsed < 30000, `${elapsed}ms`);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log(`  \x1b[33mℹ Servidor não rodando em ${SERVER_URL} — pulando teste HTTP\x1b[0m`);
    } else {
      log('Webhook Site', false, err.message);
    }
  }
}

async function testHealthEndpoint() {
  separator('11. Health check — GET /health');

  try {
    console.log(`  → GET ${SERVER_URL}/health`);

    const { data, status } = await axios.get(`${SERVER_URL}/health`, { timeout: 5000 });

    log('HTTP status 200', status === 200, `status=${status}`);
    log('Status field presente', !!data.status, data.status);
    log('Timestamp presente', !!data.timestamp);

    if (data.services) {
      log('PostgreSQL status', !!data.services.postgres, data.services.postgres);
      log('Redis status', !!data.services.redis, data.services.redis);
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log(`  \x1b[33mℹ Servidor não rodando em ${SERVER_URL} — pulando teste HTTP\x1b[0m`);
    } else {
      log('Health check', false, err.message);
    }
  }
}

async function testInvalidPayload() {
  separator('12. Payloads inválidos / edge cases');

  // Payload vazio
  try {
    const { data, status } = await axios.post(`${SERVER_URL}/webhook/whatsapp`, {}, {
      timeout: 15000,
      validateStatus: () => true,
    });
    log('Payload vazio não crasha', status < 500, `status=${status}`);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('  \x1b[33mℹ Servidor não rodando — pulando\x1b[0m');
      return;
    }
    log('Payload vazio', false, err.message);
  }

  // Payload com campos inválidos
  try {
    const { status } = await axios.post(`${SERVER_URL}/webhook/whatsapp`, {
      invalid_field: 'teste',
      random: 12345,
    }, { timeout: 15000, validateStatus: () => true });
    log('Campos inválidos não crasha', status < 500, `status=${status}`);
  } catch (err) {
    log('Campos inválidos', false, err.message);
  }

  // Payload do site sem session_id
  try {
    const { status } = await axios.post(`${SERVER_URL}/webhook/site`, {
      message: 'sem session id',
    }, { timeout: 15000, validateStatus: () => true });
    log('Site sem session_id não crasha', status < 500, `status=${status}`);
  } catch (err) {
    log('Site sem session_id', false, err.message);
  }
}

// ── Main ────────────────────────────────────────────────
async function main() {
  console.log('\x1b[1m\x1b[35m');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    TESTE - Webhooks e Payloads               ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  // Testes unitários (sem servidor)
  testUazapiNormalization();
  testSiteNormalization();
  testNormalizeChannel();
  testCPFValidation();
  testCNPJValidation();
  testPhoneFormatting();
  testCPFExtraction();
  testCPFFormatting();

  // Testes de integração (requerem servidor rodando)
  console.log('\n\x1b[33m── Testes HTTP (requer servidor rodando em ' + SERVER_URL + ') ──\x1b[0m');
  await testHealthEndpoint();
  await testWebhookHTTP();
  await testWebhookSiteHTTP();
  await testInvalidPayload();

  // Resumo
  console.log('\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log(`  Total: ${passed + failed} testes | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
  console.log('\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
