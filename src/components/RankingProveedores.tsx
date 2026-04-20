// ─── RankingProveedores.tsx ─────────────────────────────────────────────────
// Análisis completo de proveedores: gasto, frecuencia, ticket medio,
// evolución de precios y productos top.
// ────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { EmptyState } from './EmptyState';
import {
  Trophy, TrendingUp, TrendingDown, ChevronDown, ChevronUp,
  Package, Calendar, Euro, FileText, ShoppingCart, BarChart3,
  ArrowUpRight, ArrowDownRight, Minus, Star, Download
} from 'lucide-react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import * as XLSX from 'xlsx';
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

interface Props { data: AppData; }

type SortKey = 'gasto' | 'pedidos' | 'ticket' | 'tendencia';
type Period = 'year' | 'q1' | 'q2' | 'q3' | 'q4';

const MEDAL = ['🥇', '🥈', '🥉'];
const QUARTER_MONTHS: Record<string, number[]> = {
  q1: [1, 2, 3], q2: [4, 5, 6], q3: [7, 8, 9], q4: [10, 11, 12],
};

interface ProvRank {
  prov: string;
  gastoTotal: number;
  numPedidos: number;
  ticketMedio: number;
  primerPedido: string;
  ultimoPedido: string;
  tendencia: number;        // % cambio precio últimos 3 meses vs anteriores
  gastoMensual: Record<string, number>; // 'YYYY-MM' → gasto
  topProductos: { nombre: string; gasto: number; qty: number }[];
  diasPagoMedio: number;    // media de días hasta pago
  pctPagado: number;        // % de documentos pagados
}

