/**
 * Normaliza payload recebido via webhook da Uazapi.
 * Campos esperados: { phone, message, pushName, messageType, ... }
 */
export function normalizeUazapiPayload(body) {
  const data = body.data || body;
  return {
    from: (data.phone || data.from || data.number || '').replace(/\D/g, ''),
    message: data.message || data.text || data.body || '',
    pushName: data.pushName || data.senderName || '',
    messageType: data.messageType || data.type || 'text',
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
