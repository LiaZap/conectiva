/**
 * settings.js — Serviço de configurações dinâmicas
 *
 * Cache em memória carregado do PostgreSQL.
 * Helpers para montar prompts dinâmicos da IA.
 */

import { query } from '../config/database.js';

// ── Cache em memória ──
let cache = new Map();

/**
 * Carrega todas as configurações ativas do banco para o cache.
 */
export async function loadAll() {
  try {
    const { rows } = await query(
      'SELECT * FROM settings WHERE ativo = true ORDER BY categoria, ordem'
    );
    cache.clear();
    for (const row of rows) {
      cache.set(`${row.categoria}:${row.chave}`, {
        ...row,
        valor: typeof row.valor === 'string' ? JSON.parse(row.valor) : row.valor,
      });
    }
    console.log(`[settings] ${cache.size} configurações carregadas`);
  } catch (err) {
    console.error('[settings] Erro ao carregar configurações:', err.message);
  }
}

/**
 * Retorna todas as configurações de uma categoria.
 */
export function getByCategory(categoria) {
  return [...cache.values()].filter((r) => r.categoria === categoria);
}

/**
 * Retorna o valor de uma configuração específica.
 */
export function getByKey(categoria, chave) {
  return cache.get(`${categoria}:${chave}`)?.valor || null;
}

/**
 * Retorna todas as configurações agrupadas por categoria (para API).
 */
export function getAll() {
  return [...cache.values()];
}

/**
 * Cria ou atualiza uma configuração.
 */
export async function upsert(categoria, chave, valor, descricao, ordem, updatedBy) {
  await query(
    `INSERT INTO settings (categoria, chave, valor, descricao, ordem, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (categoria, chave) DO UPDATE SET
       valor = $3, descricao = COALESCE($4, settings.descricao),
       ordem = COALESCE($5, settings.ordem),
       updated_by = $6, updated_at = NOW()`,
    [categoria, chave, JSON.stringify(valor), descricao, ordem, updatedBy]
  );
  await loadAll();
}

/**
 * Desativa uma configuração (soft delete).
 */
export async function remove(categoria, chave) {
  await query(
    'UPDATE settings SET ativo = false, updated_at = NOW() WHERE categoria = $1 AND chave = $2',
    [categoria, chave]
  );
  await loadAll();
}

/**
 * Deleta permanentemente uma configuração.
 */
export async function hardDelete(categoria, chave) {
  await query('DELETE FROM settings WHERE categoria = $1 AND chave = $2', [categoria, chave]);
  await loadAll();
}

// ═══════════════════════════════════════════════
// Helpers para montar prompts dinâmicos da IA
// ═══════════════════════════════════════════════

export function getAgentName() {
  const ia = getByKey('ia', 'personalidade');
  return ia?.nome_atendente || 'Ana';
}

export function getCompanyName() {
  const info = getByKey('empresa', 'info_geral');
  return info?.nome || 'Conectiva Internet';
}

export function buildCompanyText() {
  const info = getByKey('empresa', 'info_geral');
  const valores = getByKey('empresa', 'valores');
  const cobertura = getByKey('empresa', 'cobertura');

  if (!info) {
    return `- Provedor de internet por *fibra óptica*`;
  }

  const lines = [];
  lines.push(`- Provedor de internet por *fibra óptica* com mais de *${info.total_clientes || '7 mil'} clientes* e *${info.total_empresas || '300+'} empresas* atendidas`);
  if (info.km_fibra) lines.push(`- Mais de *${info.km_fibra} km de fibra óptica* instalada na região metropolitana de BH`);
  if (cobertura?.areas?.length) {
    lines.push(`- Áreas de cobertura: *${cobertura.areas.join(', ')}*`);
  }
  if (valores?.lista?.length) {
    lines.push(`- Valores: ${valores.lista.join(', ')}`);
  }
  return lines.join('\n');
}

export function buildPlansText() {
  const planos = getByCategory('planos').map((p) => p.valor);
  if (planos.length === 0) {
    return `- 📶 *600 MEGA* — *R$ 99,90*/mês\n- 📶 *800 MEGA* — *R$ 129,90*/mês\n- 🚀 *1 GIGA* — *R$ 139,90*/mês`;
  }
  return planos
    .map((p) => {
      const beneficios = p.beneficios?.length ? ` (inclui ${p.beneficios.join(' + ')})` : '';
      const preco = typeof p.preco === 'number' ? p.preco.toFixed(2).replace('.', ',') : p.preco;
      const destaque = p.destaque ? ' (nosso plano mais completo!)' : '';
      return `- ${p.emoji || '📶'} *${p.nome}* — *R$ ${preco}*/mês${destaque}${beneficios}`;
    })
    .join('\n');
}

export function buildPlanCodesText() {
  const planos = getByCategory('planos').map((p) => p.valor);
  if (planos.length === 0) {
    return `    - 600 MB → 1326\n    - 800 MB → 1320\n    - 1 GB → 1327`;
  }
  return planos
    .filter((p) => p.cod_mk)
    .map((p) => `    - ${p.nome} → ${p.cod_mk}`)
    .join('\n');
}

export function buildPlanNamesForRestriction() {
  const planos = getByCategory('planos').map((p) => p.valor);
  return planos.map((p) => p.nome).join(', ');
}

export function buildServicesText() {
  const servicos = getByKey('ia', 'servicos_extras');
  if (!servicos?.lista?.length) {
    return `- *Telefonia Móvel*: Planos através de parcerias com Vivo e TIM\n- *Combos*: Internet + Telefonia com desconto\n- *App Conectiva*: Para consultar 2ª via de boleto e suporte rápido`;
  }
  return servicos.lista.map((s) => `- *${s}*`).join('\n');
}

export function buildStoresText() {
  const lojas = getByCategory('lojas').map((l) => l.valor);
  if (lojas.length === 0) {
    return `- 📍 *Matozinhos*: R. José Dias Corrêa, 87A — Centro`;
  }
  return lojas.map((l) => `- 📍 *${l.cidade}*: ${l.endereco}`).join('\n');
}

export function buildContactsText() {
  const contatos = getByKey('contatos', 'telefones');
  if (!contatos?.lista?.length) {
    return `- ☎️ *Matozinhos*: (31) 3712-1294`;
  }
  return contatos.lista.map((c) => `- ☎️ *${c.cidade}*: ${c.numero}`).join('\n');
}

export function buildContactsInline() {
  const contatos = getByKey('contatos', 'telefones');
  if (!contatos?.lista?.length) return 'Matozinhos (31) 3712-1294 | Lagoa Santa (31) 3268-4691';
  return contatos.lista.map((c) => `${c.cidade} ${c.numero}`).join(' | ');
}

export function getPhoneNumbers() {
  const contatos = getByKey('contatos', 'telefones');
  if (!contatos?.lista?.length) return '*(31) 3712-1294* ou *(31) 3268-4691*';
  return contatos.lista.map((c) => `*${c.numero}*`).join(' ou ');
}

export function getPaymentDays() {
  const regras = getByKey('regras', 'vencimentos');
  return regras?.dias_disponiveis || [10, 15, 20, 30];
}

export function getSessionTimeout() {
  const regras = getByKey('regras', 'sessao');
  return regras?.timeout_minutos || 30;
}
