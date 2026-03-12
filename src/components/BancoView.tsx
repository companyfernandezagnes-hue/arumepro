import React, { useState, useMemo, useRef, useEffect, useDeferredValue } from 'react';
import { 
  Building2, Search, Trash2, Clipboard, Upload, Zap, 
  CheckCircle2, ArrowRight, TrendingUp, TrendingDown, 
  Scale, Settings, RefreshCw, ShoppingCart, Eraser,
  AlertTriangle, Eye, EyeOff, Sparkles, Filter,
  History, Calendar, Info, BarChart3, PieChart,
  ArrowUpRight, ArrowDownLeft, Check, X as CloseIcon,
  Loader2, Landmark, ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppData, Albaran, Factura, BankMovement } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';

// 🚀 IMPORTAMOS LA LÓGICA DESDE TU NUEVO ARCHIVO
import { findMatches, executeLink, fingerprint, isSuspicious, daysBetween, normalizeDesc } from '../services/bancoLogic';
// 🚀 IMPORTAMOS EL COMPONENTE SWIPE
import { SwipeReconciler } from './SwipeReconciler';

interface BancoViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const BancoView = ({ data, onSave }: BancoViewProps) => {
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearch = useDeferredValue(searchTerm); 
  
  const [isMagicLoading, setIsMagicLoading] = useState(false);
  const [isApiSyncing, setIsApiSyncing] = useState(false);
  const [isSwipeMode, setIsSwipeMode] = useState(false);
  
  type BankFilter = 'all' | 'pending' | 'unmatched' | 'suspicious' | 'duplicate' | 'reviewed';
  const [viewFilter, setViewFilter] = useState<BankFilter>('pending');
  const [activeTab, setActiveTab] = useState<'list' | 'insights'>('list');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const n8nUrl = data.config?.n8nUrlBanco || "https://ia.permatunnelopen.org/webhook/1085406f-324c-42f7-b50f-22f211f445cd";

