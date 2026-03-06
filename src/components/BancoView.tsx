import React, { useState, useMemo, useRef } from 'react';
import { 
  Building2, Search, Trash2, Clipboard, Upload, Zap, 
  CheckCircle2, ArrowRight, TrendingUp, TrendingDown, 
  Scale, Settings, RefreshCw, ShoppingCart, Eraser 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Albaran, Factura } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import * as XLSX from 'xlsx';

interface BancoViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

// ✅ Utilidades robustas para el banco inteligente
function normalizeDesc(s = '') {
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u00A0\u202F\s]+/g, ' ').trim();
}

function fingerprint(date: string, amount: number, desc: string) {
  return `${date}|${Number(amount || 0).toFixed(2)}|${normalizeDesc(desc)}`;
}

function daysBetween(a: string, b: string) {
  const A = new Date(a).getTime(), B = new Date(b).getTime();
  return Math.abs(A - B) / 86400000;
}

const SUSP_PATTERNS = ['COMISION', 'FEE', 'INTERES', 'INTERESES', 'CARGO', 'GASTO BANCO', 'COMISIONES', 'RETENCION', 'ANULACION DESCONOCIDA', 'DEVOLUCION DESCONOCIDA', 'AJUSTE', 'LIQUID.PROPIA CUENTA'];

function isSuspicious(desc: string) {
  const d = normalizeDesc(desc);
  return SUSP_PATTERNS.some(p => d.includes(p));
}

