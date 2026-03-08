import React, { useState, useMemo } from 'react';
import { 
  LayoutDashboard, 
  Wallet, 
  ArrowUpRight, 
  AlertCircle, 
  TrendingUp,
  Building2, 
  Hotel, 
  ShoppingBag, 
  Users,
  SplitSquareHorizontal,
  ChevronLeft,
  ChevronRight,
  CalendarDays
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { AppData } from '../types';

type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

// 🚀 NOMBRES B2B ACTUALIZADOS
const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string; hex: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50', hex: '#4f46e5' },
  { id: 'DLV', name: 'Catering Hoteles', icon: Hotel, color: 'text-amber-600', bg: 'bg-amber-50', hex: '#f59e0b' },
  { id: 'SHOP', name: 'Tienda & Sakes', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50', hex: '#10b981' },
  { id: 'CORP', name: 'Bloque Socios', icon: Users, color: 'text-slate-600', bg: 'bg-slate-100', hex: '#475569' },
];

export const DashboardView = ({ data }: { data: AppData }) => {
  // 🚀 ESTADOS DE NAVEGACIÓN TEMPORAL
  const [viewMode, setViewMode] = useState<'month' | 'quarter' | 'year'>('month');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()); // 0-11
  const [selectedQuarter, setSelectedQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1); // 1-4
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // 🔄 Controladores de Tiempo
  const handlePrev = () => {
    if (viewMode === 'month') {
      if (selectedMonth === 0) { setSelectedMonth(11); setSelectedYear(y => y - 1); }
      else setSelectedMonth(m => m - 1);
    } else if (viewMode === 'quarter') {
      if (selectedQuarter === 1) { setSelectedQuarter(4); setSelectedYear(y => y - 1); }
      else setSelectedQuarter(q => q - 1);
    } else {
      setSelectedYear(y => y - 1);
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      if (selectedMonth === 11) { setSelectedMonth(0); setSelectedYear(y => y + 1); }
      else setSelectedMonth(m => m + 1);
    } else if (viewMode === 'quarter') {
      if (selectedQuarter === 4) { setSelectedQuarter(1); setSelectedYear(y => y + 1); }
      else setSelectedQuarter(q => q + 1);
    } else {
      setSelectedYear(y => y + 1);
    }
  };

  const periodLabel = useMemo(() => {
    if (viewMode === 'month') {
      const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      return `${months[selectedMonth]} ${selectedYear}`;
    }
    if (viewMode === 'quarter') return `Q${selectedQuarter} ${selectedYear}`;
    return `Año ${selectedYear}`;
  }, [viewMode, selectedMonth, selectedQuarter, selectedYear]);

  // 🚀 EL NUEVO CEREBRO FINANCIERO (Adiós al bug de los 54k)
  const dashboardStats = useMemo(() => {
    const breakdown: Record<string, { income: number; expenses: number; profit: number }> = {
      REST: { income: 0, expenses: 0, profit: 0 },
      DLV: { income: 0, expenses: 0, profit: 0 },
      SHOP: { income: 0, expenses: 0, profit: 0 },
      CORP: { income: 0, expenses: 0, profit: 0 },
    };

    const aggregated = {
      ingresos: { total: 0 },
      gastos: { total: 0, comida: 0, bebida: 0, personal: 0, estructura: 0 },
      neto: 0,
      ratios: { primeCost: 0, foodCost: 0 }
    };

    let monthsToCalc: number[] = [];
    if (viewMode === 'month') monthsToCalc = [selectedMonth];
    else if (viewMode === 'quarter') {
      const start = (selectedQuarter - 1) * 3;
      monthsToCalc = [start, start + 1, start + 2];
    } else {
      monthsToCalc = [0,1,2,3,4,5,6,7,8,9,10,11];
    }

    const isDateInPeriod = (dateStr: string) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (d.getFullYear() !== selectedYear) return false;
      if (viewMode === 'month') return d.getMonth() === selectedMonth;
      if (viewMode === 'quarter') return Math.floor(d.getMonth() / 3) + 1 === selectedQuarter;
      return true;
    };

    // 1. INGRESOS - Cierres Z (REST, SHOP)
    (data.cierres || []).forEach((c: any) => {
      if (isDateInPeriod(c.date)) {
        const unit = c.unidad_negocio || 'REST'; 
        const t = Num.parse(c.totalVenta);
        if (breakdown[unit] && unit !== 'DLV') breakdown[unit].income += t;
        aggregated.ingresos.total += t;
      }
    });

    // 2. INGRESOS - Facturas a Clientes (HOTELES / DLV)
    (data.facturas || []).forEach((f: any) => {
      if (isDateInPeriod(f.date) && f.status !== 'draft') {
        // Es un ingreso SOLO si tiene un Cliente válido (y no es el Z DIARIO automático)
        if (f.cliente && f.cliente !== 'Z DIARIO' && f.cliente.trim() !== '') {
           const unit = f.unidad_negocio || 'DLV';
           const t = Math.abs(Num.parse(f.total));
           if (breakdown[unit]) breakdown[unit].income += t;
           aggregated.ingresos.total += t;
        }
      }
    });

    // 3. GASTOS - Albaranes (Proveedores)
    (data.albaranes || []).forEach((a: any) => {
      if (isDateInPeriod(a.date)) {
        const unit = a.unidad_negocio || a.unitId || 'REST';
        const t = Num.parse(a.total);
        if (breakdown[unit]) breakdown[unit].expenses += t;
        aggregated.gastos.total += t;

        // Clasificación básica de gastos (Si tiene 21% de IVA asumimos que es Bebida/Alcohol)
        const hasAlcohol = (a.items || []).some((i:any) => i.rate === 21);
        if (hasAlcohol) aggregated.gastos.bebida += t;
        else aggregated.gastos.comida += t;
      }
    });

    // 4. GASTOS - Facturas de Proveedores directas (Sin albaranes)
    (data.facturas || []).forEach((f: any) => {
      if (isDateInPeriod(f.date) && f.status !== 'draft') {
        // Es un gasto si NO tiene cliente, o el cliente está vacío
        if (!f.cliente || f.cliente === 'Z DIARIO' || f.cliente.trim() === '') {
          // Evitar doble conteo: Solo sumamos la factura si NO tiene albaranes dentro
          if (!f.albaranIdsArr || f.albaranIdsArr.length === 0) {
            const unit = f.unidad_negocio || 'REST';
            const t = Math.abs(Num.parse(f.total));
            if (breakdown[unit]) breakdown[unit].expenses += t;
            aggregated.gastos.total += t;
            aggregated.gastos.estructura += t; // Los gastos directos sin albarán suelen ser servicios/estructura
          }
        }
      }
    });

    // 5. GASTOS FIJOS (Proporcionales)
    monthsToCalc.forEach(m => {
      const currentMonthKey = `pagos_${selectedYear}_${m + 1}`;
      const pagadosIds = (data.control_pagos || {})[currentMonthKey] || [];
      
      (data.gastos_fijos || []).forEach((g: any) => {
        if (g.active !== false && pagadosIds.includes(g.id)) {
          const unit = g.unitId || 'REST';
          let amount = parseFloat(g.amount as any) || 0;
          if (g.freq === 'anual') amount = amount / 12;
          if (g.freq === 'trimestral') amount = amount / 3;
          
          if (breakdown[unit]) breakdown[unit].expenses += amount;
          aggregated.gastos.total += amount;

          if (String(g.category).toLowerCase().includes('nómina') || String(g.category).toLowerCase().includes('personal')) {
             aggregated.gastos.personal += amount;
          } else {
             aggregated.gastos.estructura += amount;
          }
        }
      });
    });

    // 6. CALCULAR BENEFICIO Y RATIOS GLOBALES
    Object.keys(breakdown).forEach(k => {
      breakdown[k].profit = breakdown[k].income - breakdown[k].expenses;
    });

    aggregated.neto = aggregated.ingresos.total - aggregated.gastos.total;
    if (aggregated.ingresos.total > 0) {
      aggregated.ratios.foodCost = (aggregated.gastos.comida / aggregated.ingresos.total) * 100;
      aggregated.ratios.primeCost = ((aggregated.gastos.comida + aggregated.gastos.bebida + aggregated.gastos.personal) / aggregated.ingresos.total) * 100;
    }

    return { breakdown, aggregated };
  }, [data.cierres, data.albaranes, data.facturas, data.gastos_fijos, data.control_pagos, viewMode, selectedMonth, selectedQuarter, selectedYear]);

  // Variables cómodas para usar en la vista
  const stats = dashboardStats.aggregated;
  const unitBreakdown = dashboardStats.breakdown;

  // 🚀 GRÁFICO INTELIGENTE (Días vs Meses)
  const chartData = useMemo(() => {
    if (viewMode === 'month') {
      const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      const days = Array.from({ length: daysInMonth }, (_, i) => ({ name: String(i + 1).padStart(2, '0'), venta: 0 }));
      
      (data.cierres || []).forEach(c => {
        const d = new Date(c.date);
        if (d.getFullYear() === selectedYear && d.getMonth() === selectedMonth) {
          const dayIdx = d.getDate() - 1;
          if (days[dayIdx]) days[dayIdx].venta += Num.parse(c.totalVenta);
        }
      });
      return days;
    } else {
      let startMonth = 0; let numMonths = 12;
      if (viewMode === 'quarter') { startMonth = (selectedQuarter - 1) * 3; numMonths = 3; }
      
      const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
      const months = Array.from({ length: numMonths }, (_, i) => ({ name: monthNames[startMonth + i], venta: 0 }));

      (data.cierres || []).forEach(c => {
        const d = new Date(c.date);
        if (d.getFullYear() === selectedYear && d.getMonth() >= startMonth && d.getMonth() < startMonth + numMonths) {
          const mIdx = d.getMonth() - startMonth;
          if (months[mIdx]) months[mIdx].venta += Num.parse(c.totalVenta);
        }
      });
      return months;
    }
  }, [data.cierres, viewMode, selectedMonth, selectedQuarter, selectedYear]);


  return (
    <div className="space-y-6 animate-fade-in pb-24">
      {/* 🚀 BANNER MULTI-LOCAL + SELECTOR DE TIEMPO INCORPORADO */}
      <div className="bg-slate-900 p-6 md:p-8 rounded-[2.5rem] flex flex-col md:flex-row items-center justify-between shadow-xl text-white overflow-hidden relative gap-6">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500"></div>
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
          <SplitSquareHorizontal className="w-48 h-48" />
        </div>
        
        <div className="relative z-10 flex-1 text-center md:text-left">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight flex items-center justify-center md:justify-start gap-2">
            <LayoutDashboard className="w-8 h-8 text-indigo-400" /> Consolidado del Grupo
          </h2>
          <p className="text-xs text-indigo-300 font-bold uppercase tracking-widest mt-2">Métricas de Rentabilidad Multilocal</p>
        </div>

        {/* 🎛️ PANEL DE NAVEGACIÓN TEMPORAL */}
        <div className="relative z-10 flex flex-col items-center gap-3 bg-slate-800/80 p-3 rounded-[2rem] border border-slate-700/50 w-full md:w-auto shadow-inner backdrop-blur-md">
          <div className="flex gap-1 bg-slate-900 p-1.5 rounded-2xl w-full justify-center shadow-inner border border-slate-800">
            <button onClick={() => setViewMode('month')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all", viewMode === 'month' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800')}>Mes</button>
            <button onClick={() => setViewMode('quarter')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all", viewMode === 'quarter' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800')}>Trimestre</button>
            <button onClick={() => setViewMode('year')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all", viewMode === 'year' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800')}>Año</button>
          </div>
          <div className="flex items-center justify-between w-full px-3 py-1">
            <button onClick={handlePrev} className="p-2 hover:bg-indigo-500 hover:text-white text-indigo-300 bg-slate-700 rounded-full transition shadow-sm"><ChevronLeft className="w-4 h-4"/></button>
            <div className="flex flex-col items-center justify-center w-36">
               <span className="font-black text-sm uppercase tracking-widest text-white text-center whitespace-nowrap truncate w-full">{periodLabel}</span>
            </div>
            <button onClick={handleNext} className="p-2 hover:bg-indigo-500 hover:text-white text-indigo-300 bg-slate-700 rounded-full transition shadow-sm"><ChevronRight className="w-4 h-4"/></button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Ingresos Totales</p>
          <h3 className="text-xl font-black text-slate-800">{Num.fmt(stats.ingresos.total)}</h3>
          <div className="flex items-center text-emerald-500 text-[10px] font-bold mt-1">
            <ArrowUpRight className="w-3 h-3 mr-1" /> +{stats.ratios.primeCost.toFixed(1)}% Prime
          </div>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Gastos Operativos</p>
          <h3 className="text-xl font-black text-slate-800">{Num.fmt(stats.gastos.total)}</h3>
          <p className="text-[10px] text-slate-400 font-bold mt-1">Incluye fijos y variables</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden">
          <div className={cn("absolute right-0 top-0 w-2 h-full", stats.neto >= 0 ? "bg-emerald-400" : "bg-rose-400")} />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Beneficio Neto</p>
          <h3 className={cn("text-xl font-black", stats.neto >= 0 ? "text-emerald-600" : "text-rose-600")}>
            {Num.fmt(stats.neto)}
          </h3>
          <p className="text-[10px] text-slate-400 font-bold mt-1">EBITDA Estimado</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Food Cost Promedio</p>
          <h3 className="text-xl font-black text-slate-800">{stats.ratios.foodCost.toFixed(1)}%</h3>
          <p className="text-[10px] text-indigo-500 font-bold mt-1">Objetivo Ideal: 28%</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            Evolución de Ventas ({viewMode === 'month' ? 'Días' : 'Meses'})
          </h3>
        </div>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorVenta" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 800}} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 800}} tickFormatter={(v) => `${v}€`} />
              <Tooltip 
                contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)', fontWeight: 800}}
                formatter={(value: number) => [`${Num.fmt(value)}`, 'Ventas']}
              />
              <Area type="monotone" dataKey="venta" stroke="#4f46e5" strokeWidth={4} fillOpacity={1} fill="url(#colorVenta)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Desglose de Gastos Clásico */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">Desglose Gastos ({periodLabel})</h3>
          <div className="space-y-5">
            {[
              { label: 'Comida', val: stats.gastos.comida, color: 'bg-amber-500', hex: '#f59e0b' },
              { label: 'Bebida', val: stats.gastos.bebida, color: 'bg-blue-500', hex: '#3b82f6' },
              { label: 'Personal', val: stats.gastos.personal, color: 'bg-indigo-500', hex: '#6366f1' },
              { label: 'Estructura Fija', val: stats.gastos.estructura, color: 'bg-slate-700', hex: '#334155' }
            ].map(g => (
              <div key={g.label} className="space-y-1.5 group">
                <div className="flex justify-between text-[10px] font-black uppercase">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.hex }}></span> {g.label}
                  </span>
                  <span className="text-slate-900 group-hover:scale-110 transition-transform">{Num.fmt(g.val)}</span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className={cn("h-full rounded-full transition-all duration-1000", g.color)} 
                    style={{ width: `${stats.gastos.total ? (g.val / stats.gastos.total) * 100 : 0}%` }} 
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 🚀 Rendimiento por Unidad (Multi-Local) */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-amber-500 to-emerald-500"></div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">Rentabilidad por Unidad</h3>
          <div className="space-y-5">
            {BUSINESS_UNITS.map(unit => {
              const uStat = unitBreakdown[unit.id] || { income: 0, expenses: 0, profit: 0 };
              const maxIncome = Math.max(...Object.values(unitBreakdown).map(u => u.income), 1);
              
              return (
                <div key={unit.id} className="group">
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={cn("p-2 rounded-xl transition-transform group-hover:scale-110", unit.bg)}>
                        <unit.icon className={cn("w-3 h-3", unit.color)} />
                      </div>
                      <span className="text-[10px] font-black text-slate-700 uppercase">{unit.name}</span>
                    </div>
                    <div className="text-right">
                      <span className={cn("text-sm font-black", uStat.profit >= 0 ? "text-emerald-600" : "text-rose-600")}>
                        {Num.fmt(uStat.profit)}
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                    <div 
                      className="h-full transition-all duration-1000" 
                      style={{ 
                        width: `${(uStat.income / maxIncome) * 100}%`, 
                        backgroundColor: unit.hex 
                      }} 
                    />
                  </div>
                  <p className="text-[8px] font-bold text-slate-400 mt-1 flex justify-between uppercase">
                    <span>Ingresos: {Num.fmt(uStat.income)}</span>
                    <span className="text-rose-400">Gastos: {Num.fmt(uStat.expenses)}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Alertas del Sistema */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">Alertas Activas</h3>
          <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-2 max-h-[300px]">
            {data.ingredientes.filter(i => i.stock <= i.min).length === 0 && data.facturas.filter((f: any) => !f.paid).length === 0 && (
               <div className="h-full flex flex-col items-center justify-center opacity-50 py-10">
                 <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                 <p className="text-xs font-bold text-slate-500">Todo bajo control</p>
               </div>
            )}
            
            {data.ingredientes.filter(i => i.stock <= i.min).map(ing => (
              <div key={ing.id} className="flex items-center gap-3 p-3 bg-rose-50 rounded-2xl border border-rose-100 hover:shadow-md transition">
                <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-rose-900 truncate">{ing.n}</p>
                  <p className="text-[9px] text-rose-400 font-black uppercase">Stock crítico: {ing.stock} {ing.unit}</p>
                </div>
              </div>
            ))}
            
            {data.facturas.filter((f: any) => !f.paid).length > 0 && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-2xl border border-amber-100 hover:shadow-md transition">
                <Wallet className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-amber-900">Facturas Pendientes</p>
                  <p className="text-[9px] text-amber-500 font-black uppercase">{data.facturas.filter((f: any) => !f.paid).length} recibos por pagar</p>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
