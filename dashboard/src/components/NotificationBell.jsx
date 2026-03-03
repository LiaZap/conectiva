import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * Sino de notificação com badge vermelho de escalonamentos pendentes.
 * Ao clicar, navega para /escalations e zera o contador.
 */
export default function NotificationBell({ count, onClear }) {
  const navigate = useNavigate();

  const handleClick = () => {
    onClear?.();
    navigate('/escalations');
  };

  return (
    <button
      onClick={handleClick}
      title={count > 0 ? `${count} escalonamento(s) pendente(s)` : 'Escalonamentos'}
      className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
    >
      <Bell size={18} className={count > 0 ? 'text-dourado-400 animate-bounce' : ''} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full animate-pulse">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}
