import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';

const WS_URL = import.meta.env.VITE_WS_URL || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin);

const WebSocketContext = createContext(null);

const WS_EVENTS = [
  'nova_mensagem', 'ia_classificou', 'transcrevendo_audio', 'analisando_midia',
  'mensagem_atualizada', 'chamando_mk', 'mk_retornou', 'resposta_enviada',
  'escalonamento', 'sessao_encerrada', 'sessao_atualizada',
];

export function WebSocketProvider({ children }) {
  const { token, isAuthenticated } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef(new Map());

  useEffect(() => {
    // Só conectar se autenticado
    if (!isAuthenticated || !token) {
      setConnected(false);
      return;
    }

    const socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      console.error('[ws] Erro de conexão:', err.message);
      setConnected(false);
    });

    WS_EVENTS.forEach((evt) => {
      socket.on(evt, (data) => {
        const cbs = listenersRef.current.get(evt);
        if (cbs) cbs.forEach((cb) => cb(data));
      });
    });

    return () => { socket.disconnect(); };
  }, [token, isAuthenticated]); // Reconecta quando token muda

  const subscribe = useCallback((event, callback) => {
    if (!listenersRef.current.has(event)) listenersRef.current.set(event, new Set());
    listenersRef.current.get(event).add(callback);
    return () => listenersRef.current.get(event)?.delete(callback);
  }, []);

  const joinSession = useCallback((id) => socketRef.current?.emit('join_session', id), []);
  const leaveSession = useCallback((id) => socketRef.current?.emit('leave_session', id), []);

  return (
    <WebSocketContext.Provider value={{ connected, subscribe, joinSession, leaveSession }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWS() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWS must be used within WebSocketProvider');
  return ctx;
}
