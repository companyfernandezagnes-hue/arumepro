import React, { useState, useMemo } from 'react';
import { 
  Package, Search, Plus, Minus, AlertCircle, TrendingDown, 
  TrendingUp, History, ArrowRight, RefreshCw, Zap, 
  ShoppingBag, Info, Utensils, Bike, Store, SplitSquareHorizontal
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

type BusinessUnit = 'REST' | 'DLV' | 'SHOP';

const UNIT_CONFIG = {
  'REST': { name: 'Restaurante Arume', icon: Utensils, color: 'bg-rose-600', text: 'text-rose-600', bg: 'bg-rose-50', aiRole: 'Jefe de Cocina y Maitre' },
  'DLV': { name: 'Delivery Arume', icon: Bike, color: 'bg-orange-500', text: 'text-orange-500', bg: 'bg-orange-50', aiRole: 'Gestor de Operaciones de Delivery' },
  'SHOP': { name: 'Boutique de Sakes', icon: Store, color: 'bg-indigo-600', text: 'text-indigo-600', bg: 'bg-indigo-50', aiRole: 'Sumiller experto en Sakes' }
};

export const StockView: React.FC<StockViewProps> = ({ data, onSave }) => {
  // 🚀 NUEVO: Estado para controlar en qué Unidad de Negocio estamos
  const [activeUnit, setActiveUnit] = useState<BusinessUnit>('SHOP');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFam, setFilterFam] = useState('Todas');
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [selectedIng, setSelectedIng] = useState<Ingrediente | null>(null);
  const [adjustValue, setAdjustValue] = useState(0);
  const [adjustReason, setAdjustReason] = useState('Venta Manual');
  const [isPredicting, setIsPredicting] = useState(false);
  const [prediction, setPrediction] = useState<string | null>(null);

  // Filtramos los ingredientes POR UNIDAD DE NEGOCIO primero
  const unitIngredients = useMemo(() => {
    return (data.ingredientes || []).filter((i: any) => {
      // Si el ingrediente no tiene unidad asignada, asumimos que es de la tienda por retrocompatibilidad temporal
      const itemUnit = i.unidad_negocio || 'SHOP'; 
      return itemUnit === activeUnit;
    });
  }, [data.ingredientes, activeUnit]);

  const familias = useMemo(() => {
    const famsFromData = new Set(unitIngredients.map(i => i.fam));
    const defaults = activeUnit === 'SHOP' 
      ? ['Todas', 'Junmai', 'Ginjo', 'Daiginjo', 'Nigori', 'Espumosos']
      : ['Todas', 'Materia Prima', 'Bebidas', 'Embalaje'];
    return famsFromData.size > 0 ? ['Todas', ...Array.from(famsFromData)] : defaults;
  }, [unitIngredients, activeUnit]);

  const filteredIngredientes = useMemo(() => {
    return unitIngredients.filter(i => {
      const matchesSearch = i.n.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFam = filterFam === 'Todas' || i.fam === filterFam;
      const isCritical = i.stock <= i.min;
      const matchesCritical = !showCriticalOnly || isCritical;
      return matchesSearch && matchesFam && matchesCritical;
    });
  }, [unitIngredients, searchTerm, filterFam, showCriticalOnly]);

  const handleAdjustStock = async () => {
    if (!selectedIng || adjustValue === 0) return;

    const newStock = selectedIng.stock + adjustValue;
    const newKardex: KardexEntry & { unidad_negocio: string } = {
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
      user: 'Gerencia',
      unidad_negocio: activeUnit // 🚀 CRÍTICO: Trazabilidad para el reparto de beneficios
    } as any;

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
        await NotificationService.sendAlert(newData, `🏮 *ALERTA EN ${UNIT_CONFIG[activeUnit].name.toUpperCase()}*\n\nEl artículo *${selectedIng.n}* está bajo mínimos (${newStock} unidades).\n\nRevisar inventario urgente.`, 'WARNING');
      }
    }

    setSelectedIng(null);
    setAdjustValue(0);
  };

  const handlePredictStock = async () => {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("Conecta tu IA en la configuración del ERP primero.");

    setIsPredicting(true);
    setPrediction(null);
    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const stockData = unitIngredients.map(i => ({ n: i.n, stock: i.stock, min: i.min }));
      
      const config = UNIT_CONFIG[activeUnit];

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Actúa como ${config.aiRole} del negocio '${config.name}'.
        INVENTARIO ACTUAL: ${JSON.stringify(stockData)}
        Analiza este inventario. Dime qué productos están en peligro crítico de agotarse y da un consejo estratégico corto para mejorar la rentabilidad de este bloque de negocio específico.
        Responde de forma profesional y directa. Máximo 100 palabras.`
      });

      setPrediction(response.text);
    } catch (err) {
      alert("Error en la predicción de IA.");
    } finally {
      setIsPredicting(false);
    }
  };

  const activeConfig = UNIT_CONFIG[activeUnit];
  const ActiveIcon = activeConfig.icon;

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* 🚀 Selector Multi-Unidad de Negocio */}
      <div className="bg-slate-100 p-1.5 rounded-3xl flex gap-1 shadow-inner overflow-x-auto no-scrollbar">
        {(Object.keys(UNIT_CONFIG) as BusinessUnit[]).map((unit) => {
          const Config = UNIT_CONFIG[unit];
          const Icon = Config.icon;
          const isActive = activeUnit === unit;
          return (
            <button
              key={unit}
              onClick={() => { setActiveUnit(unit); setPrediction(null); setFilterFam('Todas'); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap",
                isActive ? `${Config.color} text-white shadow-lg scale-100` : "text-slate-400 hover:bg-white hover:text-slate-600 scale-95"
              )}
            >
              <Icon className="w-4 h-4" />
              {Config.name}
            </button>
          );
        })}
      </div>

      {/* Header Dinámico */}
      <header className={cn("p-8 rounded-[3rem] shadow-xl text-white flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden transition-colors duration-500", activeConfig.color)}>
        <div className="absolute top-0 right-0 p-8 opacity-10 scale-150 transform -translate-y-8 translate-x-8">
           <ActiveIcon className="w-40 h-40" />
        </div>
        <div className="z-10 text-center md:text-left">
          <h2 className="text-3xl font-black tracking-tighter">{activeConfig.name}</h2>
          <p className="text-xs font-bold uppercase tracking-[0.3em] flex items-center justify-center md:justify-start gap-2 mt-2 opacity-80">
            <SplitSquareHorizontal className="w-4 h-4" />
            Control de Inventario Aislado
          </p>
        </div>
        
        <div className="flex items-center gap-3 z-10 flex-wrap justify-center">
          <button 
            onClick={handlePredictStock}
            disabled={isPredicting}
            className="px-6 py-3 bg-white/20 hover:bg-white/30 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 backdrop-blur-sm disabled:opacity-50"
          >
            {isPredicting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Estrategia IA
          </button>
          
          <button 
            onClick={() => setShowCriticalOnly(!showCriticalOnly)}
            className={cn(
              "px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
              showCriticalOnly ? "bg-white text-rose-600 shadow-xl" : "bg-slate-900/20 hover:bg-slate-900/40 backdrop-blur-sm"
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
                  placeholder={`Buscar en ${activeConfig.name}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-white border border-slate-100 rounded-2xl text-sm font-bold shadow-sm focus:ring-4 ring-indigo-500/5 outline-none transition-all"
                />
             </div>
             <div className="flex gap-2 overflow-x-auto no-scrollbar w-full md:w-auto">
               {familias.slice(0, 4).map(f => (
                 <button 
                  key={f} 
                  onClick={() => setFilterFam(f)} 
                  className={cn(
                    "px-4 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap border", 
                    filterFam === f ? `${activeConfig.color} text-white border-transparent shadow-md` : "bg-white text-slate-400 border-slate-100 hover:bg-slate-50"
                  )}
                 >
                   {f}
                 </button>
               ))}
             </div>
          </div>

          {prediction && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className={cn("border p-6 rounded-[2rem] relative", activeConfig.bg, `border-${activeConfig.color.split('-')[1]}-200`)}>
               <h4 className={cn("font-black text-xs uppercase mb-2 flex items-center gap-2", activeConfig.text)}>
                 <Info className="w-4 h-4" /> Análisis de {activeConfig.aiRole}
               </h4>
               <p className={cn("text-xs font-bold leading-relaxed italic opacity-80", activeConfig.text)}>"{prediction}"</p>
            </motion.div>
          )}

          {/* Listado de Productos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence mode="popLayout">
              {filteredIngredientes.map(ing => (
                <motion.div 
                  layout 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  key={ing.id} 
                  onClick={() => setSelectedIng(ing)}
                  className={cn(
                    "p-6 rounded-[2.5rem] border-2 transition-all cursor-pointer group relative overflow-hidden",
                    ing.stock <= ing.min 
                      ? "bg-white border-rose-200 hover:border-rose-400" 
                      : "bg-white border-slate-50 hover:border-slate-200 shadow-sm hover:shadow-xl"
                  )}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-black text-slate-800 text-base tracking-tight">{ing.n}</h4>
                      <span className={cn("text-[9px] font-black uppercase tracking-[0.2em]", activeConfig.text)}>{ing.fam}</span>
                    </div>
                    <div className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-black",
                      ing.stock <= ing.min ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-800"
                    )}>
                      {ing.stock} {ing.unit || 'uds'}
                    </div>
                  </div>
                  <div className="flex justify-between items-center mt-auto">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Costo: <span className="text-slate-900">{Num.fmt(ing.cost)}</span></p>
                    <div className={cn("w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center transition-all", `group-hover:${activeConfig.color} group-hover:text-white`)}>
                      <Plus className="w-5 h-5" />
                    </div>
                  </div>
                </motion.div>
              ))}
              {filteredIngredientes.length === 0 && (
                <div className="col-span-full py-12 text-center flex flex-col items-center opacity-50">
                  <ActiveIcon className="w-12 h-12 mb-3" />
                  <p className="text-sm font-black text-slate-500 uppercase tracking-widest">Inventario Vacío</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Lateral: Historial de Movimientos de la Unidad */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm h-fit">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-8 flex items-center gap-2">
              <History className="w-4 h-4" /> Historial {activeConfig.name}
            </h3>
            <div className="space-y-6 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {(data.kardex || [])
                .filter((k: any) => (k.unidad_negocio || 'SHOP') === activeUnit)
                .slice(0, 15)
                .map(k => (
                <div key={k.id} className="flex gap-4 items-center animate-fade-in">
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

      {/* Modal de Ajuste */}
      <AnimatePresence>
        {selectedIng && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4 backdrop-blur-md bg-slate-900/60">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white p-10 rounded-[3rem] shadow-2xl w-full max-w-sm relative overflow-hidden">
              <header className="text-center mb-10">
                <div className={cn("w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 rotate-3 shadow-lg", activeConfig.color)}>
                  <ActiveIcon className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tighter">{selectedIng.n}</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Unidad: {activeConfig.name}</p>
              </header>

              <div className="space-y-8">
                <div className="flex items-center gap-6 justify-center">
                  <button onClick={() => setAdjustValue(prev => prev - 1)} className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center hover:bg-rose-100 transition shadow-sm"><Minus className="w-6 h-6" /></button>
                  <span className="text-5xl font-black text-slate-900 w-20 text-center tracking-tighter">{adjustValue}</span>
                  <button onClick={() => setAdjustValue(prev => prev + 1)} className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center hover:bg-emerald-100 transition shadow-sm"><Plus className="w-6 h-6" /></button>
                </div>

                <select value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="w-full p-4 bg-slate-50 rounded-2xl text-xs font-black border-none outline-none ring-2 ring-transparent focus:ring-slate-300 transition cursor-pointer">
                  <option value="Venta Manual">🛒 Venta Realizada</option>
                  <option value="Entrada Pedido">🚚 Entrada de Pedido</option>
                  <option value="Merma Cocina">🔪 Merma en Cocina</option>
                  <option value="Traspaso Interno">🔄 Traspaso a otro local</option>
                  <option value="Rotura">💢 Rotura / Pérdida</option>
                </select>

                <div className="space-y-3">
                  <button onClick={handleAdjustStock} disabled={adjustValue === 0} className={cn("w-full text-white py-5 rounded-2xl font-black shadow-xl transition active:scale-95 disabled:opacity-30", activeConfig.color)}>
                    CONFIRMAR CAMBIO
                  </button>
                  <button onClick={() => { setSelectedIng(null); setAdjustValue(0); }} className="w-full text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest py-2">
                    Cerrar sin cambios
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
