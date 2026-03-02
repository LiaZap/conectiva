import { useState, useEffect, useMemo } from 'react';
import { Activity, Users, CheckCircle, Clock, AlertTriangle, Server, Target } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
  RadialBarChart, RadialBar,
} from 'recharts';
import MetricCard from '../components/MetricCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import {
  getMetricsOverview, getMetricsByChannel, getMetricsByIntent,
  getResolutionRate, getMkApis, getPerformance, getTopEscalations,
} from '../services/api.js';

const PERIODO_OPTS = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'semana', label: '7 dias' },
  { value: 'mes', label: '30 dias' },
];

const COLORS = ['#0693e3', '#fcb900', '#ffffff', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
const TOOLTIP_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12, color: '#e2e8f0' };

// ---- Gauge component (radial bar) ----
function GaugeChart({ value, meta, label }) {
  const pct = value ?? 0;
  const data = [{ name: label, value: pct, fill: pct >= meta ? '#0693e3' : pct >= meta * 0.7 ? '#f59e0b' : '#ef4444' }];

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={180}>
        <RadialBarChart cx="50%" cy="80%" innerRadius="70%" outerRadius="100%" startAngle={180} endAngle={0} barSize={14} data={data}>
          <RadialBar background={{ fill: '#1e293b' }} dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-6">
        <span className="text-3xl font-bold text-slate-100">{pct}%</span>
        <span className="text-[10px] text-slate-500">Meta: {meta}%</span>
      </div>
    </div>
  );
}

