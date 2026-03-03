/**
 * notification.js — Serviço de notificação de escalonamentos.
 *
 * Envia alertas para grupo WhatsApp dos atendentes quando uma conversa
 * é escalonada para atendimento humano.
 */

import { config } from '../config/env.js';
import { sendGroupText } from './whatsapp.js';

/**
 * Formata a data/hora atual em formato brasileiro.
 */
function formatNow() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Monta a mensagem de escalonamento formatada para WhatsApp.
 */
function buildEscalationMessage({ session, escalation, motivo }) {
  const nome = session?.nome_cliente || 'Não identificado';
  const telefone = session?.telefone || '—';
  const canal = (session?.canal || 'whatsapp').toUpperCase();
  const prioridade = (escalation?.prioridade || 'media').toUpperCase();
  const dataHora = formatNow();

  const prioridadeEmoji = {
    CRITICA: '🔴',
    ALTA: '🟠',
    MEDIA: '🟡',
    BAIXA: '⚪',
  };

  const emoji = prioridadeEmoji[prioridade] || '🟡';
  const dashUrl = config.dashboardUrl
    ? `\n📋 *Painel:* ${config.dashboardUrl}/escalations`
    : '';

  return `🚨 *NOVO ESCALONAMENTO* 🚨

👤 *Cliente:* ${nome}
📱 *Telefone:* ${telefone}
📍 *Canal:* ${canal}
${emoji} *Prioridade:* ${prioridade}
💬 *Motivo:* ${motivo || 'Não especificado'}

🕐 ${dataHora}${dashUrl}`;
}

/**
 * Notifica atendentes sobre escalonamento via grupo WhatsApp.
 * Best-effort: erro não bloqueia o fluxo principal.
 *
 * @param {{ session: object, escalation: object, motivo: string }} params
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function notifyEscalation({ session, escalation, motivo }) {
  try {
    const groupId = config.notifyGroupId;

    if (!groupId) {
      console.log('[notification] NOTIFY_GROUP_ID não configurado — pulando notificação WhatsApp');
      return { success: false, error: 'groupId não configurado' };
    }

    const message = buildEscalationMessage({ session, escalation, motivo });
    const result = await sendGroupText(groupId, message);

    if (result.success) {
      console.log('[notification] Escalonamento notificado no grupo WhatsApp');
    } else {
      console.error('[notification] Falha ao notificar grupo:', result.error);
    }

    return result;
  } catch (err) {
    console.error('[notification] Erro ao notificar escalonamento:', err.message);
    return { success: false, error: err.message };
  }
}
