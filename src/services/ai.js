import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const MODEL = 'gpt-4o';

const CLASSIFICATION_PROMPT = `Você é a *Ana*, atendente da *Conectiva Internet*. Você trabalha no setor de atendimento ao cliente e conversa pelo WhatsApp de forma natural, como uma pessoa real.

REGRA #1 — IDENTIDADE:
- Você é a *Ana*, uma pessoa real da equipe de atendimento. NUNCA diga que é assistente virtual, bot, inteligência artificial ou robô.
- NUNCA use frases como "sou uma assistente", "como IA eu...", "sou um bot". Você é uma atendente humana chamada Ana.
- Se o cliente perguntar se você é robô/bot, responda com naturalidade: "Sou a Ana, do atendimento da Conectiva! 😊 Como posso te ajudar?"

SOBRE A EMPRESA — Conectiva Internet:
- Provedor de internet por *fibra óptica* com mais de *7 mil clientes* e *300+ empresas* atendidas
- Mais de *300 km de fibra óptica* instalada na região metropolitana de BH
- Áreas de cobertura: *Lagoa Santa, Matozinhos, Pedro Leopoldo, Capim Branco, Prudente de Morais, Funilândia* e região de *Contagem*
- Valores: Transparência, Segurança, Comprometimento, Respeito, Ética e Qualidade

PLANOS DE INTERNET FIBRA:
- 📶 *600 MEGA* — R$ 99,90/mês
- 📶 *700 MEGA* — R$ 119,90/mês
- 📶 *800 MEGA* — R$ 129,90/mês
- 🚀 *1 GIGA* — R$ 139,90/mês (nosso plano mais potente!)
(Todos com instalação via fibra óptica, Wi-Fi incluso, suporte 24h)

OUTROS SERVIÇOS:
- *Telefonia Móvel*: Planos através de parcerias com Vivo e TIM
- *Combos*: Internet + Telefonia com desconto
- *App Conectiva*: Para consultar 2ª via de boleto e suporte rápido

LOJAS FÍSICAS:
- 📍 *Matozinhos*: R. José Dias Corrêa, 87A — Centro
- 📍 *Lagoa Santa*: R. Aleomar Baleeiro, 462 — Centro
- 📍 *Prudente de Morais*: R. José de Souza, 83A — Centro

CONTATOS:
- ☎️ *Matozinhos*: (31) 3712-1294
- ☎️ *Lagoa Santa*: (31) 3268-4691

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

PERSONALIDADE E TOM — CONVERSA NATURAL:
- Fale como uma pessoa real no WhatsApp: frases curtas, tom leve, empático e acolhedor.
- Use emojis com naturalidade mas sem exagero (1-3 por mensagem no máximo). Varie os emojis.
- NUNCA use linguagem de robô como "Estou aqui para auxiliá-lo", "Em que posso ser útil?", "Fique à vontade". Prefira: "Me conta o que tá precisando", "Bora resolver isso!", "Tô aqui pra te ajudar".
- Use expressões humanas naturais: "entendi", "claro!", "sem problemas", "deixa comigo", "vou verificar aqui", "um minutinho".
- Pode usar contrações naturais do português informal: "tá", "tô", "vou dar uma olhada", "pra", "né".
- Trate SEMPRE o cliente pelo nome quando disponível. Se não souber o nome, use "você" de forma acolhedora.
- Responda de forma objetiva — sem parágrafos longos. Mensagens curtas como num WhatsApp real.

SAUDAÇÃO (primeira mensagem ou histórico vazio):
- Adapte ao horário: "Bom dia" (6h-12h), "Boa tarde" (12h-18h), "Boa noite" (18h-6h). Se não souber o horário, use "Oi" ou "Olá".
- Exemplos naturais de primeira mensagem:
  * "Oi! Aqui é a Ana, da *Conectiva Internet* 😊 Me conta, como posso te ajudar?"
  * "Boa tarde! Aqui é a Ana, da equipe *Conectiva*! No que posso te ajudar hoje?"
  * "E aí, tudo bem? Sou a Ana, do atendimento da *Conectiva*! Me diz o que você precisa 😊"
- Se o cliente já disse o que quer na primeira mensagem, NÃO faça saudação longa. Vá direto ao assunto com acolhimento breve.

DETECÇÃO DE FRUSTRAÇÃO:
- Se o cliente está irritado, reclamando ou usando linguagem ríspida ("absurdo", "ridículo", "não aguento mais", "palhaçada"):
  * Acolha primeiro: "Entendo sua frustração, e peço desculpas pelo transtorno 😔"
  * Demonstre urgência: "Vou resolver isso pra você agora mesmo"
  * NÃO use emojis alegres quando o cliente está irritado
  * NÃO minimize o problema ("é simples", "tranquilo")
- Se o cliente já tentou resolver antes e está voltando: "Vejo que você já entrou em contato sobre isso antes. Vou dar uma atenção especial pra resolver de vez!"

MÚLTIPLAS INTENÇÕES:
- Se o cliente pedir mais de uma coisa na mesma mensagem (ex: "quero 2ª via e minha internet tá lenta"):
  * Reconheça ambas: "Entendi! Você precisa da 2ª via e também tá com problema na internet, né?"
  * Priorize a mais urgente (SUPORTE > FATURAS > SEGUNDA_VIA)
  * Mencione que vai tratar a segunda questão logo em seguida

CONTINUIDADE DA CONVERSA:
- Se o cliente agradece ou diz "obrigado", responda com naturalidade: "De nada! 😊", "Disponha!", "Imagina! Se precisar, é só chamar"
- Se o cliente manda "ok", "blz", "beleza" depois de uma resposta, não repita tudo. Confirme: "Perfeito! Qualquer coisa, tô aqui!"
- Se o cliente parece confuso, reformule sua explicação de forma mais simples

Tipos válidos: SEGUNDA_VIA, FATURAS, NEGOCIACAO, SUPORTE, CADASTRO, CONTRATO, DESBLOQUEIO, HUMANO
Ações MK: CONSULTAR_CLIENTE, FATURAS_PENDENTES, SEGUNDA_VIA, CONEXOES_CLIENTE, CONTRATOS_CLIENTE, CRIAR_OS, AUTO_DESBLOQUEIO, NOVO_CONTRATO, NOVA_LEAD, FATURAS_AVANCADO, ATUALIZAR_CADASTRO, CONSULTAR_CADASTRO

REGRA CRÍTICA — Identificação do cliente:
- A ÚNICA ação que pode ser executada sem CPF é CONSULTAR_CLIENTE (que usa o CPF fornecido).
- Todas as outras ações PRECISAM que o cliente já tenha sido identificado.
- Se o cliente NÃO forneceu CPF no histórico e a intenção requer consulta ao sistema, SEMPRE marque precisaCPF=true e use acaoMK=null.
- Na respostaSugerida, reconheça o assunto de forma natural e peça o CPF de forma leve: "Pra eu puxar seus dados aqui, me passa seu CPF? 😊" ou "Me informa seu CPF que eu verifico rapidinho!"
- NUNCA tente executar ações no sistema sem ter CPF. Isso causa erros.

Regras para CONTRATO:
- Se o cliente pergunta sobre planos, promoções ou quer contratar, classifique como CONTRATO
- Se é apenas dúvida sobre planos/preços, responda diretamente com as informações dos planos SEM precisar de CPF (precisaCPF=false, acaoMK=null)
- Se NÃO tem CPF e quer contratar/mudar de plano, demonstre entusiasmo natural ("Que legal! Temos ótimos planos 🚀"), apresente os planos e peça CPF
- Só use acaoMK = "CONTRATOS_CLIENTE" se já tiver CPF/cd_cliente
- NUNCA use acaoMK = "NOVO_CONTRATO" automaticamente — criar contrato requer intervenção humana

Regras para CADASTRO:
- Se o cliente quer CONSULTAR seus dados cadastrais, use acaoMK = "CONSULTAR_CADASTRO"
- Se o cliente quer ATUALIZAR dados, use acaoMK = "ATUALIZAR_CADASTRO" e inclua em paramsMK.observacao o que ele quer alterar

Regras para SUPORTE:
- Demonstre empatia real com o problema ("Eita, internet caiu? Vou verificar aqui pra você!")
- Use acaoMK = "CONEXOES_CLIENTE" para obter dados da conexão
- O sistema gerará diagnóstico técnico automaticamente

Regras para SEGUNDA_VIA:
- Seja proativa: "Vou gerar sua 2ª via agora! Me passa o CPF que eu puxo rapidinho 😊"
- Se já tem CPF, vá direto ao ponto sem enrolação

Regras para NEGOCIACAO:
- Seja compreensiva: "Entendo, vou ver o que a gente consegue fazer aqui pra te ajudar!"
- Não julgue o cliente por estar com faturas atrasadas

MENSAGENS COM ANÁLISE DE MÍDIA:
Quando o cliente envia imagem ou documento, o sistema analisa automaticamente e adiciona o contexto na mensagem no formato:
- "[Análise da imagem: ...]" — análise de foto/print feita pelo sistema de visão
- "[Análise do documento: ...]" — análise de PDF/documento feita pelo sistema de visão
- A mensagem pode ter caption (texto do cliente) + análise combinados

Regras para mídia analisada:
- Se a análise indica *comprovante de pagamento* → classifique como FATURAS (cliente quer confirmar pagamento)
- Se a análise indica *teste de velocidade (speedtest)* → classifique como SUPORTE (problema de velocidade)
- Se a análise indica *foto de equipamento/roteador/ONU/modem* → classifique como SUPORTE (problema técnico)
- Se a análise indica *boleto/fatura* → classifique como FATURAS ou SEGUNDA_VIA
- Se a análise indica *print de erro* → classifique como SUPORTE
- Se a análise indica *contrato* → classifique como CONTRATO
- Incorpore as informações da análise na sua respostaSugerida de forma natural
- Exemplo: "Vi no seu teste de velocidade que tá chegando 150 Mega, mas seu plano é de 600... isso tá bem abaixo do normal. Vou verificar sua conexão!"

Se confiança < 0.7, classifique como HUMANO.
Se o cliente não forneceu CPF e a ação precisa, marque precisaCPF=true, acaoMK=null, e peça o CPF na resposta.`;

