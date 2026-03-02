import { useState } from 'react';
import { format } from 'date-fns';
import { Brain, Link, MessageSquare, AlertTriangle, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

const ICONS = {
  classify: Brain,
  CONSULTAR_CLIENTE: Link,
  FATURAS_PENDENTES: Link,
  SEGUNDA_VIA: Link,
  CONEXOES_CLIENTE: Link,
  CONTRATOS_CLIENTE: Link,
  CRIAR_OS: Link,
  AUTO_DESBLOQUEIO: Link,
  NOVO_CONTRATO: Link,
  NOVA_LEAD: Link,
  FATURAS_AVANCADO: Link,
  response: MessageSquare,
};

const STATUS_COLOR = {
  sucesso: 'text-conectiva-400 bg-conectiva-400/10 border-conectiva-400/30',
  erro: 'text-red-400 bg-red-400/10 border-red-400/30',
  executando: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
};

const STATUS_DOT = {
  sucesso: 'bg-conectiva-400',
  erro: 'bg-red-400',
  executando: 'bg-amber-400 animate-pulse',
};

// ---- Collapsible JSON viewer ----
function CollapsibleJSON({ label, data }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null;

  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[10px] font-medium opacity-70 hover:opacity-100 transition-opacity"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {label}
      </button>

      {open && (
        <div className="relative mt-1 rounded-md bg-slate-900/60 border border-slate-700/50 overflow-hidden">
          <button
            onClick={handleCopy}
            className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-slate-700/50 transition-colors opacity-60 hover:opacity-100"
            title="Copiar JSON"
          >
            {copied ? <Check size={10} className="text-conectiva-400" /> : <Copy size={10} />}
          </button>
          <pre className="text-[10px] leading-relaxed p-2 pr-7 overflow-x-auto max-h-48 text-slate-300 scrollbar-thin">
            {jsonStr}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---- Action item ----
function ActionItem({ action, index }) {
  const Icon = ICONS[action.acao] || AlertTriangle;
  const colors = STATUS_COLOR[action.status] || STATUS_COLOR.executando;
  const dotColor = STATUS_DOT[action.status] || STATUS_DOT.executando;

  const hasData = action.dados_entrada || action.dados_saida;

  return (
    <div className={`flex gap-3 items-start animate-slide-in border rounded-lg p-3 ${colors}`}>
      {/* Timeline dot + icon */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <Icon size={16} className="mt-0.5" />
        <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold truncate">{action.acao}</span>
          <div className="flex items-center gap-2 shrink-0">
            {action.tempo_ms != null && (
              <span className="text-[10px] opacity-70 tabular-nums">{action.tempo_ms}ms</span>
            )}
            {action.created_at && (
              <span className="text-[10px] opacity-50">{format(new Date(action.created_at), 'HH:mm:ss')}</span>
            )}
          </div>
        </div>

        {/* Description */}
        {action.descricao && (
          <p className="text-[11px] opacity-80 mt-0.5 line-clamp-2">{action.descricao}</p>
        )}

        {/* Collapsible JSON sections */}
        {hasData && (
          <div className="space-y-0.5">
            <CollapsibleJSON label="Dados de entrada" data={action.dados_entrada} />
            <CollapsibleJSON label="Dados de saída" data={action.dados_saida} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Main component ----
export default function ActionLog({ actions = [], compact = false }) {
  if (actions.length === 0) {
    return (
      <div className="text-center py-6">
        <Brain size={24} className="mx-auto mb-2 text-slate-600" />
        <p className="text-slate-500 text-sm">Nenhuma ação registrada</p>
      </div>
    );
  }

  // Stats summary
  const total = actions.length;
  const sucesso = actions.filter((a) => a.status === 'sucesso').length;
  const erros = actions.filter((a) => a.status === 'erro').length;
  const tempoTotal = actions.reduce((sum, a) => sum + (a.tempo_ms || 0), 0);

  return (
    <div className="space-y-3 p-2">
      {/* Summary bar (hidden in compact mode) */}
      {!compact && total > 1 && (
        <div className="flex items-center gap-3 text-[10px] text-slate-500 px-1 pb-1 border-b border-slate-700/50">
          <span>{total} ações</span>
          {sucesso > 0 && <span className="text-conectiva-400">{sucesso} ok</span>}
          {erros > 0 && <span className="text-red-400">{erros} erro(s)</span>}
          {tempoTotal > 0 && <span className="ml-auto tabular-nums">{tempoTotal}ms total</span>}
        </div>
      )}

      {/* Action list */}
      {actions.map((a, i) => (
        <ActionItem key={a.id || i} action={a} index={i} />
      ))}
    </div>
  );
}
