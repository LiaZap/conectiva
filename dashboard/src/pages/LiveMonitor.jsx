import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, Users, CheckCircle, Zap, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useWS } from '../context/WebSocketContext.jsx';
import { getSessions, getSession, takeoverSession, getMetricsOverview } from '../services/api.js';
import ChatBubble from '../components/ChatBubble.jsx';
import ActionLog from '../components/ActionLog.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import MetricCard from '../components/MetricCard.jsx';

export default function LiveMonitor() {
  const navigate = useNavigate();
  const { subscribe, joinSession, leaveSession } = useWS();

  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [actions, setActions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [overview, setOverview] = useState({});
  const chatEndRef = useRef(null);

  // Load sessions + overview
  useEffect(() => {
    const load = () => {
      getSessions({ limit: 50 }).then((r) => r.success && setSessions(r.data)).catch(() => {});
      getMetricsOverview('hoje').then((r) => r.success && setOverview(r.data)).catch(() => {});
    };
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  // WS: update session list on new events
  useEffect(() => {
    const unsub1 = subscribe('nova_mensagem', () => {
      getSessions({ limit: 50 }).then((r) => r.success && setSessions(r.data)).catch(() => {});
    });
    const unsub2 = subscribe('sessao_encerrada', () => {
      getSessions({ limit: 50 }).then((r) => r.success && setSessions(r.data)).catch(() => {});
    });
    return () => { unsub1(); unsub2(); };
  }, [subscribe]);

  // Select session
  const selectSession = useCallback((id) => {
    if (selectedId) leaveSession(selectedId);
    setSelectedId(id);
    joinSession(id);

    getSession(id).then((r) => {
      if (!r.success) return;
      setSelectedSession(r.data.session);
      setMessages(r.data.messages);
      setActions(r.data.actions);
    }).catch(() => {});
  }, [selectedId, joinSession, leaveSession]);

  // WS: live messages for selected session
  useEffect(() => {
    if (!selectedId) return;
    const unsub1 = subscribe('nova_mensagem', (data) => {
      if (data.session_id !== selectedId) return;
      setMessages((prev) => [...prev, { direcao: 'entrada', conteudo: data.message, created_at: data.timestamp }]);
    });
    const unsub2 = subscribe('resposta_enviada', (data) => {
      if (data.session_id !== selectedId) return;
      setMessages((prev) => [...prev, { direcao: 'saida', conteudo: data.resposta, created_at: data.timestamp }]);
    });
    const unsub3 = subscribe('ia_classificou', (data) => {
      if (data.session_id !== selectedId) return;
      setActions((prev) => [...prev, { acao: 'classify', descricao: `${data.intencao} (${data.confianca})`, status: 'sucesso', created_at: data.timestamp }]);
    });
    const unsub4 = subscribe('chamando_mk', (data) => {
      if (data.session_id !== selectedId) return;
      setActions((prev) => [...prev, { acao: data.acao, descricao: 'Chamando API MK...', status: 'executando', created_at: data.timestamp }]);
    });
    const unsub5 = subscribe('mk_retornou', (data) => {
      if (data.session_id !== selectedId) return;
      setActions((prev) => {
        const updated = [...prev];
        const last = updated.findLast((a) => a.status === 'executando');
        if (last) last.status = data.success ? 'sucesso' : 'erro';
        return updated;
      });
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); };
  }, [selectedId, subscribe]);

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleTakeover = async () => {
    if (!selectedId) return;
    await takeoverSession(selectedId).catch(() => {});
    selectSession(selectedId);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top metrics bar */}
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-slate-700">
        <MetricCard icon={Radio} label="Ativos agora" value={overview.sessoes_ativas_agora} color="emerald" />
        <MetricCard icon={Users} label="Escalonados" value={overview.total_escalonados} color="red" />
        <MetricCard icon={CheckCircle} label="Resolvidos hoje" value={overview.total_automaticos} color="blue" />
        <MetricCard icon={Zap} label="Taxa automática" value={overview.taxa_resolucao_automatica ? `${overview.taxa_resolucao_automatica}%` : '—'} color="amber" />
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT — Session list */}
        <div className="w-80 shrink-0 border-r border-slate-700 overflow-y-auto">
          <div className="p-3 border-b border-slate-700">
            <h2 className="text-sm font-semibold text-slate-300">Sessões</h2>
          </div>
          <div className="space-y-1 p-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => selectSession(s.id)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  selectedId === s.id ? 'bg-slate-700' : 'hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold text-slate-300 shrink-0">
                    {(s.nome_cliente || s.telefone || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-medium text-slate-200 truncate">{s.nome_cliente || s.telefone}</span>
                      <StatusBadge value={s.canal} />
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                      <span className="text-xs text-slate-400 truncate">{s.intencao_principal || 'Aguardando...'}</span>
                      <StatusBadge value={s.status} />
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-500">
                      <Clock size={10} />
                      {s.created_at && formatDistanceToNow(new Date(s.created_at), { addSuffix: true, locale: ptBR })}
                    </div>
                  </div>
                </div>
              </button>
            ))}
            {sessions.length === 0 && <p className="text-sm text-slate-500 p-4 text-center">Nenhuma sessão</p>}
          </div>
        </div>

        {/* CENTER — Chat viewer */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedId ? (
            <>
              <div className="flex items-center justify-between p-3 border-b border-slate-700">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">
                    {selectedSession?.nome_cliente || selectedSession?.telefone || selectedId}
                  </h3>
                  <p className="text-xs text-slate-400">{selectedSession?.intencao_principal || '—'}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/session/${selectedId}`)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">
                    Ver detalhes
                  </button>
                  <button onClick={handleTakeover} className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors">
                    Assumir Conversa
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m, i) => <ChatBubble key={i} {...m} />)}
                <div ref={chatEndRef} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Selecione uma sessão para monitorar
            </div>
          )}
        </div>

        {/* RIGHT — Action timeline */}
        <div className="w-72 shrink-0 border-l border-slate-700 overflow-y-auto">
          <div className="p-3 border-b border-slate-700">
            <h2 className="text-sm font-semibold text-slate-300">Ações da IA</h2>
          </div>
          {selectedId ? <ActionLog actions={actions} /> : (
            <p className="text-sm text-slate-500 p-4 text-center">Selecione uma sessão</p>
          )}
        </div>
      </div>
    </div>
  );
}
