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
        <h1 className="text-lg font-bold text-emerald-400 tracking-tight">Conectiva Bot</h1>
        <p className="text-xs text-slate-400 mt-0.5">Painel de Monitoramento</p>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
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
            <><Wifi size={14} className="text-emerald-400" /><span className="text-emerald-400">Conectado</span></>
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
