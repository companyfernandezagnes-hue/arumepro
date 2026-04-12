// ─── PresupuestoVsReal.tsx ──────────────────────────────────────────────────
// Compara objetivos (presupuesto) vs datos reales mes a mes
// El usuario define metas mensuales → la app muestra progreso
// ────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Target, TrendingUp, TrendingDown, Download, Save,
  Edit3, CheckCircle2, AlertTriangle, X
} from 'lucide-react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import { AppData } from '../types';
import { Num, ArumeEngine } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';

interface Props {
  data: AppData;
  onSave: (d: AppData) => Promise<void>;
}

interface Metas {
  ingresos: number;
  gastoMP: number;      // materia prima
  personal: number;
  estructura: number;
  neto: number;
}

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DEFAULT_METAS: Metas = { ingresos: 50000, gastoMP: 15000, personal: 15000, estructura: 8000, neto: 12000 };

const FIELDS: { key: keyof Metas; label: string; color: string; isGasto: boolean }[] = [
  { key: 'ingresos',    label: 'Ingresos',         color: 'text-indigo-600',  isGasto: false },
  { key: 'gastoMP',     label: 'Materia Prima',     color: 'text-emerald-600', isGasto: true },
  { key: 'personal',    label: 'Personal',          color: 'text-amber-600',   isGasto: true },
  { key: 'estructura',  label: 'Gastos Estructura', color: 'text-rose-600',    isGasto: true },
  { key: 'neto',        label: 'Beneficio Neto',    color: 'text-purple-600',  isGasto: false },
];

