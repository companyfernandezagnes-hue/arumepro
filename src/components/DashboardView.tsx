import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Wallet, ArrowUpRight, ArrowDownRight,
  TrendingDown, TrendingUp, Building2, Hotel, ShoppingBag, Users, SplitSquareHorizontal,
  ChevronLeft, ChevronRight, CheckCircle2, Mail, Loader2,
  Sparkles, Coffee, ChefHat, AlertTriangle, Zap,
  CreditCard, Package, Clock, ExternalLink, CalendarCheck
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { AppData } from '../types';
import { supabase } from '../services/supabase';
import { DailyBriefing } from './DailyBriefing';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Props ────────────────────────────────────────────────────────────────────
interface DashboardViewProps {
  data       : AppData;
  onNavigate?: (tab: string) => void;
}

type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string; hex: string }[] = [
  { id: 'REST', name: 'Restaurante',      icon: Building2,   color: 'text-indigo-600', bg: 'bg-indigo-50',  hex: '#4f46e5' },
  { id: 'DLV',  name: 'Catering Hoteles', icon: Hotel,       color: 'text-amber-600',  bg: 'bg-amber-50',   hex: '#f59e0b' },
  { id: 'SHOP', name: 'Tienda & Sakes',   icon: ShoppingBag, color: 'text-emerald-600',bg: 'bg-emerald-50', hex: '#10b981' },
  { id: 'CORP', name: 'Bloque Socios',    icon: Users,       color: 'text-slate-600',  bg: 'bg-slate-100',  hex: '#475569' },
];