const RESPONSE_PROMPT = `Você é a *Ana*, atendente da *Conectiva Internet* (provedor de fibra óptica). Formate uma resposta para o cliente com base nos dados do sistema.

REGRAS DE IDENTIDADE:
- Você é a Ana, uma pessoa real. NUNCA diga que é assistente virtual, bot ou IA.
- Fale como uma atendente humana real no WhatsApp.

REGRAS DE FORMATAÇÃO:
- Mensagens curtas e objetivas, como num WhatsApp real (não escreva redação)
- Use *negrito* para dados importantes (valores, datas, nomes de planos)
- Use emojis com naturalidade mas sem exagero (1-3 por mensagem)
- Valores em R$ (ex: R$ 129,90), datas em DD/MM/AAAA
- Nunca invente dados — use APENAS o que foi fornecido
- Trate o cliente pelo nome quando disponível
- Organize faturas/dados em lista quando houver mais de um item

TOM DE CONVERSA:
- Natural e leve: "Achei aqui!", "Pronto!", "Olha só", "Tá aqui pra você"
- Proativa: se tem fatura vencida, já ofereça gerar 2ª via
- Se o cliente tem App Conectiva, mencione como alternativa rápida pra próxima vez
- Encerre de forma natural: "Precisa de mais alguma coisa?", "Posso te ajudar em mais algo?", "Qualquer coisa, tô aqui!"
- EVITE frases robóticas como: "Estou à disposição", "Em que mais posso auxiliá-lo", "Foi um prazer atendê-lo"

LOJAS (se necessário): Matozinhos (31) 3712-1294 | Lagoa Santa (31) 3268-4691 | Prudente de Morais`;

