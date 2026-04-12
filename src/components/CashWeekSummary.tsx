/**
 * CashWeekSummary.tsx
 * Panel de resumen semanal de caja para Arume PRO.
 * Muestra los últimos 7 días con totales, tendencia y días sin cierre.
 * También exporta la función getLastCierreValues para el cierre rápido.
 */
import React, { useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, Calendar
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData, Cierre } from '../types';

// ── Helper: obtener el valor de venta de un cierre de forma segura ─────────
const getCierreVenta = (c: any): number =>
  Num.parse(
    c?.totalVenta ?? c?.totalVentas ??
    c?.total_calculado ?? c?.total_real ??
    c?.total ?? 0
  );

// ── Exportada: valores del último cierre para el "cierre rápido" ──────────
export const getLastCierreValues = (data: AppData): {
  date: string; efectivo: number; tpv1: number; tpv2: number;
  glovo: number; uber: number;
} | null => {
  const cierres = Array.isArray(data?.cierres) ? data.cierres : [];
  const sorted  = [...cierres]
    .filter(c => (c as any).unitId === 'REST' || !(c as any).unitId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (sorted.length === 0) return null;
  const last = sorted[0] as any;
  return {
    date    : last.date || '',
    efectivo: Num.parse(last.efectivo ?? 0),
    tpv1    : Num.parse(last.tpv1 ?? last.tarjeta ?? 0),
    tpv2    : Num.parse(last.tpv2 ?? 0),
    glovo   : Num.parse(last.glovo ?? 0),
    uber    : Num.parse(last.uber ?? 0),
  };
};

// ── Genera array de los últimos N días ────────────────────────────────────
const lastNDays = (n: number): string[] => {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString('sv-SE'));
  }
  return days;
};

const WDAY = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const wdayLabel = (dateStr: string) => {
  const d = DateUtil.parse(dateStr);
  return isNaN(d.getTime()) ? '—' : WDAY[d.getDay()];
};

