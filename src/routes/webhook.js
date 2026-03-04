import { Router } from 'express';
import { normalizeChannel } from '../utils/normalizer.js';
import { extractCPFFromText, formatPhone } from '../utils/validators.js';
import * as sessionService from '../services/session.js';
import * as logger from '../services/logger.js';
import { query } from '../config/database.js';

import { execute as n8nExecute } from '../services/n8n.js';
import { sendText, sendDocument, downloadMedia, sendPresence } from '../services/whatsapp.js';
import { analisarNegociacao } from '../services/negotiation.js';
import { classify, formatResponse, generateDiagnostic, generateSummary } from '../services/ai.js';
import { transcribeAudio, transcribeAudioBase64, transcribeAudioBuffer } from '../services/audio.js';
import { analyzeImage, analyzeDocument } from '../services/vision.js';
import { notifyEscalation, notifyNewLead, notifyNewSale } from '../services/notification.js';
import { emit, emitToSession, EVENTS } from '../websocket/events.js';

const router = Router();

// ── Helper: extrair dados do cliente da resposta do MK (WSMKConsultaDoc) ──
// Resposta n8n atualizada: { success, CodigoCliente, NomeCliente, data: {...mkRaw}, endpoint }
// Fallback legado: { success, data: { Outros: [{ CodigoPessoa }] }, endpoint }
function extractClientFromMK(data) {
  if (!data) return { cdCliente: null, nomeCliente: null };

  console.log('[extractClient] keys:', Object.keys(data), 'CodigoCliente:', data.CodigoCliente, 'CodigoPessoa:', data.CodigoPessoa);

  // 1. Formato novo: CodigoCliente já no nível raiz da resposta n8n
  if (data.CodigoCliente) {
    console.log('[extractClient] Encontrado no raiz:', data.CodigoCliente, data.NomeCliente);
    return { cdCliente: String(data.CodigoCliente), nomeCliente: data.NomeCliente || null };
  }

  // 2. Desembrulhar wrapper n8n { success, data: {...} }
  const mkData = data.data && (data.data.Outros || data.data.CodigoCliente || data.data.CodigoPessoa)
    ? data.data
    : data;

  // 3. Tentar extrair do nível raiz do MK response
  let cdCliente = mkData.CodigoCliente || mkData.cd_cliente || mkData.codigo_cliente
                || mkData.CdCliente || mkData.Codigo || mkData.CodigoPessoa || mkData.codigo_pessoa;
  let nomeCliente = mkData.NomeCliente || mkData.nome_cliente || mkData.RazaoSocial
                  || mkData.Nome || mkData.nome;

  // 4. Se não encontrou no raiz, procurar dentro de "Outros" (array do MK WSMKConsultaDoc)
  if (!cdCliente && mkData.Outros) {
    const lista = Array.isArray(mkData.Outros) ? mkData.Outros : [mkData.Outros];
    if (lista.length > 0) {
      const primeiro = lista[0];
      cdCliente = primeiro.CodigoCliente || primeiro.CodigoPessoa || primeiro.Codigo
                || primeiro.cd_cliente || primeiro.codigo_pessoa;
      nomeCliente = nomeCliente || primeiro.NomeCliente || primeiro.Nome || primeiro.nome
                  || primeiro.RazaoSocial;
    }
  }

  console.log('[extractClient] Resultado:', { cdCliente: cdCliente ? String(cdCliente) : null, nomeCliente });
  return { cdCliente: cdCliente ? String(cdCliente) : null, nomeCliente: nomeCliente || null };
}

// ── Mensagem de pesquisa de satisfação (CSAT) ──
const CSAT_MESSAGE = `Que bom que consegui te ajudar! 😊

Antes de ir, me ajuda com uma coisinha? *Como você avalia o atendimento de hoje?*

Responde com uma nota de *1 a 5*:
1️⃣ Péssimo
2️⃣ Ruim
3️⃣ Regular
4️⃣ Bom
5️⃣ Excelente

Sua opinião ajuda a gente a melhorar cada vez mais! 💙`;

const CSAT_THANKS = {
  1: 'Poxa, sinto muito que sua experiência não foi boa 😔 Vou repassar seu feedback pro nosso time. Obrigada por responder!',
  2: 'Entendi... obrigada pelo feedback sincero! Vou repassar pro time pra gente melhorar 🙏',
  3: 'Obrigada pela nota! Vamos nos esforçar pra te atender ainda melhor na próxima 😊',
  4: 'Que bom! Fico feliz que deu tudo certo 😊 Obrigada pela avaliação!',
  5: 'Que demais, fico muito feliz! ⭐ Obrigada pela confiança na *Conectiva*! 💙',
};

// ── Buffer de mensagens (debounce) ──────────────────────
// Clientes frequentemente enviam várias mensagens seguidas.
// O buffer acumula mensagens por 15s antes de processar tudo junto.
const BUFFER_TIMEOUT_MS = 15_000;
const messageBuffer = new Map(); // Map<telefone, { messages, timer, canal, pushName, replyFn }>

function bufferMessage(telefone, message, canal, pushName, replyFn) {
  const existing = messageBuffer.get(telefone);

  if (existing) {
    // Já tem buffer — acumular mensagem e resetar timer
    clearTimeout(existing.timer);
    existing.messages.push(message);
    console.log(`[buffer] Acumulando msg para ${telefone} (${existing.messages.length} msgs)`);
    existing.timer = setTimeout(() => flushBuffer(telefone), BUFFER_TIMEOUT_MS);
  } else {
    // Novo buffer
    console.log(`[buffer] Novo buffer para ${telefone} (aguardando ${BUFFER_TIMEOUT_MS / 1000}s)`);
    const entry = {
      messages: [message],
      canal,
      pushName,
      replyFn,
      timer: setTimeout(() => flushBuffer(telefone), BUFFER_TIMEOUT_MS),
    };
    messageBuffer.set(telefone, entry);
  }
}

async function flushBuffer(telefone) {
  const entry = messageBuffer.get(telefone);
  if (!entry) return;
  messageBuffer.delete(telefone);

  // Juntar todas as mensagens em uma só
  const combinedMessage = entry.messages.join('\n');
  console.log(`[buffer] Processando ${entry.messages.length} msg(s) de ${telefone}: "${combinedMessage.substring(0, 80)}"`);

  try {
    await processMessage(entry.canal, {
      _buffered: true,
      from: telefone,
      message: combinedMessage,
      pushName: entry.pushName,
    }, entry.replyFn);
  } catch (err) {
    console.error('[buffer] Erro ao processar buffer:', err.message);
    try {
      await entry.replyFn(telefone, 'Opa, deu um probleminha aqui! 😅 Pode mandar sua mensagem de novo?');
    } catch (_) { /* silencioso */ }
  }
}

/**
 * Pipeline principal de processamento de mensagens.
 * Compartilhado entre WhatsApp e Site.
 */
