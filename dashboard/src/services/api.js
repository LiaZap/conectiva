import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000' : '');

const api = axios.create({
  baseURL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Sessions
export const getSessions = (params) => api.get('/api/sessions', { params }).then((r) => r.data);
export const getSession = (id) => api.get(`/api/sessions/${id}`).then((r) => r.data);
export const getSessionActions = (id) => api.get(`/api/sessions/${id}/actions`).then((r) => r.data);
export const takeoverSession = (id) => api.post(`/api/sessions/${id}/takeover`).then((r) => r.data);
export const releaseSession = (id) => api.post(`/api/sessions/${id}/release`).then((r) => r.data);
export const closeSession = (id) => api.post(`/api/sessions/${id}/close`).then((r) => r.data);
export const deleteSession = (id) => api.delete(`/api/sessions/${id}`).then((r) => r.data);

// Escalations
export const getEscalations = (params) => api.get('/api/escalations', { params }).then((r) => r.data);
export const assignEscalation = (id, atendente) => api.post(`/api/escalations/${id}/assign`, { atendente }).then((r) => r.data);
export const resolveEscalation = (id) => api.post(`/api/escalations/${id}/resolve`).then((r) => r.data);

// Metrics
export const getMetricsOverview = (periodo) => api.get('/api/metrics/overview', { params: { periodo } }).then((r) => r.data);
export const getMetricsByChannel = (periodo) => api.get('/api/metrics/by-channel', { params: { periodo } }).then((r) => r.data);
export const getMetricsByIntent = (periodo) => api.get('/api/metrics/by-intent', { params: { periodo } }).then((r) => r.data);
export const getResolutionRate = (periodo) => api.get('/api/metrics/resolution-rate', { params: { periodo } }).then((r) => r.data);
export const getMkApis = (periodo) => api.get('/api/metrics/mk-apis', { params: { periodo } }).then((r) => r.data);
export const getPerformance = (periodo) => api.get('/api/metrics/performance', { params: { periodo } }).then((r) => r.data);
export const getTopEscalations = (periodo) => api.get('/api/metrics/top-escalations', { params: { periodo } }).then((r) => r.data);

export default api;
