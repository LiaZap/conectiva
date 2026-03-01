/**
 * test-mk-auth.js
 * Testa autenticação com a API MK Solutions real.
 *
 * Uso:  node tests/test-mk-auth.js
 *
 * NÃO precisa do .env — usa as credenciais diretas do CLAUDE.md.
 */

import axios from 'axios';

// ── Config ──────────────────────────────────────────────
const MK_BASE_URL = 'https://mk.conectivainfor.com.br';
const MK_USER_TOKEN = 'a226bc3b85a80afce7ea2b15b5333aef';
const MK_PASSWORD = '3577f21691a3977';
const MK_CD_SERVICO = '9999';

// ── Helpers ─────────────────────────────────────────────
const log = (label, ok, detail = '') => {
  const icon = ok ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[31m✘ FAIL\x1b[0m';
  console.log(`  ${icon}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const separator = (title) => {
  console.log(`\n\x1b[36m━━━ ${title} ━━━\x1b[0m`);
};

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) { passed++; } else { failed++; }
  log(label, condition, detail);
}

// ── Testes ──────────────────────────────────────────────
async function testAuthEndpoint() {
  separator('1. Testar endpoint de autenticação MK');

  const url = `${MK_BASE_URL}/mk/WSAutenticacao.rule`;
  const params = {
    sys: 'MK0',
    token: MK_USER_TOKEN,
    password: MK_PASSWORD,
    cd_servico: MK_CD_SERVICO,
  };

  console.log(`  → GET ${url}`);
  console.log(`  → Params: sys=MK0, token=${MK_USER_TOKEN.slice(0, 8)}..., cd_servico=${MK_CD_SERVICO}`);

  try {
    const start = Date.now();
    const { data, status } = await axios.get(url, { params, timeout: 15000 });
    const elapsed = Date.now() - start;

    assert('HTTP status 200', status === 200, `status=${status}`);
    assert('Resposta não é vazia', !!data, typeof data);
    assert('Tempo de resposta < 10s', elapsed < 10000, `${elapsed}ms`);

    console.log(`\n  \x1b[33mResposta completa:\x1b[0m`);
    console.log(`  ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')}`);

    // Tentar extrair o token (pode vir em variantes de case)
    const token =
      data?.TokenRetornoAutenticacao ||
      data?.tokenRetornoAutenticacao ||
      data?.Token ||
      data?.token;

    assert('Token retornado na resposta', !!token, token ? `${token.slice(0, 12)}...` : 'NÃO ENCONTRADO');

    // Se tiver token, testar uma consulta simples
    if (token) {
      await testConsultaComToken(token);
    }

    return token;
  } catch (err) {
    assert('Conexão com API MK', false, err.message);
    if (err.response) {
      console.log(`  HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    }
    return null;
  }
}

async function testConsultaComToken(token) {
  separator('2. Testar consulta com token obtido');

  // Tenta listar classificações de atendimento (endpoint read-only seguro)
  const url = `${MK_BASE_URL}/mk/WSMKListaClassificacoesAte.rule`;
  const params = { sys: 'MK0', token };

  console.log(`  → GET ${url}`);

  try {
    const start = Date.now();
    const { data, status } = await axios.get(url, { params, timeout: 15000 });
    const elapsed = Date.now() - start;

    assert('Consulta com token - HTTP 200', status === 200, `status=${status}`);
    assert('Consulta retornou dados', !!data, typeof data);
    assert('Tempo de resposta < 10s', elapsed < 10000, `${elapsed}ms`);

    // Verificar se o token ainda é válido (não retornou erro de auth)
    const isError = typeof data === 'string' && (data.includes('Token') || data.includes('invalido'));
    assert('Token é válido (sem erro de auth)', !isError, isError ? 'Token inválido/expirado' : 'Token OK');

    if (typeof data === 'object') {
      const keys = Object.keys(data);
      console.log(`  Chaves na resposta: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`);
    }
  } catch (err) {
    assert('Consulta com token', false, err.message);
  }
}

async function testTokenRefresh() {
  separator('3. Testar renovação de token (segunda autenticação)');

  const url = `${MK_BASE_URL}/mk/WSAutenticacao.rule`;
  const params = {
    sys: 'MK0',
    token: MK_USER_TOKEN,
    password: MK_PASSWORD,
    cd_servico: MK_CD_SERVICO,
  };

  try {
    const { data: data1 } = await axios.get(url, { params, timeout: 15000 });
    const token1 = data1?.TokenRetornoAutenticacao || data1?.tokenRetornoAutenticacao || data1?.Token || data1?.token;

    // Esperar 1 segundo e autenticar novamente
    await new Promise((r) => setTimeout(r, 1000));

    const { data: data2 } = await axios.get(url, { params, timeout: 15000 });
    const token2 = data2?.TokenRetornoAutenticacao || data2?.tokenRetornoAutenticacao || data2?.Token || data2?.token;

    assert('Duas autenticações consecutivas OK', !!token1 && !!token2);
    assert('Tokens recebidos com sucesso', !!token1 && !!token2,
      token1 === token2 ? 'Mesmo token (cache do MK)' : 'Tokens diferentes');
  } catch (err) {
    assert('Renovação de token', false, err.message);
  }
}

async function testInvalidCredentials() {
  separator('4. Testar credenciais inválidas (deve falhar gracefully)');

  const url = `${MK_BASE_URL}/mk/WSAutenticacao.rule`;
  const params = {
    sys: 'MK0',
    token: 'token_invalido_12345',
    password: 'senha_errada',
    cd_servico: '9999',
  };

  try {
    const { data, status } = await axios.get(url, { params, timeout: 15000 });
    assert('Servidor respondeu (não travou)', true, `status=${status}`);

    const token = data?.TokenRetornoAutenticacao || data?.tokenRetornoAutenticacao || data?.Token || data?.token;
    assert('Não retornou token com credenciais inválidas', !token, token ? 'TOKEN RETORNADO (inesperado!)' : 'Sem token (correto)');
  } catch (err) {
    // Alguns servidores retornam 401/403 para credenciais inválidas
    if (err.response) {
      assert('API rejeitou credenciais inválidas', err.response.status >= 400, `status=${err.response.status}`);
    } else {
      assert('Tratamento de credenciais inválidas', false, err.message);
    }
  }
}

// ── Main ────────────────────────────────────────────────
async function main() {
  console.log('\x1b[1m\x1b[35m');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    TESTE - Autenticação API MK Solutions     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  await testAuthEndpoint();
  await testTokenRefresh();
  await testInvalidCredentials();

  // Resumo
  console.log('\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log(`  Total: ${passed + failed} testes | \x1b[32m${passed} passed\x1b[0m | \x1b[31m${failed} failed\x1b[0m`);
  console.log('\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
