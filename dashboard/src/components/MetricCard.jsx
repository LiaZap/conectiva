import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const COLOR_MAP = {
  emerald: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    iconBg: 'bg-emerald-500/15',
  },
  blue: {
    text: 'text-blue-400',
    bg: 'bg-blue-500/10',
    iconBg: 'bg-blue-500/15',
  },
  amber: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    iconBg: 'bg-amber-500/15',
  },
  red: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    iconBg: 'bg-red-500/15',
  },
  violet: {
    text: 'text-violet-400',
    bg: 'bg-violet-500/10',
    iconBg: 'bg-violet-500/15',
  },
};

/**
 * Props:
 *   icon       — Lucide icon component
 *   label      — Metric label (e.g. "Total atendimentos")
 *   value      — Main value (string | number)
 *   sub        — Subtitle text
 *   color      — 'emerald' | 'blue' | 'amber' | 'red' | 'violet'
 *   trend      — Percentage change (positive = up, negative = down, 0 = neutral)
 *   trendLabel — Custom label for trend (e.g. "vs semana passada")
 *   loading    — Show skeleton state
 */
export default function MetricCard({ icon: Icon, label, value, sub, color = 'emerald', trend, trendLabel, loading = false }) {
  const palette = COLOR_MAP[color] || COLOR_MAP.emerald;

  if (loading) {
    return (
      <div className="card flex items-center gap-3 animate-pulse">
        <div className="w-10 h-10 rounded-lg bg-slate-700" />
        <div className="flex-1 space-y-2">
          <div className="h-6 bg-slate-700 rounded w-16" />
          <div className="h-3 bg-slate-700/60 rounded w-24" />
        </div>
      </div>
    );
  }

  const trendColor =
    trend > 0 ? 'text-emerald-400' :
    trend < 0 ? 'text-red-400' :
    'text-slate-500';

  const TrendIcon =
    trend > 0 ? TrendingUp :
    trend < 0 ? TrendingDown :
    Minus;

  return (
    <div className="card flex items-center gap-3 group hover:border-slate-600 transition-colors">
      {Icon && (
        <div className={`w-10 h-10 rounded-lg ${palette.iconBg} flex items-center justify-center ${palette.text} transition-transform group-hover:scale-105`}>
          <Icon size={20} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-2xl font-bold ${palette.text} tabular-nums`}>{value ?? '—'}</p>
          {trend != null && trend !== 0 && (
            <span className={`flex items-center gap-0.5 text-xs font-medium ${trendColor}`}>
              <TrendIcon size={12} />
              {Math.abs(trend)}%
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400">{label}</p>
        {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
        {trendLabel && <p className="text-[10px] text-slate-600 mt-0.5">{trendLabel}</p>}
      </div>
    </div>
  );
}