// ────────────────────────────────────────────────────────────────────────────
export const RankingProveedores: React.FC<Props> = ({ data }) => {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState<Period>('year');
  const [sortBy, setSortBy] = useState<SortKey>('gasto');
  const [expanded, setExpanded] = useState<string | null>(null);

  const years = useMemo(() => {
    const ys = new Set<number>();
    (data.albaranes || []).forEach(a => { const y = parseInt(String(a.date || '').slice(0, 4)); if (y > 2000) ys.add(y); });
    (data.facturas || []).forEach((f: any) => { const y = parseInt(String(f.date || '').slice(0, 4)); if (y > 2000) ys.add(y); });
    if (ys.size === 0) ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [data.albaranes, data.facturas]);

  const ranking = useMemo(() => {
    const monthFilter = (dateStr: string) => {
      if (!dateStr) return false;
      const y = parseInt(dateStr.slice(0, 4));
      const m = parseInt(dateStr.slice(5, 7));
      if (y !== year) return false;
      if (period === 'year') return true;
      return QUARTER_MONTHS[period]?.includes(m) ?? false;
    };

    // Consolidar albaranes + facturas compra
    const docs: {
      prov: string; total: number; date: string; paid: boolean;
      fechaPago?: string; items?: any[];
    }[] = [];

    (data.albaranes || []).forEach(a => {
      if (!monthFilter(a.date || '')) return;
      if (a.status === 'draft' || a.status === 'mismatch') return;
      docs.push({
        prov: (a.prov || 'Sin proveedor').trim(),
        total: Math.abs(Num.parse(a.total || 0)),
        date: a.date || '',
        paid: !!a.paid,
        fechaPago: (a as any).fecha_pago,
        items: Array.isArray(a.items) ? a.items : [],
      });
    });

    (data.facturas || []).forEach((f: any) => {
      if (f.tipo !== 'compra') return;
      if (!monthFilter(f.date || '')) return;
      if (f.status === 'draft' || f.status === 'mismatch') return;
      // Evitar duplicar con albaranes ya contados
      const linkedAlbs = f.albaranIdsArr || [];
      if (linkedAlbs.length > 0) return; // ya contado vía albaranes
      docs.push({
        prov: (f.prov || 'Sin proveedor').trim(),
        total: Math.abs(Num.parse(f.total || 0)),
        date: f.date || '',
        paid: !!f.paid,
        fechaPago: f.fecha_pago,
        items: [],
      });
    });

    // Agrupar por proveedor (normalizado)
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const provMap = new Map<string, { display: string; docs: typeof docs }>();

    docs.forEach(d => {
      const key = norm(d.prov);
      if (!provMap.has(key)) provMap.set(key, { display: d.prov, docs: [] });
      provMap.get(key)!.docs.push(d);
    });

    const ranks: ProvRank[] = [];

    provMap.forEach(({ display, docs: provDocs }) => {
      if (provDocs.length === 0) return;
      const gastoTotal = Num.round2(provDocs.reduce((s, d) => s + d.total, 0));
      const numPedidos = provDocs.length;
      const ticketMedio = Num.round2(gastoTotal / numPedidos);

      // Fechas
      const fechas = provDocs.map(d => d.date).filter(Boolean).sort();
      const primerPedido = fechas[0] || '';
      const ultimoPedido = fechas[fechas.length - 1] || '';

      // Gasto mensual
      const gastoMensual: Record<string, number> = {};
      provDocs.forEach(d => {
        const key = (d.date || '').slice(0, 7);
        if (key) gastoMensual[key] = Num.round2((gastoMensual[key] || 0) + d.total);
      });

      // Tendencia: últimos 3 meses vs anteriores 3
      const meses = Object.keys(gastoMensual).sort();
      let tendencia = 0;
      if (meses.length >= 4) {
        const last3 = meses.slice(-3);
        const prev3 = meses.slice(-6, -3);
        const avgLast = last3.reduce((s, m) => s + (gastoMensual[m] || 0), 0) / last3.length;
        const avgPrev = prev3.reduce((s, m) => s + (gastoMensual[m] || 0), 0) / Math.max(prev3.length, 1);
        tendencia = avgPrev > 0 ? Num.round2(((avgLast - avgPrev) / avgPrev) * 100) : 0;
      }

      // Top productos
      const prodMap = new Map<string, { gasto: number; qty: number }>();
      provDocs.forEach(d => {
        (d.items || []).forEach((item: any) => {
          const nombre = (item.n || item.name || 'Producto').trim();
          const key = nombre.toLowerCase();
          const prev = prodMap.get(key) || { gasto: 0, qty: 0 };
          prodMap.set(key, {
            gasto: Num.round2(prev.gasto + Math.abs(Num.parse(item.t ?? item.total ?? 0))),
            qty: Num.round2(prev.qty + Num.parse(item.q ?? item.qty ?? 1)),
          });
        });
      });
      const topProductos = [...prodMap.entries()]
        .map(([, v]) => ({ nombre: [...prodMap.entries()].find(([k]) => k === [...prodMap.entries()].find(e => e[1] === v)?.[0])?.[0] || '', ...v }))
        .sort((a, b) => b.gasto - a.gasto)
        .slice(0, 5);

      // Recalculate topProductos properly
      const topProd: { nombre: string; gasto: number; qty: number }[] = [];
      const prodEntries = new Map<string, { displayName: string; gasto: number; qty: number }>();
      provDocs.forEach(d => {
        (d.items || []).forEach((item: any) => {
          const nombre = (item.n || item.name || 'Producto').trim();
          const key = nombre.toLowerCase();
          const prev = prodEntries.get(key) || { displayName: nombre, gasto: 0, qty: 0 };
          prodEntries.set(key, {
            displayName: nombre,
            gasto: Num.round2(prev.gasto + Math.abs(Num.parse(item.t ?? item.total ?? 0))),
            qty: Num.round2(prev.qty + Num.parse(item.q ?? item.qty ?? 1)),
          });
        });
      });
      [...prodEntries.values()]
        .sort((a, b) => b.gasto - a.gasto)
        .slice(0, 5)
        .forEach(p => topProd.push({ nombre: p.displayName, gasto: p.gasto, qty: p.qty }));

      // Días pago medio
      const diasPago: number[] = [];
      provDocs.forEach(d => {
        if (d.paid && d.fechaPago && d.date) {
          const diff = (new Date(d.fechaPago).getTime() - new Date(d.date).getTime()) / 86400000;
          if (diff >= 0 && diff < 365) diasPago.push(diff);
        }
      });
      const diasPagoMedio = diasPago.length > 0 ? Num.round2(diasPago.reduce((s, d) => s + d, 0) / diasPago.length) : 0;
      const pagados = provDocs.filter(d => d.paid).length;
      const pctPagado = Num.round2((pagados / numPedidos) * 100);

      ranks.push({
        prov: display, gastoTotal, numPedidos, ticketMedio,
        primerPedido, ultimoPedido, tendencia, gastoMensual,
        topProductos: topProd, diasPagoMedio, pctPagado,
      });
    });

    // Sort
    const sortFns: Record<SortKey, (a: ProvRank, b: ProvRank) => number> = {
      gasto:     (a, b) => b.gastoTotal - a.gastoTotal,
      pedidos:   (a, b) => b.numPedidos - a.numPedidos,
      ticket:    (a, b) => b.ticketMedio - a.ticketMedio,
      tendencia: (a, b) => b.tendencia - a.tendencia,
    };
    ranks.sort(sortFns[sortBy]);

    // Totales
    const totalGasto = Num.round2(ranks.reduce((s, r) => s + r.gastoTotal, 0));
    const totalPedidos = ranks.reduce((s, r) => s + r.numPedidos, 0);

    return { ranks, totalGasto, totalPedidos };
  }, [data.albaranes, data.facturas, year, period, sortBy]);

  // Chart data: top 8 proveedores
  const chartData = useMemo(() => {
    const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
    return ranking.ranks.slice(0, 8).map((r, i) => ({
      name: r.prov.length > 12 ? r.prov.slice(0, 12) + '…' : r.prov,
      fullName: r.prov,
      gasto: r.gastoTotal,
      color: COLORS[i % COLORS.length],
    }));
  }, [ranking.ranks]);

  const handleExport = () => {
    const wsData = ranking.ranks.map((r, i) => ({
      '#': i + 1,
      Proveedor: r.prov,
      'Gasto Total': r.gastoTotal,
      'Nº Pedidos': r.numPedidos,
      'Ticket Medio': r.ticketMedio,
      'Tendencia %': r.tendencia,
      '% Pagado': r.pctPagado,
      'Días Pago Medio': r.diasPagoMedio,
      'Primer Pedido': r.primerPedido,
      'Último Pedido': r.ultimoPedido,
    }));
    const ws = XLSX.utils.json_to_sheet(wsData);
    ws['!cols'] = [{ wch: 4 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ranking Proveedores');
    XLSX.writeFile(wb, `Arume_Ranking_Proveedores_${year}.xlsx`);
  };

  const TendenciaIcon: React.FC<{ val: number }> = ({ val }) => {
    if (val > 5) return <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" />;
    if (val < -5) return <ArrowDownRight className="w-3.5 h-3.5 text-emerald-500" />;
    return <Minus className="w-3.5 h-3.5 text-slate-400" />;
  };

  return (
    <div className="space-y-3">

      {/* Header: filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-white border border-slate-100 rounded-lg p-1">
          {years.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={cn('px-3 py-1.5 rounded-md text-[10px] font-black transition',
                year === y ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] shadow-sm' : 'text-slate-400 hover:bg-slate-50')}>
              {y}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white border border-slate-100 rounded-lg p-1">
          {([['year', 'Año'], ['q1', 'T1'], ['q2', 'T2'], ['q3', 'T3'], ['q4', 'T4']] as [Period, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setPeriod(k)}
              className={cn('px-2.5 py-1.5 rounded-md text-[10px] font-black transition',
                period === k ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-50')}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white border border-slate-100 rounded-lg p-1 ml-auto">
          {([['gasto', '€ Gasto'], ['pedidos', 'Pedidos'], ['ticket', 'Ticket'], ['tendencia', 'Tendencia']] as [SortKey, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setSortBy(k)}
              className={cn('px-2.5 py-1.5 rounded-md text-[9px] font-black transition',
                sortBy === k ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-50')}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={handleExport} className="w-8 h-8 bg-white border border-slate-100 rounded-lg flex items-center justify-center hover:bg-emerald-50 hover:border-emerald-200 transition">
          <Download className="w-3.5 h-3.5 text-slate-500" />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Proveedores activos</p>
          <p className="text-2xl font-black text-slate-800">{ranking.ranks.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Gasto total</p>
          <p className="text-2xl font-black text-rose-600 tabular-nums">{Num.fmt(ranking.totalGasto)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total pedidos</p>
          <p className="text-2xl font-black text-indigo-600 tabular-nums">{ranking.totalPedidos}</p>
        </div>
      </div>

      {/* Gráfico top 8 */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Top 8 proveedores por gasto</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <XAxis dataKey="name" tick={{ fontSize: 8, fontWeight: 800, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value: number) => [Num.fmt(value), 'Gasto']}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
                  contentStyle={{ borderRadius: 12, fontSize: 11, fontWeight: 800, border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="gasto" radius={[6, 6, 0, 0]} barSize={28}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Lista ranking */}
      {ranking.ranks.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          eyebrow="Ranking"
          title="Sin datos de proveedores"
          message="Aún no hay albaranes ni compras en este periodo. Cambia el filtro o sube albaranes para empezar."
          size="sm"
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {ranking.ranks.map((r, i) => {
              const isExpanded = expanded === r.prov;
              const pctTotal = ranking.totalGasto > 0 ? Num.round2((r.gastoTotal / ranking.totalGasto) * 100) : 0;

              return (
                <motion.div key={r.prov} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hover:border-indigo-200 transition-all">

                  {/* Fila principal */}
                  <button onClick={() => setExpanded(isExpanded ? null : r.prov)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left">

                    {/* Posición */}
                    <div className="w-8 text-center flex-shrink-0">
                      {i < 3 ? (
                        <span className="text-lg">{MEDAL[i]}</span>
                      ) : (
                        <span className="text-xs font-black text-slate-300">#{i + 1}</span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-black text-slate-800 truncate">{r.prov}</p>
                        {i === 0 && <Star className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-slate-400 font-bold">{r.numPedidos} pedidos</span>
                        <span className="text-[10px] text-slate-300">·</span>
                        <span className="text-[10px] text-slate-400 font-bold">Ticket: {Num.fmt(r.ticketMedio)}</span>
                        <span className="text-[10px] text-slate-300">·</span>
                        <span className="text-[10px] text-indigo-500 font-bold">{pctTotal}% del total</span>
                      </div>
                    </div>

                    {/* Tendencia */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <TendenciaIcon val={r.tendencia} />
                      <span className={cn('text-[10px] font-black',
                        r.tendencia > 5 ? 'text-rose-500' : r.tendencia < -5 ? 'text-emerald-500' : 'text-slate-400')}>
                        {r.tendencia > 0 ? '+' : ''}{r.tendencia}%
                      </span>
                    </div>

                    {/* Gasto */}
                    <div className="text-right flex-shrink-0 w-24">
                      <p className="text-sm font-black text-slate-800 tabular-nums">{Num.fmt(r.gastoTotal)}</p>
                    </div>

                    {/* Expand */}
                    <div className="flex-shrink-0">
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-300" /> : <ChevronDown className="w-4 h-4 text-slate-300" />}
                    </div>
                  </button>

                  {/* Detalle expandido */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-slate-100">
                        <div className="p-4 space-y-3">

                          {/* Mini KPIs */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <div className="bg-slate-50 rounded-xl px-3 py-2">
                              <p className="text-[8px] font-black text-slate-400 uppercase">Primer pedido</p>
                              <p className="text-xs font-black text-slate-700">{r.primerPedido || '—'}</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl px-3 py-2">
                              <p className="text-[8px] font-black text-slate-400 uppercase">Último pedido</p>
                              <p className="text-xs font-black text-slate-700">{r.ultimoPedido || '—'}</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl px-3 py-2">
                              <p className="text-[8px] font-black text-slate-400 uppercase">Días pago medio</p>
                              <p className="text-xs font-black text-slate-700">{r.diasPagoMedio > 0 ? `${r.diasPagoMedio} días` : 'Sin datos'}</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl px-3 py-2">
                              <p className="text-[8px] font-black text-slate-400 uppercase">% Pagado</p>
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${r.pctPagado >= 80 ? 'bg-emerald-400' : r.pctPagado >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`}
                                    style={{ width: `${r.pctPagado}%` }} />
                                </div>
                                <span className="text-xs font-black text-slate-700">{r.pctPagado}%</span>
                              </div>
                            </div>
                          </div>

                          {/* Barra de concentración */}
                          <div>
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Concentración de gasto</p>
                            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all"
                                style={{ width: `${Math.min(pctTotal, 100)}%` }} />
                            </div>
                            <p className="text-[9px] text-slate-400 mt-0.5">{pctTotal}% del gasto total de compras</p>
                          </div>

                          {/* Top productos */}
                          {r.topProductos.length > 0 && (
                            <div>
                              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Top productos</p>
                              <div className="space-y-1">
                                {r.topProductos.map((p, j) => (
                                  <div key={j} className="flex items-center gap-2 text-xs">
                                    <Package className="w-3 h-3 text-slate-300 flex-shrink-0" />
                                    <span className="flex-1 truncate text-slate-700 font-bold">{p.nombre}</span>
                                    <span className="text-slate-400 font-bold tabular-nums">{Num.round2(p.qty)} uds</span>
                                    <span className="text-slate-800 font-black tabular-nums w-20 text-right">{Num.fmt(p.gasto)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Gasto mensual mini chart */}
                          {Object.keys(r.gastoMensual).length > 1 && (
                            <div>
                              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Evolución mensual</p>
                              <div className="h-24">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={Object.entries(r.gastoMensual).sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({
                                    name: m.slice(5), gasto: v
                                  }))}>
                                    <XAxis dataKey="name" tick={{ fontSize: 8, fontWeight: 800, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                                    <Tooltip formatter={(v: number) => [Num.fmt(v), 'Gasto']}
                                      contentStyle={{ borderRadius: 8, fontSize: 10, fontWeight: 800, border: '1px solid #e2e8f0' }} />
                                    <Bar dataKey="gasto" fill="#6366f1" radius={[3, 3, 0, 0]} barSize={18} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Info */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
        <p className="font-black mb-1">🏆 ¿Cómo usar este ranking?</p>
        <ul className="space-y-0.5 text-[11px] text-amber-700">
          <li>• <b>Concentración</b>: si un proveedor supera el 30%, considera diversificar</li>
          <li>• <b>Tendencia ↑</b> (rojo): te está subiendo precios. Negocia o busca alternativa</li>
          <li>• <b>Tendencia ↓</b> (verde): precios bajando o menos compras</li>
          <li>• <b>Ticket medio</b>: agrupa pedidos para reducir costes de envío</li>
          <li>• <b>Días pago</b>: mantén buena relación pagando a tiempo</li>
        </ul>
      </div>
    </div>
  );
};
