import axios from 'axios';
import { config } from '../config/env.js';

export const ACTIONS = {
  CONSULTAR_CLIENTE:    '/webhook/mk-consulta-doc',
  FATURAS_PENDENTES:    '/webhook/mk-faturas-pendentes',
  SEGUNDA_VIA:          '/webhook/mk-segunda-via',
  CONEXOES_CLIENTE:     '/webhook/mk-conexoes',
  CONTRATOS_CLIENTE:    '/webhook/mk-contratos',
  CRIAR_OS:             '/webhook/mk-criar-os',
  AUTO_DESBLOQUEIO:     '/webhook/mk-auto-desbloqueio',
  NOVO_CONTRATO:        '/webhook/mk-novo-contrato',
  NOVA_LEAD:            '/webhook/mk-nova-lead',
  FATURAS_AVANCADO:     '/webhook/mk-faturas-avancado',
  ATUALIZAR_CADASTRO:   '/webhook/mk-atualizar-cadastro',
  CONSULTAR_CADASTRO:   '/webhook/mk-consulta-doc',
};

const client = axios.create({
  baseURL: config.n8nWebhookUrl,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

export async function execute({ action, params, session_id }) {
  const endpoint = ACTIONS[action];
  if (!endpoint) {
    return { success: false, data: null, endpoint: action, tempo_ms: 0, error: `Ação desconhecida: ${action}` };
  }

  const start = Date.now();

  try {
    const { data } = await client.post(endpoint, { ...params, session_id });
    const tempo_ms = Date.now() - start;

    console.log('[n8n] execute', { action, endpoint, tempo_ms: `${tempo_ms}ms`, success: true });

    return { success: true, data, endpoint, tempo_ms };
  } catch (err) {
    const tempo_ms = Date.now() - start;
    const message = err.response?.data?.message || err.message;

    console.error('[n8n] execute erro', { action, endpoint, tempo_ms: `${tempo_ms}ms`, error: message });

    return { success: false, data: null, endpoint, tempo_ms, error: message };
  }
}
