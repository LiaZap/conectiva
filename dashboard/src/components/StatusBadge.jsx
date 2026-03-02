const STYLES = {
  // session status
  ativa:              'bg-conectiva-500/15 text-conectiva-400 border border-conectiva-500/30',
  aguardando_humano:  'bg-red-500/15 text-red-400 border border-red-500/30',
  finalizada:         'bg-slate-500/15 text-slate-400 border border-slate-500/30',
  expirada:           'bg-slate-600/15 text-slate-500 border border-slate-600/30',
  // canais
  whatsapp:           'bg-green-500/15 text-green-400 border border-green-500/30',
  site:               'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  // prioridades
  critica:            'bg-red-600/20 text-red-400 border border-red-500/30',
  alta:               'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  media:              'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  baixa:              'bg-slate-500/15 text-slate-400 border border-slate-500/30',
  // escalation status
  pendente:           'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  em_atendimento:     'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  resolvido:          'bg-conectiva-500/15 text-conectiva-400 border border-conectiva-500/30',
  cancelado:          'bg-slate-600/15 text-slate-500 border border-slate-600/30',
  // intencoes
  SEGUNDA_VIA:        'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
  FATURAS:            'bg-violet-500/15 text-violet-400 border border-violet-500/30',
  NEGOCIACAO:         'bg-pink-500/15 text-pink-400 border border-pink-500/30',
  SUPORTE:            'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  CADASTRO:           'bg-teal-500/15 text-teal-400 border border-teal-500/30',
  CONTRATO:           'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30',
  DESBLOQUEIO:        'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  HUMANO:             'bg-red-500/15 text-red-400 border border-red-500/30',
};

const LABELS = {
  ativa: 'Ativa',
  aguardando_humano: 'Escalonada',
  finalizada: 'Finalizada',
  expirada: 'Expirada',
  whatsapp: 'WhatsApp',
  site: 'Site',
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
  pendente: 'Pendente',
  em_atendimento: 'Em atendimento',
  resolvido: 'Resolvido',
  cancelado: 'Cancelado',
  SEGUNDA_VIA: '2ª Via',
  FATURAS: 'Faturas',
  NEGOCIACAO: 'Negociação',
  SUPORTE: 'Suporte',
  CADASTRO: 'Cadastro',
  CONTRATO: 'Contrato',
  DESBLOQUEIO: 'Desbloqueio',
  HUMANO: 'Humano',
};

// Dot indicator colors (pulsing for active states)
const DOT_COLORS = {
  ativa: 'bg-conectiva-400 animate-pulse',
  aguardando_humano: 'bg-red-400 animate-pulse',
  pendente: 'bg-amber-400 animate-pulse',
  em_atendimento: 'bg-blue-400 animate-pulse',
};

const SIZE_MAP = {
  sm: 'text-[10px] px-1.5 py-0.5 gap-1',
  md: 'text-xs px-2 py-0.5 gap-1.5',
  lg: 'text-sm px-3 py-1 gap-2',
};

const DOT_SIZE_MAP = {
  sm: 'w-1 h-1',
  md: 'w-1.5 h-1.5',
  lg: 'w-2 h-2',
};

/**
 * Props:
 *   value — key (e.g. 'ativa', 'whatsapp', 'critica', 'SEGUNDA_VIA')
 *   size  — 'sm' | 'md' | 'lg' (default: 'md')
 *   dot   — show animated dot indicator (default: auto for active states)
 */
export default function StatusBadge({ value, size = 'md', dot }) {
  if (!value) return null;

  const style = STYLES[value] || 'bg-slate-500/15 text-slate-400 border border-slate-500/30';
  const label = LABELS[value] || value;
  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;
  const dotSizeClass = DOT_SIZE_MAP[size] || DOT_SIZE_MAP.md;

  // Show dot by default for active/pending states, or when explicitly requested
  const showDot = dot !== undefined ? dot : !!DOT_COLORS[value];
  const dotColor = DOT_COLORS[value] || 'bg-current';

  return (
    <span className={`badge inline-flex items-center rounded-full font-medium whitespace-nowrap ${style} ${sizeClass}`}>
      {showDot && <span className={`${dotSizeClass} rounded-full ${dotColor} shrink-0`} />}
      {label}
    </span>
  );
}
