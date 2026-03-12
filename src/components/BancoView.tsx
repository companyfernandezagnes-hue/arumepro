import React, { useState, useMemo, useRef, useEffect, useDeferredValue } from 'react';
import { 
  Building2, Search, Trash2, Clipboard, Upload, Zap, 
  CheckCircle2, ArrowRight, TrendingUp, TrendingDown, 
  Scale, Settings, RefreshCw, ShoppingCart, Eraser,
  AlertTriangle, Eye, EyeOff, Sparkles, Filter,
  History, Calendar, Info, BarChart3, PieChart,
  ArrowUpRight, ArrowDownLeft, Check, X as CloseIcon,
  Loader2, Landmark
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';

// 🚀 IMPORTAMOS LA LÓGICA MODULAR (NUEVO)
import { findMatches, executeLink, fingerprint, isSuspicious, daysBetween, normalizeDesc } from '../services/bancoLogic';

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

  // --- STATS Y FLUJO ---
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

  const filteredMovements = useMemo(() => {
    const base = (data.banco || []).filter((b: any) => 
      b.desc.toLowerCase().includes(deferredSearch.toLowerCase()) || 
      b.amount.toString().includes(deferredSearch)
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

  // 🚀 USAMOS EL MOTOR EXTERNO DE BÚSQUEDA
  const matches = useMemo(() => {
    if (!selectedItem) return [];
    return findMatches(selectedItem, data);
  }, [selectedItem, data]);

  // --- ACCIONES ---
  const handleApiSync = async () => {
    setIsApiSyncing(true);
    try {
      await new Promise(r => setTimeout(r, 2000));
      alert("✅ Sincronización bancaria API iniciada.");
    } finally { setIsApiSyncing(false); }
  };

  const handleLink = async (bankId: string, matchType: string, docId: string, comision: number = 0) => {
    const newData = JSON.parse(JSON.stringify(data));
    executeLink(newData, bankId, matchType, docId, comision); // Llamada al servicio limpio
    await onSave(newData);
    setSelectedBankId(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wsname]);
      
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
            const excelEpoch = new Date(1899, 11, 30);
            dateISO = new Date(excelEpoch.getTime() + date * 86400000).toISOString().split('T')[0];
          }
          const fp = fingerprint(dateISO, Num.parse(amount), String(desc));
          if (!newData.banco.some((b: any) => b.hash === fp)) {
            newData.banco.push({
              id: 'imp-' + Date.now() + Math.random().toString(36).slice(2, 7),
              date: dateISO, amount: Num.parse(amount), desc: desc || 'Importado',
              status: 'pending', hash: fp
            });
            imported++;
          }
        }
      });
      await onSave(newData);
      alert(`📥 ${imported} movimientos importados.`);
    };
    reader.readAsBinaryString(file);
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
            {isApiSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} SYNC PSD2 (BETA)
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
                        <div className="text-center opacity-40 py-10"><Search className="w-10 h-10 mx-auto mb-2" /><p className="text-xs font-black uppercase">Sin coincidencias</p></div>
                      )
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

      {/* AQUÍ IRÍA EL MODAL SWIPE RECONCILER COMO LO TENÍAS (Que ahora usaría findMatches internamente) */}
    </div>
  );
};
