/**
 * Tipos de mensagem que são mídia (não-texto).
 * O bot precisa tratar cada um de forma diferente.
 */
const MEDIA_TYPES = new Set([
  'image', 'imageMessage',
  'audio', 'audioMessage', 'ptt', 'pttMessage',
  'video', 'videoMessage',
  'document', 'documentMessage',
  'sticker', 'stickerMessage',
]);

/**
 * Tipos de mensagem que devem ser ignorados silenciosamente.
 * Reações, recibos de leitura, presença, etc.
 */
const IGNORED_TYPES = new Set([
  'reaction', 'reactionMessage',
  'protocolMessage', 'protocol',
  'receipt', 'read', 'presence',
  'call', 'callMessage',
  'ephemeral', 'viewOnce',
  'senderKeyDistributionMessage',
  'messageContextInfo',
]);

/**
 * Extrai o texto de uma mensagem da Uazapi,
 * lidando com content que pode ser string, objeto ou undefined.
 */
function extractText(data) {
  const content = data.content;
  const text = data.text;
  const caption = data.caption;
  const body = data.body;

  // 1. caption tem prioridade (imagens/vídeos com legenda)
  if (caption && typeof caption === 'string') return caption;

  // 2. content como string (mensagem de texto normal)
  if (content && typeof content === 'string') return content;

  // 3. content como objeto (mídia) — extrair caption interno
  if (content && typeof content === 'object') {
    if (content.caption && typeof content.caption === 'string') return content.caption;
    if (content.text && typeof content.text === 'string') return content.text;
    // Mention/quoted message — tentar extrair texto da conversa citada
    if (content.conversation && typeof content.conversation === 'string') return content.conversation;
    if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
    // Imagem/vídeo com caption dentro do objeto
    if (content.imageMessage?.caption) return content.imageMessage.caption;
    if (content.videoMessage?.caption) return content.videoMessage.caption;
    if (content.documentMessage?.caption) return content.documentMessage.caption;
    // Se é mídia sem texto, retornar vazio (será tratado pelo messageType)
    return '';
  }

  // 4. text como string
  if (text && typeof text === 'string') return text;

  // 5. body como string
  if (body && typeof body === 'string') return body;

  return '';
}

/**
 * Detecta o tipo real da mensagem da Uazapi.
 * Verifica messageType, type, e também a estrutura do content.
 */
function detectMessageType(data) {
  // Campo explícito
  const explicit = data.messageType || data.type || '';

  if (explicit) {
    const lower = explicit.toLowerCase();
    // Normalizar variações
    if (lower.includes('image')) return 'image';
    if (lower.includes('audio') || lower.includes('ptt') || lower === 'voice') return 'audio';
    if (lower.includes('video')) return 'video';
    if (lower.includes('document') || lower.includes('pdf')) return 'document';
    if (lower.includes('sticker')) return 'sticker';
    if (lower.includes('reaction')) return 'reaction';
    if (lower.includes('protocol') || lower.includes('receipt') || lower.includes('presence')) return 'ignored';
    if (lower.includes('call')) return 'ignored';
    if (lower === 'text' || lower === 'conversation' || lower === 'chat' || lower === 'extendedtext' || lower === 'extendedtextmessage') return 'text';
  }

  // Detectar pela estrutura do content
  if (data.content && typeof data.content === 'object') {
    if (data.content.imageMessage) return 'image';
    if (data.content.audioMessage || data.content.pttMessage) return 'audio';
    if (data.content.videoMessage) return 'video';
    if (data.content.documentMessage) return 'document';
    if (data.content.stickerMessage) return 'sticker';
    if (data.content.reactionMessage) return 'reaction';
    if (data.content.conversation || data.content.extendedTextMessage) return 'text';
  }

  // Se tem mimetype no conteúdo
  const mime = data.mimetype || data.content?.mimetype || '';
  if (mime) {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('application/')) return 'document';
  }

  // Fallback: se tem texto, é text
  if (extractText(data)) return 'text';

  return explicit || 'unknown';
}

