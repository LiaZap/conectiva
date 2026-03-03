/**
 * vision.js — Serviço de análise de imagens e documentos via GPT-4o Vision.
 *
 * Recebe base64 de imagem ou documento (PDF) e envia para o GPT-4o
 * para análise contextualizada (comprovantes, fotos de equipamento, boletos, etc).
 */

import OpenAI from 'openai';
import { config } from '../config/env.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const MODEL = 'gpt-4o';

const IMAGE_PROMPT = `Você é uma atendente da Conectiva Internet, provedor de internet por fibra óptica.
Analise esta imagem enviada por um cliente e descreva o que você vê de forma relevante para o atendimento.

Tipos comuns de imagens que clientes enviam:
- **Comprovante de pagamento**: Extraia valor, data, banco e qualquer identificador visível
- **Teste de velocidade (speedtest)**: Extraia velocidade de download, upload e ping
- **Foto de equipamento (roteador, ONU, modem)**: Descreva o estado dos LEDs/luzes (verde, vermelho, piscando, apagado), modelo se visível, e possíveis problemas
- **Foto de cabo/fibra**: Identifique se há dano, dobra ou problema visível
- **Print de erro/tela**: Descreva o erro ou o que aparece na tela
- **Boleto/fatura**: Extraia valor, vencimento, código de barras se legível

Responda de forma objetiva e estruturada. Se não conseguir identificar o conteúdo, diga o que você vê.
Sempre responda em português brasileiro.`;

const DOCUMENT_PROMPT = `Você é uma atendente da Conectiva Internet, provedor de internet por fibra óptica.
Analise este documento (PDF) enviado por um cliente e extraia as informações relevantes.

Tipos comuns de documentos que clientes enviam:
- **Boleto/Fatura**: Extraia valor, vencimento, linha digitável, código de barras
- **Comprovante de pagamento**: Extraia valor, data, banco, número de autenticação
- **Contrato**: Identifique tipo de contrato, partes envolvidas, valores, prazos
- **Documento de identidade**: NÃO extraia dados sensíveis, apenas confirme o tipo de documento
- **Outros**: Descreva o conteúdo de forma resumida

IMPORTANTE: Nunca exponha dados sensíveis como CPF completo, número de cartão, senhas.
Responda de forma objetiva e estruturada.
Sempre responda em português brasileiro.`;

/**
 * Analisa uma imagem via GPT-4o Vision.
 *
 * @param {string} imageBase64 — Imagem codificada em base64
 * @param {string} [mimetype]  — MIME type (ex: 'image/jpeg', 'image/png')
 * @param {string} [caption]   — Legenda enviada junto com a imagem
 * @returns {Promise<{ success: boolean, text?: string, tempo_ms?: number, error?: string }>}
 */
export async function analyzeImage(imageBase64, mimetype, caption) {
  const start = Date.now();

  try {
    if (!imageBase64) {
      return { success: false, error: 'Base64 da imagem não fornecido', tempo_ms: 0 };
    }

    // Limpar prefixo data:image/... se existir
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    console.log('[vision] Analisando imagem...', { bytes: buffer.length, mimetype });

    // Limite: 15MB
    if (buffer.length > 15 * 1024 * 1024) {
      return { success: false, error: 'Imagem excede 15MB', tempo_ms: Date.now() - start };
    }

    // Verificar se é imagem válida (primeiros bytes)
    const header = buffer.slice(0, 4);
    const isJPEG = header[0] === 0xFF && header[1] === 0xD8;
    const isPNG = header[0] === 0x89 && header[1] === 0x50;
    const isGIF = header[0] === 0x47 && header[1] === 0x49;
    const isWebP = header[0] === 0x52 && header[1] === 0x49;

    if (!isJPEG && !isPNG && !isGIF && !isWebP && !mimetype?.startsWith('image/')) {
      console.log('[vision] Buffer não parece ser imagem válida');
      return { success: false, error: 'Formato de imagem não reconhecido', tempo_ms: Date.now() - start };
    }

    const mimeClean = (mimetype || 'image/jpeg').split(';')[0].trim();
    const dataUrl = `data:${mimeClean};base64,${cleanBase64}`;

    const userContent = caption
      ? `O cliente enviou esta imagem com a seguinte mensagem: "${caption}"\n\nAnalise a imagem considerando o contexto da mensagem.`
      : 'O cliente enviou esta imagem. Analise o conteúdo.';

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: IMAGE_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userContent },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_tokens: 800,
      temperature: 0.2,
    });

    const text = completion.choices[0].message.content?.trim() || '';
    const elapsed = Date.now() - start;

    console.log('[vision] Análise de imagem concluída:', {
      chars: text.length,
      elapsed: `${elapsed}ms`,
      preview: text.substring(0, 120),
    });

    if (!text) {
      return { success: false, error: 'Análise retornou vazia', tempo_ms: elapsed };
    }

    return { success: true, text, tempo_ms: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error('[vision] Erro na análise de imagem:', err.message);
    return { success: false, error: err.message, tempo_ms: elapsed };
  }
}

