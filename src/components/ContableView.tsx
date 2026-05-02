/**
 * ContableView.tsx — Modo Contable (sin escandallos, sin inventario, sin equipo)
 *
 * 5 pilares construidos sólo con datos que la administradora controla:
 *   1. Food Cost Proxy mensual (compras / ventas, total y por categoría)
 *   2. Comparativa mes a mes con alertas automáticas
 *   3. ABC de Compras (los que se llevan el 80% del gasto)
 *   4. (descartado — no hay capacidad de inventario presencial)
 *   5. Mix de Ventas (popularidad + ingreso, sin margen) + BCG simplificado +
 *      detección de anomalías. Activo cuando llegan ventas_menu del TPV.
 */
import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Calculator, TrendingUp, TrendingDown, BarChart3,
  AlertTriangle, AlertCircle, CheckCircle2, ChefHat,
  Wine, Trophy, Calendar, ArrowRight, Sparkles, Package,
  Activity, Target, FileQuestion,
} from 'lucide-react';
import { AppData } from '../types';
import { Num, DateUtil, ArumeEngine } from '../services/engine';
import { cn } from '../lib/utils';

// ────────────────────────────────────────────────────────────────────────────
// 🛠️ HELPERS DE CATEGORÍA Y FECHA
// ────────────────────────────────────────────────────────────────────────────
type Categoria = 'comida' | 'bebida' | 'otros';

const CAT_META: Record<Categoria, { label: string; color: string; bg: string; border: string; ring: string; icon: any }> = {
  comida: { label: 'Cocina',  color: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200',    ring: 'ring-rose-200',    icon: ChefHat },
  bebida: { label: 'Bar',     color: 'text-indigo-700',  bg: 'bg-indigo-50',  border: 'border-indigo-200',  ring: 'ring-indigo-200',  icon: Wine    },
  otros : { label: 'Otros',   color: 'text-slate-700',   bg: 'bg-slate-50',   border: 'border-slate-200',   ring: 'ring-slate-200',   icon: Package },
};

const detectCategoria = (provName: string, fam?: string): Categoria => {
  const f = String(fam || '').toLowerCase();
  if (f.match(/comida|cocina|carne|pescad|fruta|verdura|panad|aliment|despensa|fresco|congelad/)) return 'comida';
  if (f.match(/bebida|vino|licor|bar|sake|cerveza|refresco|agua|champag|cava/))                   return 'bebida';
  if (f) return 'otros';
  const p = String(provName || '').toLowerCase();
  if (p.match(/fruta|carne|pesca|makro|pan|huevo|aliment|chef|gourmet|cocina|verdura/)) return 'comida';
  if (p.match(/estrella|mahou|coca|vino|licor|bodega|cervez|sake|refresco|agua|champag|cava/)) return 'bebida';
  return 'otros';
};

const ymKey   = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const MESES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const ymLabel = (key: string) => {
  const [y, m] = key.split('-');
  return `${MESES[parseInt(m, 10) - 1]} ${y.slice(2)}`;
};

const ymShift = (key: string, deltaMonths: number): string => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return ymKey(d);
};

const lastNMonths = (n: number, refDate = new Date()): string[] => {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
    out.push(ymKey(d));
  }
  return out;
};

const pctDelta = (curr: number, prev: number): number => {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Num.round2(((curr - prev) / Math.abs(prev)) * 100);
};

// ────────────────────────────────────────────────────────────────────────────
// 📊 AGREGADOR PRINCIPAL — calcula compras, ventas y desglose por mes
// ────────────────────────────────────────────────────────────────────────────
interface MonthAggregate {
  comprasTotal:    number;
  comprasComida:   number;
  comprasBebida:   number;
  comprasOtros:    number;
  ventasTotal:     number;
  ventasComida:    number;
  ventasBebida:    number;
  ventasOtras:     number;
  ticketsCount:    number;
  fcGlobal:        number;  // %
  fcComida:        number;  // %
  fcBebida:        number;  // %
  unidadesPlato:   number;  // total unidades vendidas (de ventas_menu)
}

interface AggregatedData {
  byMonth:        Record<string, MonthAggregate>;
  proveedorTotal: Record<string, number>;
  itemTotal:      Record<string, number>;
  platoStats:     Record<string, { name: string; category: string; qty: number; ingresoBruto: number; price: number }>;
  ventasMenuActiva: boolean;
  rangoMeses:     string[];
}

