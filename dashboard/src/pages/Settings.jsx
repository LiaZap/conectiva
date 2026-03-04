import { useState, useEffect, useCallback } from 'react';
import { Package, Building2, MapPin, Phone, Bot, Sliders, Plus, Trash2, Save, Loader2, X, Pencil, Check } from 'lucide-react';
import { getSettings, updateSetting, deleteSetting, addPlan, addStore } from '../services/api.js';

const TABS = [
  { id: 'planos', label: 'Planos', icon: Package },
  { id: 'empresa', label: 'Empresa', icon: Building2 },
  { id: 'lojas', label: 'Lojas', icon: MapPin },
  { id: 'contatos', label: 'Contatos', icon: Phone },
  { id: 'ia', label: 'IA / Atendente', icon: Bot },
  { id: 'regras', label: 'Regras', icon: Sliders },
];

const inputClass = 'w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-sm text-slate-100 placeholder-slate-500 focus:border-conectiva-500 focus:outline-none focus:ring-1 focus:ring-conectiva-500/30 transition-colors';
const btnPrimary = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-conectiva-500 text-white text-xs font-semibold hover:bg-conectiva-600 transition-colors disabled:opacity-50';
const btnDanger = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition-colors';
const btnSecondary = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-600 transition-colors';

function Toast({ msg, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm shadow-lg animate-slide-in flex items-center gap-2">
      <Check size={14} /> {msg}
    </div>
  );
}

