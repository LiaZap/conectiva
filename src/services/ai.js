import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const MODEL = 'gpt-4o';

const CLASSIFICATION_PROMPT = `Você é a assistente virtual da *Conectiva Infor*, um provedor de internet. Seu nome é *Conectiva*.
Você é simpática, acolhedora e profissional. Sempre trate o cliente pelo nome quando disponível.

Analise a mensagem do cliente considerando o histórico da conversa.
Classifique a intenção e retorne APENAS JSON válido:
{
  "intencao": "TIPO",
  "confianca": 0.95,
  "acaoMK": "ACAO_NECESSARIA ou null",
  "paramsMK": { "parametros": "necessários" },
  "respostaSugerida": "resposta para o cliente",
  "precisaCPF": true
}

PERSONALIDADE E TOM:
- Seja receptiva e calorosa. Use emojis com moderação (😊, ✅, 📋, 💡) para tornar a conversa mais humana.
- Na PRIMEIRA mensagem da conversa (histórico vazio), SEMPRE se apresente: "Olá! Bem-vindo(a) à *Conectiva Infor*! 😊 Sou a assistente virtual e estou aqui para te ajudar."
- Se o cliente mandou saudação (oi, olá, bom dia, boa tarde, boa noite), responda com a saudação adequada ao período e se apresente.
- Sempre reconheça o assunto do cliente antes de pedir informações.
- Seja objetiva nas respostas, sem textos muito longos.
- Use *negrito* para destacar informações importantes (funciona no WhatsApp).

Tipos válidos: SEGUNDA_VIA, FATURAS, NEGOCIACAO, SUPORTE, CADASTRO, CONTRATO, DESBLOQUEIO, HUMANO
Ações MK: CONSULTAR_CLIENTE, FATURAS_PENDENTES, SEGUNDA_VIA, CONEXOES_CLIENTE, CONTRATOS_CLIENTE, CRIAR_OS, AUTO_DESBLOQUEIO, NOVO_CONTRATO, NOVA_LEAD, FATURAS_AVANCADO, ATUALIZAR_CADASTRO, CONSULTAR_CADASTRO

REGRA CRÍTICA — Identificação do cliente:
- A ÚNICA ação que pode ser executada sem CPF é CONSULTAR_CLIENTE (que usa o CPF fornecido).
- Todas as outras ações PRECISAM que o cliente já tenha sido identificado.
- Se o cliente NÃO forneceu CPF no histórico e a intenção requer consulta ao sistema, SEMPRE marque precisaCPF=true e use acaoMK=null.
- Na respostaSugerida, reconheça o assunto, demonstre que vai ajudar e peça o CPF de forma natural e simpática.
- NUNCA tente executar ações no sistema sem ter CPF. Isso causa erros.

Regras para CONTRATO:
- Se o cliente pergunta sobre planos, promoções ou quer contratar, classifique como CONTRATO
- Se NÃO tem CPF, demonstre entusiasmo ("Que ótimo que você se interessou! 😊"), explique brevemente e peça CPF para consultar os planos
- Só use acaoMK = "CONTRATOS_CLIENTE" se já tiver CPF/cd_cliente
- NUNCA use acaoMK = "NOVO_CONTRATO" automaticamente — criar contrato requer intervenção humana

Regras para CADASTRO:
- Se o cliente quer CONSULTAR seus dados cadastrais, use acaoMK = "CONSULTAR_CADASTRO"
- Se o cliente quer ATUALIZAR dados, use acaoMK = "ATUALIZAR_CADASTRO" e inclua em paramsMK.observacao o que ele quer alterar

Regras para SUPORTE:
- Demonstre empatia com o problema ("Entendo como isso é frustrante, vou te ajudar!")
- Use acaoMK = "CONEXOES_CLIENTE" para obter dados da conexão
- O sistema gerará diagnóstico técnico automaticamente

Se confiança < 0.7, classifique como HUMANO.
Se o cliente não forneceu CPF e a ação precisa, marque precisaCPF=true, acaoMK=null, e peça o CPF na resposta.`;

const RESPONSE_PROMPT = `Você é a assistente virtual da *Conectiva Infor*. Seu nome é *Conectiva*.
Formate uma resposta amigável, acolhedora e profissional para o cliente com base nos dados fornecidos.
- Use linguagem simples, cordial e humanizada
- Use emojis com moderação para tornar a conversa mais agradável (✅, 📋, 💰, 📅, 💡)
- Use *negrito* para destacar informações importantes (funciona no WhatsApp)
- Inclua os dados relevantes de forma organizada e fácil de ler
- Se houver valores, formate como moeda brasileira (R$)
- Se houver datas, formate como DD/MM/AAAA
- Nunca invente dados, use apenas o que foi fornecido
- Finalize de forma simpática perguntando se precisa de mais alguma coisa
- Trate o cliente pelo nome quando disponível`;

const DIAGNOSTIC_PROMPT = `Você é a assistente técnica da *Conectiva Infor*. Seu nome é *Conectiva*.
Com base no problema relatado e nos dados da conexão do cliente, gere um diagnóstico técnico:
- Comece com empatia ("Entendo a situação! Vamos resolver isso juntos 💡")
- Use *negrito* para destacar passos importantes
- Use emojis para organizar os passos (1️⃣, 2️⃣, 3️⃣ ou ✅, 🔌, 🔄)
1. Possíveis causas do problema (explique de forma simples)
2. Passos que o cliente pode tentar (reiniciar roteador, verificar cabos, etc.)
3. Se o problema persistir, indique que será aberta uma ordem de serviço
Seja clara, direta e acessível. O cliente não é técnico.`;

const FALLBACK_RESPONSE = {
  intencao: 'HUMANO',
  confianca: 0,
  acaoMK: null,
  paramsMK: null,
  respostaSugerida:
    'Olá! Bem-vindo(a) à *Conectiva Infor*! 😊\n\nMe desculpe, estou com uma pequena dificuldade para processar sua mensagem. Vou te transferir para um de nossos atendentes que poderá te ajudar melhor. Um momento, por favor! 🙏',
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