function buildAggregates(data: AppData, refDate: Date, monthsWindow: number): AggregatedData {
  const meses = lastNMonths(monthsWindow, refDate);
  const mesesSet = new Set(meses);
  const fromTime = new Date(refDate.getFullYear(), refDate.getMonth() - (monthsWindow - 1), 1).getTime();

  const blank = (): MonthAggregate => ({
    comprasTotal: 0, comprasComida: 0, comprasBebida: 0, comprasOtros: 0,
    ventasTotal: 0,  ventasComida: 0,  ventasBebida: 0,  ventasOtras: 0,
    ticketsCount: 0, fcGlobal: 0, fcComida: 0, fcBebida: 0, unidadesPlato: 0,
  });

  const byMonth: Record<string, MonthAggregate> = {};
  meses.forEach(k => byMonth[k] = blank());

  const provIdx: Record<string, string | undefined> = {};
  (data.proveedores || []).forEach(p => { if (p?.n) provIdx[p.n.toLowerCase()] = p.fam; });

  const proveedorTotal: Record<string, number> = {};
  const itemTotal:      Record<string, number> = {};

  // ── ALBARANES (compras) ─────────────────────────────────────────────────
  (data.albaranes || []).forEach(a => {
    const d = DateUtil.parse(a?.date);
    if (d.getTime() < fromTime) return;
    const key = ymKey(d);
    if (!mesesSet.has(key)) return;

    const total = Num.parse(a?.total);
    if (total <= 0) return;

    const provName = String(a?.prov || '').trim();
    const fam      = provIdx[provName.toLowerCase()];
    const cat      = detectCategoria(provName, fam);

    const m = byMonth[key];
    m.comprasTotal += total;
    if      (cat === 'comida') m.comprasComida += total;
    else if (cat === 'bebida') m.comprasBebida += total;
    else                       m.comprasOtros  += total;

    if (provName) proveedorTotal[provName] = (proveedorTotal[provName] || 0) + total;

    // ABC por ítem (líneas de albarán)
    if (Array.isArray(a?.items)) {
      a.items.forEach((li: any) => {
        const liTotal = Num.parse(li?.t ?? li?.total);
        const liName  = String(li?.n || '').trim();
        if (liTotal > 0 && liName) {
          itemTotal[liName] = (itemTotal[liName] || 0) + liTotal;
        }
      });
    }
  });

  // ── CIERRES DE CAJA (ventas Z totales) ──────────────────────────────────
  (data.cierres || []).forEach(c => {
    const d = DateUtil.parse(c?.date);
    if (d.getTime() < fromTime) return;
    const key = ymKey(d);
    if (!mesesSet.has(key)) return;

    const val = Num.parse(
      (c as any)?.totalVenta ?? (c as any)?.totalVentas ??
      (c as any)?.total_calculado ?? (c as any)?.total_real ?? (c as any)?.total ?? 0
    );
    if (val <= 0) return;

    byMonth[key].ventasTotal += val;
    byMonth[key].ticketsCount += 1;
  });

  // ── FACTURAS B2B (suman a ventas si NO son Z diario) ────────────────────
  (data.facturas || []).forEach(f => {
    if (f?.tipo !== 'venta') return;
    const d = DateUtil.parse(f?.date);
    if (d.getTime() < fromTime) return;
    const key = ymKey(d);
    if (!mesesSet.has(key)) return;
    const isZ = String(f?.num || '').toUpperCase().startsWith('Z');
    if (isZ || f?.cliente === 'Z DIARIO') return;
    byMonth[key].ventasTotal += Num.parse(f?.total);
  });

  // ── VENTAS POR PLATO (TPV — opcional) ──────────────────────────────────
  const platoIdx: Record<string, { name: string; category: string; price: number }> = {};
  (data.platos || []).forEach(p => {
    if (!p?.id) return;
    platoIdx[p.id] = {
      name:     String(p.name || p.nombre || 'Sin nombre'),
      category: String(p.category || p.categoria || 'General'),
      price:    Num.parse(p.price ?? p.precio),
    };
  });

  const platoStats: Record<string, { name: string; category: string; qty: number; ingresoBruto: number; price: number }> = {};
  let ventasMenuActiva = false;

  (data.ventas_menu || []).forEach(v => {
    const d = DateUtil.parse(v?.date);
    if (d.getTime() < fromTime) return;
    const key = ymKey(d);
    if (!mesesSet.has(key)) return;

    const qty = Num.parse(v?.qty ?? v?.cantidad);
    if (qty <= 0) return;
    ventasMenuActiva = true;

    const platoId = v?.platoId || '';
    const p       = platoIdx[platoId];
    const totalLine = Num.parse(v?.total) || (p ? p.price * qty : 0);

    byMonth[key].unidadesPlato += qty;

    // Ingresos por plato → repartir a comida/bebida según categoría del plato
    const cat = String(p?.category || '').toLowerCase();
    if      (cat.match(/bebida|vino|licor|cocktail|cafe|té|te\b|sake|copa|refresco|cerveza|agua/)) byMonth[key].ventasBebida += totalLine;
    else if (cat.match(/postre|entrante|principal|tapa|arroz|pescado|carne|menu|men[uú]/))         byMonth[key].ventasComida += totalLine;
    else                                                                                            byMonth[key].ventasOtras  += totalLine;

    if (platoId) {
      if (!platoStats[platoId]) {
        platoStats[platoId] = { name: p?.name || 'Plato', category: p?.category || 'General', qty: 0, ingresoBruto: 0, price: p?.price || 0 };
      }
      platoStats[platoId].qty          += qty;
      platoStats[platoId].ingresoBruto += totalLine;
    }
  });

  // ── RATIOS POR MES ──────────────────────────────────────────────────────
  Object.values(byMonth).forEach(m => {
    m.fcGlobal = m.ventasTotal > 0 ? Num.round2((m.comprasTotal  / m.ventasTotal) * 100) : 0;
    // Por categoría: si hay ventas separadas (ventas_menu), las usamos. Si no, fallback al ratio sobre ventas totales.
    const denomComida = m.ventasComida > 0 ? m.ventasComida : m.ventasTotal;
    const denomBebida = m.ventasBebida > 0 ? m.ventasBebida : m.ventasTotal;
    m.fcComida = denomComida > 0 ? Num.round2((m.comprasComida / denomComida) * 100) : 0;
    m.fcBebida = denomBebida > 0 ? Num.round2((m.comprasBebida / denomBebida) * 100) : 0;
  });

  return {
    byMonth, proveedorTotal, itemTotal, platoStats, ventasMenuActiva, rangoMeses: meses,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 🎨 COMPONENTES VISUALES BASE
// ────────────────────────────────────────────────────────────────────────────
const KPI: React.FC<{
  label: string; value: string; sub?: string; delta?: number | null;
  tone?: 'good' | 'bad' | 'neutral'; icon?: any;
}> = ({ label, value, sub, delta, tone = 'neutral', icon: Icon }) => {
  const toneCls = tone === 'good'
    ? 'border-emerald-200 bg-emerald-50'
    : tone === 'bad'
      ? 'border-rose-200 bg-rose-50'
      : 'border-slate-200 bg-white';
  return (
    <div className={cn('rounded-xl border p-3 shadow-sm', toneCls)}>
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-500" />}
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      </div>
      <p className="text-xl font-black text-slate-800 tabular-nums">{value}</p>
      {(sub || delta !== undefined) && (
        <div className="flex items-center gap-2 mt-0.5">
          {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
          {delta !== undefined && delta !== null && (
            <span className={cn(
              'text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md',
              delta > 0 ? 'bg-rose-100 text-rose-700' : delta < 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
            )}>
              {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const SparkBar: React.FC<{ values: number[]; labels: string[]; format?: (n: number) => string; color?: string }> = ({
  values, labels, format = (n) => n.toFixed(1), color = 'bg-indigo-500',
}) => {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1 h-24 px-1">
      {values.map((v, i) => {
        const h = max > 0 ? Math.max(2, Math.round((v / max) * 90)) : 2;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group" title={`${labels[i]}: ${format(v)}`}>
            <div className={cn('w-full rounded-t transition-all', color, 'group-hover:opacity-80')} style={{ height: `${h}%` }} />
            <span className="text-[8px] font-bold text-slate-400 tabular-nums">{labels[i]}</span>
          </div>
        );
      })}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 1️⃣ PILAR 1 — FOOD COST PROXY
// ────────────────────────────────────────────────────────────────────────────
const FoodCostTab: React.FC<{ agg: AggregatedData; targetFC: number; onTargetChange: (n: number) => void }> = ({ agg, targetFC, onTargetChange }) => {
  const meses    = agg.rangoMeses;
  const lastKey  = meses[meses.length - 1];
  const prevKey  = meses[meses.length - 2];
  const lastM    = agg.byMonth[lastKey];
  const prevM    = prevKey ? agg.byMonth[prevKey] : null;

  const valuesFC      = meses.map(k => agg.byMonth[k].fcGlobal);
  const valuesCompras = meses.map(k => agg.byMonth[k].comprasTotal);
  const valuesVentas  = meses.map(k => agg.byMonth[k].ventasTotal);
  const labels        = meses.map(ymLabel);

  const fcCurr  = lastM?.fcGlobal || 0;
  const fcPrev  = prevM?.fcGlobal || 0;
  const desviacion = fcCurr - targetFC;

  return (
    <div className="space-y-4">
      {/* HERO — Food Cost actual */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Food Cost de {ymLabel(lastKey)}</p>
            <div className="flex items-end gap-3 mt-1">
              <p className="text-5xl font-black text-slate-800 tabular-nums">{fcCurr.toFixed(1)}<span className="text-2xl text-slate-400">%</span></p>
              {prevM && (
                <span className={cn(
                  'text-xs font-bold px-2 py-1 rounded-md',
                  fcCurr > fcPrev ? 'bg-rose-100 text-rose-700' : fcCurr < fcPrev ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                )}>
                  {fcCurr > fcPrev ? '▲' : fcCurr < fcPrev ? '▼' : '='} {Math.abs(fcCurr - fcPrev).toFixed(1)}pp vs {ymLabel(prevKey)}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {Num.fmt(lastM?.comprasTotal || 0)} en compras / {Num.fmt(lastM?.ventasTotal || 0)} en ventas
            </p>
          </div>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
            <Target className="w-4 h-4 text-indigo-500" />
            <label className="text-[10px] font-bold uppercase text-slate-500">Objetivo</label>
            <input
              type="number" min={0} max={100} step={0.5} value={targetFC}
              onChange={(e) => onTargetChange(Number(e.target.value) || 0)}
              className="w-16 text-sm font-black text-indigo-700 tabular-nums bg-transparent border-b border-indigo-300 outline-none"
            />
            <span className="text-sm font-black text-indigo-700">%</span>
          </div>
        </div>

        {/* Desviación vs objetivo */}
        <div className={cn(
          'mt-4 rounded-xl p-3 flex items-start gap-3',
          Math.abs(desviacion) < 1 ? 'bg-emerald-50 border border-emerald-200' :
          desviacion > 0           ? 'bg-rose-50    border border-rose-200'    :
                                     'bg-amber-50   border border-amber-200'
        )}>
          {Math.abs(desviacion) < 1 ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            : desviacion > 0        ? <AlertTriangle className="w-5 h-5 text-rose-600  flex-shrink-0 mt-0.5" />
            :                         <TrendingDown  className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />}
          <div>
            <p className="text-sm font-black text-slate-800">
              {Math.abs(desviacion) < 1 ? 'Dentro del objetivo' : desviacion > 0 ? `+${desviacion.toFixed(1)}pp por encima del objetivo` : `${desviacion.toFixed(1)}pp por debajo del objetivo`}
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              {desviacion > 2 ? 'Las compras pesan demasiado sobre las ventas. Revisa proveedores top y subidas de precio.' :
               desviacion < -2 ? 'Margen mejor del esperado — confirma que no falten albaranes por subir.' :
                'Mantén el control de compras y ventas mensuales.'}
            </p>
          </div>
        </div>
      </div>

      {/* GRÁFICO 12 MESES */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-black uppercase tracking-widest text-slate-700">Food Cost % — últimos {meses.length} meses</p>
          <Activity className="w-4 h-4 text-indigo-500" />
        </div>
        <SparkBar values={valuesFC} labels={labels} format={(n) => `${n.toFixed(1)}%`} color="bg-indigo-500" />
      </div>

      {/* DOS GRÁFICOS LADO A LADO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-widest text-slate-700 mb-3">Compras mensuales</p>
          <SparkBar values={valuesCompras} labels={labels} format={Num.fmt} color="bg-rose-400" />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-widest text-slate-700 mb-3">Ventas mensuales</p>
          <SparkBar values={valuesVentas} labels={labels} format={Num.fmt} color="bg-emerald-400" />
        </div>
      </div>

      {/* DESGLOSE POR CATEGORÍA — mes actual */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-black uppercase tracking-widest text-slate-700 mb-3">Desglose de {ymLabel(lastKey)} por categoría</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(['comida', 'bebida', 'otros'] as Categoria[]).map(cat => {
            const meta = CAT_META[cat];
            const Icon = meta.icon;
            const compras =
              cat === 'comida' ? lastM?.comprasComida || 0 :
              cat === 'bebida' ? lastM?.comprasBebida || 0 :
                                  lastM?.comprasOtros  || 0;
            const ventas =
              cat === 'comida' ? lastM?.ventasComida || 0 :
              cat === 'bebida' ? lastM?.ventasBebida || 0 :
                                  lastM?.ventasOtras  || 0;
            const ratio  = ventas > 0 ? (compras / ventas) * 100 : 0;
            const ratioGlobal = (lastM?.ventasTotal || 0) > 0 ? (compras / (lastM?.ventasTotal || 1)) * 100 : 0;
            return (
              <div key={cat} className={cn('rounded-xl border-2 p-3', meta.border, meta.bg)}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={cn('w-4 h-4', meta.color)} />
                  <p className={cn('text-xs font-black uppercase tracking-widest', meta.color)}>{meta.label}</p>
                </div>
                <p className="text-2xl font-black text-slate-800 tabular-nums">{Num.fmt(compras)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">en compras este mes</p>
                {ventas > 0 ? (
                  <p className="text-[11px] font-bold text-slate-700 mt-2">
                    {ratio.toFixed(1)}% de las ventas de {meta.label.toLowerCase()}
                  </p>
                ) : (
                  <p className="text-[11px] font-bold text-slate-700 mt-2">
                    {ratioGlobal.toFixed(1)}% sobre ventas totales <span className="text-slate-400">(sin desglose TPV)</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 2️⃣ PILAR 2 — COMPARATIVA MES A MES + ALERTAS
// ────────────────────────────────────────────────────────────────────────────
interface Alerta {
  severity: 'critical' | 'warning' | 'info';
  title:    string;
  detail:   string;
}

const ComparativaTab: React.FC<{ agg: AggregatedData }> = ({ agg }) => {
  const meses   = agg.rangoMeses;
  const lastKey = meses[meses.length - 1];
  const prevKey = meses[meses.length - 2];
  const yoyKey  = ymShift(lastKey, -12);

  const lastM = agg.byMonth[lastKey];
  const prevM = prevKey ? agg.byMonth[prevKey] : null;
  const yoyM  = agg.byMonth[yoyKey] || null;

  const alertas = useMemo<Alerta[]>(() => {
    const out: Alerta[] = [];
    if (!lastM || !prevM) return out;

    // 1. Subida brusca de food cost
    const deltaFC = lastM.fcGlobal - prevM.fcGlobal;
    if (deltaFC > 3 && lastM.fcGlobal > 30) {
      out.push({
        severity: 'critical',
        title: `Food cost subió ${deltaFC.toFixed(1)}pp`,
        detail: `De ${prevM.fcGlobal.toFixed(1)}% a ${lastM.fcGlobal.toFixed(1)}%. Revisa albaranes y subidas de precio.`,
      });
    }

    // 2. Compras por categoría
    const checkCat = (etiqueta: string, currC: number, prevC: number) => {
      if (prevC === 0) return;
      const delta = pctDelta(currC, prevC);
      if (delta > 15) {
        out.push({
          severity: delta > 25 ? 'critical' : 'warning',
          title: `Compras de ${etiqueta} +${delta.toFixed(0)}%`,
          detail: `${Num.fmt(prevC)} → ${Num.fmt(currC)}. Confirma si fue una compra puntual o tendencia.`,
        });
      } else if (delta < -25 && prevC > 100) {
        out.push({
          severity: 'info',
          title: `Compras de ${etiqueta} ${delta.toFixed(0)}%`,
          detail: `Bajada notable. ¿Falta algún albarán por subir?`,
        });
      }
    };
    checkCat('cocina', lastM.comprasComida, prevM.comprasComida);
    checkCat('bar',    lastM.comprasBebida, prevM.comprasBebida);
    checkCat('otros',  lastM.comprasOtros,  prevM.comprasOtros);

    // 3. Caída de ventas
    const deltaVentas = pctDelta(lastM.ventasTotal, prevM.ventasTotal);
    if (deltaVentas < -10) {
      out.push({
        severity: deltaVentas < -20 ? 'critical' : 'warning',
        title: `Ventas ${deltaVentas.toFixed(0)}% vs mes anterior`,
        detail: `${Num.fmt(prevM.ventasTotal)} → ${Num.fmt(lastM.ventasTotal)}. Revisa cierres de caja y festivos.`,
      });
    }

    // 4. YoY
    if (yoyM && yoyM.ventasTotal > 0) {
      const yoyDelta = pctDelta(lastM.ventasTotal, yoyM.ventasTotal);
      if (yoyDelta < -15) {
        out.push({
          severity: 'warning',
          title: `Ventas ${yoyDelta.toFixed(0)}% vs ${ymLabel(yoyKey)}`,
          detail: `Mismo mes año pasado: ${Num.fmt(yoyM.ventasTotal)}. Este año: ${Num.fmt(lastM.ventasTotal)}.`,
        });
      }
    }

    if (out.length === 0) {
      out.push({
        severity: 'info',
        title: 'Sin desviaciones críticas detectadas',
        detail: 'Las variaciones de este mes están dentro de los rangos normales (±15%).',
      });
    }
    return out;
  }, [lastM, prevM, yoyM, lastKey, prevKey, yoyKey]);

  const filas = useMemo(() => {
    if (!lastM) return [];
    const seguro = (m: MonthAggregate | null | undefined, k: keyof MonthAggregate) => Number(m?.[k] ?? 0);
    const def = [
      { label: 'Ventas totales',     k: 'ventasTotal' as const,   isMoney: true,  inverso: false },
      { label: 'Compras totales',    k: 'comprasTotal' as const,  isMoney: true,  inverso: true },
      { label: 'Compras cocina',     k: 'comprasComida' as const, isMoney: true,  inverso: true },
      { label: 'Compras bar',        k: 'comprasBebida' as const, isMoney: true,  inverso: true },
      { label: 'Compras otros',      k: 'comprasOtros' as const,  isMoney: true,  inverso: true },
      { label: 'Food Cost %',        k: 'fcGlobal' as const,      isMoney: false, inverso: true },
      { label: 'Cierres de caja',    k: 'ticketsCount' as const,  isMoney: false, inverso: false },
    ];
    return def.map(d => {
      const curr = seguro(lastM, d.k);
      const prev = seguro(prevM, d.k);
      const yoy  = seguro(yoyM, d.k);
      return {
        label: d.label, isMoney: d.isMoney, inverso: d.inverso,
        curr, prev, yoy,
        deltaPrev: prev > 0 ? pctDelta(curr, prev) : null,
        deltaYoy : yoy  > 0 ? pctDelta(curr, yoy)  : null,
      };
    });
  }, [lastM, prevM, yoyM]);

  return (
    <div className="space-y-4">
      {/* ALERTAS */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-black uppercase tracking-widest text-slate-700">Alertas automáticas</p>
          <Sparkles className="w-4 h-4 text-amber-500" />
        </div>
        <div className="space-y-2">
          {alertas.map((a, i) => {
            const sty = a.severity === 'critical' ? 'border-rose-200 bg-rose-50 text-rose-800'
                      : a.severity === 'warning'  ? 'border-amber-200 bg-amber-50 text-amber-800'
                      :                              'border-slate-200 bg-slate-50 text-slate-700';
            const Icon = a.severity === 'critical' ? AlertTriangle
                       : a.severity === 'warning'  ? AlertCircle
                       :                              CheckCircle2;
            return (
              <motion.div
                key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className={cn('border rounded-xl p-3 flex items-start gap-3', sty)}
              >
                <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black">{a.title}</p>
                  <p className="text-xs opacity-80 mt-0.5">{a.detail}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* TABLA COMPARATIVA */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <p className="text-xs font-black uppercase tracking-widest text-slate-700">Comparativa</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 font-bold text-slate-600">Métrica</th>
                <th className="text-right px-4 py-2 font-bold text-slate-600">{ymLabel(lastKey)}</th>
                {prevKey && <th className="text-right px-4 py-2 font-bold text-slate-600">vs {ymLabel(prevKey)}</th>}
                {yoyM && <th className="text-right px-4 py-2 font-bold text-slate-600">vs {ymLabel(yoyKey)}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.map((f, i) => {
                const fmt = (v: number) => f.isMoney ? Num.fmt(v) : f.label.includes('%') ? `${v.toFixed(1)}%` : String(v);
                const colorDelta = (d: number | null) => {
                  if (d === null) return 'text-slate-300';
                  const isBad = f.inverso ? d > 0 : d < 0;
                  return isBad ? 'text-rose-600' : 'text-emerald-600';
                };
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-semibold text-slate-700">{f.label}</td>
                    <td className="px-4 py-2 text-right font-black text-slate-800 tabular-nums">{fmt(f.curr)}</td>
                    {prevKey && (
                      <td className="px-4 py-2 text-right tabular-nums">
                        <span className="text-slate-500">{fmt(f.prev)}</span>
                        {f.deltaPrev !== null && (
                          <span className={cn('ml-2 font-bold', colorDelta(f.deltaPrev))}>
                            {f.deltaPrev > 0 ? '+' : ''}{f.deltaPrev.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    )}
                    {yoyM && (
                      <td className="px-4 py-2 text-right tabular-nums">
                        <span className="text-slate-500">{fmt(f.yoy)}</span>
                        {f.deltaYoy !== null && (
                          <span className={cn('ml-2 font-bold', colorDelta(f.deltaYoy))}>
                            {f.deltaYoy > 0 ? '+' : ''}{f.deltaYoy.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 3️⃣ PILAR 3 — ABC DE COMPRAS
// ────────────────────────────────────────────────────────────────────────────
interface ABCRow {
  name:      string;
  total:     number;
  pct:       number;
  cumPct:    number;
  clase:     'A' | 'B' | 'C';
}

const buildABC = (record: Record<string, number>): { rows: ABCRow[]; total: number } => {
  const total   = Object.values(record).reduce((s, v) => s + v, 0);
  const ordered = Object.entries(record)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  let cum = 0;
  const rows: ABCRow[] = ordered.map(([name, v]) => {
    cum += v;
    const cumPct = total > 0 ? (cum / total) * 100 : 0;
    const clase: 'A' | 'B' | 'C' = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
    return { name, total: v, pct: total > 0 ? (v / total) * 100 : 0, cumPct, clase };
  });
  return { rows, total };
};

const ABCTab: React.FC<{ agg: AggregatedData }> = ({ agg }) => {
  const [modo, setModo] = useState<'proveedor' | 'item'>('proveedor');
  const fuente = modo === 'proveedor' ? agg.proveedorTotal : agg.itemTotal;
  const { rows, total } = useMemo(() => buildABC(fuente), [fuente]);
  const grupos = useMemo(() => ({
    A: rows.filter(r => r.clase === 'A'),
    B: rows.filter(r => r.clase === 'B'),
    C: rows.filter(r => r.clase === 'C'),
  }), [rows]);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-700">Aún no hay datos suficientes</p>
        <p className="text-xs text-slate-500 mt-1">Sube albaranes para ver el análisis ABC.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setModo('proveedor')}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition',
            modo === 'proveedor' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600')}
        >Por proveedor</button>
        <button
          onClick={() => setModo('item')}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition',
            modo === 'item' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600')}
        >Por ítem</button>
        <span className="ml-auto text-xs text-slate-500">
          Total analizado: <strong className="text-slate-800">{Num.fmt(total)}</strong>
        </span>
      </div>

      {/* Resumen de clases */}
      <div className="grid grid-cols-3 gap-3">
        {(['A', 'B', 'C'] as const).map(c => {
          const grupo = grupos[c];
          const sumGrupo = grupo.reduce((s, r) => s + r.total, 0);
          const pctGrupo = total > 0 ? (sumGrupo / total) * 100 : 0;
          const meta = c === 'A' ? { color: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200',    desc: 'Negociar precio aquí' }
                    : c === 'B'  ? { color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   desc: 'Vigilancia rutinaria' }
                    :              { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', desc: 'Bajo impacto'        };
          return (
            <div key={c} className={cn('rounded-xl border-2 p-3', meta.border, meta.bg)}>
              <div className="flex items-center justify-between mb-1">
                <p className={cn('text-2xl font-black', meta.color)}>Clase {c}</p>
                <span className={cn('text-xs font-bold', meta.color)}>{grupo.length} {modo === 'proveedor' ? 'prov.' : 'ítems'}</span>
              </div>
              <p className="text-lg font-black text-slate-800 tabular-nums">{Num.fmt(sumGrupo)}</p>
              <p className="text-[10px] text-slate-500">{pctGrupo.toFixed(1)}% del gasto · {meta.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Tabla detallada — solo top 30 */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-widest text-slate-700">Top 30 — {modo === 'proveedor' ? 'proveedores' : 'ítems'}</p>
          <Trophy className="w-4 h-4 text-amber-500" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-bold text-slate-600">#</th>
                <th className="text-left px-3 py-2 font-bold text-slate-600">{modo === 'proveedor' ? 'Proveedor' : 'Ítem'}</th>
                <th className="text-right px-3 py-2 font-bold text-slate-600">Gasto</th>
                <th className="text-right px-3 py-2 font-bold text-slate-600">% Indiv.</th>
                <th className="text-right px-3 py-2 font-bold text-slate-600">% Acum.</th>
                <th className="text-center px-3 py-2 font-bold text-slate-600">Clase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 30).map((r, i) => (
                <tr key={r.name} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5 text-slate-400 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-1.5 font-semibold text-slate-800 truncate max-w-xs" title={r.name}>{r.name}</td>
                  <td className="px-3 py-1.5 text-right font-black text-slate-800 tabular-nums">{Num.fmt(r.total)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-600 tabular-nums">{r.pct.toFixed(1)}%</td>
                  <td className="px-3 py-1.5 text-right text-slate-600 tabular-nums">{r.cumPct.toFixed(1)}%</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={cn(
                      'inline-block px-2 py-0.5 rounded-md text-[10px] font-black',
                      r.clase === 'A' ? 'bg-rose-100 text-rose-700' : r.clase === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    )}>{r.clase}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 5️⃣ PILAR 5 — MIX DE VENTAS (BCG simplificado, sin margen) + anomalías
// ────────────────────────────────────────────────────────────────────────────
const MixVentasTab: React.FC<{ agg: AggregatedData }> = ({ agg }) => {
  const platos = useMemo(() => {
    return Object.entries(agg.platoStats)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.qty - a.qty);
  }, [agg.platoStats]);

  if (!agg.ventasMenuActiva) {
    return (
      <div className="rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-8 text-center">
        <FileQuestion className="w-12 h-12 text-indigo-300 mx-auto mb-3" />
        <p className="text-base font-black text-slate-800">Esperando datos del TPV</p>
        <p className="text-xs text-slate-600 mt-2 max-w-md mx-auto">
          Esta pestaña se activa automáticamente en cuanto el TPV empiece a importar
          ventas por plato. No requiere intervención manual: cuando lleguen, verás aquí
          el mix de ventas, la matriz BCG simplificada (popularidad × ingresos) y la
          detección de anomalías.
        </p>
      </div>
    );
  }

  const totalQty    = platos.reduce((s, p) => s + p.qty, 0);
  const totalIngreso = platos.reduce((s, p) => s + p.ingresoBruto, 0);
  const avgQty      = platos.length > 0 ? totalQty     / platos.length : 0;
  const avgIngreso  = platos.length > 0 ? totalIngreso / platos.length : 0;

  type Cuadrante = 'Estrella' | 'Vaca' | 'Puzzle' | 'Perro';
  const clasificar = (p: { qty: number; ingresoBruto: number }): Cuadrante => {
    const popular = p.qty >= avgQty;
    const aporta  = p.ingresoBruto >= avgIngreso;
    if (popular && aporta) return 'Estrella';
    if (popular)           return 'Vaca';
    if (aporta)            return 'Puzzle';
    return 'Perro';
  };

  const grupos: Record<Cuadrante, typeof platos> = { Estrella: [], Vaca: [], Puzzle: [], Perro: [] };
  platos.forEach(p => grupos[clasificar(p)].push(p));

  const meta: Record<Cuadrante, { color: string; bg: string; border: string; emoji: string; tip: string }> = {
    Estrella: { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', emoji: '⭐', tip: 'Tu motor — protégelos' },
    Vaca    : { color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   emoji: '🐄', tip: 'Populares pero aportan poco € — ¿subir precio?' },
    Puzzle  : { color: 'text-indigo-700',  bg: 'bg-indigo-50',  border: 'border-indigo-200',  emoji: '❓', tip: 'Aportan € pero se venden poco — promocionar' },
    Perro   : { color: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200',    emoji: '🐕', tip: 'Bajo todo — candidatos a quitar' },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KPI label="Platos analizados" value={String(platos.length)} icon={ChefHat} />
        <KPI label="Unidades vendidas" value={Num.parse(totalQty).toLocaleString('es-ES')} icon={BarChart3} />
        <KPI label="Ingreso bruto"     value={Num.fmt(totalIngreso)} icon={TrendingUp} />
      </div>

      {/* MATRIZ BCG SIMPLIFICADA */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(['Estrella', 'Vaca', 'Puzzle', 'Perro'] as Cuadrante[]).map(c => {
          const grupo = grupos[c];
          const m = meta[c];
          return (
            <div key={c} className={cn('rounded-xl border-2 p-3', m.border, m.bg)}>
              <div className="flex items-center justify-between mb-2">
                <p className={cn('text-sm font-black', m.color)}>{m.emoji} {c}s</p>
                <span className={cn('text-xs font-bold', m.color)}>{grupo.length}</span>
              </div>
              <p className="text-[10px] text-slate-600 mb-2">{m.tip}</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {grupo.slice(0, 8).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs bg-white/60 rounded px-2 py-1">
                    <span className="truncate text-slate-700 font-semibold" title={p.name}>{p.name}</span>
                    <span className="text-slate-500 tabular-nums">{p.qty}u · {Num.fmt(p.ingresoBruto)}</span>
                  </div>
                ))}
                {grupo.length > 8 && <p className="text-[10px] text-slate-400 text-center">+{grupo.length - 8} más…</p>}
                {grupo.length === 0 && <p className="text-[10px] text-slate-400 italic">Sin platos</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* TOP 10 BY QTY + TOP 10 BY INGRESO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
            <p className="text-xs font-black uppercase tracking-widest text-slate-700">Top por unidades</p>
          </div>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {platos.slice(0, 10).map((p, i) => (
                <tr key={p.id}>
                  <td className="px-3 py-1.5 text-slate-400 tabular-nums w-6">{i + 1}</td>
                  <td className="px-3 py-1.5 font-semibold text-slate-800 truncate" title={p.name}>{p.name}</td>
                  <td className="px-3 py-1.5 text-right font-black tabular-nums text-slate-800">{p.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
            <p className="text-xs font-black uppercase tracking-widest text-slate-700">Top por ingreso</p>
          </div>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {[...platos].sort((a, b) => b.ingresoBruto - a.ingresoBruto).slice(0, 10).map((p, i) => (
                <tr key={p.id}>
                  <td className="px-3 py-1.5 text-slate-400 tabular-nums w-6">{i + 1}</td>
                  <td className="px-3 py-1.5 font-semibold text-slate-800 truncate" title={p.name}>{p.name}</td>
                  <td className="px-3 py-1.5 text-right font-black tabular-nums text-slate-800">{Num.fmt(p.ingresoBruto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 🏛️ COMPONENTE PRINCIPAL
// ────────────────────────────────────────────────────────────────────────────
type Pilar = 'foodcost' | 'comparativa' | 'abc' | 'mix';

interface ContableViewProps {
  data: AppData;
}

export const ContableView: React.FC<ContableViewProps> = ({ data }) => {
  const [pilar, setPilar] = useState<Pilar>('foodcost');
  const [targetFC, setTargetFC] = useState<number>(30);
  const [windowMonths, setWindowMonths] = useState<number>(12);

  const agg = useMemo(() => buildAggregates(data, new Date(), windowMonths), [data, windowMonths]);

  const tabs: { key: Pilar; label: string; icon: any; desc: string }[] = [
    { key: 'foodcost',    label: 'Food Cost',    icon: Calculator, desc: 'Compras / Ventas' },
    { key: 'comparativa', label: 'Comparativa',  icon: Calendar,   desc: 'Mes a mes + alertas' },
    { key: 'abc',         label: 'ABC Compras',  icon: Trophy,     desc: 'Pareto 80/20' },
    { key: 'mix',         label: 'Mix Ventas',   icon: BarChart3,  desc: 'Cuando llegue el TPV' },
  ];

  return (
    <div className="p-3 md:p-5 space-y-4 max-w-6xl mx-auto">
      {/* HEADER */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-indigo-500" />
            <h1 className="text-xl md:text-2xl font-black text-slate-800">Modo Contable</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-xl">
            Análisis de gestión sin escandallos, sin inventario, sin equipo. Sólo con tus albaranes,
            cierres de caja y banco.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5">
          <span className="text-[10px] font-bold uppercase text-slate-500">Ventana</span>
          {[6, 12, 24].map(n => (
            <button
              key={n} onClick={() => setWindowMonths(n)}
              className={cn('text-xs font-bold px-2 py-0.5 rounded-md transition',
                windowMonths === n ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50')}
            >{n}m</button>
          ))}
        </div>
      </div>

      {/* TABS */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
        <div className="flex">
          {tabs.map(t => {
            const Icon = t.icon;
            const isActive = pilar === t.key;
            return (
              <button
                key={t.key} onClick={() => setPilar(t.key)}
                className={cn(
                  'flex-1 min-w-[120px] flex flex-col items-start gap-0.5 px-4 py-3 transition relative',
                  isActive ? 'bg-indigo-50' : 'hover:bg-slate-50'
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-indigo-600' : 'text-slate-400')} />
                  <span className={cn('text-xs font-black', isActive ? 'text-indigo-700' : 'text-slate-700')}>
                    {t.label}
                  </span>
                </div>
                <span className={cn('text-[10px]', isActive ? 'text-indigo-500' : 'text-slate-400')}>{t.desc}</span>
                {isActive && (
                  <motion.div layoutId="contable-tab-indicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* CONTENIDO */}
      <motion.div key={pilar} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
        {pilar === 'foodcost'    && <FoodCostTab    agg={agg} targetFC={targetFC} onTargetChange={setTargetFC} />}
        {pilar === 'comparativa' && <ComparativaTab agg={agg} />}
        {pilar === 'abc'         && <ABCTab         agg={agg} />}
        {pilar === 'mix'         && <MixVentasTab   agg={agg} />}
      </motion.div>

      {/* PIE: contexto de datos */}
      <div className="text-[10px] text-slate-400 text-center pt-4 border-t border-slate-100">
        <span className="inline-flex items-center gap-1">
          <ArrowRight className="w-3 h-3" />
          Datos: {(data.albaranes || []).length} albaranes · {(data.cierres || []).length} cierres · {(data.ventas_menu || []).length} ventas TPV
        </span>
      </div>
    </div>
  );
};

export default ContableView;
