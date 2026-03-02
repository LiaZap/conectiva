/**
 * audio.js — Serviço de transcrição de áudio via OpenAI Whisper.
 *
 * Baixa o arquivo de áudio de uma URL (Uazapi/WhatsApp) e envia para o
 * modelo whisper-1 da OpenAI para transcrição em português.
 */

import OpenAI from 'openai';
import axios from 'axios';
import { config } from '../config/env.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

/**
 * Mapeia MIME types para extensões aceitas pelo Whisper.
 * Whisper suporta: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm
 */
const MIME_TO_EXT = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'mp4',
};

function getExtension(mimetype, filename) {
  // Tentar extrair da extensão do arquivo
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext && ['ogg', 'mp3', 'mp4', 'wav', 'webm', 'flac', 'm4a', 'oga', 'mpeg', 'mpga'].includes(ext)) {
      return ext;
    }
  }
  // Extrair da MIME type (ignora parâmetros como "; codecs=opus")
  const baseMime = (mimetype || '').split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[baseMime] || 'ogg'; // Default: ogg (áudio WhatsApp)
}

/**
 * Baixa um arquivo de áudio e transcreve com OpenAI Whisper.
 *
 * @param {string} audioUrl     — URL do arquivo de áudio
 * @param {string} [mimetype]   — MIME type (ex: 'audio/ogg; codecs=opus')
 * @param {string} [filename]   — Nome original do arquivo (ex: 'audio.ogg')
 * @returns {Promise<{ success: boolean, text?: string, tempo_ms?: number, error?: string }>}
 */
export async function transcribeAudio(audioUrl, mimetype, filename) {
  const start = Date.now();

  try {
    if (!audioUrl) {
      return { success: false, error: 'URL do áudio não fornecida', tempo_ms: 0 };
    }

    console.log('[audio] Baixando áudio:', { url: audioUrl?.substring(0, 100), mimetype });

    // 1. Baixar o arquivo de áudio
    const response = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      headers: {
        // Token Uazapi para URLs autenticadas
        ...(config.uazapi?.token ? { token: config.uazapi.token } : {}),
      },
    });

    const audioBuffer = Buffer.from(response.data);
    console.log('[audio] Áudio baixado:', { bytes: audioBuffer.length });

    if (audioBuffer.length === 0) {
      return { success: false, error: 'Áudio vazio (0 bytes)', tempo_ms: Date.now() - start };
    }

    // Limite do Whisper: 25MB
    if (audioBuffer.length > 25 * 1024 * 1024) {
      return { success: false, error: 'Áudio excede 25MB (limite Whisper)', tempo_ms: Date.now() - start };
    }

    // 2. Determinar extensão do arquivo
    const ext = getExtension(mimetype, filename);
    const finalFilename = filename || `audio.${ext}`;

    // 3. Criar File para a API da OpenAI
    const file = new File([audioBuffer], finalFilename, {
      type: mimetype || 'audio/ogg',
    });

    // 4. Chamar Whisper API
    console.log('[audio] Transcrevendo com Whisper...');
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: 'pt', // Português (Brasil)
    });

    const elapsed = Date.now() - start;
    const text = transcription.text?.trim();

    console.log('[audio] Transcrição concluída:', {
      chars: text?.length,
      elapsed: `${elapsed}ms`,
      preview: text?.substring(0, 100),
    });

    if (!text) {
      return { success: false, error: 'Transcrição retornou vazia', tempo_ms: elapsed };
    }

    return { success: true, text, tempo_ms: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error('[audio] Erro na transcrição:', err.message);
    return { success: false, error: err.message, tempo_ms: elapsed };
  }
}
