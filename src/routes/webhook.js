import { Router } from 'express';
import { normalizeChannel } from '../utils/normalizer.js';
import { extractCPFFromText, formatPhone } from '../utils/validators.js';
import * as sessionService from '../services/session.js';
import * as logger from '../services/logger.js';

import { execute as n8nExecute } from '../services/n8n.js';
import { sendText, sendDocument } from '../services/whatsapp.js';
import { analisarNegociacao } from '../services/negotiation.js';
import { classify, formatResponse, generateDiagnostic } from '../services/ai.js';
import { emit, emitToSession, EVENTS } from '../websocket/events.js';

const router = Router();

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
      await entry.replyFn(telefone, 'Desculpe, ocorreu um erro. Tente novamente em instantes.');
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

  // Ignorar mensagens enviadas pelo próprio bot
  if (fromMe) {
    console.log('[webhook] Ignorando mensagem fromMe');
    return;
  }

  if (!message) return;

  const telefone = canal === 'whatsapp' ? formatPhone(from) : from;

  // 2. Busca ou cria sessão
  const session = await sessionService.findOrCreate({ telefone, canal, pushName });
  const sid = session.id;

  // 3. Gravar mensagem de entrada
  await logger.saveMessage({ session_id: sid, direcao: 'entrada', conteudo: message, canal });
  await sessionService.incrementMessages(sid);

  // 4. Emitir nova_mensagem
  emit(EVENTS.NOVA_MENSAGEM, { session_id: sid, canal, telefone, message, pushName });
  emitToSession(sid, EVENTS.NOVA_MENSAGEM, { message, direcao: 'entrada' });

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
    'CRIAR_OS', 'AUTO_DESBLOQUEIO', 'NOVO_CONTRATO', 'NOVA_LEAD',
    'FATURAS_AVANCADO', 'ATUALIZAR_CADASTRO', 'CONSULTAR_CADASTRO',
  ]);

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

    mkResult = await n8nExecute({ action: acaoMK, params: mkParams, session_id: sid });
    tempo_mk_ms = mkResult.tempo_ms;

    emit(EVENTS.MK_RETORNOU, { session_id: sid, success: mkResult.success, acao: acaoMK });
    emitToSession(sid, EVENTS.MK_RETORNOU, { success: mkResult.success, data: mkResult.data });

    // Salvar cd_cliente_mk se veio do MK
    if (mkResult.success && mkResult.data?.cd_cliente && !session.cd_cliente_mk) {
      await sessionService.update(sid, { cd_cliente_mk: mkResult.data.cd_cliente });
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

  // 9. Formatar resposta final
  let resposta;
  if (negociacao && negociacao.mensagem) {
    // Usa mensagem da negociação (desconto/parcelas calculados)
    resposta = negociacao.mensagem;
  } else if (diagnostico) {
    // AC2: Usa diagnóstico técnico gerado pela IA
    resposta = diagnostico;
  } else if (cadastroAtualizado?.success) {
    // AC4: Confirmação de solicitação de atualização cadastral
    const protocolo = cadastroAtualizado.data?.protocolo || cadastroAtualizado.data?.CodigoLead || '';
    resposta = `Registrei sua solicitação de atualização cadastral com sucesso.${protocolo ? `\nProtocolo: ${protocolo}` : ''}\nNossa equipe irá processar a alteração e, se necessário, entrará em contato para confirmação.\nDeseja algo mais?`;
  } else if (acaoMK && mkResult?.success) {
    resposta = await formatResponse({ intencao, mkData: mkResult.data, session, historico });
  } else if (acaoMK && !mkResult?.success) {
    resposta = 'Desculpe, tive um problema ao consultar seus dados. Vou transferir para um atendente que poderá ajudá-lo.';
  } else {
    resposta = respostaSugerida || 'Como posso ajudá-lo?';
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
    emit(EVENTS.ESCALONAMENTO, { session_id: sid, escalation_id: escalation.id, motivo: escalation.motivo });
    emitToSession(sid, EVENTS.ESCALONAMENTO, { motivo: escalation.motivo });
  }
}

// ── Respostas para tipos de mídia ─────────────────────────
const MEDIA_RESPONSES = {
  audio: '🎤 Recebi seu áudio! No momento ainda não consigo ouvir áudios, mas estou aqui para te ajudar. Poderia digitar sua solicitação, por favor? 😊',
  image: '📷 Recebi sua imagem! Infelizmente ainda não consigo analisar imagens, mas posso te ajudar por texto. O que você precisa? 😊',
  video: '🎥 Recebi seu vídeo! No momento não consigo assistir vídeos, mas ficarei feliz em te ajudar por texto. Qual a sua solicitação? 😊',
  document: '📄 Recebi seu documento! Ainda não consigo ler documentos, mas posso te ajudar por texto. Me conta o que você precisa? 😊',
  sticker: '', // Figurinhas são ignoradas silenciosamente
};

// --- POST /webhook/whatsapp ---
router.post('/webhook/whatsapp', async (req, res) => {
  try {
    // Normalizar para extrair dados
    const { from, message, pushName, fromMe, messageType, isIgnored } = normalizeChannel(req.body, 'whatsapp');

    // Ignorar mensagens do próprio bot
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
      const mediaResponse = MEDIA_RESPONSES[messageType];

      if (mediaResponse) {
        // Responder informando que não processa mídia
        console.log(`[webhook] Mídia recebida: ${messageType} de ${telefone}`);
        await sendText(telefone, mediaResponse);

        // Se a mídia tinha legenda/caption, processar como texto
        if (message && message.trim()) {
          console.log(`[webhook] Mídia com caption, processando texto: "${message.substring(0, 80)}"`);
          bufferMessage(telefone, message, 'whatsapp', pushName, sendText);
        }
      } else if (messageType === 'sticker') {
        // Sticker: ignorar silenciosamente
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
