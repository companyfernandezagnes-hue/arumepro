import React, { useState, useMemo, useEffect } from 'react';
import { 
  LayoutDashboard, Wallet, ArrowUpRight, ArrowDownRight, AlertCircle, 
  TrendingUp, Building2, Hotel, ShoppingBag, Users, SplitSquareHorizontal, 
  ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, ShieldCheck, Mail, Loader2
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { AppData } from '../types';
import { createClient } from '@supabase/supabase-js';

type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

const SUPABASE_URL = "https://awbgboucnbsuzojocbuy.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_drOQ5PsFA8eox_aRTXNATQ_5kibM6ST";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string; hex: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50', hex: '#4f46e5' },
  { id: 'DLV', name: 'Catering Hoteles', icon: Hotel, color: 'text-amber-600', bg: 'bg-amber-50', hex: '#f59e0b' },
  { id: 'SHOP', name: 'Tienda & Sakes', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50', hex: '#10b981' },
  { id: 'CORP', name: 'Bloque Socios', icon: Users, color: 'text-slate-600', bg: 'bg-slate-100', hex: '#475569' },
];

const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export const DashboardView = ({ data }: { data: AppData }) => {
  const [viewMode, setViewMode] = useState<'month' | 'quarter' | 'year'>('month');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedQuarter, setSelectedQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // 📧 Estado para los correos generales
  const [generalEmails, setGeneralEmails] = useState<any[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(true);

  // Safeguards de colecciones
  const cierres = data.cierres ?? [];
  const albaranes = data.albaranes ?? [];
  const facturas = data.facturas ?? [];
  const gastosFijos = data.gastos_fijos ?? [];
  const controlPagos = data.control_pagos ?? {};
  const ingredientes = data.ingredientes ?? [];
  const emailConfigurado = data.config?.emailGeneral || 'No configurado';

  // ==========================================
  // 📧 EFECTO: CARGAR CORREOS GENERALES
  // ==========================================
  useEffect(() => {
    const fetchGeneralEmails = async () => {
      setLoadingEmails(true);
      try {
        // En n8n tendrás que enviar los correos a una tabla llamada 'inbox_general' (por ejemplo)
        const { data: correos, error } = await supabase
          .from('inbox_general')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);
          
        if (!error && correos) {
          setGeneralEmails(correos);
        }
      } catch (e) {
        console.error("No se pudo cargar el buzón general", e);
      } finally {
        setLoadingEmails(false);
      }
    };
    fetchGeneralEmails();
  }, []);

  // ==========================================
  // 🧭 NAVEGACIÓN TEMPORAL
  // ==========================================
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
    if (viewMode === 'month') return `${MONTHS_FULL[selectedMonth]} ${selectedYear}`;
    if (viewMode === 'quarter') return `Q${selectedQuarter} ${selectedYear}`;
    return `Año ${selectedYear}`;
  }, [viewMode, selectedMonth, selectedQuarter, selectedYear]);

  // ==========================================
  // 🧠 MOTOR DE CÁLCULO FINANCIERO (Mejorado por IA)
  // ==========================================
  const calculateStatsForPeriod = (month: number, quarter: number, year: number, mode: string) => {
    const breakdown: Record<string, { income: number; expenses: number; profit: number }> = {
      REST: { income: 0, expenses: 0, profit: 0 }, DLV:  { income: 0, expenses: 0, profit: 0 },
      SHOP: { income: 0, expenses: 0, profit: 0 }, CORP: { income: 0, expenses: 0, profit: 0 },
    };

    const agg = {
      ingresos: { total: 0 },
      gastos: { total: 0, comida: 0, bebida: 0, personal: 0, estructura: 0 },
      neto: 0, ratios: { primeCost: 0, foodCost: 0 }
    };

    let monthsToCalc: number[] = [];
    if (mode === 'month') monthsToCalc = [month];
    else if (mode === 'quarter') { const start = (quarter - 1) * 3; monthsToCalc = [start, start + 1, start + 2]; } 
    else { monthsToCalc = [0,1,2,3,4,5,6,7,8,9,10,11]; }

    const isDateInPeriod = (dateStr: string) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (d.getFullYear() !== year) return false;
      if (mode === 'month') return d.getMonth() === month;
      if (mode === 'quarter') return Math.floor(d.getMonth() / 3) + 1 === quarter;
      return true;
    };

    cierres.forEach((c: any) => {
      if (isDateInPeriod(c.date)) {
        const unit = c.unidad_negocio || 'REST';
        const t = Num.parse(c.totalVenta);
        if (breakdown[unit] && unit !== 'DLV') breakdown[unit].income += t;
        agg.ingresos.total += t;
      }
    });

    facturas.forEach((f: any) => {
      if (isDateInPeriod(f.date) && f.status !== 'draft') {
        const tRaw = Num.parse(f.total);
        if (f.cliente && f.cliente !== 'Z DIARIO' && f.cliente.trim() !== '') {
          const unit = f.unidad_negocio || 'DLV';
          if (breakdown[unit]) breakdown[unit].income += tRaw; // Permite facturas de abono (negativas)
          agg.ingresos.total += tRaw;
        } else {
          const noTieneAlbaranes = !f.albaranIdsArr || f.albaranIdsArr.length === 0;
          if (noTieneAlbaranes) {
            const unit = f.unidad_negocio || 'REST';
            const t = Math.abs(tRaw);
            if (breakdown[unit]) breakdown[unit].expenses += t;
            agg.gastos.total += t;
            agg.gastos.estructura += t;
          }
        }
      }
    });

    albaranes.forEach((a: any) => {
      if (isDateInPeriod(a.date)) {
        const unit = a.unidad_negocio || a.unitId || 'REST';
        const t = Num.parse(a.total);
        if (breakdown[unit]) breakdown[unit].expenses += t;
        agg.gastos.total += t;

        const hasBebida = (a.items || []).some((i:any) => {
          const cat = String(i.cat || i.category || '').toLowerCase();
          if (cat.includes('bebida') || cat.includes('bar') || cat.includes('alcohol')) return true;
          return i.rate === 21; 
        });
        if (hasBebida) agg.gastos.bebida += t; else agg.gastos.comida += t;
      }
    });

    monthsToCalc.forEach(m => {
      const currentMonthKey = `pagos_${year}_${m + 1}`;
      const pagadosIds = controlPagos[currentMonthKey] || [];
      gastosFijos.forEach((g: any) => {
        if (g.active !== false && pagadosIds.includes(g.id)) {
          const unit = g.unitId || 'REST';
          const amount = parseFloat(g.amount as any) || 0;
          if (breakdown[unit]) breakdown[unit].expenses += amount;
          agg.gastos.total += amount;

          const cat = String(g.category ?? g.cat ?? '').toLowerCase();
          if (cat.includes('nómina') || cat.includes('personal')) agg.gastos.personal += amount;
          else agg.gastos.estructura += amount;
        }
      });
    });

    Object.keys(breakdown).forEach(k => breakdown[k].profit = breakdown[k].income - breakdown[k].expenses);
    agg.neto = agg.ingresos.total - agg.gastos.total;

    if (agg.ingresos.total > 0) {
      agg.ratios.foodCost = (agg.gastos.comida / agg.ingresos.total) * 100;
      agg.ratios.primeCost = ((agg.gastos.comida + agg.gastos.bebida + agg.gastos.personal) / agg.ingresos.total) * 100;
    }

    return { breakdown, aggregated: agg };
  };

  // Cálculo del periodo actual
  const dashboardStats = useMemo(() => calculateStatsForPeriod(selectedMonth, selectedQuarter, selectedYear, viewMode), 
    [cierres, albaranes, facturas, gastosFijos, controlPagos, viewMode, selectedMonth, selectedQuarter, selectedYear]
  );
  const stats = dashboardStats.aggregated;
  const unitBreakdown = dashboardStats.breakdown;

  // Cálculo del periodo ANTERIOR (Para ver si crecemos o bajamos)
  const previousPeriodStats = useMemo(() => {
    let pMonth = selectedMonth, pQuarter = selectedQuarter, pYear = selectedYear;
    if (viewMode === 'month') { pMonth -= 1; if (pMonth < 0) { pMonth = 11; pYear -= 1; } }
    else if (viewMode === 'quarter') { pQuarter -= 1; if (pQuarter < 1) { pQuarter = 4; pYear -= 1; } }
    else { pYear -= 1; }
    return calculateStatsForPeriod(pMonth, pQuarter, pYear, viewMode).aggregated;
  }, [cierres, albaranes, facturas, gastosFijos, controlPagos, viewMode, selectedMonth, selectedQuarter, selectedYear]);

  // ==========================================
  // 📈 GRÁFICO (Días vs Meses)
  // ==========================================
  const chartData = useMemo(() => {
    if (viewMode === 'month') {
      const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      const days = Array.from({ length: daysInMonth }, (_, i) => ({ name: String(i + 1).padStart(2, '0'), venta: 0 }));
      cierres.forEach(c => {
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
      const months = Array.from({ length: numMonths }, (_, i) => ({ name: MONTHS_SHORT[startMonth + i], venta: 0 }));
      cierres.forEach(c => {
        const d = new Date(c.date);
        if (d.getFullYear() === selectedYear && d.getMonth() >= startMonth && d.getMonth() < startMonth + numMonths) {
          const mIdx = d.getMonth() - startMonth;
          if (months[mIdx]) months[mIdx].venta += Num.parse(c.totalVenta);
        }
      });
      return months;
    }
  }, [cierres, viewMode, selectedMonth, selectedQuarter, selectedYear]);

  // Utilidades para KPIs
  const renderTrend = (current: number, previous: number) => {
    if (previous === 0) return null;
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    const isPositive = pct >= 0;
    return (
      <div className={cn("flex items-center text-[10px] font-black mt-1", isPositive ? "text-emerald-500" : "text-rose-500")}>
        {isPositive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
        {Math.abs(pct).toFixed(1)}% vs anterior
      </div>
    );
  };

  const foodCostPct  = Number.isFinite(stats.ratios.foodCost) ? stats.ratios.foodCost : 0;
  const lowStock = ingredientes.filter(i => (i?.stock ?? 0) <= (i?.min ?? 0));
  const facturasPendientes = facturas.filter((f: any) => !f.paid);

  return (
    <div className="space-y-6 animate-fade-in pb-24">
      {/* 🚀 HEADER Y NAVEGACIÓN TEMPORAL */}
      <div className="bg-slate-900 p-6 md:p-8 rounded-[2.5rem] flex flex-col md:flex-row items-center justify-between shadow-xl text-white overflow-hidden relative gap-6">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500"></div>
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
          <SplitSquareHorizontal className="w-48 h-48" />
        </div>
        
        <div className="relative z-10 flex-1 text-center md:text-left">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight flex items-center justify-center md:justify-start gap-3">
            <LayoutDashboard className="w-8 h-8 text-indigo-400" /> Consolidado del Grupo
          </h2>
          <p className="text-xs text-indigo-300 font-bold uppercase tracking-[0.2em] mt-2">Métricas de Rentabilidad Multilocal</p>
        </div>

        <div className="relative z-10 flex flex-col items-center gap-3 bg-slate-800/80 p-3 rounded-[2rem] border border-slate-700/50 w-full md:w-auto shadow-inner backdrop-blur-md">
          <div className="flex gap-1 bg-slate-900 p-1.5 rounded-[1.5rem] w-full justify-center shadow-inner border border-slate-800">
            <button aria-label="Vista mensual" onClick={() => setViewMode('month')} className={cn("px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", viewMode === 'month' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800')}>Mes</button>
            <button aria-label="Vista trimestral" onClick={() => setViewMode('quarter')} className={cn("px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", viewMode === 'quarter' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800')}>Trimestre</button>
            <button aria-label="Vista anual" onClick={() => setViewMode('year')} className={cn("px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", viewMode === 'year' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800')}>Año</button>
          </div>
          <div className="flex items-center justify-between w-full px-3 py-1">
            <button aria-label="Periodo anterior" onClick={handlePrev} className="p-2.5 hover:bg-indigo-500 hover:text-white text-indigo-300 bg-slate-700 rounded-full transition shadow-sm"><ChevronLeft className="w-5 h-5"/></button>
            <div className="flex flex-col items-center justify-center w-40">
               <span className="font-black text-sm uppercase tracking-widest text-white text-center whitespace-nowrap truncate w-full">{periodLabel}</span>
            </div>
            <button aria-label="Periodo siguiente" onClick={handleNext} className="p-2.5 hover:bg-indigo-500 hover:text-white text-indigo-300 bg-slate-700 rounded-full transition shadow-sm"><ChevronRight className="w-5 h-5"/></button>
          </div>
        </div>
      </div>

      {/* 📊 KPIs PRINCIPALES */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between">Ingresos Totales <Wallet className="w-4 h-4 text-slate-300"/></p>
          <h3 className="text-2xl font-black text-slate-800 mt-2">{Num.fmt(stats.ingresos.total)}</h3>
          {renderTrend(stats.ingresos.total, previousPeriodStats.ingresos.total)}
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between">Gastos Operativos <TrendingUp className="w-4 h-4 text-slate-300"/></p>
          <h3 className="text-2xl font-black text-slate-800 mt-2">{Num.fmt(stats.gastos.total)}</h3>
          {renderTrend(stats.gastos.total, previousPeriodStats.gastos.total)}
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden">
          <div className={cn("absolute right-0 top-0 w-2 h-full", stats.neto >= 0 ? "bg-emerald-400" : "bg-rose-400")} />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Margen Neto (Cash)</p>
          <h3 className={cn("text-2xl font-black mt-2 tracking-tighter", stats.neto >= 0 ? "text-emerald-600" : "text-rose-600")}>{Num.fmt(stats.neto)}</h3>
          {renderTrend(stats.neto, previousPeriodStats.neto)}
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Food Cost Ratio</p>
          <h3 className="text-2xl font-black text-slate-800 mt-2">{foodCostPct.toFixed(1)}%</h3>
          <p className="text-[10px] text-indigo-500 font-bold mt-1.5 uppercase tracking-widest">Objetivo Ideal: 28%</p>
        </div>
      </div>

      {/* 📈 GRÁFICO DE VENTAS */}
      <div className="bg-white p-6 md:p-8 rounded-[3rem] border border-slate-100 shadow-sm">
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-500" />
            Evolución de Ventas ({viewMode === 'month' ? 'Días' : 'Meses'})
          </h3>
        </div>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorVenta" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 800}} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 800}} tickFormatter={(v) => Num.fmt(v)} />
              <Tooltip 
                contentStyle={{borderRadius: '24px', border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)', fontWeight: 800, padding: '16px'}}
                formatter={(value: number) => [Num.fmt(value), 'Ventas']}
              />
              <Area type="monotone" dataKey="venta" stroke="#4f46e5" strokeWidth={4} fillOpacity={1} fill="url(#colorVenta)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ⚙️ DESGLOSE, UNIDADES Y CORREOS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* COLUMNA 1: Desglose Gastos (Span 4) */}
        <div className="lg:col-span-4 bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">Desglose Gastos</h3>
          <div className="space-y-6 flex-1">
            {[
              { label: 'Comida',    val: stats.gastos.comida,    color: 'bg-amber-500',  hex: '#f59e0b' },
              { label: 'Bebida',    val: stats.gastos.bebida,    color: 'bg-blue-500',   hex: '#3b82f6' },
              { label: 'Personal',  val: stats.gastos.personal,  color: 'bg-indigo-500', hex: '#6366f1' },
              { label: 'Estructura',val: stats.gastos.estructura,color: 'bg-slate-700', hex: '#334155' }
            ].map(g => (
              <div key={g.label} className="space-y-2 group">
                <div className="flex justify-between text-[11px] font-black uppercase tracking-widest">
                  <span className="text-slate-500 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.hex }}></span> {g.label}
                  </span>
                  <span className="text-slate-900 group-hover:scale-110 transition-transform">{Num.fmt(g.val)}</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner" title={`${Num.fmt(g.val)}`}>
                  <div 
                    className={cn("h-full rounded-full transition-all duration-1000", g.color)} 
                    style={{ width: `${stats.gastos.total ? (g.val / stats.gastos.total) * 100 : 0}%` }} 
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-6 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Prime Cost actual: {Number.isFinite(stats.ratios.primeCost) ? stats.ratios.primeCost.toFixed(1) : 0}%</p>
          </div>
        </div>

        {/* COLUMNA 2: Unidades de Negocio (Span 4) */}
        <div className="lg:col-span-4 bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 via-amber-500 to-emerald-500"></div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">Rentabilidad Local</h3>
          <div className="space-y-6">
            {BUSINESS_UNITS.map(unit => {
              const uStat = unitBreakdown[unit.id] || { income: 0, expenses: 0, profit: 0 };
              const maxIncome = Math.max(...Object.values(unitBreakdown).map(u => u.income), 1);
              return (
                <div key={unit.id} className="group">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2.5 rounded-2xl transition-transform group-hover:scale-110", unit.bg)}>
                        <unit.icon className={cn("w-4 h-4", unit.color)} />
                      </div>
                      <span className="text-[11px] font-black text-slate-700 uppercase tracking-wider">{unit.name}</span>
                    </div>
                    <div className="text-right">
                      <span className={cn("text-base font-black tracking-tighter", uStat.profit >= 0 ? "text-emerald-600" : "text-rose-600")}>
                        {Num.fmt(uStat.profit)}
                      </span>
                    </div>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                    <div className="h-full transition-all duration-1000" style={{ width: `${(uStat.income / maxIncome) * 100}%`, backgroundColor: unit.hex }} />
                  </div>
                  <p className="text-[9px] font-bold text-slate-400 mt-1.5 flex justify-between uppercase tracking-widest px-1">
                    <span>In: {Num.fmt(uStat.income)}</span>
                    <span className="text-rose-400">Out: {Num.fmt(uStat.expenses)}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* COLUMNA 3: Correos Generales + Alertas (Span 4) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* 📧 NUEVO: BUZÓN GENERAL DE OPERACIONES */}
          <div className="bg-slate-900 p-6 rounded-[2.5rem] border border-slate-800 shadow-xl flex-1 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5"><Mail className="w-32 h-32" /></div>
            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-1 flex items-center gap-2 relative z-10"><Mail className="w-4 h-4 text-blue-400" /> Buzón de Empresa</h3>
            <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-4 relative z-10">{emailConfigurado}</p>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 max-h-[180px] relative z-10 pr-2">
              {loadingEmails ? (
                <div className="flex flex-col items-center justify-center h-full opacity-50 py-4">
                  <Loader2 className="w-6 h-6 text-blue-400 animate-spin mb-2" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Sincronizando IMAP...</p>
                </div>
              ) : generalEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-50 py-4 text-center">
                  <CheckCircle2 className="w-8 h-8 text-slate-500 mb-2" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bandeja vacía</p>
                </div>
              ) : (
                generalEmails.map((email) => (
                  <div key={email.id} className="bg-slate-800/80 p-3.5 rounded-2xl border border-slate-700 hover:border-blue-500/50 transition cursor-default">
                    <p className="text-xs font-bold text-white truncate">{email.remitente}</p>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">{email.asunto}</p>
                    <p className="text-[8px] font-black text-blue-400 mt-2 text-right">{new Date(email.created_at).toLocaleDateString()}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Alertas */}
          <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex-1">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500"/> Alertas Activas</h3>
            <div className="space-y-3 max-h-[160px] overflow-y-auto custom-scrollbar pr-2">
              {lowStock.length === 0 && facturasPendientes.length === 0 && (
                <div className="flex flex-col items-center justify-center opacity-50 py-6">
                  <ShieldCheck className="w-10 h-10 text-emerald-500 mb-2" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Todo bajo control</p>
                </div>
              )}

              {lowStock.map(ing => (
                <div key={ing.id} className="flex items-center gap-3 p-3 bg-rose-50 rounded-2xl border border-rose-100">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-rose-900 truncate">{ing.n}</p>
                    <p className="text-[9px] text-rose-500 font-black uppercase tracking-widest">Stock: {ing.stock} {ing.unit}</p>
                  </div>
                </div>
              ))}

              {facturasPendientes.length > 0 && (
                <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-2xl border border-amber-100">
                  <Wallet className="w-5 h-5 text-amber-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-amber-900">Facturas Pendientes</p>
                    <p className="text-[9px] text-amber-600 font-black uppercase tracking-widest">{facturasPendientes.length} recibos por pagar</p>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
