/**
 * Modelo303View.tsx
 * Liquidación IVA trimestral — Modelo 303 AEAT
 * Calcula IVA repercutido (ventas) y soportado (compras) por trimestre,
 * muestra la liquidación y exporta Excel para la gestoría.
 *
 * INTEGRACIÓN en ReportsView.tsx:
 * 1. Añadir al import: import { Modelo303View } from './Modelo303View';
 * 2. Añadir a TABS:    { id: 'modelo303', label: 'IVA 303', icon: Receipt }
 * 3. Añadir tipo:      type TabType = 'resultados' | 'fiscal' | 'kpis' | 'carpeta' | 'modelo303';
 * 4. Añadir tab JSX:   {activeTab === 'modelo303' && <Modelo303View data={data} />}
 */
import React, { useState, useMemo } from 'react';
import {
  Receipt, Download, ChevronLeft, ChevronRight,
  CheckCircle2, AlertTriangle, Info, TrendingUp,
  TrendingDown, Loader2, FileText, ShieldCheck
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData } from '../types';

// ── Tipos ──────────────────────────────────────────────────────────────────
interface IVALinea {
  tipo  : 4 | 10 | 21;
  base  : number;
  cuota : number;
}

interface Trimestre {
  label       : string;
  q           : number;
  year        : number;
  meses       : number[];
  deadlineISO : string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const IVA_RATES = [4, 10, 21] as const;

const getIVARate = (f: any): 4 | 10 | 21 => {
  const tax  = Num.parse(f.tax ?? f.iva ?? 0);
  const base = Num.parse(f.base ?? 0);
  if (tax > 0 && base > 0) {
    const pct = Math.round((tax / base) * 100);
    if (pct <= 5)  return 4;
    if (pct <= 12) return 10;
    return 21;
  }
  const cat = String(f.cat || f.categoria || f.prov || '').toLowerCase();
  if (cat.match(/bebida|alcohol|vino|licor|sake/)) return 21;
  return 10;
};

const inferBase = (f: any): number => {
  const base  = Num.parse(f.base ?? 0);
  const total = Num.parse(f.total ?? 0);
  const tax   = Num.parse(f.tax ?? f.iva ?? 0);
  if (base > 0)             return base;
  if (total > 0 && tax > 0) return Num.round2(total - tax);
  if (total > 0)            return Num.round2(total / 1.10);
  return 0;
};

const inferCuota = (f: any): number => {
  const tax  = Num.parse(f.tax ?? f.iva ?? 0);
  const base = inferBase(f);
  if (tax > 0) return tax;
  const rate = getIVARate(f);
  return Num.round2(base * (rate / 100));
};

const buildTrimesters = (year: number): Trimestre[] => [
  { label: `T1 ${year}`, q: 1, year, meses: [0, 1, 2],  deadlineISO: `${year}-04-20`     },
  { label: `T2 ${year}`, q: 2, year, meses: [3, 4, 5],  deadlineISO: `${year}-07-20`     },
  { label: `T3 ${year}`, q: 3, year, meses: [6, 7, 8],  deadlineISO: `${year}-10-20`     },
  { label: `T4 ${year}`, q: 4, year, meses: [9, 10, 11],deadlineISO: `${year + 1}-01-20` },
];

// ══════════════════════════════════════════════════════════════════════════════
export const Modelo303View: React.FC<{ data: AppData }> = ({ data }) => {
  const now    = new Date();
  const [selYear,   setSelYear]   = useState(now.getFullYear());
  const [selQ,      setSelQ]      = useState(Math.floor(now.getMonth() / 3) + 1);
  const [exporting, setExporting] = useState(false);

  const trimesters = useMemo(() => buildTrimesters(selYear), [selYear]);
  const trimestre  = trimesters[selQ - 1];

  // ── Calcula IVA repercutido (ventas) y soportado (compras) ──────────────
  const calculo = useMemo(() => {
    const safe     = data || {};
    const facturas = Array.isArray(safe.facturas) ? safe.facturas : [];
    const cierres  = Array.isArray(safe.cierres)  ? safe.cierres  : [];
    const meses    = trimestre.meses;

    const inMes = (dateStr?: string) => {
      if (!dateStr) return false;
      const d = DateUtil.parse(dateStr);
      return d.getFullYear() === selYear && meses.includes(d.getMonth());
    };

    // ── IVA Repercutido (Ventas) ───────────────────────────────────────
    const rep: Record<number, IVALinea> = {
      4 : { tipo: 4,  base: 0, cuota: 0 },
      10: { tipo: 10, base: 0, cuota: 0 },
      21: { tipo: 21, base: 0, cuota: 0 },
    };

    facturas.filter(f => f.tipo === 'venta' && inMes(f.date)).forEach(f => {
      const rate  = getIVARate(f);
      rep[rate].base  += inferBase(f);
      rep[rate].cuota += inferCuota(f);
    });

    // Cierres de caja (Z) — todo a 10%
    cierres.filter(c => inMes((c as any).date)).forEach(c => {
      const total = Num.parse(
        (c as any).totalVenta ?? (c as any).totalVentas ??
        (c as any).total_calculado ?? (c as any).total ?? 0
      );
      if (total <= 0) return;
      const base  = Num.round2(total / 1.10);
      const cuota = Num.round2(total - base);
      rep[10].base  += base;
      rep[10].cuota += cuota;
    });

    // ── IVA Soportado (Compras deducibles) ────────────────────────────
    const sop: Record<number, IVALinea> = {
      4 : { tipo: 4,  base: 0, cuota: 0 },
      10: { tipo: 10, base: 0, cuota: 0 },
      21: { tipo: 21, base: 0, cuota: 0 },
    };

    facturas.filter(f => f.tipo === 'compra' && inMes(f.date)).forEach(f => {
      const rate  = getIVARate(f);
      sop[rate].base  += inferBase(f);
      sop[rate].cuota += inferCuota(f);
    });

    // Albaranes sin facturar
    const albaranes     = Array.isArray(safe.albaranes) ? safe.albaranes : [];
    const facturadosIds = new Set(
      facturas.flatMap(f => Array.isArray((f as any).albaranIdsArr) ? (f as any).albaranIdsArr.map(String) : [])
    );
    albaranes
      .filter(a => !facturadosIds.has(String(a.id)) && inMes(a.date))
      .forEach(a => {
        const total = Num.parse((a as any).total ?? 0);
        if (total <= 0) return;
        const base  = Num.round2(total / 1.10);
        const cuota = Num.round2(total - base);
        sop[10].base  += base;
        sop[10].cuota += cuota;
      });

    // ── Totales ───────────────────────────────────────────────────────
    const totalRepBase  = Num.round2(Object.values(rep).reduce((s, l) => s + l.base,  0));
    const totalRepCuota = Num.round2(Object.values(rep).reduce((s, l) => s + l.cuota, 0));
    const totalSopBase  = Num.round2(Object.values(sop).reduce((s, l) => s + l.base,  0));
    const totalSopCuota = Num.round2(Object.values(sop).reduce((s, l) => s + l.cuota, 0));
    const liquidacion   = Num.round2(totalRepCuota - totalSopCuota);

    // IRPF estimado (15% retención sobre base facturas B2B)
    const facturasB2B = facturas.filter(f =>
      f.tipo === 'venta' && inMes(f.date) && f.cliente &&
      f.cliente !== 'Z DIARIO' && f.cliente !== 'Z DIARIO AUTO'
    );
    const baseB2B      = facturasB2B.reduce((s, f) => s + inferBase(f), 0);
    const irpfEstimado = Num.round2(baseB2B * 0.15);

    const deadline = new Date(trimestre.deadlineISO);
    const daysLeft = Math.round((deadline.getTime() - now.getTime()) / 86_400_000);

    return {
      repercutido: rep,
      soportado  : sop,
      totalRepBase, totalRepCuota,
      totalSopBase, totalSopCuota,
      liquidacion,
      baseB2B, irpfEstimado,
      deadline, daysLeft,
    };
  }, [data, trimestre, selYear]);

  // ── Exportar Excel gestoría ─────────────────────────────────────────────
  const exportar = () => {
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const label = trimestre.label;

      // Hoja 1: Resumen 303
      const rows303 = [
        { '': `MODELO 303 — LIQUIDACIÓN IVA ${label}`, Importe: '' },
        { '': '', Importe: '' },
        { '': '— IVA REPERCUTIDO (VENTAS) —', Importe: '' },
        ...IVA_RATES.map(r => ({ '': `Base imponible ${r}%`,  Importe: Num.round2(calculo.repercutido[r].base)  })),
        ...IVA_RATES.map(r => ({ '': `Cuota IVA ${r}%`,       Importe: Num.round2(calculo.repercutido[r].cuota) })),
        { '': 'TOTAL BASE REPERCUTIDA', Importe: calculo.totalRepBase  },
        { '': 'TOTAL CUOTA DEVENGADA',  Importe: calculo.totalRepCuota },
        { '': '', Importe: '' },
        { '': '— IVA SOPORTADO (COMPRAS DEDUCIBLES) —', Importe: '' },
        ...IVA_RATES.map(r => ({ '': `Base deducible ${r}%`,  Importe: Num.round2(calculo.soportado[r].base)  })),
        ...IVA_RATES.map(r => ({ '': `Cuota deducible ${r}%`, Importe: Num.round2(calculo.soportado[r].cuota) })),
        { '': 'TOTAL BASE SOPORTADA',   Importe: calculo.totalSopBase  },
        { '': 'TOTAL CUOTA DEDUCIBLE',  Importe: calculo.totalSopCuota },
        { '': '', Importe: '' },
        { '': '✅ RESULTADO LIQUIDACIÓN IVA',    Importe: calculo.liquidacion  },
        { '': 'RETENCIÓN IRPF ESTIMADA (15%)', Importe: calculo.irpfEstimado },
      ];
      const ws303 = XLSX.utils.json_to_sheet(rows303);
      ws303['!cols'] = [{ wch: 42 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws303, `303_${label.replace(' ', '_')}`);

      // Hoja 2: Facturas venta
      const fVentas = (data?.facturas || [])
        .filter(f => f.tipo === 'venta')
        .filter(f => {
          const d = DateUtil.parse(f.date);
          return d.getFullYear() === selYear && trimestre.meses.includes(d.getMonth());
        })
        .map(f => ({
          'FECHA'  : f.date,
          'Nº FAC' : f.num || 'S/N',
          'CLIENTE': f.cliente || f.prov || '—',
          'BASE'   : inferBase(f),
          'IVA'    : inferCuota(f),
          'TOTAL'  : Num.parse(f.total ?? 0),
          'TIPO %' : getIVARate(f),
        }));
      if (fVentas.length > 0) {
        const wsV = XLSX.utils.json_to_sheet(fVentas);
        wsV['!cols'] = [{wch:12},{wch:14},{wch:28},{wch:14},{wch:12},{wch:14},{wch:8}];
        XLSX.utils.book_append_sheet(wb, wsV, 'Ventas');
      }

      // Hoja 3: Facturas compra
      const fCompras = (data?.facturas || [])
        .filter(f => f.tipo === 'compra')
        .filter(f => {
          const d = DateUtil.parse(f.date);
          return d.getFullYear() === selYear && trimestre.meses.includes(d.getMonth());
        })
        .map(f => ({
          'FECHA'          : f.date,
          'Nº FAC'         : f.num || 'S/N',
          'PROVEEDOR'      : f.prov || '—',
          'BASE'           : inferBase(f),
          'IVA SOPORTADO'  : inferCuota(f),
          'TOTAL'          : Num.parse(f.total ?? 0),
          'DEDUCIBLE'      : 'SÍ',
        }));
      if (fCompras.length > 0) {
        const wsC = XLSX.utils.json_to_sheet(fCompras);
        wsC['!cols'] = [{wch:12},{wch:14},{wch:28},{wch:14},{wch:18},{wch:14},{wch:12}];
        XLSX.utils.book_append_sheet(wb, wsC, 'Compras');
      }

      XLSX.writeFile(wb, `Arume_303_${label.replace(' ', '_')}.xlsx`);
    } catch (e) {
      alert('Error al exportar: ' + (e as any).message);
    } finally {
      setExporting(false);
    }
  };

  const urgente = calculo.daysLeft >= 0 && calculo.daysLeft <= 7;
  const proximo = calculo.daysLeft >= 0 && calculo.daysLeft <= 20;

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-sm">
            <Receipt className="w-5 h-5 text-white"/>
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Modelo 303 — Liquidación IVA</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Vence: {trimestre.deadlineISO}
              {urgente && <span className="ml-2 text-rose-600 font-black">⚠️ URGENTE</span>}
              {!urgente && proximo && <span className="ml-2 text-amber-600 font-black">· {calculo.daysLeft} días</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Selector trimestre */}
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => { if (selQ === 1) { setSelQ(4); setSelYear(y => y - 1); } else setSelQ(q => q - 1); }}
              className="p-1.5 bg-white rounded-md shadow-sm hover:bg-slate-50 transition"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-slate-600"/>
            </button>
            <span className="text-xs font-black text-slate-700 min-w-[72px] text-center">{trimestre.label}</span>
            <button
              onClick={() => { if (selQ === 4) { setSelQ(1); setSelYear(y => y + 1); } else setSelQ(q => q + 1); }}
              className="p-1.5 bg-white rounded-md shadow-sm hover:bg-slate-50 transition"
            >
              <ChevronRight className="w-3.5 h-3.5 text-slate-600"/>
            </button>
          </div>

