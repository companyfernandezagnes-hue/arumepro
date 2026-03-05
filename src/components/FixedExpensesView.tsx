import React, { useState, useMemo } from 'react';
import { 
  Building2, 
  Search, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  AlertTriangle,
  Calendar,
  DollarSign,
  Briefcase,
  Zap,
  Scale,
  Laptop,
  UtensilsCrossed,
  ChevronRight,
  Edit3,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, GastoFijo } from '../types';
import { cn } from '../lib/utils';

interface FixedExpensesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const FixedExpensesView = ({ data, onSave }: FixedExpensesViewProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGasto, setEditingGasto] = useState<GastoFijo | null>(null);

  const today = new Date();
  const currentMonthKey = `pagos_${today.getFullYear()}_${today.getMonth() + 1}`;

  // Ensure structures exist
  const gastosFijos = data.gastos_fijos || [];
  const controlPagos = data.control_pagos || {};
  const currentPagos = controlPagos[currentMonthKey] || [];

  const getMensual = (g: GastoFijo) => {
    const amount = parseFloat(g.amount as any) || 0;
    if (g.active === false) return 0;
    if (g.freq === 'anual') return amount / 12;
    if (g.freq === 'semestral') return amount / 6;
    if (g.freq === 'trimestral') return amount / 3;
    if (g.freq === 'bimensual') return amount / 2;
    if (g.freq === 'semanal') return amount * 4.33;
    return amount;
  };

  const stats = useMemo(() => {
    const activeGastos = gastosFijos.filter(g => g.active !== false);
    const totalMochila = activeGastos.reduce((acc, g) => acc + getMensual(g), 0);
    const pagadosIds = currentPagos;
    const pagados = activeGastos.filter(g => pagadosIds.includes(g.id));
    const totalPagado = pagados.reduce((acc, g) => acc + getMensual(g), 0);
    const totalPendiente = totalMochila - totalPagado;
    const porcentaje = totalMochila > 0 ? (totalPagado / totalMochila) * 100 : 0;

    return { totalMochila, totalPagado, totalPendiente, porcentaje };
  }, [gastosFijos, currentPagos]);

  const filteredGastos = useMemo(() => {
    return gastosFijos
      .filter(g => {
        if (g.active === false) return false;
        return (g.name || '').toLowerCase().includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => {
        const isPaidA = currentPagos.includes(a.id);
        const isPaidB = currentPagos.includes(b.id);
        if (isPaidA !== isPaidB) return isPaidA ? 1 : -1;
        return (a.dia_pago || 1) - (b.dia_pago || 1);
      });
  }, [gastosFijos, searchTerm, currentPagos]);

  const handleTogglePago = async (g: GastoFijo) => {
    const newData = { ...data };
    if (!newData.control_pagos) newData.control_pagos = {};
    if (!newData.control_pagos[currentMonthKey]) newData.control_pagos[currentMonthKey] = [];

    const idx = newData.control_pagos[currentMonthKey].indexOf(g.id);
    const mensual = getMensual(g);

    if (idx === -1) {
      newData.control_pagos[currentMonthKey].push(g.id);
      if (confirm(`¿Registrar salida de dinero en Banco por ${mensual.toFixed(2)}€?`)) {
        if (!newData.banco) newData.banco = [];
        newData.banco.unshift({
          id: 'gf-' + Date.now(),
          date: new Date().toISOString().split('T')[0],
          desc: `Pago: ${g.name}`,
          amount: -Math.abs(mensual),
          status: 'matched'
        } as any);
      }
    } else {
      newData.control_pagos[currentMonthKey].splice(idx, 1);
    }

    await onSave(newData);
  };

  const handleSaveGasto = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const nuevo: GastoFijo = {
      id: editingGasto?.id || Date.now().toString(),
      name: formData.get('name') as string,
      amount: parseFloat(formData.get('amount') as string) || 0,
      freq: formData.get('freq') as any,
      cat: formData.get('cat') as string,
      dia_pago: parseInt(formData.get('dia_pago') as string) || 1,
      active: true,
      notes: formData.get('notes') as string
    };

    const newData = { ...data };
    if (!newData.gastos_fijos) newData.gastos_fijos = [];

    const idx = newData.gastos_fijos.findIndex(x => x.id === nuevo.id);
    if (idx >= 0) newData.gastos_fijos[idx] = nuevo;
    else newData.gastos_fijos.push(nuevo);

    await onSave(newData);
    setIsModalOpen(false);
    setEditingGasto(null);
  };

  const handleDeleteGasto = async (id: string) => {
    if (!confirm("¿Seguro que quieres eliminar este gasto fijo?")) return;
    const newData = { ...data };
    const idx = newData.gastos_fijos.findIndex(x => x.id === id);
    if (idx >= 0) {
      newData.gastos_fijos[idx].active = false;
      await onSave(newData);
    }
    setIsModalOpen(false);
    setEditingGasto(null);
  };

  const getCategoryTheme = (cat: string) => {
    switch (cat) {
      case 'personal': return { icon: UtensilsCrossed, color: 'bg-blue-50 text-blue-600 border-blue-100' };
      case 'local': return { icon: Building2, color: 'bg-orange-50 text-orange-500 border-orange-100' };
      case 'suministros': return { icon: Zap, color: 'bg-yellow-50 text-yellow-600 border-yellow-100' };
      case 'impuestos': return { icon: Scale, color: 'bg-red-50 text-red-500 border-red-100' };
      case 'software': return { icon: Laptop, color: 'bg-purple-50 text-purple-500 border-purple-100' };
      default: return { icon: Briefcase, color: 'bg-slate-100 text-slate-500 border-slate-200' };
    }
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Estructura de Costes</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            {today.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase()}
          </p>
        </div>
        <div className="flex gap-8 items-center">
          <div className="text-right">
            <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest">Pendiente</p>
            <p className="text-2xl font-black text-rose-600">{stats.totalPendiente.toLocaleString('es-ES', { maximumFractionDigits: 0 })}€</p>
          </div>
          <div className="w-14 h-14 rounded-full border-4 border-slate-100 flex items-center justify-center relative overflow-hidden shadow-inner">
            <div 
              className="absolute bottom-0 w-full bg-indigo-500 transition-all duration-1000" 
              style={{ height: `${stats.porcentaje}%` }}
            ></div>
            <span className="text-[10px] font-black z-10 relative text-slate-800 bg-white/80 px-1 rounded">
              {Math.round(stats.porcentaje)}%
            </span>
          </div>
        </div>
      </header>

      {/* Search & Add */}
      <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-100 shadow-sm sticky top-2 z-10">
        <div className="flex items-center gap-2 flex-1 px-3">
          <Search className="w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="Buscar nómina, alquiler..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-transparent outline-none text-xs font-bold text-slate-600 w-full h-8"
          />
        </div>
        <button 
          onClick={() => { setEditingGasto(null); setIsModalOpen(true); }}
          className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-[10px] font-black hover:bg-indigo-600 transition flex-shrink-0 shadow-lg"
        >
          + NUEVO GASTO
        </button>
      </div>

      {/* List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredGastos.map(g => {
          const isPaid = currentPagos.includes(g.id);
          const mensual = getMensual(g);
          const theme = getCategoryTheme(g.cat);
          const diaHoy = today.getDate();
          const esUrgente = !isPaid && (g.dia_pago - diaHoy <= 3) && (g.dia_pago - diaHoy >= -5);

          return (
            <motion.div 
              layout
              key={g.id}
              className={cn(
                "bg-white p-5 rounded-[2.5rem] border transition-all relative group hover:shadow-xl",
                isPaid ? 'border-emerald-200 bg-emerald-50/10' : esUrgente ? 'border-rose-300 shadow-rose-100 shadow-lg' : 'border-slate-100 shadow-sm'
              )}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3 overflow-hidden flex-1">
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-sm border", theme.color)}>
                    <theme.icon className="w-6 h-6" />
                  </div>
                  <div className="overflow-hidden">
                    <h4 className="font-black text-slate-800 text-sm truncate leading-tight">{g.name}</h4>
                    <div className="flex gap-2 text-[9px] font-bold uppercase tracking-wide text-slate-400 mt-1">
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">{g.freq}</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" /> Día {g.dia_pago}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  <button 
                    onClick={() => { setEditingGasto(g); setIsModalOpen(true); }}
                    className="w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center transition"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>

                  <button 
                    onClick={() => handleTogglePago(g)}
                    className="transition-all active:scale-90"
                  >
                    {isPaid ? (
                      <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-200">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 bg-white border-2 border-slate-200 rounded-full flex items-center justify-center hover:border-indigo-400 transition-colors">
                        <div className="w-2 h-2 rounded-full bg-slate-100"></div>
                      </div>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-end mt-2 pt-4 border-t border-slate-50">
                <div>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Cuota Real</p>
                  <p className="text-sm font-black text-slate-800">{parseFloat(g.amount as any).toLocaleString()}€</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400">Mensualizado</p>
                  <p className="text-lg font-black text-indigo-600">{mensual.toLocaleString(undefined, { maximumFractionDigits: 0 })}€</p>
                </div>
              </div>

              {esUrgente && (
                <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[8px] font-black px-2 py-1 rounded-lg shadow-lg animate-bounce">
                  URGENTE
                </div>
              )}
            </motion.div>
          );
        })}
        {filteredGastos.length === 0 && (
          <div className="col-span-full text-center py-20 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200">
            <AlertTriangle className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-xs font-black text-slate-400 uppercase">No hay gastos activos</p>
          </div>
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[9999] flex justify-center items-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-[3rem] p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <button 
                onClick={() => setIsModalOpen(false)}
                className="absolute top-6 right-6 text-slate-300 hover:text-slate-600 transition"
              >
                <X className="w-6 h-6" />
              </button>
              
              <h3 className="text-2xl font-black text-slate-800 mb-8">
                {editingGasto ? 'Editar Gasto' : 'Nuevo Gasto Fijo'}
              </h3>
              
              <form onSubmit={handleSaveGasto} className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Nombre / Concepto</label>
                    <input 
                      name="name"
                      type="text" 
                      defaultValue={editingGasto?.name || ''} 
                      placeholder="Ej: Nómina Juan, Alquiler..." 
                      required
                      className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Importe (€)</label>
                      <input 
                        name="amount"
                        type="number" 
                        step="0.01"
                        defaultValue={editingGasto?.amount || ''} 
                        placeholder="0.00" 
                        required
                        className="w-full p-4 bg-slate-50 rounded-2xl font-black text-lg border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Día Pago</label>
                      <input 
                        name="dia_pago"
                        type="number" 
                        min="1"
                        max="31"
                        defaultValue={editingGasto?.dia_pago || 1} 
                        required
                        className="w-full p-4 bg-slate-50 rounded-2xl font-black text-lg border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Frecuencia</label>
                    <select 
                      name="freq"
                      defaultValue={editingGasto?.freq || 'mensual'}
                      className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20 appearance-none"
                    >
                      <option value="mensual">Mensual (12 pagos/año)</option>
                      <option value="trimestral">Trimestral (4 pagos/año)</option>
                      <option value="anual">Anual (1 pago/año)</option>
                      <option value="semestral">Semestral (2 pagos/año)</option>
                      <option value="bimensual">Bimensual (6 pagos/año)</option>
                      <option value="semanal">Semanal (52 pagos/año)</option>
                    </select>
                  </div>
                  
                  <div className="p-5 bg-indigo-50 rounded-[2rem] border border-indigo-100">
                    <label className="text-[10px] font-black text-indigo-500 uppercase ml-2 mb-3 block tracking-widest">Categoría Contable</label>
                    <select 
                      name="cat"
                      defaultValue={editingGasto?.cat || 'varios'}
                      className="w-full p-4 bg-white rounded-2xl font-bold text-sm border border-indigo-100 outline-none shadow-sm appearance-none"
                    >
                      <option value="varios">📦 Varios / Otros</option>
                      <option value="personal">👨‍🍳 Personal (Nóminas)</option>
                      <option value="local">🏢 Local (Alquiler)</option>
                      <option value="suministros">💡 Suministros (Luz/Agua)</option>
                      <option value="impuestos">⚖️ Impuestos / Tasas</option>
                      <option value="software">💻 Software / Suscripciones</option>
                    </select>
                    <p className="text-[9px] text-indigo-400 mt-3 ml-2 font-bold italic">
                      ℹ️ Selecciona 'Personal' para que cuente como coste de equipo.
                    </p>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Notas</label>
                    <textarea 
                      name="notes"
                      defaultValue={editingGasto?.notes || ''}
                      placeholder="Detalles adicionales..."
                      className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border border-slate-100 outline-none h-24 resize-none"
                    />
                  </div>
                </div>

                <div className="pt-4 space-y-3">
                  <button 
                    type="submit"
                    className="w-full bg-slate-900 text-white py-5 rounded-3xl font-black shadow-xl hover:bg-indigo-600 transition active:scale-95"
                  >
                    GUARDAR CAMBIOS
                  </button>
                  
                  {editingGasto && (
                    <button 
                      type="button"
                      onClick={() => handleDeleteGasto(editingGasto.id)}
                      className="w-full text-rose-400 text-[10px] font-black uppercase py-2 hover:text-rose-600 transition"
                    >
                      Eliminar este gasto permanentemente
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
