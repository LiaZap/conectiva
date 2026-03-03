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
import { notifyEscalation, notifyNewLead } from '../services/notification.js';
import { emit, emitToSession, EVENTS } from '../websocket/events.js';

const router = Router();

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
  const { intencao, confianca, acaoMK, paramsMK, respostaSugerida, precisaCPF, _tempoMs: tempo_ia_ms } = classification;

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
    'CRIAR_OS', 'AUTO_DESBLOQUEIO', 'NOVO_CONTRATO',
    'FATURAS_AVANCADO', 'ATUALIZAR_CADASTRO', 'CONSULTAR_CADASTRO',
  ]);
  // NOTA: NOVA_LEAD, CRIAR_PESSOA e LISTAR_PLANOS NÃO precisam de cd_cliente

  // Se precisa CPF (IA pediu OU ação MK requer) e não tem, pedir ao cliente
  const precisaIdentificacao = precisaCPF || (acaoMK && ACTIONS_REQUIRING_CUSTOMER.has(acaoMK));
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
        const cData = consultaResult.data;
        const cdCliente = cData.CodigoCliente || cData.cd_cliente || cData.codigo_cliente
                       || cData.CdCliente || cData.Codigo;
        const nomeCliente = cData.NomeCliente || cData.nome_cliente || cData.RazaoSocial
                         || cData.Nome;

        if (cdCliente) {
          // ✅ Cliente encontrado no MK — salvar e prosseguir
          mkParams.cd_cliente = String(cdCliente);
          await sessionService.update(sid, {
            cd_cliente_mk: String(cdCliente),
            ...(nomeCliente && !session.nome_cliente ? { nome_cliente: nomeCliente } : {}),
          });
          session.cd_cliente_mk = String(cdCliente);
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
          // ❌ Cliente NÃO encontrado no MK — criar lead e informar
          console.log(`[webhook] Cliente NÃO encontrado no MK: CPF ${session.cpf_cnpj}`);

          await logger.saveAction({
            session_id: sid, interaction_id: null,
            acao: 'CONSULTAR_CLIENTE', descricao: 'CPF consultado mas cliente não encontrado no MK',
            status: 'erro', dados_entrada: { doc: session.cpf_cnpj },
            dados_saida: consultaResult.data, tempo_ms: consultaResult.tempo_ms,
          });

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

          // Se intenção indica interesse em contratar, buscar planos disponíveis
          let planosTexto = '';
          const interesseContratacao = ['CONTRATO', 'VIABILIDADE', 'CADASTRO'].includes(intencao);
          if (interesseContratacao) {
            try {
              const planosResult = await n8nExecute({
                action: 'LISTAR_PLANOS', params: { TipoPlano: '1' }, session_id: sid,
              });
              if (planosResult.success && planosResult.data?.Planos?.length > 0) {
                const planos = planosResult.data.Planos.slice(0, 8); // Máx 8 planos
                planosTexto = '\n\n📶 *Nossos planos de internet:*\n' +
                  planos.map(p => `• *${p.descricao}*`).join('\n') +
                  '\n\nQuer saber mais sobre algum plano? 😊';
                await logger.saveAction({
                  session_id: sid, interaction_id: null,
                  acao: 'LISTAR_PLANOS', descricao: 'Planos listados para cliente não cadastrado interessado',
                  status: 'sucesso', dados_entrada: { TipoPlano: 1 },
                  dados_saida: { total: planos.length }, tempo_ms: planosResult.tempo_ms,
                });
              }
            } catch (e) {
              console.error('[webhook] Erro ao listar planos (não crítico):', e.message);
            }
          }

          // Informar o cliente e encerrar este ciclo
          const respostaNaoCadastrado =
            `Não encontrei um cadastro no nosso sistema com o CPF informado 🤔\n\n` +
            `Mas não se preocupe! Já registrei seu contato e *nossa equipe vai entrar em contato* com você para te ajudar! 😊` +
            planosTexto +
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

      mkParams.CodigoCliente = mkParams.cd_cliente;
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
      mkParams.fone = mkParams.fone || telefone;
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

    // ── Executar a ação principal (se não foi resolvida na etapa de dependência) ──
    if (!mkResult) {
      mkResult = await n8nExecute({ action: acaoMK, params: mkParams, session_id: sid });
    }
    tempo_mk_ms = mkResult.tempo_ms;

    emit(EVENTS.MK_RETORNOU, { session_id: sid, success: mkResult.success, acao: acaoMK });
    emitToSession(sid, EVENTS.MK_RETORNOU, { success: mkResult.success, data: mkResult.data });

    // Salvar cd_cliente_mk se veio do MK (CONSULTAR_CLIENTE retorna CodigoCliente)
    if (mkResult.success && mkResult.data && !session.cd_cliente_mk) {
      const d = mkResult.data;
      const cdCliente = d.CodigoCliente || d.cd_cliente || d.codigo_cliente || d.CdCliente || d.Codigo;
      const nomeCliente = d.NomeCliente || d.nome_cliente || d.RazaoSocial || d.Nome;

      if (cdCliente) {
        await sessionService.update(sid, {
          cd_cliente_mk: String(cdCliente),
          ...(nomeCliente && !session.nome_cliente ? { nome_cliente: nomeCliente } : {}),
        });
        session.cd_cliente_mk = String(cdCliente);
        if (nomeCliente) session.nome_cliente = nomeCliente;
        console.log(`[webhook] cd_cliente_mk salvo da resposta MK: ${cdCliente}`);
      }
    }

    // Se CONSULTAR_CLIENTE não encontrou o cliente, criar lead e informar
    if (acaoMK === 'CONSULTAR_CLIENTE' && mkResult?.success && mkResult.data && !session.cd_cliente_mk) {
      console.log(`[webhook] CONSULTAR_CLIENTE: cliente não encontrado para CPF ${session.cpf_cnpj}`);

      // Criar lead automaticamente
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
  if (mkResult?._clienteNaoEncontrado) {
    // Cliente não encontrado no MK — lead já foi criada acima
    // Listar planos se o cliente parece interessado em contratar
    let planosExtra = '';
    if (['CONTRATO', 'VIABILIDADE', 'CADASTRO'].includes(intencao)) {
      try {
        const planosRes = await n8nExecute({ action: 'LISTAR_PLANOS', params: { TipoPlano: '1' }, session_id: sid });
        if (planosRes.success && planosRes.data?.Planos?.length > 0) {
          const planos = planosRes.data.Planos.slice(0, 8);
          planosExtra = '\n\n📶 *Nossos planos de internet:*\n' +
            planos.map(p => `• *${p.descricao}*`).join('\n') +
            '\n\nQuer saber mais sobre algum plano? 😊';
        }
      } catch (_) { /* não crítico */ }
    }
    resposta =
      `Não encontrei um cadastro no nosso sistema com o CPF informado 🤔\n\n` +
      `Mas não se preocupe! Já registrei seu contato e *nossa equipe vai entrar em contato* com você para te ajudar! 😊` +
      planosExtra +
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