const MONTHS_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTHS_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// ─── Fecha segura ─────────────────────────────────────────────────────────────
const safeParseDate = (dateStr: string | null | undefined): Date => {
  if (!dateStr) return new Date();
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      const parsed = new Date(year, parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  const fallback = new Date(dateStr);
  return !Number.isNaN(fallback.getTime()) ? fallback : new Date();
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

// ─── Widget: Pulso del Día ────────────────────────────────────────────────────
// Muestra el estado operativo de HOY de un vistazo y ofrece accesos directos
const PulsoDelDia: React.FC<{ data: AppData; onNavigate?: (tab: string) => void }> = ({ data, onNavigate }) => {
  const hoy = todayISO();

  const pulso = useMemo(() => {
    const cierres    = Array.isArray(data.cierres)      ? data.cierres      : [];
    const albaranes  = Array.isArray(data.albaranes)    ? data.albaranes    : [];
    const banco      = Array.isArray((data as any).banco) ? (data as any).banco : [];
    const cobrosB2B  = Array.isArray((data as any).cobros_b2b) ? (data as any).cobros_b2b : [];
    const ingredientes = Array.isArray(data.ingredientes) ? data.ingredientes : [];

    // ── Caja hoy ─────────────────────────────────────────────────────────
    const cierreHoy = cierres.find(c => (c as any).date === hoy && ((c as any).unitId === 'REST' || !(c as any).unitId));
    const ventaHoy  = cierreHoy ? Num.round2(Num.parse((cierreHoy as any).totalVenta || 0)) : null;

    // ── Albaranes sin pagar que vencen hoy o están vencidos ──────────────
    const albsUrgentes = albaranes.filter(a => {
      if (a.paid) return false;
      const due = (a as any).dueDate || '';
      return due <= hoy && due !== '';
    }).length;

    // ── Cobros B2B urgentes ───────────────────────────────────────────────
    const cobrosUrgentes = cobrosB2B.filter((c: any) => !c.paid && c.vencimiento <= hoy).length;

    // ── Movimientos banco sin conciliar ───────────────────────────────────
    const bancoPendiente = banco.filter((b: any) => b.status === 'pending' || b.status === 'unmatched').length;

    // ── Stock crítico ─────────────────────────────────────────────────────
    const stockCritico = ingredientes.filter((i: any) =>
      Num.parse(i?.stock ?? i?.stockActual ?? 0) <= Num.parse(i?.min ?? i?.stockMinimo ?? 0)
    ).length;

    // ── Días consecutivos sin cierre ──────────────────────────────────────
    let diasSinCierre = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 1; i <= 7; i++) {
      const check = new Date(today); check.setDate(today.getDate() - i);
      const iso = `${check.getFullYear()}-${String(check.getMonth()+1).padStart(2,'0')}-${String(check.getDate()).padStart(2,'0')}`;
      const hasCierre = cierres.some(c => (c as any).date === iso);
      if (!hasCierre) diasSinCierre++; else break;
    }

    return { cierreHoy, ventaHoy, albsUrgentes, cobrosUrgentes, bancoPendiente, stockCritico, diasSinCierre };
  }, [data, hoy]);

  const items: { icon: any; label: string; value: string | number; tab: string; ok: boolean; urgent?: boolean }[] = [
    {
      icon: CalendarCheck,
      label: 'Caja hoy',
      value: pulso.ventaHoy !== null ? Num.fmt(pulso.ventaHoy) : 'Sin cerrar',
      tab: 'diario',
      ok: pulso.ventaHoy !== null,
      urgent: pulso.ventaHoy === null && pulso.diasSinCierre === 0,
    },
    {
      icon: TrendingDown,
      label: 'Pagos vencidos',
      value: pulso.albsUrgentes > 0 ? `${pulso.albsUrgentes} albarán${pulso.albsUrgentes > 1 ? 'es' : ''}` : '✓ Al día',
      tab: 'tesoreria',
      ok: pulso.albsUrgentes === 0,
      urgent: pulso.albsUrgentes > 0,
    },
    {
      icon: CreditCard,
      label: 'Cobros B2B',
      value: pulso.cobrosUrgentes > 0 ? `${pulso.cobrosUrgentes} vencido${pulso.cobrosUrgentes > 1 ? 's' : ''}` : '✓ Al día',
      tab: 'tesoreria',
      ok: pulso.cobrosUrgentes === 0,
      urgent: pulso.cobrosUrgentes > 0,
    },
    {
      icon: Building2,
      label: 'Banco',
      value: pulso.bancoPendiente > 0 ? `${pulso.bancoPendiente} sin conciliar` : '✓ Conciliado',
      tab: 'banco',
      ok: pulso.bancoPendiente === 0,
    },
    {
      icon: Package,
      label: 'Stock crítico',
      value: pulso.stockCritico > 0 ? `${pulso.stockCritico} producto${pulso.stockCritico > 1 ? 's' : ''}` : '✓ OK',
      tab: 'stock',
      ok: pulso.stockCritico === 0,
      urgent: pulso.stockCritico > 0,
    },
    ...(pulso.diasSinCierre > 1 ? [{
      icon: Clock,
      label: 'Días sin cierre',
      value: `${pulso.diasSinCierre} día${pulso.diasSinCierre > 1 ? 's' : ''}`,
      tab: 'diario',
      ok: false,
      urgent: true,
    }] : []),
  ];

  return (
    <div className="bg-white border border-slate-100 rounded-[2rem] shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-black text-slate-700 uppercase tracking-widest">Pulso del Día</span>
          <span className="text-[10px] text-slate-400 font-bold">{new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
        {items.filter(i => i.urgent).length > 0 && (
          <span className="text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-100 px-2 py-1 rounded-full uppercase tracking-widest animate-pulse">
            {items.filter(i => i.urgent).length} urgente{items.filter(i => i.urgent).length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-slate-100">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <motion.button
              key={i}
              whileHover={{ backgroundColor: '#f8fafc' }}
              onClick={() => onNavigate?.(item.tab)}
              className={cn(
                "flex flex-col items-start p-4 text-left transition-all group relative",
                !item.ok && item.urgent && "bg-rose-50/50"
              )}
            >
              <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center mb-2 transition-all group-hover:scale-110",
                item.ok ? "bg-emerald-100" : item.urgent ? "bg-rose-100" : "bg-amber-100"
              )}>
                <Icon className={cn("w-3.5 h-3.5", item.ok ? "text-emerald-600" : item.urgent ? "text-rose-600" : "text-amber-600")} />
              </div>
              <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-0.5">{item.label}</p>
              <p className={cn("text-xs font-black leading-tight", item.ok ? "text-slate-700" : item.urgent ? "text-rose-700" : "text-amber-700")}>
                {item.value}
              </p>
              <ExternalLink className="w-2.5 h-2.5 text-slate-300 group-hover:text-indigo-400 absolute top-3 right-3 transition-colors" />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

// ─── Componente principal ─────────────────────────────────────────────────────
export const DashboardView = ({ data, onNavigate }: DashboardViewProps) => {
  const [viewMode,        setViewMode]        = useState<'month'|'quarter'|'year'>('month');
  const [selectedMonth,   setSelectedMonth]   = useState(new Date().getMonth());
  const [selectedQuarter, setSelectedQuarter] = useState(Math.floor(new Date().getMonth()/3)+1);
  const [selectedYear,    setSelectedYear]    = useState(new Date().getFullYear());
  const [generalEmails,   setGeneralEmails]   = useState<any[]>([]);
  const [loadingEmails,   setLoadingEmails]   = useState(true);

  // Datos blindados
  const safeData     = data || {};
  const cierres      = Array.isArray(safeData.cierres)      ? safeData.cierres      : [];
  const albaranes    = Array.isArray(safeData.albaranes)    ? safeData.albaranes    : [];
  const facturas     = Array.isArray(safeData.facturas)     ? safeData.facturas     : [];
  const gastosFijos  = Array.isArray(safeData.gastos_fijos) ? safeData.gastos_fijos : [];
  const controlPagos = safeData.control_pagos || {};
  const ingredientes = Array.isArray(safeData.ingredientes) ? safeData.ingredientes : [];

  // Emails generales desde Supabase
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoadingEmails(true);
        const inboxUrl = safeData.config?.supabaseInboxUrl;
        const inboxKey = safeData.config?.supabaseInboxKey;
        if (!inboxUrl || !inboxKey) { setGeneralEmails([]); return; }
        const { data: rows } = await supabase.from('emails').select('*').order('date', { ascending: false }).limit(5);
        if (!cancelled) setGeneralEmails(rows || []);
      } catch { if (!cancelled) setGeneralEmails([]); }
      finally  { if (!cancelled) setLoadingEmails(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [safeData.config?.supabaseInboxUrl, safeData.config?.supabaseInboxKey]);

  // ── Cálculo de stats por periodo ────────────────────────────────────────
  const calculateStatsForPeriod = useCallback((month: number, quarter: number, year: number, mode: string) => {
    const inPeriod = (dateStr: string) => {
      const d = safeParseDate(dateStr);
      if (d.getFullYear() !== year) return false;
      if (mode === 'month')   return d.getMonth() === month;
      if (mode === 'quarter') return Math.floor(d.getMonth()/3)+1 === quarter;
      return true;
    };

    const periodCierres   = cierres.filter(c => inPeriod((c as any).date || ''));
    const periodAlbaranes = albaranes.filter(a => inPeriod(a.date || ''));
    const periodGastosFijos = gastosFijos.filter(g => {
      const monthKey = `pagos_${year}_${month+1}`;
      return (controlPagos as any)[monthKey]?.includes((g as any).id);
    });

    const byUnit = (unit: BusinessUnit) => {
      const unitCierres = periodCierres.filter(c => (c as any).unitId === unit || (!( c as any).unitId && unit==='REST'));
      return Num.round2(unitCierres.reduce((s,c) => s + Num.parse((c as any).totalVenta||0), 0));
    };

    const ingresos = {
      REST:  byUnit('REST'),
      DLV:   byUnit('DLV'),
      SHOP:  byUnit('SHOP'),
      CORP:  byUnit('CORP'),
      total: 0,
    };
    ingresos.total = Num.round2(ingresos.REST + ingresos.DLV + ingresos.SHOP + ingresos.CORP);

    const gastoComida  = periodAlbaranes.filter(a => !a.socio).reduce((s,a) => s + Num.parse(a.total), 0);
    const gastoBebida  = 0;
    const gastoPersonal = periodGastosFijos.filter((g:any) => g.type==='payroll').reduce((s,g:any) => s + Num.parse(g.amount||0), 0);
    const gastoFijoTotal = periodGastosFijos.filter((g:any) => g.type!=='income'&&g.type!=='grant').reduce((s,g:any) => s + Num.parse(g.amount||0), 0);

    const gastos = {
      comida: Num.round2(gastoComida),
      bebida: Num.round2(gastoBebida),
      personal: Num.round2(gastoPersonal),
      fijos: Num.round2(gastoFijoTotal),
      total: Num.round2(gastoComida + gastoPersonal + gastoFijoTotal),
    };

    const neto = Num.round2(ingresos.total - gastos.total);
    const foodCost  = ingresos.total > 0 ? (gastos.comida   / ingresos.total) * 100 : 0;
    const laborCost = ingresos.total > 0 ? (gastos.personal / ingresos.total) * 100 : 0;
    const primeCost = foodCost + laborCost;

    return { aggregated: { ingresos, gastos, neto, ratios: { foodCost: Num.round2(foodCost), laborCost: Num.round2(laborCost), primeCost: Num.round2(primeCost) } } };
  }, [cierres, albaranes, gastosFijos, controlPagos]);

  const stats = useMemo(() =>
    calculateStatsForPeriod(selectedMonth, selectedQuarter, selectedYear, viewMode).aggregated,
    [calculateStatsForPeriod, selectedMonth, selectedQuarter, selectedYear, viewMode]
  );

  const previousPeriodStats = useMemo(() => {
    let pM=selectedMonth, pQ=selectedQuarter, pY=selectedYear;
    if      (viewMode==='month')   { pM-=1; if(pM<0){pM=11;pY-=1;} }
    else if (viewMode==='quarter') { pQ-=1; if(pQ<1){pQ=4;pY-=1;}  }
    else                           { pY-=1; }
    return calculateStatsForPeriod(pM, pQ, pY, viewMode).aggregated;
  }, [calculateStatsForPeriod, viewMode, selectedMonth, selectedQuarter, selectedYear]);

  // ── Gráfico ───────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (viewMode==='month') {
      const days = Array.from({ length: new Date(selectedYear, selectedMonth+1, 0).getDate() },
        (_,i) => ({ name: String(i+1).padStart(2,'0'), venta:0 }));
      cierres.forEach(c => {
        const d = safeParseDate((c as any).date);
        if (d.getFullYear()===selectedYear && d.getMonth()===selectedMonth) {
          const idx = d.getDate()-1;
          if (days[idx]) days[idx].venta += Num.parse((c as any).totalVenta||0);
        }
      });
      return days;
    }
    if (viewMode==='quarter') {
      const start = (selectedQuarter-1)*3;
      return [0,1,2].map(offset => {
        const m = start+offset;
        const total = cierres.filter(c => {
          const d = safeParseDate((c as any).date);
          return d.getFullYear()===selectedYear && d.getMonth()===m;
        }).reduce((acc,c) => acc + Num.parse((c as any).totalVenta||0), 0);
        return { name: MONTHS_SHORT[m], venta: Num.round2(total) };
      });
    }
    return MONTHS_SHORT.map((name,m) => ({
      name,
      venta: Num.round2(cierres.filter(c => {
        const d = safeParseDate((c as any).date);
        return d.getFullYear()===selectedYear && d.getMonth()===m;
      }).reduce((acc,c) => acc+Num.parse((c as any).totalVenta||0), 0))
    }));
  }, [cierres, viewMode, selectedMonth, selectedQuarter, selectedYear]);

  // ── Proyección ────────────────────────────────────────────────────────────
  const projection = useMemo(() => {
    if (viewMode!=='month') return null;
    const today = new Date();
    if (today.getMonth()!==selectedMonth || today.getFullYear()!==selectedYear) return null;
    const dayOfMonth  = today.getDate();
    const daysInMonth = new Date(selectedYear, selectedMonth+1, 0).getDate();
    if (dayOfMonth===0) return null;
    const factor = daysInMonth / dayOfMonth;
    return { inc: Num.round2(stats.ingresos.total*factor), exp: Num.round2(stats.gastos.total*factor) };
  }, [stats, viewMode, selectedMonth, selectedYear]);

  // ── Navegación periodo ────────────────────────────────────────────────────
  const handlePrev = () => {
    if (viewMode==='month')   { setSelectedMonth(m  => { const nm=m-1;  if(nm<0) {setSelectedYear(y=>y-1);return 11;} return nm; }); }
    if (viewMode==='quarter') { setSelectedQuarter(q=> { const nq=q-1;  if(nq<1) {setSelectedYear(y=>y-1);return 4;}  return nq; }); }
    if (viewMode==='year')    { setSelectedYear(y=>y-1); }
  };
  const handleNext = () => {
    if (viewMode==='month')   { setSelectedMonth(m  => { const nm=m+1;  if(nm>11){setSelectedYear(y=>y+1);return 0;}  return nm; }); }
    if (viewMode==='quarter') { setSelectedQuarter(q=> { const nq=q+1;  if(nq>4) {setSelectedYear(y=>y+1);return 1;}  return nq; }); }
    if (viewMode==='year')    { setSelectedYear(y=>y+1); }
  };
  const periodLabel = viewMode==='month' ? `${MONTHS_FULL[selectedMonth]} ${selectedYear}` : viewMode==='quarter' ? `Q${selectedQuarter} ${selectedYear}` : String(selectedYear);

  // ── Helpers render ────────────────────────────────────────────────────────
  const lowStock           = ingredientes.filter((i:any) => Num.parse(i?.stock??i?.stockActual??0) <= Num.parse(i?.min??i?.stockMinimo??0));
  const facturasPendientes = facturas.filter((f:any) => !f?.paid && f?.status!=='draft' && f?.tipo!=='caja' && !String(f?.num||'').startsWith('Z'));
  // 🚨 Alerta privada: albaranes con IVA > 300€ sin socio asignado.
  // Síntoma de gasto personal colado por el CIF de la empresa sin trazabilidad
  // → peligro para el librito familiar. Agnès quiere verlo en el dashboard.
  const albaranesSinSocioIvaAlto = albaranes.filter((a:any) => {
    const sinSocio = !a?.socio || String(a.socio).trim() === '' || String(a.socio).trim().toLowerCase() === 'arume';
    const iva = Num.parse(a?.taxes ?? a?.iva ?? 0);
    return sinSocio && iva > 300;
  });
  const safeFixed = (val: number|undefined) => (Number.isFinite(val) ? (val||0).toLocaleString('es-ES', {minimumFractionDigits:1, maximumFractionDigits:1}) : '0.0');

  const renderTrend = (current: number, previous: number) => {
    if (!previous||previous===0) return null;
    const pct = ((current-previous)/Math.abs(previous))*100;
    const up  = pct>=0;
    return (
      <div className={cn('flex items-center gap-1 mt-1 text-[10px] font-black', up?'text-emerald-500':'text-rose-500')}>
        {up ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
        {Math.abs(Num.round2(pct)).toLocaleString('es-ES', {minimumFractionDigits:2, maximumFractionDigits:2})}% vs periodo anterior
      </div>
    );
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in pb-24 max-w-[1600px] mx-auto px-2 sm:px-0">

      {/* HEADER */}
      <div className="bg-slate-900 p-6 md:p-8 rounded-[2.5rem] flex flex-col md:flex-row items-center justify-between shadow-xl text-white overflow-hidden relative gap-6">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500"/>
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><SplitSquareHorizontal className="w-48 h-48"/></div>
        <div className="relative z-10 flex-1 text-center md:text-left">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight flex items-center justify-center md:justify-start gap-3">
            <LayoutDashboard className="w-8 h-8 text-indigo-400"/> Consolidado del Grupo
          </h2>
          <p className="text-[10px] sm:text-xs text-indigo-300 font-bold uppercase tracking-[0.2em] mt-2">Métricas de Rentabilidad Multilocal</p>
        </div>
        <div className="relative z-10 flex flex-col items-center gap-3 bg-slate-800/80 p-3 rounded-[2rem] border border-slate-700/50 w-full md:w-auto shadow-inner backdrop-blur-md">
          <div className="flex gap-1 bg-slate-900 p-1.5 rounded-[1.5rem] w-full justify-center shadow-inner border border-slate-800">
            {(['month','quarter','year'] as const).map(m => (
              <button key={m} onClick={()=>setViewMode(m)}
                className={cn('px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                  viewMode===m ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800')}>
                {m==='month'?'Mes':m==='quarter'?'Trim.':'Año'}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between w-full px-3 py-1">
            <button onClick={handlePrev} className="p-2.5 hover:bg-indigo-500 hover:text-white text-indigo-300 bg-slate-700 rounded-full transition shadow-sm"><ChevronLeft className="w-5 h-5"/></button>
            <span className="font-black text-sm uppercase tracking-widest text-white text-center whitespace-nowrap truncate w-32 sm:w-40">{periodLabel}</span>
            <button onClick={handleNext} className="p-2.5 hover:bg-indigo-500 hover:text-white text-indigo-300 bg-slate-700 rounded-full transition shadow-sm"><ChevronRight className="w-5 h-5"/></button>
          </div>
        </div>
      </div>

      {/* 🆕 PULSO DEL DÍA */}
      <PulsoDelDia data={data} onNavigate={onNavigate} />

      {/* DAILY BRIEFING — ahora con onNavigate conectado */}
      <DailyBriefing data={data} onNavigate={onNavigate} />

      {/* KPIs — Deeplinks: click lleva al módulo detalle */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button type="button" onClick={() => onNavigate?.('diario')}
          className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-center text-left hover:border-indigo-300 hover:shadow-md transition group">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between">
            Ingresos Totales
            <Wallet className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition"/>
          </p>
          <h3 className="text-3xl font-black text-slate-800 mt-1 tracking-tighter">{Num.fmt(stats.ingresos.total||0)}</h3>
          {renderTrend(stats.ingresos.total, previousPeriodStats.ingresos.total)}
          <span className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-widest group-hover:text-indigo-500 transition">Ver Caja Diaria →</span>
        </button>
        <button type="button" onClick={() => onNavigate?.('compras')}
          className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-center text-left hover:border-rose-300 hover:shadow-md transition group">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between">
            Gastos Operativos
            <TrendingDown className="w-4 h-4 text-slate-300 group-hover:text-rose-500 transition"/>
          </p>
          <h3 className="text-3xl font-black text-slate-800 mt-1 tracking-tighter">{Num.fmt(stats.gastos.total||0)}</h3>
          {renderTrend(stats.gastos.total, previousPeriodStats.gastos.total)}
          <span className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-widest group-hover:text-rose-500 transition">Ver Compras →</span>
        </button>
        <button type="button" onClick={() => onNavigate?.('tesoreria')}
          className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden flex flex-col justify-center text-left hover:shadow-md transition group">
          <div className={cn('absolute right-0 top-0 w-2 h-full', stats.neto>=0?'bg-emerald-400':'bg-rose-400')}/>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Margen Neto (Cash)</p>
          <h3 className={cn('text-3xl font-black mt-1 tracking-tighter', stats.neto>=0?'text-emerald-600':'text-rose-600')}>{Num.fmt(stats.neto||0)}</h3>
          {renderTrend(stats.neto, previousPeriodStats.neto)}
          <span className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-widest group-hover:text-indigo-500 transition">Ver Tesorería →</span>
        </button>
        <button type="button" onClick={() => onNavigate?.('informes')}
          className="bg-indigo-600 p-6 rounded-[2rem] shadow-md text-white flex flex-col justify-center relative overflow-hidden text-left hover:bg-indigo-700 transition group">
          <Sparkles className="absolute -right-4 -bottom-4 w-20 h-20 text-white opacity-10"/>
          <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1">Prime Cost (Ideal 60%)</p>
          <h3 className="text-3xl font-black mt-1 tracking-tighter">{safeFixed(stats.ratios.primeCost)}%</h3>
          <p className="text-[10px] font-bold text-indigo-200 mt-2 uppercase tracking-widest">F.C: {safeFixed(stats.ratios.foodCost)}% | L.C: {safeFixed(stats.ratios.laborCost)}%</p>
          <span className="text-[9px] font-bold text-indigo-200 mt-2 uppercase tracking-widest group-hover:text-white transition">Ver Informes →</span>
        </button>
      </div>

      {/* PROYECCIÓN IA */}
      {projection && (
        <div className="bg-gradient-to-br from-slate-900 to-indigo-900 p-6 rounded-[2rem] shadow-xl text-white flex flex-col md:flex-row items-center justify-between gap-6 border border-indigo-500/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md">
              <Sparkles className="w-6 h-6 text-amber-300"/>
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-indigo-200">IA Predictiva Arume</h3>
              <p className="text-lg font-bold">Proyección a final de mes</p>
            </div>
          </div>
          <div className="flex gap-6 text-right">
            <div><p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Ingresos Est.</p><p className="text-xl font-black text-emerald-400">{Num.fmt(projection.inc)}</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Gastos Est.</p><p className="text-xl font-black text-rose-400">{Num.fmt(projection.exp)}</p></div>
          </div>
        </div>
      )}

      {/* GRÁFICO */}
      <div className="bg-white p-6 md:p-8 rounded-[3rem] border border-slate-100 shadow-sm w-full overflow-hidden">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-6">
          <TrendingUp className="w-5 h-5 text-indigo-500"/>
          Evolución de Ventas — {periodLabel}
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%" minHeight={200}>
            <AreaChart data={chartData} margin={{top:5,right:5,left:-20,bottom:0}}>
              <defs>
                <linearGradient id="gradV" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4f46e5" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
              <XAxis dataKey="name" tick={{fontSize:10,fill:'#94a3b8',fontWeight:'bold'}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:10,fill:'#94a3b8',fontWeight:'bold'}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
              <Tooltip contentStyle={{borderRadius:16,border:'none',boxShadow:'0 10px 15px -3px rgba(0,0,0,0.1)'}} formatter={(v:number)=>[Num.fmt(v),'Ventas']} labelStyle={{fontWeight:'black',color:'#1e293b'}}/>
              <Area type="monotone" dataKey="venta" stroke="#4f46e5" strokeWidth={3} fill="url(#gradV)" activeDot={{r:5,strokeWidth:0}}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* PANEL INFERIOR: Gastos + Unidades + Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* DESGLOSE GASTOS */}
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">Desglose de Gastos</h3>
          <div className="space-y-4">
            {[
              { label:'Materia Prima', val:stats.gastos.comida,   color:'bg-emerald-400', icon:ChefHat   },
              { label:'Bebidas',       val:stats.gastos.bebida,   color:'bg-teal-400',    icon:Coffee    },
              { label:'Personal',      val:stats.gastos.personal, color:'bg-indigo-400',  icon:Users     },
              { label:'Gastos Fijos',  val:stats.gastos.fijos,    color:'bg-rose-400',    icon:Zap       },
            ].map(g => {
              const pct = stats.gastos.total > 0 ? (g.val / stats.gastos.total) * 100 : 0;
              const Icon = g.icon;
              return (
                <div key={g.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2"><Icon className="w-3.5 h-3.5 text-slate-400"/><span className="text-xs font-bold text-slate-600">{g.label}</span></div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-700 tabular-nums">{Num.fmt(g.val)}</span>
                      <span className="text-[9px] text-slate-400 font-bold w-8 text-right">{Num.round2(pct).toLocaleString('es-ES', {minimumFractionDigits:2, maximumFractionDigits:2})}%</span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all duration-500', g.color)} style={{width:`${Math.min(pct,100)}%`}}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* INGRESOS POR UNIDAD */}
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">Ingresos por Unidad</h3>
          <div className="space-y-3">
            {BUSINESS_UNITS.filter(u => u.id!=='CORP').map(unit => {
              const val = stats.ingresos[unit.id as keyof typeof stats.ingresos] as number || 0;
              const pct = stats.ingresos.total > 0 ? (val / stats.ingresos.total) * 100 : 0;
              const Icon = unit.icon;
              return (
                <button key={unit.id} onClick={() => onNavigate?.('diario')}
                  className="w-full text-left group hover:bg-slate-50 rounded-2xl p-2 -mx-2 transition">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center', unit.bg)}>
                        <Icon className={cn('w-3 h-3', unit.color)}/>
                      </div>
                      <span className="text-xs font-bold text-slate-600">{unit.name}</span>
                    </div>
                    <span className="text-xs font-black text-slate-700 tabular-nums">{Num.fmt(val)}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{width:`${Math.min(pct,100)}%`, backgroundColor: unit.hex}}/>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ALERTAS ACCIONABLES */}
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col gap-3">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Requiere Acción</h3>
          <div className="flex-1 space-y-2">
            {lowStock.length > 0 && (
              <button onClick={() => onNavigate?.('stock')}
                className="w-full flex items-center gap-3 p-3 bg-rose-50 rounded-2xl border border-rose-100 text-left hover:bg-rose-100 transition group">
                <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-rose-800 truncate">{lowStock.length} producto{lowStock.length>1?'s':''} en mínimos</p>
                  <p className="text-[9px] text-rose-500 truncate">{lowStock.slice(0,2).map((i:any)=>i.n||i.nombre).join(', ')}{lowStock.length>2?'...':''}</p>
                </div>
                <ExternalLink className="w-3 h-3 text-rose-400 group-hover:text-rose-600 flex-shrink-0"/>
              </button>
            )}
            {facturasPendientes.length > 0 && (
              <button onClick={() => onNavigate?.('tesoreria')}
                className="w-full flex items-center gap-3 p-3 bg-amber-50 rounded-2xl border border-amber-100 text-left hover:bg-amber-100 transition group">
                <Wallet className="w-4 h-4 text-amber-500 flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-800">{facturasPendientes.length} cobros pendientes</p>
                  <p className="text-[9px] text-amber-500">{Num.fmt(facturasPendientes.reduce((s:number,f:any)=>s+Num.parse(f.total),0))} por cobrar</p>
                </div>
                <ExternalLink className="w-3 h-3 text-amber-400 group-hover:text-amber-600 flex-shrink-0"/>
              </button>
            )}
            {albaranesSinSocioIvaAlto.length > 0 && (
              <button onClick={() => onNavigate?.('albaranes')}
                className="w-full flex items-center gap-3 p-3 bg-fuchsia-50 rounded-2xl border border-fuchsia-200 text-left hover:bg-fuchsia-100 transition group">
                <AlertTriangle className="w-4 h-4 text-fuchsia-500 flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-fuchsia-800 truncate">
                    {albaranesSinSocioIvaAlto.length} albarán{albaranesSinSocioIvaAlto.length>1?'es':''} con IVA alto sin socio
                  </p>
                  <p className="text-[9px] text-fuchsia-500 truncate">
                    Revisa si son gastos personales · {Num.fmt(albaranesSinSocioIvaAlto.reduce((s:number,a:any)=>s+Num.parse(a?.taxes??a?.iva??0),0))} IVA
                  </p>
                </div>
                <ExternalLink className="w-3 h-3 text-fuchsia-400 group-hover:text-fuchsia-600 flex-shrink-0"/>
              </button>
            )}
            {lowStock.length === 0 && facturasPendientes.length === 0 && albaranesSinSocioIvaAlto.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3 opacity-50"/>
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Todo al día</p>
                <p className="text-[9px] text-slate-400 mt-1">Sin alertas pendientes</p>
              </div>
            )}
            {/* Accesos rápidos siempre visibles */}
            <div className="pt-2 border-t border-slate-100">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Accesos Rápidos</p>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: 'Caja', tab: 'diario',    icon: CalendarCheck },
                  { label: 'Banco', tab: 'banco',    icon: Building2     },
                  { label: 'Compras',tab:'compras',  icon: TrendingDown  },
                ].map(a => {
                  const Icon = a.icon;
                  return (
                    <button key={a.tab} onClick={() => onNavigate?.(a.tab)}
                      className="flex flex-col items-center gap-1 p-2 bg-slate-50 hover:bg-indigo-50 rounded-xl border border-slate-100 hover:border-indigo-200 transition group">
                      <Icon className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500"/>
                      <span className="text-[9px] font-black text-slate-500 group-hover:text-indigo-600">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* EMAILS GENERALES */}
      {(loadingEmails || generalEmails.length > 0) && (
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Mail className="w-4 h-4 text-indigo-400"/>
            Bandeja de Entrada General
          </h3>
          {loadingEmails ? (
            <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin"/><span className="text-xs font-bold">Cargando correos...</span></div>
          ) : (
            <div className="space-y-2">
              {generalEmails.map((e,i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100 text-xs">
                  <Mail className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5"/>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-700 truncate">{e.from||e.subject||'Sin asunto'}</p>
                    <p className="text-slate-400 text-[10px] mt-0.5">{e.date ? new Date(e.date).toLocaleDateString('es-ES') : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
};