export const PresupuestoVsReal: React.FC<Props> = ({ data, onSave }) => {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [editing, setEditing] = useState(false);

  // Load saved metas from data
  const savedMetas: Record<string, Metas> = useMemo(() => {
    return (data as any).metas_mensuales || {};
  }, [data]);

  const [draftMetas, setDraftMetas] = useState<Metas>(
    savedMetas[String(year)] || DEFAULT_METAS
  );

  const metas = savedMetas[String(year)] || DEFAULT_METAS;

  const handleSaveMetas = useCallback(async () => {
    const newData = { ...data } as any;
    if (!newData.metas_mensuales) newData.metas_mensuales = {};
    newData.metas_mensuales[String(year)] = draftMetas;
    await onSave(newData);
    setEditing(false);
    toast.info('✅ Metas guardadas');
  }, [data, onSave, year, draftMetas]);

  const comparison = useMemo(() => {
    const rows: {
      mes: string; mesNum: number;
      real: Metas; meta: Metas;
      desviacion: Record<keyof Metas, number>;
      pctCumpl: Record<keyof Metas, number>;
    }[] = [];

    for (let m = 1; m <= 12; m++) {
      const p = ArumeEngine.getProfit(data, m, year);
      const real: Metas = {
        ingresos: p.ingresos?.total ?? 0,
        gastoMP: (p.gastos?.comida ?? 0) + (p.gastos?.bebida ?? 0),
        personal: p.gastos?.personal ?? 0,
        estructura: p.gastos?.estructura ?? 0,
        neto: p.neto ?? 0,
      };

      const desviacion: Record<string, number> = {};
      const pctCumpl: Record<string, number> = {};
      for (const f of FIELDS) {
        const r = real[f.key];
        const mt = metas[f.key];
        desviacion[f.key] = Num.round2(r - mt);
        if (f.isGasto) {
          // Para gastos: cumplir = gastar menos que la meta
          pctCumpl[f.key] = mt > 0 ? Num.round2((r / mt) * 100) : 0;
        } else {
          // Para ingresos/neto: cumplir = superar la meta
          pctCumpl[f.key] = mt > 0 ? Num.round2((r / mt) * 100) : 0;
        }
      }

      rows.push({
        mes: MESES[m - 1], mesNum: m,
        real, meta: { ...metas },
        desviacion: desviacion as any,
        pctCumpl: pctCumpl as any,
      });
    }

    // Acumulados
    const acumReal: Metas = { ingresos: 0, gastoMP: 0, personal: 0, estructura: 0, neto: 0 };
    const acumMeta: Metas = { ingresos: 0, gastoMP: 0, personal: 0, estructura: 0, neto: 0 };
    for (const r of rows) {
      for (const f of FIELDS) {
        acumReal[f.key] += r.real[f.key];
        acumMeta[f.key] += r.meta[f.key];
      }
    }

    // Score global: media ponderada de cumplimiento
    const mesesConDatos = rows.filter(r => r.real.ingresos > 0).length;
    const scoreIngresos = acumMeta.ingresos > 0 ? (acumReal.ingresos / acumMeta.ingresos) * 100 : 0;
    const scoreNeto = acumMeta.neto > 0 ? (acumReal.neto / acumMeta.neto) * 100 : 0;
    const scoreGlobal = Num.round2((scoreIngresos * 0.5 + scoreNeto * 0.5));

    return { rows, acumReal, acumMeta, mesesConDatos, scoreGlobal };
  }, [data, year, metas]);

  const chartData = comparison.rows.map(r => ({
    name: r.mes,
    'Meta Ingresos': metas.ingresos,
    'Real Ingresos': r.real.ingresos,
    'Meta Neto': metas.neto,
    'Real Neto': r.real.neto,
  }));

  const handleExport = () => {
    const rows = comparison.rows.map(r => {
      const row: any = { Mes: r.mes };
      for (const f of FIELDS) {
        row[`Meta ${f.label}`] = metas[f.key];
        row[`Real ${f.label}`] = Num.round2(r.real[f.key]);
        row[`Desv. ${f.label}`] = Num.round2(r.desviacion[f.key]);
        row[`% ${f.label}`] = `${r.pctCumpl[f.key]}%`;
      }
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Presupuesto vs Real');
    XLSX.writeFile(wb, `Arume_PvsR_${year}.xlsx`);
  };

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 bg-white border border-slate-100 rounded-lg p-1">
          {[year - 1, year, year + 1].filter(y => y <= new Date().getFullYear() + 1).map(y => (
            <button key={y} onClick={() => { setYear(y); setDraftMetas(savedMetas[String(y)] || DEFAULT_METAS); }}
              className={cn('px-3 py-1.5 rounded-md text-[10px] font-black transition',
                year === y ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-50')}>
              {y}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setEditing(!editing); setDraftMetas(metas); }}
            className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition',
              editing ? 'bg-slate-200 text-slate-600' : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200')}>
            {editing ? <X className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
            {editing ? 'Cancelar' : 'Editar Metas'}
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition shadow-sm">
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
      </div>

      {/* Score global */}
      <div className={cn('rounded-2xl border p-5 shadow-sm text-center',
        comparison.scoreGlobal >= 90 ? 'bg-emerald-50 border-emerald-200' :
        comparison.scoreGlobal >= 70 ? 'bg-amber-50 border-amber-200' :
        'bg-rose-50 border-rose-200')}>
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Cumplimiento Global {year}</p>
        <div className="flex items-center justify-center gap-3">
          {comparison.scoreGlobal >= 90 ? <CheckCircle2 className="w-8 h-8 text-emerald-500" /> :
           comparison.scoreGlobal >= 70 ? <Target className="w-8 h-8 text-amber-500" /> :
           <AlertTriangle className="w-8 h-8 text-rose-500" />}
          <span className={cn('text-4xl font-black tabular-nums',
            comparison.scoreGlobal >= 90 ? 'text-emerald-600' :
            comparison.scoreGlobal >= 70 ? 'text-amber-600' : 'text-rose-600')}>
            {comparison.scoreGlobal}%
          </span>
        </div>
        <p className="text-[10px] text-slate-500 font-bold mt-1">
          {comparison.mesesConDatos} meses con datos · Pondera 50% ingresos + 50% beneficio
        </p>
      </div>

      {/* Editor de metas */}
      {editing && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
          className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-4 space-y-3">
          <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Metas mensuales {year}</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {FIELDS.map(f => (
              <div key={f.key}>
                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">{f.label}</label>
                <input type="number" value={draftMetas[f.key]}
                  onChange={e => setDraftMetas({ ...draftMetas, [f.key]: Number(e.target.value) })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:border-indigo-400 transition" />
              </div>
            ))}
          </div>
          <button onClick={handleSaveMetas}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition shadow-sm">
            <Save className="w-3.5 h-3.5" /> Guardar Metas
          </button>
        </motion.div>
      )}

      {/* Chart comparativo */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Meta vs Real — Ingresos & Beneficio</p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9, fontWeight: 800, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: number) => [Num.fmt(v), '']}
                contentStyle={{ borderRadius: 12, fontSize: 11, fontWeight: 800, border: '1px solid #e2e8f0' }} />
              <Bar dataKey="Meta Ingresos" fill="#c7d2fe" radius={[3, 3, 0, 0]} barSize={12} />
              <Bar dataKey="Real Ingresos" fill="#6366f1" radius={[3, 3, 0, 0]} barSize={12} />
              <Bar dataKey="Meta Neto" fill="#bbf7d0" radius={[3, 3, 0, 0]} barSize={12} />
              <Bar dataKey="Real Neto" fill="#10b981" radius={[3, 3, 0, 0]} barSize={12} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-4 mt-2">
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-indigo-200 rounded-sm inline-block" />Meta Ing.</span>
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-indigo-500 rounded-sm inline-block" />Real Ing.</span>
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-emerald-200 rounded-sm inline-block" />Meta Neto</span>
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm inline-block" />Real Neto</span>
        </div>
      </div>

      {/* Tabla por concepto */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Acumulado {year}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                <th className="px-3 py-2 text-left">Concepto</th>
                <th className="px-3 py-2 text-right">Meta/mes</th>
                <th className="px-3 py-2 text-right">Meta acum.</th>
                <th className="px-3 py-2 text-right">Real acum.</th>
                <th className="px-3 py-2 text-right">Desviación</th>
                <th className="px-3 py-2 text-right">Cumplimiento</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map(f => {
                const metaAcum = Num.round2(metas[f.key] * 12);
                const realAcum = Num.round2(comparison.acumReal[f.key]);
                const desv = Num.round2(realAcum - metaAcum);
                const pct = metaAcum > 0 ? Num.round2((realAcum / metaAcum) * 100) : 0;
                const isGood = f.isGasto ? pct <= 100 : pct >= 100;
                return (
                  <tr key={f.key} className="border-t border-slate-50 hover:bg-slate-50/50 transition">
                    <td className={cn('px-3 py-2.5 font-black', f.color)}>{f.label}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 font-bold">{Num.fmt(metas[f.key])}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 font-bold">{Num.fmt(metaAcum)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800 font-black">{Num.fmt(realAcum)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums font-bold',
                      f.isGasto ? (desv > 0 ? 'text-rose-500' : 'text-emerald-500') : (desv >= 0 ? 'text-emerald-500' : 'text-rose-500'))}>
                      {desv >= 0 ? '+' : ''}{Num.fmt(desv)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', isGood ? 'bg-emerald-400' : 'bg-rose-400')}
                            style={{ width: `${Math.min(pct, 150)}%` }} />
                        </div>
                        <span className={cn('text-[10px] font-black tabular-nums', isGood ? 'text-emerald-600' : 'text-rose-600')}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabla mensual detallada - Ingresos */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Detalle mensual — Ingresos</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase">
                <th className="px-3 py-2 text-left">Mes</th>
                <th className="px-3 py-2 text-right">Meta</th>
                <th className="px-3 py-2 text-right">Real</th>
                <th className="px-3 py-2 text-right">Desv.</th>
                <th className="px-3 py-2 text-center">%</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((r, i) => {
                const pct = r.pctCumpl.ingresos;
                return (
                  <tr key={i} className={cn('border-t border-slate-50', r.real.ingresos === 0 && 'opacity-30')}>
                    <td className="px-3 py-2 font-black text-slate-700">{r.mes}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">{Num.fmt(metas.ingresos)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800 font-bold">{Num.fmt(r.real.ingresos)}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums font-bold',
                      r.desviacion.ingresos >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                      {r.desviacion.ingresos >= 0 ? '+' : ''}{Num.fmt(r.desviacion.ingresos)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        {pct >= 100 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <TrendingDown className="w-3 h-3 text-rose-500" />}
                        <span className={cn('text-[10px] font-black', pct >= 100 ? 'text-emerald-600' : 'text-rose-500')}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800">
        <p className="font-black mb-1">📊 ¿Cómo usar Presupuesto vs Real?</p>
        <ul className="space-y-0.5 text-[11px] text-blue-700">
          <li>• Haz clic en <b>"Editar Metas"</b> para definir tus objetivos mensuales</li>
          <li>• Los ingresos y beneficio se miden si <b>superan</b> la meta (≥100% = bien)</li>
          <li>• Los gastos se miden si <b>no superan</b> la meta (≤100% = bien)</li>
          <li>• El <b>score global</b> pondera 50% ingresos + 50% beneficio neto</li>
          <li>• Revisa las desviaciones para ajustar metas al trimestre siguiente</li>
        </ul>
      </div>
    </div>
  );
};