          <button
            onClick={exportar}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-black text-[11px] uppercase tracking-widest hover:bg-emerald-700 transition shadow-sm disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Download className="w-3.5 h-3.5"/>}
            Excel Gestoría
          </button>
        </div>
      </div>

      {/* ── RESULTADO PRINCIPAL ─────────────────────────────────────────── */}
      <div className={cn(
        'rounded-xl p-5 border flex items-center justify-between gap-4 flex-wrap',
        calculo.liquidacion > 0
          ? 'bg-rose-50 border-rose-200'
          : calculo.liquidacion < 0
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-slate-50 border-slate-200'
      )}>
        <div>
          <p className={cn('text-[10px] font-black uppercase tracking-widest mb-1',
            calculo.liquidacion > 0 ? 'text-rose-500' : calculo.liquidacion < 0 ? 'text-emerald-600' : 'text-slate-500')}>
            {calculo.liquidacion > 0 ? '💳 A Ingresar (Hacienda)' : calculo.liquidacion < 0 ? '💰 A Devolver (Crédito)' : '✅ Resultado Cero'}
          </p>
          <p className={cn('text-4xl font-black tracking-tighter',
            calculo.liquidacion > 0 ? 'text-rose-700' : calculo.liquidacion < 0 ? 'text-emerald-700' : 'text-slate-700')}>
            {Num.fmt(Math.abs(calculo.liquidacion))}
          </p>
          <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">
            Modelo 303 · {trimestre.label}
          </p>
        </div>

        <div className="flex gap-4 flex-wrap">
          <div className="text-right">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">IVA Devengado</p>
            <p className="text-xl font-black text-rose-600">{Num.fmt(calculo.totalRepCuota)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">IVA Deducible</p>
            <p className="text-xl font-black text-emerald-600">{Num.fmt(calculo.totalSopCuota)}</p>
          </div>
        </div>
      </div>

      {/* ── DESGLOSE TABLAS ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* IVA Repercutido */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-rose-50">
            <TrendingUp className="w-4 h-4 text-rose-500"/>
            <h4 className="text-xs font-black text-rose-700 uppercase tracking-widest">IVA Repercutido (Ventas)</h4>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-2 text-left   text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</th>
                <th className="px-4 py-2 text-right  text-[10px] font-black text-slate-400 uppercase tracking-widest">Base</th>
                <th className="px-4 py-2 text-right  text-[10px] font-black text-slate-400 uppercase tracking-widest">Cuota</th>
              </tr>
            </thead>
            <tbody>
              {IVA_RATES.map(r => (
                <tr key={r} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-bold text-slate-600">IVA {r}%</td>
                  <td className="px-4 py-2.5 text-right font-bold  text-slate-700 tabular-nums">{Num.fmt(calculo.repercutido[r].base)}</td>
                  <td className="px-4 py-2.5 text-right font-black text-rose-600   tabular-nums">{Num.fmt(calculo.repercutido[r].cuota)}</td>
                </tr>
              ))}
              <tr className="bg-rose-50">
                <td className="px-4 py-3 font-black text-slate-800 uppercase text-[10px] tracking-widest">Total</td>
                <td className="px-4 py-3 text-right font-black text-slate-800 tabular-nums">{Num.fmt(calculo.totalRepBase)}</td>
                <td className="px-4 py-3 text-right font-black text-rose-700  tabular-nums">{Num.fmt(calculo.totalRepCuota)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* IVA Soportado */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-emerald-50">
            <TrendingDown className="w-4 h-4 text-emerald-600"/>
            <h4 className="text-xs font-black text-emerald-700 uppercase tracking-widest">IVA Soportado (Compras Deducibles)</h4>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-2 text-left  text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</th>
                <th className="px-4 py-2 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Base</th>
                <th className="px-4 py-2 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Cuota</th>
              </tr>
            </thead>
            <tbody>
              {IVA_RATES.map(r => (
                <tr key={r} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-bold text-slate-600">IVA {r}%</td>
                  <td className="px-4 py-2.5 text-right font-bold  text-slate-700  tabular-nums">{Num.fmt(calculo.soportado[r].base)}</td>
                  <td className="px-4 py-2.5 text-right font-black text-emerald-600 tabular-nums">{Num.fmt(calculo.soportado[r].cuota)}</td>
                </tr>
              ))}
              <tr className="bg-emerald-50">
                <td className="px-4 py-3 font-black text-slate-800 uppercase text-[10px] tracking-widest">Total</td>
                <td className="px-4 py-3 text-right font-black text-slate-800   tabular-nums">{Num.fmt(calculo.totalSopBase)}</td>
                <td className="px-4 py-3 text-right font-black text-emerald-700 tabular-nums">{Num.fmt(calculo.totalSopCuota)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── IRPF + AVISO ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5"/>
          <div>
            <p className="text-xs font-black text-indigo-800 uppercase tracking-widest">IRPF Estimado (Ret. 15%)</p>
            <p className="text-2xl font-black text-indigo-700 mt-1">{Num.fmt(calculo.irpfEstimado)}</p>
            <p className="text-[10px] font-bold text-indigo-500 mt-1">
              Sobre base B2B: {Num.fmt(calculo.baseB2B)} · Solo facturas a empresas
            </p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"/>
          <div>
            <p className="text-xs font-black text-amber-800 uppercase tracking-widest">Aviso Legal</p>
            <p className="text-[11px] font-medium text-amber-700 mt-1 leading-relaxed">
              Estos cálculos son estimaciones orientativas basadas en los datos registrados en Arume PRO.
              El modelo 303 oficial debe ser revisado y presentado por tu gestoría.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
