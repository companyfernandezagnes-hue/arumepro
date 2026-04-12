// ==========================================
// 📦 ValoracionStock.tsx — Valoración FIFO / LIFO / PMP
// ==========================================
import React, { useState, useMemo } from 'react';
import {
  Package, Layers, TrendingUp, TrendingDown, BarChart3,
  Download, ChevronDown, ChevronUp, Info, ArrowRight,
  DollarSign, Scale, History, Filter,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Ingrediente, KardexEntry, BusinessUnit } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

// ── Tipos internos ──────────────────────────────────────────────────────────

/** Un lote = una entrada de stock con precio y cantidad remanente */
interface Lote {
  id: string;
  date: string;
  qty: number;        // cantidad ORIGINAL del lote
  remaining: number;  // cantidad AÚN en stock
  price: number;      // precio unitario de compra
  reason: string;
  kardexId: string;
}

/** Resultado de valoración por producto */
interface ProductValuation {
  ingId: string;
  name: string;
  unit: string;
  fam: string;
  stockActual: number;
  lotes: Lote[];
  fifo: { valor: number; costoMedio: number };
  lifo: { valor: number; costoMedio: number };
  pmp:  { valor: number; costoMedio: number };
}

type MetodoValoracion = 'fifo' | 'lifo' | 'pmp';

const METODOS: { key: MetodoValoracion; label: string; desc: string }[] = [
  { key: 'fifo', label: 'FIFO',  desc: 'First In, First Out — se consumen primero las unidades más antiguas' },
  { key: 'lifo', label: 'LIFO',  desc: 'Last In, First Out — se consumen primero las unidades más recientes' },
  { key: 'pmp',  label: 'PMP',   desc: 'Precio Medio Ponderado — coste medio de todas las compras' },
];