// ══════════════════════════════════════════════════════════════════════════════
export const CashWeekSummary: React.FC<{ data: AppData }> = ({ data }) => {
  const days = useMemo(() => lastNDays(7), []);

  const cierres = useMemo(
    () => Array.isArray(data?.cierres) ? data.cierres : [],
    [data?.cierres]
  );

  // Agrupa cierres por fecha (pueden haber REST + SHOP el mismo día)
  const byDate = useMemo(() => {
    const map: Record<string, { rest: number; shop: number; raw: Cierre[] }> = {};
    cierres.forEach(c => {
      const d = (c.date || '').slice(0, 10);
      if (!map[d]) map[d] = { rest: 0, shop: 0, raw: [] };
      map[d].raw.push(c);
      const val = getCierreVenta(c);
      if ((c as any).unitId === 'SHOP') map[d].shop += val;
      else                               map[d].rest += val;
    });
    return map;
  }, [cierres]);

  const weekData = useMemo(() =>
    days.map(date => {
      const entry = byDate[date];
      const rest  = entry?.rest ?? 0;
      const shop  = entry?.shop ?? 0;
      const total = Num.round2(rest + shop);
      return { date, label: wdayLabel(date), rest, shop, total, hasCierre: !!entry };
    }),
    [days, byDate]
  );

  const maxVal    = Math.max(...weekData.map(d => d.total), 1);
  const totalWeek = Num.round2(weekData.reduce((s, d) => s + d.total, 0));
  const activeDays = weekData.filter(d => d.hasCierre).length;
  const avgDay    = activeDays > 0 ? Num.round2(totalWeek / activeDays) : 0;
  const sinCierre = weekData.filter(d => !d.hasCierre && d.date < new Date().toLocaleDateString('sv-SE')).length;

  // Tendencia: comparar primera mitad vs segunda mitad de la semana
  const firstHalf  = weekData.slice(0, 3).reduce((s, d) => s + d.total, 0);
  const secondHalf = weekData.slice(4).reduce((s, d) => s + d.total, 0);
  const trend      = secondHalf > firstHalf ? 'up' : secondHalf < firstHalf ? 'down' : 'flat';

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* ── CABECERA ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-500"/>
          <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Resumen Últimos 7 Días</h3>
        </div>
        <div className="flex items-center gap-3">
          {sinCierre > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full uppercase tracking-widest">
              <AlertTriangle className="w-2.5 h-2.5"/>
              {sinCierre} día{sinCierre > 1 ? 's' : ''} sin cierre
            </span>
          )}
          <div className={cn(
            'flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-full uppercase tracking-widest',
            trend === 'up'   ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            trend === 'down' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                               'bg-slate-100 text-slate-600 border border-slate-200'
          )}>
            {trend === 'up'   ? <TrendingUp   className="w-2.5 h-2.5"/> :
             trend === 'down' ? <TrendingDown className="w-2.5 h-2.5"/> :
                                <Minus        className="w-2.5 h-2.5"/>}
            {trend === 'up' ? 'Subiendo' : trend === 'down' ? 'Bajando' : 'Estable'}
          </div>
        </div>
      </div>

      {/* ── GRÁFICO DE BARRAS ────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-end gap-1.5 h-20">
          {weekData.map(d => {
            const heightPct = maxVal > 0 ? (d.total / maxVal) * 100 : 0;
            const isToday   = d.date === new Date().toLocaleDateString('sv-SE');
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                {/* Tooltip */}
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-black px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  {Num.fmt(d.total)}
                </div>
                {/* Barra */}
                <div className="w-full flex-1 flex items-end">
                  {d.hasCierre ? (
                    <div
                      className={cn(
                        'w-full rounded-t-md transition-all duration-500',
                        isToday ? 'bg-indigo-600' : 'bg-indigo-200 group-hover:bg-indigo-400'
                      )}
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                    />
                  ) : (
                    <div className="w-full h-1 bg-slate-100 rounded-t-md"/>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Etiquetas días */}
        <div className="flex gap-1.5 mt-1">
          {weekData.map(d => {
            const isToday = d.date === new Date().toLocaleDateString('sv-SE');
            return (
              <div key={d.date} className="flex-1 text-center">
                <span className={cn(
                  'text-[9px] font-black uppercase',
                  isToday ? 'text-indigo-600' : d.hasCierre ? 'text-slate-500' : 'text-rose-400'
                )}>
                  {d.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── KPIs SEMANA ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100">
        <div className="px-4 py-3 text-center">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Total Semana</p>
          <p className="text-sm font-black text-slate-800 tabular-nums">{Num.fmt(totalWeek)}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Media/Día</p>
          <p className="text-sm font-black text-slate-800 tabular-nums">{Num.fmt(avgDay)}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Días con Cierre</p>
          <p className={cn('text-sm font-black tabular-nums',
            weekData.filter(d => d.hasCierre).length === 7 ? 'text-emerald-600' : 'text-amber-600')}>
            {weekData.filter(d => d.hasCierre).length}/7
          </p>
        </div>
      </div>

      {/* ── DESGLOSE REST vs SHOP ────────────────────────────────────────── */}
      {weekData.some(d => d.shop > 0) && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-50 grid grid-cols-2 gap-2">
          <div className="bg-indigo-50 rounded-lg px-3 py-2">
            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-0.5">Restaurante</p>
            <p className="text-xs font-black text-indigo-700 tabular-nums">
              {Num.fmt(weekData.reduce((s, d) => s + d.rest, 0))}
            </p>
          </div>
          <div className="bg-emerald-50 rounded-lg px-3 py-2">
            <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-0.5">Tienda Sake</p>
            <p className="text-xs font-black text-emerald-700 tabular-nums">
              {Num.fmt(weekData.reduce((s, d) => s + d.shop, 0))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