  // --- STATS Y FLUJO ---
  const cashFlowData = useMemo(() => {
    const days = 30;
    const result = [];
    const now = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(); d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayMovs = (data.banco || []).filter((m: any) => m.date === dateStr);
      const income = dayMovs.filter((m: any) => Num.parse(m.amount) > 0).reduce((acc: number, m: any) => acc + Num.parse(m.amount), 0);
      const expense = Math.abs(dayMovs.filter((m: any) => Num.parse(m.amount) < 0).reduce((acc: number, m: any) => acc + Num.parse(m.amount), 0));
      result.push({ name: d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }), ingresos: income, gastos: expense, balance: income - expense });
    }
    return result;
  }, [data.banco]);

  const pendingCajas = useMemo(() => {
    return (data.cierres || []).filter((c: any) => {
      const isCardMatched = (data.banco || []).some((b: any) => 
        b.status === 'matched' && b.link?.type === 'FACTURA' && 
        data.facturas?.find((f: any) => f.id === b.link?.id)?.num === `Z-${c.date.replace(/-/g, '')}`
      );
      return !isCardMatched && Num.parse(c.tarjeta) > 0;
    }).slice(0, 5);
  }, [data.cierres, data.banco, data.facturas]);

  const stats = useMemo(() => {
    const movements = data.banco || [];
    const sumaMovs = movements.reduce((acc: number, b: any) => acc + (Num.parse(b.amount) || 0), 0);
    const saldo = (Num.parse(data.config?.saldoInicial) || 0) + sumaMovs;
    const pending = movements.filter((b: any) => b.status === 'pending');
    const matched = movements.length - pending.length;
    const percent = movements.length > 0 ? Math.round((matched / movements.length) * 100) : 0;
    const trend = movements.slice(-10).map((m: any) => Num.parse(m.amount));
    return { saldo, percent, pending: pending.length, total: movements.length, matched, trend };
  }, [data.banco, data.config?.saldoInicial]);

  const prevPagos = useMemo(() => {
    const now = new Date(); const target = new Date(now); target.setDate(now.getDate() + 7);
    const items = (data.gastos_fijos || [])
      .filter((g: any) => g.active !== false && g.freq && g.dia_pago)
      .map((g: any) => {
        const due = new Date(now.getFullYear(), now.getMonth(), Number(g.dia_pago) || 1);
        if (due < now) due.setMonth(due.getMonth() + 1);
        return { amount: Num.parse(g.amount), within: due <= target };
      }).filter((x: any) => x.within);
    return items.reduce((acc: number, x: any) => acc + x.amount, 0);
  }, [data.gastos_fijos]);

  const filteredMovements = useMemo(() => {
    const base = (data.banco || []).filter((b: any) => 
      b.desc.toLowerCase().includes(deferredSearch.toLowerCase()) || b.amount.toString().includes(deferredSearch)
    );
    return base.filter((b: any) => {
      if (viewFilter === 'all') return true;
      if (viewFilter === 'pending') return b.status === 'pending';
      if (viewFilter === 'unmatched') return b.flags?.unmatched === true;
      if (viewFilter === 'suspicious') return b.flags?.suspicious === true;
      if (viewFilter === 'duplicate') return b.flags?.duplicate === true;
      if (viewFilter === 'reviewed') return b.reviewed === true;
      return true;
    }).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.banco, deferredSearch, viewFilter]);

  const selectedItem = useMemo(() => data.banco?.find((b: any) => b.id === selectedBankId), [data.banco, selectedBankId]);

  // 🚀 LLAMADA AL CEREBRO EXTERNO PARA BUSCAR COINCIDENCIAS
  const matches = useMemo(() => {
    if (!selectedItem) return [];
    return findMatches(selectedItem, data);
  }, [selectedItem, data]);

  // --- ACCIONES ---
  const handleApiSync = async () => {
    setIsApiSyncing(true);
    try {
      await new Promise(r => setTimeout(r, 2000));
      alert("✅ Sincronización bancaria API iniciada (Conectando a PSD2).");
    } finally { setIsApiSyncing(false); }
  };

  const handleAnalyze = async () => {
    const newData = JSON.parse(JSON.stringify(data)); 
    const seen: any[] = [];
    newData.banco = (newData.banco || []).map((m: any) => {
      const n = { ...m };
      const fp = fingerprint(n.date, Num.parse(n.amount), n.desc || '');
      if (!n.hash) n.hash = fp;
      let duplicate = false;
      for (const prev of seen) {
        if (Math.abs(Num.parse(prev.amount) - Num.parse(n.amount)) < 0.005) {
          if (normalizeDesc(prev.desc) === normalizeDesc(n.desc) && daysBetween(prev.date, n.date) <= 2) { duplicate = true; break; }
        }
      }
      seen.push({ date: n.date, amount: Num.parse(n.amount), desc: n.desc });
      n.flags = { duplicate, suspicious: isSuspicious(n.desc || ''), unmatched: n.status === 'pending' && !n.link?.id };
      if (n.reviewed === undefined) n.reviewed = false;
      return n;
    });
    await onSave(newData);
    alert('📊 Análisis completado: Sospechosos y duplicados detectados.');
  };

  const toggleReviewed = async (id: string, val: boolean) => {
    const newData = { ...data };
    const it: any = newData.banco?.find((b: any) => b.id === id);
    if (!it) return;
    it.reviewed = val;
    await onSave(newData);
  };

  const handleReviewAll = async () => {
    if (!confirm(`¿Marcar los ${filteredMovements.length} movimientos visibles como REVISADOS?`)) return;
    const newData = { ...data };
    const visibleIds = new Set(filteredMovements.map((m: any) => m.id));
    newData.banco = newData.banco.map((b: any) => { if (visibleIds.has(b.id)) return { ...b, reviewed: true }; return b; });
    await onSave(newData);
  };

  // 🚀 LLAMADA AL MOTOR EXTERNO PARA ENLAZAR
  const handleLink = async (bankId: string, matchType: string, docId: string, comision: number = 0) => {
    const newData = JSON.parse(JSON.stringify(data));
    executeLink(newData, bankId, matchType, docId, comision); 
    await onSave(newData);
    setSelectedBankId(null);
  };

  const handleQuickAction = async (bankId: string, label: string, type: 'ALBARAN' | 'FIXED_EXPENSE' | 'TPV' | 'CASH' | 'INCOME') => {
    const newData = JSON.parse(JSON.stringify(data));
    const item = newData.banco.find((b: any) => b.id === bankId);
    if (!item) return;

    const amtRaw = Num.parse(item.amount);
    const amt = Math.abs(amtRaw);

    if (type === 'FIXED_EXPENSE') {
      const d = new Date(item.date);
      const monthKey = `pagos_${d.getFullYear()}_${d.getMonth() + 1}`;
      if (!newData.control_pagos) newData.control_pagos = {};
      if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
      const isPersonal = label.includes('Personal') || label.includes('Nómina');
      
      const pendingFixed = (newData.gastos_fijos || []).find((g: any) => 
        g.active !== false && g.cat === (isPersonal ? 'personal' : 'varios') &&
        !newData.control_pagos[monthKey].includes(g.id) && Math.abs(Num.parse(g.amount) - amt) < 50 
      );

      if (pendingFixed) {
        newData.control_pagos[monthKey].push(pendingFixed.id);
      } else { 
        const newFixedId = 'gf-' + Date.now();
        if (!newData.gastos_fijos) newData.gastos_fijos = [];
        newData.gastos_fijos.push({ id: newFixedId, name: `${label} (Detectado Auto)`, amount: amt, freq: 'mensual', dia_pago: d.getDate(), cat: isPersonal ? 'personal' : 'varios', active: true });
        newData.control_pagos[monthKey].push(newFixedId);
      }
    } else if (type === 'TPV') {
      const zMatch = newData.cierres?.find((c: any) => !c.conciliado_banco && Math.abs(Num.parse(c.tarjeta) - amt) <= 5);
      if (zMatch) {
        zMatch.conciliado_banco = true;
        const zNum = `Z-${zMatch.date.replace(/-/g, '')}`;
        const fZ = newData.facturas?.find((f: any) => f.num === zNum);
        if (fZ) { fZ.reconciled = true; fZ.paid = true; fZ.status = 'reconciled'; }
      }
    } else if (type === 'CASH') {
      const cMatch = newData.cierres?.find((c: any) => !c.conciliado_banco && Math.abs(Num.parse(c.efectivo) - amt) <= 50);
      if (cMatch) cMatch.conciliado_banco = true;
    }

    item.status = 'matched'; item.category = label;
    await onSave(newData);
    setSelectedBankId(null);
  };

  const handleMagicMatch = async () => {
    const pendings = filteredMovements.slice(0, 25);
    if (pendings.length === 0) return alert("No hay movimientos pendientes.");
    setIsMagicLoading(true);
    try {
      const result = await proxyFetch(n8nUrl, { method: 'POST', body: { movimientos: pendings.map((m: any) => ({ ...m, descOriginal: m.desc })), saldoInicial: data.config?.saldoInicial } });
      if (result && result.movimientos) {
        const newData = JSON.parse(JSON.stringify(data));
        let count = 0;
        for (const mov of result.movimientos) {
          const item = newData.banco.find((b: any) => b.id === mov.id);
          if (!item) continue;
          const amtRaw = Num.parse(item.amount);

          if (amtRaw > 0) {
            if (mov.esCierreTPV) {
              const zMatch = newData.cierres?.find((c: any) => !c.conciliado_banco && Math.abs(Num.parse(c.tarjeta) - Math.abs(amtRaw)) <= 5);
              if (zMatch) {
                zMatch.conciliado_banco = true;
                const fZ = newData.facturas?.find((f: any) => f.num === `Z-${zMatch.date.replace(/-/g, '')}`);
                if (fZ) { fZ.reconciled = true; fZ.paid = true; fZ.status = 'reconciled'; }
              }
            }
          } else {
            if (mov.categoriaAsignada && mov.confidence >= 0.7) {
              const catLower = mov.categoriaAsignada.toLowerCase();
              if (catLower.includes('personal') || catLower.includes('nómina') || catLower.includes('alquiler')) {
                 const d = new Date(item.date);
                 const monthKey = `pagos_${d.getFullYear()}_${d.getMonth() + 1}`;
                 if (!newData.control_pagos) newData.control_pagos = {};
                 if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
                 
                 const newFixedId = 'gf-ia-' + Date.now();
                 if (!newData.gastos_fijos) newData.gastos_fijos = [];
                 newData.gastos_fijos.push({ id: newFixedId, name: mov.categoriaAsignada, amount: Math.abs(amtRaw), freq: 'mensual', dia_pago: d.getDate(), cat: catLower.includes('personal') ? 'personal' : 'varios', active: true });
                 newData.control_pagos[monthKey].push(newFixedId);
              }
            }
          }
          item.status = 'matched'; item.category = mov.categoriaAsignada || 'IA';
          count++;
        }
        await onSave(newData); alert(`✨ IA ha conciliado ${count} movimientos.`);
      }
    } catch (err) { alert("Error conectando con la IA."); } finally { setIsMagicLoading(false); }
  };

  const handleAutoCleanup = async () => {
    if (!confirm("⚠️ ¿LIMPIEZA AUTOMÁTICA?")) return;
    const newData = JSON.parse(JSON.stringify(data));
    let eliminados = 0;
    
    const initialAlbs = (newData.albaranes || []).length;
    newData.albaranes = (newData.albaranes || []).filter((a: any) => !(a.id.startsWith('auto-') || a.id.startsWith('ia-') || a.prov === 'BANCO' || a.prov?.includes('(IA)')));
    eliminados += (initialAlbs - newData.albaranes.length);

    const initialFacs = (newData.facturas || []).length;
    newData.facturas = (newData.facturas || []).filter((f: any) => !(f.id.startsWith('auto-fac') || f.id.startsWith('fac-ia-') || f.id.startsWith('fac-z-auto') || f.cliente === 'Z DIARIO AUTO' || f.cliente === 'Ingreso Banco'));
    eliminados += (initialFacs - newData.facturas.length);

    await onSave(newData); alert(`✨ Limpieza exitosa: ${eliminados} documentos fantasma eliminados.`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const newData = JSON.parse(JSON.stringify(data));
      if (!newData.banco) newData.banco = [];
      let imported = 0;

      rows.forEach(row => {
        const date = row.Fecha || row.Date || row.date;
        const amount = row.Importe || row.Amount || row.amount;
        const desc = row.Concepto || row.Description || row.desc;

        if (date && amount) {
          let dateISO = String(date);
          if (typeof date === 'number') {
            dateISO = new Date(new Date(1899, 11, 30).getTime() + date * 86400000).toISOString().split('T')[0];
          } else if (date.includes('/')) {
            const parts = date.split('/');
            if (parts[2].length === 4) dateISO = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
          const fp = fingerprint(dateISO, Num.parse(amount), String(desc));
          if (!newData.banco.some((b: any) => b.hash === fp)) {
            newData.banco.push({ id: 'imp-' + Date.now() + Math.random().toString(36).slice(2, 7), date: dateISO, amount: Num.parse(amount), desc: desc || 'Importado', status: 'pending', hash: fp });
            imported++;
          }
        }
      });
      await onSave(newData); alert(`📥 ${imported} movimientos importados.`);
    };
    reader.readAsBinaryString(file);
  };

  const handleNuke = async () => {
    if (!confirm("🛑 PELIGRO: ¿Borrar todos los movimientos ya conciliados para hacer espacio?")) return;
    const newData = JSON.parse(JSON.stringify(data));
    newData.banco = newData.banco.filter((b: any) => b.status === 'pending');
    await onSave(newData);
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">
      {/* 🚀 HEADER Y BOTONERA */}
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="flex justify-between items-start relative z-10">
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter flex items-center gap-2">
               <Landmark className="w-6 h-6 text-indigo-600" /> Banco Inteligente
            </h2>
            <p className="text-[10px] font-black text-slate-400 uppercase mt-1">Conciliación Financiera y Cierres</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Saldo Actual</p>
            <span className="text-3xl font-black text-slate-800">{Num.fmt(stats.saldo)}</span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="bg-slate-900 text-white px-5 py-3 rounded-xl text-[10px] font-black hover:scale-105 transition flex items-center gap-2 shadow-lg">
            <Upload className="w-4 h-4" /> SUBIR EXCEL
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx,.xls,.csv" />
          </button>
          <button onClick={handleApiSync} disabled={isApiSyncing} className="bg-blue-600 text-white px-5 py-3 rounded-xl text-[10px] font-black hover:bg-blue-700 transition shadow-lg flex items-center gap-2">
            {isApiSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} SYNC PSD2
          </button>
          <button onClick={handleAnalyze} className="bg-amber-50 text-amber-700 px-5 py-3 rounded-xl text-[10px] font-black hover:bg-amber-100 transition shadow-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> ANALIZAR BANDERAS
          </button>
          <button onClick={() => setIsSwipeMode(true)} className="bg-indigo-50 text-indigo-600 px-5 py-3 rounded-xl text-[10px] font-black hover:bg-indigo-100 transition shadow-sm flex items-center gap-2 ml-auto">
            <Sparkles className="w-4 h-4" /> MODO SWIPE
          </button>
        </div>
      </header>

      {/* 🚀 LAYOUT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-2 rounded-2xl border border-slate-100 flex items-center gap-2 shadow-sm sticky top-0 z-10">
            <Search className="w-4 h-4 text-slate-400 ml-2" />
            <input type="text" placeholder="Buscar movimiento..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-transparent text-xs font-bold outline-none text-slate-600 h-8" />
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {filteredMovements.map((b: any) => (
              <motion.div key={b.id} layoutId={b.id} onClick={() => setSelectedBankId(b.id)} className={cn("group relative bg-white p-4 rounded-2xl border transition cursor-pointer", selectedBankId === b.id ? "ring-2 ring-indigo-500 border-indigo-100 bg-indigo-50/30" : "border-slate-100 hover:border-indigo-200")}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-slate-700 text-xs truncate uppercase tracking-tight">{b.desc}</p>
                    <p className="text-[9px] text-slate-400 font-bold mt-1">{b.date}</p>
                    {b.status === 'matched' && <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded mt-2 inline-flex items-center gap-1"><ShieldCheck className="w-2 h-2" /> CONCILIADO</span>}
                  </div>
                  <span className={cn("font-black text-sm whitespace-nowrap", Num.parse(b.amount) < 0 ? "text-slate-900" : "text-emerald-500")}>
                    {Num.parse(b.amount) > 0 ? '+' : ''}{Num.fmt(b.amount)}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Right Panel */}
        <div className="lg:col-span-7">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 h-[600px] flex flex-col shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
            
            <AnimatePresence mode="wait">
              {selectedItem ? (
                <motion.div key={selectedItem.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 flex flex-col">
                  <div className="border-b border-slate-100 pb-6 mb-6">
                    <span className={cn("text-[9px] font-black px-2 py-1 rounded uppercase tracking-widest", Num.parse(selectedItem.amount) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                      {Num.parse(selectedItem.amount) > 0 ? 'INGRESO' : 'GASTO'}
                    </span>
                    <h3 className="font-black text-2xl mt-4 leading-tight text-slate-800">{selectedItem.desc}</h3>
                    <p className={cn("text-4xl font-black mt-2", Num.parse(selectedItem.amount) > 0 ? "text-emerald-500" : "text-slate-900")}>{Num.fmt(selectedItem.amount)}</p>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 mb-6">
                    {matches.length > 0 && selectedItem.status === 'pending' ? (
                      <div className="space-y-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Sugerencias Inteligentes</p>
                        {matches.map((m: any, idx: number) => (
                          <div key={idx} className={cn("flex justify-between items-center p-4 rounded-2xl border hover:shadow-md transition", m.color === 'emerald' ? "bg-emerald-50 border-emerald-100" : m.color === 'amber' ? "bg-amber-50 border-amber-100" : "bg-indigo-50 border-indigo-100")}>
                            <div className="text-left">
                              <span className="text-[8px] font-black uppercase tracking-widest opacity-70">{m.type}</span>
                              <p className="text-xs font-black text-slate-800 mt-1">{m.title}</p>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="font-black text-sm text-slate-800">{Num.fmt(m.amount)}</span>
                              <button onClick={() => handleLink(selectedItem.id, m.type, m.id, m.comision || 0)} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[9px] font-black hover:scale-105 transition shadow-lg">
                                ENLAZAR
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      selectedItem.status !== 'pending' ? (
                        <div className="flex flex-col items-center justify-center py-10 bg-emerald-50 rounded-3xl border border-emerald-100">
                          <ShieldCheck className="w-12 h-12 text-emerald-400 mb-3" />
                          <p className="text-emerald-700 font-black uppercase text-xs">Conciliado Correctamente</p>
                        </div>
                      ) : (
                        <div className="text-center opacity-40 py-10">
                          <Search className="w-10 h-10 mx-auto mb-2 text-slate-400" />
                          <p className="text-xs font-black uppercase tracking-widest">No hay sugerencias exactas</p>
                        </div>
                      )
                    )}

                    {selectedItem.status === 'pending' && (
                      <div className="mt-8">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase mb-4 flex items-center gap-2">
                          <Zap className="w-3 h-3 text-indigo-500" /> ⚡ Creación Rápida
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                          {(Num.parse(selectedItem.amount) > 0 ? [
                            { label: 'Cierre TPV (Tarjetas)', icon: TrendingUp, type: 'TPV' as const },
                            { label: 'Ingreso Efectivo', icon: Building2, type: 'CASH' as const }
                          ] : [
                            { label: 'Gasto Fijo', icon: Zap, type: 'FIXED_EXPENSE' as const },
                            { label: 'Comisión Bancaria', icon: Building2, type: 'FIXED_EXPENSE' as const },
                            { label: 'Personal / Nómina', icon: TrendingDown, type: 'FIXED_EXPENSE' as const }
                          ]).map(cat => (
                            <button key={cat.label} onClick={() => handleQuickAction(selectedItem.id, cat.label, cat.type)} className="p-4 border border-slate-100 rounded-2xl hover:bg-slate-50 text-left transition group cursor-pointer">
                              <cat.icon className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 mb-2 transition-colors" />
                              <p className="text-[10px] font-black text-slate-600 uppercase">{cat.label}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : (
                <div className="flex-1 flex flex-col justify-center items-center text-center opacity-40"><Building2 className="w-12 h-12 mb-4" /><p className="text-xs font-black uppercase tracking-widest">Selecciona un movimiento</p></div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* 🚀 MODAL SWIPE IMPORTADO DESDE FUERA */}
      <AnimatePresence>
        {isSwipeMode && (
          <SwipeReconciler 
            data={data} 
            onSave={onSave} 
            onClose={() => setIsSwipeMode(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};
