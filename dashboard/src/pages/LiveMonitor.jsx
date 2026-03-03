import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, Users, CheckCircle, Zap, Clock, Trash2, X, UserCheck, Bot, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useWS } from '../context/WebSocketContext.jsx';
import { getSessions, getSession, takeoverSession, releaseSession, closeSession, deleteSession, sendSessionMessage, getMetricsOverview } from '../services/api.js';
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
  const [confirmAction, setConfirmAction] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load sessions + overview
  const loadSessions = useCallback(() => {
    getSessions({ limit: 50 }).then((r) => r.success && setSessions(r.data)).catch(() => {});
    getMetricsOverview('hoje').then((r) => r.success && setOverview(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 10_000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  // WS: update session list on new events
  useEffect(() => {
    const unsub1 = subscribe('nova_mensagem', () => loadSessions());
    const unsub2 = subscribe('sessao_encerrada', () => loadSessions());
    const unsub3 = subscribe('sessao_atualizada', (data) => {
      loadSessions();
      if (data.session_id === selectedId) {
        setSelectedSession((prev) => prev ? { ...prev, status: data.status } : prev);
      }
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [subscribe, loadSessions, selectedId]);

  // Select session
  const selectSession = useCallback((id) => {
    if (selectedId) leaveSession(selectedId);
    setSelectedId(id);
    setReplyText('');
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
      setMessages((prev) => [...prev, {
        id: data.message_id || null,
        direcao: 'entrada',
        conteudo: data.message,
        created_at: data.timestamp,
        metadata: data.metadata || {},
      }]);
    });
    const unsub2 = subscribe('resposta_enviada', (data) => {
      if (data.session_id !== selectedId) return;
      setMessages((prev) => [...prev, {
        direcao: 'saida',
        conteudo: data.resposta,
        created_at: data.timestamp,
        remetente: data.remetente || 'bot',
      }]);
    });
    // Atualizar metadata de mensagem (ex: imagem/documento carregados)
    const unsub6 = subscribe('mensagem_atualizada', (data) => {
      if (data.session_id !== selectedId) return;
      // Recarregar todas as mensagens da sessão para obter metadata completa
      getSession(selectedId).then((r) => {
        if (r.success) setMessages(r.data.messages);
      }).catch(() => {});
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
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); };
  }, [selectedId, subscribe]);

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── Ações ──────────────────────────────────
  const handleTakeover = async () => {
    if (!selectedId) return;
    try {
      const result = await takeoverSession(selectedId);
      if (result.success) {
        setSelectedSession((prev) => prev ? { ...prev, status: 'aguardando_humano' } : prev);
        loadSessions();
        // Focar no input de mensagem
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } catch (err) {
      console.error('Erro ao assumir:', err);
    }
  };

  const handleRelease = async () => {
    if (!selectedId) return;
    try {
      const result = await releaseSession(selectedId);
      if (result.success) {
        setSelectedSession((prev) => prev ? { ...prev, status: 'ativa' } : prev);
        loadSessions();
      }
    } catch (err) {
      console.error('Erro ao devolver:', err);
    }
  };

  const handleClose = async (id) => {
    try {
      const result = await closeSession(id);
      if (result.success) {
        if (id === selectedId) {
          setSelectedId(null);
          setSelectedSession(null);
          setMessages([]);
          setActions([]);
        }
        loadSessions();
      }
    } catch (err) {
      console.error('Erro ao finalizar:', err);
    }
    setConfirmAction(null);
  };

  const handleDelete = async (id) => {
    try {
      const result = await deleteSession(id);
      if (result.success) {
        if (id === selectedId) {
          setSelectedId(null);
          setSelectedSession(null);
          setMessages([]);
          setActions([]);
        }
        loadSessions();
      }
    } catch (err) {
      console.error('Erro ao excluir:', err);
    }
    setConfirmAction(null);
  };

  const handleSendMessage = async () => {
    if (!selectedId || !replyText.trim() || sending) return;
    setSending(true);
    try {
      const result = await sendSessionMessage(selectedId, replyText.trim());
      if (result.success) {
        setReplyText('');
        // Auto-assumir no frontend se ainda não estava em modo humano
        if (!isHumanAttending) {
          setSelectedSession((prev) => prev ? { ...prev, status: 'aguardando_humano' } : prev);
          loadSessions();
        }
        inputRef.current?.focus();
      }
    } catch (err) {
      console.error('Erro ao enviar:', err);
    }
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const isHumanAttending = selectedSession?.status === 'aguardando_humano';

  return (
    <div className="flex flex-col h-full">
      {/* Top metrics bar */}
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-slate-700">
        <MetricCard icon={Radio} label="Ativos agora" value={overview.sessoes_ativas_agora} color="conectiva" />
        <MetricCard icon={Users} label="Escalonados" value={overview.total_escalonados} color="red" />
        <MetricCard icon={CheckCircle} label="Resolvidos hoje" value={overview.total_automaticos} color="white" />
        <MetricCard icon={Zap} label="Taxa automática" value={overview.taxa_resolucao_automatica ? `${overview.taxa_resolucao_automatica}%` : '—'} color="dourado" />
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT — Session list */}
        <div className="w-80 shrink-0 border-r border-slate-700 overflow-y-auto">
          <div className="p-3 border-b border-slate-700">
            <h2 className="text-sm font-semibold text-white">Sessões</h2>
          </div>
          <div className="space-y-1 p-2">
            {sessions.map((s) => (
              <div key={s.id} className="group relative">
                <button
                  onClick={() => selectSession(s.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedId === s.id ? 'bg-slate-700' : 'hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      s.status === 'aguardando_humano' ? 'bg-amber-600 text-white' : 'bg-slate-600 text-slate-300'
                    }`}>
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
                {/* Botões de ação na sessão (hover) */}
                <div className="absolute top-1 right-1 hidden group-hover:flex gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'close', id: s.id, label: s.nome_cliente || s.telefone }); }}
                    title="Finalizar sessão"
                    className="p-1 rounded bg-slate-600 hover:bg-slate-500 text-slate-300 transition-colors"
                  >
                    <X size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', id: s.id, label: s.nome_cliente || s.telefone }); }}
                    title="Excluir sessão"
                    className="p-1 rounded bg-red-600/80 hover:bg-red-500 text-white transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
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
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-slate-400">{selectedSession?.intencao_principal || '—'}</p>
                    {isHumanAttending && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-400 border border-amber-600/30 flex items-center gap-1">
                        <UserCheck size={10} /> Atendimento humano
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/session/${selectedId}`)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">
                    Ver detalhes
                  </button>
                  {isHumanAttending ? (
                    <button onClick={handleRelease} className="text-xs px-3 py-1.5 rounded-lg bg-conectiva-600 hover:bg-conectiva-500 text-white transition-colors flex items-center gap-1">
                      <Bot size={12} /> Devolver ao Bot
                    </button>
                  ) : (
                    <button onClick={handleTakeover} className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors flex items-center gap-1">
                      <UserCheck size={12} /> Assumir Conversa
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmAction({ type: 'close', id: selectedId, label: selectedSession?.nome_cliente || selectedSession?.telefone })}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-500 text-white transition-colors"
                  >
                    Finalizar
                  </button>
                </div>
              </div>
              {/* Banner de atendimento humano */}
              {isHumanAttending && (
                <div className="bg-amber-600/10 border-b border-amber-600/30 px-4 py-2 flex items-center gap-2">
                  <UserCheck size={14} className="text-amber-400" />
                  <span className="text-xs text-amber-300">Bot desativado — Você está atendendo. Digite sua mensagem abaixo para responder ao cliente.</span>
                </div>
              )}
              {/* Chat messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m, i) => <ChatBubble key={i} {...m} />)}
                <div ref={chatEndRef} />
              </div>
              {/* Input de resposta (sempre visível, mas mais destacado no modo humano) */}
              <div className={`p-3 border-t ${isHumanAttending ? 'border-amber-600/40 bg-slate-800/80' : 'border-slate-700 bg-slate-900/50'}`}>
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={inputRef}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isHumanAttending ? 'Digite sua resposta para o cliente...' : 'Enviar mensagem como atendente (o bot será pausado)...'}
                    rows={1}
                    className={`flex-1 resize-none rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition-colors ${
                      isHumanAttending
                        ? 'bg-slate-700 border border-amber-600/40 focus:border-amber-500'
                        : 'bg-slate-800 border border-slate-600 focus:border-slate-500'
                    }`}
                    style={{ minHeight: '40px', maxHeight: '120px' }}
                    onInput={(e) => {
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                    }}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!replyText.trim() || sending}
                    className={`shrink-0 p-2.5 rounded-lg transition-colors flex items-center justify-center ${
                      replyText.trim() && !sending
                        ? 'bg-dourado-400 hover:bg-dourado-300 text-slate-900'
                        : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    }`}
                    title="Enviar mensagem (Enter)"
                  >
                    <Send size={18} />
                  </button>
                </div>
                {!isHumanAttending && replyText.trim() && (
                  <p className="text-[10px] text-amber-400/70 mt-1.5 ml-1">
                    ⚠️ Ao enviar, a sessão será assumida automaticamente e o bot será pausado.
                  </p>
                )}
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
            <h2 className="text-sm font-semibold text-white">Ações da IA</h2>
          </div>
          {selectedId ? <ActionLog actions={actions} /> : (
            <p className="text-sm text-slate-500 p-4 text-center">Selecione uma sessão</p>
          )}
        </div>
      </div>

      {/* Modal de confirmação */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirmAction(null)}>
          <div className="bg-slate-800 rounded-xl p-6 max-w-sm w-full mx-4 border border-slate-600 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-100 mb-2">
              {confirmAction.type === 'delete' ? '🗑️ Excluir Sessão' : '⏹️ Finalizar Sessão'}
            </h3>
            <p className="text-sm text-slate-300 mb-1">
              {confirmAction.type === 'delete'
                ? 'Tem certeza que deseja excluir esta sessão? Todas as mensagens, logs e dados serão removidos permanentemente.'
                : 'Tem certeza que deseja finalizar esta sessão? O cliente poderá iniciar uma nova conversa depois.'}
            </p>
            <p className="text-xs text-slate-400 mb-4">
              Sessão: <span className="text-slate-200 font-medium">{confirmAction.label}</span>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => confirmAction.type === 'delete' ? handleDelete(confirmAction.id) : handleClose(confirmAction.id)}
                className={`px-4 py-2 text-sm rounded-lg text-white transition-colors ${
                  confirmAction.type === 'delete' ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {confirmAction.type === 'delete' ? 'Excluir' : 'Finalizar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
