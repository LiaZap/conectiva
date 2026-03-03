import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Sparkles, User, Mic, Image, FileText, Eye, Download } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Detecta e formata mensagens que contêm análise de mídia.
 * Separa o texto do cliente da análise do sistema.
 */
function parseAnalysis(text) {
  if (!text) return { clientText: '', analysis: null, type: null };

  // Detectar [Análise da imagem: ...] ou [Análise do documento: ...]
  const imgMatch = text.match(/\[Análise da imagem:\s*([\s\S]*?)\]$/);
  const docMatch = text.match(/\[Análise do documento(?:\s*\([^)]*\))?:\s*([\s\S]*?)\]$/);

  if (imgMatch) {
    const clientText = text.replace(imgMatch[0], '').trim();
    return { clientText, analysis: imgMatch[1].trim(), type: 'image' };
  }
  if (docMatch) {
    const clientText = text.replace(docMatch[0], '').trim();
    return { clientText, analysis: docMatch[1].trim(), type: 'document' };
  }

  return { clientText: text, analysis: null, type: null };
}

/**
 * Props:
 *   direcao | direction  — 'entrada' (client) or 'saida' (IA)
 *   conteudo | message   — text content
 *   created_at | timestamp — ISO string
 *   id                   — message UUID (para buscar áudio)
 *   metadata             — { type: 'audio'|'image'|'document', ... }
 */
export default function ChatBubble(props) {
  const direcao = props.direcao || props.direction;
  const conteudo = props.conteudo || props.message || '';
  const ts = props.created_at || props.timestamp;
  const metadata = props.metadata || {};
  const messageId = props.id;

  const isClient = direcao === 'entrada';
  const isAudio = metadata?.type === 'audio' && metadata?.audio_base64;
  const isImage = metadata?.type === 'image';
  const isDocument = metadata?.type === 'document';
  const time = ts ? format(new Date(ts), 'HH:mm', { locale: ptBR }) : '';

  // Detectar análise de mídia no texto
  const { clientText, analysis, type: analysisType } = parseAnalysis(conteudo);
  const hasAnalysis = !!analysis;

  return (
    <div className={`flex gap-2 animate-slide-in ${isClient ? 'justify-start' : 'justify-end'}`}>
      {isClient && (
        <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center shrink-0 mt-1">
          <User size={14} />
        </div>
      )}

      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          isClient
            ? 'bg-slate-700 text-slate-100 rounded-bl-md'
            : 'bg-conectiva-600 text-white rounded-br-md'
        }`}
      >
        {isAudio ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs opacity-70">
              <Mic size={12} />
              <span>Áudio do cliente</span>
            </div>
            <audio
              controls
              preload="none"
              className="w-full max-w-[280px] h-8"
              src={`data:${metadata.mimetype || 'audio/ogg'};base64,${metadata.audio_base64}`}
            />
          </div>
        ) : isImage ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs opacity-70">
              <Image size={12} />
              <span>Imagem do cliente</span>
            </div>
            {metadata.image_base64 ? (
              <a
                href={`data:${metadata.mimetype || 'image/jpeg'};base64,${metadata.image_base64}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Clique para ver em tamanho real"
              >
                <img
                  src={`data:${metadata.mimetype || 'image/jpeg'};base64,${metadata.image_base64}`}
                  alt="Imagem enviada pelo cliente"
                  className="max-w-[260px] max-h-[200px] rounded-lg object-cover cursor-pointer hover:opacity-80 transition-opacity"
                />
              </a>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-600/30 rounded-lg">
                <Image size={16} className="opacity-60" />
                <span className="text-xs opacity-70">Imagem (sem preview disponível)</span>
              </div>
            )}
            {conteudo && !conteudo.startsWith('📷') && (
              <p className="whitespace-pre-wrap break-words text-xs opacity-80 mt-1">{conteudo}</p>
            )}
          </div>
        ) : isDocument ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs opacity-70">
              <FileText size={12} />
              <span>Documento do cliente</span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-600/30 rounded-lg">
              <div className="w-10 h-10 rounded-lg bg-red-600/20 flex items-center justify-center shrink-0">
                <FileText size={20} className="text-red-400" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium truncate">{metadata.filename || 'documento'}</span>
                <span className="text-[10px] opacity-60 uppercase">{(metadata.mimetype || 'pdf').replace('application/', '')}</span>
              </div>
              {metadata.doc_base64 && (
                <a
                  href={`data:${metadata.mimetype || 'application/pdf'};base64,${metadata.doc_base64}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir documento"
                  className="p-1.5 rounded-lg bg-slate-500/30 hover:bg-slate-500/50 transition-colors"
                >
                  <Eye size={14} />
                </a>
              )}
            </div>
            {conteudo && !conteudo.startsWith('📄') && (
              <p className="whitespace-pre-wrap break-words text-xs opacity-80 mt-1">{conteudo}</p>
            )}
          </div>
        ) : hasAnalysis ? (
          /* Mensagem com análise de mídia embutida */
          <div className="flex flex-col gap-2">
            {clientText && (
              <p className="whitespace-pre-wrap break-words">{clientText}</p>
            )}
            <div className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
              isClient ? 'bg-slate-600/50 border border-slate-500/30' : 'bg-conectiva-700/50 border border-conectiva-400/20'
            }`}>
              <div className="flex items-center gap-1.5 mb-1 opacity-70">
                {analysisType === 'image' ? <Eye size={11} /> : <FileText size={11} />}
                <span className="font-medium">
                  {analysisType === 'image' ? 'Análise da imagem' : 'Análise do documento'}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words opacity-90">{analysis}</p>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{conteudo}</p>
        )}
        {time && (
          <span className={`block text-[10px] mt-1 text-right ${isClient ? 'text-slate-400' : 'text-conectiva-200'}`}>
            {time}
          </span>
        )}
      </div>

      {!isClient && (
        <div className="w-7 h-7 rounded-full bg-conectiva-700 flex items-center justify-center shrink-0 mt-1">
          <Sparkles size={14} />
        </div>
      )}
    </div>
  );
}
