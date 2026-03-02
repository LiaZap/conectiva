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
      {/* Logo + Header */}
      <div className="p-4 border-b border-conectiva-500/20 bg-gradient-to-b from-conectiva-950/40 to-transparent">
        <div className="flex items-center justify-center mb-2">
          <img src={`${import.meta.env.BASE_URL}logo_conectiva.png`} alt="Conectiva Internet" className="h-9 w-auto brightness-125" />
        </div>
        <p className="text-[11px] text-dourado-400 font-semibold text-center tracking-wide">Painel de Monitoramento</p>
      </div>

      {/* Navegação */}
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-conectiva-500/10 text-white border-l-2 border-dourado-400'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`
            }
          >
            <Icon size={18} className={undefined} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Status conexão */}
      <div className="p-4 border-t border-slate-700">
        <div className="flex items-center gap-2 text-xs">
          {connected ? (
            <><Wifi size={14} className="text-dourado-400" /><span className="text-dourado-400">Conectado</span></>
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
