import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ChefHat, TrendingUp, PieChart, Calendar, ChevronLeft, ChevronRight, 
  Download, Zap, Plus, Clipboard, Upload, Bot, Trash2, X, Search, AlertTriangle, 
  CheckCircle2, TableProperties, Scale, Target, Calculator, LayoutGrid, Receipt
} from 'lucide-react';
import { AppData, Plato, VentaMenu } from '../types';
import { Num, DateUtil } from '../services/engine';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';

interface MenuViewProps {
  db: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

type FilterMode = 'day' | 'month' | 'year';
type ViewTab = 'matrix' | 'table' | 'omnes' | 'families' | 'simulator';

/* =======================================================
 * 🛡️ FUNCIONES DE DOMINIO Y ENGINES (Protegidas anti-crash)
 * ======================================================= */

// Determina el IVA aplicable (M2)
const getIva = (categoria: string) => {
  const cat = categoria.toLowerCase();
  return (cat.includes('bebida') || cat.includes('alcohol') || cat.includes('vino')) ? 0.21 : 0.10;
};

// Precio neto = Precio / (1 + IVA)
const getNetPrice = (price: number, iva: number) => {
  return price > 0 ? Num.round2(price / (1 + iva)) : 0;
};

// Normalizar texto para búsquedas
const norm = (s: string) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, '');

/* =======================================================
 * 🧠 HOOK ORQUESTADOR: MENU INTELLIGENCE PRO
 * ======================================================= */
