import React, { useState, useMemo } from 'react';
import { 
  Package, 
  Search, 
  Plus, 
  Minus, 
  AlertCircle, 
  TrendingDown, 
  TrendingUp, 
  History,
  Filter,
  ArrowRight,
  CheckCircle2,
  XCircle,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Ingrediente, KardexEntry } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { NotificationService } from '../services/notifications';

interface StockViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const StockView: React.FC<StockViewProps> = ({ data, onSave }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFam, setFilterFam] = useState('Todas');
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [selectedIng, setSelectedIng] = useState<Ingrediente | null>(null);
  const [adjustValue, setAdjustValue] = useState(0);
  const [adjustReason, setAdjustReason] = useState('Ajuste Manual');

  const familias = useMemo(() => {
    const fams = new Set(data.ingredientes.map(i => i.fam));
    return ['Todas', ...Array.from(fams)];
  }, [data.ingredientes]);

  const filteredIngredientes = useMemo(() => {
    return data.ingredientes.filter(i => {
      const matchesSearch = i.n.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFam = filterFam === 'Todas' || i.fam === filterFam;
      const isCritical = i.stock <= i.min;
      const matchesCritical = !showCriticalOnly || isCritical;
      return matchesSearch && matchesFam && matchesCritical;
    });
  }, [data.ingredientes, searchTerm, filterFam, showCriticalOnly]);

  const handleAdjustStock = async () => {
    if (!selectedIng || adjustValue === 0) return;

    const newStock = selectedIng.stock + adjustValue;
    const newKardex: KardexEntry = {
      id: Date.now().toString(),
      n: selectedIng.n,
      ingId: selectedIng.id,
      ts: Date.now(),
      date: new Date().toISOString().split('T')[0],
      qty: Math.abs(adjustValue),
      type: adjustValue > 0 ? 'IN' : 'OUT',
      unit: selectedIng.unit,
      price: selectedIng.cost,
      reason: adjustReason,
      user: 'Gerencia'
    };

    const newIngredientes = data.ingredientes.map(i => 
      i.id === selectedIng.id ? { ...i, stock: newStock } : i
    );

    const newData = {
      ...data,
      ingredientes: newIngredientes,
      kardex: [newKardex, ...(data.kardex || [])]
    };

    await onSave(newData);
    
    // Si el stock queda bajo mínimos, enviar alerta
    if (newStock <= selectedIng.min) {
      await NotificationService.sendAlert(newData, `🚨 *STOCK BAJO MÍNIMOS*\n\nEl producto *${selectedIng.n}* ha bajado a ${newStock} ${selectedIng.unit}.\n\nRevisar pedidos.`, 'WARNING');
    }

    setSelectedIng(null);
    setAdjustValue(0);
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header */}
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Gestión de Inventario</h2>
          <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest flex items-center gap-2">
            <Package className="w-3 h-3" />
            Control de Stock y Kardex
          </p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 md:pb-0">
          <button 
            onClick={() => setShowCriticalOnly(!showCriticalOnly)}
            className={cn(
              "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
              showCriticalOnly ? "bg-rose-500 text-white shadow-lg" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            )}
          >
            <AlertCircle className="w-4 h-4" />
            Críticos
          </button>
          <div className="h-8 w-px bg-slate-200 mx-2" />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar ingrediente..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-indigo-500/20 w-48 md:w-64 transition-all"
            />
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Valor Inventario</p>
          <h3 className="text-xl font-black text-slate-800">
            {Num.fmt(data.ingredientes.reduce((acc, i) => acc + (i.stock * i.cost), 0))}
          </h3>
          <p className="text-[10px] text-emerald-500 font-bold mt-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Activo circulante
          </p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Bajo Mínimos</p>
          <h3 className="text-xl font-black text-rose-600">
            {data.ingredientes.filter(i => i.stock <= i.min).length}
          </h3>
          <p className="text-[10px] text-rose-400 font-bold mt-1 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Requiere pedido
          </p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Movimientos Hoy</p>
          <h3 className="text-xl font-black text-indigo-600">
            {data.kardex?.filter(k => k.date === new Date().toISOString().split('T')[0]).length || 0}
          </h3>
          <p className="text-[10px] text-indigo-400 font-bold mt-1 flex items-center gap-1">
            <History className="w-3 h-3" /> Entradas/Salidas
          </p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Familias</p>
          <h3 className="text-xl font-black text-slate-800">{familias.length - 1}</h3>
          <p className="text-[10px] text-slate-400 font-bold mt-1">Categorías activas</p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2">
            {familias.map(f => (
              <button 
                key={f}
                onClick={() => setFilterFam(f)}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                  filterFam === f ? "bg-indigo-600 text-white shadow-lg" : "bg-white border border-slate-100 text-slate-500 hover:bg-slate-50"
                )}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredIngredientes.map(ing => (
              <motion.div 
                layout
                key={ing.id}
                onClick={() => setSelectedIng(ing)}
                className={cn(
                  "p-5 rounded-[2rem] border transition-all cursor-pointer group",
                  ing.stock <= ing.min 
                    ? "bg-rose-50 border-rose-100 hover:border-rose-300" 
                    : "bg-white border-slate-100 hover:border-indigo-100 shadow-sm hover:shadow-md"
                )}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="font-black text-slate-800 text-sm">{ing.n}</h4>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{ing.fam}</p>
                  </div>
                  <div className={cn(
                    "px-2 py-1 rounded-lg text-[9px] font-black uppercase",
                    ing.stock <= ing.min ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-500"
                  )}>
                    {ing.stock} {ing.unit}
                  </div>
                </div>
                
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <p className="text-[9px] text-slate-400 font-bold uppercase">Mínimo: {ing.min} {ing.unit}</p>
                    <p className="text-[9px] text-indigo-500 font-black uppercase">Coste: {Num.fmt(ing.cost)}/{ing.unit}</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Kardex / History */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm h-fit">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-500" />
            Últimos Movimientos
          </h3>
          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {data.kardex?.slice(0, 15).map(k => (
              <div key={k.id} className="flex gap-4 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                  k.type === 'IN' ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"
                )}>
                  {k.type === 'IN' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <p className="text-xs font-bold text-slate-800 truncate">{k.n}</p>
                    <span className={cn(
                      "text-[10px] font-black",
                      k.type === 'IN' ? "text-emerald-600" : "text-rose-600"
                    )}>
                      {k.type === 'IN' ? '+' : '-'}{k.qty} {k.unit}
                    </span>
                  </div>
                  <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{k.reason}</p>
                  <p className="text-[8px] text-slate-300 mt-1">{new Date(k.ts).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Adjust Modal */}
      <AnimatePresence>
        {selectedIng && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedIng(null)}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-sm relative z-10"
            >
              <header className="text-center mb-8">
                <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner">
                  <Package className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-black text-slate-800">{selectedIng.n}</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                  Stock Actual: {selectedIng.stock} {selectedIng.unit}
                </p>
              </header>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-2">Cantidad a Ajustar</label>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setAdjustValue(prev => prev - 1)}
                      className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center hover:bg-rose-100 transition shadow-sm"
                    >
                      <Minus className="w-6 h-6" />
                    </button>
                    <input 
                      type="number" 
                      value={adjustValue}
                      onChange={(e) => setAdjustValue(Number(e.target.value))}
                      className="flex-1 p-4 bg-slate-50 rounded-2xl text-center font-black text-xl outline-none border border-slate-100 focus:ring-2 ring-indigo-500/20 transition"
                    />
                    <button 
                      onClick={() => setAdjustValue(prev => prev + 1)}
                      className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center hover:bg-emerald-100 transition shadow-sm"
                    >
                      <Plus className="w-6 h-6" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-2">Motivo del Ajuste</label>
                  <select 
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="w-full p-4 bg-slate-50 rounded-2xl text-xs font-bold border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20 transition"
                  >
                    <option value="Ajuste Manual">Ajuste Manual</option>
                    <option value="Merma / Rotura">Merma / Rotura</option>
                    <option value="Consumo Interno">Consumo Interno</option>
                    <option value="Inventario Mensual">Inventario Mensual</option>
                    <option value="Error de Recepción">Error de Recepción</option>
                  </select>
                </div>

                <div className="pt-4 space-y-2">
                  <button 
                    onClick={handleAdjustStock}
                    disabled={adjustValue === 0}
                    className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    CONFIRMAR AJUSTE
                  </button>
                  <button 
                    onClick={() => setSelectedIng(null)}
                    className="w-full text-xs font-bold text-slate-400 py-2"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
