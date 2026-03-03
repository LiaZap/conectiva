import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, User, MessageSquare, Brain, Link, Clock, ChevronDown, ChevronRight, Star, FileText, RefreshCw } from 'lucide-react';
import { format, formatDistanceStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getSession } from '../services/api.js';
import ChatBubble from '../components/ChatBubble.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

function CollapsibleJSON({ label, data }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
      </button>
      {open && (
        <pre className="mt-1 p-2 bg-slate-900 rounded text-[11px] text-slate-300 overflow-x-auto max-h-48">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function SessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSession(id)
      .then((r) => r.success && setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-slate-400">Carregando...</div>;
  if (!data) return <div className="p-6 text-red-400">Sessão não encontrada</div>;

  const { session: s, messages = [], interactions = [], actions = [], previous_sessions: previousSessions = [] } = data;

  const duration = s.created_at && s.updated_at
    ? formatDistanceStrict(new Date(s.created_at), new Date(s.updated_at), { locale: ptBR })
    : '—';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-800 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-bold">Detalhes da Sessão</h1>
        <StatusBadge value={s.status} />
        {s.reincidencia && <StatusBadge value="reincidencia" />}
      </div>

      {/* SEÇÃO 1 — Dados do Cliente */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-3"><User size={16} /> Dados do Cliente</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {[
            ['Nome', s.nome_cliente || '—'],
            ['Telefone', s.telefone || '—'],
            ['CPF/CNPJ', s.cpf_cnpj || '—'],
            ['Cód. MK', s.cd_cliente_mk || '—'],
            ['Canal', <StatusBadge key="c" value={s.canal} />],
            ['Intenção', s.intencao_principal || '—'],
          ].map(([l, v], i) => (
            <div key={i}>
              <p className="text-xs text-slate-500">{l}</p>
              <p className="text-slate-200 mt-0.5">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* SEÇÃO — Contatos Anteriores (reincidência) */}
      {previousSessions.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-orange-400 flex items-center gap-2 mb-3">
            <RefreshCw size={16} /> Contatos Anteriores
            <span className="text-[10px] bg-orange-500/15 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded-full font-medium">
              {previousSessions.length + 1}º contato
            </span>
          </h2>
          <div className="space-y-2">
            {previousSessions.map((ps) => (
              <button
                key={ps.id}
                onClick={() => navigate(`/session/${ps.id}`)}
                className="w-full text-left p-3 rounded-lg border border-slate-700 hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusBadge value={ps.status} size="sm" />
                    <StatusBadge value={ps.intencao_principal} size="sm" />
                    {ps.nota_satisfacao && (
                      <span className="flex items-center gap-0.5 text-[10px] text-yellow-400">
                        <Star size={10} className="fill-yellow-400" /> {ps.nota_satisfacao}/5
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{ps.total_mensagens || 0} msgs</span>
                    <span>{ps.resolvida_por === 'humano' ? '👤 Humano' : ps.resolvida_por === 'ia' ? '🤖 IA' : '—'}</span>
                    {ps.created_at && <span>{format(new Date(ps.created_at), 'dd/MM/yy HH:mm')}</span>}
                  </div>
                </div>
                {ps.resumo_ia && (
                  <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2 leading-tight">{ps.resumo_ia}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SEÇÃO 2 — Chat Completo */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-3"><MessageSquare size={16} /> Chat Completo</h2>
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
          {messages.map((m, i) => <ChatBubble key={i} {...m} />)}
          {messages.length === 0 && <p className="text-sm text-slate-500">Nenhuma mensagem</p>}
        </div>
      </div>

      {/* SEÇÃO 3 — Timeline de Ações */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-3"><Brain size={16} /> Timeline de Ações</h2>
        <div className="space-y-3">
          {actions.map((a, i) => (
            <div key={a.id || i} className="border border-slate-700 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge value={a.status === 'sucesso' ? 'resolvido' : a.status === 'erro' ? 'critica' : 'pendente'} />
                  <span className="text-sm font-medium text-slate-200">{a.acao}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  {a.tempo_ms != null && <span>{a.tempo_ms}ms</span>}
                  {a.created_at && <span>{format(new Date(a.created_at), 'HH:mm:ss')}</span>}
                </div>
              </div>
              {a.descricao && <p className="text-xs text-slate-400 mt-1">{a.descricao}</p>}
              <div className="flex gap-4 mt-2">
                <CollapsibleJSON label="Dados entrada" data={a.dados_entrada} />
                <CollapsibleJSON label="Dados saída" data={a.dados_saida} />
              </div>
            </div>
          ))}
          {actions.length === 0 && <p className="text-sm text-slate-500">Nenhuma ação</p>}
        </div>
      </div>

      {/* SEÇÃO 4 — APIs MK Chamadas */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-3"><Link size={16} /> APIs MK Chamadas</h2>
        <div className="space-y-3">
          {interactions.filter((i) => i.mk_endpoint).map((ix, i) => (
            <div key={ix.id || i} className="border border-slate-700 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono text-conectiva-400">{ix.mk_endpoint}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge value={ix.mk_sucesso ? 'resolvido' : 'critica'} />
                  {ix.tempo_mk_ms != null && <span className="text-xs text-slate-400">{ix.tempo_mk_ms}ms</span>}
                </div>
              </div>
              <div className="flex gap-4 mt-2">
                <CollapsibleJSON label="Resposta MK" data={ix.mk_resposta} />
              </div>
            </div>
          ))}
          {!interactions.some((i) => i.mk_endpoint) && <p className="text-sm text-slate-500">Nenhuma API chamada</p>}
        </div>
      </div>

      {/* SEÇÃO 5 — Resumo */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-3"><Clock size={16} /> Resumo</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {[
            ['Status', <StatusBadge key="s" value={s.status} />],
            ['Duração', duration],
            ['Mensagens', s.total_mensagens],
            ['Resolvida por', s.resolvida_por || '—'],
          ].map(([l, v], i) => (
            <div key={i}>
              <p className="text-xs text-slate-500">{l}</p>
              <p className="text-slate-200 mt-0.5">{v}</p>
            </div>
          ))}
        </div>

        {/* Nota de Satisfação */}
        {s.nota_satisfacao && (
          <div className="mt-4 pt-3 border-t border-slate-700/50">
            <div className="flex items-center gap-2 mb-1">
              <Star size={14} className="text-yellow-400 fill-yellow-400" />
              <span className="text-xs text-slate-400">Satisfação do cliente</span>
            </div>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  size={20}
                  className={n <= s.nota_satisfacao
                    ? 'text-yellow-400 fill-yellow-400'
                    : 'text-slate-600'
                  }
                />
              ))}
              <span className="text-sm font-semibold text-slate-200 ml-2">
                {s.nota_satisfacao}/5
                {s.nota_satisfacao >= 4 ? ' — Positivo' : s.nota_satisfacao === 3 ? ' — Neutro' : ' — Negativo'}
              </span>
            </div>
          </div>
        )}

        {/* Resumo IA */}
        {s.resumo_ia && (
          <div className="mt-4 pt-3 border-t border-slate-700/50">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-conectiva-400" />
              <span className="text-xs text-slate-400">Resumo gerado pela IA</span>
            </div>
            <p className="text-sm text-slate-200 leading-relaxed bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
              {s.resumo_ia}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
