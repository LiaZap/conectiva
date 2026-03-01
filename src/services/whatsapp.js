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