function useMenuIntelligencePRO(db: AppData, filterMode: FilterMode, filterValue: string, searchQ: string, targetFC: number) {
  return useMemo(() => {
    // Estructura base inicializada a cero
    const result = { 
      stars: [] as any[], horses: [] as any[], puzzles: [] as any[], dogs: [] as any[], 
      tips: [] as string[], mixTable: [] as any[],
      families: {} as Record<string, { qty: number, ventasBrutas: number, ventasNetas: number, coste: number, beneficio: number }>,
      totalTeoricoBruto: 0, totalTeoricoNeto: 0, totalCosteIdeal: 0, totalBeneficioBruto: 0, 
      foodCostTeorico: 0, foodCostReal: 0, totalCajaRealNeto: 0, totalComprasNetas: 0,
      omnes: { precioMedioOfertado: 0, precioMedioDemandado: 0, ratioOmnes: 0, rangoMax: 0, rangoMin: 0, amplitud: 0, cumple1: false, cumple2: false, grupos: { bajo:0, medio:0, alto:0} }
    };
    
    if (!db.platos || db.platos.length === 0) return result;

    // --- FILTRADO DE FECHAS ---
    const checkDate = (dateStr: string) => {
      if (!dateStr) return false;
      if (filterMode === 'day') return dateStr === filterValue;
      if (filterMode === 'month') return dateStr.startsWith(filterValue);
      if (filterMode === 'year') return dateStr.startsWith(filterValue);
      return false;
    };

    // --- DATOS REALES (Food Cost Real) ---
    const ventasFiltradas = (db.ventas_menu || []).filter(v => checkDate(v.date) && Num.parse(v.qty) > 0);
    
    result.totalCajaRealNeto = (db.cierres || [])
      .filter(c => checkDate(c.date) && c.unitId === 'REST')
      .reduce((acc, c) => acc + (Num.parse(c.totalVenta) / 1.10), 0); // Aproximación para el neto global

    result.totalComprasNetas = (db.albaranes || [])
      .filter(a => checkDate(a.date) && (a.unitId === 'REST' || !a.unitId))
      .reduce((acc, a) => acc + Num.parse(a.base), 0);

    result.foodCostReal = result.totalCajaRealNeto > 0 ? (result.totalComprasNetas / result.totalCajaRealNeto) * 100 : 0;

    const ventasPorPlato: Record<string, number> = {};
    ventasFiltradas.forEach(v => { ventasPorPlato[v.id] = (ventasPorPlato[v.id] || 0) + Num.parse(v.qty); });

    let totalQty = 0;
    let sumMargenPonderado = 0;
    const searchN = norm(searchQ);

    // --- ANÁLISIS DE PLATOS (Food Cost Teórico y Familias) ---
    const analisis = db.platos.map(p => {
      const iva = getIva(p.category || 'General');
      const precioBruto = Num.parse(p.price);
      const precioNeto = getNetPrice(precioBruto, iva);
      const coste = Num.parse(p.cost) || 0; 
      const qty = ventasPorPlato[p.id] || 0;
      
      const margenUnitario = precioNeto - coste;
      const fcUnitario = precioNeto > 0 ? (coste / precioNeto) * 100 : 0;
      const precioIdeal = coste > 0 ? Num.round2((coste / (targetFC / 100)) * (1 + iva)) : precioBruto; 
      
      const totalVentasBrutoLinea = precioBruto * qty;
      const totalVentasNetoLinea = precioNeto * qty;
      const totalCosteLinea = coste * qty;
      const totalBeneficioLinea = margenUnitario * qty;

      totalQty += qty;
      sumMargenPonderado += (margenUnitario * qty);
      
      result.totalTeoricoBruto += totalVentasBrutoLinea;
      result.totalTeoricoNeto += totalVentasNetoLinea;
      result.totalCosteIdeal += totalCosteLinea;
      result.totalBeneficioBruto += totalBeneficioLinea;

      // Familias
      const cat = p.category || 'General';
      if (!result.families[cat]) result.families[cat] = { qty: 0, ventasBrutas: 0, ventasNetas: 0, coste: 0, beneficio: 0 };
      result.families[cat].qty += qty;
      result.families[cat].ventasBrutas += totalVentasBrutoLinea;
      result.families[cat].ventasNetas += totalVentasNetoLinea;
      result.families[cat].coste += totalCosteLinea;
      result.families[cat].beneficio += totalBeneficioLinea;

      return { 
        ...p, qty, precioNeto, margenUnitario, fcUnitario, precioIdeal,
        totalVentasLinea: totalVentasNetoLinea, totalCosteLinea, totalBeneficioLinea 
      };
    });

    result.foodCostTeorico = result.totalTeoricoNeto > 0 ? (result.totalCosteIdeal / result.totalTeoricoNeto) * 100 : 0;

    // --- MATRIZ BCG (Menu Engineering) ---
    const activos = analisis.filter(p => p.qty > 0);
    
    if (totalQty > 0 && activos.length > 0) {
      const mediaPop = (1 / activos.length) * 100 * 0.7; // Fórmula estándar
      const mediaMargen = sumMargenPonderado / totalQty; 

      analisis.forEach(p => {
        const mixPct = totalQty > 0 ? (p.qty / totalQty) * 100 : 0;
        const item = { ...p, mixPct };
        
        if (p.qty > 0 || (searchN && norm(p.name).includes(searchN))) {
          result.mixTable.push(item);
        }

        const esPop = mixPct >= mediaPop;
        const esRent = p.margenUnitario >= mediaMargen;

        if (esPop && esRent) result.stars.push(item);
        else if (esPop && !esRent) result.horses.push(item);
        else if (!esPop && esRent) result.puzzles.push(item);
        else result.dogs.push(item);

        // IA Coach Rules
        if (esPop && !esRent && p.qty > 5) result.tips.push(`🐴 <b>${p.name}</b>: Vende mucho pero el FC% es alto (${Num.round2(p.fcUnitario)}%). El PVP ideal debería ser <b>${Num.fmt(p.precioIdeal)}</b>.`);
        if (!esPop && !esRent && p.qty === 0) result.tips.push(`🧟 <b>${p.name}</b>: 0 ventas registradas. Ocupa espacio en cocina y carta. ¿Eliminar?`);
        if (!esPop && esRent && p.qty > 0) result.tips.push(`💎 <b>${p.name}</b>: Gran margen (${Num.fmt(p.margenUnitario)}/ud). Pide al equipo que lo recomiende activamente.`);
      });
    }

    if (result.foodCostReal > result.foodCostTeorico + 3 && result.totalComprasNetas > 0) {
      result.tips.unshift(`🚨 <b>ALERTA DE MERMAS:</b> Tu Food Cost Real (${Num.round2(result.foodCostReal)}%) es mayor que el Teórico (${Num.round2(result.foodCostTeorico)}%). Revisa inventarios, mermas o invitaciones.`);
    }

    // --- LEY DE OMNES ---
    const preciosValidos = db.platos.filter(p => Num.parse(p.price) > 0).map(p => Num.parse(p.price)).sort((a, b) => a - b);
    if (preciosValidos.length > 0 && totalQty > 0) {
      const min = preciosValidos[0];
      const max = preciosValidos[preciosValidos.length - 1];
      result.omnes.rangoMax = max;
      result.omnes.rangoMin = min;
      result.omnes.amplitud = min > 0 ? max / min : 0;
      
      const recorrido = (max - min) / 3;
      preciosValidos.forEach(p => {
        if (p <= min + recorrido) result.omnes.grupos.bajo++;
        else if (p <= min + 2 * recorrido) result.omnes.grupos.medio++;
        else result.omnes.grupos.alto++;
      });

      result.omnes.cumple1 = result.omnes.grupos.medio >= (result.omnes.grupos.bajo + result.omnes.grupos.alto);
      result.omnes.cumple2 = preciosValidos.length > 9 ? result.omnes.amplitud <= 3 : result.omnes.amplitud <= 2.5;

      result.omnes.precioMedioOfertado = preciosValidos.reduce((a,b) => a+b, 0) / preciosValidos.length;
      result.omnes.precioMedioDemandado = totalQty > 0 ? result.totalTeoricoBruto / totalQty : 0;
      result.omnes.ratioOmnes = result.omnes.precioMedioOfertado > 0 ? result.omnes.precioMedioDemandado / result.omnes.precioMedioOfertado : 0;
    }

    // Filtrar la tabla si hay búsqueda
    if (searchN) {
      result.mixTable = result.mixTable.filter(p => norm(p.name).includes(searchN));
    }

    result.mixTable.sort((a, b) => b.totalBeneficioLinea - a.totalBeneficioLinea);

    return result;
  }, [db.platos, db.ventas_menu, db.cierres, db.albaranes, filterMode, filterValue, searchQ, targetFC]);
}