// ═══════════════════════════════════
// Seção: Planos
// ═══════════════════════════════════
function PlansSection({ data, onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [adding, setAdding] = useState(false);
  const [newPlan, setNewPlan] = useState({ nome: '', velocidade: '', preco: '', cod_mk: '', beneficios: '', emoji: '📶', destaque: false });

  const planos = data.filter((s) => s.categoria === 'planos');

  const startEdit = (p) => {
    setEditing(p.chave);
    setForm({ ...p.valor, beneficios: (p.valor.beneficios || []).join(', ') });
  };

  const saveEdit = async (chave) => {
    const valor = { ...form, preco: Number(form.preco), cod_mk: Number(form.cod_mk), beneficios: form.beneficios.split(',').map((b) => b.trim()).filter(Boolean), destaque: form.destaque || false };
    await onSave('planos', chave, valor);
    setEditing(null);
  };

  const saveNew = async () => {
    await addPlan({ ...newPlan, preco: Number(newPlan.preco), cod_mk: Number(newPlan.cod_mk), beneficios: newPlan.beneficios.split(',').map((b) => b.trim()).filter(Boolean) });
    setAdding(false);
    setNewPlan({ nome: '', velocidade: '', preco: '', cod_mk: '', beneficios: '', emoji: '📶', destaque: false });
    await onSave(); // reload
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">Planos de internet disponíveis para venda. Os preços e códigos MK são usados pelo bot automaticamente.</p>
        <button onClick={() => setAdding(true)} className={btnPrimary}><Plus size={14} /> Novo Plano</button>
      </div>

      {adding && (
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-dourado-400">Novo Plano</p>
          <div className="grid grid-cols-2 gap-3">
            <input className={inputClass} placeholder="Nome (ex: 600 MEGA)" value={newPlan.nome} onChange={(e) => setNewPlan({ ...newPlan, nome: e.target.value })} />
            <input className={inputClass} placeholder="Velocidade (ex: 600)" value={newPlan.velocidade} onChange={(e) => setNewPlan({ ...newPlan, velocidade: e.target.value })} />
            <input className={inputClass} placeholder="Preço (ex: 99.90)" type="number" step="0.01" value={newPlan.preco} onChange={(e) => setNewPlan({ ...newPlan, preco: e.target.value })} />
            <input className={inputClass} placeholder="Código MK (ex: 1326)" type="number" value={newPlan.cod_mk} onChange={(e) => setNewPlan({ ...newPlan, cod_mk: e.target.value })} />
            <input className={inputClass} placeholder="Benefícios (separar por vírgula)" value={newPlan.beneficios} onChange={(e) => setNewPlan({ ...newPlan, beneficios: e.target.value })} />
            <input className={inputClass} placeholder="Emoji (ex: 📶)" value={newPlan.emoji} onChange={(e) => setNewPlan({ ...newPlan, emoji: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={newPlan.destaque} onChange={(e) => setNewPlan({ ...newPlan, destaque: e.target.checked })} className="rounded" />
            Plano destaque (mais completo)
          </label>
          <div className="flex gap-2">
            <button onClick={saveNew} className={btnPrimary} disabled={!newPlan.nome || !newPlan.preco || !newPlan.cod_mk}><Save size={14} /> Salvar</button>
            <button onClick={() => setAdding(false)} className={btnSecondary}><X size={14} /> Cancelar</button>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {planos.map((p) => (
          <div key={p.chave} className="card">
            {editing === p.chave ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input className={inputClass} value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome" />
                  <input className={inputClass} value={form.velocidade || ''} onChange={(e) => setForm({ ...form, velocidade: e.target.value })} placeholder="Velocidade" />
                  <input className={inputClass} value={form.preco || ''} onChange={(e) => setForm({ ...form, preco: e.target.value })} placeholder="Preço" type="number" step="0.01" />
                  <input className={inputClass} value={form.cod_mk || ''} onChange={(e) => setForm({ ...form, cod_mk: e.target.value })} placeholder="Código MK" type="number" />
                  <input className={inputClass} value={form.beneficios || ''} onChange={(e) => setForm({ ...form, beneficios: e.target.value })} placeholder="Benefícios (separar por vírgula)" />
                  <input className={inputClass} value={form.emoji || ''} onChange={(e) => setForm({ ...form, emoji: e.target.value })} placeholder="Emoji" />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={form.destaque || false} onChange={(e) => setForm({ ...form, destaque: e.target.checked })} className="rounded" />
                  Plano destaque
                </label>
                <div className="flex gap-2">
                  <button onClick={() => saveEdit(p.chave)} className={btnPrimary}><Save size={14} /> Salvar</button>
                  <button onClick={() => setEditing(null)} className={btnSecondary}><X size={14} /> Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{p.valor.emoji || '📶'}</span>
                  <div>
                    <p className="text-sm font-semibold text-white">{p.valor.nome} {p.valor.destaque && <span className="text-dourado-400 text-[10px]">DESTAQUE</span>}</p>
                    <p className="text-xs text-slate-400">R$ {Number(p.valor.preco).toFixed(2).replace('.', ',')}/mês — Código MK: {p.valor.cod_mk}</p>
                    {p.valor.beneficios?.length > 0 && <p className="text-[10px] text-slate-500 mt-0.5">{p.valor.beneficios.join(' + ')}</p>}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(p)} className={btnSecondary}><Pencil size={12} /> Editar</button>
                  <button onClick={() => onDelete('planos', p.chave)} className={btnDanger}><Trash2 size={12} /></button>
                </div>
              </div>
            )}
          </div>
        ))}
        {planos.length === 0 && <p className="text-xs text-slate-500 text-center py-4">Nenhum plano cadastrado</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════
// Seção: Empresa
// ═══════════════════════════════════
function CompanySection({ data, onSave }) {
  const infoRaw = data.find((s) => s.chave === 'info_geral');
  const valoresRaw = data.find((s) => s.chave === 'valores');
  const coberturaRaw = data.find((s) => s.chave === 'cobertura');

  const [info, setInfo] = useState(infoRaw?.valor || {});
  const [valores, setValores] = useState((valoresRaw?.valor?.lista || []).join(', '));
  const [cobertura, setCobertura] = useState((coberturaRaw?.valor?.areas || []).join(', '));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave('empresa', 'info_geral', info);
    await onSave('empresa', 'valores', { lista: valores.split(',').map((v) => v.trim()).filter(Boolean) });
    await onSave('empresa', 'cobertura', { areas: cobertura.split(',').map((a) => a.trim()).filter(Boolean) });
    setSaving(false);
  };

  return (
    <div className="card space-y-4">
      <p className="text-sm font-semibold text-dourado-400">Informações da Empresa</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Nome da empresa</label>
          <input className={inputClass} value={info.nome || ''} onChange={(e) => setInfo({ ...info, nome: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Descrição</label>
          <input className={inputClass} value={info.descricao || ''} onChange={(e) => setInfo({ ...info, descricao: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Total de clientes</label>
          <input className={inputClass} value={info.total_clientes || ''} onChange={(e) => setInfo({ ...info, total_clientes: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Total de empresas</label>
          <input className={inputClass} value={info.total_empresas || ''} onChange={(e) => setInfo({ ...info, total_empresas: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Km de fibra</label>
          <input className={inputClass} value={info.km_fibra || ''} onChange={(e) => setInfo({ ...info, km_fibra: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Valores da empresa (separar por vírgula)</label>
        <input className={inputClass} value={valores} onChange={(e) => setValores(e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Áreas de cobertura (separar por vírgula)</label>
        <input className={inputClass} value={cobertura} onChange={(e) => setCobertura(e.target.value)} />
      </div>
      <button onClick={save} className={btnPrimary} disabled={saving}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
      </button>
    </div>
  );
}

// ═══════════════════════════════════
// Seção: Lojas
// ═══════════════════════════════════
function StoresSection({ data, onSave, onDelete }) {
  const lojas = data.filter((s) => s.categoria === 'lojas');
  const [adding, setAdding] = useState(false);
  const [newStore, setNewStore] = useState({ cidade: '', endereco: '', telefone: '' });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});

  const saveNew = async () => {
    await addStore(newStore);
    setAdding(false);
    setNewStore({ cidade: '', endereco: '', telefone: '' });
    await onSave();
  };

  const saveEdit = async (chave) => {
    await onSave('lojas', chave, form);
    setEditing(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">Lojas físicas exibidas no atendimento do bot.</p>
        <button onClick={() => setAdding(true)} className={btnPrimary}><Plus size={14} /> Nova Loja</button>
      </div>

      {adding && (
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-dourado-400">Nova Loja</p>
          <div className="grid grid-cols-3 gap-3">
            <input className={inputClass} placeholder="Cidade" value={newStore.cidade} onChange={(e) => setNewStore({ ...newStore, cidade: e.target.value })} />
            <input className={inputClass} placeholder="Endereço" value={newStore.endereco} onChange={(e) => setNewStore({ ...newStore, endereco: e.target.value })} />
            <input className={inputClass} placeholder="Telefone" value={newStore.telefone} onChange={(e) => setNewStore({ ...newStore, telefone: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button onClick={saveNew} className={btnPrimary} disabled={!newStore.cidade || !newStore.endereco}><Save size={14} /> Salvar</button>
            <button onClick={() => setAdding(false)} className={btnSecondary}><X size={14} /> Cancelar</button>
          </div>
        </div>
      )}

      {lojas.map((l) => (
        <div key={l.chave} className="card">
          {editing === l.chave ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <input className={inputClass} value={form.cidade || ''} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
                <input className={inputClass} value={form.endereco || ''} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
                <input className={inputClass} value={form.telefone || ''} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => saveEdit(l.chave)} className={btnPrimary}><Save size={14} /> Salvar</button>
                <button onClick={() => setEditing(null)} className={btnSecondary}><X size={14} /> Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">📍 {l.valor.cidade}</p>
                <p className="text-xs text-slate-400">{l.valor.endereco} {l.valor.telefone && `— ${l.valor.telefone}`}</p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => { setEditing(l.chave); setForm(l.valor); }} className={btnSecondary}><Pencil size={12} /> Editar</button>
                <button onClick={() => onDelete('lojas', l.chave)} className={btnDanger}><Trash2 size={12} /></button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════
// Seção: Contatos
// ═══════════════════════════════════
function ContactsSection({ data, onSave }) {
  const raw = data.find((s) => s.chave === 'telefones');
  const [lista, setLista] = useState(raw?.valor?.lista || []);
  const [saving, setSaving] = useState(false);

  const update = (i, field, val) => {
    const copy = [...lista];
    copy[i] = { ...copy[i], [field]: val };
    setLista(copy);
  };

  const save = async () => {
    setSaving(true);
    await onSave('contatos', 'telefones', { lista });
    setSaving(false);
  };

  return (
    <div className="card space-y-4">
      <p className="text-sm font-semibold text-dourado-400">Telefones de Contato</p>
      <p className="text-xs text-slate-400">Esses números são exibidos pelo bot quando o cliente precisa ligar.</p>
      {lista.map((c, i) => (
        <div key={i} className="flex items-center gap-3">
          <input className={inputClass} value={c.cidade} onChange={(e) => update(i, 'cidade', e.target.value)} placeholder="Cidade" />
          <input className={inputClass} value={c.numero} onChange={(e) => update(i, 'numero', e.target.value)} placeholder="(31) 3712-1294" />
          <button onClick={() => setLista(lista.filter((_, j) => j !== i))} className={btnDanger}><Trash2 size={12} /></button>
        </div>
      ))}
      <button onClick={() => setLista([...lista, { cidade: '', numero: '' }])} className={btnSecondary}><Plus size={14} /> Adicionar telefone</button>
      <button onClick={save} className={btnPrimary} disabled={saving}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
      </button>
    </div>
  );
}

// ═══════════════════════════════════
// Seção: IA / Atendente
// ═══════════════════════════════════
function AISection({ data, onSave }) {
  const persRaw = data.find((s) => s.chave === 'personalidade');
  const servRaw = data.find((s) => s.chave === 'servicos_extras');

  const [pers, setPers] = useState(persRaw?.valor || {});
  const [servicos, setServicos] = useState((servRaw?.valor?.lista || []).join('\n'));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave('ia', 'personalidade', pers);
    await onSave('ia', 'servicos_extras', { lista: servicos.split('\n').map((s) => s.trim()).filter(Boolean) });
    setSaving(false);
  };

  return (
    <div className="card space-y-4">
      <p className="text-sm font-semibold text-dourado-400">Personalidade da Atendente IA</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Nome da atendente</label>
          <input className={inputClass} value={pers.nome_atendente || ''} onChange={(e) => setPers({ ...pers, nome_atendente: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Cargo</label>
          <input className={inputClass} value={pers.cargo || ''} onChange={(e) => setPers({ ...pers, cargo: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-slate-400 mb-1 block">Tom de conversa</label>
          <input className={inputClass} value={pers.tom || ''} onChange={(e) => setPers({ ...pers, tom: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Max emojis por mensagem</label>
          <input className={inputClass} type="number" min="0" max="10" value={pers.max_emojis_por_msg || 3} onChange={(e) => setPers({ ...pers, max_emojis_por_msg: Number(e.target.value) })} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-xs text-slate-300 pb-2">
            <input type="checkbox" checked={pers.usar_emojis !== false} onChange={(e) => setPers({ ...pers, usar_emojis: e.target.checked })} className="rounded" />
            Usar emojis nas respostas
          </label>
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Outros serviços oferecidos (um por linha)</label>
        <textarea className={inputClass + ' min-h-[80px]'} value={servicos} onChange={(e) => setServicos(e.target.value)} rows={3} />
      </div>
      <button onClick={save} className={btnPrimary} disabled={saving}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
      </button>
    </div>
  );
}

// ═══════════════════════════════════
// Seção: Regras
// ═══════════════════════════════════
function RulesSection({ data, onSave }) {
  const vencRaw = data.find((s) => s.chave === 'vencimentos');
  const sessRaw = data.find((s) => s.chave === 'sessao');

  const [dias, setDias] = useState((vencRaw?.valor?.dias_disponiveis || []).join(', '));
  const [timeout, setTimeout_] = useState(sessRaw?.valor?.timeout_minutos || 30);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave('regras', 'vencimentos', { dias_disponiveis: dias.split(',').map((d) => Number(d.trim())).filter((d) => d > 0) });
    await onSave('regras', 'sessao', { timeout_minutos: Number(timeout) });
    setSaving(false);
  };

  return (
    <div className="card space-y-4">
      <p className="text-sm font-semibold text-dourado-400">Regras de Negócio</p>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Dias de vencimento disponíveis (separar por vírgula)</label>
        <input className={inputClass} value={dias} onChange={(e) => setDias(e.target.value)} placeholder="10, 15, 20, 30" />
      </div>
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Timeout de sessão (minutos)</label>
        <input className={inputClass} type="number" min="5" max="120" value={timeout} onChange={(e) => setTimeout_(e.target.value)} />
      </div>
      <button onClick={save} className={btnPrimary} disabled={saving}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
      </button>
    </div>
  );
}

// ═══════════════════════════════════
// Página principal
// ═══════════════════════════════════
export default function Settings() {
  const [activeTab, setActiveTab] = useState('planos');
  const [allData, setAllData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await getSettings();
      if (res.success) setAllData(res.data);
    } catch (err) {
      console.error('Erro ao carregar settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (cat, chave, valor) => {
    if (!cat) { await load(); return; } // reload only
    try {
      await updateSetting(cat, chave, { valor });
      setToast('Configuração salva com sucesso!');
      await load();
    } catch (err) {
      console.error('Erro ao salvar:', err);
    }
  };

  const handleDelete = async (cat, chave) => {
    if (!confirm('Tem certeza que deseja remover?')) return;
    try {
      await deleteSetting(cat, chave, true);
      setToast('Removido com sucesso!');
      await load();
    } catch (err) {
      console.error('Erro ao remover:', err);
    }
  };

  const tabData = allData.filter((s) => {
    if (activeTab === 'empresa') return s.categoria === 'empresa';
    if (activeTab === 'contatos') return s.categoria === 'contatos';
    if (activeTab === 'ia') return s.categoria === 'ia';
    if (activeTab === 'regras') return s.categoria === 'regras';
    return s.categoria === activeTab;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-conectiva-400" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      <h1 className="text-lg font-bold text-white flex items-center gap-2">
        <Sliders size={20} className="text-dourado-400" /> Configurações
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-dourado-400 text-slate-900 font-semibold'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'planos' && <PlansSection data={tabData} onSave={handleSave} onDelete={handleDelete} />}
      {activeTab === 'empresa' && <CompanySection data={tabData} onSave={handleSave} />}
      {activeTab === 'lojas' && <StoresSection data={tabData} onSave={handleSave} onDelete={handleDelete} />}
      {activeTab === 'contatos' && <ContactsSection data={tabData} onSave={handleSave} />}
      {activeTab === 'ia' && <AISection data={tabData} onSave={handleSave} />}
      {activeTab === 'regras' && <RulesSection data={tabData} onSave={handleSave} />}
    </div>
  );
}
