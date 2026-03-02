import { Server } from 'socket.io';
import { verifyToken } from '../middleware/security.js';
import { config } from '../config/env.js';

let io = null;

const JWT_SECRET_DEFAULT = 'conectiva-bot-secret-change-in-production';

export const EVENTS = {
  NOVA_MENSAGEM: 'nova_mensagem',
  IA_CLASSIFICOU: 'ia_classificou',
  TRANSCREVENDO_AUDIO: 'transcrevendo_audio',
  CHAMANDO_MK: 'chamando_mk',
  MK_RETORNOU: 'mk_retornou',
  RESPOSTA_ENVIADA: 'resposta_enviada',
  ESCALONAMENTO: 'escalonamento',
  SESSAO_ENCERRADA: 'sessao_encerrada',
  SESSAO_ATUALIZADA: 'sessao_atualizada',
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

  // ── Autenticação JWT no WebSocket ──
  const jwtSecret = process.env.JWT_SECRET || JWT_SECRET_DEFAULT;
  const isDev = config.nodeEnv === 'development' && jwtSecret === JWT_SECRET_DEFAULT;

  io.use((socket, next) => {
    // Em dev sem JWT_SECRET customizado, permitir sem token
    if (isDev) {
      socket.user = { id: 'dev', nome: 'Dev User', role: 'admin' };
      return next();
    }

    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Token de autenticação não fornecido'));
    }

    try {
      const decoded = verifyToken(token);
      socket.user = decoded;
      next();
    } catch (err) {
      console.error('[ws] Token inválido:', err.message);
      return next(new Error('Token inválido ou expirado'));
    }
  });

  io.on('connection', (socket) => {
    const userName = socket.user?.nome || socket.id;
    console.log('[ws] Cliente conectou:', socket.id, `(${userName})`);

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

  console.log('[ws] Socket.IO inicializado', isDev ? '(dev: auth desabilitado)' : '(auth habilitado)');
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
