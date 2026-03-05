import React, { useState, useEffect, useRef } from 'react';
import { 
  ChefHat, 
  TrendingUp, 
  BarChart3, 
  PieChart, 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Download, 
  Zap, 
  Plus, 
  Clipboard, 
  Upload,
  Bot,
  Trash2,
  X,
  Search,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { AppData, Plato, VentaMenu } from '../types';
import { Num } from '../services/engine';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';

interface MenuViewProps {
  db: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

type FilterMode = 'day' | 'month' | 'year';

export const MenuView: React.FC<MenuViewProps> = ({ db, onSave }) => {
  const [filterMode, setFilterMode] = useState<FilterMode>('month');
  const [filterValue, setFilterValue] = useState(new Date().toISOString().slice(0, 7));
  const [isPulseOpen, setIsPulseOpen] = useState(false);
  const [editingPlato, setEditingPlato] = useState<Plato | null>(null);
  const [isPlatoModalOpen, setIsPlatoModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- AUTO-MIGRACIÓN ---
  useEffect(() => {
    let changed = false;
    const newVentas = [...(db.ventas_menu || [])];
    const newPlatos = db.platos?.map(p => {
      if (p.sold && p.sold > 0) {
        const hasHistory = newVentas.some(v => v.id === p.id);
        if (!hasHistory) {
          newVentas.push({
            date: new Date().toISOString().split('T')[0],
            id: p.id,
            qty: p.sold
          });
          changed = true;
        }
        return { ...p, sold: 0 };
      }
      return p;
    }) || [];

    if (changed) {
      onSave({ ...db, platos: newPlatos, ventas_menu: newVentas });
    }
  }, []);

  // --- CEREBRO MATEMÁTICO ---
  const calcularMatriz = () => {
    const result = { 
      stars: [] as any[], 
      horses: [] as any[], 
      puzzles: [] as any[], 
      dogs: [] as any[], 
      tips: [] as string[], 
      totalTeorico: 0, 
      totalCajaReal: 0 
    };
    
    if (!db.platos || db.platos.length === 0) return result;

    const checkDate = (dateStr: string) => {
      if (!dateStr) return false;
      if (filterMode === 'day') return dateStr === filterValue;
      if (filterMode === 'month') return dateStr.startsWith(filterValue);
      if (filterMode === 'year') return dateStr.startsWith(filterValue);
      return false;
    };

    const ventasFiltradas = (db.ventas_menu || []).filter(v => checkDate(v.date));
    result.totalCajaReal = (db.cierres || [])
      .filter(c => checkDate(c.date))
      .reduce((acc, c) => acc + Num.parse(c.totalVenta), 0);

    const ventasPorPlato: Record<string, number> = {};
    ventasFiltradas.forEach(v => {
      ventasPorPlato[v.id] = (ventasPorPlato[v.id] || 0) + Num.parse(v.qty);
    });

    let totalQty = 0;
    let sumMargenPonderado = 0;
    
    const analisis = db.platos.map(p => {
      const precio = Num.parse(p.price);
      const coste = Num.parse(p.cost) || (precio * 0.30); 
      const margenUnitario = precio - coste;
      const qty = ventasPorPlato[p.id] || 0;
      
      totalQty += qty;
      sumMargenPonderado += (margenUnitario * qty);
      result.totalTeorico += (precio * qty);

      return { ...p, qty, margenUnitario };
    });

    if (totalQty > 0) {
      const mediaPop = (100 / db.platos.length) * 0.7; 
      const mediaMargen = sumMargenPonderado / totalQty; 

      analisis.forEach(p => {
        const mix = (p.qty / totalQty) * 100;
        const esPop = mix >= mediaPop;
        const esRent = p.margenUnitario >= mediaMargen;

        if (esPop && esRent) result.stars.push(p);
        else if (esPop && !esRent) result.horses.push(p);
        else if (!esPop && esRent) result.puzzles.push(p);
        else result.dogs.push(p);

        if (esPop && !esRent && p.qty > 5) result.tips.push(`🐴 <b>${p.name}</b>: Vende mucho, poco margen. Sube precio.`);
        if (!esPop && !esRent && p.qty === 0) result.tips.push(`🧟 <b>${p.name}</b>: 0 ventas. ¿Eliminar?`);
        if (!esPop && esRent && p.qty > 0) result.tips.push(`💎 <b>${p.name}</b>: Muy rentable. ¡Poténcialo!`);
      });
    }
    return result;
  };

  const data = calcularMatriz();
  const diff = data.totalTeorico - data.totalCajaReal;
  
  let auditColor = 'slate', auditMsg = "Sin cierres de caja";
  if (data.totalCajaReal > 0) {
    const pct = (Math.abs(diff) / data.totalCajaReal) * 100;
    if (pct < 1) { auditColor = 'emerald'; auditMsg = "✅ Cuadre Perfecto"; }
    else if (pct < 5) { auditColor = 'amber'; auditMsg = `⚠️ Desviación: ${Num.fmt(diff)}`; }
    else { auditColor = 'rose'; auditMsg = `🚨 DESCUADRE: ${Num.fmt(diff)}`; }
  }

  // --- HANDLERS ---
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(new Uint8Array(evt.target?.result as ArrayBuffer), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
        processSalesData(rows);
      } catch (err) {
        alert("Error al leer el archivo Excel.");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const rows = text.split('\n').map(l => l.split('\t'));
        processSalesData(rows);
      }
    } catch (e) {
      alert("Permite el acceso al portapapeles.");
    }
  };

  const processSalesData = async (rows: any[][]) => {
    const dateInput = prompt(`📅 ¿Fecha de estas ventas? (YYYY-MM-DD):`, new Date().toISOString().split('T')[0]);
    if (!dateInput) return;

    let colName = -1, colQty = -1, colPrice = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i].map(c => String(c).toLowerCase());
      if (colName === -1) colName = r.findIndex(c => c.match(/articulo|nombre|producto|item|descrip/));
      if (colQty === -1) colQty = r.findIndex(c => c.match(/cantidad|unidades|vendidos|qty|uds/));
      if (colPrice === -1) colPrice = r.findIndex(c => c.match(/precio|pvp|price|importe unit/));
    }

    if (colName === -1 || colQty === -1) return alert("⚠️ No encontré columnas 'Artículo' y 'Cantidad'");

    const newPlatos = [...(db.platos || [])];
    const newVentas = [...(db.ventas_menu || [])];
    let count = 0;
    const startRow = rows.findIndex(r => r[colName] && String(r[colName]).toLowerCase().match(/articulo|nombre|producto/)) + 1 || 1;

    rows.slice(startRow).forEach(row => {
      const name = String(row[colName] || '').trim();
      const sold = Num.parse(row[colQty]);
      const priceFound = colPrice > -1 ? Num.parse(row[colPrice]) : 0;

      if (name && sold > 0) {
        let plato = newPlatos.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim());
        if (!plato) {
          plato = { id: 'p-' + Date.now() + Math.random(), name: name, category: 'General', price: priceFound, cost: 0 };
          newPlatos.push(plato);
        } else if (priceFound > 0 && plato.price !== priceFound) {
          plato.price = priceFound;
        }

        const existing = newVentas.find(v => v.date === dateInput && v.id === plato!.id);
        if (existing) existing.qty += sold;
        else newVentas.push({ date: dateInput, id: plato.id, qty: sold });
        count++;
      }
    });

    await onSave({ ...db, platos: newPlatos, ventas_menu: newVentas });
    alert(`✅ Importadas ${count} líneas de venta.`);
  };

  const handleSavePlato = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlato) return;

    const newPlatos = [...(db.platos || [])];
    const index = newPlatos.findIndex(p => p.id === editingPlato.id);
    
    if (index > -1) {
      newPlatos[index] = editingPlato;
    } else {
      newPlatos.push(editingPlato);
    }

    await onSave({ ...db, platos: newPlatos });
    setIsPlatoModalOpen(false);
    setEditingPlato(null);
  };

  const handleDeletePlato = async (id: string) => {
    if (!confirm("¿Estás seguro de eliminar este plato?")) return;
    const newPlatos = db.platos.filter(p => p.id !== id);
    await onSave({ ...db, platos: newPlatos });
    setIsPlatoModalOpen(false);
    setEditingPlato(null);
  };

  const handleSavePulse = async (pulseData: Record<string, number>) => {
    const today = new Date().toISOString().split('T')[0];
    const newVentas = [...(db.ventas_menu || [])];
    
    Object.entries(pulseData).forEach(([id, qty]) => {
      if (qty > 0) {
        const existing = newVentas.find(v => v.date === today && v.id === id);
        if (existing) existing.qty += qty;
        else newVentas.push({ date: today, id, qty });
      }
    });

    await onSave({ ...db, ventas_menu: newVentas });
    setIsPulseOpen(false);
  };

  const renderQuad = (title: string, subtitle: string, color: string, list: any[]) => (
    <div className={`bg-white p-5 rounded-[2.5rem] border-2 border-${color}-100 shadow-sm h-80 flex flex-col group hover:shadow-md transition`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className={`text-sm font-black text-${color}-600 uppercase leading-none`}>{title}</h3>
          <p className="text-[9px] text-slate-400">{subtitle}</p>
        </div>
        <span className={`bg-${color}-50 text-${color}-700 text-[10px] font-black px-2 py-1 rounded-lg`}>{list.length}</span>
      </div>
      <div className="space-y-1 overflow-y-auto custom-scrollbar flex-1 pr-1">
        {list.length > 0 ? list.map(p => (
          <div 
            key={p.id}
            onClick={() => { setEditingPlato(p); setIsPlatoModalOpen(true); }}
            className={`flex justify-between items-center p-2.5 bg-${color}-50/30 rounded-xl cursor-pointer hover:bg-${color}-50 border border-transparent hover:border-${color}-100 transition-all`}
          >
            <div className="min-w-0 flex-1">
              <span className="text-xs font-bold text-slate-700 block truncate">{p.name}</span>
              <span className="text-[9px] text-slate-400 font-black">{p.qty} uds</span>
            </div>
            <span className={`text-[10px] font-black text-${color}-600 ml-2`}>+{Num.fmt(p.margenUnitario)}</span>
          </div>
        )) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-300 italic py-8">
            <PieChart className="w-8 h-8 mb-2 opacity-20" />
            <span className="text-[9px]">Sin datos</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header */}
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-slate-800">Menu Intelligence</h2>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">v8.0 - Analítica Pro</p>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-200">
            <select 
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterMode)}
              className="bg-white text-[10px] font-black uppercase py-2 px-3 rounded-xl border-0 outline-none shadow-sm cursor-pointer"
            >
              <option value="day">Día</option>
              <option value="month">Mes</option>
              <option value="year">Año</option>
            </select>
            <input 
              type={filterMode === 'year' ? 'number' : (filterMode === 'month' ? 'month' : 'date')}
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              className="bg-transparent font-black text-slate-700 text-xs outline-none text-center w-28"
            />
          </div>
        </div>

        <div className={`bg-${auditColor}-50 border border-${auditColor}-200 p-4 rounded-2xl flex items-center justify-between transition-colors`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-${auditColor}-100 text-${auditColor}-600 flex items-center justify-center`}>
              <Search className="w-5 h-5" />
            </div>
            <div>
              <p className={`text-[10px] font-bold text-${auditColor}-700 uppercase tracking-tighter`}>🔎 Auditoría de Ventas</p>
              <p className={`text-xs font-black text-${auditColor}-900`}>{auditMsg}</p>
            </div>
          </div>
          <div className="text-right flex gap-4">
            <div>
              <p className="text-[8px] uppercase font-bold text-slate-400">Teórico</p>
              <p className={`text-sm font-black text-${auditColor}-800`}>{Num.fmt(data.totalTeorico)}</p>
            </div>
            <div>
              <p className="text-[8px] uppercase font-bold text-slate-400">Caja Real</p>
              <p className={`text-sm font-black text-${auditColor}-800`}>{Num.fmt(data.totalCajaReal)}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 overflow-x-auto no-scrollbar pb-2 px-1">
        <label className="bg-slate-900 text-white px-5 py-3 rounded-2xl text-[10px] font-black cursor-pointer shadow-lg flex items-center gap-2 whitespace-nowrap hover:scale-105 transition-transform">
          <Upload className="w-4 h-4" />
          SUBIR TPV
          <input type="file" ref={fileInputRef} onChange={handleImportFile} className="hidden" accept=".csv, .xlsx, .xls" />
        </label>
        <button 
          onClick={handlePaste}
          className="bg-indigo-600 text-white px-5 py-3 rounded-2xl text-[10px] font-black shadow-lg flex items-center gap-2 whitespace-nowrap hover:scale-105 transition-transform"
        >
          <Clipboard className="w-4 h-4" />
          PEGAR TABLA
        </button>
        <button 
          onClick={() => setIsPulseOpen(true)}
          className="bg-emerald-500 text-white px-5 py-3 rounded-2xl text-[10px] font-black shadow-lg flex items-center gap-2 hover:scale-105 transition-transform"
        >
          <Zap className="w-4 h-4" />
          PULSO
        </button>
        <button 
          onClick={() => { setEditingPlato({ id: 'p-' + Date.now(), name: '', price: 0, cost: 0, category: 'General' }); setIsPlatoModalOpen(true); }}
          className="bg-white border border-slate-200 text-slate-600 px-5 py-3 rounded-2xl text-[10px] font-black shadow-sm flex items-center gap-2 hover:bg-slate-50 transition"
        >
          <Plus className="w-4 h-4" />
          PLATO
        </button>
      </div>

      {/* AI Tips */}
      {data.tips.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 p-5 rounded-[2rem] border border-amber-100 shadow-sm"
        >
          <h3 className="text-[10px] font-black text-amber-600 uppercase mb-3 flex items-center gap-2">
            <Bot className="w-4 h-4" />
            AI Menu Coach
          </h3>
          <ul className="space-y-2">
            {data.tips.slice(0, 3).map((t, i) => (
              <li key={i} className="text-[10px] text-amber-800 flex gap-2 items-start">
                <span className="mt-0.5">👉</span>
                <span dangerouslySetInnerHTML={{ __html: t }} />
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Matrix Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderQuad('⭐ Estrellas', 'Alta Venta / Alto Margen', 'emerald', data.stars)}
        {renderQuad('🐴 Caballos', 'Alta Venta / Bajo Margen', 'amber', data.horses)}
        {renderQuad('❓ Puzzles', 'Baja Venta / Alto Margen', 'indigo', data.puzzles)}
        {renderQuad('🐶 Perros', 'Baja Venta / Bajo Margen', 'rose', data.dogs)}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {isPlatoModalOpen && editingPlato && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPlatoModalOpen(false)}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-sm relative z-10"
            >
              <h3 className="font-black text-slate-800 text-lg mb-6 flex items-center gap-2">
                <ChefHat className="w-6 h-6 text-indigo-500" />
                {db.platos.some(p => p.id === editingPlato.id) ? 'Editar' : 'Nuevo'} Plato
              </h3>
              <form onSubmit={handleSavePlato} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Nombre del Plato</label>
                  <input 
                    value={editingPlato.name}
                    onChange={(e) => setEditingPlato({ ...editingPlato, name: e.target.value })}
                    className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-bold border-0 outline-none focus:ring-2 ring-indigo-500/20 transition"
                    placeholder="Ej. Solomillo al Pedro Ximénez"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">PVP (€)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={editingPlato.price}
                      onChange={(e) => setEditingPlato({ ...editingPlato, price: Number(e.target.value) })}
                      className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-black text-indigo-600 border-0 outline-none focus:ring-2 ring-indigo-500/20 transition"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Coste (€)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={editingPlato.cost}
                      onChange={(e) => setEditingPlato({ ...editingPlato, cost: Number(e.target.value) })}
                      className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-black text-rose-500 border-0 outline-none focus:ring-2 ring-indigo-500/20 transition"
                      placeholder="0.00"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Categoría</label>
                  <select 
                    value={editingPlato.category}
                    onChange={(e) => setEditingPlato({ ...editingPlato, category: e.target.value })}
                    className="w-full p-4 bg-slate-50 rounded-2xl text-xs font-bold border-0 outline-none focus:ring-2 ring-indigo-500/20 transition"
                  >
                    {['Entrantes', 'Principal', 'Postre', 'Bebidas', 'General'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="pt-4 space-y-2">
                  <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-slate-800 transition">
                    GUARDAR CAMBIOS
                  </button>
                  {db.platos.some(p => p.id === editingPlato.id) && (
                    <button 
                      type="button"
                      onClick={() => handleDeletePlato(editingPlato.id)}
                      className="w-full text-rose-500 font-bold text-xs py-2 hover:text-rose-600 transition"
                    >
                      Eliminar Plato
                    </button>
                  )}
                  <button 
                    type="button"
                    onClick={() => setIsPlatoModalOpen(false)}
                    className="w-full text-xs font-bold text-slate-400 py-2"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {isPulseOpen && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPulseOpen(false)}
              className="absolute inset-0 bg-indigo-900/90 backdrop-blur-md"
            />
            <PulseModal 
              platos={db.platos} 
              onSave={handleSavePulse} 
              onClose={() => setIsPulseOpen(false)} 
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface PulseModalProps {
  platos: Plato[];
  onSave: (data: Record<string, number>) => void;
  onClose: () => void;
}

const PulseModal: React.FC<PulseModalProps> = ({ platos, onSave, onClose }) => {
  const [pulseData, setPulseData] = useState<Record<string, number>>({});
  
  const populares = [...platos]
    .sort((a, b) => (b.price || 0) - (a.price || 0)) // Simplificación: ordenar por precio si no hay ventas previas
    .slice(0, 15);

  const updateQty = (id: string, delta: number) => {
    setPulseData(prev => ({
      ...prev,
      [id]: Math.max(0, (prev[id] || 0) + delta)
    }));
  };

  return (
    <motion.div 
      initial={{ scale: 0.9, opacity: 0, y: 20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.9, opacity: 0, y: 20 }}
      className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative z-10"
    >
      <header className="mb-6">
        <h3 className="text-xl font-black text-indigo-900 flex items-center gap-2">
          <Zap className="w-6 h-6 text-emerald-500" />
          Pulso Rápido
        </h3>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ventas de hoy</p>
      </header>
      
      <div className="space-y-3 mb-8 max-h-96 overflow-y-auto custom-scrollbar px-1">
        {populares.map(p => (
          <div key={p.id} className="flex items-center justify-between p-3 rounded-2xl border border-slate-100 hover:bg-slate-50 transition">
            <div className="min-w-0 flex-1">
              <span className="font-bold text-slate-700 text-xs block truncate">{p.name}</span>
              <span className="text-[9px] font-black text-indigo-500">{Num.fmt(p.price)}</span>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => updateQty(p.id, -1)}
                className="w-8 h-8 bg-slate-100 rounded-xl text-slate-500 font-black hover:bg-slate-200 transition"
              >
                -
              </button>
              <span className="w-6 text-center font-black text-indigo-600 text-sm">
                {pulseData[p.id] || 0}
              </span>
              <button 
                onClick={() => updateQty(p.id, 1)}
                className="w-8 h-8 bg-indigo-100 rounded-xl text-indigo-600 font-black hover:bg-indigo-200 transition"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <button 
          onClick={() => onSave(pulseData)}
          className="w-full bg-emerald-500 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-emerald-600 transition"
        >
          GUARDAR VENTAS
        </button>
        <button 
          onClick={onClose}
          className="w-full text-slate-400 text-xs font-bold py-2"
        >
          Cancelar
        </button>
      </div>
    </motion.div>
  );
};