export const BancoView = ({ data, onSave }: BancoViewProps) => {
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isMagicLoading, setIsMagicLoading] = useState(false);
  
  // 🚀 NUEVO: Estado de filtro rápido
  type BankFilter = 'all' | 'pending' | 'unmatched' | 'suspicious' | 'duplicate' | 'reviewed';
  const [viewFilter, setViewFilter] = useState<BankFilter>('pending');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const n8nUrl = data.config?.n8nUrlBanco || "https://ia.permatunnelopen.org/webhook/1085406f-324c-42f7-b50f-22f211f445cd";

  // --- CALCULATIONS ---
  const stats = useMemo(() => {
    const movements = data.banco || [];
    const sumaMovs = movements.reduce((acc, b) => acc + (Num.parse(b.amount) || 0), 0);
    const saldo = (Num.parse(data.config?.saldoInicial) || 0) + sumaMovs;
    const pending = movements.filter(b => b.status === 'pending');
    const matched = movements.length - pending.length;
    const percent = movements.length > 0 ? Math.round((matched / movements.length) * 100) : 0;
    
    return { saldo, percent, pending: pending.length, total: movements.length, matched };
  }, [data.banco, data.config?.saldoInicial]);

  // 🚀 NUEVO: Previsión de pagos 7 días
  const prevPagos = useMemo(() => {
    const now = new Date();
    const target = new Date(now); target.setDate(now.getDate() + 7);
    
    const items = (data.gastos_fijos || [])
      .filter((g: any) => g.active !== false && g.freq && g.dia_pago)
      .map((g: any) => {
        const due = new Date(now.getFullYear(), now.getMonth(), Number(g.dia_pago) || 1);
        if (due < now) due.setMonth(due.getMonth() + 1);
        return { amount: Num.parse(g.amount), within: due <= target };
      }).filter(x => x.within);
    
    return items.reduce((acc, x) => acc + x.amount, 0);
  }, [data.gastos_fijos]);

  // 🚀 MEJORADO: Lista filtrada con lógica inteligente
  const filteredMovements = useMemo(() => {
    const base = (data.banco || []).filter(b => 
      b.desc.toLowerCase().includes(searchTerm.toLowerCase()) || 
      b.amount.toString().includes(searchTerm)
    );

    return base.filter((b: any) => {
      if (viewFilter === 'all') return true;
      if (viewFilter === 'pending') return b.status === 'pending';
      if (viewFilter === 'unmatched') return b.flags?.unmatched === true;
      if (viewFilter === 'suspicious') return b.flags?.suspicious === true;
      if (viewFilter === 'duplicate') return b.flags?.duplicate === true;
      if (viewFilter === 'reviewed') return b.reviewed === true;
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.banco, searchTerm, viewFilter]);

  const selectedItem = useMemo(() => {
    return data.banco?.find(b => b.id === selectedBankId);
  }, [data.banco, selectedBankId]);

  // Mantenemos tu lógica de sugerencias intacta
  const matches = useMemo(() => {
    if (!selectedItem) return [];
    const amt = Math.abs(Num.parse(selectedItem.amount));
    const results: any[] = [];

    if (Num.parse(selectedItem.amount) > 0) {
      data.cierres?.forEach(c => {
        if (Math.abs(Num.parse(c.tarjeta) - amt) <= 2) {
          const zNum = `Z-${c.date.replace(/-/g, '')}`;
          const fZ = data.facturas?.find(f => f.num === zNum);
          if (fZ && !fZ.reconciled) {
            results.push({ type: 'FACTURA Z', id: fZ.id, date: c.date, title: `Cierre Caja ${c.date}`, amount: Num.parse(c.tarjeta), color: 'emerald' });
          }
        }
      });
      data.facturas?.forEach(f => {
        if (f.cliente !== "Z DIARIO" && !f.reconciled && Num.parse(f.total) > 0 && Math.abs(Num.parse(f.total) - amt) <= 2) {
          results.push({ type: 'FACTURA CLIENTE', id: f.id, date: f.date, title: `Fac ${f.num} (${f.cliente})`, amount: Num.parse(f.total), color: 'teal' });
        }
      });
    } else {
      data.albaranes?.forEach(a => {
        if (!a.reconciled && Math.abs(Num.parse(a.total) - amt) <= 2) {
          results.push({ type: 'ALBARÁN', id: a.id, date: a.date, title: `${a.prov} (${a.num})`, amount: Num.parse(a.total), color: 'indigo' });
        }
      });
      data.facturas?.forEach(f => {
        if (Num.parse(f.total) < 0 && !f.reconciled && Math.abs(Math.abs(Num.parse(f.total)) - amt) <= 2) {
          results.push({ type: 'FACTURA PROV', id: f.id, date: f.date, title: `Fac ${f.num} (${f.prov || 'Prov'})`, amount: Math.abs(Num.parse(f.total)), color: 'rose' });
        }
      });
    }
    return results;
  }, [selectedItem, data.cierres, data.facturas, data.albaranes]);

  // --- ACTIONS ---
  
  // 🚀 NUEVO: Analizador inteligente bajo demanda (No rompe nada)
  const handleAnalyze = async () => {
    const newData = { ...data };
    const seen: any[] = [];
    
    newData.banco = (newData.banco || []).map((m: any) => {
      const n = { ...m };
      const fp = fingerprint(n.date, Num.parse(n.amount), n.desc || '');
      if (!n.hash) n.hash = fp;

      let duplicate = false;
      for (const prev of seen) {
        if (Math.abs(Num.parse(prev.amount) - Num.parse(n.amount)) < 0.005) {
          if (normalizeDesc(prev.desc) === normalizeDesc(n.desc) && daysBetween(prev.date, n.date) <= 2) {
            duplicate = true; break;
          }
        }
      }
      seen.push({ date: n.date, amount: Num.parse(n.amount), desc: n.desc });

      n.flags = {
        duplicate,
        suspicious: isSuspicious(n.desc || ''),
        unmatched: n.status === 'pending' && !n.link?.id
      };
      if (n.reviewed === undefined) n.reviewed = false;
      return n;
    });

    await onSave(newData);
    alert('📊 Análisis completado: Sospechosos y duplicados detectados visualmente.');
  };

  // 🚀 NUEVO: Botón de revisado
  const toggleReviewed = async (id: string, val: boolean) => {
    const newData = { ...data };
    const it: any = newData.banco?.find(b => b.id === id);
    if (!it) return;
    it.reviewed = val;
    await onSave(newData);
  };

  const handleLink = async (bankId: string, matchType: string, docId: string) => {
    const newData = { ...data };
    const bItem: any = newData.banco.find(b => b.id === bankId);
    if (!bItem) return;

    if (matchType === 'ALBARÁN') {
      const alb = newData.albaranes.find(a => a.id === docId);
      if (alb) { alb.reconciled = true; alb.paid = true; }
      bItem.link = { type: 'ALBARAN', id: docId }; // Guardamos la traza
    } else {
      const fac = newData.facturas.find(f => f.id === docId);
      if (fac) { fac.reconciled = true; fac.paid = true; }
      bItem.link = { type: 'FACTURA', id: docId }; // Guardamos la traza
    }

    bItem.status = 'matched';
    await onSave(newData);
    setSelectedBankId(null);
  };

  // Lógica Estricta de QuickActions (Tuya, intacta)
  const handleQuickAction = async (bankId: string, label: string, type: 'ALBARAN' | 'FIXED_EXPENSE' | 'TPV' | 'CASH' | 'INCOME') => {
    const newData = { ...data };
    const item = newData.banco.find(b => b.id === bankId);
    if (!item) return;

    const amtRaw = Num.parse(item.amount);
    const amt = Math.abs(amtRaw);

    if (type === 'FIXED_EXPENSE') {
      const d = new Date(item.date);
      const monthKey = `pagos_${d.getFullYear()}_${d.getMonth() + 1}`;
      if (!newData.control_pagos) newData.control_pagos = {};
      if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
      const isPersonal = label.includes('Personal') || label.includes('Nómina');
      
      const pendingFixed = (newData.gastos_fijos || []).find(g => 
        g.active !== false && g.cat === (isPersonal ? 'personal' : 'varios') &&
        !newData.control_pagos[monthKey].includes(g.id) &&
        Math.abs(Num.parse(g.amount) - amt) < 50 
      );

      if (pendingFixed) {
        newData.control_pagos[monthKey].push(pendingFixed.id);
      } else {
        const newFixedId = 'gf-' + Date.now();
        if (!newData.gastos_fijos) newData.gastos_fijos = [];
        newData.gastos_fijos.push({
          id: newFixedId, name: `${label} (Detectado Auto)`, amount: amt, freq: 'mensual',
          dia_pago: d.getDate(), cat: isPersonal ? 'personal' : 'varios', active: true
        });
        newData.control_pagos[monthKey].push(newFixedId);
      }
    } else if (type === 'TPV') {
      const zMatch = newData.cierres?.find(c => !c.conciliado_banco && Math.abs(Num.parse(c.tarjeta) - amt) <= 5);
      if (zMatch) {
        zMatch.conciliado_banco = true;
        const zNum = `Z-${zMatch.date.replace(/-/g, '')}`;
        const fZ = newData.facturas?.find(f => f.num === zNum);
        if (fZ) fZ.reconciled = true;
      }
    } else if (type === 'CASH') {
      const cMatch = newData.cierres?.find(c => !c.conciliado_banco && Math.abs(Num.parse(c.efectivo) - amt) <= 50);
      if (cMatch) cMatch.conciliado_banco = true;
    }

    item.status = 'matched';
    item.category = label;
    await onSave(newData);
    setSelectedBankId(null);
  };

  const handleMagicMatch = async () => {
    // (Tu lógica de IA intacta)
    const pendings = filteredMovements.slice(0, 25);
    if (pendings.length === 0) return;
    setIsMagicLoading(true);
    try {
      const result = await proxyFetch(n8nUrl, {
        method: 'POST',
        body: { movimientos: pendings.map(m => ({ ...m, descOriginal: m.desc })), saldoInicial: data.config?.saldoInicial }
      });

      if (result && result.movimientos) {
        const newData = { ...data };
        let count = 0;
        for (const mov of result.movimientos) {
          const item = newData.banco.find(b => b.id === mov.id);
          if (!item) continue;
          const amtRaw = Num.parse(item.amount);

          if (amtRaw > 0) {
            if (mov.esCierreTPV) {
              const zMatch = newData.cierres?.find(c => !c.conciliado_banco && Math.abs(Num.parse(c.tarjeta) - Math.abs(amtRaw)) <= 5);
              if (zMatch) {
                zMatch.conciliado_banco = true;
                const fZ = newData.facturas?.find(f => f.num === `Z-${zMatch.date.replace(/-/g, '')}`);
                if (fZ) fZ.reconciled = true;
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
                 newData.gastos_fijos.push({
                    id: newFixedId, name: mov.categoriaAsignada, amount: Math.abs(amtRaw),
                    freq: 'mensual', dia_pago: d.getDate(), cat: catLower.includes('personal') ? 'personal' : 'varios', active: true
                 });
                 newData.control_pagos[monthKey].push(newFixedId);
              }
            }
          }
          item.status = 'matched';
          item.category = mov.categoriaAsignada || 'IA';
          count++;
        }
        await onSave(newData);
        alert(`✨ IA ha conciliado ${count} movimientos adecuadamente.`);
      }
    } catch (err) {
      console.error(err);
      alert("Error con la IA. Verifica el túnel n8n.");
    } finally {
      setIsMagicLoading(false);
    }
  };

  const handleAutoCleanup = async () => {
    // (Tu lógica de limpieza intacta)
    if (!confirm("⚠️ ¿Quieres ejecutar la LIMPIEZA AUTOMÁTICA?")) return;
    const newData = { ...data };
    let eliminados = 0;
    const initialAlbs = (newData.albaranes || []).length;
    newData.albaranes = (newData.albaranes || []).filter(a => {
      return !(a.id.startsWith('auto-') || a.id.startsWith('ia-') || a.prov === 'BANCO' || a.prov?.includes('(IA)'));
    });
    eliminados += (initialAlbs - newData.albaranes.length);

    const initialFacs = (newData.facturas || []).length;
    newData.facturas = (newData.facturas || []).filter(f => {
      return !(f.id.startsWith('auto-fac') || f.id.startsWith('fac-ia-') || f.id.startsWith('fac-z-auto') || f.cliente === 'Z DIARIO AUTO' || f.cliente === 'Ingreso Banco');
    });
    eliminados += (initialFacs - newData.facturas.length);

    await onSave(newData);
    alert(`✨ Limpieza exitosa: Hemos aniquilado ${eliminados} documentos fantasma.`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      const newData = { ...data };
      if (!newData.banco) newData.banco = [];
      let imported = 0;

      rows.forEach(row => {
        const date = row.Fecha || row.Date || row.date;
        const amount = row.Importe || row.Amount || row.amount;
        const desc = row.Concepto || row.Description || row.desc;

        if (date && amount) {
          // 🚀 FIX: Dedupe en la importación
          const dateISO = new Date(date).toISOString().split('T')[0] || String(date);
          const fp = fingerprint(dateISO, Num.parse(amount), String(desc));
          
          const exists = newData.banco.some(b => b.hash === fp);
          if (!exists) {
            newData.banco.push({
              id: 'imp-' + Date.now() + Math.random(),
              date: dateISO, amount: Num.parse(amount), desc: desc || 'Importado',
              status: 'pending', hash: fp
            });
            imported++;
          }
        }
      });

      await onSave(newData);
      alert(`📥 ${imported} movimientos importados nuevos (Duplicados omitidos).`);
    };
    reader.readAsBinaryString(file);
  };

  const handleNuke = async () => {
    if (!confirm("¿Borrar todos los movimientos ya conciliados?")) return;
    const newData = { ...data };
    newData.banco = newData.banco.filter(b => b.status === 'pending');
    await onSave(newData);
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header & KPIs */}
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="flex justify-between items-start relative z-10">
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Banco Inteligente</h2>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1">
              Próximos 7 días: <span className="text-slate-800">{Num.fmt(prevPagos)}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Saldo Actual</p>
            <div className="flex items-center justify-end gap-2">
              <span className="text-3xl font-black text-slate-800">{Num.fmt(stats.saldo)}</span>
            </div>
          </div>
        </div>
        
        <div className="mt-6">
          <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1 uppercase">
            <span>Estado Conciliación</span>
            <span>{stats.matched} / {stats.total}</span>
          </div>
          <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }} animate={{ width: `${stats.percent}%` }}
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {/* TUS BOTONES INTACTOS */}
          <button className="bg-indigo-600 text-white px-5 py-3 rounded-xl text-[10px] font-black hover:bg-indigo-700 transition flex items-center gap-2 shadow-lg">
            <Clipboard className="w-4 h-4" /> PEGAR
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="bg-slate-900 text-white px-5 py-3 rounded-xl text-[10px] font-black hover:scale-105 transition flex items-center gap-2 shadow-lg">
            <Upload className="w-4 h-4" /> SUBIR EXCEL
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx,.xls,.csv" />
          </button>
          <button onClick={handleMagicMatch} disabled={isMagicLoading} className="bg-gradient-to-r from-emerald-400 to-teal-500 text-white px-5 py-3 rounded-xl text-[10px] font-black hover:shadow-lg hover:scale-105 transition shadow-lg flex items-center gap-2 disabled:opacity-50">
            {isMagicLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} AUTO-MATCH (IA)
          </button>
          
          {/* 🚀 BOTÓN NUEVO: ANALIZAR */}
          <button onClick={handleAnalyze} className="bg-amber-50 text-amber-700 px-5 py-3 rounded-xl text-[10px] font-black hover:bg-amber-100 transition shadow-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> ANALIZAR BANDERAS
          </button>

          <button onClick={handleAutoCleanup} className="bg-rose-50 text-rose-600 px-5 py-3 rounded-xl text-[10px] font-black hover:bg-rose-100 transition shadow-sm flex items-center gap-2 ml-auto">
            <Eraser className="w-4 h-4" /> LIMPIAR FANTASMAS
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left List */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-2 rounded-2xl border border-slate-100 flex items-center gap-2 shadow-sm sticky top-0 z-10">
            <Search className="w-4 h-4 text-slate-400 ml-2" />
            <input 
              type="text" placeholder="Buscar movimiento..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent text-xs font-bold outline-none text-slate-600 h-8"
            />
          </div>
          
          {/* 🚀 NUEVO: FILTROS RÁPIDOS */}
          <div className="flex flex-wrap gap-2 px-2">
            {[
              {k:'all', label:'Todo'}, {k:'pending', label:'Pdte.'}, 
              {k:'unmatched', label:'Sin Doc'}, {k:'suspicious', label:'Sospechoso'}, 
              {k:'duplicate', label:'Duplicado'}, {k:'reviewed', label:'Revisado'}
            ].map(opt => (
              <button
                key={opt.k} onClick={() => setViewFilter(opt.k as BankFilter)}
                className={cn(
                  "text-[9px] font-black px-3 py-1.5 rounded-full border transition-all",
                  viewFilter===opt.k ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex justify-between px-2 mt-2">
            <span className="text-[9px] font-bold text-slate-400 uppercase">Vista Actual</span>
            <button onClick={handleNuke} className="text-[9px] font-bold text-rose-400 hover:text-rose-600 flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Limpiar Conciliados
            </button>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {filteredMovements.map((b: any) => (
              <motion.div 
                key={b.id} layoutId={b.id} onClick={() => setSelectedBankId(b.id)}
                className={cn(
                  "group relative bg-white p-4 rounded-2xl border transition cursor-pointer",
                  selectedBankId === b.id ? "ring-2 ring-indigo-500 border-indigo-100 bg-indigo-50/30" : "border-slate-100 hover:border-indigo-200"
                )}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-slate-700 text-xs truncate uppercase tracking-tight">{b.desc}</p>
                    <p className="text-[9px] text-slate-400 font-bold mt-1">{b.date}</p>
                    
                    {/* 🚀 NUEVO: BADGES DE ESTADO VISUAL */}
                    <div className="flex flex-wrap items-center gap-1 mt-2">
                      {b.flags?.suspicious && <span className="text-[8px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">SOSPECHOSO</span>}
                      {b.flags?.duplicate && <span className="text-[8px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">DUPLICADO</span>}
                      {b.flags?.unmatched && <span className="text-[8px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">SIN DOC</span>}
                      {b.reviewed && <span className="text-[8px] font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">REVISADO</span>}
                    </div>
                  </div>
                  <span className={cn(
                    "font-black text-sm whitespace-nowrap",
                    Num.parse(b.amount) < 0 ? "text-slate-900" : "text-emerald-500"
                  )}>
                    {Num.parse(b.amount) > 0 ? '+' : ''}{Num.fmt(b.amount)}
                  </span>
                </div>
              </motion.div>
            ))}
            {filteredMovements.length === 0 && (
              <div className="text-center py-20 bg-slate-50 rounded-[2.5rem] border-2 border-dashed border-slate-200">
                <CheckCircle2 className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                <p className="text-xs font-black text-slate-400 uppercase">Lista vacía</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="lg:col-span-7">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 h-[600px] flex flex-col shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
            
            <AnimatePresence mode="wait">
              {selectedItem ? (
                <motion.div 
                  key={selectedItem.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="flex-1 flex flex-col"
                >
                  <div className="border-b border-slate-100 pb-6 mb-6">
                    <div className="flex justify-between items-start">
                      <span className={cn(
                        "text-[9px] font-black px-2 py-1 rounded uppercase tracking-widest",
                        Num.parse(selectedItem.amount) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      )}>
                        {Num.parse(selectedItem.amount) > 0 ? 'INGRESO' : 'GASTO'}
                      </span>
                      
                      {/* 🚀 NUEVO: BOTÓN DE REVISADO MANUAL */}
                      {!(selectedItem as any).reviewed ? (
                        <button onClick={() => toggleReviewed(selectedItem.id, true)} className="text-[9px] font-black text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded hover:bg-emerald-100 border border-emerald-200">
                          ✓ MARCAR REVISADO
                        </button>
                      ) : (
                        <button onClick={() => toggleReviewed(selectedItem.id, false)} className="text-[9px] font-black text-slate-500 bg-slate-50 px-3 py-1.5 rounded hover:bg-slate-100 border border-slate-200">
                          ⟲ DESMARCAR REVISIÓN
                        </button>
                      )}
                    </div>
                    
                    <h3 className="font-black text-2xl mt-4 leading-tight text-slate-800">{selectedItem.desc}</h3>
                    <p className={cn(
                      "text-4xl font-black mt-2",
                      Num.parse(selectedItem.amount) > 0 ? "text-emerald-500" : "text-slate-900"
                    )}>
                      {Num.fmt(selectedItem.amount)}
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold mt-2 uppercase tracking-widest">Fecha: {selectedItem.date}</p>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                    {matches.length > 0 && (
                      <div className="mb-8">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase mb-4 flex items-center gap-2">
                          <Zap className="w-3 h-3 text-amber-500" />
                          Coincidencias Sugeridas
                        </h4>
                        <div className="space-y-3">
                          {matches.map((m, idx) => (
                            <div key={idx} className={cn(
                              "flex justify-between items-center p-4 rounded-2xl border transition-all hover:shadow-md",
                              m.color === 'emerald' ? "bg-emerald-50 border-emerald-100" : 
                              m.color === 'teal' ? "bg-teal-50 border-teal-100" :
                              m.color === 'indigo' ? "bg-indigo-50 border-indigo-100" : "bg-rose-50 border-rose-100"
                            )}>
                              <div className="text-left">
                                <span className={cn(
                                  "text-[8px] font-black uppercase tracking-widest",
                                  m.color === 'emerald' ? "text-emerald-700" : 
                                  m.color === 'teal' ? "text-teal-700" :
                                  m.color === 'indigo' ? "text-indigo-700" : "text-rose-700"
                                )}>{m.type}</span>
                                <p className="text-xs font-black text-slate-800 mt-1">{m.title}</p>
                                <p className="text-[9px] text-slate-500 font-bold">{m.date}</p>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="font-black text-sm text-slate-800">{Num.fmt(m.amount)}</span>
                                <button 
                                  onClick={() => handleLink(selectedItem.id, m.type, m.id)}
                                  className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[9px] font-black hover:scale-105 transition shadow-lg"
                                >
                                  ENLAZAR
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <h4 className="text-[10px] font-black text-slate-400 uppercase mb-4 flex items-center gap-2">
                      <Zap className="w-3 h-3 text-indigo-500" />
                      ⚡ Creación Rápida
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      {(Num.parse(selectedItem.amount) > 0 ? [
                        { label: 'Cierre TPV (Tarjetas)', icon: TrendingUp, type: 'TPV' as const },
                        { label: 'Ingreso Efectivo', icon: Building2, type: 'CASH' as const },
                        { label: 'Otros Ingresos', icon: TrendingUp, type: 'INCOME' as const }
                      ] : [
                        { label: 'Gasto Fijo', icon: Zap, type: 'FIXED_EXPENSE' as const },
                        { label: 'Comisión Bancaria', icon: Building2, type: 'ALBARAN' as const },
                        { label: 'Suministros', icon: Zap, type: 'FIXED_EXPENSE' as const },
                        { label: 'Personal', icon: TrendingDown, type: 'FIXED_EXPENSE' as const },
                        { label: 'Alquiler', icon: Scale, type: 'FIXED_EXPENSE' as const }
                      ]).map(cat => (
                        <button 
                          key={cat.label}
                          onClick={() => handleQuickAction(selectedItem.id, cat.label, cat.type)}
                          className="p-4 border border-slate-100 rounded-2xl hover:bg-slate-50 text-left transition group cursor-pointer"
                        >
                          <cat.icon className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 mb-2 transition-colors" />
                          <p className="text-[10px] font-black text-slate-600 uppercase">{cat.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="flex-1 flex flex-col justify-center items-center text-center opacity-40">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                    <Building2 className="w-10 h-10 text-slate-300" />
                  </div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Selecciona un movimiento</p>
                  <p className="text-[10px] text-slate-300 font-bold mt-2">Para ver coincidencias y opciones de conciliación</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};
