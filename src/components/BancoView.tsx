import React, { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react';
import { 
  Building2, Search, Trash2, Upload, Zap, 
  CheckCircle2, ArrowRight, TrendingUp, TrendingDown, 
  RefreshCw, Eraser, Filter, BarChart3, PieChart,
  X as CloseIcon, Loader2, Landmark, ShieldCheck, List, Sparkles, ArrowDownLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppData, BankMovement } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';

// 🚀 IMPORTAMOS EL CEREBRO ÚNICO (Con la ruta corregida a la raíz de 'src')
import { findMatches, executeLink, isSuspicious, normalizeDesc, fingerprint, daysBetween } from '../bancoLogic';
import { SwipeReconciler } from './SwipeReconciler';

interface BancoViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

/* =======================================================
 * 🎨 COMPONENTE: Rayo de Energía (Para la vista Desktop)
 * ======================================================= */
const EnergyBeam = ({ sourceId, targetId, isActive }: { sourceId: string, targetId: string, isActive: boolean }) => {
  const [coords, setCoords] = useState<{x1: number, y1: number, x2: number, y2: number} | null>(null);

  useEffect(() => {
    const update = () => {
      const el1 = document.getElementById(sourceId);
      const el2 = document.getElementById(targetId);
      if (el1 && el2) {
        const r1 = el1.getBoundingClientRect();
        const r2 = el2.getBoundingClientRect();
        setCoords({
          x1: r1.left + r1.width / 2,
          y1: r1.bottom,
          x2: r2.left + r2.width / 2,
          y2: r2.top
        });
      }
    };
    const t = setTimeout(update, 200);
    window.addEventListener('resize', update);
    return () => { clearTimeout(t); window.removeEventListener('resize', update); };
  }, [sourceId, targetId, isActive]);

  if (!coords) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none z-0 w-full h-full" style={{ overflow: 'visible' }}>
      <motion.path
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: isActive ? 1 : 0.3 }}
        d={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1 + 50}, ${coords.x2} ${coords.y2 - 50}, ${coords.x2} ${coords.y2}`}
        stroke={isActive ? "#10b981" : "#818cf8"} 
        strokeWidth={isActive ? "4" : "2"}
        fill="none"
        strokeDasharray={isActive ? "none" : "4 4"}
        className="transition-all duration-300"
        style={{ filter: isActive ? "drop-shadow(0 0 8px #34d399)" : "none" }}
      />
      {isActive && (
        <circle r="6" fill="#34d399" style={{ filter: "drop-shadow(0 0 10px #10b981)" }}>
          <animateMotion dur="0.8s" repeatCount="1" path={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1 + 50}, ${coords.x2} ${coords.y2 - 50}, ${coords.x2} ${coords.y2}`} />
        </circle>
      )}
    </svg>
  );
};

