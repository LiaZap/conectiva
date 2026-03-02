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
 * Envia mensagem de texto via Uazapi.
 * POST /send/text  { number, text }
 */
export async function sendText(telefone, texto) {
  try {
    const { data } = await client.post('/send/text', {
      number: telefone,
      text: texto,
    });
    console.log('[whatsapp] sendText ok', { telefone });
    return { success: true, data };
  } catch (err) {
    console.error('[whatsapp] sendText erro', { telefone, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Envia documento/mídia via Uazapi.
 * POST /send/media  { number, media, type, caption, fileName }
 */
export async function sendDocument(telefone, url, filename, caption) {
  try {
    const { data } = await client.post('/send/media', {
      number: telefone,
      media: url,
      type: 'document',
      caption: caption || '',
      fileName: filename || 'documento.pdf',
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
export async function downloadAudio({ messageId }) {
  try {
    if (!messageId) {
      return { success: false, error: 'messageId não disponível para download' };
    }

    console.log('[whatsapp] downloadAudio via /message/download...', { messageId });

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
      console.log('[whatsapp] downloadAudio base64 decodificado:', { bytes: buffer.length });
    } else if (data && typeof data === 'object' && data.data) {
      // Resposta JSON com campo data (base64)
      const cleanBase64 = data.data.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(cleanBase64, 'base64');
      console.log('[whatsapp] downloadAudio data decodificado:', { bytes: buffer.length });
    } else if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
      buffer = Buffer.from(data);
      console.log('[whatsapp] downloadAudio buffer direto:', { bytes: buffer.length });
    } else if (typeof data === 'string') {
      // String base64 direta
      const cleanBase64 = data.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(cleanBase64, 'base64');
      console.log('[whatsapp] downloadAudio string base64:', { bytes: buffer.length });
    }

    if (!buffer || buffer.length === 0) {
      console.log('[whatsapp] downloadAudio resposta inesperada:', JSON.stringify(data).substring(0, 500));
      return { success: false, error: 'Resposta sem dados de áudio' };
    }

    console.log('[whatsapp] downloadAudio ok', { bytes: buffer.length });
    return { success: true, buffer };
  } catch (err) {
    console.error('[whatsapp] downloadAudio erro:', err.response?.status, err.message);
    if (err.response?.data) {
      try {
        const errText = typeof err.response.data === 'string'
          ? err.response.data.substring(0, 300)
          : JSON.stringify(err.response.data).substring(0, 300);
        console.error('[whatsapp] downloadAudio resposta:', errText);
      } catch (_) {}
    }
    return { success: false, error: err.message };
  }
}

/**
 * Envia menu interativo (botões) via Uazapi.
 * POST /send/menu  { number, title, text, footer, options }
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
    });
    console.log('[whatsapp] sendButtons ok', { telefone, total: options.length });
    return { success: true, data };
  } catch (err) {
    console.error('[whatsapp] sendButtons erro', { telefone, error: err.message });
    return { success: false, error: err.message };
  }
}
