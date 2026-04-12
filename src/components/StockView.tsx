import React, { useState, useMemo } from 'react';
import { 
  Package, Search, Plus, Minus, AlertCircle, TrendingDown,
  TrendingUp, History, ArrowRight, RefreshCw, Zap, Scale,
  ShoppingBag, Info, Utensils, Store, SplitSquareHorizontal,
  Hotel, Tag, Euro, BarChart3
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Ingrediente, KardexEntry } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { NotificationService } from '../services/notifications';
import { askAI } from '../services/aiProviders';
import { toast } from '../hooks/useToast';
import { ValoracionStock } from './ValoracionStock';

interface StockViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

type BusinessUnit = 'REST' | 'DLV' | 'SHOP';

const UNIT_CONFIG = {
  REST: {
    name:         'Restaurante Arume',
    icon:         Utensils,
    color:        'bg-rose-600',
    text:         'text-rose-600',
    bg:           'bg-rose-50',
    aiRole:       'Jefe de Cocina y Maitre',
    margen:       3.0,
    quickQtys:    [-10, -5, -1, +1, +5, +10],
  },
  DLV: {
    name:         'Catering Hoteles',
    icon:         Hotel,
    color:        'bg-amber-500',
    text:         'text-amber-500',
    bg:           'bg-amber-50',
    aiRole:       'Gestor B2B de Cuentas de Hoteles',
    margen:       1.8,
    quickQtys:    [-10, -5, -1, +1, +5, +10],
  },
  SHOP: {
    name:         'Boutique de Sakes',
    icon:         Store,
    color:        'bg-indigo-600',
    text:         'text-indigo-600',
    bg:           'bg-indigo-50',
    aiRole:       'Sumiller experto en Sakes Premium',
    margen:       1.6,
    // botellas sueltas y cajas de 6/12
    quickQtys:    [-12, -6, -1, +1, +6, +12],
  },
} as const;

type StockSubTab = 'inventario' | 'valoracion';

