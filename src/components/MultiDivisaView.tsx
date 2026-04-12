// ==========================================
// 💱 MultiDivisaView.tsx — Dashboard Multi-Divisa
// ==========================================
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  RefreshCw, TrendingUp, TrendingDown, Download,
  AlertCircle, Info, Globe, ArrowRight, Save,
  Loader2, CheckCircle2, Edit3, DollarSign,
} from 'lucide-react';
import { motion } from 'motion/react';
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';
import { CurrencyService, CURRENCIES, getCurrencyInfo, type ExchangeRates } from '../services/currency';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface Props {
  data: AppData;
  onSave: (d: AppData) => Promise<void>;
}

export const MultiDivisaView: React.FC<Props> = ({ data, onSave }) => {
  const [rates, setRates] = useState<ExchangeRates>(CurrencyService.getRates());
  const [loading, setLoading] = useState(false);
  const [editingRate, setEditingRate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // ── Actualizar tasas desde BCE ──
  const handleFetchRates = useCallback(async () => {
    setLoading(true);
    try {
      const newRates = await CurrencyService.fetchLatestRates();
      setRates(newRates);
      toast.success(`Tasas actualizadas (${newRates.date})`);
    } catch {
      toast.error('Error actualizando tasas');
    } finally { setLoading(false); }
  }, []);

  // ── Editar tasa manual ──
  const handleSaveRate = useCallback((code: string) => {
    const val = parseFloat(editValue);
    if (isNaN(val) || val <= 0) { toast.error('Valor inválido'); return; }
    const newRates = { ...rates, rates: { ...rates.rates, [code]: val }, date: new Date().toISOString().split('T')[0] };
    CurrencyService.saveRates(newRates);
    setRates(newRates);
    setEditingRate(null);
    toast.success(`Tasa ${code}/EUR actualizada`);
  }, [rates, editValue]);

  // ── Proveedores con divisa ──
  const proveedores = data.proveedores || [];
  const proveedoresForex = useMemo(() =>
    proveedores.filter(p => p.currency && p.currency !== 'EUR' && p.active !== false),
    [proveedores]
  );

  // ── Albaranes con divisa extranjera ──
  const albaranesForex = useMemo(() =>
    (data.albaranes || []).filter((a: any) => a.currency && a.currency !== 'EUR'),
    [data.albaranes]
  );

  // ── Facturas con divisa extranjera ──
  const facturasForex = useMemo(() =>
    (data.facturas || []).filter((f: any) => f.currency && f.currency !== 'EUR'),
    [data.facturas]
  );

  // ── Posiciones por divisa ──
  const posiciones = useMemo(() => {
    const map = new Map<string, {
      currency: string;
      totalOriginal: number;
      totalEUR: number;
      numDocs: number;
      proveedores: Set<string>;
      docs: { date: string; prov: string; total: number; totalEUR: number; rate: number }[];
    }>();

    // Albaranes
    albaranesForex.forEach((a: any) => {
      const cur = a.currency || 'EUR';
      const total = Math.abs(Num.parse(a.total));
      const rate = a.exchangeRate || CurrencyService.getRate(cur, 'EUR', rates);
      const totalEUR = a.totalEUR ? Math.abs(Num.parse(a.totalEUR)) : CurrencyService.toEUR(total, cur, rates);

      const prev = map.get(cur) || { currency: cur, totalOriginal: 0, totalEUR: 0, numDocs: 0, proveedores: new Set(), docs: [] };
      prev.totalOriginal += total;
      prev.totalEUR += totalEUR;
      prev.numDocs++;
      if (a.prov) prev.proveedores.add(a.prov);
      prev.docs.push({ date: a.date, prov: a.prov || '', total, totalEUR, rate });
      map.set(cur, prev);
    });

    // Facturas
    facturasForex.forEach((f: any) => {
      const cur = f.currency || 'EUR';
      const total = Math.abs(Num.parse(f.total));
      const rate = f.exchangeRate || CurrencyService.getRate(cur, 'EUR', rates);
      const totalEUR = f.totalEUR ? Math.abs(Num.parse(f.totalEUR)) : CurrencyService.toEUR(total, cur, rates);

      const prev = map.get(cur) || { currency: cur, totalOriginal: 0, totalEUR: 0, numDocs: 0, proveedores: new Set(), docs: [] };
      prev.totalOriginal += total;
      prev.totalEUR += totalEUR;
      prev.numDocs++;
      if (f.prov) prev.proveedores.add(f.prov);
      prev.docs.push({ date: f.date, prov: f.prov || '', total, totalEUR, rate });
      map.set(cur, prev);
    });

    return Array.from(map.values()).sort((a, b) => b.totalEUR - a.totalEUR);
  }, [albaranesForex, facturasForex, rates]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const totalForexEUR = posiciones.reduce((s, p) => s + p.totalEUR, 0);
    const numDivisas = posiciones.length;
    const numProvForex = new Set(proveedoresForex.map(p => p.n)).size;
    const numDocs = posiciones.reduce((s, p) => s + p.numDocs, 0);
    return { totalForexEUR, numDivisas, numProvForex, numDocs };
  }, [posiciones, proveedoresForex]);

  // ── Chart data: gasto por divisa ──
  const chartData = useMemo(() =>
    posiciones.map(p => ({
      divisa: p.currency,
      'Valor EUR': Num.round2(p.totalEUR),
    })),
    [posiciones]
  );

  // ── Export Excel ──
  const handleExport = () => {
    const headers = ['Divisa', 'Total Original', 'Tasa Cambio', 'Total EUR', 'Documentos', 'Proveedores'];
    const rows = posiciones.map(p => {
      const info = getCurrencyInfo(p.currency);
      return [
        `${info.flag} ${p.currency}`,
        p.totalOriginal.toFixed(info.decimals),
        rates.rates[p.currency]?.toFixed(4) || '1',
        p.totalEUR.toFixed(2),
        p.numDocs,
        Array.from(p.proveedores).join(', '),
      ];
    });
    const csv = [headers, ...rows].map(r => r.join('\t')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `multi_divisa_${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Conversor rápido ──
  const [convFrom, setConvFrom] = useState('JPY');
  const [convTo, setConvTo] = useState('EUR');
  const [convAmount, setConvAmount] = useState('10000');
  const convResult = useMemo(() => {
    const amt = parseFloat(convAmount) || 0;
    return CurrencyService.convert(amt, convFrom, convTo, rates);
  }, [convAmount, convFrom, convTo, rates]);

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-600" />
            Multi-Divisa
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Gestión de compras en divisa extranjera · Tasas BCE: {rates.date}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleFetchRates} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Actualizar Tasas
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition">
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border shadow-sm">
          <div className="text-xs text-gray-500 mb-1 font-medium">Gasto en Forex</div>
          <div className="text-2xl font-black text-blue-700">{Num.fmt(kpis.totalForexEUR)}</div>
          <div className="text-xs text-gray-400 mt-1">Convertido a EUR</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border shadow-sm">
          <div className="text-xs text-gray-500 mb-1 font-medium">Divisas activas</div>
          <div className="text-2xl font-black text-purple-700">{kpis.numDivisas}</div>
          <div className="text-xs text-gray-400 mt-1">Monedas diferentes</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border shadow-sm">
          <div className="text-xs text-gray-500 mb-1 font-medium">Proveedores Forex</div>
          <div className="text-2xl font-black text-emerald-700">{kpis.numProvForex}</div>
          <div className="text-xs text-gray-400 mt-1">Con divisa ≠ EUR</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border shadow-sm">
          <div className="text-xs text-gray-500 mb-1 font-medium">Documentos</div>
          <div className="text-2xl font-black text-amber-700">{kpis.numDocs}</div>
          <div className="text-xs text-gray-400 mt-1">Albaranes + facturas</div>
        </div>
      </div>

      {/* ── Tabla de tasas de cambio ── */}
      <div className="bg-white rounded-2xl border p-6">
        <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-blue-600" /> Tasas de Cambio (1 EUR = …)
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {CURRENCIES.filter(c => c.code !== 'EUR').map(c => {
            const rate = rates.rates[c.code] || 0;
            const isEditing = editingRate === c.code;
            return (
              <div key={c.code} className="bg-gray-50 rounded-xl p-3 relative group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-lg">{c.flag}</span>
                  <button onClick={() => { setEditingRate(c.code); setEditValue(String(rate)); }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-full bg-white flex items-center justify-center text-gray-400 hover:text-blue-600 transition">
                    <Edit3 className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-xs font-bold text-gray-500">{c.code}</div>
                {isEditing ? (
                  <div className="flex gap-1 mt-1">
                    <input value={editValue} onChange={e => setEditValue(e.target.value)}
                      className="w-full border rounded-lg px-2 py-1 text-sm font-mono" autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveRate(c.code); if (e.key === 'Escape') setEditingRate(null); }} />
                    <button onClick={() => handleSaveRate(c.code)}
                      className="p-1 bg-blue-600 text-white rounded-lg"><CheckCircle2 className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <div className="text-lg font-black text-gray-800 mt-1">{rate.toFixed(c.decimals === 0 ? 0 : 4)}</div>
                )}
                <div className="text-[10px] text-gray-400 mt-0.5">{c.name}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Conversor rápido ── */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
        <h4 className="font-bold text-blue-800 mb-3 text-sm flex items-center gap-2">
          <ArrowRight className="w-4 h-4" /> Conversor Rápido
        </h4>
        <div className="flex flex-wrap items-center gap-3">
          <input value={convAmount} onChange={e => setConvAmount(e.target.value)}
            type="number" className="w-32 border rounded-xl px-3 py-2 text-sm font-mono" />
          <select value={convFrom} onChange={e => setConvFrom(e.target.value)}
            className="border rounded-xl px-3 py-2 text-sm font-bold">
            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
          </select>
          <ArrowRight className="w-4 h-4 text-blue-400" />
          <select value={convTo} onChange={e => setConvTo(e.target.value)}
            className="border rounded-xl px-3 py-2 text-sm font-bold">
            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
          </select>
          <div className="bg-white rounded-xl px-4 py-2 font-bold text-blue-700 border border-blue-200">
            = {CurrencyService.format(convResult, convTo)}
          </div>
          <span className="text-xs text-blue-500">
            (1 {convFrom} = {CurrencyService.getRate(convFrom, convTo, rates).toFixed(4)} {convTo})
          </span>
        </div>
      </div>

      {/* ── Posiciones por divisa ── */}
      {posiciones.length > 0 ? (
        <>
          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-white p-6 rounded-2xl border shadow-sm">
              <h4 className="font-bold text-gray-800 mb-4">Gasto por Divisa (en EUR)</h4>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="divisa" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => Num.fmt(v)} />
                  <Bar dataKey="Valor EUR" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Detalle por divisa */}
          <div className="space-y-4">
            {posiciones.map(pos => {
              const info = getCurrencyInfo(pos.currency);
              return (
                <div key={pos.currency} className="bg-white rounded-2xl border overflow-hidden">
                  <div className="p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center text-2xl">
                          {info.flag}
                        </div>
                        <div>
                          <div className="font-bold text-gray-800">{info.name} ({info.code})</div>
                          <div className="text-xs text-gray-400">
                            {pos.numDocs} documentos · {pos.proveedores.size} proveedores
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-gray-500">
                          {CurrencyService.format(pos.totalOriginal, pos.currency)}
                        </div>
                        <div className="font-black text-blue-700 text-lg">{Num.fmt(pos.totalEUR)}</div>
                        <div className="text-[10px] text-gray-400">
                          Tasa: 1 EUR = {(rates.rates[pos.currency] || 1).toFixed(info.decimals === 0 ? 0 : 4)} {pos.currency}
                        </div>
                      </div>
                    </div>

                    {/* Documentos recientes */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-400 border-b">
                            <th className="text-left py-2 font-medium">Fecha</th>
                            <th className="text-left py-2 font-medium">Proveedor</th>
                            <th className="text-right py-2 font-medium">Original</th>
                            <th className="text-right py-2 font-medium">Tasa</th>
                            <th className="text-right py-2 font-medium">EUR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pos.docs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map((d, i) => (
                            <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                              <td className="py-2 text-gray-600">{d.date}</td>
                              <td className="py-2 text-gray-700 truncate max-w-[200px]">{d.prov || '—'}</td>
                              <td className="py-2 text-right font-mono">{CurrencyService.format(d.total, pos.currency)}</td>
                              <td className="py-2 text-right font-mono text-gray-400">{d.rate.toFixed(4)}</td>
                              <td className="py-2 text-right font-bold text-blue-700">{Num.fmt(d.totalEUR)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="bg-gray-50 rounded-2xl p-12 text-center">
          <Globe className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 font-bold">Sin operaciones en divisa extranjera</p>
          <p className="text-sm text-gray-400 mt-2">
            Asigna una divisa a tus proveedores internacionales (Japón, EE.UU., etc.) y al crear albaranes se aplicará automáticamente el tipo de cambio.
          </p>
        </div>
      )}

      {/* ── Proveedores internacionales ── */}
      {proveedoresForex.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
          <h4 className="font-bold text-purple-800 text-sm mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Proveedores Internacionales ({proveedoresForex.length})
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {proveedoresForex.map(p => {
              const info = getCurrencyInfo(p.currency || 'EUR');
              return (
                <div key={p.id} className="bg-white rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{info.flag}</span>
                    <div>
                      <div className="font-semibold text-sm text-gray-700">{p.n}</div>
                      <div className="text-[10px] text-gray-400">{p.country || info.country} · {info.code}</div>
                    </div>
                  </div>
                  <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded-lg">{info.code}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Info fiscal ── */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <strong>Normativa contable:</strong> Las operaciones en moneda extranjera deben contabilizarse al <strong>tipo de cambio de la fecha de la transacción</strong> (PGC NRV 11ª).
          Al cierre del ejercicio, las partidas en divisa se ajustan al tipo de cambio de cierre, registrando las diferencias positivas/negativas en la cuenta de pérdidas y ganancias.
        </div>
      </div>
    </div>
  );
};

export default MultiDivisaView;
