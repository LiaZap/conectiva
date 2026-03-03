import { useEffect, useRef, useState, useCallback } from 'react';
import { useWS } from '../context/WebSocketContext.jsx';
import { useLocation } from 'react-router-dom';

/**
 * Hook global para alertas de escalonamento.
 * - Toca som de notificação
 * - Mostra browser Notification API
 * - Mantém contador de pendentes
 */
export default function useEscalationAlert() {
  const { subscribe } = useWS();
  const location = useLocation();
  const audioRef = useRef(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Criar Audio object uma vez
  useEffect(() => {
    audioRef.current = new Audio(`${import.meta.env.BASE_URL}notification.wav`);
    audioRef.current.volume = 0.7;

    // Pedir permissão para browser notifications
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Resetar contador quando navegar para /escalations
  useEffect(() => {
    if (location.pathname === '/escalations') {
      setPendingCount(0);
    }
  }, [location.pathname]);

  // Escutar evento de escalonamento
  useEffect(() => {
    const unsub = subscribe('escalonamento', (data) => {
      // Incrementar contador
      setPendingCount((prev) => prev + 1);

      // Tocar som
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }

      // Browser Notification
      if ('Notification' in window && Notification.permission === 'granted') {
        const cliente = data?.cliente || 'Cliente';
        const motivo = data?.motivo || 'Escalonamento';
        new Notification('🚨 Novo Escalonamento', {
          body: `${cliente} — ${motivo}`,
          icon: `${import.meta.env.BASE_URL}logo_conectiva.png`,
          tag: 'escalation-' + Date.now(),
        });
      }
    });

    return unsub;
  }, [subscribe]);

  const clearCount = useCallback(() => setPendingCount(0), []);

  return { pendingCount, clearCount };
}