export const StockView: React.FC<StockViewProps> = ({ data, onSave }) => {
  const [activeUnit,       setActiveUnit]       = useState<BusinessUnit>('SHOP');
  const [subTab,           setSubTab]           = useState<StockSubTab>('inventario');
  const [searchTerm,       setSearchTerm]       = useState('');
  const [filterFam,        setFilterFam]        = useState('Todas');
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [selectedIng,      setSelectedIng]      = useState<Ingrediente | null>(null);
  const [adjustValue,      setAdjustValue]      = useState(0);
  const [adjustReason,     setAdjustReason]     = useState('Venta Manual');
  const [isPredicting,     setIsPredicting]     = useState(false);
  const [prediction,       setPrediction]       = useState<string | null>(null);

  // ── Ingredientes de la unidad activa ──────────────────────────────────────
  const unitIngredients = useMemo(() =>
    (data.ingredientes || []).filter((i: any) =>
      (i.unidad_negocio || 'SHOP') === activeUnit
    ),
    [data.ingredientes, activeUnit]
  );

  // ── Familias de categoría ─────────────────────────────────────────────────
  const familias = useMemo(() => {
    const famsFromData = new Set(unitIngredients.map(i => i.fam).filter(Boolean));
    const defaults: Record<BusinessUnit, string[]> = {
      SHOP: ['Todas', 'Junmai', 'Ginjo', 'Daiginjo', 'Nigori', 'Espumosos'],
      REST: ['Todas', 'Fresco', 'Despensa', 'Bebidas', 'Limpieza'],
      DLV:  ['Todas', 'Materia Prima', 'Envases B2B', 'Merchandising'],
    };
    return famsFromData.size > 0
      ? ['Todas', ...Array.from(famsFromData)]
      : defaults[activeUnit];
  }, [unitIngredients, activeUnit]);

  // ── Ingredientes filtrados ────────────────────────────────────────────────
  const filteredIngredientes = useMemo(() =>
    unitIngredients.filter(i => {
      const matchesSearch   = i.n.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFam      = filterFam === 'Todas' || i.fam === filterFam;
      const matchesCritical = !showCriticalOnly || i.stock <= i.min;
      return matchesSearch && matchesFam && matchesCritical;
    }),
    [unitIngredients, searchTerm, filterFam, showCriticalOnly]
  );

  // ── KPIs del inventario activo ────────────────────────────────────────────
  const kpis = useMemo(() => {
    const cfg     = UNIT_CONFIG[activeUnit];
    const coste   = unitIngredients.reduce((s, i) => s + i.stock * (i.cost || 0), 0);
    const pvp     = unitIngredients.reduce((s, i) => s + i.stock * (i.cost || 0) * cfg.margen, 0);
    const criticos = unitIngredients.filter(i => i.stock <= i.min).length;
    const uds     = unitIngredients.reduce((s, i) => s + i.stock, 0);
    return { coste, pvp, criticos, uds, refs: unitIngredients.length };
  }, [unitIngredients, activeUnit]);

  // ── Ajuste de stock ───────────────────────────────────────────────────────
  const handleAdjustStock = async () => {
    if (!selectedIng || adjustValue === 0) return;

    const newStock  = selectedIng.stock + adjustValue;
    const newKardex = {
      id:             `kdk-${Date.now()}`,
      n:              selectedIng.n,
      ingId:          selectedIng.id,
      ts:             Date.now(),
      date:           new Date().toISOString().split('T')[0],
      qty:            Math.abs(adjustValue),
      type:           adjustValue > 0 ? 'IN' : 'OUT',
      unit:           selectedIng.unit || 'uds',
      price:          selectedIng.cost,
      reason:         adjustReason,
      user:           'Gerencia',
      unidad_negocio: activeUnit,
    } as any;

    const newIngredientes = data.ingredientes.map(i =>
      i.id === selectedIng.id ? { ...i, stock: newStock } : i
    );
    const newData = {
      ...data,
      ingredientes: newIngredientes,
      kardex: [newKardex, ...(data.kardex || [])],
    };
    await onSave(newData);

    if (newStock <= selectedIng.min && NotificationService?.sendAlert) {
      await NotificationService.sendAlert(
        newData,
        `🏮 *ALERTA EN ${UNIT_CONFIG[activeUnit].name.toUpperCase()}*\n\nEl artículo *${selectedIng.n}* está bajo mínimos (${newStock} unidades).\n\nRevisar inventario urgente.`,
        'WARNING'
      );
    }
    setSelectedIng(null);
    setAdjustValue(0);
  };

  // ── Análisis IA ───────────────────────────────────────────────────────────
  const handlePredictStock = async () => {
    setIsPredicting(true);
    setPrediction(null);
    try {
      const cfg = UNIT_CONFIG[activeUnit];

      // Para SHOP incluimos PVP estimado en el contexto de la IA
      const stockData = unitIngredients.map(i => ({
        n:    i.n,
        fam:  i.fam,
        stock: i.stock,
        min:  i.min,
        coste: i.cost,
        ...(activeUnit === 'SHOP'
          ? { pvp_estimado: Num.round2((i.cost || 0) * cfg.margen) }
          : {}),
      }));

      const prompt = `Actúa como ${cfg.aiRole} del negocio '${cfg.name}'.
INVENTARIO ACTUAL: ${JSON.stringify(stockData)}
${activeUnit === 'SHOP' ? 'Es una boutique de sakes premium en Mallorca. Cada botella es un producto de alto valor con margen elevado. Ten en cuenta el pvp_estimado para priorizar los artículos más rentables.' : ''}
Analiza este inventario. Dime qué productos están en peligro crítico de agotarse y da un consejo estratégico corto para mejorar la rentabilidad de este bloque de negocio.
Responde de forma profesional y directa. Máximo 100 palabras.`;

      const res = await askAI([{ role: 'user', content: prompt }]);
      setPrediction(res.text || '');
    } catch (e) {
      toast.error(`Error IA: ${(e as Error).message}`);
    } finally {
      setIsPredicting(false);
    }
  };

  const activeConfig = UNIT_CONFIG[activeUnit];
  const ActiveIcon   = activeConfig.icon;

  return (
    <div className="animate-fade-in space-y-6 pb-24">

      {/* ── SELECTOR DE UNIDAD ───────────────────────────────────────────── */}
      <div className="bg-slate-100 p-1.5 rounded-3xl flex gap-1 shadow-inner overflow-x-auto no-scrollbar">
        {(Object.keys(UNIT_CONFIG) as BusinessUnit[]).map(unit => {
          const Cfg    = UNIT_CONFIG[unit];
          const Icon   = Cfg.icon;
          const active = unit === activeUnit;
          return (
            <button key={unit}
              onClick={() => { setActiveUnit(unit); setPrediction(null); setFilterFam('Todas'); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-[1.5rem] font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap',
                active
                  ? `${Cfg.color} text-white shadow-lg scale-100`
                  : 'text-slate-400 hover:bg-white hover:text-slate-600 scale-95'
              )}>
              <Icon className="w-4 h-4" /> {Cfg.name}
            </button>
          );
        })}
      </div>

      {/* ── SUB-TABS: Inventario / Valoración ─────────────────────────── */}
      <div className="flex gap-2 bg-white rounded-2xl p-1.5 border shadow-sm">
        {([
          { key: 'inventario' as const, label: 'Inventario', icon: Package },
          { key: 'valoracion' as const, label: 'Valoración FIFO/LIFO', icon: Scale },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setSubTab(tab.key)}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all',
              subTab === tab.key
                ? `${activeConfig.color} text-white shadow-lg`
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
            )}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ── VALORACIÓN FIFO/LIFO (sub-tab) ──────────────────────────────── */}
      {subTab === 'valoracion' ? (
        <ValoracionStock data={data} unit={activeUnit} />
      ) : (<>

      {/* ── HEADER DINÁMICO ──────────────────────────────────────────────── */}
      <header className={cn(
        'p-8 rounded-[3rem] shadow-xl text-white flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden transition-colors duration-500',
        activeConfig.color
      )}>
        <div className="absolute top-0 right-0 p-8 opacity-10 scale-150 transform -translate-y-8 translate-x-8">
          <ActiveIcon className="w-40 h-40" />
        </div>

        <div className="z-10 text-center md:text-left">
          <h2 className="text-3xl font-black tracking-tighter">{activeConfig.name}</h2>
          <p className="text-xs font-bold uppercase tracking-[0.3em] flex items-center justify-center md:justify-start gap-2 mt-2 opacity-80">
            <SplitSquareHorizontal className="w-4 h-4" />
            Control de Inventario Aislado
          </p>

          {/* 🆕 KPIs inline en el header */}
          <div className="flex items-center gap-3 mt-3 flex-wrap justify-center md:justify-start">
            <span className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full">
              {kpis.refs} refs · {kpis.uds} uds
            </span>
            <span className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full">
              Coste stock: {Num.fmt(kpis.coste)}
            </span>
            {activeUnit === 'SHOP' && (
              <span className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full">
                PVP estimado: {Num.fmt(kpis.pvp)}
              </span>
            )}
            {kpis.criticos > 0 && (
              <span className="text-[10px] font-black bg-rose-500 px-3 py-1 rounded-full animate-pulse">
                ⚠ {kpis.criticos} bajo mínimo
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 z-10 flex-wrap justify-center">
          <button onClick={handlePredictStock} disabled={isPredicting}
            className="px-6 py-3 bg-white/20 hover:bg-white/30 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 backdrop-blur-sm disabled:opacity-50">
            {isPredicting
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Zap className="w-4 h-4" />}
            Estrategia IA
          </button>
          <button onClick={() => setShowCriticalOnly(!showCriticalOnly)}
            className={cn(
              'px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2',
              showCriticalOnly
                ? 'bg-white text-rose-600 shadow-xl'
                : 'bg-slate-900/20 hover:bg-slate-900/40 backdrop-blur-sm'
            )}>
            <AlertCircle className="w-4 h-4" /> Stock Bajo
          </button>
        </div>
      </header>

      {/* ── GRID PRINCIPAL ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">

          {/* Buscador + filtros de familia */}
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input type="text"
                placeholder={`Buscar en ${activeConfig.name}...`}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-white border border-slate-100 rounded-2xl text-sm font-bold shadow-sm focus:ring-4 ring-indigo-500/5 outline-none transition-all"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar w-full md:w-auto">
              {familias.slice(0, 5).map(f => (
                <button key={f} onClick={() => setFilterFam(f)}
                  className={cn(
                    'px-4 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap border',
                    filterFam === f
                      ? `${activeConfig.color} text-white border-transparent shadow-md`
                      : 'bg-white text-slate-400 border-slate-100 hover:bg-slate-50'
                  )}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Respuesta IA */}
          {prediction && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className={cn('border p-6 rounded-[2rem] relative', activeConfig.bg)}>
              <button onClick={() => setPrediction(null)}
                className="absolute top-3 right-3 text-slate-300 hover:text-slate-500 text-lg leading-none">✕</button>
              <h4 className={cn('font-black text-xs uppercase mb-2 flex items-center gap-2', activeConfig.text)}>
                <Info className="w-4 h-4" /> Análisis de {activeConfig.aiRole}
              </h4>
              <p className={cn('text-xs font-bold leading-relaxed italic opacity-80', activeConfig.text)}>
                "{prediction}"
              </p>
            </motion.div>
          )}

          {/* 🆕 Grid de productos — para SHOP muestra PVP estimado y valor de stock */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence mode="popLayout">
              {filteredIngredientes.map(ing => {
                const critico     = ing.stock <= ing.min;
                const pvpEst      = activeUnit === 'SHOP'
                  ? Num.round2((ing.cost || 0) * UNIT_CONFIG.SHOP.margen)
                  : null;
                const valorStock  = Num.round2(ing.stock * (ing.cost || 0));

                return (
                  <motion.div layout key={ing.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={() => { setSelectedIng(ing); setAdjustValue(0); }}
                    className={cn(
                      'p-6 rounded-[2.5rem] border-2 transition-all cursor-pointer group relative overflow-hidden',
                      critico
                        ? 'bg-white border-rose-200 hover:border-rose-400'
                        : 'bg-white border-slate-50 hover:border-slate-200 shadow-sm hover:shadow-xl'
                    )}>

                    {/* Badge crítico */}
                    {critico && (
                      <span className="absolute top-4 right-4 text-[8px] font-black bg-rose-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                        BAJO MÍNIMO
                      </span>
                    )}

                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 min-w-0 pr-2">
                        <h4 className="font-black text-slate-800 text-base tracking-tight truncate">{ing.n}</h4>
                        <span className={cn('text-[9px] font-black uppercase tracking-[0.2em]', activeConfig.text)}>
                          {ing.fam}
                        </span>
                      </div>
                      {/* Stock actual — grande y visible */}
                      <div className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-black shrink-0',
                        critico ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-800'
                      )}>
                        {ing.stock} <span className="text-[9px] font-bold opacity-60">{ing.unit || 'uds'}</span>
                      </div>
                    </div>

                    {/* Fila de precios */}
                    <div className="flex justify-between items-end mt-3">
                      <div className="space-y-0.5">
                        <p className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1">
                          <Tag className="w-3 h-3" /> Coste: <span className="text-slate-700 font-black">{Num.fmt(ing.cost)}</span>
                        </p>
                        {/* 🆕 PVP estimado solo para SHOP */}
                        {pvpEst !== null && (
                          <p className="text-[9px] font-bold text-indigo-500 uppercase flex items-center gap-1">
                            <Euro className="w-3 h-3" /> PVP est.: <span className="font-black">{Num.fmt(pvpEst)}</span>
                          </p>
                        )}
                        {/* 🆕 Valor total del stock de este artículo */}
                        <p className="text-[9px] font-bold text-slate-400 uppercase">
                          Valor stock: <span className="text-slate-600 font-black">{Num.fmt(valorStock)}</span>
                        </p>
                      </div>
                      <div className={cn(
                        'w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center transition-all shrink-0',
                        `group-hover:${activeConfig.color} group-hover:text-white`
                      )}>
                        <Plus className="w-5 h-5" />
                      </div>
                    </div>
                  </motion.div>
                );
              })}

              {filteredIngredientes.length === 0 && (
                <div className="col-span-full py-12 text-center flex flex-col items-center opacity-50">
                  <ActiveIcon className="w-12 h-12 mb-3" />
                  <p className="text-sm font-black text-slate-500 uppercase tracking-widest">Inventario Vacío</p>
                  <p className="text-xs text-slate-400 mt-1">Cambia los filtros o añade productos</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── LATERAL: Historial + resumen de valor ────────────────────── */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm h-fit">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-2">
              <History className="w-4 h-4" /> Historial {activeConfig.name}
            </h3>

            {/* 🆕 Resumen de valor para SHOP */}
            {activeUnit === 'SHOP' && (
              <div className={cn('p-4 rounded-2xl mb-6 text-center', activeConfig.bg)}>
                <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest mb-0.5">Valor inventario coste</p>
                <p className={cn('text-xl font-black', activeConfig.text)}>{Num.fmt(kpis.coste)}</p>
                <p className="text-[9px] font-bold text-slate-400 mt-0.5">PVP estimado: <span className="font-black text-indigo-600">{Num.fmt(kpis.pvp)}</span></p>
              </div>
            )}

            <div className="space-y-5 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {(data.kardex || [])
                .filter((k: any) => (k.unidad_negocio || 'SHOP') === activeUnit)
                .slice(0, 20)
                .map(k => {
                  // 🆕 Valor monetario del movimiento
                  const valorMov = ((k as any).qty || 0) * ((k as any).price || 0);
                  return (
                    <div key={k.id} className="flex gap-4 items-center animate-fade-in">
                      <div className={cn(
                        'w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm',
                        k.type === 'IN' ? 'bg-emerald-50 text-emerald-500' : 'bg-rose-50 text-rose-500'
                      )}>
                        {k.type === 'IN' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-slate-800 truncate uppercase">{k.n}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase">{k.reason}</p>
                        {/* 🆕 Fecha del movimiento */}
                        <p className="text-[8px] text-slate-300 font-bold">{(k as any).date || ''}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('text-xs font-black', k.type === 'IN' ? 'text-emerald-600' : 'text-rose-600')}>
                          {k.type === 'IN' ? '+' : '-'}{k.qty}
                        </p>
                        {/* 🆕 Valor del movimiento en € */}
                        {valorMov > 0 && (
                          <p className="text-[9px] font-bold text-slate-400">{Num.fmt(valorMov)}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              {!(data.kardex || []).filter((k: any) => (k.unidad_negocio || 'SHOP') === activeUnit).length && (
                <p className="text-xs text-slate-300 text-center py-8 font-bold">Sin movimientos aún</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── MODAL DE AJUSTE ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedIng && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4 backdrop-blur-md bg-slate-900/60">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white p-8 rounded-[3rem] shadow-2xl w-full max-w-sm relative overflow-hidden"
            >
              <header className="text-center mb-8">
                <div className={cn('w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 rotate-3 shadow-lg', activeConfig.color)}>
                  <ActiveIcon className="w-10 h-10 text-white" />
                </div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tighter">{selectedIng.n}</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                  {activeConfig.name}
                </p>

                {/* 🆕 Info rápida del producto */}
                <div className="flex items-center justify-center gap-4 mt-4 flex-wrap">
                  <div className="text-center">
                    <p className="text-[8px] font-black text-slate-400 uppercase">Stock actual</p>
                    <p className={cn('text-lg font-black',
                      selectedIng.stock <= selectedIng.min ? 'text-rose-600' : 'text-slate-800'
                    )}>
                      {selectedIng.stock} <span className="text-xs opacity-60">{selectedIng.unit || 'uds'}</span>
                    </p>
                  </div>
                  <div className="w-px h-8 bg-slate-100" />
                  <div className="text-center">
                    <p className="text-[8px] font-black text-slate-400 uppercase">Coste ud.</p>
                    <p className="text-lg font-black text-slate-800">{Num.fmt(selectedIng.cost)}</p>
                  </div>
                  {/* 🆕 PVP estimado solo en SHOP */}
                  {activeUnit === 'SHOP' && (
                    <>
                      <div className="w-px h-8 bg-slate-100" />
                      <div className="text-center">
                        <p className="text-[8px] font-black text-slate-400 uppercase">PVP est.</p>
                        <p className="text-lg font-black text-indigo-600">
                          {Num.fmt(Num.round2((selectedIng.cost || 0) * UNIT_CONFIG.SHOP.margen))}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </header>

              <div className="space-y-6">

                {/* Ajuste manual +/− */}
                <div className="flex items-center gap-6 justify-center">
                  <button onClick={() => setAdjustValue(v => v - 1)}
                    className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center hover:bg-rose-100 transition shadow-sm active:scale-90">
                    <Minus className="w-6 h-6" />
                  </button>
                  <span className="text-5xl font-black text-slate-900 w-20 text-center tracking-tighter">
                    {adjustValue > 0 ? `+${adjustValue}` : adjustValue}
                  </span>
                  <button onClick={() => setAdjustValue(v => v + 1)}
                    className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center hover:bg-emerald-100 transition shadow-sm active:scale-90">
                    <Plus className="w-6 h-6" />
                  </button>
                </div>

                {/* 🆕 Botones de cantidad rápida */}
                <div className="grid grid-cols-6 gap-1">
                  {activeConfig.quickQtys.map(q => (
                    <button key={q} onClick={() => setAdjustValue(v => v + q)}
                      className={cn(
                        'py-2 rounded-xl text-[9px] font-black transition border',
                        q > 0
                          ? 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100'
                          : 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100'
                      )}>
                      {q > 0 ? `+${q}` : q}
                    </button>
                  ))}
                </div>

                {/* 🆕 Motivos específicos para SHOP vs genéricos */}
                <select value={adjustReason} onChange={e => setAdjustReason(e.target.value)}
                  className="w-full p-4 bg-slate-50 rounded-2xl text-xs font-black border-none outline-none ring-2 ring-transparent focus:ring-slate-300 transition cursor-pointer">
                  {activeUnit === 'SHOP' ? (
                    <>
                      <option value="Venta Manual">🛒 Venta en tienda</option>
                      <option value="Venta Online">📦 Venta online / envío</option>
                      <option value="Venta WhatsApp">💬 Venta por WhatsApp</option>
                      <option value="Entrada Pedido">🚢 Entrada de pedido</option>
                      <option value="Degustación">🍶 Degustación / muestra</option>
                      <option value="Rotura">💢 Rotura / pérdida</option>
                      <option value="Devolución">↩ Devolución cliente</option>
                    </>
                  ) : (
                    <>
                      <option value="Venta Manual">🛒 Venta Realizada</option>
                      <option value="Entrada Pedido">🚚 Entrada de Pedido</option>
                      <option value="Merma Cocina">🔪 Merma en Cocina</option>
                      <option value="Traspaso Interno">🔄 Traspaso a otro local</option>
                      <option value="Rotura">💢 Rotura / Pérdida</option>
                    </>
                  )}
                </select>

                {/* 🆕 Preview del impacto antes de confirmar */}
                {adjustValue !== 0 && (
                  <div className={cn(
                    'p-3 rounded-2xl text-center text-xs font-bold',
                    adjustValue > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                  )}>
                    Nuevo stock: <strong>{selectedIng.stock + adjustValue} {selectedIng.unit || 'uds'}</strong>
                    {' · '}
                    Valor: <strong>{Num.fmt((selectedIng.stock + adjustValue) * (selectedIng.cost || 0))}</strong>
                    {selectedIng.stock + adjustValue <= selectedIng.min && (
                      <p className="text-rose-600 font-black mt-1 text-[10px]">
                        ⚠ Quedará por debajo del mínimo ({selectedIng.min})
                      </p>
                    )}
                  </div>
                )}

                {/* Botones finales */}
                <div className="space-y-3">
                  <button onClick={handleAdjustStock} disabled={adjustValue === 0}
                    className={cn(
                      'w-full text-white py-5 rounded-2xl font-black shadow-xl transition active:scale-95 disabled:opacity-30 text-sm uppercase tracking-widest',
                      activeConfig.color
                    )}>
                    Confirmar cambio
                  </button>
                  <button onClick={() => { setSelectedIng(null); setAdjustValue(0); }}
                    className="w-full text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest py-2">
                    Cerrar sin cambios
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      </>)}
    </div>
  );
};
