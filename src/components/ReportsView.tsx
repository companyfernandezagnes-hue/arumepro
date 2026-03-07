import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  TrendingUp, TrendingDown, ChevronLeft, ChevronRight, 
  Building2, Hotel, ShoppingBag, Users, Layers, 
  Utensils, Coffee, Briefcase, Calculator, PieChart
} from 'lucide-react';
import { AppData } from '../types';
import { ArumeEngine, Num } from '../services/engine';
import { cn } from '../lib/utils';

export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'DLV', name: 'Catering Hoteles', icon: Hotel, color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'CORP', name: 'Socios / Corp', icon: Users, color: 'text-slate-600', bg: 'bg-slate-100' }
];

export const ReportsView = ({ data }: { data: AppData }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL');

  const handleMonthChange = (offset: number) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(currentDate.getMonth() + offset);
    setCurrentDate(newDate);
  };

  const monthName = currentDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();
  const month = currentDate.getMonth();
  const year = currentDate.getFullYear();

  // 🚀 MAGIA: El motor ArumeEngine calcula todo de golpe
  const stats = useMemo(() => ArumeEngine.getProfit(data, month + 1, year), [data, month, year]);

  // Filtramos la vista superior dependiendo de la pestaña elegida
  const displayStats = useMemo(() => {
    if (selectedUnit === 'ALL') {
      return {
        income: stats.ingresos.total,
        expenses: stats.gastos.total,
        profit: stats.neto,
        margin: stats.ingresos.total > 0 ? (stats.neto / stats.ingresos.total) * 100 : 0
      };
    } else {
      const unit = stats.unitBreakdown[selectedUnit];
      return {
        income: unit.income,
        expenses: unit.expenses,
        profit: unit.profit,
        margin: unit.income > 0 ? (unit.profit / unit.income) * 100 : 0
      };
    }
  }, [stats, selectedUnit]);

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header y Navegación de Meses */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tighter">Dashboard P&L</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1">
            Resultados Multi-Local
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
          <button onClick={() => handleMonthChange(-1)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl text-slate-600 shadow-sm hover:bg-indigo-50 transition">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="w-32 text-center">
            <span className="text-xs font-black text-slate-700 uppercase tracking-widest">{monthName}</span>
          </div>
          <button onClick={() => handleMonthChange(1)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl text-slate-600 shadow-sm hover:bg-indigo-50 transition">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Selector Multi-Bloque */}
      <div className="flex flex-wrap gap-2 px-1">
        <button
          onClick={() => setSelectedUnit('ALL')}
          className={cn(
            "px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5",
            selectedUnit === 'ALL' ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
          )}
        >
          <Layers className="w-3 h-3" /> Global Arume
        </button>
        {BUSINESS_UNITS.map(unit => (
          <button
            key={unit.id}
            onClick={() => setSelectedUnit(unit.id)}
            className={cn(
              "px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5",
              selectedUnit === unit.id 
                ? `${unit.color.replace('text-', 'bg-')} text-white border-transparent shadow-md` 
                : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
            )}
          >
            <unit.icon className="w-3 h-3" />
            {unit.name}
          </button>
        ))}
      </div>

      {/* KPIs Principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ingresos Totales</p>
          <p className="text-4xl font-black text-slate-800 mt-2">{Num.fmt(displayStats.income)}</p>
        </motion.div>
        
        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gastos Totales</p>
          <p className="text-4xl font-black text-rose-500 mt-2">{Num.fmt(displayStats.expenses)}</p>
        </motion.div>
        
        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} 
          className={cn(
            "p-6 rounded-[2.5rem] shadow-xl relative overflow-hidden flex flex-col justify-center", 
            displayStats.profit >= 0 ? "bg-slate-900 text-white" : "bg-rose-600 text-white"
          )}>
          <div className="absolute -right-4 -bottom-4 opacity-10">
            {displayStats.profit >= 0 ? <TrendingUp className="w-32 h-32" /> : <TrendingDown className="w-32 h-32" />}
          </div>
          <p className="text-[10px] font-black opacity-70 uppercase tracking-widest relative z-10">Beneficio Neto</p>
          <p className="text-4xl font-black mt-2 relative z-10">{Num.fmt(displayStats.profit)}</p>
          <div className="flex items-center gap-2 mt-2 relative z-10">
            <span className="text-[10px] font-bold px-2 py-1 bg-white/20 rounded-lg backdrop-blur-sm">
              Margen: {Num.round2(displayStats.margin)}%
            </span>
          </div>
        </motion.div>
      </div>

      {/* 🚀 DESGLOSE MULTI-LOCAL (Solo visible en la vista Global) */}
      {selectedUnit === 'ALL' && (
        <div className="mt-8 bg-slate-50 p-6 rounded-[3rem] border border-slate-200/60">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6 px-2 flex items-center gap-2">
            <PieChart className="w-4 h-4" /> Desglose por Unidad de Negocio
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {BUSINESS_UNITS.map((unit, idx) => {
              const uStats = stats.unitBreakdown[unit.id];
              return (
                <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: idx * 0.1 }} key={unit.id} className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden hover:shadow-md transition">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-50">
                    <span className={cn("p-2 rounded-xl", unit.bg, unit.color)}><unit.icon className="w-4 h-4"/></span>
                    <span className="font-black text-slate-700 text-[10px] uppercase tracking-wide">{unit.name}</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between text-[10px] font-bold text-slate-500">
                      <span>Ingresos</span><span className="text-slate-800">{Num.fmt(uStats.income)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-slate-500">
                      <span>Gastos</span><span className="text-rose-500">{Num.fmt(uStats.expenses)}</span>
                    </div>
                    <div className="pt-3 flex justify-between font-black text-sm">
                      <span className="text-[10px] text-slate-400 uppercase tracking-widest">Neto</span>
                      <span className={uStats.profit >= 0 ? "text-emerald-500" : "text-rose-500"}>
                        {uStats.profit > 0 ? '+' : ''}{Num.fmt(uStats.profit)}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {/* Estructura de Gastos y Ratios */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        
        {/* Gastos Globales por Categoría */}
        <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-indigo-500" /> Estructura de Gastos Global
          </h3>
          <div className="space-y-1">
            <CostRow icon={Utensils} label="Materia Prima (Comida)" val={stats.gastos.comida} total={stats.gastos.total} color="bg-emerald-400 text-emerald-600" />
            <CostRow icon={Coffee} label="Materia Prima (Bebida)" val={stats.gastos.bebida} total={stats.gastos.total} color="bg-indigo-400 text-indigo-600" />
            <CostRow icon={Users} label="Personal" val={stats.gastos.personal} total={stats.gastos.total} color="bg-amber-400 text-amber-600" />
            <CostRow icon={Building2} label="Estructura (Fijos)" val={stats.gastos.estructura} total={stats.gastos.total} color="bg-rose-400 text-rose-600" />
            <CostRow icon={Briefcase} label="Otros / Amortizaciones" val={stats.gastos.otros + stats.gastos.amortizacion} total={stats.gastos.total} color="bg-slate-400 text-slate-600" />
          </div>
        </div>

        {/* Ratios Financieros */}
        <div className="bg-slate-900 p-6 sm:p-8 rounded-[2.5rem] shadow-xl text-white">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Ratios Clave (Sobre Ventas)
          </h3>
          <div className="space-y-3">
            <RatioRow label="Food Cost (Sólidos)" val={stats.ratios.foodCost} target={30} />
            <RatioRow label="Drink Cost (Líquidos)" val={stats.ratios.drinkCost} target={25} />
            <RatioRow label="Coste Laboral" val={stats.ratios.staffCost} target={35} />
            <div className="border-t border-slate-800 my-4"></div>
            <RatioRow label="PRIME COST" val={stats.ratios.primeCost} target={65} isWarning={stats.ratios.primeCost > 65} isMega />
          </div>
          <p className="text-[9px] text-slate-500 font-bold mt-6 text-center">
            * El Prime Cost no debería superar el 65% para garantizar rentabilidad.
          </p>
        </div>

      </div>
    </div>
  );
};

/* ====================================
 * SUBCOMPONENTES DE UI
 * ==================================== */

const CostRow = ({ icon: Icon, label, val, total, color }: any) => {
  const pct = total > 0 ? (val / total) * 100 : 0;
  const bgColorClass = color.split(' ')[0]; // Extrae bg-emerald-400
  const textColorClass = color.split(' ')[1]; // Extrae text-emerald-600

  return (
    <div className="mb-5 last:mb-0">
      <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-2 items-center">
        <span className="flex items-center gap-1.5"><Icon className={cn("w-3 h-3", textColorClass)} /> {label}</span>
        <span className="text-slate-800">{Num.fmt(val)} <span className="text-slate-400">({Num.round2(pct)}%)</span></span>
      </div>
      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn("h-full transition-all duration-1000", bgColorClass)} style={{ width: `${pct}%` }}></div>
      </div>
    </div>
  );
}

const RatioRow = ({ label, val, target, isWarning = false, isMega = false }: any) => {
  const over = val > target;
  return (
    <div className={cn(
      "flex items-center justify-between p-4 rounded-2xl border transition-colors",
      isMega ? "border-indigo-500/30 bg-indigo-500/10" : "border-slate-800 bg-slate-800/50"
    )}>
       <div>
         <p className={cn("font-black uppercase tracking-wider", isMega ? "text-sm text-indigo-300" : "text-[10px] text-slate-300")}>{label}</p>
         <p className="text-[9px] font-bold text-slate-500 mt-0.5">Objetivo óptimo: &lt;{target}%</p>
       </div>
       <div className={cn(
          "px-4 py-1.5 rounded-xl font-black tracking-tight",
          isMega ? "text-xl" : "text-sm",
          over ? "bg-rose-500/20 text-rose-400" : "bg-emerald-500/20 text-emerald-400"
       )}>
         {Num.round2(val)}%
       </div>
    </div>
  );
}