// ---- Heatmap component ----
function HeatmapGrid({ data }) {
  if (!data || data.length === 0) return <p className="text-sm text-slate-500 p-4">Sem dados</p>;

  const endpoints = [...new Set(data.map((d) => d.endpoint))];
  const maxTotal = Math.max(...data.map((d) => d.total), 1);

  return (
    <div className="overflow-x-auto">
      <div className="space-y-1.5">
        {endpoints.map((ep) => {
          const row = data.find((d) => d.endpoint === ep);
          const total = row?.total ?? 0;
          const intensity = Math.round((total / maxTotal) * 100);
          const bg = intensity > 75 ? 'bg-conectiva-500' : intensity > 50 ? 'bg-conectiva-600' : intensity > 25 ? 'bg-conectiva-700' : 'bg-conectiva-900';

          return (
            <div key={ep} className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 w-36 truncate text-right shrink-0">{ep}</span>
              <div className="flex-1 h-6 bg-slate-800 rounded overflow-hidden">
                <div className={`h-full ${bg} rounded flex items-center px-2 transition-all duration-500`} style={{ width: `${Math.max(intensity, 4)}%` }}>
                  <span className="text-[10px] text-white font-medium">{total}</span>
                </div>
              </div>
              <div className="flex gap-1 text-[10px] w-20 shrink-0">
                <span className="text-conectiva-400">{row?.sucesso ?? 0}</span>
                <span className="text-slate-600">/</span>
                <span className="text-red-400">{row?.erro ?? 0}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Metrics() {
  const [periodo, setPeriodo] = useState('semana');
  const [overview, setOverview] = useState({});
  const [byChannel, setByChannel] = useState([]);
  const [byIntent, setByIntent] = useState([]);
  const [resolution, setResolution] = useState([]);
  const [mkApis, setMkApis] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [topEscalations, setTopEscalations] = useState([]);

  useEffect(() => {
    Promise.allSettled([
      getMetricsOverview(periodo).then((r) => r.success && setOverview(r.data)),
      getMetricsByChannel(periodo).then((r) => r.success && setByChannel(r.data)),
      getMetricsByIntent(periodo).then((r) => r.success && setByIntent(r.data)),
      getResolutionRate(periodo).then((r) => r.success && setResolution(r.data)),
      getMkApis(periodo).then((r) => r.success && setMkApis(r.data)),
      getPerformance(periodo).then((r) => r.success && setPerformance(r.data)),
      getTopEscalations(periodo).then((r) => r.success && setTopEscalations(r.data)),
    ]);
  }, [periodo]);

  // Boletos por dia (from resolution data — uses interactions with SEGUNDA_VIA)
  const boletosData = useMemo(() =>
    resolution.map((d) => ({ dia: d.dia, total: d.total, automaticos: d.automaticos })),
    [resolution]
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Métricas</h1>
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
          {PERIODO_OPTS.map((o) => (
            <button key={o.value} onClick={() => setPeriodo(o.value)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${periodo === o.value ? 'bg-dourado-400 text-slate-900 font-semibold' : 'text-slate-400 hover:text-white'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* LINHA 1 — Cards grandes + Gauge */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={Activity} label="Total atendimentos" color="white"
          value={overview.total_atendimentos ?? '—'}
        />

        {/* Gauge — Taxa resolução */}
        <div className="card">
          <h3 className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Target size={12} /> Taxa resolução automática</h3>
          <GaugeChart value={Number(overview.taxa_resolucao_automatica) || 0} meta={70} label="Resolução" />
        </div>

        <MetricCard
          icon={Clock} label="Tempo médio resposta" color="dourado"
          value={overview.tempo_medio_resposta_ms ? `${(overview.tempo_medio_resposta_ms / 1000).toFixed(1)}s` : '—'}
        />

        <MetricCard
          icon={AlertTriangle} label="Escalonamentos pendentes" color={overview.total_escalonados > 0 ? 'red' : 'conectiva'}
          value={overview.total_escalonados ?? 0}
          sub={overview.total_escalonados > 0 ? 'Requer atenção' : 'Tudo em dia'}
        />
      </div>

      {/* LINHA 2 — Atendimentos por dia + Pizza por canal */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Atendimentos por dia</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={resolution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="total" stroke="#0693e3" strokeWidth={2} dot={false} name="Total" />
              <Line type="monotone" dataKey="automaticos" stroke="#fcb900" strokeWidth={2} dot={false} name="Automáticos" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Por canal</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={byChannel} dataKey="total" nameKey="canal" cx="50%" cy="50%" outerRadius={95} innerRadius={50}
                label={({ canal, total, percent }) => `${canal}: ${total} (${(percent * 100).toFixed(0)}%)`}
                labelLine={{ stroke: '#64748b' }}>
                {byChannel.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LINHA 3 — Top intenções (barras horizontais) + Resolução por dia (barras) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Top intenções</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byIntent} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis dataKey="intencao" type="category" tick={{ fill: '#94a3b8', fontSize: 10 }} width={120} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {byIntent.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Resolução automática por dia</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={resolution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="%" />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="taxa" radius={[4, 4, 0, 0]} fill="#0693e3" name="Taxa %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LINHA 4 — Heatmap APIs MK + Top motivos escalonamento */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Server size={14} /> APIs MK — chamadas por endpoint
          </h3>
          <HeatmapGrid data={mkApis} />
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <AlertTriangle size={14} /> Top motivos de escalonamento
          </h3>
          {topEscalations.length > 0 ? (
            <div className="space-y-2">
              {topEscalations.map((e, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-700/50 last:border-0">
                  <span className="text-lg font-bold text-slate-600 w-6 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">{e.motivo}</p>
                    <StatusBadge value={e.prioridade} />
                  </div>
                  <span className="text-sm font-semibold text-slate-300">{e.total}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 py-4">Nenhum escalonamento no período</p>
          )}
        </div>
      </div>

      {/* LINHA 5 — Performance (tempos médios) */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <Clock size={14} /> Tempo médio por etapa (por dia)
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={performance}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="ms" />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="avg_ia_ms" stroke="#0693e3" strokeWidth={2} dot={false} name="IA (classificação)" />
            <Line type="monotone" dataKey="avg_mk_ms" stroke="#fcb900" strokeWidth={2} dot={false} name="API MK" />
            <Line type="monotone" dataKey="avg_total_ms" stroke="#ffffff" strokeWidth={2} dot={false} name="Total" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
