import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { Radio, BarChart3, AlertTriangle, Settings, Wifi, WifiOff, LogOut, User, Loader2 } from 'lucide-react';
import { useWS } from './context/WebSocketContext.jsx';
import { useAuth } from './context/AuthContext.jsx';
import useEscalationAlert from './hooks/useEscalationAlert.js';
import NotificationBell from './components/NotificationBell.jsx';
import LiveMonitor from './pages/LiveMonitor.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import Metrics from './pages/Metrics.jsx';
import Escalations from './pages/Escalations.jsx';
import Login from './pages/Login.jsx';

const NAV = [
  { to: '/', icon: Radio, label: 'Monitor ao Vivo' },
  { to: '/metrics', icon: BarChart3, label: 'Métricas' },
  { to: '/escalations', icon: AlertTriangle, label: 'Escalonamentos' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
];

function Sidebar({ escalationCount, onClearEscalations }) {
  const { connected } = useWS();
  const { user, logout } = useAuth();

  return (
    <aside className="w-56 shrink-0 bg-slate-800 border-r border-slate-700 flex flex-col">
      {/* Logo + Header */}
      <div className="p-4 border-b border-conectiva-500/20 bg-gradient-to-b from-conectiva-950/40 to-transparent">
        <div className="flex items-center justify-center mb-2">
          <img src={`${import.meta.env.BASE_URL}logo_conectiva.png`} alt="Conectiva Internet" className="h-9 w-auto brightness-125" />
        </div>
        <div className="flex items-center justify-center gap-2">
          <p className="text-[11px] text-dourado-400 font-semibold text-center tracking-wide">Painel de Monitoramento</p>
          <NotificationBell count={escalationCount} onClear={onClearEscalations} />
        </div>
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
            {to === '/escalations' && escalationCount > 0 && (
              <span className="ml-auto text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 animate-pulse">
                {escalationCount > 9 ? '9+' : escalationCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Status conexão + Usuário + Logout */}
      <div className="p-4 border-t border-slate-700 space-y-3">
        <div className="flex items-center gap-2 text-xs">
          {connected ? (
            <><Wifi size={14} className="text-dourado-400" /><span className="text-dourado-400">Conectado</span></>
          ) : (
            <><WifiOff size={14} className="text-red-400" /><span className="text-red-400">Desconectado</span></>
          )}
        </div>

        {user && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <User size={14} className="text-slate-500 shrink-0" />
              <span className="text-xs text-slate-400 truncate">{user.nome}</span>
            </div>
            <button
              onClick={logout}
              title="Sair"
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-700/50 transition-colors"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();
  const { pendingCount, clearCount } = useEscalationAlert();

  // Validando token salvo...
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center gap-4 animate-slide-in">
          <img
            src={`${import.meta.env.BASE_URL}logo_conectiva.png`}
            alt="Conectiva Internet"
            className="h-10 w-auto brightness-125"
          />
          <Loader2 size={24} className="animate-spin text-conectiva-400" />
        </div>
      </div>
    );
  }

  // Não autenticado → tela de login
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Autenticado → dashboard completo
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar escalationCount={pendingCount} onClearEscalations={clearCount} />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<LiveMonitor />} />
          <Route path="/session/:id" element={<SessionDetail />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/escalations" element={<Escalations />} />
          <Route path="/settings" element={<div className="p-6 text-slate-400">Configurações — em breve</div>} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
