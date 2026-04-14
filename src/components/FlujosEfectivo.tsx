// ─── FlujosEfectivo.tsx ─────────────────────────────────────────────────────
// Estado de Flujos de Efectivo (Cash Flow Statement)
// Clasifica movimientos en: Operaciones, Inversión, Financiación
// ────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowUpRight, ArrowDownRight, Minus, Download, TrendingUp, TrendingDown,
  Wallet, Building2, Landmark, CircleDollarSign
} from 'lucide-react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import { AppData } from '../types';
import { Num, ArumeEngine } from '../services/engine';
import { cn } from '../lib/utils';

interface Props { data: AppData; }

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

export const FlujosEfectivo: React.FC<Props> = ({ data }) => {
  const [year, setYear] = useState(() => new Date().getFullYear());

  const years = useMemo(() => {
    const ys = new Set<number>();
    (data.banco || []).forEach((b: any) => {
      const y = parseInt(String(b.date || '').slice(0, 4));
      if (y > 2000) ys.add(y);
    });
    (data.cierres || []).forEach((c: any) => {
      const y = parseInt(String(c.date || '').slice(0, 4));
      if (y > 2000) ys.add(y);
    });
    if (ys.size === 0) ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [data.banco, data.cierres]);

  const flujos = useMemo(() => {
    // Datos mensuales
    const monthly: {
      mes: string; mesNum: number;
      operaciones: number; inversion: number; financiacion: number;
      netoCaja: number;
      detalleOp: { ingresos: number; compras: number; personal: number; gfijos: number };
    }[] = [];

    for (let m = 1; m <= 12; m++) {
      const p = ArumeEngine.getProfit(data, m, year);
      const ing = p.ingresos?.total ?? 0;
      const compras = (p.gastos?.comida ?? 0) + (p.gastos?.bebida ?? 0) + (p.gastos?.otros ?? 0);
      const personal = p.gastos?.personal ?? 0;
      const estructura = p.gastos?.estructura ?? 0;

      // OPERACIONES: ingresos - compras - personal - gastos fijos
      const operaciones = Num.round2(ing - compras - personal - estructura);

      // INVERSIÓN: activos fijos comprados este mes
      const mesKey = `${year}-${String(m).padStart(2, '0')}`;
      const activosMes = ((data as any).activos_fijos || []).filter((a: any) =>
        String(a.fecha || a.date || '').startsWith(mesKey)
      );
      const inversion = Num.round2(
        -activosMes.reduce((s: number, a: any) => s + Math.abs(Num.parse(a.importe ?? a.amount ?? 0)), 0)
      );

      // FINANCIACIÓN: movimientos banco con categoría préstamo/financiación
      const movsFinanc = (data.banco || []).filter((b: any) => {
        if (!String(b.date || '').startsWith(mesKey)) return false;
        const cat = (b.category || b.desc || '').toLowerCase();
        return cat.includes('préstamo') || cat.includes('prestamo') ||
               cat.includes('crédito') || cat.includes('credito') ||
               cat.includes('financiación') || cat.includes('financiacion') ||
               cat.includes('capital') || cat.includes('dividendo') ||
               cat.includes('subvención') || cat.includes('subvencion');
      });
      const financiacion = Num.round2(
        movsFinanc.reduce((s: number, b: any) => s + Num.parse(b.amount || 0), 0)
      );

      const netoCaja = Num.round2(operaciones + inversion + financiacion);

      monthly.push({
        mes: MESES[m - 1],
        mesNum: m,
        operaciones,
        inversion,
        financiacion,
        netoCaja,
        detalleOp: { ingresos: ing, compras, personal, gfijos: estructura },
      });
    }

    // Totales anuales
    const totalOp = Num.round2(monthly.reduce((s, m) => s + m.operaciones, 0));
    const totalInv = Num.round2(monthly.reduce((s, m) => s + m.inversion, 0));
    const totalFin = Num.round2(monthly.reduce((s, m) => s + m.financiacion, 0));
    const totalNeto = Num.round2(totalOp + totalInv + totalFin);

    // Saldo banco inicio vs fin
    const saldoInicial = Num.parse(data.config?.saldoInicial || 0);
    const saldoFinal = Num.round2(saldoInicial + totalNeto);

    return { monthly, totalOp, totalInv, totalFin, totalNeto, saldoInicial, saldoFinal };
  }, [data, year]);

  const chartData = flujos.monthly.map(m => ({
    name: m.mes,
    Operaciones: m.operaciones,
    Inversión: m.inversion,
    Financiación: m.financiacion,
  }));

  const handleExport = () => {
    const rows = flujos.monthly.map(m => ({
      Mes: m.mes,
      'Ingresos operativos': m.detalleOp.ingresos,
      'Compras': -m.detalleOp.compras,
      'Personal': -m.detalleOp.personal,
      'Gastos fijos': -m.detalleOp.gfijos,
      'Flujo Operaciones': m.operaciones,
      'Flujo Inversión': m.inversion,
      'Flujo Financiación': m.financiacion,
      'Flujo Neto': m.netoCaja,
    }));
    rows.push({
      Mes: 'TOTAL',
      'Ingresos operativos': 0, Compras: 0, Personal: 0, 'Gastos fijos': 0,
      'Flujo Operaciones': flujos.totalOp,
      'Flujo Inversión': flujos.totalInv,
      'Flujo Financiación': flujos.totalFin,
      'Flujo Neto': flujos.totalNeto,
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Array(9).fill({ wch: 16 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Flujos Efectivo');
    XLSX.writeFile(wb, `Arume_Flujos_Efectivo_${year}.xlsx`);
  };

  const FlowCard = ({ label, value, icon: Icon, color, bgColor }: any) => (
    <div className={cn('rounded-2xl border p-4 shadow-sm', bgColor)}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('w-4 h-4', color)} />
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      </div>
      <p className={cn('text-xl font-black tabular-nums', value >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
        {value >= 0 ? '+' : ''}{Num.fmt(value)}
      </p>
    </div>
  );

  return (
    <div className="space-y-3">

      {/* Year selector + export */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-white border border-slate-100 rounded-lg p-1">
          {years.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={cn('px-3 py-1.5 rounded-md text-[10px] font-black transition',
                year === y ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-50')}>
              {y}
            </button>
          ))}
        </div>
        <button onClick={handleExport}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition shadow-sm">
          <Download className="w-3.5 h-3.5" /> Excel
        </button>
      </div>

      {/* 4 KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <FlowCard label="Operaciones" value={flujos.totalOp} icon={Wallet} color="text-indigo-500" bgColor="bg-white border-slate-100" />
        <FlowCard label="Inversión" value={flujos.totalInv} icon={Building2} color="text-amber-500" bgColor="bg-white border-slate-100" />
        <FlowCard label="Financiación" value={flujos.totalFin} icon={Landmark} color="text-purple-500" bgColor="bg-white border-slate-100" />
        <FlowCard label="Flujo Neto" value={flujos.totalNeto} icon={CircleDollarSign}
          color={flujos.totalNeto >= 0 ? 'text-emerald-500' : 'text-rose-500'}
          bgColor={flujos.totalNeto >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'} />
      </div>

      {/* Saldo inicio → fin */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center justify-between">
        <div className="text-center">
          <p className="text-[9px] font-black text-slate-400 uppercase">Saldo Inicial</p>
          <p className="text-lg font-black text-slate-800 tabular-nums">{Num.fmt(flujos.saldoInicial)}</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          {flujos.totalNeto >= 0
            ? <ArrowUpRight className="w-6 h-6 text-emerald-500" />
            : <ArrowDownRight className="w-6 h-6 text-rose-500" />}
          <span className={cn('text-sm font-black', flujos.totalNeto >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
            {flujos.totalNeto >= 0 ? '+' : ''}{Num.fmt(flujos.totalNeto)}
          </span>
        </div>
        <div className="text-center">
          <p className="text-[9px] font-black text-slate-400 uppercase">Saldo Final Est.</p>
          <p className={cn('text-lg font-black tabular-nums', flujos.saldoFinal >= 0 ? 'text-emerald-700' : 'text-rose-600')}>
            {Num.fmt(flujos.saldoFinal)}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Flujos mensuales</p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9, fontWeight: 800, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: number) => [Num.fmt(v), '']}
                contentStyle={{ borderRadius: 12, fontSize: 11, fontWeight: 800, border: '1px solid #e2e8f0' }} />
              <Bar dataKey="Operaciones" fill="#6366f1" radius={[3, 3, 0, 0]} barSize={14} />
              <Bar dataKey="Inversión" fill="#f59e0b" radius={[3, 3, 0, 0]} barSize={14} />
              <Bar dataKey="Financiación" fill="#8b5cf6" radius={[3, 3, 0, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-4 mt-2">
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-indigo-500 rounded-sm inline-block" />Operaciones</span>
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-amber-500 rounded-sm inline-block" />Inversión</span>
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-purple-500 rounded-sm inline-block" />Financiación</span>
        </div>
      </div>

      {/* Tabla detallada */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Detalle mensual</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                <th className="px-3 py-2 text-left">Mes</th>
                <th className="px-3 py-2 text-right text-indigo-500">Operaciones</th>
                <th className="px-3 py-2 text-right text-amber-500">Inversión</th>
                <th className="px-3 py-2 text-right text-purple-500">Financiación</th>
                <th className="px-3 py-2 text-right">Flujo Neto</th>
              </tr>
            </thead>
            <tbody>
              {flujos.monthly.map((m, i) => (
                <tr key={i} className={cn('border-t border-slate-50 hover:bg-slate-50/50 transition',
                  m.operaciones === 0 && m.inversion === 0 && m.financiacion === 0 && 'opacity-30')}>
                  <td className="px-3 py-2 font-black text-slate-700">{m.mes}</td>
                  <td className={cn('px-3 py-2 text-right tabular-nums font-bold', m.operaciones >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                    {Num.fmt(m.operaciones)}
                  </td>
                  <td className={cn('px-3 py-2 text-right tabular-nums font-bold', m.inversion >= 0 ? 'text-emerald-600' : 'text-amber-600')}>
                    {m.inversion !== 0 ? Num.fmt(m.inversion) : '—'}
                  </td>
                  <td className={cn('px-3 py-2 text-right tabular-nums font-bold', m.financiacion >= 0 ? 'text-purple-600' : 'text-rose-600')}>
                    {m.financiacion !== 0 ? Num.fmt(m.financiacion) : '—'}
                  </td>
                  <td className={cn('px-3 py-2 text-right tabular-nums font-black', m.netoCaja >= 0 ? 'text-emerald-700' : 'text-rose-600')}>
                    {Num.fmt(m.netoCaja)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-800 text-white text-[10px] font-black">
                <td className="px-3 py-2.5">TOTAL {year}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{Num.fmt(flujos.totalOp)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{Num.fmt(flujos.totalInv)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{Num.fmt(flujos.totalFin)}</td>
                <td className={cn('px-3 py-2.5 text-right tabular-nums', flujos.totalNeto >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                  {Num.fmt(flujos.totalNeto)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800">
        <p className="font-black mb-1">💧 ¿Qué son los Flujos de Efectivo?</p>
        <ul className="space-y-0.5 text-[11px] text-blue-700">
          <li>• <b>Operaciones</b>: dinero del negocio diario (ventas - compras - personal - gastos)</li>
          <li>• <b>Inversión</b>: compra de equipos, mobiliario, reformas</li>
          <li>• <b>Financiación</b>: préstamos, créditos, aportaciones de socios</li>
          <li>• <b>Flujo Neto</b>: suma de los tres. Positivo = generas caja, Negativo = la consumes</li>
          <li>• Un negocio sano genera flujo positivo de operaciones consistentemente</li>
        </ul>
      </div>
    </div>
  );
};
