/**
 * CashProjection.tsx
 * Widget de saldo bancario proyectado para los próximos 30 días.
 * Combina: saldo actual + cobros esperados - pagos fijos programados.
 *
 * ── INTEGRACIÓN en BancoView.tsx ────────────────────────────────────────
 * 1. Añadir import:
 *    import { CashProjection } from './CashProjection';
 *
 * 2. Dentro del bloque {activeTab === 'insights'}, justo DESPUÉS del
 *    div que cierra el gráfico "CashFlow en Banco (Últimos 30 Días)",
 *    añadir:
 *    <CashProjection data={data} saldoActual={stats.saldo} />
 */

import React, { useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle,
  ChevronDown, ChevronUp, Calendar
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────
const addDays = (date: Date, n: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

const toISO = (d: Date) => d.toLocaleDateString('sv-SE');

const shortLabel = (d: Date) =>
  d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

// ── Calcula si un gasto fijo toca en una fecha concreta ───────────────────
const gastoTocaEnFecha = (g: any, fecha: Date): boolean => {
  if (g.active === false) return false;
  const freq = String(g.freq || 'mensual').toLowerCase();
  const dia  = Number(g.dia_pago) || 1;

  if (freq === 'mensual' || freq === 'semanal') {
    if (freq === 'semanal') return true; // simplificamos: prorrateamos más abajo
    return fecha.getDate() === dia;
  }
  if (freq === 'bimensual') {
    const start = g.startDate ? new Date(g.startDate) : new Date(fecha.getFullYear(), 0, dia);
    const diffM = (fecha.getFullYear() - start.getFullYear()) * 12 + (fecha.getMonth() - start.getMonth());
    return fecha.getDate() === dia && diffM >= 0 && diffM % 2 === 0;
  }
  if (freq === 'trimestral') {
    const start = g.startDate ? new Date(g.startDate) : new Date(fecha.getFullYear(), 0, dia);
    const diffM = (fecha.getFullYear() - start.getFullYear()) * 12 + (fecha.getMonth() - start.getMonth());
    return fecha.getDate() === dia && diffM >= 0 && diffM % 3 === 0;
  }
  if (freq === 'semestral') {
    return fecha.getDate() === dia && [0, 6].includes(fecha.getMonth() % 6);
  }
  if (freq === 'anual') {
    const start = g.startDate ? new Date(g.startDate) : null;
    if (!start) return false;
    return fecha.getDate() === start.getDate() && fecha.getMonth() === start.getMonth();
  }
  if (freq === 'once') {
    const d = g.startDate || g.date;
    return !!d && toISO(fecha) === d.slice(0, 10);
  }
  return false;
};

// ══════════════════════════════════════════════════════════════════════════════
export const CashProjection: React.FC<{ data: AppData; saldoActual: number }> = ({
  data,
  saldoActual,
}) => {
  const [expanded, setExpanded] = useState(true);
  const DAYS = 30;

  // ── Construye la proyección día a día ────────────────────────────────────
  const { chartData, minSaldo, maxSaldo, events, alertDays, cajaMediaDiaria } = useMemo(() => {
    const today      = new Date();
    today.setHours(0, 0, 0, 0);
    const gastosFijos = Array.isArray(data.gastos_fijos) ? data.gastos_fijos : [];
    const facturas    = Array.isArray(data.facturas)    ? data.facturas    : [];
    const albaranes   = Array.isArray(data.albaranes)   ? data.albaranes   : [];
    const cierres     = Array.isArray(data.cierres)     ? data.cierres     : [];

    // 🆕 Media diaria de caja (cierres Z) de los últimos 30 días → estimación futura
    const hace30 = new Date(today); hace30.setDate(hace30.getDate() - 30);
    const hace30Iso = toISO(hace30);
    const cierresRecientes = cierres.filter((c: any) =>
      c.date && c.date >= hace30Iso && c.date <= toISO(today)
    );
    const sumaCaja = cierresRecientes.reduce((s: number, c: any) =>
      s + Num.parse((c as any).totalVenta ?? (c as any).totalVentas ?? 0), 0);
    const diasConCierre = Math.max(cierresRecientes.length, 1);
    const cajaMediaDiaria = Num.round2(sumaCaja / diasConCierre);
    // Qué % de la caja llega al banco (resto es efectivo gastos operativos / pagos en B)
    const cajaAlBanco = cierresRecientes.reduce((s: number, c: any) => {
      const tarjeta = Num.parse((c as any).tarjeta || 0);
      const apps    = Num.parse((c as any).apps || 0);
      return s + tarjeta + apps; // solo lo que entra por TPV/apps va al banco
    }, 0);
    const cajaMediaBancoDiaria = Num.round2(cajaAlBanco / diasConCierre);

    // Cobros esperados: facturas de venta no pagadas con vencimiento futuro
    const cobrosEsperados: { date: string; amount: number; desc: string }[] = facturas
      .filter((f: any) =>
        f.tipo === 'venta' && !f.paid &&
        f.dueDate && new Date(f.dueDate) >= today
      )
      .map((f: any) => ({
        date  : f.dueDate.slice(0, 10),
        amount: Num.parse(f.total),
        desc  : `Cobro ${f.cliente || f.prov || f.num}`,
      }));

    // Pagos esperados: albaranes no pagados con vencimiento futuro
    const pagosAlbaranes: { date: string; amount: number; desc: string }[] = albaranes
      .filter((a: any) => !a.paid && a.dueDate && new Date(a.dueDate) >= today)
      .map((a: any) => ({
        date  : a.dueDate.slice(0, 10),
        amount: -Num.parse(a.total),
        desc  : `Pago ${a.prov || a.num}`,
      }));

    const pointEvents: { date: string; amount: number; desc: string }[] =
      [...cobrosEsperados, ...pagosAlbaranes];

    // Construye array de 30 días
    let saldo       = saldoActual;
    const chartData : { name: string; saldo: number; entrada: number; salida: number; fecha: string }[] = [];
    const events    : { date: string; label: string; amount: number; type: 'in'|'out' }[] = [];
    const alertDays : string[] = [];

    for (let i = 0; i <= DAYS; i++) {
      const fecha = addDays(today, i);
      const iso   = toISO(fecha);
      const dow   = fecha.getDay(); // 0 domingo, 6 sábado
      let entrada = 0;
      let salida  = 0;

      // 🆕 Caja diaria estimada (excluye domingo si el restaurante cierra)
      // Solo para días futuros (i > 0), basado en la media histórica
      if (i > 0 && cajaMediaBancoDiaria > 0 && dow !== 0) {
        entrada += cajaMediaBancoDiaria;
      }

      // Gastos fijos programados
      gastosFijos.forEach((g: any) => {
        if (g.type === 'income' || g.type === 'grant') return; // entradas
        const amount = Num.parse(g.amount ?? g.importe ?? 0);
        if (amount <= 0) return;

        if (g.freq === 'semanal') {
          // Semanal: prorrateamos como 1/7 del importe diario
          salida += Num.round2(amount / 7);
        } else if (gastoTocaEnFecha(g, fecha)) {
          salida += amount;
          events.push({ date: iso, label: g.name || g.concepto || 'Pago fijo', amount: -amount, type: 'out' });
        }
      });

      // Ingresos fijos (subvenciones, alquileres cobrados, etc.)
      gastosFijos.forEach((g: any) => {
        if (g.type !== 'income' && g.type !== 'grant') return;
        const amount = Num.parse(g.amount ?? g.importe ?? 0);
        if (amount <= 0) return;
        if (gastoTocaEnFecha(g, fecha)) {
          entrada += amount;
          events.push({ date: iso, label: g.name || 'Ingreso fijo', amount, type: 'in' });
        }
      });

      // Cobros/pagos puntuales de facturas/albaranes
      pointEvents.forEach(e => {
        if (e.date === iso) {
          if (e.amount > 0) {
            entrada += e.amount;
            events.push({ date: iso, label: e.desc, amount: e.amount, type: 'in' });
          } else {
            salida += Math.abs(e.amount);
            events.push({ date: iso, label: e.desc, amount: e.amount, type: 'out' });
          }
        }
      });

      saldo = Num.round2(saldo + entrada - salida);

      if (saldo < 0) alertDays.push(iso);

      chartData.push({
        name   : i === 0 ? 'Hoy' : i % 5 === 0 ? shortLabel(fecha) : '',
        saldo,
        entrada: Num.round2(entrada),
        salida : Num.round2(salida),
        fecha  : iso,
      });
    }

    const vals   = chartData.map(d => d.saldo);
    const minSaldo = Math.min(...vals);
    const maxSaldo = Math.max(...vals);

    return { chartData, minSaldo, maxSaldo, events, alertDays, cajaMediaDiaria };
  }, [data, saldoActual]);

  const saldo30 = chartData[chartData.length - 1]?.saldo ?? saldoActual;
  const diff    = Num.round2(saldo30 - saldoActual);
  const isUp    = diff >= 0;

  // ── Tooltip custom ────────────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const eventsDay = events.filter(e => e.date === d.fecha);
    return (
      <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl text-xs min-w-[180px]">
        <p className="font-black text-slate-300 mb-2 uppercase tracking-widest text-[9px]">{d.fecha}</p>
        <p className="font-black text-base mb-1">{Num.fmt(d.saldo)}</p>
        {d.entrada > 0 && <p className="text-emerald-400 font-bold">+ {Num.fmt(d.entrada)}</p>}
        {d.salida  > 0 && <p className="text-rose-400 font-bold">- {Num.fmt(d.salida)}</p>}
        {eventsDay.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-700 space-y-1">
            {eventsDay.slice(0, 3).map((e, i) => (
              <p key={i} className={cn('text-[9px] font-bold truncate', e.type==='in'?'text-emerald-300':'text-rose-300')}>
                {e.type==='in' ? '↑' : '↓'} {e.label}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">

      {/* ── CABECERA ───────────────────────────────────────────────────── */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <Calendar className="w-4 h-4 text-indigo-600"/>
          </div>
          <div className="text-left">
            <p className="text-xs font-black text-slate-800 uppercase tracking-widest">
              Saldo Proyectado — Próximos 30 días
            </p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
              Gastos fijos · Cobros · Pagos · <span className="text-indigo-500">Caja diaria estimada</span>
            </p>
            {cajaMediaDiaria > 0 && (
              <p className="text-[9px] font-bold text-emerald-600 mt-0.5">
                ⚡ Incluye {Num.fmt(cajaMediaDiaria)}/día de media (últimos 30d)
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {alertDays.length > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-2 py-1 rounded-full uppercase tracking-widest">
              <AlertTriangle className="w-3 h-3"/>
              {alertDays.length} día{alertDays.length > 1 ? 's' : ''} en negativo
            </span>
          )}
          <div className="text-right">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Saldo día 30</p>
            <p className={cn('text-lg font-black tabular-nums', saldo30 >= 0 ? 'text-slate-800' : 'text-rose-600')}>
              {Num.fmt(saldo30)}
            </p>
          </div>
          <div className={cn('flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full',
            isUp ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200')}>
            {isUp ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>}
            {isUp ? '+' : ''}{Num.fmt(diff)}
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
        </div>
      </button>

      {/* ── GRÁFICO ────────────────────────────────────────────────────── */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4">

          {/* Alerta saldo negativo */}
          {alertDays.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5"/>
              <div>
                <p className="text-xs font-black text-rose-700">Riesgo de saldo negativo</p>
                <p className="text-[11px] font-medium text-rose-600 mt-0.5">
                  Hay {alertDays.length} día{alertDays.length > 1 ? 's' : ''} en que el saldo proyectado cae por debajo de 0.
                  Primer día: <strong>{alertDays[0]}</strong>
                </p>
              </div>
            </div>
          )}

          {/* Gráfico */}
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%" minHeight={200}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={saldo30 >= 0 ? '#4f46e5' : '#f43f5e'} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={saldo30 >= 0 ? '#4f46e5' : '#f43f5e'} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                <XAxis dataKey="name" tick={{fontSize:9, fill:'#94a3b8', fontWeight:'bold'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:9, fill:'#94a3b8', fontWeight:'bold'}} axisLine={false} tickLine={false}
                  tickFormatter={v=>`${(v/1000).toFixed(0)}k`} domain={[Math.min(minSaldo * 1.1, minSaldo - 500), maxSaldo * 1.05]}/>
                {/* Línea de 0 si hay valores negativos */}
                {minSaldo < 0 && (
                  <ReferenceLine y={0} stroke="#f43f5e" strokeDasharray="4 4" strokeWidth={1.5}
                    label={{ value: '€0', fill: '#f43f5e', fontSize: 9, fontWeight: 'bold', position: 'insideTopRight' }}/>
                )}
                <Tooltip content={<CustomTooltip/>}/>
                <Area
                  type="monotone" dataKey="saldo"
                  stroke={saldo30 >= 0 ? '#4f46e5' : '#f43f5e'} strokeWidth={2.5}
                  fill="url(#projGrad)"
                  dot={false} activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Saldo Hoy</p>
              <p className={cn('text-sm font-black tabular-nums', saldoActual >= 0 ? 'text-slate-800' : 'text-rose-600')}>
                {Num.fmt(saldoActual)}
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Mínimo Proyectado</p>
              <p className={cn('text-sm font-black tabular-nums', minSaldo >= 0 ? 'text-slate-800' : 'text-rose-600')}>
                {Num.fmt(minSaldo)}
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Saldo Día 30</p>
              <p className={cn('text-sm font-black tabular-nums', saldo30 >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {Num.fmt(saldo30)}
              </p>
            </div>
          </div>

          {/* Próximos eventos */}
          {events.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Próximos Movimientos Previstos</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {events.slice(0, 10).map((e, i) => (
                  <div key={i} className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-lg border text-xs',
                    e.type === 'in'
                      ? 'bg-emerald-50 border-emerald-100'
                      : 'bg-rose-50 border-rose-100'
                  )}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('text-[9px] font-black shrink-0 uppercase tracking-widest',
                        e.type === 'in' ? 'text-emerald-500' : 'text-rose-500')}>
                        {e.date.slice(5)}
                      </span>
                      <span className="font-bold text-slate-700 truncate">{e.label}</span>
                    </div>
                    <span className={cn('font-black tabular-nums shrink-0 ml-2',
                      e.type === 'in' ? 'text-emerald-600' : 'text-rose-600')}>
                      {e.type === 'in' ? '+' : '-'}{Num.fmt(Math.abs(e.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">
            Proyección orientativa · Solo incluye movimientos programados en Arume PRO
          </p>
        </div>
      )}
    </div>
  );
};
