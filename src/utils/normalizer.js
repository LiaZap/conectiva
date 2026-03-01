/**
 * Normaliza payload recebido via webhook da Uazapi.
 * Payload real: { sender, chatid, content, text, senderName, fromMe, wasSentByApi, messageType, type, ... }
 */
export function normalizeUazapiPayload(body) {
  const data = body.data || body;

  // Extrair telefone: sender/chatid vem como "5511999999999@s.whatsapp.net"
  const rawPhone = data.phone || data.sender || data.chatid || data.from || data.number || '';
  const from = rawPhone.replace(/@.*$/, '').replace(/\D/g, '');

  // Extrair texto da mensagem (content é o campo principal da Uazapi)
  const rawMessage = data.content || data.text || data.message || data.body || '';
  // Garantir que é string (caso venha como objeto)
  const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);

  return {
    from,
    message,
    pushName: data.pushName || data.senderName || data.sender_name || '',
    messageType: data.messageType || data.type || 'text',
    fromMe: data.fromMe === true || data.wasSentByApi === true,
  };
}

/**
 * Normaliza payload recebido via webhook do site (chat widget).
 */
export function normalizeSitePayload(body) {
  return {
    from: (body.session_id || body.visitor_id || '').toString(),
    message: body.message || body.text || '',
    pushName: body.name || body.nome || 'Visitante',
    messageType: 'text',
  };
}

/**
 * Função genérica — chama o normalizador certo pelo canal.
 */
export function normalizeChannel(body, canal) {
  if (canal === 'whatsapp') return normalizeUazapiPayload(body);
  if (canal === 'site') return normalizeSitePayload(body);
  throw new Error(`Canal desconhecido: ${canal}`);
}
