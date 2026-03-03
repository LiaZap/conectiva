import axios from 'axios';
import { config } from '../config/env.js';

const client = axios.create({
  baseURL: config.uazapi.baseUrl,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    token: config.uazapi.token,
  },
});

/**
 * Envia status de presença (digitando...) via Uazapi.
 * POST /chat/presence  { number, state }
 * state: 'composing' (digitando) ou 'available' (disponível/parou de digitar)
 * Usado para mostrar "digitando..." enquanto a IA processa (antes de ter resposta).
 */
export async function sendPresence(telefone, state = 'composing') {
  try {
    await client.post('/chat/presence', {
      number: telefone,
      state,
    });
    return { success: true };
  } catch (err) {
    // Não logar erro — presença é best-effort, não deve bloquear fluxo
    return { success: false };
  }
}

/**
 * Calcula delay de digitação baseado no tamanho da mensagem.
 * Simula velocidade de digitação humana (~40 chars/s) com mínimo 2s e máximo 5s.
 * A Uazapi mostra "Digitando..." durante este delay automaticamente.
 */
function typingDelay(texto) {
  const chars = texto?.length || 0;
  const ms = Math.min(Math.max(Math.round(chars / 40 * 1000), 2000), 5000);
  return ms;
}

/**
 * Envia mensagem de texto via Uazapi.
 * Usa o parâmetro nativo `delay` da Uazapi que mostra "Digitando..." automaticamente.
 * Também marca conversa e mensagens como lidas (readchat + readmessages).
 * POST /send/text  { number, text, delay, readchat, readmessages }
 */
export async function sendText(telefone, texto) {
  try {
    const delay = typingDelay(texto);
    const { data } = await client.post('/send/text', {
      number: telefone,
      text: texto,
      delay,
      readchat: true,
      readmessages: true,
    });
    console.log('[whatsapp] sendText ok', { telefone, delay });
    return { success: true, data };
  } catch (err) {
    console.error('[whatsapp] sendText erro', { telefone, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Envia documento/mídia via Uazapi.
 * Mostra "Digitando..." por 2s antes de enviar o documento.
 * POST /send/media  { number, media, type, caption, fileName, delay, readchat, readmessages }
 */
export async function sendDocument(telefone, url, filename, caption) {
  try {
    const { data } = await client.post('/send/media', {
      number: telefone,
      media: url,
      type: 'document',
      caption: caption || '',
      fileName: filename || 'documento.pdf',
      delay: 2000,
      readchat: true,
      readmessages: true,
    });
    console.log('[whatsapp] sendDocument ok', { telefone, filename });
    return { success: true, data };
  } catch (err) {
    console.error('[whatsapp] sendDocument erro', { telefone, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Baixa mídia de áudio via API da Uazapi.
 * POST /message/download  { id, return_base64: true }
 * Retorna o áudio como Buffer binário.
 */
export async function downloadMedia({ messageId }) {
  try {
    if (!messageId) {
      return { success: false, error: 'messageId não disponível para download' };
    }

    console.log('[whatsapp] downloadMedia via /message/download...', { messageId });

    const { data } = await axios.post(
      `${config.uazapi.baseUrl}/message/download`,
      {
        id: messageId,
        return_base64: true,
        generate_mp3: false,
        return_link: false,
        transcribe: false,
        download_quoted: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          token: config.uazapi.token,
        },
        timeout: 30_000,
      }
    );

    // A resposta pode vir como JSON com base64 ou como buffer direto
    let buffer = null;

    if (data && typeof data === 'object' && (data.base64 || data.base64Data)) {
      // Resposta JSON com campo base64 ou base64Data (Uazapi usa base64Data)
      const raw = data.base64 || data.base64Data;
      const cleanBase64 = raw.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(cleanBase64, 'base64');
      console.log('[whatsapp] downloadMedia base64 decodificado:', { bytes: buffer.length });
    } else if (data && typeof data === 'object' && data.data) {
      // Resposta JSON com campo data (base64)
      const cleanBase64 = data.data.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(cleanBase64, 'base64');
      console.log('[whatsapp] downloadMedia data decodificado:', { bytes: buffer.length });
    } else if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
      buffer = Buffer.from(data);
      console.log('[whatsapp] downloadMedia buffer direto:', { bytes: buffer.length });
    } else if (typeof data === 'string') {
      // String base64 direta
      const cleanBase64 = data.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(cleanBase64, 'base64');
      console.log('[whatsapp] downloadMedia string base64:', { bytes: buffer.length });
    }

    if (!buffer || buffer.length === 0) {
      console.log('[whatsapp] downloadMedia resposta inesperada:', JSON.stringify(data).substring(0, 500));
      return { success: false, error: 'Resposta sem dados de áudio' };
    }

    console.log('[whatsapp] downloadMedia ok', { bytes: buffer.length });
    return { success: true, buffer };
  } catch (err) {
    console.error('[whatsapp] downloadMedia erro:', err.response?.status, err.message);
    if (err.response?.data) {
      try {
        const errText = typeof err.response.data === 'string'
          ? err.response.data.substring(0, 300)
          : JSON.stringify(err.response.data).substring(0, 300);
        console.error('[whatsapp] downloadMedia resposta:', errText);
      } catch (_) {}
    }
    return { success: false, error: err.message };
  }
}

/**
 * Envia menu interativo (botões) via Uazapi.
 * Mostra "Digitando..." por 2s antes de enviar o menu.
 * POST /send/menu  { number, title, text, footer, options, delay, readchat, readmessages }
 */
export async function sendButtons(telefone, texto, buttons) {
  try {
    const options = buttons.map((btn) => ({
      id: btn.id || btn.title,
      title: btn.title,
      description: btn.description || '',
    }));

    const { data } = await client.post('/send/menu', {
      number: telefone,
      title: 'Conectiva Infor',
      text: texto,
      footer: 'Selecione uma opção',
      options,
      delay: 2000,
      readchat: true,
      readmessages: true,
    });
    console.log('[whatsapp] sendButtons ok', { telefone, total: options.length });
    return { success: true, data };
  } catch (err) {
    console.error('[whatsapp] sendButtons erro', { telefone, error: err.message });
    return { success: false, error: err.message };
  }
}
