/**
 * security.js — Middleware de segurança da Conectiva IA
 *
 * Inclui: helmet, rate limiting, sanitização de inputs, JWT auth para dashboard.
 */

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

// ── JWT Secret ─────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'conectiva-bot-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// ── Helmet (HTTP security headers) ─────────────────────
export const helmetMiddleware = helmet({
  contentSecurityPolicy: false,   // Desabilitado para não quebrar o dashboard
  crossOriginEmbedderPolicy: false,
});

// ── Rate Limiters ──────────────────────────────────────

// Extrai IP real do cliente atrás de proxy (EasyPanel/Nginx/Traefik)
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// Geral: 100 req/min por IP
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas requisições. Tente novamente em 1 minuto.' },
  keyGenerator: getClientIp,
  validate: false,
});

// Webhooks: 30 req/min por IP (mais restrito)
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Limite de webhooks atingido.' },
  keyGenerator: getClientIp,
  validate: false,
});

// Auth: 10 tentativas/min (brute force protection)
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas de login. Aguarde 1 minuto.' },
  keyGenerator: getClientIp,
  validate: false,
});

// ── Sanitização de Inputs ──────────────────────────────

/**
 * Remove caracteres perigosos de strings para prevenir XSS/injection.
 * Aplicado apenas em strings, não altera números/booleans/objects.
 */
function sanitizeValue(value) {
  if (typeof value !== 'string') return value;

  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // scripts
    .replace(/<[^>]*>/g, '') // tags HTML
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeValue(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const sanitized = {};
  for (const [key, val] of Object.entries(obj)) {
    sanitized[sanitizeValue(key)] = sanitizeObject(val);
  }
  return sanitized;
}

export function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  next();
}

// ── JWT Authentication ─────────────────────────────────

/**
 * Gera um token JWT para o operador do dashboard.
 */
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifica e decodifica um token JWT.
 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Middleware de autenticação para rotas do dashboard/API.
 * Espera header: Authorization: Bearer <token>
 *
 * Em desenvolvimento, permite acesso sem token.
 */
export function requireAuth(req, res, next) {
  // Em dev, pular auth se não há JWT_SECRET customizado
  if (config.nodeEnv === 'development' && JWT_SECRET === 'conectiva-bot-secret-change-in-production') {
    req.user = { id: 'dev', nome: 'Dev User', role: 'admin' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token de autenticação não fornecido' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expirado' });
    }
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }
}

/**
 * Middleware de autorização — exige role 'admin'.
 */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Acesso restrito a administradores' });
  }
  next();
}

/**
 * Middleware opcional — loga a tentativa mas não bloqueia.
 * Útil para ter o user no req sem obrigar login.
 */
export function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(authHeader.split(' ')[1]);
    } catch (_) {
      req.user = null;
    }
  }
  next();
}