/* =======================================================
 * 🎨 COMPONENTE PRINCIPAL (VISTA)
 * ======================================================= */
export const MenuView: React.FC<MenuViewProps> = ({ db, onSave }) => {
  const [filterMode, setFilterMode] = useState<FilterMode>('month');
  const [filterValue, setFilterValue] = useState(new Date().toISOString().slice(0, 7));
  const [searchQ, setSearchQ] = useState('');
  const [viewTab, setViewTab] = useState<ViewTab>('matrix');
  const [targetFC, setTargetFC] = useState(30); 
  
  const [isPulseOpen, setIsPulseOpen] = useState(false);
  const [editingPlato, setEditingPlato] = useState<Plato | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 🧠 Instanciamos el Motor Seguro
  const data = useMenuIntelligencePRO(db, filterMode, filterValue, searchQ, targetFC);
  
  // Simulador
  const [simulatedPlatos, setSimulatedPlatos] = useState<any[]>([]);
  useEffect(() => {
    if (viewTab === 'simulator') {
      setSimulatedPlatos(JSON.parse(JSON.stringify(data.mixTable))); 
    }
  }, [viewTab, data.mixTable]);

  // --- HANDLERS BÁSICOS ---
  const handleSavePlato = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlato) return;
    
    if (editingPlato.cost > editingPlato.price) {
      if (!window.confirm("⚠️ El coste es mayor que el precio de venta. ¿Guardar de todos modos?")) return;
    }

    const newPlatos = [...(db.platos || [])];
    const index = newPlatos.findIndex(p => p.id === editingPlato.id);
    if (index > -1) newPlatos[index] = editingPlato; else newPlatos.push(editingPlato);
    
    await onSave({ ...db, platos: newPlatos });
    setEditingPlato(null);
  };

  const handleDeletePlato = async (id: string) => {
    if (!window.confirm("¿Eliminar plato?")) return;
    await onSave({ ...db, platos: (db.platos || []).filter(p => p.id !== id) });
    setEditingPlato(null);
  };

  const handleSavePulse = async (pulseData: Record<string, number>) => {
    const today = new Date().toISOString().split('T')[0];
    const newVentas = [...(db.ventas_menu || [])];
    Object.entries(pulseData).forEach(([id, qty]) => {
      if (qty > 0) {
        const existing = newVentas.find(v => v.date === today && v.id === id);
        if (existing) existing.qty += qty; else newVentas.push({ date: today, id, qty });
      }
    });
    await onSave({ ...db, ventas_menu: newVentas });
    setIsPulseOpen(false);
  };

  // --- RENDERS DE COMPONENTES INTERNOS ---
  const renderQuad = (title: string, subtitle: string, color: string, list: any[]) => (
    <div className={`bg-white p-5 rounded-[2.5rem] border border-slate-100 shadow-sm h-80 flex flex-col group hover:shadow-md transition-shadow`}>
      <div className="flex justify-between items-start mb-3">
        <div><h3 className={`text-sm font-black text-${color}-600 uppercase leading-none`}>{title}</h3><p className="text-[9px] text-slate-400">{subtitle}</p></div>
        <span className={`bg-${color}-50 text-${color}-700 text-[10px] font-black px-2 py-1 rounded-lg`}>{list.length}</span>
      </div>
      <div className="space-y-1 overflow-y-auto custom-scrollbar flex-1 pr-1">
        {list.length > 0 ? list.map(p => (
          <div key={p.id} onClick={() => setEditingPlato(p)} className={`flex justify-between items-center p-2.5 bg-slate-50/50 rounded-xl cursor-pointer hover:bg-${color}-50 transition-colors`}>
            <div className="min-w-0 flex-1"><span className="text-xs font-bold text-slate-700 block truncate">{p.name}</span><span className="text-[9px] text-slate-400 font-black">{p.qty} uds ({Num.round2(p.mixPct)}%)</span></div>
            <div className="text-right ml-2"><span className={`block text-[10px] font-black text-${color}-600`}>Bº: {Num.fmt(p.margenUnitario)}</span><span className="text-[8px] text-slate-400 font-bold uppercase">FC: {Num.round2(p.fcUnitario)}%</span></div>
          </div>
        )) : <div className="flex flex-col items-center justify-center h-full text-slate-300 italic"><PieChart className="w-8 h-8 mb-2 opacity-20" /><span className="text-[9px]">Sin datos</span></div>}
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      
      {/* 🚀 HEADER CON KPIs */}
      <header className="bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-6 mb-6">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-slate-900 text-white rounded-3xl shadow-lg">
              <ChefHat className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-black text-slate-800 tracking-tighter">Menu Engineering</h2>
              <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-[0.2em]">Inteligencia Gastronómica PRO</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
            <select value={filterMode} onChange={(e) => setFilterMode(e.target.value as FilterMode)} className="bg-white text-[10px] font-black uppercase py-2.5 px-3 rounded-xl border-0 outline-none shadow-sm text-slate-700 cursor-pointer">
              <option value="day">Día</option><option value="month">Mes</option><option value="year">Año</option>
            </select>
            <input type={filterMode === 'year' ? 'number' : (filterMode === 'month' ? 'month' : 'date')} value={filterValue} onChange={(e) => setFilterValue(e.target.value)} className="bg-transparent font-black text-slate-800 text-sm outline-none text-center w-32 cursor-pointer" />
          </div>
        </div>

        {/* 📊 KPIs DE ALTA DIRECCIÓN (Seguros anti-NaN) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-6 border-t border-slate-100">
          <div className="md:col-span-2 bg-slate-50 p-4 rounded-2xl border border-slate-200 flex justify-between items-center">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Food Cost Real vs Teórico</p>
              <div className="flex items-end gap-3">
                <p className={cn("text-2xl font-black", data.foodCostReal > data.foodCostTeorico + 2 ? "text-rose-600" : "text-emerald-600")}>{Num.round2(data.foodCostReal)}%</p>
                <p className="text-sm font-bold text-slate-400 mb-1">/ {Num.round2(data.foodCostTeorico)}%</p>
              </div>
            </div>
            <Receipt className="w-8 h-8 text-slate-300" />
          </div>
          <div className="p-4 bg-white border border-slate-100 rounded-2xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ventas (Neto)</p>
            <p className="text-xl md:text-2xl font-black text-slate-800">{Num.fmt(data.totalTeoricoNeto)}</p>
          </div>
          <div className="p-4 bg-white border border-slate-100 rounded-2xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Coste Ideal</p>
            <p className="text-xl md:text-2xl font-black text-rose-500">{Num.fmt(data.totalCosteIdeal)}</p>
          </div>
          <div className="p-4 bg-white border border-slate-100 rounded-2xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Bº Bruto</p>
            <p className="text-xl md:text-2xl font-black text-emerald-500">{Num.fmt(data.totalBeneficioBruto)}</p>
          </div>
        </div>
      </header>

      {/* 🚀 TABS Y BUSCADOR */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-1">
        <div className="flex bg-slate-200 p-1.5 rounded-2xl w-full md:w-auto overflow-x-auto no-scrollbar">
          <button onClick={() => setViewTab('matrix')} className={cn("px-4 md:px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap", viewTab === 'matrix' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}><PieChart className="w-4 h-4 hidden md:block" /> Matriz BCG</button>
          <button onClick={() => setViewTab('table')} className={cn("px-4 md:px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap", viewTab === 'table' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}><TableProperties className="w-4 h-4 hidden md:block" /> Mix Ventas</button>
          <button onClick={() => setViewTab('families')} className={cn("px-4 md:px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap", viewTab === 'families' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}><LayoutGrid className="w-4 h-4 hidden md:block" /> Familias</button>
          <button onClick={() => setViewTab('omnes')} className={cn("px-4 md:px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap", viewTab === 'omnes' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}><Target className="w-4 h-4 hidden md:block" /> Omnes</button>
          <button onClick={() => setViewTab('simulator')} className={cn("px-4 md:px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap", viewTab === 'simulator' ? "bg-slate-900 text-amber-400 shadow-sm" : "text-slate-500 hover:text-slate-700")}><Calculator className="w-4 h-4 hidden md:block" /> Simulador</button>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-3 py-1 shadow-sm w-full">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input type="text" placeholder="Buscar plato..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} className="p-2 text-xs font-bold outline-none w-full bg-transparent" />
            {searchQ && <button onClick={() => setSearchQ('')}><X className="w-3 h-3 text-slate-400"/></button>}
          </div>
          <button onClick={() => setEditingPlato({ id: 'p-' + Date.now(), name: '', price: 0, cost: 0, category: 'General' })} className="bg-slate-900 text-white p-3 rounded-2xl shadow-sm hover:bg-indigo-600 transition"><Plus className="w-5 h-5" /></button>
          <button onClick={() => setIsPulseOpen(true)} className="bg-emerald-500 text-white p-3 rounded-2xl shadow-sm hover:bg-emerald-600 transition"><Zap className="w-5 h-5" /></button>
        </div>
      </div>

      {/* 🧠 AI COACH */}
      {data.tips.length > 0 && viewTab === 'matrix' && !searchQ && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-amber-50 p-5 md:p-6 rounded-[2.5rem] border border-amber-100 shadow-sm">
          <h3 className="text-[10px] font-black text-amber-600 uppercase mb-3 flex items-center gap-2 tracking-widest"><Bot className="w-4 h-4" /> AI Menu Coach</h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.tips.slice(0, 4).map((t, i) => (
              <li key={i} className="text-[11px] text-amber-900 flex gap-2 items-start bg-white/60 p-3 rounded-xl border border-amber-200/50 leading-relaxed">
                <span className="mt-0.5 shrink-0">👉</span><span dangerouslySetInnerHTML={{ __html: t }} />
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* 🚀 VISTAS INTERCAMBIABLES */}
      <AnimatePresence mode="wait">
        
        {viewTab === 'matrix' && (
          <motion.div key="matrix" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderQuad('⭐ Estrellas', 'Alta Venta / Alto Margen', 'emerald', data.stars)}
            {renderQuad('🐴 Caballos', 'Alta Venta / Bajo Margen', 'amber', data.horses)}
            {renderQuad('❓ Puzzles', 'Baja Venta / Alto Margen', 'indigo', data.puzzles)}
            {renderQuad('🐶 Perros', 'Baja Venta / Bajo Margen', 'rose', data.dogs)}
          </motion.div>
        )}
        
        {viewTab === 'table' && (
          <motion.div key="table" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Ajuste de Rentabilidad</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">FC% Objetivo:</span>
                  <input type="number" value={targetFC} onChange={e => setTargetFC(Number(e.target.value))} className="w-16 p-1 text-center font-black bg-white border border-slate-200 rounded-md outline-none" />
                </div>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="bg-white border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      <th className="p-4">Plato</th><th className="p-4 text-center">Uds</th><th className="p-4 text-center">Mix %</th>
                      <th className="p-4 text-right">PVP Neto</th><th className="p-4 text-right">Coste MP</th>
                      <th className="p-4 text-center">FC % Real</th><th className="p-4 text-right text-indigo-500 bg-indigo-50/30">Precio Sugerido (Bruto)</th>
                      <th className="p-4 text-right">Bº Ud.</th><th className="p-4 text-right text-emerald-600">Total Bº Bruto</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-bold text-slate-700 divide-y divide-slate-50">
                    {data.mixTable.map(p => (
                      <tr key={p.id} onClick={() => setEditingPlato(p)} className="hover:bg-slate-50 cursor-pointer transition-colors group">
                        <td className="p-4 text-slate-900 group-hover:text-indigo-600 transition-colors flex items-center gap-2">{p.name} {p.fcUnitario > targetFC && <AlertTriangle className="w-3 h-3 text-rose-500" />}</td>
                        <td className="p-4 text-center text-slate-900 font-black">{p.qty}</td>
                        <td className="p-4 text-center text-slate-400">{Num.round2(p.mixPct)}%</td>
                        <td className="p-4 text-right">{Num.fmt(p.precioNeto)}</td>
                        <td className="p-4 text-right text-rose-500">{Num.fmt(p.cost)}</td>
                        <td className="p-4 text-center"><span className={cn("px-2 py-1 rounded-md", p.fcUnitario > targetFC ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600")}>{Num.round2(p.fcUnitario)}%</span></td>
                        <td className="p-4 text-right text-indigo-600 bg-indigo-50/30 font-black">{Num.fmt(p.precioIdeal)}</td>
                        <td className="p-4 text-right">{Num.fmt(p.margenUnitario)}</td>
                        <td className="p-4 text-right text-emerald-600 font-black">{Num.fmt(p.totalBeneficioLinea)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {data.mixTable.length > 0 && (
                    <tfoot className="bg-slate-900 text-white font-black text-sm">
                      <tr>
                        <td className="p-4">TOTALES DEL PERIODO</td>
                        <td className="p-4 text-center">{data.mixTable.reduce((acc, p) => acc + p.qty, 0)}</td>
                        <td className="p-4 text-center">100%</td>
                        <td className="p-4" colSpan={4}></td>
                        <td className="p-4 text-right text-indigo-400">{Num.fmt(data.totalBeneficioBruto)}</td>
                        <td className="p-4 text-right text-emerald-400">{Num.fmt(data.totalTeoricoNeto)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {viewTab === 'families' && (
          <motion.div key="families" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(data.families).map(([cat, vals]) => (
              <div key={cat} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-between">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-black text-lg text-slate-800 uppercase tracking-tighter">{cat}</h3>
                  <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-[10px] font-black">{vals.qty} Uds</span>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-bold border-b border-slate-50 pb-2">
                    <span className="text-slate-400 uppercase tracking-widest text-[9px]">Ventas Netas</span>
                    <span className="text-slate-700">{Num.fmt(vals.ventasNetas)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold border-b border-slate-50 pb-2">
                    <span className="text-slate-400 uppercase tracking-widest text-[9px]">Coste M.P.</span>
                    <span className="text-rose-500">{Num.fmt(vals.coste)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-black pt-1">
                    <span className="text-indigo-500 uppercase tracking-widest text-[10px]">Beneficio Bruto</span>
                    <span className="text-emerald-500 text-lg">{Num.fmt(vals.beneficio)}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
                    <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${vals.ventasNetas > 0 ? (vals.beneficio/vals.ventasNetas)*100 : 0}%` }}></div>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {viewTab === 'omnes' && (
          <motion.div key="omnes" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
            <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 text-center">
              <Scale className="w-12 h-12 text-indigo-500 mx-auto mb-4" />
              <h3 className="text-2xl font-black text-slate-800">Principios de Omnes</h3>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2 max-w-lg mx-auto">
                Evaluación técnica de la psicología de precios de tu carta según la oferta y la demanda real.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Precio Medio Ofertado</p>
                <p className="text-3xl font-black text-slate-800">{Num.fmt(data.omnes.precioMedioOfertado)}</p>
                <p className="text-xs text-slate-500 mt-2">Media de todos los precios de tu carta.</p>
              </div>
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Precio Medio Demandado</p>
                <p className="text-3xl font-black text-indigo-600">{Num.fmt(data.omnes.precioMedioDemandado)}</p>
                <p className="text-xs text-slate-500 mt-2">Gasto medio bruto por plato vendido.</p>
              </div>
              <div className={cn("p-6 rounded-[2rem] border shadow-sm text-center", data.omnes.ratioOmnes >= 0.9 && data.omnes.ratioOmnes <= 1 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Ratio Omnes</p>
                <p className={cn("text-4xl font-black", data.omnes.ratioOmnes >= 0.9 && data.omnes.ratioOmnes <= 1 ? "text-emerald-600" : "text-amber-600")}>
                  {Num.round2(data.omnes.ratioOmnes)}
                </p>
                <p className="text-xs font-bold mt-2 opacity-80">
                  {data.omnes.ratioOmnes >= 0.9 && data.omnes.ratioOmnes <= 1 
                    ? "¡Excelente! Los clientes compran lo que ofreces."
                    : data.omnes.ratioOmnes < 0.9 
                      ? "Los clientes están eligiendo los platos más baratos."
                      : "Los clientes solo compran lo más caro de la carta."}
                </p>
              </div>
            </div>

            <div className="bg-slate-900 text-white p-8 rounded-[3rem] shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
               <div>
                 <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Dispersión de Precios</p>
                 <h4 className="text-xl font-black">Amplitud de la Gama: {Num.round2(data.omnes.amplitud)}</h4>
                 <p className="text-xs text-slate-400 mt-2">El plato más caro ({Num.fmt(data.omnes.rangoMax)}) dividido por el más barato ({Num.fmt(data.omnes.rangoMin)}).</p>
               </div>
               <div className="text-right">
                 {data.omnes.amplitud <= 3 ? (
                   <span className="bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-xl font-black text-sm border border-emerald-500/30">Rango Correcto (≤ 3)</span>
                 ) : (
                   <span className="bg-rose-500/20 text-rose-400 px-4 py-2 rounded-xl font-black text-sm border border-rose-500/30">Demasiada diferencia de precios</span>
                 )}
               </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={cn("p-6 rounded-[2rem] border shadow-sm", data.omnes.cumple1 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Principio 1</p>
                <p className="text-sm font-bold text-slate-800">La zona media de precios debe ser igual o superior a la suma de la zona alta y baja.</p>
                <p className="text-xs mt-2 font-black">
                  Baja: {data.omnes.grupos.bajo} | Media: {data.omnes.grupos.medio} | Alta: {data.omnes.grupos.alto}
                </p>
              </div>
              <div className={cn("p-6 rounded-[2rem] border shadow-sm", data.omnes.cumple2 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Principio 2</p>
                <p className="text-sm font-bold text-slate-800">La amplitud de gama (Diferencia entre el más caro y barato) no debe superar 2.5 (o 3 en cartas largas).</p>
              </div>
            </div>
          </motion.div>
        )}

        {viewTab === 'simulator' && (
          <motion.div key="sim" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="bg-slate-900 rounded-[3rem] p-6 md:p-8 shadow-2xl text-white">
            <div className="mb-6 flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-black text-amber-400 flex items-center gap-2"><Calculator className="w-6 h-6" /> Simulador de Carta</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Cambia precios aquí sin afectar a tu base de datos para ver proyecciones de beneficio.</p>
              </div>
              <button onClick={() => setSimulatedPlatos(JSON.parse(JSON.stringify(data.mixTable)))} className="bg-slate-800 text-slate-300 px-4 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-slate-700 transition">Resetear Valores</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-800 p-5 rounded-[2rem]">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Proyección Beneficio Bruto</p>
                <p className="text-3xl font-black text-emerald-400">
                  {Num.fmt(simulatedPlatos.reduce((acc, p) => acc + ((p.price / (1 + getIva(p.category))) - p.cost) * p.qty, 0))}
                </p>
              </div>
              <div className="bg-slate-800 p-5 rounded-[2rem]">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Proyección Food Cost %</p>
                <p className="text-3xl font-black text-amber-400">
                  {Num.round2(
                    (simulatedPlatos.reduce((acc, p) => acc + (p.cost * p.qty), 0) / 
                    (simulatedPlatos.reduce((acc, p) => acc + ((p.price / (1 + getIva(p.category))) * p.qty), 0) || 1)) * 100
                  )}%
                </p>
              </div>
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
              {simulatedPlatos.map((p, i) => {
                const iva = getIva(p.category);
                const pvpNeto = p.price / (1 + iva);
                const pFC = pvpNeto > 0 ? (p.cost / pvpNeto) * 100 : 0;
                
                return (
                  <div key={p.id} className="flex flex-col md:flex-row items-center justify-between bg-slate-800/50 p-4 rounded-2xl gap-4 border border-slate-700/50">
                    <div className="flex-1 min-w-0 w-full"><p className="font-bold text-sm truncate text-white">{p.name}</p><p className="text-[10px] text-slate-400">Vendidos: {p.qty}</p></div>
                    <div className="flex items-center gap-4 w-full md:w-auto">
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase block mb-1">Coste M.P.</label>
                        <input type="number" step="0.01" value={p.cost} onChange={(e) => { const n = [...simulatedPlatos]; n[i].cost = Number(e.target.value); setSimulatedPlatos(n); }} className="w-20 bg-slate-900 border border-slate-700 rounded-lg p-2 text-rose-400 font-bold text-center outline-none focus:border-indigo-500" />
                      </div>
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase block mb-1">PVP Bruto</label>
                        <input type="number" step="0.01" value={p.price} onChange={(e) => { const n = [...simulatedPlatos]; n[i].price = Number(e.target.value); setSimulatedPlatos(n); }} className="w-24 bg-slate-900 border border-slate-700 rounded-lg p-2 text-emerald-400 font-bold text-center outline-none focus:border-indigo-500" />
                      </div>
                      <div className="text-right min-w-[60px]">
                        <label className="text-[8px] text-slate-500 uppercase block mb-1">Nuevo FC%</label>
                        <span className={cn("font-black text-sm", pFC > targetFC ? "text-rose-500" : "text-emerald-500")}>
                          {Num.round2(pFC)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL EDICIÓN PLATO */}
      <AnimatePresence>
        {editingPlato && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingPlato(null)} className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-sm relative z-10">
              <h3 className="font-black text-slate-800 text-xl mb-6 flex items-center gap-2">
                <ChefHat className="w-6 h-6 text-indigo-500" /> {db.platos?.some(p => p.id === editingPlato.id) ? 'Editar' : 'Nuevo'} Plato
              </h3>
              <form onSubmit={handleSavePlato} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Nombre del Plato</label>
                  <input value={editingPlato.name} onChange={(e) => setEditingPlato({ ...editingPlato, name: e.target.value })} className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-bold border-0 outline-none focus:ring-2 ring-indigo-500/20 transition" placeholder="Ej. Solomillo" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">PVP Bruto (€)</label>
                    <input type="number" step="0.01" value={editingPlato.price} onChange={(e) => setEditingPlato({ ...editingPlato, price: Number(e.target.value) })} className="w-full p-4 bg-emerald-50 rounded-2xl text-sm font-black text-emerald-700 border-0 outline-none focus:ring-2 ring-emerald-500/30 transition" placeholder="0.00" required />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Coste M.P. (€)</label>
                    <input type="number" step="0.01" value={editingPlato.cost} onChange={(e) => setEditingPlato({ ...editingPlato, cost: Number(e.target.value) })} className="w-full p-4 bg-rose-50 rounded-2xl text-sm font-black text-rose-600 border-0 outline-none focus:ring-2 ring-rose-500/30 transition" placeholder="0.00" required />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Categoría (Afecta al IVA)</label>
                  <select value={editingPlato.category} onChange={(e) => setEditingPlato({ ...editingPlato, category: e.target.value as any })} className="w-full p-4 bg-slate-50 rounded-2xl text-xs font-bold border-0 outline-none focus:ring-2 ring-indigo-500/20 transition cursor-pointer">
                    {['Entrantes', 'Principal', 'Postre', 'Bebidas', 'Alcohol', 'General'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="pt-4 space-y-2">
                  <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-indigo-600 transition active:scale-95">GUARDAR CAMBIOS</button>
                  {db.platos?.some(p => p.id === editingPlato.id) && <button type="button" onClick={() => handleDeletePlato(editingPlato.id)} className="w-full text-rose-500 font-bold text-xs py-2 hover:text-rose-600 transition">Eliminar Plato</button>}
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {isPulseOpen && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsPulseOpen(false)} className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" />
            <PulseModal platos={db.platos || []} onSave={handleSavePulse} onClose={() => setIsPulseOpen(false)} />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- PULSE MODAL (Protegido anti-crash) ---
interface PulseModalProps { platos: Plato[]; onSave: (data: Record<string, number>) => void; onClose: () => void; }
const PulseModal: React.FC<PulseModalProps> = ({ platos, onSave, onClose }) => {
  const [pulseData, setPulseData] = useState<Record<string, number>>({});
  const populares = [...(platos||[])].sort((a, b) => (b.price || 0) - (a.price || 0)).slice(0, 15);
  const updateQty = (id: string, delta: number) => setPulseData(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) }));

  return (
    <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative z-10">
      <header className="mb-6">
        <h3 className="text-xl font-black text-indigo-900 flex items-center gap-2"><Zap className="w-6 h-6 text-emerald-500" /> Pulso Rápido</h3>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Ingresar ventas de hoy</p>
      </header>
      <div className="space-y-3 mb-8 max-h-96 overflow-y-auto custom-scrollbar px-1">
        {populares.length > 0 ? populares.map(p => (
          <div key={p.id} className="flex items-center justify-between p-3 rounded-2xl border border-slate-100 hover:bg-slate-50 transition">
            <div className="min-w-0 flex-1"><span className="font-bold text-slate-700 text-xs block truncate">{p.name}</span><span className="text-[9px] font-black text-indigo-500">{Num.fmt(p.price)}</span></div>
            <div className="flex items-center gap-3">
              <button onClick={() => updateQty(p.id, -1)} className="w-8 h-8 bg-slate-100 rounded-xl text-slate-500 font-black hover:bg-slate-200 transition active:scale-95">-</button>
              <span className="w-6 text-center font-black text-indigo-600 text-sm">{pulseData[p.id] || 0}</span>
              <button onClick={() => updateQty(p.id, 1)} className="w-8 h-8 bg-indigo-100 rounded-xl text-indigo-600 font-black hover:bg-indigo-200 transition active:scale-95">+</button>
            </div>
          </div>
        )) : <p className="text-center text-slate-400 text-sm py-4">No hay platos creados aún.</p>}
      </div>
      <div className="space-y-2">
        <button onClick={() => onSave(pulseData)} className="w-full bg-emerald-500 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-emerald-600 transition active:scale-95">GUARDAR VENTAS</button>
        <button onClick={onClose} className="w-full text-slate-400 text-xs font-bold py-3 hover:text-slate-600 transition">Cancelar</button>
      </div>
    </motion.div>
  );
};