async function processMessage(canal, body, replyFn) {
  const totalStart = Date.now();

  // 1. Normalizar payload (ou usar dados já bufferizados)
  let from, message, pushName, fromMe;

  if (body._buffered) {
    // Veio do buffer — já está normalizado
    from = body.from;
    message = body.message;
    pushName = body.pushName;
    fromMe = false;
  } else {
    const normalized = normalizeChannel(body, canal);
    from = normalized.from;
    message = normalized.message;
    pushName = normalized.pushName;
    fromMe = normalized.fromMe;
  }

  console.log('[webhook] Payload recebido:', { canal, from, message: message?.substring(0, 80), pushName, fromMe });

  // Ignorar mensagens enviadas pela própria IA
  if (fromMe) {
    console.log('[webhook] Ignorando mensagem fromMe');
    return;
  }

  if (!message) return;

  const telefone = canal === 'whatsapp' ? formatPhone(from) : from;

  // 1.5. Verificar se há sessão aguardando avaliação CSAT
  const csatSession = await sessionService.findAwaitingCSAT(telefone, canal);
  if (csatSession) {
    const nota = message.trim().replace(/[^\d]/g, '');
    if (['1', '2', '3', '4', '5'].includes(nota)) {
      // Salvar nota CSAT
      await sessionService.saveCSAT(csatSession.id, parseInt(nota));
      const agradecimento = CSAT_THANKS[parseInt(nota)];
      await replyFn(telefone, agradecimento);
      await logger.saveMessage({ session_id: csatSession.id, direcao: 'entrada', conteudo: message, canal });
      await logger.saveMessage({ session_id: csatSession.id, direcao: 'saida', conteudo: agradecimento, canal });
      emit(EVENTS.SESSAO_ATUALIZADA, { session_id: csatSession.id, status: 'finalizada', nota_satisfacao: parseInt(nota) });
      console.log(`[webhook] CSAT capturada: nota ${nota} para sessão ${csatSession.id}`);
      return;
    }
    // Se não é uma nota válida, tratar como nova conversa (ignorar CSAT pendente)
    // Finalizar a sessão CSAT sem nota e continuar fluxo normal
    await sessionService.update(csatSession.id, { status: 'finalizada' });
    console.log(`[webhook] CSAT ignorada (resposta não é nota), finalizando sessão ${csatSession.id}`);
  }

  // 2. Busca ou cria sessão
  const session = await sessionService.findOrCreate({ telefone, canal, pushName });
  const sid = session.id;

  // 3. Gravar mensagem de entrada (sempre, mesmo se humano está atendendo)
  await logger.saveMessage({ session_id: sid, direcao: 'entrada', conteudo: message, canal });
  await sessionService.incrementMessages(sid);

  // 4. Emitir nova_mensagem (para o dashboard ver em tempo real)
  emit(EVENTS.NOVA_MENSAGEM, { session_id: sid, canal, telefone, message, pushName });
  emitToSession(sid, EVENTS.NOVA_MENSAGEM, { message, direcao: 'entrada' });

  // 4.5. Se humano está atendendo, NÃO processar com IA
  // A mensagem já foi gravada e emitida — o atendente humano vê no dashboard
  if (session.status === 'aguardando_humano') {
    console.log(`[webhook] Sessão ${sid} em atendimento humano — IA desativada`);
    return;
  }

  // 4.6. Mostrar "digitando..." enquanto processa (WhatsApp)
  if (canal === 'whatsapp') {
    sendPresence(telefone, 'composing').catch(() => {});
  }

  // 5. Buscar histórico + classificar com IA
  const historico = await sessionService.getHistory(sid);
  const classification = await classify(message, historico);
  let { intencao, confianca, acaoMK, paramsMK, respostaSugerida, precisaCPF, _tempoMs: tempo_ia_ms } = classification;

  // 6. Emitir ia_classificou
  emit(EVENTS.IA_CLASSIFICOU, { session_id: sid, intencao, confianca, acaoMK });
  emitToSession(sid, EVENTS.IA_CLASSIFICOU, { intencao, confianca });

  // Atualizar intenção na sessão
  await sessionService.update(sid, { intencao_principal: intencao });

  // Tentar extrair CPF da mensagem
  const cpfFromText = extractCPFFromText(message);
  if (cpfFromText && !session.cpf_cnpj) {
    await sessionService.update(sid, { cpf_cnpj: cpfFromText });
    session.cpf_cnpj = cpfFromText;
  }

  // 7. Verificar se a ação MK requer identificação do cliente
  // Ações que PRECISAM de CPF ou cd_cliente para funcionar
  const ACTIONS_REQUIRING_CUSTOMER = new Set([
    'FATURAS_PENDENTES', 'SEGUNDA_VIA', 'CONEXOES_CLIENTE', 'CONTRATOS_CLIENTE',
    'CRIAR_OS', 'AUTO_DESBLOQUEIO',
    'FATURAS_AVANCADO', 'ATUALIZAR_CADASTRO', 'CONSULTAR_CADASTRO',
  ]);
  // NOTA: NOVA_LEAD, CRIAR_PESSOA, LISTAR_PLANOS e NOVO_CONTRATO NÃO precisam de cd_cliente aqui
  // NOVO_CONTRATO resolve cd_cliente automaticamente (cria pessoa se necessário)

  // Se precisa CPF (IA pediu OU ação MK requer) e não tem, pedir ao cliente
  // NOVO_CONTRATO também precisa de CPF (para criar pessoa), mas resolve cd_cliente sozinho
  const precisaIdentificacao = precisaCPF || (acaoMK && (ACTIONS_REQUIRING_CUSTOMER.has(acaoMK) || acaoMK === 'NOVO_CONTRATO'));
  if (precisaIdentificacao && !session.cpf_cnpj && !session.cd_cliente_mk) {
    const pedidoCPF = respostaSugerida || 'Para que eu possa consultar suas informações e ajudá-lo melhor, preciso do seu CPF ou CNPJ. Pode informar, por favor?';
    await replyFn(telefone, pedidoCPF);
    await logger.saveMessage({ session_id: sid, direcao: 'saida', conteudo: pedidoCPF, canal });
    await logger.saveInteraction({
      session_id: sid, intencao, confianca, mensagem_cliente: message,
      resposta_ia: pedidoCPF, status: 'aguardando_cpf', tempo_ia_ms,
      tempo_total_ms: Date.now() - totalStart,
    });
    emit(EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: pedidoCPF });
    emitToSession(sid, EVENTS.RESPOSTA_ENVIADA, { resposta: pedidoCPF, direcao: 'saida' });
    console.log(`[webhook] CPF necessário para ${acaoMK || intencao}, aguardando cliente`);
    return;
  }

  // 7.5. Auto-correção: se a IA retornou acaoMK=null mas a sessão JÁ TEM CPF,
  // atribuir ação automaticamente baseado na intenção. Sem isso, o sistema
  // ficaria pedindo CPF em loop quando a IA não seta acaoMK corretamente.
  if (!acaoMK && session.cpf_cnpj) {
    const INTENCAO_TO_ACAO = {
      'SEGUNDA_VIA': 'FATURAS_PENDENTES',
      'FATURAS': 'FATURAS_PENDENTES',
      'NEGOCIACAO': 'FATURAS_PENDENTES',
      'DESBLOQUEIO': 'CONEXOES_CLIENTE',
      'SUPORTE': 'CONEXOES_CLIENTE',
      'CONTRATO': 'CONTRATOS_CLIENTE',
      'CADASTRO': 'CONSULTAR_CADASTRO',
    };
    const acaoAuto = INTENCAO_TO_ACAO[intencao];
    if (acaoAuto && !session.cd_cliente_mk) {
      // Tem CPF mas não tem cd_cliente → consultar cliente primeiro
      acaoMK = 'CONSULTAR_CLIENTE';
      paramsMK = { ...paramsMK, doc: session.cpf_cnpj };
      console.log(`[webhook] Auto-correção: CPF na sessão mas sem cd_cliente — usando CONSULTAR_CLIENTE para ${intencao}`);
    } else if (acaoAuto && session.cd_cliente_mk) {
      // Tem CPF E cd_cliente → usar ação direta da intenção
      acaoMK = acaoAuto;
      paramsMK = { ...paramsMK, cd_cliente: session.cd_cliente_mk };
      console.log(`[webhook] Auto-correção: CPF+cd_cliente existem, IA não setou ação — usando ${acaoAuto} para ${intencao}`);
    }
  }

  // 8. Se tem ação MK, chamar n8n
  let mkResult = null;
  let tempo_mk_ms = 0;

  if (acaoMK) {
    emit(EVENTS.CHAMANDO_MK, { session_id: sid, acao: acaoMK });
    emitToSession(sid, EVENTS.CHAMANDO_MK, { acao: acaoMK });

    const mkParams = { ...paramsMK };
    if (session.cpf_cnpj) mkParams.doc = session.cpf_cnpj;
    if (session.cd_cliente_mk) mkParams.cd_cliente = session.cd_cliente_mk;

    // ── Pré-requisito: identificar cliente no MK antes de ações que precisam cd_cliente ──
    // Se temos CPF mas ainda não temos cd_cliente_mk, consultar MK primeiro
    if (ACTIONS_REQUIRING_CUSTOMER.has(acaoMK) && session.cpf_cnpj && !mkParams.cd_cliente) {
      console.log(`[webhook] ${acaoMK} precisa de cd_cliente — consultando MK primeiro...`);

      const consultaResult = await n8nExecute({
        action: 'CONSULTAR_CLIENTE', params: { doc: session.cpf_cnpj }, session_id: sid,
      });

      if (consultaResult.success && consultaResult.data) {
        const { cdCliente, nomeCliente } = extractClientFromMK(consultaResult.data);

        if (cdCliente) {
          // ✅ Cliente encontrado no MK — salvar e prosseguir
          mkParams.cd_cliente = cdCliente;
          await sessionService.update(sid, {
            cd_cliente_mk: cdCliente,
            ...(nomeCliente && !session.nome_cliente ? { nome_cliente: nomeCliente } : {}),
          });
          session.cd_cliente_mk = cdCliente;
          if (nomeCliente) session.nome_cliente = nomeCliente;
          console.log(`[webhook] Cliente encontrado: cd_cliente=${cdCliente}, nome=${nomeCliente}`);

          await logger.saveAction({
            session_id: sid, interaction_id: null,
            acao: 'CONSULTAR_CLIENTE', descricao: 'Consulta automática CPF → Cliente encontrado no MK',
            status: 'sucesso', dados_entrada: { doc: session.cpf_cnpj },
            dados_saida: { cd_cliente: cdCliente, nome: nomeCliente },
            tempo_ms: consultaResult.tempo_ms,
          });
        } else {
          // ❌ Cliente NÃO encontrado no MK
          console.log(`[webhook] Cliente NÃO encontrado no MK: CPF ${session.cpf_cnpj}`);

          await logger.saveAction({
            session_id: sid, interaction_id: null,
            acao: 'CONSULTAR_CLIENTE', descricao: 'CPF consultado mas cliente não encontrado no MK',
            status: 'erro', dados_entrada: { doc: session.cpf_cnpj },
            dados_saida: consultaResult.data, tempo_ms: consultaResult.tempo_ms,
          });

          // Verificar se a intenção é de venda/contratação
          const isFluxoVenda = ['CONTRATO', 'VIABILIDADE'].includes(intencao) || acaoMK === 'NOVO_CONTRATO';

          if (isFluxoVenda) {
            // ── FLUXO DE VENDA: NÃO criar lead agora — IA vai tentar vender primeiro ──
            console.log(`[webhook] Cliente não cadastrado com intenção de venda (${intencao}) — IA vai conduzir a venda`);

            // Marcar para a IA saber que o cliente não é cadastrado e guiar a venda
            mkResult = {
              success: true,
              data: { _clienteNaoEncontrado: true, _fluxoVenda: true },
              tempo_ms: consultaResult.tempo_ms,
              endpoint: consultaResult.endpoint,
            };
            // NÃO retorna — continua para a formatação de resposta pela IA
          } else {
            // ── FLUXO PADRÃO (não é venda): criar lead e informar ──

            // Criar lead automaticamente para a equipe entrar em contato
            try {
              const leadResult = await n8nExecute({
                action: 'NOVA_LEAD',
                params: {
                  nome: session.nome_cliente || pushName || '',
                  telefone: telefone,
                  observacao: `Novo contato não cadastrado. CPF/CNPJ: ${session.cpf_cnpj}. Canal: ${canal}. Intenção: ${intencao}. Mensagem: ${message}`,
                },
                session_id: sid,
              });

              await logger.saveAction({
                session_id: sid, interaction_id: null,
                acao: 'NOVA_LEAD', descricao: 'Cliente não cadastrado — lead criada automaticamente',
                status: leadResult.success ? 'sucesso' : 'erro',
                dados_entrada: { cpf: session.cpf_cnpj, telefone },
                dados_saida: leadResult.data, tempo_ms: leadResult.tempo_ms,
              });
              console.log('[webhook] Lead criada para cliente não cadastrado:', { success: leadResult.success });
            } catch (leadErr) {
              console.error('[webhook] Erro ao criar lead:', leadErr.message);
            }

            // Notificar grupo de atendentes sobre novo lead (best-effort)
            notifyNewLead({ session, intencao, mensagem: message }).catch(() => {});

            // Informar o cliente e encerrar este ciclo
            const respostaNaoCadastrado =
              `Não encontrei um cadastro no nosso sistema com o CPF informado 🤔\n\n` +
              `Mas não se preocupe! Já registrei seu contato e *nossa equipe vai entrar em contato* com você para te ajudar! 😊` +
              `\n\nSe preferir atendimento presencial:\n` +
              `📍 *Matozinhos*: R. José Dias Corrêa, 87A — Centro\n` +
              `📍 *Lagoa Santa*: R. Aleomar Baleeiro, 462 — Centro\n` +
              `📍 *Prudente de Morais*: R. José de Souza, 83A — Centro\n\n` +
              `Ou ligue: ☎️ *(31) 3712-1294* ou *(31) 3268-4691*`;

            await replyFn(telefone, respostaNaoCadastrado);
            await logger.saveMessage({ session_id: sid, direcao: 'saida', conteudo: respostaNaoCadastrado, canal });
            await logger.saveInteraction({
              session_id: sid, intencao, confianca, mensagem_cliente: message,
              resposta_ia: respostaNaoCadastrado, acao_mk: 'CONSULTAR_CLIENTE',
              mk_endpoint: consultaResult.endpoint, mk_sucesso: true,
              mk_resposta: consultaResult.data,
              status: 'cliente_nao_encontrado', tempo_ia_ms,
              tempo_mk_ms: consultaResult.tempo_ms,
              tempo_total_ms: Date.now() - totalStart,
            });
            emit(EVENTS.RESPOSTA_ENVIADA, { session_id: sid, intencao, resposta: respostaNaoCadastrado });
            emitToSession(sid, EVENTS.RESPOSTA_ENVIADA, { resposta: respostaNaoCadastrado, direcao: 'saida' });
            return;
          }
        }
      } else {
        // Erro na consulta MK — deixar seguir, vai falhar na ação principal e escalonar
        console.error('[webhook] Erro ao consultar cliente no MK:', consultaResult.error);
      }
    }

    // ── Cadeia de dependências: algumas ações precisam de chamadas intermediárias ──

    // SEGUNDA_VIA precisa de cd_fatura (vem de FATURAS_PENDENTES)
    if (acaoMK === 'SEGUNDA_VIA' && !mkParams.cd_fatura) {
      console.log('[webhook] SEGUNDA_VIA: buscando faturas para obter cd_fatura...');
      const faturasResult = await n8nExecute({ action: 'FATURAS_PENDENTES', params: mkParams, session_id: sid });
      if (faturasResult.success && faturasResult.data) {
        const faturas = faturasResult.data.FaturasPendentes || faturasResult.data.faturas || faturasResult.data.Faturas || [];
        const listaFaturas = Array.isArray(faturas) ? faturas : [faturas];
        // Pegar a fatura mais recente (primeira da lista)
        if (listaFaturas.length > 0) {
          const fatura = listaFaturas[0];
          mkParams.cd_fatura = fatura.CodigoFatura || fatura.cd_fatura || fatura.codigo_fatura || fatura.CodigoDocumento;
          console.log(`[webhook] SEGUNDA_VIA: cd_fatura obtido = ${mkParams.cd_fatura}`);
        } else {
          // Sem faturas pendentes — informar ao cliente
          console.log('[webhook] SEGUNDA_VIA: nenhuma fatura pendente encontrada');
          mkResult = { success: true, data: { semFaturas: true, ...faturasResult.data }, tempo_ms: faturasResult.tempo_ms };
        }
      } else {
        mkResult = faturasResult; // Passa erro adiante
      }
    }

    // AUTO_DESBLOQUEIO precisa de cd_conexao (vem de CONEXOES_CLIENTE)
    if (acaoMK === 'AUTO_DESBLOQUEIO' && !mkParams.cd_conexao) {
      console.log('[webhook] DESBLOQUEIO: buscando conexões para obter cd_conexao...');
      const conexResult = await n8nExecute({ action: 'CONEXOES_CLIENTE', params: mkParams, session_id: sid });
      if (conexResult.success && conexResult.data) {
        const conexoes = conexResult.data.Conexoes || conexResult.data.conexoes || [];
        const listaConexoes = Array.isArray(conexoes) ? conexoes : [conexoes];
        if (listaConexoes.length > 0) {
          const conexao = listaConexoes[0];
          mkParams.cd_conexao = conexao.CodigoConexao || conexao.cd_conexao || conexao.codigo_conexao;
          console.log(`[webhook] DESBLOQUEIO: cd_conexao obtido = ${mkParams.cd_conexao}`);
        } else {
          console.log('[webhook] DESBLOQUEIO: nenhuma conexão encontrada');
          mkResult = { success: false, data: null, tempo_ms: conexResult.tempo_ms, error: 'Nenhuma conexão encontrada' };
        }
      } else {
        mkResult = conexResult;
      }
    }

    // CRIAR_OS precisa de cd_conexao (para saber qual conexão)
    if (acaoMK === 'CRIAR_OS' && !mkParams.cd_conexao) {
      console.log('[webhook] CRIAR_OS: buscando conexões para vincular O.S...');
      const conexResult = await n8nExecute({ action: 'CONEXOES_CLIENTE', params: mkParams, session_id: sid });
      if (conexResult.success && conexResult.data) {
        const conexoes = conexResult.data.Conexoes || conexResult.data.conexoes || [];
        const listaConexoes = Array.isArray(conexoes) ? conexoes : [conexoes];
        if (listaConexoes.length > 0) {
          mkParams.cd_conexao = listaConexoes[0].CodigoConexao || listaConexoes[0].cd_conexao;
        }
      }
    }

    // NOVO_CONTRATO — encadear: consultar cliente → verificar cobertura → criar pessoa → criar contrato
    if (acaoMK === 'NOVO_CONTRATO') {
      // 0. Consultar cliente automaticamente se tem CPF mas não tem cd_cliente
      if (!session.cd_cliente_mk && session.cpf_cnpj) {
        console.log(`[webhook] NOVO_CONTRATO: consultando cliente pelo CPF ${session.cpf_cnpj}...`);
        try {
          const consultaResult = await n8nExecute({
            action: 'CONSULTAR_CLIENTE', params: { doc: session.cpf_cnpj }, session_id: sid,
          });
          if (consultaResult.success && consultaResult.data) {
            const { cdCliente, nomeCliente } = extractClientFromMK(consultaResult.data);
            if (cdCliente) {
              mkParams.cd_cliente = cdCliente;
              await sessionService.update(sid, {
                cd_cliente_mk: cdCliente,
                ...(nomeCliente && !session.nome_cliente ? { nome_cliente: nomeCliente } : {}),
              });
              session.cd_cliente_mk = cdCliente;
              if (nomeCliente) session.nome_cliente = nomeCliente;
              console.log(`[webhook] NOVO_CONTRATO: cliente encontrado cd_cliente=${cdCliente}`);
            } else {
              console.log(`[webhook] NOVO_CONTRATO: CPF não encontrado no MK — vai criar pessoa`);
            }
          }
          await logger.saveAction({
            session_id: sid, interaction_id: null,
            acao: 'CONSULTAR_CLIENTE', descricao: 'Consulta automática antes do contrato',
            status: consultaResult.success ? 'sucesso' : 'erro',
            dados_entrada: { doc: session.cpf_cnpj },
            dados_saida: consultaResult.data, tempo_ms: consultaResult.tempo_ms,
          });
        } catch (err) {
          console.error('[webhook] Erro ao consultar cliente antes do contrato:', err.message);
        }
      }

      // 1. Verificar cobertura automaticamente (se ainda não foi feito)
      if (mkParams.endereco || session.cpf_cnpj) {
        try {
          const { rows: cobRows } = await query(
            `SELECT dados_saida FROM ai_actions_log
             WHERE session_id = $1 AND acao = 'CONSULTAR_COBERTURA' AND status = 'sucesso'
             ORDER BY created_at DESC LIMIT 1`,
            [sid]
          );
          if (cobRows.length > 0) {
            const cached = cobRows[0].dados_saida;
            const temCobertura = cached.data?.tem_cobertura ?? cached.tem_cobertura;
            if (!temCobertura) {
              console.log('[webhook] NOVO_CONTRATO bloqueado — sem cobertura na região');
              mkResult = {
                success: false,
                data: { _semCobertura: true, mensagem: 'Sem cobertura na região do cliente' },
                tempo_ms: 0, endpoint: 'cobertura-check',
              };
            } else {
              console.log('[webhook] Cobertura confirmada — prosseguindo com contrato');
            }
          }
          // Se não tem cobertura verificada, prossegue mesmo assim (sistema vai tentar)
        } catch (err) {
          console.error('[webhook] Erro ao verificar cobertura antes do contrato:', err.message);
        }
      }

      // 2. Criar pessoa automaticamente se não tem cd_cliente
      if (!mkResult && !session.cd_cliente_mk && session.cpf_cnpj) {
        console.log(`[webhook] NOVO_CONTRATO sem cd_cliente — criando pessoa automaticamente...`);
        try {
          let foneReal = telefone.replace(/\D/g, '');
          if (foneReal.startsWith('55') && foneReal.length >= 12) foneReal = foneReal.substring(2);

          const criarParams = {
            doc: session.cpf_cnpj,
            nome: mkParams.nome || session.nome_cliente || pushName || '',
            fone: foneReal,
            email: mkParams.email || '',
            cep: mkParams.cep || '',
          };

          const criarResult = await n8nExecute({ action: 'CRIAR_PESSOA', params: criarParams, session_id: sid });

          if (criarResult.success && criarResult.data) {
            const cdCliente = criarResult.data.CodigoCliente || criarResult.data.cd_cliente || criarResult.data.Codigo;
            if (cdCliente) {
              await sessionService.update(sid, { cd_cliente_mk: String(cdCliente) });
              session.cd_cliente_mk = String(cdCliente);
              mkParams.cd_cliente = String(cdCliente);
              console.log(`[webhook] Pessoa criada automaticamente: cd_cliente=${cdCliente}`);

              await logger.saveAction({
                session_id: sid, interaction_id: null,
                acao: 'CRIAR_PESSOA', descricao: 'Cadastro automático antes do contrato',
                status: 'sucesso', dados_entrada: criarParams,
                dados_saida: criarResult.data, tempo_ms: criarResult.tempo_ms,
              });
            }
          } else {
            console.error('[webhook] Falha ao criar pessoa:', criarResult.data);
            await logger.saveAction({
              session_id: sid, interaction_id: null,
              acao: 'CRIAR_PESSOA', descricao: 'Cadastro automático falhou',
              status: 'erro', dados_entrada: criarParams,
              dados_saida: criarResult.data, tempo_ms: criarResult.tempo_ms,
            });
            // Bloquear contrato — sem cadastro não dá pra criar
            mkResult = {
              success: false,
              data: { _erroCadastro: true, mensagem: 'Não foi possível criar o cadastro no sistema. Verifique os dados e tente novamente.' },
              tempo_ms: criarResult.tempo_ms, endpoint: 'CRIAR_PESSOA',
            };
          }
        } catch (err) {
          console.error('[webhook] Erro ao criar pessoa antes do contrato:', err.message);
          mkResult = {
            success: false,
            data: { _erroCadastro: true, mensagem: 'Erro ao criar cadastro no sistema.' },
            tempo_ms: 0, endpoint: 'CRIAR_PESSOA',
          };
        }
      }

      // 3. Se ainda não tem cd_cliente após tentativa de criar pessoa, bloquear contrato
      if (!mkResult && !session.cd_cliente_mk) {
        console.log('[webhook] NOVO_CONTRATO bloqueado — sem cd_cliente mesmo após tentativa de cadastro');
        mkResult = {
          success: false,
          data: { _semCadastro: true, mensagem: 'É necessário ter o cadastro completo antes de criar o contrato.' },
          tempo_ms: 0, endpoint: 'NOVO_CONTRATO',
        };
      }
    }

    // NOVO_CONTRATO — preencher parâmetros obrigatórios com defaults
    if (acaoMK === 'NOVO_CONTRATO' && mkParams.codplano) {
      console.log(`[webhook] NOVO_CONTRATO: criando contrato com plano ${mkParams.codplano}...`);

      // Mapear dia de vencimento para código da regra de vencimento
      const REGRAS_VENCIMENTO = {
        '1': 104, '3': 105, '6': 106, '7': 52, '9': 107, '10': 1,
        '12': 108, '15': 103, '20': 2, '27': 53, '29': 54, '30': 3,
      };
      const diaVcto = mkParams.dia_vencimento || '10';
      const codigoRegraVcto = REGRAS_VENCIMENTO[diaVcto] || 1; // default dia 10

      mkParams.CodigoCliente = mkParams.cd_cliente || session.cd_cliente_mk;
      mkParams.CodigoTipoPlano = '1'; // Internet
      mkParams.CodigoPlanoAcesso = String(mkParams.codplano);
      mkParams.CodigoRegraVencimento = String(codigoRegraVcto);
      mkParams.CodigoSLA = '2'; // Pessoa Física
      mkParams.CodigoRegraBloqueio = '1001'; // Redução por inadimplência
      mkParams.CodigoFormaPagamento = '3'; // Boleto
      mkParams.CodigoProfilePagamento = '12'; // SICOOB - Conectiva Internet
      mkParams.CodigoMetodoFaturamento = '1';
      mkParams.CodigoPlanoContas = '7.00.04.00.00'; // Duplicatas serviços prestados
    }

    // CRIAR_PESSOA — preparar dados do novo cadastro
    if (acaoMK === 'CRIAR_PESSOA') {
      console.log(`[webhook] CRIAR_PESSOA: criando cadastro para ${mkParams.doc || session.cpf_cnpj}...`);
      mkParams.doc = mkParams.doc || session.cpf_cnpj;
      mkParams.nome = mkParams.nome || session.nome_cliente || pushName || '';
      // Sempre usar o telefone real do WhatsApp (IA pode enviar texto genérico)
      // Remover código de país 55 se presente (MK espera formato nacional)
      let foneReal = telefone.replace(/\D/g, '');
      if (foneReal.startsWith('55') && foneReal.length >= 12) {
        foneReal = foneReal.substring(2);
      }
      mkParams.fone = foneReal;
    }

    // NOVA_LEAD — preparar dados para não-clientes (não precisa cd_cliente)
    if (acaoMK === 'NOVA_LEAD') {
      console.log(`[webhook] NOVA_LEAD: registrando interesse de ${telefone}...`);
      mkParams.nome = mkParams.nome || session.nome_cliente || pushName || '';
      mkParams.telefone = mkParams.telefone || telefone;
      if (!mkParams.observacao) {
        mkParams.observacao = `Interesse registrado via chat. Canal: ${canal}. Intenção: ${intencao}. Mensagem: ${message}`;
      }
    }

    // ── CONSULTAR_COBERTURA: se já foi feito nesta sessão, pular e sinalizar ──
    if (acaoMK === 'CONSULTAR_COBERTURA' && !mkResult) {
      try {
        const { rows } = await query(
          `SELECT dados_saida FROM ai_actions_log
           WHERE session_id = $1 AND acao = 'CONSULTAR_COBERTURA' AND status = 'sucesso'
           ORDER BY created_at DESC LIMIT 1`,
          [sid]
        );
        if (rows.length > 0 && rows[0].dados_saida) {
          const cached = rows[0].dados_saida;
          const temCobertura = cached.data?.tem_cobertura ?? cached.tem_cobertura;
          console.log(`[webhook] CONSULTAR_COBERTURA já feito — cobertura: ${temCobertura} (pulando)`);

          // Sinalizar que cobertura já foi confirmada — IA deve prosseguir com o fluxo
          mkResult = {
            success: true,
            data: {
              _coberturaJaConfirmada: true,
              tem_cobertura: temCobertura,
              cidade_encontrada: cached.data?.cidade_encontrada || cached.cidade_encontrada,
            },
            tempo_ms: 0,
            endpoint: 'cache',
          };
          // Trocar ação para null — não precisa re-executar
          acaoMK = null;
        }
      } catch (err) {
        console.error('[webhook] Erro ao buscar cobertura em cache:', err.message);
      }
    }

    // ── Executar a ação principal (se não foi resolvida na etapa de dependência) ──
    if (!mkResult) {
      mkResult = await n8nExecute({ action: acaoMK, params: mkParams, session_id: sid });
    }
    tempo_mk_ms = mkResult.tempo_ms;

    emit(EVENTS.MK_RETORNOU, { session_id: sid, success: mkResult.success, acao: acaoMK });
    emitToSession(sid, EVENTS.MK_RETORNOU, { success: mkResult.success, data: mkResult.data });

    // Salvar cd_cliente_mk se veio do MK (CONSULTAR_CLIENTE retorna CodigoPessoa dentro de Outros[])
    if (mkResult.success && mkResult.data && !session.cd_cliente_mk) {
      const { cdCliente, nomeCliente } = extractClientFromMK(mkResult.data);

      if (cdCliente) {
        await sessionService.update(sid, {
          cd_cliente_mk: cdCliente,
          ...(nomeCliente && !session.nome_cliente ? { nome_cliente: nomeCliente } : {}),
        });
        session.cd_cliente_mk = cdCliente;
        if (nomeCliente) session.nome_cliente = nomeCliente;
        console.log(`[webhook] cd_cliente_mk salvo da resposta MK: ${cdCliente}`);
      }
    }

    // ── Encadeamento: após CONSULTAR_CLIENTE com sucesso, executar ação real da intenção ──
    // Se acabamos de identificar o cliente (CONSULTAR_CLIENTE), encadear a ação que o cliente realmente quer
    if (acaoMK === 'CONSULTAR_CLIENTE' && session.cd_cliente_mk && mkResult?.success) {
      const INTENCAO_CHAIN = {
        'SEGUNDA_VIA': 'FATURAS_PENDENTES',
        'FATURAS': 'FATURAS_PENDENTES',
        'NEGOCIACAO': 'FATURAS_PENDENTES',
        'DESBLOQUEIO': 'CONEXOES_CLIENTE',
        'SUPORTE': 'CONEXOES_CLIENTE',
        'CONTRATO': 'CONTRATOS_CLIENTE',
      };
      const acaoChain = INTENCAO_CHAIN[intencao];
      if (acaoChain) {
        console.log(`[webhook] Encadeando: CONSULTAR_CLIENTE → ${acaoChain} (intenção: ${intencao})`);
        const chainParams = { ...paramsMK, cd_cliente: session.cd_cliente_mk, doc: session.cpf_cnpj };
        const chainResult = await n8nExecute({ action: acaoChain, params: chainParams, session_id: sid });

        if (chainResult.success) {
          // Substituir mkResult pelo resultado da ação encadeada
          mkResult = chainResult;
          acaoMK = acaoChain;
          tempo_mk_ms += chainResult.tempo_ms;
          console.log(`[webhook] ${acaoChain} encadeado com sucesso (${chainResult.tempo_ms}ms)`);

          await logger.saveAction({
            session_id: sid, interaction_id: null,
            acao: acaoChain, descricao: `Ação encadeada após CONSULTAR_CLIENTE (intenção: ${intencao})`,
            status: 'sucesso', dados_entrada: chainParams,
            dados_saida: chainResult.data, tempo_ms: chainResult.tempo_ms,
          });

          // ── Sub-encadeamento: SEGUNDA_VIA precisa de cd_fatura (vem de FATURAS_PENDENTES) ──
          if (intencao === 'SEGUNDA_VIA' && acaoChain === 'FATURAS_PENDENTES') {
            const faturas = chainResult.data?.FaturasPendentes || chainResult.data?.data?.FaturasPendentes || chainResult.data?.faturas || [];
            const listaFaturas = Array.isArray(faturas) ? faturas : [faturas];
            if (listaFaturas.length > 0) {
              const cdFatura = listaFaturas[0].codfatura || listaFaturas[0].CodigoFatura || listaFaturas[0].cd_fatura;
              if (cdFatura) {
                console.log(`[webhook] Sub-encadeando: FATURAS_PENDENTES → SEGUNDA_VIA (cd_fatura=${cdFatura})`);
                const segViaResult = await n8nExecute({
                  action: 'SEGUNDA_VIA',
                  params: { cd_fatura: cdFatura, cd_cliente: session.cd_cliente_mk, doc: session.cpf_cnpj },
                  session_id: sid,
                });
                if (segViaResult.success) {
                  mkResult = segViaResult;
                  acaoMK = 'SEGUNDA_VIA';
                  tempo_mk_ms += segViaResult.tempo_ms;
                  console.log(`[webhook] SEGUNDA_VIA sub-encadeado com sucesso (${segViaResult.tempo_ms}ms)`);
                  await logger.saveAction({
                    session_id: sid, interaction_id: null,
                    acao: 'SEGUNDA_VIA', descricao: 'Segunda via gerada após consulta de faturas (sub-encadeamento)',
                    status: 'sucesso', dados_entrada: { cd_fatura: cdFatura },
                    dados_saida: segViaResult.data, tempo_ms: segViaResult.tempo_ms,
                  });
                } else {
                  console.error(`[webhook] SEGUNDA_VIA sub-encadeamento falhou:`, segViaResult.error);
                  // Manter resultado das faturas para a IA poder informar ao cliente
                }
              }
            } else {
              console.log('[webhook] SEGUNDA_VIA: sem faturas pendentes — IA vai informar');
            }
          }
        } else {
          console.error(`[webhook] ${acaoChain} encadeado falhou:`, chainResult.error);
        }
      }
    }

    // Se CONSULTAR_CLIENTE não encontrou o cliente
    if (acaoMK === 'CONSULTAR_CLIENTE' && mkResult?.success && mkResult.data && !session.cd_cliente_mk) {
      console.log(`[webhook] CONSULTAR_CLIENTE: cliente não encontrado para CPF ${session.cpf_cnpj}`);

      const isFluxoVendaConsulta = ['CONTRATO', 'VIABILIDADE'].includes(intencao);

      if (isFluxoVendaConsulta) {
        // ── FLUXO DE VENDA: NÃO criar lead — IA vai tentar vender primeiro ──
        console.log(`[webhook] Cliente não cadastrado (CONSULTAR_CLIENTE) com intenção de venda — IA vai conduzir`);
        mkResult._clienteNaoEncontrado = true;
        mkResult.data._fluxoVenda = true;
      } else {
        // ── FLUXO PADRÃO: criar lead e informar ──
        try {
          const leadResult = await n8nExecute({
            action: 'NOVA_LEAD',
            params: {
              nome: session.nome_cliente || pushName || '',
              telefone: telefone,
              observacao: `Novo contato não cadastrado. CPF/CNPJ: ${session.cpf_cnpj}. Canal: ${canal}. Intenção: ${intencao}`,
            },
            session_id: sid,
          });
          await logger.saveAction({
            session_id: sid, interaction_id: null,
            acao: 'NOVA_LEAD', descricao: 'Cliente não cadastrado — lead criada (via CONSULTAR_CLIENTE direto)',
            status: leadResult.success ? 'sucesso' : 'erro',
            dados_entrada: { cpf: session.cpf_cnpj, telefone },
            dados_saida: leadResult.data, tempo_ms: leadResult.tempo_ms,
          });
        } catch (leadErr) {
          console.error('[webhook] Erro ao criar lead:', leadErr.message);
        }

        // Notificar grupo de atendentes (best-effort)
        notifyNewLead({ session, intencao, mensagem: message }).catch(() => {});

        // Override: substituir resposta padrão por mensagem de cliente não encontrado
        mkResult._clienteNaoEncontrado = true;
      }
    }
  }

  // 8.5. Se intenção é NEGOCIACAO e temos faturas, aplicar regras de negociação
  let negociacao = null;
  if (intencao === 'NEGOCIACAO' && mkResult?.success && mkResult.data) {
    try {
      const faturas = mkResult.data.FaturasPendentes || mkResult.data.faturas || mkResult.data.Faturas || [];
      negociacao = await analisarNegociacao(faturas);
      console.log('[webhook] Negociação:', { tipo: negociacao.tipo, faturas: faturas.length });

      if (negociacao.tipo === 'escalonar_humano') {
        // Forçar escalonamento
        classification.intencao = 'HUMANO';
      }
    } catch (err) {
      console.error('[webhook] Erro na negociação:', err.message);
    }
  }

  // 8.55. AC4: Se intenção é CADASTRO e cliente quer atualizar dados, registrar solicitação no MK
  let cadastroAtualizado = null;
  if (intencao === 'CADASTRO' && session.cd_cliente_mk) {
    try {
      // Se o MK retornou dados do cliente (consulta), guardar para referência
      if (mkResult?.success && mkResult.data) {
        const clienteData = mkResult.data;
        // Atualizar nome do cliente na sessão se disponível
        const nomeMK = clienteData.NomeCliente || clienteData.nome_cliente || clienteData.RazaoSocial;
        if (nomeMK && !session.nome_cliente) {
          await sessionService.update(sid, { nome_cliente: nomeMK });
        }
      }

      // Se a IA detectou que o cliente quer ATUALIZAR dados (acaoMK = ATUALIZAR_CADASTRO),
      // registrar uma lead/atendimento no MK para a equipe processar
      if (acaoMK === 'ATUALIZAR_CADASTRO') {
        const updateResult = await n8nExecute({
          action: 'ATUALIZAR_CADASTRO',
          params: {
            cd_cliente: session.cd_cliente_mk,
            tipo_atendimento: 'ATUALIZACAO_CADASTRO',
            descricao: `Solicitação de atualização cadastral via chat. Mensagem do cliente: ${message}`,
            telefone: telefone,
            observacao: paramsMK?.observacao || '',
          },
          session_id: sid,
        });

        cadastroAtualizado = updateResult;
        console.log('[webhook] Cadastro atualização:', { success: updateResult.success });

        await logger.saveAction({
          session_id: sid, interaction_id: null,
          acao: 'ATUALIZAR_CADASTRO', descricao: 'Solicitação de atualização cadastral registrada no MK',
          status: updateResult.success ? 'sucesso' : 'erro',
          dados_entrada: { cd_cliente: session.cd_cliente_mk, mensagem: message },
          dados_saida: updateResult.data, tempo_ms: updateResult.tempo_ms,
        });
      }
    } catch (err) {
      console.error('[webhook] Erro no cadastro:', err.message);
    }
  }

  // 8.6. AC1: Se intenção é SEGUNDA_VIA e MK retornou boleto, preparar envio do documento
  let boletoEnviado = false;
  let boletoData = null;
  if (intencao === 'SEGUNDA_VIA' && mkResult?.success && mkResult.data) {
    try {
      boletoData = {
        linhaDigitavel: mkResult.data.LinhaDigitavel || mkResult.data.linha_digitavel || mkResult.data.linhaDigitavel,
        codigoBarras: mkResult.data.CodigoBarras || mkResult.data.codigo_barras || mkResult.data.codigoBarras,
        urlBoleto: mkResult.data.UrlBoleto || mkResult.data.url_boleto || mkResult.data.urlBoleto || mkResult.data.LinkBoleto || mkResult.data.link_boleto,
        valor: mkResult.data.ValorDocumento || mkResult.data.valor_documento || mkResult.data.valor,
        vencimento: mkResult.data.DataVencimento || mkResult.data.data_vencimento || mkResult.data.vencimento,
        cd_fatura: mkResult.data.CodigoFatura || mkResult.data.cd_fatura || mkResult.data.codigo_fatura,
      };
      console.log('[webhook] Boleto preparado:', { cd_fatura: boletoData.cd_fatura, temURL: !!boletoData.urlBoleto, temLinha: !!boletoData.linhaDigitavel });

      // Tentar gerar PIX Copia e Cola (complementar ao boleto)
      if (session.cpf_cnpj && (boletoData.cd_fatura || mkParams.cd_fatura)) {
        try {
          const pixResult = await n8nExecute({
            action: 'GERAR_PIX',
            params: {
              doc: session.cpf_cnpj,
              cd_fatura: boletoData.cd_fatura || mkParams.cd_fatura,
              cd_cliente: session.cd_cliente_mk,
            },
            session_id: sid,
          });
          if (pixResult.success && pixResult.data?.texto_qrcode) {
            boletoData.pixCopiaECola = pixResult.data.texto_qrcode;
            console.log('[webhook] PIX Copia e Cola gerado com sucesso');
            await logger.saveAction({
              session_id: sid, interaction_id: null,
              acao: 'GERAR_PIX', descricao: 'PIX Copia e Cola gerado para a fatura',
              status: 'sucesso',
              dados_entrada: { cd_fatura: boletoData.cd_fatura },
              dados_saida: { temPix: true },
              tempo_ms: pixResult.tempo_ms,
            });
          }
        } catch (pixErr) {
          console.error('[webhook] Erro ao gerar PIX (não crítico):', pixErr.message);
        }
      }
    } catch (err) {
      console.error('[webhook] Erro ao extrair dados do boleto:', err.message);
    }
  }

  // 8.7. AC2: Se intenção é SUPORTE e temos dados de conexão, gerar diagnóstico técnico
  let diagnostico = null;
  if (intencao === 'SUPORTE' && mkResult?.success && mkResult.data) {
    try {
      const dadosConexao = mkResult.data.Conexoes || mkResult.data.conexoes || mkResult.data;
      diagnostico = await generateDiagnostic({
        problema: message,
        dadosConexao,
      });
      console.log('[webhook] Diagnóstico técnico gerado');

      // Logar ação do diagnóstico
      await logger.saveAction({
        session_id: sid, interaction_id: null,
        acao: 'DIAGNOSTICO_TECNICO', descricao: 'IA gerou diagnóstico técnico para o problema',
        status: 'sucesso', dados_entrada: { problema: message },
        dados_saida: { diagnostico: diagnostico.substring(0, 500) }, tempo_ms: 0,
      });
    } catch (err) {
      console.error('[webhook] Erro no diagnóstico:', err.message);
    }
  }

  // 8.8. Se intenção é VIABILIDADE e MK retornou regiões, a IA vai comparar com o endereço do cliente
  // A formatResponse() já recebe os dados do MK e o histórico — ela saberá formatar a resposta de cobertura

  // 8.9. Se NOVO_CONTRATO foi executado, logar e notificar
  let contratoCriado = null;
  if (acaoMK === 'NOVO_CONTRATO' && mkResult?.success && mkResult.data) {
    try {
      contratoCriado = mkResult.data;
      const codContrato = contratoCriado.CodigoContrato || contratoCriado.codigo_contrato || contratoCriado.Codigo || '';
      console.log('[webhook] Contrato criado:', { codContrato, codplano: paramsMK?.codplano });

      await logger.saveAction({
        session_id: sid, interaction_id: null,
        acao: 'NOVO_CONTRATO', descricao: `Contrato criado para plano ${paramsMK?.codplano}`,
        status: 'sucesso',
        dados_entrada: { cd_cliente: session.cd_cliente_mk, codplano: paramsMK?.codplano },
        dados_saida: contratoCriado, tempo_ms: mkResult.tempo_ms,
      });

      await logger.saveInteraction({
        session_id: sid, intencao, confianca, mensagem_cliente: message,
        resposta_ia: '', acao_mk: 'NOVO_CONTRATO', mk_endpoint: mkResult.endpoint,
        mk_sucesso: true, mk_resposta: contratoCriado,
        status: 'contrato_criado', tempo_ia_ms, tempo_mk_ms: mkResult.tempo_ms,
        tempo_total_ms: Date.now() - totalStart, contrato_criado: true,
      });

      // Notificar grupo de atendentes sobre a nova venda (best-effort)
      const PLANOS_MAP = { '2153': '400 MB', '1326': '600 MB', '1320': '800 MB', '1327': '1 GB' };
      const planoNome = PLANOS_MAP[String(paramsMK?.codplano)] || `Plano ${paramsMK?.codplano}`;
      notifyNewSale({ session, contrato: contratoCriado, plano: planoNome }).catch(() => {});
    } catch (err) {
      console.error('[webhook] Erro ao logar contrato criado:', err.message);
    }
  }

  // 8.10. Se CRIAR_PESSOA foi executado, logar resultado
  let pessoaCriada = null;
  if (acaoMK === 'CRIAR_PESSOA' && mkResult?.success && mkResult.data) {
    try {
      pessoaCriada = mkResult.data;
      const cdCliente = pessoaCriada.CodigoCliente || pessoaCriada.cd_cliente || pessoaCriada.Codigo;
      console.log('[webhook] Pessoa criada:', { cdCliente });

      if (cdCliente) {
        await sessionService.update(sid, { cd_cliente_mk: String(cdCliente) });
        session.cd_cliente_mk = String(cdCliente);
      }

      await logger.saveAction({
        session_id: sid, interaction_id: null,
        acao: 'CRIAR_PESSOA', descricao: 'Cadastro de pessoa criado no MK',
        status: 'sucesso',
        dados_entrada: { doc: paramsMK?.doc, nome: paramsMK?.nome },
        dados_saida: pessoaCriada, tempo_ms: mkResult.tempo_ms,
      });
    } catch (err) {
      console.error('[webhook] Erro ao logar pessoa criada:', err.message);
    }
  }

  // 8.11. Se NOVA_LEAD foi executada (ação explícita da IA), logar e notificar
  let leadCriada = null;
  if (acaoMK === 'NOVA_LEAD' && mkResult?.success && mkResult.data) {
    try {
      leadCriada = mkResult.data;
      console.log('[webhook] Lead criada (explícita):', { telefone, nome: paramsMK?.nome });

      await logger.saveAction({
        session_id: sid, interaction_id: null,
        acao: 'NOVA_LEAD', descricao: 'Lead criada pela IA para registro de interesse',
        status: 'sucesso',
        dados_entrada: { nome: paramsMK?.nome, telefone, observacao: paramsMK?.observacao },
        dados_saida: leadCriada, tempo_ms: mkResult.tempo_ms,
      });

      // Notificar grupo de atendentes
      notifyNewLead({ session, intencao, mensagem: message }).catch(() => {});
    } catch (err) {
      console.error('[webhook] Erro ao logar lead criada:', err.message);
    }
  }

  // 9. Formatar resposta final
  let resposta;
  if (mkResult?.data?._fluxoVenda && mkResult?._clienteNaoEncontrado) {
    // ── FLUXO DE VENDA: cliente não cadastrado — IA vai conduzir a venda ──
    // Usar formatResponse para a IA gerar resposta natural guiando o cadastro/venda
    resposta = await formatResponse({
      intencao,
      mkData: { _clienteNaoEncontrado: true, _fluxoVenda: true },
      session,
      historico,
    });
  } else if (mkResult?._clienteNaoEncontrado) {
    // Cliente não encontrado no MK (intenção NÃO é venda) — lead já foi criada acima
    resposta =
      `Não encontrei um cadastro no nosso sistema com o CPF informado 🤔\n\n` +
      `Mas não se preocupe! Já registrei seu contato e *nossa equipe vai entrar em contato* com você para te ajudar! 😊` +
      `\n\nSe preferir atendimento presencial:\n` +
      `📍 *Matozinhos*: R. José Dias Corrêa, 87A — Centro\n` +
      `📍 *Lagoa Santa*: R. Aleomar Baleeiro, 462 — Centro\n` +
      `📍 *Prudente de Morais*: R. José de Souza, 83A — Centro\n\n` +
      `Ou ligue: ☎️ *(31) 3712-1294* ou *(31) 3268-4691*`;
  } else if (negociacao && negociacao.mensagem) {
    // Usa mensagem da negociação (desconto/parcelas calculados)
    resposta = negociacao.mensagem;
  } else if (diagnostico) {
    // AC2: Usa diagnóstico técnico gerado pela IA
    resposta = diagnostico;
  } else if (cadastroAtualizado?.success) {
    // AC4: Confirmação de solicitação de atualização cadastral
    const protocolo = cadastroAtualizado.data?.protocolo || cadastroAtualizado.data?.CodigoLead || '';
    resposta = `Pronto! Registrei sua solicitação de atualização cadastral ✅${protocolo ? `\n📋 *Protocolo:* ${protocolo}` : ''}\nNossa equipe vai processar a alteração e se precisar, entra em contato pra confirmar.\nPosso te ajudar em mais alguma coisa?`;
  } else if (acaoMK && mkResult?.success) {
    // Enriquecer mkData com dados extras (boleto/PIX, contrato, lead, pessoa)
    const enrichedMkData = { ...mkResult.data };
    if (boletoData) enrichedMkData._boleto = boletoData;
    if (contratoCriado) enrichedMkData._contratoCriado = contratoCriado;
    if (pessoaCriada) enrichedMkData._pessoaCriada = pessoaCriada;
    if (leadCriada) enrichedMkData._leadCriada = leadCriada;
    resposta = await formatResponse({ intencao, mkData: enrichedMkData, session, historico });
  } else if (acaoMK && !mkResult?.success && mkResult?.data?._erroCadastro) {
    // Erro específico ao criar cadastro — usar IA para formatar resposta
    resposta = await formatResponse({ intencao, mkData: mkResult.data, session, historico });
  } else if (acaoMK && !mkResult?.success && mkResult?.data?._semCobertura) {
    // Sem cobertura na região — usar IA para formatar resposta
    resposta = await formatResponse({ intencao, mkData: { tem_cobertura: false, ...mkResult.data }, session, historico });
  } else if (acaoMK && !mkResult?.success) {
    resposta = 'Poxa, deu um probleminha pra consultar seus dados no sistema 😔 Vou te passar pra um colega da equipe resolver isso pra você! Só um minutinho 🙏';
    // Forçar escalonamento quando MK falha
    classification.intencao = 'HUMANO';
  } else {
    resposta = respostaSugerida || 'Me conta, como posso te ajudar? 😊';
  }

  // 10. Enviar resposta
  await replyFn(telefone, resposta);

  // 10.1. AC1: Enviar boleto como documento no WhatsApp (após a resposta de texto)
  if (boletoData && canal === 'whatsapp') {
    try {
      // Enviar PDF do boleto se tiver URL
      if (boletoData.urlBoleto) {
        const caption = `Boleto - Fatura ${boletoData.cd_fatura || ''} - Vencimento: ${boletoData.vencimento || 'N/A'}`;
        await sendDocument(telefone, boletoData.urlBoleto, `boleto_${boletoData.cd_fatura || 'conectiva'}.pdf`, caption);
        boletoEnviado = true;
        console.log('[webhook] Boleto PDF enviado via WhatsApp');
      }

      // Enviar linha digitável como texto separado para fácil cópia
      if (boletoData.linhaDigitavel) {
        const msgLinha = `📋 *Linha digitável para pagamento:*\n\n${boletoData.linhaDigitavel}\n\nVocê pode copiar e colar no app do seu banco.`;
        await sendText(telefone, msgLinha);
        boletoEnviado = true;
        console.log('[webhook] Linha digitável enviada via WhatsApp');
      }

      // Logar ação do envio do boleto
      if (boletoEnviado) {
        await logger.saveAction({
          session_id: sid, interaction_id: null,
          acao: 'ENVIO_BOLETO', descricao: 'Boleto enviado ao cliente via WhatsApp',
          status: 'sucesso',
          dados_entrada: { cd_fatura: boletoData.cd_fatura },
          dados_saida: { urlEnviada: !!boletoData.urlBoleto, linhaEnviada: !!boletoData.linhaDigitavel },
          tempo_ms: 0,
        });
      }
    } catch (err) {
      console.error('[webhook] Erro ao enviar boleto WhatsApp:', err.message);
      await logger.saveAction({
        session_id: sid, interaction_id: null,
        acao: 'ENVIO_BOLETO', descricao: 'Falha ao enviar boleto via WhatsApp',
        status: 'erro', dados_entrada: { cd_fatura: boletoData.cd_fatura },
        dados_saida: { error: err.message }, tempo_ms: 0,
      });
    }
  }

  // 11. Gravar logs completos
  await logger.saveMessage({ session_id: sid, direcao: 'saida', conteudo: resposta, canal });

  const tempo_total_ms = Date.now() - totalStart;

  const interaction = await logger.saveInteraction({
    session_id: sid, intencao, confianca, mensagem_cliente: message, resposta_ia: resposta,
    acao_mk: acaoMK, mk_endpoint: mkResult?.endpoint,
    mk_sucesso: mkResult?.success ?? null, mk_resposta: mkResult?.data,
    status: intencao === 'HUMANO' ? 'escalonado' : 'sucesso',
    tempo_ia_ms, tempo_mk_ms, tempo_total_ms,
    boleto_gerado: intencao === 'SEGUNDA_VIA' && mkResult?.success && boletoEnviado,
    desbloqueio_executado: intencao === 'DESBLOQUEIO' && mkResult?.success,
    contrato_criado: !!contratoCriado,
  });

  if (acaoMK) {
    await logger.saveAction({
      session_id: sid, interaction_id: interaction.id,
      acao: acaoMK, descricao: `Chamada n8n: ${acaoMK}`,
      status: mkResult.success ? 'sucesso' : 'erro',
      dados_entrada: paramsMK, dados_saida: mkResult.data, tempo_ms: tempo_mk_ms,
    });
  }

  // 12. Emitir resposta_enviada
  emit(EVENTS.RESPOSTA_ENVIADA, { session_id: sid, intencao, resposta, tempo_total_ms });
  emitToSession(sid, EVENTS.RESPOSTA_ENVIADA, { resposta, direcao: 'saida' });

  // 12.5. CSAT: NÃO enviar aqui — o cliente pode ter mais dúvidas na mesma sessão.
  // A pesquisa de satisfação é enviada APENAS quando:
  // - A sessão EXPIRA por inatividade (30min sem mensagem) → via expireStale() em session.js
  // - O atendente fecha manualmente pelo dashboard → via POST /api/sessions/:id/close

  // 13. Escalonamento se HUMANO
  if (intencao === 'HUMANO') {
    await sessionService.update(sid, { status: 'aguardando_humano' });
    const escalation = await logger.saveEscalation({
      session_id: sid,
      motivo: confianca < 0.7 ? 'Confiança baixa na classificação' : 'Cliente solicitou atendente humano',
      prioridade: confianca < 0.5 ? 'alta' : 'media',
      historico_conversa: historico,
      dados_cliente: { telefone, nome: session.nome_cliente, cpf: session.cpf_cnpj },
    });
    const escMotivo = escalation.motivo;
    emit(EVENTS.ESCALONAMENTO, {
      session_id: sid,
      escalation_id: escalation.id,
      motivo: escMotivo,
      prioridade: escalation.prioridade,
      cliente: session.nome_cliente || 'Não identificado',
      telefone,
      canal,
    });
    emitToSession(sid, EVENTS.ESCALONAMENTO, { motivo: escMotivo });

    // Notificar grupo WhatsApp dos atendentes (best-effort)
    notifyEscalation({ session, escalation, motivo: escMotivo }).catch(() => {});
  }
}

