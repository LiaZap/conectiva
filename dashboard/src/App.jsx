import { Routes, Route, NavLink } from 'react-router-dom';
import { Radio, BarChart3, AlertTriangle, Settings, Wifi, WifiOff } from 'lucide-react';
import { useWS } from './context/WebSocketContext.jsx';
import LiveMonitor from './pages/LiveMonitor.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import Metrics from './pages/Metrics.jsx';
import Escalations from './pages/Escalations.jsx';

const NAV = [
  { to: '/', icon: Radio, label: 'Monitor ao Vivo' },
  { to: '/metrics', icon: BarChart3, label: 'Métricas' },
  { to: '/escalations', icon: AlertTriangle, label: 'Escalonamentos' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
];

function Sidebar() {
  const { connected } = useWS();

  return (
    <aside className="w-56 shrink-0 bg-slate-800 border-r border-slate-700 flex flex-col">
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center gap-2.5 mb-1">
          {/* Logo Conectiva — ícone de sinal/onda */}
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
            <rect width="40" height="40" rx="10" fill="#0693e3" fillOpacity="0.15" />
            <path d="M20 28a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" fill="#0693e3" />
            <path d="M14.34 21.66a8 8 0 0 1 11.32 0" stroke="#0693e3" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M10.1 17.4a14 14 0 0 1 19.8 0" stroke="#0693e3" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M6.46 13.76a19 19 0 0 1 27.08 0" stroke="#0693e3" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
          </svg>
          <div>
            <h1 className="text-lg font-bold text-conectiva-400 tracking-tight leading-tight">Conectiva</h1>
            <p className="text-[10px] text-slate-500 font-medium tracking-wider uppercase">Internet</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-1">Painel de Monitoramento</p>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-conectiva-500/10 text-conectiva-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700">
        <div className="flex items-center gap-2 text-xs">
          {connected ? (
            <><Wifi size={14} className="text-conectiva-400" /><span className="text-conectiva-400">Conectado</span></>
          ) : (
            <><WifiOff size={14} className="text-red-400" /><span className="text-red-400">Desconectado</span></>
          )}
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<LiveMonitor />} />
          <Route path="/session/:id" element={<SessionDetail />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/escalations" element={<Escalations />} />
          <Route path="/settings" element={<div className="p-6 text-slate-400">Configurações — em breve</div>} />
        </Routes>
      </main>
    </div>
  );
}