interface Props {
  data: AppData;
  unit: BusinessUnit;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Reconstruye lotes activos a partir del kardex, aplicando salidas según método */
function buildValuation(
  kardexEntries: KardexEntry[],
  stockActual: number,
  method: MetodoValoracion,
): { lotes: Lote[]; valor: number; costoMedio: number } {
  // 1. Ordenar cronológicamente (más antiguo primero)
  const sorted = [...kardexEntries].sort((a, b) => a.ts - b.ts);

  // 2. Construir lotes de entrada
  const lotes: Lote[] = [];
  for (const e of sorted) {
    if (e.type === 'IN' && (e.price ?? 0) > 0) {
      lotes.push({
        id: e.id,
        date: e.date,
        qty: e.qty,
        remaining: e.qty,
        price: e.price!,
        reason: e.reason,
        kardexId: e.id,
      });
    }
  }

  // 3. Aplicar salidas según método
  for (const e of sorted) {
    if (e.type !== 'OUT') continue;
    let toConsume = e.qty;

    if (method === 'fifo') {
      // Consumir desde el lote más antiguo
      for (const l of lotes) {
        if (toConsume <= 0) break;
        const take = Math.min(l.remaining, toConsume);
        l.remaining = r2(l.remaining - take);
        toConsume = r2(toConsume - take);
      }
    } else if (method === 'lifo') {
      // Consumir desde el lote más reciente
      for (let i = lotes.length - 1; i >= 0; i--) {
        if (toConsume <= 0) break;
        const take = Math.min(lotes[i].remaining, toConsume);
        lotes[i].remaining = r2(lotes[i].remaining - take);
        toConsume = r2(toConsume - take);
      }
    }
    // PMP no necesita consumir lotes individuales
  }

  // 4. Calcular valor
  if (method === 'pmp') {
    const totalQty = lotes.reduce((s, l) => s + l.qty, 0);
    const totalVal = lotes.reduce((s, l) => s + l.qty * l.price, 0);
    const costoMedio = totalQty > 0 ? r2(totalVal / totalQty) : 0;
    const valor = r2(stockActual * costoMedio);
    // Para PMP, los lotes "remaining" son proporcionales
    const lotesAdjusted = lotes.map(l => ({
      ...l,
      remaining: totalQty > 0 ? r2(stockActual * (l.qty / totalQty)) : 0,
    }));
    return { lotes: lotesAdjusted, valor, costoMedio };
  }

  // FIFO/LIFO: sumar solo lotes con remaining > 0
  const activeLotes = lotes.filter(l => l.remaining > 0);
  const valor = r2(activeLotes.reduce((s, l) => s + l.remaining * l.price, 0));
  const totalRemaining = activeLotes.reduce((s, l) => s + l.remaining, 0);
  const costoMedio = totalRemaining > 0 ? r2(valor / totalRemaining) : 0;

  return { lotes: activeLotes, valor, costoMedio };
}

// ── Componente principal ────────────────────────────────────────────────────

export const ValoracionStock: React.FC<Props> = ({ data, unit }) => {
  const [metodo, setMetodo] = useState<MetodoValoracion>('fifo');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'valor' | 'stock'>('valor');

  // ── Ingredientes de la unidad ──
  const unitIngredients = useMemo(() =>
    (data.ingredientes || []).filter((i: any) =>
      (i.unidad_negocio || 'SHOP') === unit
    ), [data.ingredientes, unit]);

  // ── Kardex por ingrediente ──
  const kardexByIng = useMemo(() => {
    const map = new Map<string, KardexEntry[]>();
    for (const k of (data.kardex || [])) {
      if ((k.unidad_negocio || 'SHOP') !== unit) continue;
      const arr = map.get(k.ingId) || [];
      arr.push(k);
      map.set(k.ingId, arr);
    }
    return map;
  }, [data.kardex, unit]);

  // ── Valoraciones por producto ──
  const valuations = useMemo((): ProductValuation[] => {
    return unitIngredients.map(ing => {
      const entries = kardexByIng.get(ing.id) || [];
      const fifoResult = buildValuation(entries, ing.stock, 'fifo');
      const lifoResult = buildValuation(entries, ing.stock, 'lifo');
      const pmpResult  = buildValuation(entries, ing.stock, 'pmp');

      return {
        ingId: ing.id,
        name: ing.n,
        unit: ing.unit || ing.unidad || 'uds',
        fam: ing.fam || 'Sin categoría',
        stockActual: ing.stock,
        lotes: metodo === 'fifo' ? fifoResult.lotes
             : metodo === 'lifo' ? lifoResult.lotes
             : pmpResult.lotes,
        fifo: { valor: fifoResult.valor, costoMedio: fifoResult.costoMedio },
        lifo: { valor: lifoResult.valor, costoMedio: lifoResult.costoMedio },
        pmp:  { valor: pmpResult.valor, costoMedio: pmpResult.costoMedio },
      };
    });
  }, [unitIngredients, kardexByIng, metodo]);

  // ── Filtro y orden ──
  const filtered = useMemo(() => {
    let list = valuations.filter(v =>
      v.name.toLowerCase().includes(searchTerm.toLowerCase()) && v.stockActual > 0
    );
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'stock') return b.stockActual - a.stockActual;
      return b[metodo].valor - a[metodo].valor;
    });
    return list;
  }, [valuations, searchTerm, sortBy, metodo]);

  // ── KPIs globales ──
  const totals = useMemo(() => {
    const withStock = valuations.filter(v => v.stockActual > 0);
    const fifoTotal = withStock.reduce((s, v) => s + v.fifo.valor, 0);
    const lifoTotal = withStock.reduce((s, v) => s + v.lifo.valor, 0);
    const pmpTotal  = withStock.reduce((s, v) => s + v.pmp.valor, 0);
    const refs = withStock.length;
    const units = withStock.reduce((s, v) => s + v.stockActual, 0);
    const diffFifoLifo = fifoTotal - lifoTotal;
    return { fifoTotal, lifoTotal, pmpTotal, refs, units, diffFifoLifo };
  }, [valuations]);

  // ── Export Excel ──
  const handleExport = () => {
    const headers = ['Producto', 'Familia', 'Stock', 'Ud', 'FIFO €', 'LIFO €', 'PMP €', 'Coste FIFO', 'Coste LIFO', 'Coste PMP'];
    const rows = filtered.map(v => [
      v.name, v.fam, v.stockActual, v.unit,
      v.fifo.valor.toFixed(2), v.lifo.valor.toFixed(2), v.pmp.valor.toFixed(2),
      v.fifo.costoMedio.toFixed(2), v.lifo.costoMedio.toFixed(2), v.pmp.costoMedio.toFixed(2),
    ]);
    const totRow = [
      'TOTAL', '', totals.units.toFixed(1), '',
      totals.fifoTotal.toFixed(2), totals.lifoTotal.toFixed(2), totals.pmpTotal.toFixed(2),
      '', '', '',
    ];
    const csv = [headers, ...rows, totRow].map(r => r.join('\t')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `valoracion_stock_${unit}_${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeVal = (v: ProductValuation) => v[metodo];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Scale className="w-5 h-5 text-purple-600" />
            Valoración de Inventario
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Valor del stock según método contable seleccionado
          </p>
        </div>
        <button onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm hover:bg-green-700 transition">
          <Download className="w-4 h-4" /> Excel
        </button>
      </div>

      {/* ── Selector de método ── */}
      <div className="grid grid-cols-3 gap-3">
        {METODOS.map(m => (
          <button key={m.key} onClick={() => setMetodo(m.key)}
            className={cn(
              'p-4 rounded-2xl border-2 text-left transition-all',
              metodo === m.key
                ? 'border-purple-500 bg-purple-50 shadow-md'
                : 'border-gray-200 bg-white hover:border-gray-300'
            )}>
            <div className="font-bold text-lg">{m.label}</div>
            <div className="text-xs text-gray-500 mt-1">{m.desc}</div>
            <div className="mt-3 text-2xl font-black text-purple-700">
              {Num.fmt(m.key === 'fifo' ? totals.fifoTotal : m.key === 'lifo' ? totals.lifoTotal : totals.pmpTotal)}
            </div>
          </button>
        ))}
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl p-4 border">
          <div className="text-xs text-gray-500 mb-1">Referencias con stock</div>
          <div className="text-2xl font-bold">{totals.refs}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 border">
          <div className="text-xs text-gray-500 mb-1">Unidades totales</div>
          <div className="text-2xl font-bold">{Num.round2(totals.units)}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 border">
          <div className="text-xs text-gray-500 mb-1">Diferencia FIFO–LIFO</div>
          <div className={cn('text-2xl font-bold', totals.diffFifoLifo >= 0 ? 'text-green-600' : 'text-red-600')}>
            {totals.diffFifoLifo >= 0 ? '+' : ''}{Num.fmt(totals.diffFifoLifo)}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border">
          <div className="text-xs text-gray-500 mb-1">Coste medio global ({metodo.toUpperCase()})</div>
          <div className="text-2xl font-bold">
            {totals.units > 0
              ? Num.fmt((metodo === 'fifo' ? totals.fifoTotal : metodo === 'lifo' ? totals.lifoTotal : totals.pmpTotal) / totals.units)
              : '—'}
            <span className="text-sm font-normal text-gray-400">/ud</span>
          </div>
        </div>
      </div>

      {/* ── Info box ── */}
      <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex gap-3">
        <Info className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
        <div className="text-sm text-purple-800">
          <strong>¿Cuál usar?</strong> En España, el <strong>PGC acepta PMP y FIFO</strong> (art. 38.1.f Código Comercio).
          LIFO no está permitido fiscalmente pero es útil como referencia de gestión.
          El método elegido afecta al <em>valor del inventario</em> y al <em>coste de ventas</em> en la cuenta de resultados.
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar producto..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border text-sm focus:ring-2 focus:ring-purple-300"
          />
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {([['valor', 'Valor'], ['name', 'A-Z'], ['stock', 'Stock']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSortBy(k)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition',
                sortBy === k ? 'bg-white shadow text-purple-700' : 'text-gray-500')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tabla detallada ── */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No hay productos con stock en esta unidad</p>
          </div>
        )}

        {filtered.map(v => {
          const val = activeVal(v);
          const isExpanded = expandedId === v.ingId;
          return (
            <motion.div key={v.ingId} layout className="bg-white rounded-2xl border overflow-hidden">
              {/* Cabecera */}
              <button onClick={() => setExpandedId(isExpanded ? null : v.ingId)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition text-left">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{v.name}</div>
                    <div className="text-xs text-gray-400">{v.fam} · {v.stockActual} {v.unit}</div>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="font-bold text-purple-700">{Num.fmt(val.valor)}</div>
                    <div className="text-xs text-gray-400">{Num.fmt(val.costoMedio)}/{v.unit}</div>
                  </div>
                  {/* Comparativa mini */}
                  <div className="hidden md:flex gap-3 text-xs text-gray-400">
                    <span className={cn(metodo === 'fifo' && 'font-bold text-purple-600')}>F:{Num.fmt(v.fifo.valor)}</span>
                    <span className={cn(metodo === 'lifo' && 'font-bold text-purple-600')}>L:{Num.fmt(v.lifo.valor)}</span>
                    <span className={cn(metodo === 'pmp' && 'font-bold text-purple-600')}>P:{Num.fmt(v.pmp.valor)}</span>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>

              {/* Detalle de lotes */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 border-t">
                      {/* Resumen 3 métodos */}
                      <div className="grid grid-cols-3 gap-3 my-4">
                        {METODOS.map(m => {
                          const mVal = v[m.key];
                          return (
                            <div key={m.key}
                              className={cn('p-3 rounded-xl text-center',
                                metodo === m.key ? 'bg-purple-100 ring-2 ring-purple-400' : 'bg-gray-50')}>
                              <div className="text-xs font-medium text-gray-500">{m.label}</div>
                              <div className="text-lg font-bold">{Num.fmt(mVal.valor)}</div>
                              <div className="text-xs text-gray-400">{Num.fmt(mVal.costoMedio)}/{v.unit}</div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Tabla de lotes */}
                      {v.lotes.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-gray-400 border-b">
                                <th className="text-left py-2 font-medium">Fecha</th>
                                <th className="text-left py-2 font-medium">Origen</th>
                                <th className="text-right py-2 font-medium">Precio</th>
                                <th className="text-right py-2 font-medium">Comprado</th>
                                <th className="text-right py-2 font-medium">Restante</th>
                                <th className="text-right py-2 font-medium">Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {v.lotes.map((l, i) => (
                                <tr key={l.id + i} className="border-b last:border-0 hover:bg-gray-50">
                                  <td className="py-2 text-gray-600">{l.date}</td>
                                  <td className="py-2 text-gray-500 truncate max-w-[140px]">{l.reason}</td>
                                  <td className="py-2 text-right font-mono">{Num.fmt(l.price)}</td>
                                  <td className="py-2 text-right text-gray-400">{l.qty} {v.unit}</td>
                                  <td className="py-2 text-right font-semibold">{r2(l.remaining)} {v.unit}</td>
                                  <td className="py-2 text-right font-bold text-purple-700">{Num.fmt(r2(l.remaining * l.price))}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 font-bold">
                                <td colSpan={4} className="py-2">Total {metodo.toUpperCase()}</td>
                                <td className="py-2 text-right">{r2(v.lotes.reduce((s, l) => s + l.remaining, 0))} {v.unit}</td>
                                <td className="py-2 text-right text-purple-700">{Num.fmt(val.valor)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="text-center py-6 text-gray-400 text-sm">
                          <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          Sin movimientos de entrada con precio registrado.
                          <br />
                          <span className="text-xs">Se usa el coste unitario del maestro de ingredientes como referencia.</span>
                          <div className="mt-3 bg-gray-50 rounded-xl p-3">
                            <div className="text-gray-600 font-medium">
                              Valoración por coste unitario: {v.stockActual} × {Num.fmt(
                                (data.ingredientes || []).find(i => i.id === v.ingId)?.cost || 0
                              )} = <strong className="text-purple-700">
                                {Num.fmt(v.stockActual * ((data.ingredientes || []).find(i => i.id === v.ingId)?.cost || 0))}
                              </strong>
                            </div>
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
      </div>

      {/* ── Footer ── */}
      <div className="bg-gray-50 rounded-2xl p-4 text-center text-xs text-gray-400">
        Valoración calculada sobre {totals.refs} referencias con stock &gt; 0 · {(data.kardex || []).filter(k => (k.unidad_negocio || 'SHOP') === unit).length} movimientos en kardex
      </div>
    </div>
  );
};

export default ValoracionStock;
