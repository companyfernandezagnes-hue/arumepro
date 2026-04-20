/**
 * ProveedoresView.tsx — Arume PRO
 * 
 * Mejoras v2:
 * 🆕 Historial de precios por producto/proveedor con gráfico
 * 🆕 Alerta de subida de precio (>5% respecto media)
 * 🆕 Días sin pedido con semáforo visual
 * 🆕 Score de fiabilidad (puntualidad, volumen, variación precios)
 * 🆕 Acceso rápido a últimos albaranes desde la ficha
 * 🆕 Exportar ficha proveedor a Excel
 * Preservado: comparador precios, briefing IA, CRUD, WhatsApp
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Users, Search, Plus, Phone, Mail, Truck, Star,
  X, Trash2, AlertTriangle, TrendingUp, TrendingDown,
  MessageCircle, ShieldCheck, CreditCard, Scale,
  ChevronRight, CheckCircle2, Loader2, Sparkles,
  Building2, BarChart3, Edit3, Save, MapPin, FileText,
  Clock, Award, AlertCircle, Download, Package,
  ArrowUpRight, ArrowDownRight, Calendar, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { EmptyState } from './EmptyState';
import {
  LineChart, Line, AreaChart, Area, ResponsiveContainer,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine
} from 'recharts';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData } from '../types';
import { askAI } from '../services/aiProviders';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

// ─── Tipo Proveedor ────────────────────────────────────────────────────────
export interface Proveedor {
  id        : string;
  n         : string;
  fam       : string;
  tel      ?: string;
  email    ?: string;
  contacto ?: string;
  direccion?: string;
  iban     ?: string;
  nif      ?: string;
  notas    ?: string;
  active   ?: boolean;
  unitId   ?: string;
}

interface Props {
  data  : AppData;
  onSave: (newData: AppData) => Promise<void>;
}

const FAMILIAS = ['General','Alimentación','Bebidas','Pescado','Carne','Limpieza','Mantenimiento','Tecnología','Sake','Otros'];

const emptyForm = (): Omit<Proveedor,'id'> => ({
  n:'', fam:'General', tel:'', email:'', contacto:'', direccion:'', iban:'', nif:'', notas:'', active:true,
});

// ─── Helper: stats de un proveedor ────────────────────────────────────────
const useProvStats = (provName: string, data: AppData) => {
  return useMemo(() => {
    const albs = (data.albaranes || []).filter(
      a => (a.prov || '').toUpperCase().trim() === provName.toUpperCase().trim()
    );
    const total    = albs.reduce((s, a) => s + Num.parse(a.total), 0);
    const lastDate = albs.map(a => a.date).sort().reverse()[0] || null;
    const count    = albs.length;
    const avgOrder = count > 0 ? Num.round2(total / count) : 0;

    // Días sin pedido
    const daysAgo = lastDate
      ? Math.round((Date.now() - new Date(lastDate).getTime()) / 86400000)
      : null;

    // Trend últimos 6 meses
    const now   = new Date();
    const trend = Array.from({ length: 6 }, (_, i) => {
      const d   = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const sum = albs.filter(a => (a.date||'').startsWith(key)).reduce((s,a) => s + Num.parse(a.total), 0);
      return { name: key.slice(5), total: Num.round2(sum) };
    });

    // 🆕 Historial de precios por ítem (últimas 10 compras de cada producto)
    const itemPrices: Record<string, { date: string; price: number }[]> = {};
    albs.forEach(a => {
      (a.items || []).forEach((item: any) => {
        const name = (item.n || item.name || '').trim().toUpperCase();
        if (!name || !item.unitPrice && !item.rate) return;
        const price = Num.parse(item.unitPrice || item.rate || 0);
        if (price <= 0) return;
        if (!itemPrices[name]) itemPrices[name] = [];
        itemPrices[name].push({ date: a.date || '', price });
      });
    });
    // Ordenar y limitar a 12 últimas
    Object.keys(itemPrices).forEach(k => {
      itemPrices[k] = itemPrices[k].sort((a,b) => a.date.localeCompare(b.date)).slice(-12);
    });

    // 🆕 Alertas de subida de precio por ítem (>5% vs media)
    const alertasPrecios: { item: string; pct: number; lastPrice: number; avgPrice: number }[] = [];
    Object.entries(itemPrices).forEach(([item, series]) => {
      if (series.length < 2) return;
      const last = series[series.length-1].price;
      const avg  = series.slice(0,-1).reduce((s,x) => s+x.price, 0) / (series.length-1);
      const pct  = avg > 0 ? ((last - avg) / avg) * 100 : 0;
      if (pct > 5) alertasPrecios.push({ item, pct: Num.round2(pct), lastPrice: last, avgPrice: Num.round2(avg) });
    });

    // 🆕 Score fiabilidad 0-100
    const volScore    = Math.min(count * 5, 40);          // hasta 40pts por volumen
    const recScore    = daysAgo !== null ? Math.max(0, 20 - daysAgo) : 0; // hasta 20pts por recencia
    const priceScore  = Math.max(0, 40 - alertasPrecios.length * 10);  // hasta 40pts si no sube precios
    const score       = Math.min(100, Math.round(volScore + recScore + priceScore));

    return { total, lastDate, count, avgOrder, trend, albs, daysAgo, itemPrices, alertasPrecios, score };
  }, [provName, data.albaranes]);
};

// ─── Semáforo días sin pedido ─────────────────────────────────────────────
const diasSemaforo = (days: number | null) => {
  if (days === null) return { cls: 'text-slate-400', label: 'Sin pedidos' };
  if (days === 0)   return { cls: 'text-emerald-600 font-black', label: 'Pedido hoy ✓' };
  if (days <= 3)    return { cls: 'text-emerald-500 font-bold', label: `Hace ${days}d` };
  if (days <= 14)   return { cls: 'text-amber-500 font-bold', label: `Hace ${days}d` };
  if (days <= 30)   return { cls: 'text-orange-500 font-bold', label: `Hace ${days}d` };
  return { cls: 'text-rose-600 font-black animate-pulse', label: `⚠ ${days}d sin pedido` };
};

// ════════════════════════════════════════════════════════════════════════════
export const ProveedoresView: React.FC<Props> = ({ data, onSave }) => {
  const proveedores: Proveedor[] = useMemo(
    () => Array.isArray((data as any).proveedores) ? (data as any).proveedores : [],
    [data]
  );

  const [search,       setSearch]       = useState('');
  const [famFilter,    setFamFilter]    = useState('Todas');
  const [selected,     setSelected]     = useState<Proveedor | null>(null);
  const [editMode,     setEditMode]     = useState(false);
  const [editForm,     setEditForm]     = useState<Partial<Proveedor>>({});
  const [showNew,      setShowNew]      = useState(false);
  const [newForm,      setNewForm]      = useState(emptyForm());
  const [saving,       setSaving]       = useState(false);
  const [delConfirm,   setDelConfirm]   = useState<string | null>(null);
  const [aiText,       setAiText]       = useState('');
  const [aiLoading,    setAiLoading]    = useState(false);
  const [showComparar, setShowComparar] = useState(false);
  // 🆕 Tab en la ficha del proveedor
  const [fichaTab,     setFichaTab]     = useState<'resumen'|'precios'|'albaranes'>('resumen');

  const familias = useMemo(() =>
    ['Todas', ...Array.from(new Set(proveedores.map(p => p.fam || 'General').filter(Boolean)))],
    [proveedores]
  );

  const filtered = useMemo(() =>
    proveedores.filter(p => {
      if (p.active === false) return false;
      const q = search.toLowerCase();
      const matchSearch = !q || p.n.toLowerCase().includes(q) || (p.contacto||'').toLowerCase().includes(q) || (p.fam||'').toLowerCase().includes(q);
      const matchFam    = famFilter === 'Todas' || p.fam === famFilter;
      return matchSearch && matchFam;
    }),
    [proveedores, search, famFilter]
  );

  // Top 3 por volumen
  const topProvs = useMemo(() =>
    [...proveedores]
      .filter(p => p.active !== false)
      .map(p => ({
        prov : p,
        total: (data.albaranes||[]).filter(a => (a.prov||'').toUpperCase().trim() === p.n.toUpperCase().trim()).reduce((s,a) => s+Num.parse(a.total), 0),
      }))
      .sort((a,b) => b.total - a.total)
      .slice(0, 3),
    [proveedores, data.albaranes]
  );

  // Comparador precios entre proveedores
  const comparadorData = useMemo(() => {
    const map: Record<string, Record<string, { total:number; count:number }>> = {};
    (data.albaranes||[]).forEach(a => {
      const prov = (a.prov||'Desconocido').toUpperCase().trim();
      (a.items||[]).forEach((item: any) => {
        const name = (item.n||item.name||'').trim();
        if (!name) return;
        if (!map[name]) map[name] = {};
        if (!map[name][prov]) map[name][prov] = { total:0, count:0 };
        map[name][prov].total += Num.parse(item.t||item.total||0);
        map[name][prov].count += Num.parse(item.q||1);
      });
    });
    return Object.entries(map)
      .filter(([,provs]) => Object.keys(provs).length > 1)
      .slice(0, 8)
      .map(([item, provs]) => {
        const entries = Object.entries(provs)
          .map(([prov, d]) => ({ prov, avg: d.count > 0 ? Num.round2(d.total/d.count) : 0 }))
          .sort((a,b) => a.avg - b.avg);
        return { item, best: entries[0], others: entries.slice(1) };
      });
  }, [data.albaranes]);

  // CRUD
  const saveProveedor = useCallback(async (prov: Proveedor) => {
    setSaving(true);
    try {
      const newData: any = { ...data };
      const list: Proveedor[] = Array.isArray(newData.proveedores) ? [...newData.proveedores] : [];
      const idx = list.findIndex(p => p.id === prov.id);
      if (idx >= 0) list[idx] = prov; else list.push(prov);
      newData.proveedores = list;
      await onSave(newData);
    } finally { setSaving(false); }
  }, [data, onSave]);

  const handleSaveNew = async () => {
    if (!newForm.n.trim()) return void toast.info('El nombre es obligatorio.');
    await saveProveedor({ id:`prov-${Date.now()}`, ...newForm });
    setShowNew(false); setNewForm(emptyForm());
  };

  const handleSaveEdit = async () => {
    if (!selected || !editForm.n?.trim()) return;
    await saveProveedor({ ...selected, ...editForm } as Proveedor);
    setSelected(prev => prev ? { ...prev, ...editForm } as Proveedor : null);
    setEditMode(false);
  };

  const handleDelete = async (id: string) => {
    const newData: any = { ...data };
    newData.proveedores = (newData.proveedores||[]).map((p: Proveedor) => p.id === id ? { ...p, active:false } : p);
    await onSave(newData);
    setDelConfirm(null); setSelected(null);
  };

  const openWhatsApp = (tel: string, name: string) => {
    const clean = tel.replace(/\D/g,'');
    window.open(`https://wa.me/${clean.startsWith('34')?clean:'34'+clean}?text=${encodeURIComponent(`Hola, soy Arume Sake Bar. Me pongo en contacto respecto a nuestros pedidos habituales.`)}`, '_blank');
  };

  // IA Briefing
  const generateBriefing = async (prov: Proveedor) => {
    const albs         = (data.albaranes||[]).filter(a => (a.prov||'').toUpperCase().trim() === prov.n.toUpperCase().trim());
    const totalGastado = albs.reduce((s,a) => s+Num.parse(a.total), 0);
    setAiLoading(true); setAiText('');
    try {
      const prompt = `Eres el Director de Compras de "Arume Sake Bar", restaurante japonés premium en Mallorca.
Proveedor: ${prov.n} (Categoría: ${prov.fam})
Total gastado: ${Num.fmt(totalGastado)} en ${albs.length} pedidos.
Último pedido: ${albs[0]?.date || 'desconocido'}.
Genera un briefing de negociación conciso (máx 120 palabras) con:
1. Análisis rápido de la relación comercial
2. 3 puntos concretos para negociar (descuentos, plazos, condiciones)
3. Tono recomendado para la próxima llamada`;
      const res = await askAI([{ role: 'user', content: prompt }]);
      setAiText(res.text || '');
    } catch (e) { setAiText(`Error: ${(e as Error).message}`); }
    finally { setAiLoading(false); }
  };

  // 🆕 Exportar ficha proveedor a Excel
  const exportarFicha = (prov: Proveedor) => {
    const albs = (data.albaranes||[]).filter(a => (a.prov||'').toUpperCase().trim() === prov.n.toUpperCase().trim());
    const rows = albs.map(a => ({
      'FECHA': a.date, 'Nº ALBARÁN': a.num,
      'TOTAL': Num.fmt(Num.parse(a.total)),
      'BASE': Num.fmt(Num.parse(a.base||0)),
      'PAGADO': a.paid ? 'SÍ' : 'NO',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${prov.n.slice(0,30)}`);
    XLSX.writeFile(wb, `Proveedor_${prov.n.replace(/\s/g,'_')}.xlsx`);
  };

  // ── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">

      {/* HEADER */}
      <header className="bg-white p-6 rounded-2xl shadow-sm border border-[color:var(--arume-gray-100)]">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Compras</p>
            <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight mt-1">Proveedores</h2>
            <p className="text-sm text-[color:var(--arume-gray-500)] mt-1 tabular-nums">{filtered.length} activos · {proveedores.filter(p=>p.active!==false).length} total</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowComparar(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)] text-[color:var(--arume-gray-600)] hover:bg-[color:var(--arume-gray-100)] transition">
              <Scale className="w-3.5 h-3.5"/> Comparador
            </button>
            <button onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition active:scale-[0.98]">
              <Plus className="w-3.5 h-3.5"/> Nuevo proveedor
            </button>
          </div>
        </div>

        {/* KPIs top proveedores */}
        {topProvs.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 pt-5 border-t border-slate-100">
            {topProvs.map(({prov, total}, i) => (
              <button key={prov.id} onClick={() => { setSelected(prov); setFichaTab('resumen'); }}
                className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition text-left group">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center text-white font-black text-sm flex-shrink-0",
                  i===0?"bg-amber-400":i===1?"bg-slate-400":"bg-amber-700/60")}>
                  {i+1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-slate-700 text-xs truncate">{prov.n}</p>
                  <p className="text-[10px] text-indigo-600 font-bold">{Num.fmt(total)}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-400"/>
              </button>
            ))}
          </div>
        )}
      </header>

      {/* FILTROS */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px] bg-white border border-slate-200 rounded-2xl flex items-center gap-2 px-4 py-2.5 shadow-sm">
          <Search className="w-4 h-4 text-slate-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar proveedor..."
            className="flex-1 bg-transparent text-xs font-bold outline-none text-slate-600"/>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {familias.map(f => (
            <button key={f} onClick={() => setFamFilter(f)}
              className={cn("px-3 py-1.5 rounded-xl text-[9px] font-black uppercase transition border",
                famFilter===f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300")}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* GRID PROVEEDORES */}
      {filtered.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-[color:var(--arume-gray-200)] rounded-2xl">
          <EmptyState
            icon={Users}
            eyebrow={proveedores.length === 0 ? 'Empezar' : 'Sin coincidencias'}
            title={proveedores.length === 0 ? 'Aún no hay proveedores' : 'Sin resultados'}
            message={
              proveedores.length === 0
                ? 'Añade tu primer proveedor para empezar a organizar compras, albaranes y comparar precios.'
                : 'Ningún proveedor coincide con la búsqueda actual. Prueba con otro nombre o quita filtros.'
            }
            action={
              proveedores.length === 0
                ? { label: 'Añadir proveedor', onClick: () => setShowNew(true), variant: 'primary', icon: Plus }
                : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(prov => (
            <ProveedorCard key={prov.id} prov={prov} data={data}
              onSelect={() => { setSelected(prov); setFichaTab('resumen'); setAiText(''); }}
              onDelete={() => setDelConfirm(prov.id)}
              onWhatsApp={openWhatsApp}/>
          ))}
        </div>
      )}

      {/* MODAL FICHA */}
      <AnimatePresence>
        {selected && (
          <ProveedorModal prov={selected} data={data}
            editMode={editMode} editForm={editForm} saving={saving}
            aiText={aiText} aiLoading={aiLoading}
            fichaTab={fichaTab} setFichaTab={setFichaTab}
            onClose={() => { setSelected(null); setEditMode(false); setAiText(''); }}
            onEdit={() => { setEditForm({...selected}); setEditMode(true); }}
            onCancelEdit={() => setEditMode(false)}
            onChangeForm={setEditForm}
            onSaveEdit={handleSaveEdit}
            onDelete={() => setDelConfirm(selected.id)}
            onWhatsApp={openWhatsApp}
            onBriefing={() => generateBriefing(selected)}
            onExport={() => exportarFicha(selected)}
          />
        )}
      </AnimatePresence>

      {/* MODAL NUEVO */}
      <AnimatePresence>
        {showNew && (
          <ProveedorFormModal title="Nuevo Proveedor" form={newForm} saving={saving} familias={FAMILIAS}
            onChange={setNewForm} onClose={() => setShowNew(false)} onSave={handleSaveNew}/>
        )}
      </AnimatePresence>

      {/* MODAL BORRAR */}
      <AnimatePresence>
        {delConfirm && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
            <motion.div initial={{scale:0.95}} animate={{scale:1}}
              className="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6 text-center">
              <div className="w-14 h-14 bg-rose-50 rounded-xl flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-7 h-7 text-rose-500"/>
              </div>
              <h3 className="text-sm font-black text-slate-800 uppercase mb-2">¿Eliminar Proveedor?</h3>
              <p className="text-xs font-medium text-slate-500 mb-6">Se archivará. El historial de albaranes se mantiene intacto.</p>
              <div className="flex gap-3">
                <button onClick={() => setDelConfirm(null)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-black text-[10px] uppercase hover:bg-slate-200 transition">Cancelar</button>
                <button onClick={() => handleDelete(delConfirm)} className="flex-1 py-2.5 bg-rose-600 text-white rounded-lg font-black text-[10px] uppercase hover:bg-rose-700 transition">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto"/> : 'Eliminar'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL COMPARADOR */}
      <AnimatePresence>
        {showComparar && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <motion.div initial={{scale:0.95,y:20}} animate={{scale:1,y:0}}
              className="bg-white rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
                <div className="flex items-center gap-2">
                  <Scale className="w-5 h-5 text-indigo-600"/>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Comparador de Precios por Producto</h3>
                </div>
                <button onClick={() => setShowComparar(false)} className="p-1.5 hover:bg-slate-200 rounded-lg transition">
                  <X className="w-4 h-4 text-slate-500"/>
                </button>
              </div>
              <div className="overflow-y-auto p-5 space-y-3">
                {comparadorData.length === 0 ? (
                  <div className="text-center py-12 opacity-50">
                    <BarChart3 className="w-10 h-10 text-slate-300 mx-auto mb-3"/>
                    <p className="text-xs font-bold text-slate-500">Necesitas albaranes con líneas de producto de al menos 2 proveedores.</p>
                  </div>
                ) : comparadorData.map((row, i) => (
                  <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{row.item}</p>
                      <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">Mejor precio: {row.best.prov}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white border border-emerald-200 rounded-lg p-3">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">{row.best.prov}</p>
                        <p className="text-lg font-black text-emerald-600">{Num.fmt(row.best.avg)}<span className="text-[9px] font-bold text-slate-400 ml-1">/ud</span></p>
                      </div>
                      <div className="space-y-2">
                        {row.others.map((o, j) => {
                          const diff = row.best.avg > 0 ? ((o.avg - row.best.avg) / row.best.avg) * 100 : 0;
                          return (
                            <div key={j} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                              <span className="text-[10px] font-bold text-slate-600 truncate max-w-[100px]">{o.prov}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-black text-rose-600">{Num.fmt(o.avg)}</span>
                                <span className="text-[9px] font-bold text-rose-500">+{Num.round2(diff)}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// TARJETA PROVEEDOR
// ════════════════════════════════════════════════════════════════════════════
const ProveedorCard: React.FC<{
  prov: Proveedor; data: AppData;
  onSelect: ()=>void; onDelete: ()=>void;
  onWhatsApp: (tel:string, name:string)=>void;
}> = ({ prov, data, onSelect, onDelete, onWhatsApp }) => {
  const stats  = useProvStats(prov.n, data);
  const semaf  = diasSemaforo(stats.daysAgo);
  const tieneAlertas = stats.alertasPrecios.length > 0;

  return (
    <motion.div whileHover={{y:-2}} className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all overflow-hidden">
      {/* Barra top con alertas */}
      {tieneAlertas && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0"/>
          <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest">
            {stats.alertasPrecios.length} subida{stats.alertasPrecios.length>1?'s':''} de precio detectada{stats.alertasPrecios.length>1?'s':''}
          </p>
        </div>
      )}

      <div className="p-5">
        {/* Cabecera */}
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-black text-slate-800 text-sm truncate">{prov.n}</p>
              {/* Score */}
              <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded-full border flex-shrink-0",
                stats.score >= 70 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                stats.score >= 40 ? "bg-amber-50 text-amber-700 border-amber-200" :
                "bg-rose-50 text-rose-700 border-rose-200")}>
                {stats.score}pts
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{prov.fam}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-slate-50 rounded-xl p-2 text-center">
            <p className="text-[9px] text-slate-400 font-bold uppercase">Volumen</p>
            <p className="text-xs font-black text-slate-700 tabular-nums">{Num.fmt(stats.total)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-2 text-center">
            <p className="text-[9px] text-slate-400 font-bold uppercase">Pedidos</p>
            <p className="text-xs font-black text-slate-700">{stats.count}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-2 text-center">
            <p className="text-[9px] text-slate-400 font-bold uppercase">Último</p>
            <p className={cn("text-xs font-black", semaf.cls)}>{stats.daysAgo !== null ? `${stats.daysAgo}d` : '—'}</p>
          </div>
        </div>

        {/* Mini gráfico trend */}
        {stats.count > 0 && (
          <div className="h-12 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trend} margin={{top:2,right:2,left:-40,bottom:0}}>
                <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} fill="#ede9fe" fillOpacity={0.6}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Acciones */}
        <div className="flex gap-2">
          {prov.tel && (
            <button onClick={() => onWhatsApp(prov.tel!, prov.n)}
              className="flex items-center justify-center gap-1 bg-emerald-50 text-emerald-700 py-2 px-3 rounded-lg font-black text-[9px] uppercase hover:bg-emerald-100 transition">
              <MessageCircle className="w-3 h-3"/> WA
            </button>
          )}
          <button onClick={onSelect}
            className="flex-1 flex items-center justify-center gap-1 bg-indigo-50 text-indigo-700 py-2 rounded-lg font-black text-[9px] uppercase hover:bg-indigo-100 transition">
            <ChevronRight className="w-3 h-3"/> Ficha
          </button>
        </div>
      </div>
    </motion.div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// MODAL FICHA PROVEEDOR
// ════════════════════════════════════════════════════════════════════════════
const ProveedorModal: React.FC<{
  prov: Proveedor; data: AppData;
  editMode: boolean; editForm: Partial<Proveedor>; saving: boolean;
  aiText: string; aiLoading: boolean;
  fichaTab: 'resumen'|'precios'|'albaranes'; setFichaTab: (t:'resumen'|'precios'|'albaranes')=>void;
  onClose:()=>void; onEdit:()=>void; onCancelEdit:()=>void;
  onChangeForm:(f:Partial<Proveedor>)=>void;
  onSaveEdit:()=>void; onDelete:()=>void;
  onWhatsApp:(tel:string,name:string)=>void;
  onBriefing:()=>void; onExport:()=>void;
}> = ({ prov, data, editMode, editForm, saving, aiText, aiLoading, fichaTab, setFichaTab,
        onClose, onEdit, onCancelEdit, onChangeForm, onSaveEdit, onDelete, onWhatsApp, onBriefing, onExport }) => {

  const stats = useProvStats(prov.n, data);
  const [selectedItem, setSelectedItem] = useState<string>('');
  const semaf = diasSemaforo(stats.daysAgo);

  // Items del proveedor para el gráfico de precios
  const itemsConHistorial = useMemo(() =>
    Object.entries(stats.itemPrices)
      .filter(([,series]) => series.length >= 2)
      .sort((a,b) => b[1].length - a[1].length),
    [stats.itemPrices]
  );
  const itemSeleccionado = selectedItem || itemsConHistorial[0]?.[0] || '';
  const seriePrecios = stats.itemPrices[itemSeleccionado] || [];

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
        className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <div className="min-w-0">
            <h3 className="font-black text-slate-800 text-sm truncate">{prov.n}</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{prov.fam}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Score visual */}
            <span className={cn("text-[9px] font-black px-2 py-1 rounded-full border",
              stats.score>=70?"bg-emerald-50 text-emerald-700 border-emerald-200":
              stats.score>=40?"bg-amber-50 text-amber-700 border-amber-200":
              "bg-rose-50 text-rose-700 border-rose-200")}>
              ★ {stats.score}/100
            </span>
            <button onClick={onExport} title="Exportar a Excel" className="p-2 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition">
              <Download className="w-4 h-4 text-emerald-600"/>
            </button>
            {!editMode && <button onClick={onEdit} className="p-2 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition"><Edit3 className="w-4 h-4 text-indigo-600"/></button>}
            <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-xl transition"><X className="w-4 h-4 text-slate-500"/></button>
          </div>
        </div>

        {/* Tabs */}
        {!editMode && (
          <div className="flex gap-1 px-6 py-3 border-b border-slate-100 shrink-0">
            {(['resumen','precios','albaranes'] as const).map(tab => (
              <button key={tab} onClick={() => setFichaTab(tab)}
                className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition",
                  fichaTab===tab ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100")}>
                {tab === 'resumen' ? '📊 Resumen' : tab === 'precios' ? '📈 Historial Precios' : '📋 Albaranes'}
              </button>
            ))}
          </div>
        )}

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">

          {/* ── TAB RESUMEN ── */}
          {!editMode && fichaTab === 'resumen' && (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label:'Total Compras', val: Num.fmt(stats.total), icon: CreditCard, color:'text-indigo-600' },
                  { label:'Nº Pedidos',    val: String(stats.count),  icon: Package,   color:'text-slate-700'  },
                  { label:'Ticket Medio',  val: Num.fmt(stats.avgOrder), icon: BarChart3, color:'text-emerald-600' },
                  { label:'Último Pedido', val: semaf.label, icon: Clock, color: semaf.cls },
                ].map(k => {
                  const Icon = k.icon;
                  return (
                    <div key={k.label} className="bg-slate-50 rounded-2xl p-4 text-center">
                      <Icon className={cn("w-4 h-4 mx-auto mb-1.5", k.color)}/>
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{k.label}</p>
                      <p className={cn("text-sm font-black mt-1", k.color)}>{k.val}</p>
                    </div>
                  );
                })}
              </div>

              {/* Alertas de precio */}
              {stats.alertasPrecios.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
                  <p className="text-xs font-black text-amber-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4"/> Subidas de precio detectadas
                  </p>
                  {stats.alertasPrecios.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-amber-100">
                      <span className="text-xs font-bold text-slate-700 truncate">{a.item}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-slate-400">Media: {Num.fmt(a.avgPrice)}</span>
                        <span className="text-[10px] font-black text-rose-600 flex items-center gap-0.5">
                          <ArrowUpRight className="w-3 h-3"/> +{a.pct}% → {Num.fmt(a.lastPrice)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Trend gráfico */}
              {stats.count > 0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Evolución de compras (6 meses)</p>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats.trend} margin={{top:5,right:5,left:-20,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="name" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
                        <Tooltip formatter={(v:number) => [Num.fmt(v),'Compras']} contentStyle={{borderRadius:12,border:'none'}}/>
                        <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2.5} fill="#ede9fe" fillOpacity={0.6}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Datos de contacto */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {[
                  { icon: Phone,    label:'Teléfono',   val: prov.tel      },
                  { icon: Mail,     label:'Email',      val: prov.email    },
                  { icon: Users,    label:'Contacto',   val: prov.contacto },
                  { icon: MapPin,   label:'Dirección',  val: prov.direccion},
                  { icon: FileText, label:'NIF/CIF',    val: prov.nif      },
                  { icon: Building2,label:'IBAN',       val: prov.iban     },
                ].filter(d => d.val).map(d => {
                  const Icon = d.icon;
                  return (
                    <div key={d.label} className="flex items-start gap-2 bg-slate-50 rounded-xl p-3">
                      <Icon className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0"/>
                      <div className="min-w-0">
                        <p className="text-[9px] text-slate-400 font-bold uppercase">{d.label}</p>
                        <p className="font-bold text-slate-700 truncate">{String(d.val)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* IA Briefing */}
              <button onClick={onBriefing} disabled={aiLoading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-2xl text-xs font-black uppercase hover:bg-indigo-700 transition disabled:opacity-50">
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
                {aiLoading ? 'Generando briefing...' : 'Briefing de Negociación IA'}
              </button>
              {aiText && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                  <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-2 flex items-center gap-1">
                    <Sparkles className="w-3 h-3"/> Análisis IA
                  </p>
                  <p className="text-xs font-medium text-slate-700 leading-relaxed">{aiText}</p>
                </div>
              )}
            </>
          )}

          {/* ── TAB HISTORIAL PRECIOS ── */}
          {!editMode && fichaTab === 'precios' && (
            <>
              {itemsConHistorial.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30"/>
                  <p className="text-sm font-black uppercase tracking-widest">Sin datos de precios</p>
                  <p className="text-xs mt-1">Los albaranes necesitan líneas de producto con precio unitario.</p>
                </div>
              ) : (
                <>
                  {/* Selector de producto */}
                  <div className="flex flex-wrap gap-2">
                    {itemsConHistorial.slice(0,10).map(([item]) => (
                      <button key={item} onClick={() => setSelectedItem(item)}
                        className={cn("px-3 py-1.5 rounded-xl text-[9px] font-black uppercase transition border",
                          itemSeleccionado===item ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-300")}>
                        {item}
                      </button>
                    ))}
                  </div>

                  {/* Gráfico de precios */}
                  {seriePrecios.length >= 2 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          Evolución precio: {itemSeleccionado}
                        </p>
                        {/* Variación última vs media */}
                        {(() => {
                          const last  = seriePrecios[seriePrecios.length-1].price;
                          const avg   = seriePrecios.slice(0,-1).reduce((s,x)=>s+x.price,0)/(seriePrecios.length-1);
                          const pct   = avg > 0 ? ((last-avg)/avg)*100 : 0;
                          return (
                            <span className={cn("text-[10px] font-black px-2 py-1 rounded-full border flex items-center gap-1",
                              pct > 5 ? "bg-rose-50 text-rose-700 border-rose-200" :
                              pct < -5 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                              "bg-slate-50 text-slate-600 border-slate-200")}>
                              {pct > 0 ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
                              {pct > 0?'+':''}{Num.round2(pct)}% vs media
                            </span>
                          );
                        })()}
                      </div>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={seriePrecios} margin={{top:5,right:5,left:-20,bottom:0}}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                            <XAxis dataKey="date" tick={{fontSize:9,fill:'#94a3b8'}} axisLine={false} tickLine={false}
                              tickFormatter={v => v.slice(5)}/>
                            <YAxis tick={{fontSize:9,fill:'#94a3b8'}} axisLine={false} tickLine={false}
                              tickFormatter={v => `${v}€`}/>
                            <Tooltip formatter={(v:number) => [`${Num.fmt(v)}€/ud`,'Precio']} contentStyle={{borderRadius:12,border:'none'}}/>
                            {/* Línea de media */}
                            <ReferenceLine
                              y={seriePrecios.reduce((s,x)=>s+x.price,0)/seriePrecios.length}
                              stroke="#94a3b8" strokeDasharray="4 4"
                              label={{value:'Media',fill:'#94a3b8',fontSize:9}}/>
                            <Line type="monotone" dataKey="price" stroke="#4f46e5" strokeWidth={2.5}
                              dot={{fill:'#4f46e5',r:4}} activeDot={{r:6}}/>
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── TAB ALBARANES ── */}
          {!editMode && fichaTab === 'albaranes' && (
            <div className="space-y-2">
              {stats.albs.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Package className="w-10 h-10 mx-auto mb-3 opacity-30"/>
                  <p className="text-sm font-black uppercase tracking-widest">Sin albaranes</p>
                </div>
              ) : (
                stats.albs.slice(0,20).map((a: any, i: number) => (
                  <div key={a.id || i} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-700 truncate">Ref: {a.num || '—'}</p>
                      <p className="text-[10px] text-slate-400">{a.date}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-black text-slate-800 tabular-nums">{Num.fmt(Num.parse(a.total))}</span>
                      <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded-full border",
                        a.paid ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200")}>
                        {a.paid ? '✓ Pagado' : 'Pendiente'}
                      </span>
                    </div>
                  </div>
                ))
              )}
              {stats.albs.length > 20 && (
                <p className="text-center text-[10px] text-slate-400 font-bold">...y {stats.albs.length-20} más</p>
              )}
            </div>
          )}

          {/* ── MODO EDICIÓN ── */}
          {editMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { key:'n',         label:'Nombre *',    type:'text'   },
                { key:'contacto',  label:'Contacto',    type:'text'   },
                { key:'tel',       label:'Teléfono',    type:'tel'    },
                { key:'email',     label:'Email',       type:'email'  },
                { key:'nif',       label:'NIF/CIF',     type:'text'   },
                { key:'iban',      label:'IBAN',        type:'text'   },
                { key:'direccion', label:'Dirección',   type:'text'   },
              ].map(f => (
                <div key={f.key} className={f.key==='direccion' ? 'sm:col-span-2' : ''}>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">{f.label}</label>
                  <input type={f.type} value={String(editForm[f.key as keyof Proveedor] || '')}
                    onChange={e => onChangeForm({...editForm, [f.key]: e.target.value})}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition"/>
                </div>
              ))}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Categoría</label>
                <select value={String(editForm.fam||'General')} onChange={e => onChangeForm({...editForm, fam:e.target.value})}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition">
                  {FAMILIAS.map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Notas</label>
                <textarea value={String(editForm.notas||'')} rows={3}
                  onChange={e => onChangeForm({...editForm, notas:e.target.value})}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition resize-none"/>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 p-4 flex gap-3 shrink-0">
          {editMode ? (
            <>
              <button onClick={onCancelEdit} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase hover:bg-slate-200 transition">Cancelar</button>
              <button onClick={onSaveEdit} disabled={saving}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase hover:bg-indigo-700 transition flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Save className="w-3.5 h-3.5"/>} Guardar
              </button>
            </>
          ) : (
            <>
              {prov.tel && (
                <button onClick={() => onWhatsApp(prov.tel!, prov.n)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase hover:bg-emerald-700 transition">
                  <MessageCircle className="w-3.5 h-3.5"/> WhatsApp
                </button>
              )}
              <button onClick={onDelete} className="px-4 py-2.5 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl font-black text-[10px] uppercase hover:bg-rose-100 transition">
                <Trash2 className="w-3.5 h-3.5"/>
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// MODAL FORMULARIO NUEVO PROVEEDOR
// ════════════════════════════════════════════════════════════════════════════
const ProveedorFormModal: React.FC<{
  title:string; form:any; saving:boolean; familias:string[];
  onChange:(f:any)=>void; onClose:()=>void; onSave:()=>void;
}> = ({ title, form, saving, familias, onChange, onClose, onSave }) => (
  <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[90] flex items-end sm:items-center justify-center p-4"
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
      className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
        <h3 className="font-black text-slate-800">{title}</h3>
        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition"><X className="w-4 h-4 text-slate-500"/></button>
      </div>
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 custom-scrollbar">
        {[
          {key:'n',         label:'Nombre *',  type:'text' },
          {key:'fam',       label:'Categoría', type:'select'},
          {key:'tel',       label:'Teléfono',  type:'tel'  },
          {key:'email',     label:'Email',     type:'email'},
          {key:'contacto',  label:'Contacto',  type:'text' },
          {key:'nif',       label:'NIF/CIF',   type:'text' },
          {key:'iban',      label:'IBAN',      type:'text' },
          {key:'currency',  label:'Divisa',    type:'currency' },
          {key:'country',   label:'País',      type:'text' },
          {key:'direccion', label:'Dirección', type:'text' },
        ].map(f => (
          <div key={f.key} className={f.key==='direccion'?'sm:col-span-2':''}>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">{f.label}</label>
            {f.type === 'select' ? (
              <select value={form[f.key]||'General'} onChange={e => onChange({...form,[f.key]:e.target.value})}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition">
                {familias.map(fam => <option key={fam}>{fam}</option>)}
              </select>
            ) : f.type === 'currency' ? (
              <select value={form[f.key]||'EUR'} onChange={e => onChange({...form,[f.key]:e.target.value})}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition">
                {[
                  {code:'EUR',label:'🇪🇺 EUR — Euro'},
                  {code:'JPY',label:'🇯🇵 JPY — Yen japonés'},
                  {code:'USD',label:'🇺🇸 USD — Dólar'},
                  {code:'GBP',label:'🇬🇧 GBP — Libra'},
                  {code:'CHF',label:'🇨🇭 CHF — Franco suizo'},
                  {code:'CNY',label:'🇨🇳 CNY — Yuan'},
                  {code:'KRW',label:'🇰🇷 KRW — Won'},
                ].map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            ) : (
              <input type={f.type} value={form[f.key]||''} onChange={e => onChange({...form,[f.key]:e.target.value})}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition"/>
            )}
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Notas</label>
          <textarea value={form.notas||''} rows={2} onChange={e => onChange({...form,notas:e.target.value})}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition resize-none"/>
        </div>
      </div>
      <div className="p-4 border-t border-slate-100 flex gap-3 shrink-0">
        <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase hover:bg-slate-200 transition">Cancelar</button>
        <button onClick={onSave} disabled={saving}
          className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase hover:bg-indigo-700 transition flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Plus className="w-4 h-4"/>} Guardar
        </button>
      </div>
    </motion.div>
  </motion.div>
);