// ── Respostas para tipos de mídia ─────────────────────────
const MEDIA_RESPONSES = {
  video: '🎥 Recebi seu vídeo! No momento não consigo assistir vídeos, mas ficarei feliz em te ajudar por texto. Qual a sua solicitação? 😊',
  sticker: '', // Figurinhas são ignoradas silenciosamente
};

// --- POST /webhook/whatsapp ---
router.post('/webhook/whatsapp', async (req, res) => {
  try {
    // Normalizar para extrair dados (incluindo campos de mídia para áudio)
    const { from, message, pushName, fromMe, messageType, isIgnored, mediaUrl, mediaMimetype, mediaFilename, mediaBase64, mediaKey, fileSHA256, fileLength, messageId } = normalizeChannel(req.body, 'whatsapp');

    // Ignorar mensagens enviadas pela própria IA
    if (fromMe) {
      return res.json({ success: true });
    }

    // Ignorar tipos que não precisam de resposta (reações, recibos, etc.)
    if (isIgnored) {
      console.log(`[webhook] Ignorando tipo: ${messageType}`);
      return res.json({ success: true });
    }

    const telefone = formatPhone(from);

    // Tratar mensagens de mídia (áudio, imagem, vídeo, documento, sticker)
    if (messageType !== 'text' && messageType !== 'unknown') {

      // ── ÁUDIO: transcrever com Whisper ──
      if (messageType === 'audio') {
        console.log(`[webhook] Áudio recebido de ${telefone}`, { mediaUrl: mediaUrl?.substring(0, 150), mediaMimetype, mediaFilename });

        try {
          // Obter/criar sessão para emitir eventos WS e salvar mensagens
          const session = await sessionService.findOrCreate({ telefone, canal: 'whatsapp', pushName });
          const sid = session.id;

          // Salvar mensagem de entrada (áudio) no banco — base64 será atualizado após download
          const audioMsg = await logger.saveMessage({ session_id: sid, direcao: 'entrada', conteudo: '🎤 [Áudio]', canal: 'whatsapp' });
          // Emitir evento para o dashboard atualizar em tempo real
          emit(EVENTS.NOVA_MENSAGEM, { session_id: sid, message: '🎤 [Áudio]', telefone, canal: 'whatsapp' });
          emitToSession(sid, EVENTS.NOVA_MENSAGEM, { session_id: sid, message: '🎤 [Áudio]', direcao: 'entrada' });

          emit(EVENTS.TRANSCREVENDO_AUDIO, { session_id: sid, telefone });
          emitToSession(sid, EVENTS.TRANSCREVENDO_AUDIO, { telefone });

          // Tentar transcrever: 1) via Uazapi /message/download, 2) via URL direta, 3) via base64
          let result = null;
          let audioBase64ForDashboard = null; // Guardar base64 para o player no dashboard

          // 1) Download via Uazapi /message/download (método principal — usa messageId)
          if (messageId) {
            console.log(`[webhook] Tentando download via Uazapi /message/download... (messageId: ${messageId})`);
            const dl = await downloadMedia({ messageId });
            if (dl.success && dl.buffer && dl.buffer.length > 100) {
              audioBase64ForDashboard = dl.buffer.toString('base64');
              result = await transcribeAudioBuffer(dl.buffer, mediaMimetype, mediaFilename);
            } else {
              console.log(`[webhook] Download Uazapi falhou: ${dl.error}`);
            }
          } else {
            console.log(`[webhook] Sem messageId para download via Uazapi`);
          }

          // 2) Fallback: URL direta (apenas se não for criptografada)
          if (!result && mediaUrl && !mediaUrl.includes('.enc')) {
            console.log(`[webhook] Tentando URL direta...`);
            result = await transcribeAudio(mediaUrl, mediaMimetype, mediaFilename);
          }

          // 3) Base64 como fallback final
          if (!result && mediaBase64) {
            console.log(`[webhook] Tentando via base64 (${mediaBase64.length} chars)`);
            result = await transcribeAudioBase64(mediaBase64, mediaMimetype, mediaFilename);
          }

          if (!result && !messageId && !mediaUrl && !mediaBase64) {
            console.log(`[webhook] Áudio sem messageId, sem mediaUrl e sem base64 de ${telefone}`);
          }

          // Atualizar mensagem de áudio com base64 para player no dashboard
          if (audioBase64ForDashboard && audioMsg?.id) {
            const mime = (mediaMimetype || 'audio/ogg').split(';')[0].trim();
            await query(
              `UPDATE messages SET metadata = $1 WHERE id = $2`,
              [JSON.stringify({ type: 'audio', audio_base64: audioBase64ForDashboard, mimetype: mime }), audioMsg.id]
            );
          }

          if (result) {
            // Logar tentativa de transcrição
            await logger.saveAction({
              session_id: sid,
              interaction_id: null,
              acao: 'TRANSCRICAO_AUDIO',
              descricao: result.success
                ? `Áudio transcrito: "${result.text?.substring(0, 100)}"`
                : `Falha na transcrição: ${result.error}`,
              status: result.success ? 'sucesso' : 'erro',
              dados_entrada: { mediaUrl: mediaUrl?.substring(0, 200), mediaMimetype, hasBase64: !!mediaBase64 },
              dados_saida: result.success ? { texto: result.text } : { error: result.error },
              tempo_ms: result.tempo_ms || 0,
            });

            if (result.success && result.text) {
              // SUCESSO: alimentar texto transcrito no pipeline normal (processMessage vai salvar interação)
              console.log(`[webhook] Áudio transcrito, processando: "${result.text.substring(0, 80)}"`);
              bufferMessage(telefone, result.text, 'whatsapp', pushName, sendText);
              return res.json({ success: true });
            }
          }

          // FALLBACK: não conseguiu transcrever (sem URL ou Whisper falhou)
          console.log(`[webhook] Não foi possível transcrever áudio de ${telefone}`);
          const fallbackMsg = '🎤 Recebi seu áudio, mas não consegui entendê-lo no momento. Poderia digitar sua mensagem, por favor? 😊';
          await sendText(telefone, fallbackMsg);

          // Salvar resposta do fallback no banco
          await logger.saveMessage({ session_id: sid, direcao: 'saida', conteudo: fallbackMsg, canal: 'whatsapp' });
          emit(EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: fallbackMsg });
          emitToSession(sid, EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: fallbackMsg, direcao: 'saida' });

          // Se o áudio tinha caption, processar
          if (message && message.trim()) {
            bufferMessage(telefone, message, 'whatsapp', pushName, sendText);
          }
        } catch (audioErr) {
          console.error('[webhook] Erro ao processar áudio:', audioErr.message, audioErr.stack);
          // Fallback seguro
          await sendText(telefone, '🎤 Opa, não consegui ouvir seu áudio direito! Pode digitar pra mim o que você precisa? 😊').catch(() => {});
        }

        return res.json({ success: true });
      }

      // ── IMAGEM: analisar com GPT-4o Vision ──
      if (messageType === 'image') {
        console.log(`[webhook] Imagem recebida de ${telefone}`, { mediaUrl: mediaUrl?.substring(0, 150), mediaMimetype, messageId });

        try {
          const session = await sessionService.findOrCreate({ telefone, canal: 'whatsapp', pushName });
          const sid = session.id;

          // Salvar mensagem de entrada (imagem)
          const imgMsg = await logger.saveMessage({ session_id: sid, direcao: 'entrada', conteudo: '📷 [Imagem]', canal: 'whatsapp' });
          emit(EVENTS.NOVA_MENSAGEM, { session_id: sid, message: '📷 [Imagem]', telefone, canal: 'whatsapp' });
          emitToSession(sid, EVENTS.NOVA_MENSAGEM, { session_id: sid, message: '📷 [Imagem]', direcao: 'entrada' });

          emit(EVENTS.ANALISANDO_MIDIA, { session_id: sid, telefone, tipo: 'image' });
          emitToSession(sid, EVENTS.ANALISANDO_MIDIA, { telefone, tipo: 'image' });

          let imageBase64 = null;
          let result = null;

          // 1) Download via Uazapi /message/download
          if (messageId) {
            console.log(`[webhook] Baixando imagem via Uazapi (messageId: ${messageId})`);
            const dl = await downloadMedia({ messageId });
            if (dl.success && dl.buffer && dl.buffer.length > 100) {
              imageBase64 = dl.buffer.toString('base64');
            } else {
              console.log(`[webhook] Download imagem falhou: ${dl.error}`);
            }
          }

          // 2) Fallback: base64 direto do payload
          if (!imageBase64 && mediaBase64) {
            imageBase64 = mediaBase64;
          }

          // Analisar com GPT-4o Vision
          if (imageBase64) {
            result = await analyzeImage(imageBase64, mediaMimetype, message);

            // Salvar imagem no metadata (até 2MB base64 — cobre maioria das imagens WhatsApp)
            const thumbBase64 = imageBase64.length <= 2 * 1024 * 1024 ? imageBase64 : null;
            const mimeImg = (mediaMimetype || 'image/jpeg').split(';')[0].trim();
            if (imgMsg?.id) {
              const metadataObj = {
                type: 'image',
                mimetype: mimeImg,
                ...(thumbBase64 ? { image_base64: thumbBase64 } : {}),
              };
              await query(
                `UPDATE messages SET metadata = $1 WHERE id = $2`,
                [JSON.stringify(metadataObj), imgMsg.id]
              );
              // Emitir atualização para o dashboard atualizar em tempo real
              emitToSession(sid, EVENTS.MENSAGEM_ATUALIZADA, {
                session_id: sid,
                message_id: imgMsg.id,
                metadata: metadataObj,
              });
            }

            // Logar ação
            await logger.saveAction({
              session_id: sid, interaction_id: null,
              acao: 'ANALISE_IMAGEM',
              descricao: result.success
                ? `Imagem analisada: "${result.text?.substring(0, 100)}"`
                : `Falha na análise: ${result.error}`,
              status: result.success ? 'sucesso' : 'erro',
              dados_entrada: { mediaMimetype, hasCaption: !!message },
              dados_saida: result.success ? { texto: result.text?.substring(0, 500) } : { error: result.error },
              tempo_ms: result.tempo_ms || 0,
            });
          }

          if (result?.success && result.text) {
            // Alimentar análise no pipeline normal
            const analysisText = message?.trim()
              ? `${message}\n\n[Análise da imagem: ${result.text}]`
              : `[Análise da imagem: ${result.text}]`;
            console.log(`[webhook] Imagem analisada, processando: "${analysisText.substring(0, 100)}"`);
            bufferMessage(telefone, analysisText, 'whatsapp', pushName, sendText);
          } else {
            // Fallback: não conseguiu analisar
            console.log(`[webhook] Não foi possível analisar imagem de ${telefone}`);
            const fallbackMsg = '📷 Recebi sua imagem, mas não consegui analisá-la no momento. Poderia descrever o que você precisa por texto? 😊';
            await sendText(telefone, fallbackMsg);
            await logger.saveMessage({ session_id: sid, direcao: 'saida', conteudo: fallbackMsg, canal: 'whatsapp' });
            emit(EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: fallbackMsg });
            emitToSession(sid, EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: fallbackMsg, direcao: 'saida' });

            // Se a imagem tinha caption, processar o texto
            if (message?.trim()) {
              bufferMessage(telefone, message, 'whatsapp', pushName, sendText);
            }
          }
        } catch (imgErr) {
          console.error('[webhook] Erro ao processar imagem:', imgErr.message, imgErr.stack);
          await sendText(telefone, '📷 Não consegui abrir sua imagem aqui! Pode me descrever por texto o que precisa? 😊').catch(() => {});
        }

        return res.json({ success: true });
      }

      // ── DOCUMENTO: analisar com GPT-4o Vision ──
      if (messageType === 'document') {
        console.log(`[webhook] Documento recebido de ${telefone}`, { mediaUrl: mediaUrl?.substring(0, 150), mediaMimetype, mediaFilename, messageId });

        try {
          const session = await sessionService.findOrCreate({ telefone, canal: 'whatsapp', pushName });
          const sid = session.id;

          // Salvar mensagem de entrada (documento)
          const docDisplayName = mediaFilename || 'documento';
          const docMsg = await logger.saveMessage({ session_id: sid, direcao: 'entrada', conteudo: `📄 [Documento: ${docDisplayName}]`, canal: 'whatsapp' });
          emit(EVENTS.NOVA_MENSAGEM, { session_id: sid, message: `📄 [Documento: ${docDisplayName}]`, telefone, canal: 'whatsapp' });
          emitToSession(sid, EVENTS.NOVA_MENSAGEM, { session_id: sid, message: `📄 [Documento: ${docDisplayName}]`, direcao: 'entrada' });

          emit(EVENTS.ANALISANDO_MIDIA, { session_id: sid, telefone, tipo: 'document' });
          emitToSession(sid, EVENTS.ANALISANDO_MIDIA, { telefone, tipo: 'document' });

          let docBase64 = null;
          let result = null;

          // 1) Download via Uazapi /message/download
          if (messageId) {
            console.log(`[webhook] Baixando documento via Uazapi (messageId: ${messageId})`);
            const dl = await downloadMedia({ messageId });
            if (dl.success && dl.buffer && dl.buffer.length > 100) {
              docBase64 = dl.buffer.toString('base64');
            } else {
              console.log(`[webhook] Download documento falhou: ${dl.error}`);
            }
          }

          // 2) Fallback: base64 direto do payload
          if (!docBase64 && mediaBase64) {
            docBase64 = mediaBase64;
          }

          // Verificar tipo antes de analisar
          const mimeDoc = (mediaMimetype || '').split(';')[0].trim().toLowerCase();
          const extDoc = mediaFilename?.split('.').pop()?.toLowerCase() || '';
          const unsupportedExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar'];

          if (unsupportedExts.includes(extDoc)) {
            const unsupportedMsg = `📄 Recebi seu arquivo *${docDisplayName}*, mas infelizmente não consigo ler arquivos *.${extDoc}*. Poderia enviar como *PDF*, por favor? 😊`;
            await sendText(telefone, unsupportedMsg);
            await logger.saveMessage({ session_id: sid, direcao: 'saida', conteudo: unsupportedMsg, canal: 'whatsapp' });

            if (docMsg?.id) {
              const unsupMetadata = { type: 'document', filename: mediaFilename, mimetype: mimeDoc };
              await query(
                `UPDATE messages SET metadata = $1 WHERE id = $2`,
                [JSON.stringify(unsupMetadata), docMsg.id]
              );
              emitToSession(sid, EVENTS.MENSAGEM_ATUALIZADA, {
                session_id: sid, message_id: docMsg.id, metadata: unsupMetadata,
              });
            }

            emit(EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: unsupportedMsg });
            emitToSession(sid, EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: unsupportedMsg, direcao: 'saida' });
            return res.json({ success: true });
          }

          // Analisar com GPT-4o
          if (docBase64) {
            result = await analyzeDocument(docBase64, mediaMimetype, mediaFilename, message);

            // Salvar metadata do documento (com base64 para PDFs até 5MB para visualização no dashboard)
            const docBase64ForDash = (mimeDoc === 'application/pdf' && docBase64.length <= 5 * 1024 * 1024) ? docBase64 : null;
            if (docMsg?.id) {
              const docMetadata = {
                type: 'document',
                filename: mediaFilename,
                mimetype: mimeDoc,
                ...(docBase64ForDash ? { doc_base64: docBase64ForDash } : {}),
              };
              await query(
                `UPDATE messages SET metadata = $1 WHERE id = $2`,
                [JSON.stringify(docMetadata), docMsg.id]
              );
              // Emitir atualização para o dashboard atualizar em tempo real
              emitToSession(sid, EVENTS.MENSAGEM_ATUALIZADA, {
                session_id: sid,
                message_id: docMsg.id,
                metadata: { type: 'document', filename: mediaFilename, mimetype: mimeDoc },
              });
            }

            // Se o tipo não é suportado (retornado pelo vision.js)
            if (!result.success && result.unsupported) {
              const unsupportedMsg = `📄 ${result.error}`;
              await sendText(telefone, unsupportedMsg);
              await logger.saveMessage({ session_id: sid, direcao: 'saida', conteudo: unsupportedMsg, canal: 'whatsapp' });
              emit(EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: unsupportedMsg });
              emitToSession(sid, EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: unsupportedMsg, direcao: 'saida' });
              return res.json({ success: true });
            }

            // Logar ação
            await logger.saveAction({
              session_id: sid, interaction_id: null,
              acao: 'ANALISE_DOCUMENTO',
              descricao: result.success
                ? `Documento analisado: "${result.text?.substring(0, 100)}"`
                : `Falha na análise: ${result.error}`,
              status: result.success ? 'sucesso' : 'erro',
              dados_entrada: { mediaMimetype, mediaFilename, hasCaption: !!message },
              dados_saida: result.success ? { texto: result.text?.substring(0, 500) } : { error: result.error },
              tempo_ms: result.tempo_ms || 0,
            });
          }

          if (result?.success && result.text) {
            // Alimentar análise no pipeline normal
            const analysisText = message?.trim()
              ? `${message}\n\n[Análise do documento: ${result.text}]`
              : `[Análise do documento (${docDisplayName}): ${result.text}]`;
            console.log(`[webhook] Documento analisado, processando: "${analysisText.substring(0, 100)}"`);
            bufferMessage(telefone, analysisText, 'whatsapp', pushName, sendText);
          } else {
            // Fallback
            console.log(`[webhook] Não foi possível analisar documento de ${telefone}`);
            const fallbackMsg = '📄 Recebi seu documento, mas não consegui analisá-lo no momento. Poderia descrever o que você precisa por texto? 😊';
            await sendText(telefone, fallbackMsg);
            await logger.saveMessage({ session_id: sid, direcao: 'saida', conteudo: fallbackMsg, canal: 'whatsapp' });
            emit(EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: fallbackMsg });
            emitToSession(sid, EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: fallbackMsg, direcao: 'saida' });

            if (message?.trim()) {
              bufferMessage(telefone, message, 'whatsapp', pushName, sendText);
            }
          }
        } catch (docErr) {
          console.error('[webhook] Erro ao processar documento:', docErr.message, docErr.stack);
          await sendText(telefone, '📄 Não consegui abrir seu documento aqui! Pode me contar por texto o que precisa? 😊').catch(() => {});
        }

        return res.json({ success: true });
      }

      // ── Outros tipos de mídia (vídeo, sticker) ──
      const mediaResponse = MEDIA_RESPONSES[messageType];

      if (mediaResponse) {
        console.log(`[webhook] Mídia recebida: ${messageType} de ${telefone}`);
        await sendText(telefone, mediaResponse);

        if (message && message.trim()) {
          console.log(`[webhook] Mídia com caption, processando texto: "${message.substring(0, 80)}"`);
          bufferMessage(telefone, message, 'whatsapp', pushName, sendText);
        }
      } else if (messageType === 'sticker') {
        console.log(`[webhook] Sticker ignorado de ${telefone}`);
      } else {
        console.log(`[webhook] Tipo desconhecido: ${messageType} de ${telefone}`);
      }

      return res.json({ success: true });
    }

    // Ignorar mensagens vazias
    if (!message || !message.trim()) {
      return res.json({ success: true });
    }

    // Usar buffer (debounce) — acumula mensagens por 15s
    bufferMessage(telefone, message, 'whatsapp', pushName, sendText);

    res.json({ success: true });
  } catch (err) {
    console.error('[webhook] Erro whatsapp:', err);
    res.status(500).json({ success: false, error: 'Erro interno' });
  }
});

// --- POST /webhook/site ---
router.post('/webhook/site', async (req, res) => {
  try {
    let resposta = null;
    const replyFn = async (_tel, texto) => { resposta = texto; };
    await processMessage('site', req.body, replyFn);
    res.json({ success: true, reply: resposta });
  } catch (err) {
    console.error('[webhook] Erro site:', err);
    res.status(500).json({
      success: false,
      reply: 'Desculpe, ocorreu um erro. Tente novamente em instantes.',
    });
  }
});

export default router;