/**
 * Analisa um documento (PDF) via GPT-4o Vision.
 * PDFs são convertidos para imagem internamente pelo modelo quando enviados como base64.
 *
 * @param {string} docBase64   — Documento codificado em base64
 * @param {string} [mimetype]  — MIME type (ex: 'application/pdf')
 * @param {string} [filename]  — Nome do arquivo
 * @param {string} [caption]   — Legenda enviada junto com o documento
 * @returns {Promise<{ success: boolean, text?: string, tempo_ms?: number, error?: string }>}
 */
export async function analyzeDocument(docBase64, mimetype, filename, caption) {
  const start = Date.now();

  try {
    if (!docBase64) {
      return { success: false, error: 'Base64 do documento não fornecido', tempo_ms: 0 };
    }

    const cleanBase64 = docBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const mimeClean = (mimetype || 'application/pdf').split(';')[0].trim();

    console.log('[vision] Analisando documento...', { bytes: buffer.length, mimetype: mimeClean, filename });

    // Limite: 10MB
    if (buffer.length > 10 * 1024 * 1024) {
      return { success: false, error: 'Documento excede 10MB', tempo_ms: Date.now() - start };
    }

    // Verificar tipos suportados
    const supportedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const isSupported = supportedTypes.some(t => mimeClean.includes(t.split('/')[1]));

    if (!isSupported) {
      const ext = filename?.split('.').pop()?.toLowerCase() || '';
      const unsupportedMsg = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)
        ? `Infelizmente não consigo ler arquivos .${ext}. Poderia enviar como PDF?`
        : `Formato de documento não suportado (${mimeClean}). Aceito PDF e imagens.`;
      return { success: false, error: unsupportedMsg, tempo_ms: Date.now() - start, unsupported: true };
    }

    // Para PDFs, verificar se começa com %PDF
    if (mimeClean === 'application/pdf') {
      const pdfHeader = buffer.slice(0, 5).toString('utf-8');
      if (!pdfHeader.startsWith('%PDF')) {
        console.log('[vision] Arquivo não parece ser PDF válido:', pdfHeader);
        return { success: false, error: 'Arquivo não parece ser um PDF válido', tempo_ms: Date.now() - start };
      }
    }

    // GPT-4o aceita PDFs como input file (usando a API de files ou inline)
    // Usar input como imagem se for imagem, ou como file para PDF
    let messages;

    const userText = caption
      ? `O cliente enviou este documento com a mensagem: "${caption}"\nNome do arquivo: ${filename || 'documento'}\n\nAnalise o documento considerando o contexto.`
      : `O cliente enviou este documento.\nNome do arquivo: ${filename || 'documento'}\n\nAnalise o conteúdo.`;

    if (mimeClean === 'application/pdf') {
      // Para PDFs, usar como file input do GPT-4o
      messages = [
        { role: 'system', content: DOCUMENT_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            {
              type: 'file',
              file: {
                filename: filename || 'documento.pdf',
                file_data: `data:application/pdf;base64,${cleanBase64}`,
              },
            },
          ],
        },
      ];
    } else {
      // Para imagens de documentos, usar image_url
      messages = [
        { role: 'system', content: DOCUMENT_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeClean};base64,${cleanBase64}`,
                detail: 'high',
              },
            },
          ],
        },
      ];
    }

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      max_tokens: 1000,
      temperature: 0.2,
    });

    const text = completion.choices[0].message.content?.trim() || '';
    const elapsed = Date.now() - start;

    console.log('[vision] Análise de documento concluída:', {
      chars: text.length,
      elapsed: `${elapsed}ms`,
      preview: text.substring(0, 120),
    });

    if (!text) {
      return { success: false, error: 'Análise do documento retornou vazia', tempo_ms: elapsed };
    }

    return { success: true, text, tempo_ms: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error('[vision] Erro na análise de documento:', err.message);
    return { success: false, error: err.message, tempo_ms: elapsed };
  }
}