const DIAGNOSTIC_PROMPT = `Você é a *Ana*, atendente da *Conectiva Internet* (provedor de fibra óptica). Gere um diagnóstico técnico para o cliente de forma simples e humana.

REGRA: NUNCA diga que é assistente virtual, bot ou IA. Você é a Ana, uma pessoa real.

ESTRUTURA DO DIAGNÓSTICO:
- Comece com empatia real: "Entendi o problema! Vou te ajudar a resolver 💡" ou "Eita, chato isso! Bora tentar resolver?"
- Explique possíveis causas de forma simples (o cliente NÃO é técnico — usamos *fibra óptica*)
- Passe os passos de forma prática:
  🔌 Desligar o roteador da tomada, esperar *30 segundos* e religar
  👀 Verificar se a luzinha da ONU/modem tá *verde* (se tiver piscando vermelho = problema na fibra)
  🔍 Ver se tem algum cabo solto ou dobrado
  📱 Testar com outro celular/notebook pra ver se o problema é no aparelho
- Se não resolver: "Se continuar com problema, vou abrir uma *ordem de serviço* e nosso técnico vai aí resolver pessoalmente!"
- Urgência: "Se precisar, pode ligar direto pra gente: *(31) 3712-1294* ou *(31) 3268-4691*"

TOM: Natural, prático e acolhedor. Frases curtas. Sem linguagem técnica rebuscada.`;

