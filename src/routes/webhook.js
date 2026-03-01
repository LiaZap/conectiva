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

/**
 * Pipeline principal de processamento de mensagens.
 * Compartilhado entre WhatsApp e Site.
 */
async function processMessage(canal, body, replyFn) {
  const totalStart = Date.now();

  // 1. Normalizar payload
  const normalized = normalizeChannel(body, canal);
  const { from, message, pushName, fromMe } = normalized;

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

  // 7. Se precisa CPF e não tem, pedir
  if (precisaCPF && !session.cpf_cnpj) {
    const pedidoCPF = respostaSugerida || 'Para continuar, preciso do seu CPF. Pode informar, por favor?';
    await replyFn(telefone, pedidoCPF);
    await logger.saveMessage({ session_id: sid, direcao: 'saida', conteudo: pedidoCPF, canal });
    await logger.saveInteraction({
      session_id: sid, intencao, confianca, mensagem_cliente: message,
      resposta_ia: pedidoCPF, status: 'sucesso', tempo_ia_ms,
      tempo_total_ms: Date.now() - totalStart,
    });
    emit(EVENTS.RESPOSTA_ENVIADA, { session_id: sid, resposta: pedidoCPF });
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

// --- POST /webhook/whatsapp ---
router.post('/webhook/whatsapp', async (req, res) => {
  try {
    await processMessage('whatsapp', req.body, sendText);
    res.json({ success: true });
  } catch (err) {
    console.error('[webhook] Erro whatsapp:', err);
    try {
      const { from } = normalizeChannel(req.body, 'whatsapp');
      if (from) await sendText(formatPhone(from), 'Desculpe, ocorreu um erro. Tente novamente em instantes.');
    } catch (_) { /* silencioso */ }
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