/**
 * Normaliza payload recebido via webhook da Uazapi.
 * A Uazapi envia os dados dentro de body.message (objeto aninhado).
 * Payload interno: { sender, chatid, content, text, senderName, fromMe, wasSentByApi, ... }
 */
export function normalizeUazapiPayload(body) {
  let data = body.data || body;

  // Uazapi envia o payload real dentro de body.message como objeto
  if (data.message && typeof data.message === 'object') {
    data = data.message;
  }

  // Extrair telefone: priorizar campos com número real, evitar LIDs (Linked IDs)
  // sender_pn = phone number real, chatid = "5511...@s.whatsapp.net"
  // sender pode vir como LID ("162801...@lid") que NÃO é telefone
  const candidatos = [
    data.wa_chatid || data.Wa_Chatid,   // Uazapi: sempre tem o telefone correto (prioridade máxima)
    data.chatid,                        // Chat ID alternativo
    data.sender_pn,                     // Uazapi: phone number real
    data.phone,                         // Número direto
    data.from,                          // Alternativa
    data.number,                        // Alternativa
    data.sender,                        // Pode ser LID — última opção
  ];

  let rawPhone = '';
  for (const c of candidatos) {
    if (!c || typeof c !== 'string') continue;
    const clean = c.replace(/@.*$/, '').replace(/\D/g, '');
    // Ignorar LIDs: se o campo original contém "@lid" ou o número não parece telefone BR/internacional
    if (c.includes('@lid')) continue;
    // Telefone BR tem 12-13 dígitos (com DDI 55), internacional pode ter 10-15
    if (clean.length >= 10 && clean.length <= 15) {
      rawPhone = clean;
      break;
    }
  }

  // Fallback: se não achou nenhum válido, usar qualquer um disponível
  if (!rawPhone) {
    const fallback = data.sender_pn || data.phone || data.chatid || data.sender || data.from || data.number || '';
    rawPhone = fallback.replace(/@.*$/, '').replace(/\D/g, '');
    console.log('[normalizer] AVISO: usando fallback para telefone:', { rawPhone, original: fallback });
  }

  const from = rawPhone;

  // Detectar tipo da mensagem
  const messageType = detectMessageType(data);

  // Extrair texto (com tratamento para content ser objeto)
  const message = extractText(data);

  // Extrair URL de mídia quando disponível
  let mediaUrl = null;
  let mediaFilename = null;
  let mediaMimetype = null;
  let mediaBase64 = null;

  if (MEDIA_TYPES.has(messageType) || ['image', 'audio', 'video', 'document', 'sticker'].includes(messageType)) {
    // Log para debug de payloads de mídia
    if (messageType === 'audio') {
      const debugKeys = Object.keys(data).filter(k => !['content'].includes(k));
      const contentKeys = data.content && typeof data.content === 'object' ? Object.keys(data.content) : [];
      console.log('[normalizer] Payload áudio — campos:', { dataKeys: debugKeys, contentKeys, hasUrl: !!data.url, hasMediaUrl: !!data.mediaUrl, hasBase64: !!data.base64 });
    }

    // URL direta (Uazapi pode usar "URL" maiúsculo ou "url" minúsculo)
    mediaUrl = data.url || data.URL || data.mediaUrl || data.fileUrl || data.media || null;

    // URL dentro do content (Uazapi envia content.URL em maiúsculo!)
    if (!mediaUrl && data.content && typeof data.content === 'object') {
      mediaUrl = data.content.url || data.content.URL || data.content.mediaUrl || data.content.fileUrl || data.content.media || null;
      // Mimetype direto no content (Uazapi: content.mimetype)
      if (!mediaMimetype && data.content.mimetype) {
        mediaMimetype = data.content.mimetype;
      }
      // Dentro de sub-objetos de mídia (formato alternativo)
      const mediaObj = data.content.imageMessage || data.content.audioMessage ||
        data.content.videoMessage || data.content.documentMessage ||
        data.content.pttMessage || data.content.stickerMessage;
      if (mediaObj) {
        mediaUrl = mediaUrl || mediaObj.url || mediaObj.URL || null;
        mediaFilename = mediaObj.fileName || mediaObj.filename || null;
        mediaMimetype = mediaMimetype || mediaObj.mimetype || null;
      }
    }

    // Base64 como alternativa (Uazapi pode enviar direto)
    if (!mediaUrl) {
      mediaBase64 = data.base64 || data.mediaBase64 || data.file || null;
      if (!mediaBase64 && data.content && typeof data.content === 'object') {
        mediaBase64 = data.content.base64 || data.content.mediaBase64 || data.content.file || null;
      }
    }

    mediaFilename = mediaFilename || data.filename || data.fileName || null;
    mediaMimetype = mediaMimetype || data.mimetype || null;

    if (messageType === 'audio' && !mediaUrl && !mediaBase64) {
      console.log('[normalizer] AVISO: áudio sem URL e sem base64. Dump parcial:', JSON.stringify(data).substring(0, 500));
    }
  }

  // Extrair campos de criptografia de mídia (necessários para download via Uazapi)
  // WhatsApp envia: mediaKey, fileSha256, fileLength — podem estar no content diretamente
  // OU dentro do sub-objeto de mídia (audioMessage, pttMessage, etc.)
  let mediaKey = null;
  let fileSHA256 = null;
  let fileLength = null;
  if (data.content && typeof data.content === 'object') {
    // 1) Direto no content
    mediaKey = data.content.mediaKey || data.content.MediaKey || null;
    fileSHA256 = data.content.fileSha256 || data.content.fileSHA256 || data.content.FileSHA256 || null;
    fileLength = data.content.fileLength || data.content.FileLength || null;

    // 2) Dentro do sub-objeto de mídia (audioMessage, pttMessage, imageMessage, etc.)
    if (!mediaKey) {
      const mo = data.content.audioMessage || data.content.pttMessage ||
        data.content.imageMessage || data.content.videoMessage ||
        data.content.documentMessage || data.content.stickerMessage;
      if (mo) {
        mediaKey = mediaKey || mo.mediaKey || mo.MediaKey || null;
        fileSHA256 = fileSHA256 || mo.fileSha256 || mo.fileSHA256 || mo.FileSHA256 || null;
        fileLength = fileLength || mo.fileLength || mo.FileLength || null;
      }
    }

    if (fileLength) fileLength = parseInt(fileLength, 10) || null;

    // Debug: logar campos de criptografia encontrados para áudio
    if (messageType === 'audio') {
      console.log('[normalizer] Crypto fields:', { mediaKey: !!mediaKey, fileSHA256: !!fileSHA256, fileLength });
      if (!mediaKey) {
        // Dump das chaves do content para identificar onde está o mediaKey
        const allKeys = Object.keys(data.content);
        const subObjKeys = {};
        for (const k of allKeys) {
          if (data.content[k] && typeof data.content[k] === 'object') {
            subObjKeys[k] = Object.keys(data.content[k]);
          }
        }
        console.log('[normalizer] Content keys (sem mediaKey):', { allKeys, subObjKeys });
      }
    }
  }

  // Verificar se deve ser ignorado
  const isIgnored = IGNORED_TYPES.has(data.messageType || '') ||
    IGNORED_TYPES.has(data.type || '') ||
    messageType === 'reaction' ||
    messageType === 'ignored';

  // Extrair ID da mensagem (necessário para download via /message/download da Uazapi)
  const messageId = data.id || data.messageId || data.key?.id || data.content?.key?.id || null;
  if (messageType === 'audio') {
    console.log('[normalizer] messageId extraído:', messageId);
  }

  return {
    from,
    message: typeof message === 'string' ? message : '',
    pushName: data.pushName || data.senderName || data.sender_name || '',
    messageType,
    fromMe: data.fromMe === true || data.wasSentByApi === true,
    isIgnored,
    // Dados de mídia (quando aplicável)
    mediaUrl,
    mediaFilename,
    mediaMimetype,
    mediaBase64,
    // Campos de criptografia (para download via Uazapi)
    mediaKey,
    fileSHA256,
    fileLength,
    // ID da mensagem (para download via Uazapi /message/download)
    messageId,
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
    fromMe: false,
    isIgnored: false,
    mediaUrl: null,
    mediaFilename: null,
    mediaMimetype: null,
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
