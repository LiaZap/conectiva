import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const MODEL = 'gpt-4o';

const CLASSIFICATION_PROMPT = `Você é o assistente virtual da Conectiva Infor, um provedor de internet. Analise a mensagem do cliente considerando o histórico da conversa.
Classifique a intenção e retorne APENAS JSON válido:
{
  "intencao": "TIPO",
  "confianca": 0.95,
  "acaoMK": "ACAO_NECESSARIA ou null",
  "paramsMK": { "parametros": "necessários" },
  "respostaSugerida": "resposta para o cliente",
  "precisaCPF": true
}
Tipos válidos: SEGUNDA_VIA, FATURAS, NEGOCIACAO, SUPORTE, CADASTRO, CONTRATO, DESBLOQUEIO, HUMANO
Ações MK: CONSULTAR_CLIENTE, FATURAS_PENDENTES, SEGUNDA_VIA, CONEXOES_CLIENTE, CONTRATOS_CLIENTE, CRIAR_OS, AUTO_DESBLOQUEIO, NOVO_CONTRATO, NOVA_LEAD, FATURAS_AVANCADO, ATUALIZAR_CADASTRO, CONSULTAR_CADASTRO
Regras para CADASTRO:
- Se o cliente quer CONSULTAR seus dados cadastrais (ver endereço, ver plano, etc.), use acaoMK = "CONSULTAR_CADASTRO"
- Se o cliente quer ATUALIZAR dados (mudar endereço, mudar email, mudar telefone), use acaoMK = "ATUALIZAR_CADASTRO" e inclua em paramsMK.observacao o que ele quer alterar
Regras para SUPORTE:
- Sempre use acaoMK = "CONEXOES_CLIENTE" para obter dados da conexão do cliente
- O sistema gerará diagnóstico técnico automaticamente com base nos dados
Se confiança < 0.7, classifique como HUMANO.
Se o cliente não forneceu CPF e a ação precisa, marque precisaCPF=true e peça o CPF na resposta.`;

const RESPONSE_PROMPT = `Você é o assistente virtual da Conectiva Infor, um provedor de internet.
Formate uma resposta amigável e profissional para o cliente com base nos dados fornecidos.
- Use linguagem simples e cordial
- Inclua os dados relevantes de forma organizada
- Se houver valores, formate como moeda brasileira (R$)
- Se houver datas, formate como DD/MM/AAAA
- Nunca invente dados, use apenas o que foi fornecido
- Finalize perguntando se o cliente precisa de mais alguma coisa`;

const DIAGNOSTIC_PROMPT = `Você é um técnico de suporte da Conectiva Infor, um provedor de internet.
Com base no problema relatado e nos dados da conexão do cliente, gere um diagnóstico técnico objetivo:
1. Possíveis causas do problema
2. Passos que o cliente pode tentar (reiniciar roteador, verificar cabos, etc.)
3. Se o problema persistir, indique que será aberta uma ordem de serviço
Seja claro e direto. Use linguagem acessível.`;

const FALLBACK_RESPONSE = {
  intencao: 'HUMANO',
  confianca: 0,
  acaoMK: null,
  paramsMK: null,
  respostaSugerida:
    'Desculpe, estou com dificuldades para processar sua mensagem no momento. Vou transferir você para um atendente. Um momento, por favor.',
  precisaCPF: false,
};

function buildHistoryMessages(historico) {
  if (!historico || historico.length === 0) return [];
  return historico.map((msg) => ({
    role: msg.direcao === 'entrada' ? 'user' : 'assistant',
    content: msg.conteudo,
  }));
}

export async function classify(mensagem, historico) {
  try {
    const messages = [
      { role: 'system', content: CLASSIFICATION_PROMPT },
      ...buildHistoryMessages(historico),
      { role: 'user', content: mensagem },
    ];

    const start = Date.now();
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    const elapsed = Date.now() - start;

    const raw = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);

    if (parsed.confianca < 0.7) {
      parsed.intencao = 'HUMANO';
    }

    console.log('[ai] classify', {
      intencao: parsed.intencao,
      confianca: parsed.confianca,
      elapsed: `${elapsed}ms`,
    });

    return { ...parsed, _tempoMs: elapsed };
  } catch (err) {
    console.error('[ai] Erro na classificação:', err.message);
    return { ...FALLBACK_RESPONSE, _tempoMs: 0 };
  }
}

export async function formatResponse({ intencao, mkData, session, historico }) {
  try {
    const context = JSON.stringify({ intencao, mkData, cliente: session?.nome_cliente }, null, 2);

    const messages = [
      { role: 'system', content: RESPONSE_PROMPT },
      ...buildHistoryMessages(historico),
      {
        role: 'user',
        content: `Dados para formatar a resposta:\n${context}`,
      },
    ];

    const start = Date.now();
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.5,
      max_tokens: 800,
    });
    const elapsed = Date.now() - start;

    console.log('[ai] formatResponse', { intencao, elapsed: `${elapsed}ms` });

    return completion.choices[0].message.content;
  } catch (err) {
    console.error('[ai] Erro ao formatar resposta:', err.message);

    const fallbacks = {
      SEGUNDA_VIA: 'Estou gerando sua segunda via. Em instantes você receberá o boleto atualizado.',
      FATURAS: 'Consultei suas faturas. Para mais detalhes, posso transferir para um atendente.',
      SUPORTE: 'Identifiquei seu problema técnico. Vou abrir uma ordem de serviço para que nossa equipe resolva o mais rápido possível.',
      DESBLOQUEIO: 'Estou processando o desbloqueio da sua conexão. Aguarde alguns instantes.',
    };

    return (
      fallbacks[intencao] ||
      'Desculpe, tive um problema ao processar sua solicitação. Vou transferir para um atendente que poderá ajudá-lo melhor.'
    );
  }
}

export async function generateDiagnostic({ problema, dadosConexao }) {
  try {
    const context = JSON.stringify({ problema, dadosConexao }, null, 2);

    const start = Date.now();
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: DIAGNOSTIC_PROMPT },
        {
          role: 'user',
          content: `Problema reportado e dados da conexão:\n${context}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 600,
    });
    const elapsed = Date.now() - start;

    console.log('[ai] generateDiagnostic', { elapsed: `${elapsed}ms` });

    return completion.choices[0].message.content;
  } catch (err) {
    console.error('[ai] Erro no diagnóstico:', err.message);
    return 'Por favor, tente reiniciar seu roteador desligando-o por 30 segundos. Se o problema persistir, vamos abrir uma ordem de serviço para nossa equipe técnica verificar.';
  }
}
