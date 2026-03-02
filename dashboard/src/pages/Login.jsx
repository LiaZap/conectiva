import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Lock, Mail, AlertCircle, Loader2 } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password);
      if (!result.success) {
        setError(result.error || 'Credenciais inválidas');
      }
      // Se sucesso, AuthContext atualiza state e App.jsx redireciona para o dashboard
    } catch {
      setError('Erro ao conectar. Tente novamente.');
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-slide-in">
        {/* Logo + Header */}
        <div className="text-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}logo_conectiva.png`}
            alt="Conectiva Internet"
            className="h-12 w-auto mx-auto mb-4 brightness-125"
          />
          <h1 className="text-lg font-semibold text-slate-200">Painel de Monitoramento</h1>
          <p className="text-sm text-dourado-400 mt-1">Acesso restrito</p>
        </div>

        {/* Card de Login */}
        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Email</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                autoFocus
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-700 border border-slate-600
                           text-sm text-slate-100 placeholder-slate-500
                           focus:border-conectiva-500 focus:outline-none focus:ring-1 focus:ring-conectiva-500/30
                           transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Senha</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                required
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-700 border border-slate-600
                           text-sm text-slate-100 placeholder-slate-500
                           focus:border-conectiva-500 focus:outline-none focus:ring-1 focus:ring-conectiva-500/30
                           transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-conectiva-500 hover:bg-conectiva-600
                       text-white text-sm font-medium transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 size={16} className="animate-spin" /> Entrando...</>
            ) : (
              'Entrar'
            )}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-600 mt-6">
          Conectiva Internet &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
