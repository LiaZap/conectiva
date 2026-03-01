import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000';

const WebSocketContext = createContext(null);

export function WebSocketProvider({ children }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef(new Map());

  useEffect(() => {
    const socket = io(WS_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    const events = [
      'nova_mensagem', 'ia_classificou', 'chamando_mk',
      'mk_retornou', 'resposta_enviada', 'escalonamento', 'sessao_encerrada',
    ];
    events.forEach((evt) => {
      socket.on(evt, (data) => {
        const cbs = listenersRef.current.get(evt);
        if (cbs) cbs.forEach((cb) => cb(data));
      });
    });

    return () => { socket.disconnect(); };
  }, []);

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
