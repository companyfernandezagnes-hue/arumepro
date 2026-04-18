import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Wallet, ArrowUpRight, ArrowDownRight,
  TrendingDown, TrendingUp, Building2, Hotel, ShoppingBag, Users, SplitSquareHorizontal,
  ChevronLeft, ChevronRight, CheckCircle2, Mail, Loader2,
  Sparkles, Coffee, ChefHat, AlertTriangle, Zap,
  CreditCard, Package, Clock, ExternalLink, CalendarCheck,
  Landmark, Receipt, Bell, Plus, Upload,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Num, ArumeEngine } from '../services/engine';
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

    const gastoOtros = periodAlbaranes.filter(a => a.socio).reduce((s,a) => s + Num.parse(a.total), 0);

    const gastos = {
      comida: Num.round2(gastoComida),
      bebida: Num.round2(gastoBebida),
      otros: Num.round2(gastoOtros),
      personal: Num.round2(gastoPersonal),
      fijos: Num.round2(gastoFijoTotal),
      total: Num.round2(gastoComida + gastoOtros + gastoPersonal + gastoFijoTotal),
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

  // ── Saldo banco en vivo ───────────────────────────────────────────────────
  const saldoBanco = useMemo(() => {
    const saldoInicial = Num.parse((safeData.config as any)?.saldoInicial || 0);
    const movs = Array.isArray(safeData.banco) ? safeData.banco : [];
    return saldoInicial + movs.reduce((s, m: any) => s + Num.parse(m.amount || 0), 0);
  }, [safeData.banco, safeData.config]);

  // ── Ticket medio del periodo ──────────────────────────────────────────────
  const ticketMedio = useMemo(() => {
    const periodCierres = cierres.filter((c: any) => {
      const d = safeParseDate(c.date);
      if (d.getFullYear() !== selectedYear) return false;
      if (viewMode === 'month')   return d.getMonth() === selectedMonth;
      if (viewMode === 'quarter') return Math.floor(d.getMonth()/3)+1 === selectedQuarter;
      return true;
    });
    const totalVenta = periodCierres.reduce((s, c: any) => s + Num.parse(c.totalVenta || c.totalVentas || 0), 0);
    const totalTickets = periodCierres.reduce((s, c: any) => s + Num.parse(c.numTickets || c.tickets || 0), 0);
    if (totalTickets > 0) return Num.round2(totalVenta / totalTickets);
    // Si no hay nº de tickets, fallback: ventas / días con cierre
    return periodCierres.length > 0 ? Num.round2(totalVenta / periodCierres.length) : 0;
  }, [cierres, viewMode, selectedMonth, selectedQuarter, selectedYear]);

  // ── Facturas que vencen hoy o ya vencidas ────────────────────────────────
  const hoyISO = new Date().toISOString().slice(0, 10);
  const facturasHoy = facturas.filter((f: any) => {
    if (f.paid) return false;
    if (f.tipo === 'caja') return false;
    const due = f.dueDate || f.date;
    return due && due <= hoyISO;
  });
  const importeHoy = facturasHoy.reduce((s, f: any) => s + Num.parse(f.total || 0), 0);

  // ── Saludo según hora del día ────────────────────────────────────────────
  const horaActual = new Date().getHours();
  const saludo = horaActual < 6 ? 'Buenas noches' : horaActual < 13 ? 'Buenos días' : horaActual < 20 ? 'Buenas tardes' : 'Buenas noches';
  const fechaHoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
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

      {/* ═════════════ HERO OSCURO — estilo editorial Arume ═════════════ */}
      <div className="relative overflow-hidden rounded-3xl bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] p-6 md:p-10 shadow-[0_12px_40px_rgba(11,11,12,0.2)]">
        {/* acento dorado fino arriba */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[color:var(--arume-gold)]/80"/>
        {/* patrón sutil decorativo */}
        <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full bg-[color:var(--arume-gold)]/5 pointer-events-none"/>

        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          {/* Saludo + fecha */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--arume-gold)]">Arume Pro</p>
            <h1 className="mt-2 font-serif text-3xl md:text-5xl font-semibold tracking-tight">{saludo}</h1>
            <p className="mt-2 text-sm text-white/60 capitalize">{fechaHoy}</p>
          </div>

          {/* Selector de periodo, limpio */}
          <div className="flex flex-col gap-2 md:items-end">
            <div className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1 w-fit">
              {(['month','quarter','year'] as const).map(m => (
                <button key={m} onClick={()=>setViewMode(m)}
                  className={cn('px-4 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] transition',
                    viewMode===m ? 'bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)]' : 'text-white/60 hover:text-white')}>
                  {m==='month'?'Mes':m==='quarter'?'Trimestre':'Año'}
                </button>
              ))}
            </div>
            <div className="inline-flex items-center gap-3">
              <button onClick={handlePrev} className="p-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition"><ChevronLeft className="w-4 h-4"/></button>
              <span className="font-serif text-lg font-semibold tracking-tight capitalize min-w-[140px] text-center">{periodLabel}</span>
              <button onClick={handleNext} className="p-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition"><ChevronRight className="w-4 h-4"/></button>
            </div>
          </div>
        </div>

        {/* KPIs dentro del hero — 4 métricas clave con separadores verticales */}
        <div className="relative mt-8 grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 rounded-2xl overflow-hidden">
          <button onClick={() => onNavigate?.('diario')} className="bg-[color:var(--arume-night)] p-5 text-left hover:bg-white/5 transition group">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Ingresos</p>
            <p className="mt-2 font-serif text-2xl md:text-3xl font-semibold tabular-nums">{Num.fmt(stats.ingresos.total||0)}</p>
            {renderTrend(stats.ingresos.total, previousPeriodStats.ingresos.total)}
          </button>
          <button onClick={() => onNavigate?.('banco')} className="bg-[color:var(--arume-night)] p-5 text-left hover:bg-white/5 transition group">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Saldo banco</p>
            <p className={cn('mt-2 font-serif text-2xl md:text-3xl font-semibold tabular-nums', saldoBanco < 0 && 'text-rose-300')}>{Num.fmt(saldoBanco)}</p>
            <p className="mt-1 text-[10px] text-white/40">En vivo</p>
          </button>
          <button onClick={() => onNavigate?.('tesoreria')} className="bg-[color:var(--arume-night)] p-5 text-left hover:bg-white/5 transition group">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Margen neto</p>
            <p className={cn('mt-2 font-serif text-2xl md:text-3xl font-semibold tabular-nums', stats.neto >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{Num.fmt(stats.neto||0)}</p>
            {renderTrend(stats.neto, previousPeriodStats.neto)}
          </button>
          <button onClick={() => onNavigate?.('informes')} className="bg-[color:var(--arume-night)] p-5 text-left hover:bg-white/5 transition group">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Prime Cost <span className="text-white/30">· ideal 60%</span></p>
            <p className={cn('mt-2 font-serif text-2xl md:text-3xl font-semibold tabular-nums',
              stats.ratios.primeCost <= 60 ? 'text-emerald-300' : stats.ratios.primeCost <= 70 ? 'text-amber-300' : 'text-rose-300')}>
              {safeFixed(stats.ratios.primeCost)}%
            </p>
            <p className="mt-1 text-[10px] text-white/40">F.C {safeFixed(stats.ratios.foodCost)}% · L.C {safeFixed(stats.ratios.laborCost)}%</p>
          </button>
        </div>
      </div>

      {/* ═════════════ HOY TOCA — alertas accionables solo si hay algo ═════════════ */}
      {(facturasHoy.length > 0 || lowStock.length > 0 || saldoBanco < 1000) && (
        <div className="bg-[color:var(--arume-paper)] border border-[color:var(--arume-gray-200)] rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[color:var(--arume-accent)]"/>
            <h3 className="font-serif text-lg font-semibold tracking-tight">Hoy toca</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {facturasHoy.length > 0 && (
              <button onClick={() => onNavigate?.('compras')}
                className="text-left bg-white border border-[color:var(--arume-gray-100)] rounded-xl p-4 hover:border-[color:var(--arume-accent)]/30 hover:shadow-sm transition">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-accent)]">Pagos vencidos · {facturasHoy.length}</p>
                <p className="mt-2 font-serif text-2xl font-semibold tabular-nums">{Num.fmt(importeHoy)}</p>
                <p className="mt-1 text-[11px] text-[color:var(--arume-gray-500)]">Facturas que vencen hoy o antes →</p>
              </button>
            )}
            {lowStock.length > 0 && (
              <button onClick={() => onNavigate?.('stock')}
                className="text-left bg-white border border-[color:var(--arume-gray-100)] rounded-xl p-4 hover:border-[color:var(--arume-warn)]/30 hover:shadow-sm transition">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-warn)]">Stock bajo · {lowStock.length}</p>
                <p className="mt-2 font-serif text-2xl font-semibold truncate">{lowStock.slice(0,2).map((i:any)=>i.n||i.nombre).join(', ')}{lowStock.length>2?'…':''}</p>
                <p className="mt-1 text-[11px] text-[color:var(--arume-gray-500)]">Revisar y pedir →</p>
              </button>
            )}
            {saldoBanco < 1000 && saldoBanco >= 0 && (
              <button onClick={() => onNavigate?.('banco')}
                className="text-left bg-white border border-[color:var(--arume-gray-100)] rounded-xl p-4 hover:border-[color:var(--arume-warn)]/30 hover:shadow-sm transition">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-warn)]">Saldo ajustado</p>
                <p className="mt-2 font-serif text-2xl font-semibold tabular-nums">{Num.fmt(saldoBanco)}</p>
                <p className="mt-1 text-[11px] text-[color:var(--arume-gray-500)]">Menos de 1.000€ en banco →</p>
              </button>
            )}
            {saldoBanco < 0 && (
              <button onClick={() => onNavigate?.('banco')}
                className="text-left bg-white border border-[color:var(--arume-danger)]/30 rounded-xl p-4 hover:shadow-sm transition">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-danger)]">Saldo negativo</p>
                <p className="mt-2 font-serif text-2xl font-semibold tabular-nums text-[color:var(--arume-danger)]">{Num.fmt(saldoBanco)}</p>
                <p className="mt-1 text-[11px] text-[color:var(--arume-gray-500)]">Urgente — revisar banco →</p>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═════════════ ACCIONES RÁPIDAS ═════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button onClick={() => onNavigate?.('diario')}
          className="flex items-center gap-3 bg-white border border-[color:var(--arume-gray-100)] rounded-xl px-4 py-3 hover:border-[color:var(--arume-ink)]/30 hover:shadow-sm transition group">
          <div className="w-10 h-10 rounded-full bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] flex items-center justify-center group-hover:bg-[color:var(--arume-gold)] group-hover:text-[color:var(--arume-ink)] transition">
            <Wallet className="w-4 h-4"/>
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm">Cerrar caja</p>
            <p className="text-[11px] text-[color:var(--arume-gray-500)]">Fin del día</p>
          </div>
        </button>
        <button onClick={() => onNavigate?.('importador')}
          className="flex items-center gap-3 bg-white border border-[color:var(--arume-gray-100)] rounded-xl px-4 py-3 hover:border-[color:var(--arume-ink)]/30 hover:shadow-sm transition group">
          <div className="w-10 h-10 rounded-full bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] flex items-center justify-center group-hover:bg-[color:var(--arume-gold)] group-hover:text-[color:var(--arume-ink)] transition">
            <Upload className="w-4 h-4"/>
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm">Subir factura</p>
            <p className="text-[11px] text-[color:var(--arume-gray-500)]">PDF o foto</p>
          </div>
        </button>
        <button onClick={() => onNavigate?.('banco')}
          className="flex items-center gap-3 bg-white border border-[color:var(--arume-gray-100)] rounded-xl px-4 py-3 hover:border-[color:var(--arume-ink)]/30 hover:shadow-sm transition group">
          <div className="w-10 h-10 rounded-full bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] flex items-center justify-center group-hover:bg-[color:var(--arume-gold)] group-hover:text-[color:var(--arume-ink)] transition">
            <Landmark className="w-4 h-4"/>
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm">Conciliar banco</p>
            <p className="text-[11px] text-[color:var(--arume-gray-500)]">Cuadrar movs.</p>
          </div>
        </button>
        <button onClick={() => onNavigate?.('marketing')}
          className="flex items-center gap-3 bg-white border border-[color:var(--arume-gray-100)] rounded-xl px-4 py-3 hover:border-[color:var(--arume-ink)]/30 hover:shadow-sm transition group">
          <div className="w-10 h-10 rounded-full bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] flex items-center justify-center group-hover:scale-105 transition">
            <Sparkles className="w-4 h-4"/>
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm">Nuevo post</p>
            <p className="text-[11px] text-[color:var(--arume-gray-500)]">Agente Auto</p>
          </div>
        </button>
      </div>

      {/* ═════════════ MÉTRICAS OPERATIVAS ═════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-[color:var(--arume-gray-100)] rounded-2xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Ticket medio</p>
          <p className="mt-2 font-serif text-2xl font-semibold tabular-nums">{Num.fmt(ticketMedio)}</p>
          <p className="mt-1 text-[11px] text-[color:var(--arume-gray-400)]">Promedio periodo</p>
        </div>
        <div className="bg-white border border-[color:var(--arume-gray-100)] rounded-2xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Coste laboral</p>
          <p className={cn('mt-2 font-serif text-2xl font-semibold tabular-nums',
            stats.ratios.laborCost <= 30 ? 'text-[color:var(--arume-ok)]' : stats.ratios.laborCost <= 40 ? 'text-[color:var(--arume-warn)]' : 'text-[color:var(--arume-danger)]')}>
            {safeFixed(stats.ratios.laborCost)}%
          </p>
          <p className="mt-1 text-[11px] text-[color:var(--arume-gray-400)]">Ideal &lt;30%</p>
        </div>
        <div className="bg-white border border-[color:var(--arume-gray-100)] rounded-2xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Food cost</p>
          <p className={cn('mt-2 font-serif text-2xl font-semibold tabular-nums',
            stats.ratios.foodCost <= 30 ? 'text-[color:var(--arume-ok)]' : stats.ratios.foodCost <= 35 ? 'text-[color:var(--arume-warn)]' : 'text-[color:var(--arume-danger)]')}>
            {safeFixed(stats.ratios.foodCost)}%
          </p>
          <p className="mt-1 text-[11px] text-[color:var(--arume-gray-400)]">Ideal &lt;30%</p>
        </div>
        <div className="bg-white border border-[color:var(--arume-gray-100)] rounded-2xl p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Gastos totales</p>
          <p className="mt-2 font-serif text-2xl font-semibold tabular-nums">{Num.fmt(stats.gastos.total||0)}</p>
          {renderTrend(stats.gastos.total, previousPeriodStats.gastos.total)}
        </div>
      </div>

      {/* 🆕 PULSO DEL DÍA */}
      <PulsoDelDia data={data} onNavigate={onNavigate} />

      {/* DAILY BRIEFING */}
      <DailyBriefing data={data} onNavigate={onNavigate} />

      {/* PROYECCIÓN IA — rediseño night + dorado */}
      {projection && (
        <div className="relative overflow-hidden bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] p-6 rounded-2xl border border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="absolute top-0 left-0 w-[2px] h-full bg-[color:var(--arume-gold)]"/>
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-[color:var(--arume-gold)]/15 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[color:var(--arume-gold)]"/>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gold)]">IA Predictiva</p>
              <p className="font-serif text-xl font-semibold mt-0.5">Proyección a fin de mes</p>
            </div>
          </div>
          <div className="flex gap-8 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-semibold">Ingresos est.</p>
              <p className="font-serif text-2xl font-semibold text-emerald-300 tabular-nums mt-1">{Num.fmt(projection.inc)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-semibold">Gastos est.</p>
              <p className="font-serif text-2xl font-semibold text-rose-300 tabular-nums mt-1">{Num.fmt(projection.exp)}</p>
            </div>
          </div>
        </div>
      )}

      {/* GRÁFICO — tarjeta clara, tipografía editorial */}
      <div className="bg-white p-6 md:p-8 rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm w-full overflow-hidden">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Evolución de ventas</p>
            <h3 className="font-serif text-xl font-semibold capitalize mt-1">{periodLabel}</h3>
          </div>
          <TrendingUp className="w-5 h-5 text-[color:var(--arume-gray-400)]"/>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%" minHeight={200}>
            <AreaChart data={chartData} margin={{top:5,right:5,left:-20,bottom:0}}>
              <defs>
                <linearGradient id="gradV" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#C9A86A" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="#C9A86A" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ECECE9"/>
              <XAxis dataKey="name" tick={{fontSize:11,fill:'#8C8C84',fontWeight:600}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11,fill:'#8C8C84',fontWeight:600}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
              <Tooltip contentStyle={{borderRadius:12,border:'1px solid #ECECE9',boxShadow:'0 12px 40px rgba(11,11,12,0.12)',background:'#FAFAF7'}} formatter={(v:number)=>[Num.fmt(v),'Ventas']} labelStyle={{fontWeight:600,color:'#0B0B0C'}}/>
              <Area type="monotone" dataKey="venta" stroke="#0B0B0C" strokeWidth={2.5} fill="url(#gradV)" activeDot={{r:5,strokeWidth:0,fill:'#C9A86A'}}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* PANEL INFERIOR: Gastos + Unidades + Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* DESGLOSE GASTOS */}
        <div className="bg-white p-6 md:p-8 rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Desglose</p>
          <h3 className="font-serif text-xl font-semibold mb-5 mt-1">Gastos por categoría</h3>
          <div className="space-y-4">
            {[
              { label:'Materia Prima', val:stats.gastos.comida,   color:'bg-emerald-400', icon:ChefHat   },
              { label:'Bebidas',       val:stats.gastos.bebida,   color:'bg-teal-400',    icon:Coffee    },
              { label:'Otros',         val:stats.gastos.otros,    color:'bg-amber-400',   icon:Package   },
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
        <div className="bg-white p-6 md:p-8 rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Ingresos</p>
          <h3 className="font-serif text-xl font-semibold mb-5 mt-1">Por unidad de negocio</h3>
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
        <div className="bg-white p-6 md:p-8 rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm flex flex-col gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Alertas</p>
            <h3 className="font-serif text-xl font-semibold mt-1">Requiere acción</h3>
          </div>
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

      {/* COMPARATIVA INTERANUAL */}
      {(() => {
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1; // 1-12
        const prevYear = currentYear - 1;

        // Current year YTD (months 1..currentMonth)
        let cytdIngresos = 0, cytdGastos = 0, cytdNeto = 0;
        for (let m = 1; m <= currentMonth; m++) {
          const p = ArumeEngine.getProfit(data, m, currentYear);
          cytdIngresos += p.ingresos?.total ?? 0;
          cytdGastos   += p.gastos?.total ?? 0;
          cytdNeto     += p.neto ?? 0;
        }

        // Previous year same period (months 1..currentMonth)
        let pySameIngresos = 0, pySameGastos = 0, pySameNeto = 0;
        for (let m = 1; m <= currentMonth; m++) {
          const p = ArumeEngine.getProfit(data, m, prevYear);
          pySameIngresos += p.ingresos?.total ?? 0;
          pySameGastos   += p.gastos?.total ?? 0;
          pySameNeto     += p.neto ?? 0;
        }

        // Previous year full (months 1..12)
        let pyFullIngresos = 0, pyFullGastos = 0, pyFullNeto = 0;
        for (let m = 1; m <= 12; m++) {
          const p = ArumeEngine.getProfit(data, m, prevYear);
          pyFullIngresos += p.ingresos?.total ?? 0;
          pyFullGastos   += p.gastos?.total ?? 0;
          pyFullNeto     += p.neto ?? 0;
        }

        const cytdMargen = cytdIngresos > 0 ? (cytdNeto / cytdIngresos) * 100 : 0;
        const pySameMargen = pySameIngresos > 0 ? (pySameNeto / pySameIngresos) * 100 : 0;
        const pyFullMargen = pyFullIngresos > 0 ? (pyFullNeto / pyFullIngresos) * 100 : 0;

        const pctChangeIng = pySameIngresos !== 0 ? ((cytdIngresos - pySameIngresos) / Math.abs(pySameIngresos)) * 100 : 0;
        const pctChangeGas = pySameGastos !== 0 ? ((cytdGastos - pySameGastos) / Math.abs(pySameGastos)) * 100 : 0;
        const pctChangeNeto = pySameNeto !== 0 ? ((cytdNeto - pySameNeto) / Math.abs(pySameNeto)) * 100 : 0;

        const rows = [
          { label: `${currentYear} (hasta hoy)`, ingresos: cytdIngresos, gastos: cytdGastos, neto: cytdNeto, margen: cytdMargen, highlight: true },
          { label: `${prevYear} (mismo periodo)`, ingresos: pySameIngresos, gastos: pySameGastos, neto: pySameNeto, margen: pySameMargen, highlight: false },
          { label: `${prevYear} (año completo)`, ingresos: pyFullIngresos, gastos: pyFullGastos, neto: pyFullNeto, margen: pyFullMargen, highlight: false },
        ];

        const renderPctBadge = (pct: number, invertColor?: boolean) => {
          const positive = invertColor ? pct <= 0 : pct >= 0;
          return (
            <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-black rounded-full px-2 py-0.5',
              positive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
            )}>
              {pct >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(Num.round2(pct)).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
            </span>
          );
        };

        return (
          <div className="bg-white p-6 md:p-8 rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Comparativa</p>
                <h3 className="font-serif text-xl font-semibold mt-1">Año actual vs anterior</h3>
              </div>
              {pySameIngresos > 0 && (
                <div className={cn('flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-full',
                  pctChangeNeto >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                )}>
                  {pctChangeNeto >= 0
                    ? <TrendingUp className="w-4 h-4" />
                    : <TrendingDown className="w-4 h-4" />
                  }
                  {pctChangeNeto >= 0 ? 'Mejorando' : 'Empeorando'} vs {prevYear}
                </div>
              )}
            </div>
            <div className="overflow-x-auto -mx-2 px-2" style={{ WebkitOverflowScrolling: 'touch' }}>
              <table className="w-full text-left" style={{ minWidth: '520px' }}>
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-[10px] font-black text-slate-400 uppercase tracking-widest pb-3 pr-4">Periodo</th>
                    <th className="text-[10px] font-black text-slate-400 uppercase tracking-widest pb-3 pr-4 text-right">Ingresos</th>
                    <th className="text-[10px] font-black text-slate-400 uppercase tracking-widest pb-3 pr-4 text-right">Gastos</th>
                    <th className="text-[10px] font-black text-slate-400 uppercase tracking-widest pb-3 pr-4 text-right">Beneficio Neto</th>
                    <th className="text-[10px] font-black text-slate-400 uppercase tracking-widest pb-3 text-right">Margen %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className={cn('border-b border-slate-50 last:border-0', row.highlight && 'bg-indigo-50/40')}>
                      <td className={cn('py-3 pr-4 text-xs font-bold whitespace-nowrap', row.highlight ? 'text-indigo-700' : 'text-slate-600')}>
                        {row.label}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-xs font-black text-slate-700 tabular-nums">{Num.fmt(Num.round2(row.ingresos))}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-xs font-black text-slate-700 tabular-nums">{Num.fmt(Num.round2(row.gastos))}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className={cn('text-xs font-black tabular-nums', row.neto >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {Num.fmt(Num.round2(row.neto))}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className={cn('text-xs font-black tabular-nums', row.margen >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {Num.round2(row.margen).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                        </span>
                      </td>
                    </tr>
                  ))}
                  {/* Row for % change */}
                  {pySameIngresos > 0 && (
                    <tr className="bg-slate-50/50">
                      <td className="py-3 pr-4 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">
                        % Variación
                      </td>
                      <td className="py-3 pr-4 text-right">{renderPctBadge(pctChangeIng)}</td>
                      <td className="py-3 pr-4 text-right">{renderPctBadge(pctChangeGas, true)}</td>
                      <td className="py-3 pr-4 text-right">{renderPctBadge(pctChangeNeto)}</td>
                      <td className="py-3 text-right">
                        <span className={cn('text-[10px] font-black tabular-nums', cytdMargen >= pySameMargen ? 'text-emerald-600' : 'text-rose-600')}>
                          {cytdMargen >= pySameMargen ? '+' : ''}{Num.round2(cytdMargen - pySameMargen).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* EMAILS GENERALES */}
      {(loadingEmails || generalEmails.length > 0) && (
        <div className="bg-white p-6 md:p-8 rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm">
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Correo</p>
            <h3 className="font-serif text-xl font-semibold mt-1 flex items-center gap-2">
              <Mail className="w-4 h-4 text-[color:var(--arume-gray-400)]"/>
              Bandeja de entrada
            </h3>
          </div>
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
