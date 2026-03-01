import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, X, Clock, User, MessageSquare, Brain } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useWS } from '../context/WebSocketContext.jsx';
import { getEscalations, getSession, assignEscalation, resolveEscalation } from '../services/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ChatBubble from '../components/ChatBubble.jsx';
import ActionLog from '../components/ActionLog.jsx';

// ---- Modal de Conversa ----
function ConversationModal({ sessionId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId)
      .then((r) => r.success && setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (!sessionId) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-200">Conversa completa</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 transition-colors"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 py-12">Carregando...</div>
        ) : !data ? (
          <div className="flex-1 flex items-center justify-center text-red-400 py-12">Erro ao carregar</div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Dados do cliente */}
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-xs font-semibold text-slate-400 flex items-center gap-1 mb-2"><User size={12} /> Dados do Cliente</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-xs text-slate-500">Nome</span><p className="text-slate-200">{data.session.nome_cliente || '—'}</p></div>
                <div><span className="text-xs text-slate-500">Telefone</span><p className="text-slate-200">{data.session.telefone || '—'}</p></div>
                <div><span className="text-xs text-slate-500">CPF</span><p className="text-slate-200">{data.session.cpf_cnpj || '—'}</p></div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-700">
              {/* Chat */}
              <div className="p-4">
                <h3 className="text-xs font-semibold text-slate-400 flex items-center gap-1 mb-3"><MessageSquare size={12} /> Mensagens</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {data.messages.map((m, i) => <ChatBubble key={i} {...m} />)}
                  {data.messages.length === 0 && <p className="text-xs text-slate-500">Sem mensagens</p>}
                </div>
              </div>

              {/* Ações da IA */}
              <div className="p-4">
                <h3 className="text-xs font-semibold text-slate-400 flex items-center gap-1 mb-3"><Brain size={12} /> Ações da IA</h3>
                <div className="max-h-96 overflow-y-auto">
                  <ActionLog actions={data.actions} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Página principal ----
export default function Escalations() {
  const { subscribe } = useWS();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('pendente');
  const [prioFilter, setPrioFilter] = useState('');
  const [modalSessionId, setModalSessionId] = useState(null);

  const load = useCallback(() => {
    const params = { limit: 50 };
    if (statusFilter) params.status = statusFilter;
    if (prioFilter) params.prioridade = prioFilter;

    getEscalations(params)
      .then((r) => { if (r.success) { setItems(r.data); setTotal(r.total); } })
      .catch(() => {});
  }, [statusFilter, prioFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsub = subscribe('escalonamento', load);
    return unsub;
  }, [subscribe, load]);

  const handleAssign = async (id) => {
    const atendente = prompt('Nome do atendente:');
    if (!atendente) return;
    await assignEscalation(id, atendente).catch(() => {});
    load();
  };

  const handleResolve = async (id) => {
    if (!confirm('Marcar como resolvido?')) return;
    await resolveEscalation(id).catch(() => {});
    load();
  };

  const STATUS_OPTS = [
    { value: 'pendente', label: 'Pendentes' },
    { value: 'em_atendimento', label: 'Em atendimento' },
    { value: 'resolvido', label: 'Resolvidos' },
    { value: '', label: 'Todos' },
  ];

  const PRIO_OPTS = [
    { value: '', label: 'Todas' },
    { value: 'critica', label: 'Crítica' },
    { value: 'alta', label: 'Alta' },
    { value: 'media', label: 'Média' },
    { value: 'baixa', label: 'Baixa' },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <AlertTriangle size={20} className="text-amber-400" /> Escalonamentos
          <span className="text-sm text-slate-400 font-normal ml-2">({total})</span>
        </h1>

        <div className="flex gap-3">
          {/* Filtro prioridade */}
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
            {PRIO_OPTS.map((o) => (
              <button key={o.value} onClick={() => setPrioFilter(o.value)}
                className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${prioFilter === o.value ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                {o.label}
              </button>
            ))}
          </div>

          {/* Filtro status */}
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
            {STATUS_OPTS.map((o) => (
              <button key={o.value} onClick={() => setStatusFilter(o.value)}
                className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${statusFilter === o.value ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {items.map((e) => (
          <div key={e.id} className="card animate-slide-in">
            <div className="flex items-start gap-4">
              {/* Avatar com inicial */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                e.prioridade === 'critica' ? 'bg-red-500/20 text-red-400' :
                e.prioridade === 'alta' ? 'bg-orange-500/20 text-orange-400' :
                e.prioridade === 'media' ? 'bg-amber-500/20 text-amber-400' :
                'bg-slate-600/30 text-slate-400'
              }`}>
                {(e.nome_cliente || e.telefone || '?')[0].toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-200">{e.nome_cliente || e.telefone || '—'}</span>
                  <StatusBadge value={e.canal} />
                  <StatusBadge value={e.prioridade} />
                  <StatusBadge value={e.status} />
                </div>
                <p className="text-xs text-slate-300 mt-1">{e.motivo}</p>
                <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {e.created_at && formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}
                  </span>
                  {e.created_at && <span>{format(new Date(e.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</span>}
                  {e.atendente_designado && <span>Atendente: <strong className="text-slate-300">{e.atendente_designado}</strong></span>}
                </div>
              </div>

              {/* Ações */}
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setModalSessionId(e.session_id)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">
                  Ver conversa
                </button>
                {e.status === 'pendente' && (
                  <button onClick={() => handleAssign(e.id)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                    Assumir
                  </button>
                )}
                {(e.status === 'pendente' || e.status === 'em_atendimento') && (
                  <button onClick={() => handleResolve(e.id)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
                    Resolver
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div className="card text-center text-slate-500 py-12">
            <AlertTriangle size={32} className="mx-auto mb-2 opacity-30" />
            Nenhum escalonamento encontrado
          </div>
        )}
      </div>

      {/* Modal */}
      <ConversationModal sessionId={modalSessionId} onClose={() => setModalSessionId(null)} />
    </div>
  );
}
