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
  ArrowRight,
  RefreshCw,
  Zap,
  ShoppingBag,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Ingrediente, KardexEntry } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { NotificationService } from '../services/notifications';
import { GoogleGenAI } from "@google/genai";

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
  const [adjustReason, setAdjustReason] = useState('Venta Manual');
  const [isPredicting, setIsPredicting] = useState(false);
  const [prediction, setPrediction] = useState<string | null>(null);

  // Categorías típicas de una tienda de Sake para el futuro
  const familias = useMemo(() => {
    const famsFromData = new Set(data.ingredientes.map(i => i.fam));
    // Si no hay categorías aún, ponemos las de Sake por defecto
    const defaults = ['Todas', 'Junmai', 'Ginjo', 'Daiginjo', 'Nigori', 'Espumosos'];
    return famsFromData.size > 0 ? ['Todas', ...Array.from(famsFromData)] : defaults;
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
      id: `kdk-${Date.now()}`,
      n: selectedIng.n,
      ingId: selectedIng.id,
      ts: Date.now(),
      date: new Date().toISOString().split('T')[0],
      qty: Math.abs(adjustValue),
      type: adjustValue > 0 ? 'IN' : 'OUT',
      unit: selectedIng.unit || 'Botella',
      price: selectedIng.cost,
      reason: adjustReason,
      user: 'Boutique Gerencia'
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
    
    if (newStock <= selectedIng.min) {
      if (NotificationService?.sendAlert) {
        await NotificationService.sendAlert(newData, `🏮 *ALERTA DE COLECCIÓN*\n\nEl Sake *${selectedIng.n}* está bajo mínimos (${newStock} botellas).\n\nEs hora de reponer el stock.`, 'WARNING');
      }
    }

    setSelectedIng(null);
    setAdjustValue(0);
  };

  const handlePredictStock = async () => {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("Conecta tu IA en la pestaña 'IA' primero.");

    setIsPredicting(true);
    setPrediction(null);
    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const stockData = data.ingredientes.map(i => ({ n: i.n, stock: i.stock, min: i.min }));
      const recentSales = (data.ventas_menu || []).slice(-20);

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Actúa como sumiller y gestor de una tienda de Sakes.
        INVENTARIO: ${JSON.stringify(stockData)}
        Dime qué botellas están en peligro de agotarse y cuáles han tenido más rotación últimamente.
        Responde como una recomendación estratégica para la tienda de Agnès. Máximo 100 palabras.`
      });

      setPrediction(response.text);
    } catch (err) {
      alert("Error en la predicción de la tienda.");
    } finally {
      setIsPredicting(false);
    }
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header Estilo Boutique */}
      <header className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl text-white flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
           <ShoppingBag className="w-32 h-32" />
        </div>
        <div className="z-10 text-center md:text-left">
          <h2 className="text-3xl font-black tracking-tighter">Boutique de Sakes</h2>
          <p className="text-xs text-indigo-300 font-bold uppercase tracking-[0.3em] flex items-center justify-center md:justify-start gap-2 mt-1">
            <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
            Control de Inventario Premium
          </p>
        </div>
        
        <div className="flex items-center gap-3 z-10 flex-wrap justify-center">
          <button 
            onClick={handlePredictStock}
            disabled={isPredicting}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
          >
            {isPredicting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Estrategia IA
          </button>
          
          <button 
            onClick={() => setShowCriticalOnly(!showCriticalOnly)}
            className={cn(
              "px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
              showCriticalOnly ? "bg-rose-500 text-white shadow-xl" : "bg-white/10 text-white hover:bg-white/20 backdrop-blur-md"
            )}
          >
            <AlertCircle className="w-4 h-4" /> Stock Bajo
          </button>
        </div>
      </header>

      {/* Grid Principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Buscador y Categorías */}
          <div className="flex flex-col md:flex-row gap-4 items-center">
             <div className="relative flex-1 w-full">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Buscar botella por nombre o bodega..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-white border border-slate-100 rounded-2xl text-sm font-bold shadow-sm focus:ring-4 ring-indigo-500/5 outline-none transition-all"
                />
             </div>
             <div className="flex gap-2 overflow-x-auto no-scrollbar w-full md:w-auto">
               {familias.slice(0, 4).map(f => (
                 <button key={f} onClick={() => setFilterFam(f)} className={cn("px-4 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap", filterFam === f ? "bg-slate-900 text-white" : "bg-white text-slate-400 border border-slate-100")}>
                   {f}
                 </button>
               ))}
             </div>
          </div>

          {prediction && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-indigo-50 border border-indigo-100 p-6 rounded-[2rem] relative">
               <h4 className="text-indigo-900 font-black text-xs uppercase mb-2 flex items-center gap-2">
                 <Info className="w-4 h-4" /> Recomendación del Sumiller Virtual
               </h4>
               <p className="text-xs font-medium text-indigo-700 leading-relaxed italic">"{prediction}"</p>
            </motion.div>
          )}

          {/* Listado de Productos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredIngredientes.map(ing => (
              <motion.div 
                layout key={ing.id} onClick={() => setSelectedIng(ing)}
                className={cn(
                  "p-6 rounded-[2.5rem] border-2 transition-all cursor-pointer group relative overflow-hidden",
                  ing.stock <= ing.min 
                    ? "bg-white border-rose-200 hover:border-rose-400" 
                    : "bg-white border-slate-50 hover:border-indigo-100 shadow-sm hover:shadow-xl"
                )}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="font-black text-slate-800 text-base tracking-tight">{ing.n}</h4>
                    <span className="text-[9px] text-indigo-500 font-black uppercase tracking-[0.2em]">{ing.fam}</span>
                  </div>
                  <div className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-black",
                    ing.stock <= ing.min ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-800"
                  )}>
                    {ing.stock} uds.
                  </div>
                </div>
                <div className="flex justify-between items-center mt-auto">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">PVPr: <span className="text-slate-900">{Num.fmt(ing.cost * 2)}</span></p>
                  <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-slate-900 group-hover:text-white transition-all">
                    <Plus className="w-5 h-5" />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Lateral: Historial de Movimientos */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm h-fit">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-8 flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-500" /> Historial Boutique
            </h3>
            <div className="space-y-6 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {data.kardex?.slice(0, 10).map(k => (
                <div key={k.id} className="flex gap-4 items-center">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm",
                    k.type === 'IN' ? "bg-emerald-50 text-emerald-500" : "bg-rose-50 text-rose-500"
                  )}>
                    {k.type === 'IN' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-slate-800 truncate uppercase">{k.n}</p>
                    <p className="text-[9px] text-slate-400 font-bold uppercase">{k.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-xs font-black", k.type === 'IN' ? "text-emerald-600" : "text-rose-600")}>
                      {k.type === 'IN' ? '+' : '-'}{k.qty}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Ajuste de Sake */}
      <AnimatePresence>
        {selectedIng && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4 backdrop-blur-md bg-slate-900/40">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white p-10 rounded-[3rem] shadow-2xl w-full max-w-sm relative overflow-hidden">
              <header className="text-center mb-10">
                <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-4 rotate-3">
                  <ShoppingBag className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tighter">{selectedIng.n}</h3>
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-1">Stock Actual: {selectedIng.stock} unidades</p>
              </header>

              <div className="space-y-8">
                <div className="flex items-center gap-6 justify-center">
                  <button onClick={() => setAdjustValue(prev => prev - 1)} className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center hover:bg-rose-100 transition shadow-sm"><Minus className="w-6 h-6" /></button>
                  <span className="text-4xl font-black text-slate-900 w-16 text-center">{adjustValue}</span>
                  <button onClick={() => setAdjustValue(prev => prev + 1)} className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center hover:bg-emerald-100 transition shadow-sm"><Plus className="w-6 h-6" /></button>
                </div>

                <select value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="w-full p-4 bg-slate-50 rounded-2xl text-xs font-black border-none outline-none ring-2 ring-transparent focus:ring-indigo-500/20 transition">
                  <option value="Venta Manual">🛍️ Venta Realizada</option>
                  <option value="Entrada Pedido">🚚 Entrada de Pedido</option>
                  <option value="Degustación">🍷 Degustación / Muestra</option>
                  <option value="Rotura">💢 Botella Rota</option>
                </select>

                <div className="space-y-3">
                  <button onClick={handleAdjustStock} disabled={adjustValue === 0} className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black shadow-xl hover:shadow-indigo-500/20 transition active:scale-95 disabled:opacity-30">CONFIRMAR CAMBIO</button>
                  <button onClick={() => setSelectedIng(null)} className="w-full text-[10px] font-black text-slate-300 uppercase tracking-widest">Cerrar sin cambios</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
