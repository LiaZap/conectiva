import { Server } from 'socket.io';

let io = null;

export const EVENTS = {
  NOVA_MENSAGEM: 'nova_mensagem',
  IA_CLASSIFICOU: 'ia_classificou',
  CHAMANDO_MK: 'chamando_mk',
  MK_RETORNOU: 'mk_retornou',
  RESPOSTA_ENVIADA: 'resposta_enviada',
  ESCALONAMENTO: 'escalonamento',
  SESSAO_ENCERRADA: 'sessao_encerrada',
};

/**
 * Inicializa o Socket.IO no servidor HTTP.
 */
export function init(server) {
  io = new Server(server, {
    cors: {
      origin: [
        'http://localhost:3001',
        'http://127.0.0.1:3001',
        process.env.DASHBOARD_ORIGIN,
        process.env.WIDGET_ORIGIN,
      ].filter(Boolean),
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log('[ws] Cliente conectou:', socket.id);

    socket.on('join_session', (sessionId) => {
      socket.join(`session:${sessionId}`);
      console.log('[ws] join_session', { socketId: socket.id, sessionId });
    });

    socket.on('leave_session', (sessionId) => {
      socket.leave(`session:${sessionId}`);
      console.log('[ws] leave_session', { socketId: socket.id, sessionId });
    });

    socket.on('disconnect', () => {
      console.log('[ws] Cliente desconectou:', socket.id);
    });
  });

  console.log('[ws] Socket.IO inicializado');
  return io;
}

/**
 * Emite evento para TODOS os clientes conectados.
 */
export function emit(evento, dados) {
  if (!io) return;
  const payload = { ...dados, timestamp: new Date().toISOString() };
  io.emit(evento, payload);
  console.log('[ws] emit', { evento, session_id: dados?.session_id });
}

/**
 * Emite evento só para quem está monitorando uma sessão específica (room).
 */
export function emitToSession(sessionId, evento, dados) {
  if (!io) return;
  const payload = { ...dados, timestamp: new Date().toISOString() };
  io.to(`session:${sessionId}`).emit(evento, payload);
  console.log('[ws] emitToSession', { evento, sessionId });
}

export function getIO() {
  return io;
}
