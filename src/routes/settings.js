/**
 * settings.js — Rotas de API para configurações dinâmicas
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/security.js';
import * as settings from '../services/settings.js';

const router = Router();

// ── GET /api/settings — Listar todas (opcionalmente filtrar por categoria) ──
router.get('/api/settings', requireAuth, (_req, res) => {
  try {
    const categoria = _req.query.categoria;
    const data = categoria
      ? settings.getByCategory(categoria)
      : settings.getAll();

    res.json({ success: true, data });
  } catch (err) {
    console.error('[settings-api] Erro ao listar:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao listar configurações' });
  }
});

// ── GET /api/settings/:categoria/:chave — Detalhe ──
router.get('/api/settings/:categoria/:chave', requireAuth, (req, res) => {
  try {
    const { categoria, chave } = req.params;
    const valor = settings.getByKey(categoria, chave);
    if (!valor) {
      return res.status(404).json({ success: false, error: 'Configuração não encontrada' });
    }
    res.json({ success: true, data: { categoria, chave, valor } });
  } catch (err) {
    console.error('[settings-api] Erro ao buscar:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao buscar configuração' });
  }
});

// ── PUT /api/settings/:categoria/:chave — Criar/Atualizar (admin only) ──
router.put('/api/settings/:categoria/:chave', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { categoria, chave } = req.params;
    const { valor, descricao, ordem } = req.body;

    if (valor === undefined || valor === null) {
      return res.status(400).json({ success: false, error: 'Campo "valor" é obrigatório' });
    }

    await settings.upsert(
      categoria, chave, valor, descricao || null, ordem ?? null, req.user?.nome || 'admin'
    );

    res.json({ success: true, message: 'Configuração salva' });
  } catch (err) {
    console.error('[settings-api] Erro ao salvar:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao salvar configuração' });
  }
});

// ── DELETE /api/settings/:categoria/:chave — Remover (admin only) ──
router.delete('/api/settings/:categoria/:chave', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { categoria, chave } = req.params;
    const permanent = req.query.permanent === 'true';

    if (permanent) {
      await settings.hardDelete(categoria, chave);
    } else {
      await settings.remove(categoria, chave);
    }

    res.json({ success: true, message: 'Configuração removida' });
  } catch (err) {
    console.error('[settings-api] Erro ao remover:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao remover configuração' });
  }
});

// ── POST /api/settings/planos — Adicionar novo plano (convenience) ──
router.post('/api/settings/planos', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nome, velocidade, preco, cod_mk, beneficios, emoji, destaque } = req.body;

    if (!nome || preco === undefined || !cod_mk) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: nome, preco, cod_mk' });
    }

    const chave = `plano_${nome.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const valor = {
      nome, velocidade: velocidade || '', preco: Number(preco),
      cod_mk: Number(cod_mk), beneficios: beneficios || [],
      emoji: emoji || '📶', destaque: destaque || false,
    };

    // Calcular próxima ordem
    const planos = settings.getByCategory('planos');
    const maxOrdem = planos.reduce((max, p) => Math.max(max, p.ordem || 0), 0);

    await settings.upsert('planos', chave, valor, `Plano ${nome}`, maxOrdem + 1, req.user?.nome || 'admin');
    res.json({ success: true, message: 'Plano adicionado', chave });
  } catch (err) {
    console.error('[settings-api] Erro ao adicionar plano:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao adicionar plano' });
  }
});

// ── POST /api/settings/lojas — Adicionar nova loja ──
router.post('/api/settings/lojas', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { cidade, endereco, telefone } = req.body;

    if (!cidade || !endereco) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: cidade, endereco' });
    }

    const chave = `loja_${cidade.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const valor = { cidade, endereco, telefone: telefone || '' };

    const lojas = settings.getByCategory('lojas');
    const maxOrdem = lojas.reduce((max, l) => Math.max(max, l.ordem || 0), 0);

    await settings.upsert('lojas', chave, valor, `Loja ${cidade}`, maxOrdem + 1, req.user?.nome || 'admin');
    res.json({ success: true, message: 'Loja adicionada', chave });
  } catch (err) {
    console.error('[settings-api] Erro ao adicionar loja:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao adicionar loja' });
  }
});

export default router;