export const BancoView = ({ data, onSave }: BancoViewProps) => {
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearch = useDeferredValue(searchTerm); 
  
  const [isMagicLoading, setIsMagicLoading] = useState(false);
  const [isApiSyncing, setIsApiSyncing] = useState(false);
  const [isSwipeMode, setIsSwipeMode] = useState(false);
  const [hoveredMatch, setHoveredMatch] = useState<string | null>(null);
  
  type BankFilter = 'all' | 'pending' | 'unmatched' | 'suspicious' | 'duplicate' | 'reviewed';
  const [viewFilter, setViewFilter] = useState<BankFilter>('pending');
  const [activeTab, setActiveTab] = useState<'list' | 'insights'>('list'); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const n8nUrl = data.config?.n8nUrlBanco || "https://ia.permatunnelopen.org/webhook/1085406f-324c-42f7-b50f-22f211f445cd";

  // 📊 CASHFLOW CHART DATA (Estilo Wave)
  const cashFlowData = useMemo(() => {
    const days = 30; const result = []; const now = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(); d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayMovs = (data.banco || []).filter((m: any) => m.date === dateStr && m.status === 'matched');
      const income = dayMovs.filter((m: any) => Num.parse(m.amount) > 0).reduce((acc: number, m: any) => acc + Num.parse(m.amount), 0);
      const expense = Math.abs(dayMovs.filter((m: any) => Num.parse(m.amount) < 0).reduce((acc: number, m: any) => acc + Num.parse(m.amount), 0));
      result.push({ name: d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }), ingresos: income, gastos: expense, balance: income - expense });
    }
    return result;
  }, [data.banco]);

  // 📉 WIDGETS FINANCIEROS
  const pendingCajas = useMemo(() => {
    return (data.cierres || []).filter((c: any) => {
      const isCardMatched = (data.banco || []).some((b: any) => 
        b.status === 'matched' && b.link?.type === 'FACTURA' && 
        data.facturas?.find((f: any) => f.id === b.link?.id)?.num === `Z-${c.date.replace(/-/g, '')}`
      );
      return !isCardMatched && Num.parse(c.tarjeta) > 0;
    }).slice(0, 5);
  }, [data.cierres, data.banco, data.facturas]);

  const prevPagos = useMemo(() => {
    const now = new Date(); const target = new Date(now); target.setDate(now.getDate() + 7);
    const items = (data.gastos_fijos || []).filter((g: any) => g.active !== false && g.freq && g.dia_pago).map((g: any) => {
        const due = new Date(now.getFullYear(), now.getMonth(), Number(g.dia_pago) || 1);
        if (due < now) due.setMonth(due.getMonth() + 1);
        return { amount: Num.parse(g.amount), within: due <= target };
    }).filter((x: any) => x.within);
    return items.reduce((acc: number, x: any) => acc + x.amount, 0);
  }, [data.gastos_fijos]);

  const stats = useMemo(() => {
    const movements = data.banco || [];
    const sumaMovs = movements.reduce((acc: number, b: any) => acc + (Num.parse(b.amount) || 0), 0);
    const saldo = (Num.parse(data.config?.saldoInicial) || 0) + sumaMovs;
    const pending = movements.filter((b: any) => b.status === 'pending');
    const matched = movements.length - pending.length;
    const percent = movements.length > 0 ? Math.round((matched / movements.length) * 100) : 0;
    return { saldo, percent, pending: pending.length, total: movements.length, matched };
  }, [data.banco, data.config?.saldoInicial]);

  // 🔍 FILTRADO DE LA LISTA
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
  
  // 🧠 USAMOS EL CEREBRO GLOBAL IMPORTADO (Para que aplique el Scoring y Multi-Albarán)
  const matches = useMemo(() => {
    if (!selectedItem) return [];
    return findMatches(selectedItem, data).slice(0, 3); // Top 3 coincidencias
  }, [selectedItem, data]);

  // 🚀 SINCRONIZACIÓN API PSD2 (Open Banking via N8N)
  const handleApiSync = async () => {
    setIsApiSyncing(true);
    try {
      const result = await proxyFetch(n8nUrl, { method: 'POST', body: { action: 'sync_banca_march' } });

      if (result && result.movements) {
        const newData = JSON.parse(JSON.stringify(data));
        if (!newData.banco) newData.banco = [];
        let addedCount = 0;

        result.movements.forEach((m: any) => {
          const fp = fingerprint(m.date, Num.parse(m.amount), m.desc);
          if (!newData.banco.some((b: any) => b.hash === fp)) {
            newData.banco.push({ 
              id: 'march-' + Date.now() + Math.random().toString(36).slice(2, 7), 
              date: m.date, amount: Num.parse(m.amount), desc: m.desc, status: 'pending', hash: fp 
            });
            addedCount++;
          }
        });
        await onSave(newData); 
        alert(`✅ Conexión PSD2 exitosa: ${addedCount} movimientos nuevos descargados.`);
      } else {
        alert("✅ Conexión PSD2 exitosa: El banco está al día.");
      }
    } catch (err) {
      alert("❌ Error conectando con N8N. Revisa si tu webhook para PSD2/GoCardless está activo.");
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
    await onSave(newData); alert('📊 Análisis completado: Sospechosos y duplicados detectados.');
  };

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
        await onSave(newData); alert(`✨ IA ha conciliado ${count} movimientos automáticamente.`);
      }
    } catch (err) { alert("Error conectando con N8N/IA."); } finally { setIsMagicLoading(false); }
  };

  const handleAutoCleanup = async () => {
    if (!confirm("⚠️ ¿Eliminar datos basura importados por error?")) return;
    const newData = JSON.parse(JSON.stringify(data));
    newData.banco = (newData.banco || []).filter((b: any) => !b.desc.includes('Importado Error'));
    await onSave(newData); 
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
      await onSave(newData); alert(`📥 ${imported} movimientos importados del CSV.`);
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
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center relative z-10 gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter flex items-center gap-2">
               <Landmark className="w-6 h-6 text-indigo-600" /> Banco Inteligente
            </h2>
            <p className="text-[10px] font-black text-slate-400 uppercase mt-1">Conexión Open Banking & Conciliación</p>
          </div>
          <div className="text-right flex items-center gap-6">
            <div className="hidden md:block">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Progreso</p>
              <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${stats.percent}%` }}></div>
              </div>
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Saldo Actual</p>
              <span className="text-3xl font-black text-slate-800">{Num.fmt(stats.saldo)}</span>
            </div>
          </div>
        </div>

        {/* 🎛️ BARRA DE HERRAMIENTAS PREMIUM */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-6">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setActiveTab('list')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-1.5", activeTab === 'list' ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100")}><List className="w-3.5 h-3.5"/> Lista</button>
            <button onClick={() => setActiveTab('insights')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-1.5", activeTab === 'insights' ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100")}><BarChart3 className="w-3.5 h-3.5"/> Insights Wave</button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => fileInputRef.current?.click()} className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-[10px] font-black hover:bg-slate-50 transition shadow-sm flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" /> EXCEL/CSV
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx,.xls,.csv" />
            </button>
            <button onClick={handleApiSync} disabled={isApiSyncing} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:bg-indigo-700 transition shadow-md flex items-center gap-2 border border-indigo-500">
              {isApiSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} SYNC PSD2
            </button>
            <button onClick={handleMagicMatch} disabled={isMagicLoading} className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-[10px] font-black hover:bg-emerald-100 transition shadow-sm flex items-center gap-2 border border-emerald-200">
               {isMagicLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} IA MATCH
            </button>
            <button onClick={() => setIsSwipeMode(true)} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-[10px] font-black hover:bg-slate-800 transition shadow-lg flex items-center gap-2 shadow-slate-900/20 active:scale-95">
              <ArrowRight className="w-3.5 h-3.5" /> MODO SWIPE
            </button>
            
            {/* Opciones de peligro encapsuladas */}
            <div className="flex gap-1 ml-2 border-l border-slate-100 pl-3">
              <button onClick={handleAnalyze} className="bg-amber-50 text-amber-600 hover:text-amber-700 p-2 rounded-xl transition shadow-sm" title="Analizar banderas y duplicados"><Filter className="w-4 h-4" /></button>
              <button onClick={handleAutoCleanup} className="bg-slate-50 text-slate-400 hover:text-rose-500 p-2 rounded-xl transition shadow-sm" title="Borrar basura importada"><Eraser className="w-4 h-4" /></button>
              <button onClick={handleNuke} className="bg-slate-50 text-slate-400 hover:text-rose-600 p-2 rounded-xl transition shadow-sm" title="Purgar base de datos"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      </header>

      {/* 📊 PESTAÑA INSIGHTS (WAVE STYLE) */}
      {activeTab === 'insights' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-black text-slate-800">CashFlow (Últimos 30 Días)</h3>
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mt-1">Evolución de la liquidez</p>
            </div>
            <div className="flex gap-4">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-400"></div><span className="text-[10px] font-black uppercase text-slate-500">Ingresos</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-rose-400"></div><span className="text-[10px] font-black uppercase text-slate-500">Gastos</span></div>
            </div>
          </div>
          
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashFlowData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorInc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fb7185" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#fb7185" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={false} tickLine={false} tickMargin={10} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={false} tickLine={false} tickFormatter={(v)=>`${v/1000}k`} />
                <Tooltip 
                  contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                  formatter={(val: number) => Num.fmt(val)}
                  labelStyle={{ fontWeight: 'black', color: '#1e293b', marginBottom: '4px' }}
                />
                <Area type="monotone" dataKey="ingresos" stroke="#34d399" strokeWidth={3} fillOpacity={1} fill="url(#colorInc)" activeDot={{ r: 6, strokeWidth: 0 }} />
                <Area type="monotone" dataKey="gastos" stroke="#fb7185" strokeWidth={3} fillOpacity={1} fill="url(#colorExp)" activeDot={{ r: 6, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* 🧾 PESTAÑA LISTA */}
      {activeTab === 'list' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white p-2 rounded-[1.5rem] border border-slate-200 flex items-center gap-2 shadow-sm sticky top-0 z-10">
              <Search className="w-4 h-4 text-slate-400 ml-3" />
              <input type="text" placeholder="Buscar movimiento..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-transparent text-xs font-bold outline-none text-slate-600 h-10 px-2" />
            </div>

            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {filteredMovements.map((b: any) => (
                <motion.div key={b.id} layoutId={b.id} onClick={() => setSelectedBankId(b.id)} className={cn("group relative bg-white p-5 rounded-[1.5rem] border-2 transition cursor-pointer", selectedBankId === b.id ? "border-indigo-400 bg-indigo-50/30 shadow-md" : "border-slate-100 hover:border-indigo-200")}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-slate-800 text-sm truncate uppercase tracking-tight">{b.desc}</p>
                      <p className="text-[10px] text-slate-400 font-bold mt-1 tracking-widest">{b.date}</p>
                      {b.status === 'matched' && <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md mt-3 inline-flex items-center gap-1 border border-emerald-200"><ShieldCheck className="w-3 h-3" /> CONCILIADO</span>}
                    </div>
                    <span className={cn("font-black text-lg whitespace-nowrap tracking-tighter shrink-0", Num.parse(b.amount) < 0 ? "text-slate-900" : "text-emerald-500")}>
                      {Num.parse(b.amount) > 0 ? '+' : ''}{Num.fmt(b.amount)}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="bg-white p-10 rounded-[3rem] border border-slate-100 h-[680px] flex flex-col shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
              <AnimatePresence mode="wait">
                {selectedItem ? (
                  <motion.div key={selectedItem.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 flex flex-col">
                    <div className="border-b border-slate-100 pb-8 mb-8 relative">
                      <span className={cn("text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest", Num.parse(selectedItem.amount) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                        {Num.parse(selectedItem.amount) > 0 ? 'INGRESO DETECTADO' : 'GASTO DETECTADO'}
                      </span>
                      <h3 className="font-black text-3xl mt-5 leading-tight text-slate-800 tracking-tighter">{selectedItem.desc}</h3>
                      <p id={`bank-preview-${selectedItem.id}`} className={cn("text-5xl font-black mt-3 tracking-tighter inline-block", Num.parse(selectedItem.amount) > 0 ? "text-emerald-500" : "text-slate-900")}>
                        {Num.fmt(selectedItem.amount)}
                      </p>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 mb-6">
                      {matches.length > 0 && selectedItem.status === 'pending' ? (
                        <div className="space-y-4">
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-indigo-500" /> Sugerencias IA
                          </p>
                          {matches.slice(0, 3).map((m: any, idx: number) => {
                            const matchIdStr = `match-card-desk-${m.id}`;
                            const isHovered = hoveredMatch === m.id;
                            
                            return (
                              <div key={idx} className="relative">
                                <EnergyBeam sourceId={`bank-preview-${selectedItem.id}`} targetId={matchIdStr} isActive={isHovered} />
                                
                                <div 
                                  id={matchIdStr}
                                  onMouseEnter={() => setHoveredMatch(m.id)}
                                  onMouseLeave={() => setHoveredMatch(null)}
                                  className={cn("relative z-20 flex justify-between items-center p-5 rounded-[2rem] border-2 hover:shadow-md transition-all bg-white", 
                                    isHovered ? "border-emerald-400 shadow-emerald-200/50 shadow-lg scale-[1.02] -translate-y-1" : "border-slate-200 hover:border-indigo-200"
                                  )}
                                >
                                  <div className="text-left">
                                    <span className={cn("text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded",
                                      m.color === 'emerald' ? "bg-emerald-50 text-emerald-700" : m.color === 'teal' ? "bg-teal-50 text-teal-700" :
                                      m.color === 'amber' ? "bg-amber-50 text-amber-700" : m.color === 'indigo' ? "bg-indigo-50 text-indigo-700" : 
                                      m.type === 'MULTI-ALBARÁN' ? "bg-purple-50 text-purple-700" : "bg-rose-50 text-rose-700"
                                    )}>{m.type}</span>
                                    <p className="text-sm font-black text-slate-800 mt-2 truncate max-w-[200px]">{m.title}</p>
                                  </div>
                                  <div className="flex items-center gap-4 shrink-0">
                                    <div className="text-right">
                                      <span className={cn("font-black text-lg tracking-tighter transition-colors", isHovered ? "text-emerald-600" : "text-slate-900")}>{Num.fmt(m.amount)}</span>
                                      {m.diff > 0 && <p className="text-[9px] font-bold text-amber-500">Dif: {Num.fmt(m.diff)}</p>}
                                    </div>
                                    <button onClick={() => handleLink(selectedItem.id, m.type, m.id, m.comision || 0)} className="bg-slate-900 text-white px-5 py-3 rounded-2xl text-[10px] font-black hover:bg-indigo-600 transition shadow-md active:scale-95">
                                      ENLAZAR
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        selectedItem.status !== 'pending' ? (
                          <div className="flex flex-col items-center justify-center py-12 bg-emerald-50 rounded-[3rem] border-2 border-emerald-100 h-full">
                            <ShieldCheck className="w-16 h-16 text-emerald-400 mb-4" />
                            <p className="text-emerald-700 font-black uppercase tracking-widest text-sm">Conciliado Correctamente</p>
                          </div>
                        ) : (
                          <div className="text-center opacity-40 py-12 h-full flex flex-col justify-center"><Search className="w-12 h-12 mx-auto mb-3 text-slate-400" /><p className="text-xs font-black uppercase tracking-widest">No hay sugerencias exactas</p></div>
                        )
                      )}

                      {/* ⚡ ACCIONES RÁPIDAS */}
                      {selectedItem.status === 'pending' && (
                        <div className="mt-10 pb-4">
                          <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-indigo-500" /> Creación Rápida Manual
                          </h4>
                          <div className="grid grid-cols-2 gap-4">
                            {(Num.parse(selectedItem.amount) > 0 ? [
                              { label: 'Cierre TPV (Tarjetas)', icon: TrendingUp, type: 'TPV' as const },
                              { label: 'Ingreso Efectivo', icon: Building2, type: 'CASH' as const }
                            ] : [
                              { label: 'Gasto Fijo', icon: Zap, type: 'FIXED_EXPENSE' as const },
                              { label: 'Comisión Bancaria', icon: Building2, type: 'FIXED_EXPENSE' as const },
                              { label: 'Personal / Nómina', icon: TrendingDown, type: 'FIXED_EXPENSE' as const }
                            ]).map(cat => (
                              <button key={cat.label} onClick={() => handleQuickAction(selectedItem.id, cat.label, cat.type)} className="p-4 border-2 border-slate-100 rounded-[1.5rem] hover:bg-slate-50 hover:border-indigo-100 text-left transition-all group cursor-pointer bg-white relative z-20">
                                <cat.icon className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 mb-2 transition-colors" />
                                <p className="text-[10px] md:text-[11px] font-black text-slate-600 uppercase tracking-tight leading-tight">{cat.label}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center items-center text-center opacity-40"><Building2 className="w-16 h-16 mb-5" /><p className="text-xs font-black uppercase tracking-widest">Selecciona un movimiento</p></div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      {/* 🚀 MODAL SWIPE INTEGRADO */}
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