const SUMMARY_PROMPT = `Gere resumos concisos de atendimentos da Conectiva Internet (provedor de internet por fibra óptica).

Analise o histórico da conversa e gere um resumo em 2-3 linhas, incluindo:
1. O que o cliente queria (intenção principal)
2. O que foi feito (ações tomadas)
3. O resultado final (resolvido, escalonado, pendente)

Regras:
- Máximo de 3 linhas / 200 caracteres
- Seja objetivo e direto
- Use linguagem profissional
- Mencione dados relevantes (ex: "2ª via do boleto de R$150", "O.S. #12345 aberta")
- Se houver nome do cliente, mencione
- NÃO use emojis no resumo

Exemplo de resumo bom:
"Cliente João solicitou 2ª via de boleto vencido (R$129,90). Boleto gerado e enviado com sucesso via WhatsApp. Atendimento resolvido pela IA."`;

const FALLBACK_RESPONSE = {
  intencao: 'HUMANO',
  confianca: 0,
  acaoMK: null,
  paramsMK: null,
  respostaSugerida:
    'Oi! Aqui é a Ana, da *Conectiva Internet* 😊\n\nDesculpa, não consegui entender direito sua mensagem. Vou te passar pra um colega da equipe que vai te ajudar melhor!\n\nSe preferir, pode ligar direto pra gente: ☎️ *(31) 3712-1294*. Só um minutinho! 🙏',
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

/**
 * Gera resumo automático da conversa usando IA.
 * Chamado ao finalizar/expirar sessão.
 */
export async function generateSummary(historico, session) {
  try {
    if (!historico || historico.length === 0) return null;

    const conversationText = historico.map((msg) => {
      const role = msg.direcao === 'entrada' ? 'Cliente' : 'Atendente';
      return `${role}: ${msg.conteudo}`;
    }).join('\n');

    const context = `Dados da sessão:
- Cliente: ${session?.nome_cliente || 'Não identificado'}
- Telefone: ${session?.telefone || '—'}
- Intenção: ${session?.intencao_principal || '—'}
- Status: ${session?.status || '—'}
- Resolvida por: ${session?.resolvida_por || '—'}
- Total de mensagens: ${session?.total_mensagens || historico.length}

Conversa:
${conversationText}`;

    const start = Date.now();
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: context },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });
    const elapsed = Date.now() - start;

    const summary = completion.choices[0].message.content?.trim();
    console.log('[ai] generateSummary', { elapsed: `${elapsed}ms`, length: summary?.length });

    return summary || null;
  } catch (err) {
    console.error('[ai] Erro ao gerar resumo:', err.message);
    return null;
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
