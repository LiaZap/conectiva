import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Bot, User } from 'lucide-react';

/**
 * Props:
 *   direcao | direction  — 'entrada' (client) or 'saida' (bot)
 *   conteudo | message   — text content
 *   created_at | timestamp — ISO string
 */
export default function ChatBubble(props) {
  const direcao = props.direcao || props.direction;
  const conteudo = props.conteudo || props.message || '';
  const ts = props.created_at || props.timestamp;

  const isClient = direcao === 'entrada';
  const time = ts ? format(new Date(ts), 'HH:mm', { locale: ptBR }) : '';

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
        <p className="whitespace-pre-wrap break-words">{conteudo}</p>
        {time && (
          <span className={`block text-[10px] mt-1 text-right ${isClient ? 'text-slate-400' : 'text-conectiva-200'}`}>
            {time}
          </span>
        )}
      </div>

      {!isClient && (
        <div className="w-7 h-7 rounded-full bg-conectiva-700 flex items-center justify-center shrink-0 mt-1">
          <Bot size={14} />
        </div>
      )}
    </div>
  );
}
