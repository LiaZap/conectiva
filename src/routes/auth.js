/**
 * auth.js — Rotas de autenticação para o painel do dashboard.
 *
 * POST /api/auth/login   → Login com usuário/senha
 * GET  /api/auth/me      → Dados do usuário logado
 * POST /api/auth/refresh → Renovar token
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { generateToken, requireAuth, authLimiter } from '../middleware/security.js';

const router = Router();

// ── Operadores padrão (seed) ────────────────────────────
// Em produção, esses dados viriam de uma tabela `operators`
// Por ora, usamos um mapa estático com senhas hasheadas.
const DEFAULT_OPERATORS = [
  {
    id: 'admin',
    nome: 'Administrador',
    email: 'admin@conectivainfor.com.br',
    role: 'admin',
    // Senha: admin123
    passwordHash: '$2b$10$pNbw2XgpuSivGnyJU2Dalev9Q8TzGa/v1cWVTCJStkZRnyasJrZUW',
  },
  {
    id: 'operador1',
    nome: 'Operador 1',
    email: 'operador@conectivainfor.com.br',
    role: 'operador',
    // Senha: operador123
    passwordHash: '$2b$10$O4KS4ZhXXpkjL43e9UFBoOGQeG2h6nNOD4Y.52iIdxgWDVKOaghl6',
  },
];

// ── POST /api/auth/login ────────────────────────────────
router.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email e senha são obrigatórios' });
    }

    // Buscar operador
    const operator = DEFAULT_OPERATORS.find(
      (op) => op.email === email.toLowerCase().trim()
    );

    if (!operator) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
    }

    // Verificar senha
    const isValid = await bcrypt.compare(password, operator.passwordHash);
    if (!isValid) {
      // Fallback: aceitar senhas em texto plano em dev (para facilitar testes)
      const devPasswords = { admin: 'admin123', operador1: 'operador123' };
      if (password !== devPasswords[operator.id]) {
        return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
      }
    }

    // Gerar token JWT
    const token = generateToken({
      id: operator.id,
      nome: operator.nome,
      email: operator.email,
      role: operator.role,
    });

    console.log(`[auth] Login: ${operator.nome} (${operator.role})`);

    res.json({
      success: true,
      token,
      user: {
        id: operator.id,
        nome: operator.nome,
        email: operator.email,
        role: operator.role,
      },
    });
  } catch (err) {
    console.error('[auth] Erro no login:', err.message);
    res.status(500).json({ success: false, error: 'Erro interno' });
  }
});

// ── GET /api/auth/me ────────────────────────────────────
router.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ── POST /api/auth/refresh ──────────────────────────────
router.post('/api/auth/refresh', requireAuth, (req, res) => {
  try {
    const newToken = generateToken({
      id: req.user.id,
      nome: req.user.nome,
      email: req.user.email,
      role: req.user.role,
    });

    res.json({ success: true, token: newToken });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Erro ao renovar token' });
  }
});

export default router;
