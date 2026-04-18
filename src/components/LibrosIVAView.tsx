/**
 * LibrosIVAView.tsx — Libros Oficiales de IVA
 * ─────────────────────────────────────────────
 * Libro de Facturas Emitidas (ventas) y Recibidas (compras)
 * según normativa AEAT. Exportable en Excel para la gestoría.
 *
 * Datos:
 *  - Facturas tipo='venta' → Libro de Emitidas
 *  - Facturas tipo='compra' + albaranes pagados → Libro de Recibidas
 *  - Cierres Z → Ventas en efectivo/tarjeta (IVA 10% restauración)
 */
import React, { useMemo, useState } from 'react';
import {
  BookOpen, Download, ChevronLeft, ChevronRight, Search,
  FileText, Receipt, ArrowUpRight, ArrowDownRight,
  CheckCircle2, AlertTriangle, Filter, Building2
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData } from '../types';
import { toast } from '../hooks/useToast';

/* ── Helpers IVA ─────────────────────────────────────────────── */
const IVA_RATES = [4, 10, 21] as const;

const getIVARate = (f: any): number => {
  const tax  = Num.parse(f.tax ?? f.iva ?? f.taxes ?? 0);
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
  const tax   = Num.parse(f.tax ?? f.iva ?? f.taxes ?? 0);
  if (base > 0)             return base;
  if (total > 0 && tax > 0) return Num.round2(total - tax);
  if (total > 0)            return Num.round2(total / 1.10);
  return 0;
};

const inferCuota = (f: any): number => {
  const tax  = Num.parse(f.tax ?? f.iva ?? f.taxes ?? 0);
  if (tax > 0) return tax;
  const base = inferBase(f);
  const rate = getIVARate(f);
  return Num.round2(base * (rate / 100));
};

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const QUARTERS = ['T1 (Ene-Mar)', 'T2 (Abr-Jun)', 'T3 (Jul-Sep)', 'T4 (Oct-Dic)'];

/* ── Tipo de registro ────────────────────────────────────────── */
interface RegistroIVA {
  fecha: string;
  numFactura: string;
  nombre: string;         // proveedor o cliente
  nif: string;
  base: number;
  tipoIVA: number;        // 4, 10, 21
  cuotaIVA: number;
  total: number;
  pagado: boolean;
  unidad: string;
  origen: string;         // factura | albaran | cierre
  irpfPct?: number;       // % retención IRPF
  irpfAmount?: number;    // importe retención
}

/* ══════════════════════════════════════════════════════════════ */
export const LibrosIVAView: React.FC<{ data: AppData }> = ({ data }) => {
  const now = new Date();
  const [year, setYear]         = useState(now.getFullYear());
  const [quarter, setQuarter]   = useState<number | null>(null); // null = todo el año
  const [tab, setTab]           = useState<'emitidas' | 'recibidas'>('recibidas');
  const [search, setSearch]     = useState('');

  /* ── Filtro de fecha ─────────────────────────────────────── */
  const inPeriod = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (d.getFullYear() !== year) return false;
    if (quarter === null) return true;
    const m = d.getMonth();
    const qStart = (quarter - 1) * 3;
    return m >= qStart && m < qStart + 3;
  };

  /* ── Construir registros ─────────────────────────────────── */
  const { emitidas, recibidas } = useMemo(() => {
    const safe     = data || {};
    const facturas = Array.isArray(safe.facturas)  ? safe.facturas  : [];
    const albaranes= Array.isArray(safe.albaranes) ? safe.albaranes : [];
    const cierres  = Array.isArray(safe.cierres)   ? safe.cierres   : [];

    const emit: RegistroIVA[] = [];
    const recv: RegistroIVA[] = [];

    // ─── Facturas ───
    for (const f of facturas as any[]) {
      if (!inPeriod(f.date)) continue;
      const base  = inferBase(f);
      const cuota = inferCuota(f);
      const total = Num.parse(f.total ?? 0);
      const rate  = getIVARate(f);

      const irpfPct = Num.parse((f as any).irpfPct || 0);
      const irpfAmt = irpfPct > 0 ? Num.round2(base * irpfPct / 100) : Num.parse((f as any).irpfAmount || 0);

      const reg: RegistroIVA = {
        fecha:      f.date,
        numFactura: f.num || 'S/N',
        nombre:     f.tipo === 'venta' ? (f.cliente || f.prov || 'Cliente') : (f.prov || 'Proveedor'),
        nif:        f.nif || f.cif || '',
        base,
        tipoIVA:    rate,
        cuotaIVA:   cuota,
        total:      total || Num.round2(base + cuota),
        pagado:     !!f.paid,
        unidad:     f.unidad_negocio || f.unitId || 'REST',
        origen:     'factura',
        irpfPct:    irpfPct || undefined,
        irpfAmount: irpfAmt || undefined,
      };

      if (f.tipo === 'venta') {
        emit.push(reg);
      } else if (f.tipo === 'compra') {
        recv.push(reg);
      }
    }

    // ─── Albaranes (como compras si tienen IVA) ───
    for (const a of albaranes as any[]) {
      if (!inPeriod(a.date)) continue;
      const base  = inferBase(a);
      const cuota = inferCuota(a);
      if (base <= 0) continue;
      const total = Num.parse(a.total ?? 0);

      // Si ya está vinculado a una factura de compra, no duplicar
      const yaEnFactura = facturas.some((f: any) =>
        f.tipo === 'compra' &&
        (f.albaranIdsArr || []).includes(a.id)
      );
      if (yaEnFactura) continue;

      recv.push({
        fecha:      a.date,
        numFactura: a.num || 'S/N',
        nombre:     a.prov || 'Proveedor',
        nif:        (a as any).nif || '',
        base,
        tipoIVA:    getIVARate(a),
        cuotaIVA:   cuota,
        total:      total || Num.round2(base + cuota),
        pagado:     !!a.paid,
        unidad:     a.unitId || a.unidad_negocio || 'REST',
        origen:     'albaran',
      });
    }

    // ─── Cierres Z (ventas diarias → IVA repercutido 10%) ───
    for (const c of cierres as any[]) {
      if (!inPeriod(c.date)) continue;
      const total = Num.parse(c.totalVenta ?? 0);
      if (total <= 0) continue;
      const base  = Num.round2(total / 1.10);
      const cuota = Num.round2(total - base);

      emit.push({
        fecha:      c.date,
        numFactura: `Z-${c.date}`,
        nombre:     'VENTAS DIARIAS (Cierre Z)',
        nif:        '',
        base,
        tipoIVA:    10,
        cuotaIVA:   cuota,
        total,
        pagado:     true,
        unidad:     c.unitId || 'REST',
        origen:     'cierre',
      });
    }

    // Ordenar por fecha descendente
    emit.sort((a, b) => b.fecha.localeCompare(a.fecha));
    recv.sort((a, b) => b.fecha.localeCompare(a.fecha));

    return { emitidas: emit, recibidas: recv };
  }, [data, year, quarter]);

  /* ── Filtro búsqueda ─────────────────────────────────────── */
  const registros = tab === 'emitidas' ? emitidas : recibidas;
  const filtered = useMemo(() => {
    if (!search.trim()) return registros;
    const q = search.toLowerCase();
    return registros.filter(r =>
      r.nombre.toLowerCase().includes(q) ||
      r.numFactura.toLowerCase().includes(q) ||
      r.nif.toLowerCase().includes(q)
    );
  }, [registros, search]);

  /* ── Totales ─────────────────────────────────────────────── */
  const totales = useMemo(() => {
    const byRate: Record<number, { base: number; cuota: number; count: number }> = {};
    for (const r of IVA_RATES) byRate[r] = { base: 0, cuota: 0, count: 0 };
    let totalBase = 0, totalCuota = 0, totalTotal = 0, totalIRPF = 0;

    for (const r of filtered) {
      const rate = IVA_RATES.includes(r.tipoIVA as any) ? r.tipoIVA : 10;
      byRate[rate].base  += r.base;
      byRate[rate].cuota += r.cuotaIVA;
      byRate[rate].count++;
      totalBase  += r.base;
      totalCuota += r.cuotaIVA;
      totalTotal += r.total;
      totalIRPF  += r.irpfAmount || 0;
    }
    return { byRate, totalBase, totalCuota, totalTotal, totalIRPF: Num.round2(totalIRPF), count: filtered.length };
  }, [filtered]);

  /* ── Liquidación IVA resumen ─────────────────────────────── */
  const liquidacion = useMemo(() => {
    const totRepercutido = emitidas.reduce((s, r) => s + r.cuotaIVA, 0);
    const totSoportado   = recibidas.reduce((s, r) => s + r.cuotaIVA, 0);
    return {
      repercutido: totRepercutido,
      soportado:   totSoportado,
      resultado:   Num.round2(totRepercutido - totSoportado),
    };
  }, [emitidas, recibidas]);

  /* ── Excel export ────────────────────────────────────────── */
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const periodLabel = quarter ? `${QUARTERS[quarter - 1]} ${year}` : `Año ${year}`;

    // Hoja 1: Facturas Emitidas
    const emRows = emitidas.map(r => ({
      'Fecha':        r.fecha,
      'Nº Factura':   r.numFactura,
      'Cliente':      r.nombre,
      'NIF/CIF':      r.nif,
      'Base Imp.':    Num.round2(r.base),
      'Tipo IVA':     `${r.tipoIVA}%`,
      'Cuota IVA':    Num.round2(r.cuotaIVA),
      'IRPF %':       r.irpfPct ? `${r.irpfPct}%` : '',
      'Ret. IRPF':    r.irpfAmount ? Num.round2(r.irpfAmount) : '',
      'Total':        Num.round2(r.total),
      'Cobrado':      r.pagado ? 'Sí' : 'No',
      'Unidad':       r.unidad,
      'Origen':       r.origen,
    }));
    const ws1 = XLSX.utils.json_to_sheet(emRows);
    ws1['!cols'] = [{ wch:11 },{ wch:16 },{ wch:30 },{ wch:12 },{ wch:12 },{ wch:8 },{ wch:12 },{ wch:8 },{ wch:10 },{ wch:12 },{ wch:8 },{ wch:6 },{ wch:8 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Facturas Emitidas');

    // Total retenciones IRPF
    const totalIRPFEmitidas = Num.round2(emitidas.reduce((s, r) => s + (r.irpfAmount || 0), 0));
    const totalIRPFRecibidas = Num.round2(recibidas.reduce((s, r) => s + (r.irpfAmount || 0), 0));

    // Hoja 2: Facturas Recibidas
    const recRows = recibidas.map(r => ({
      'Fecha':        r.fecha,
      'Nº Factura':   r.numFactura,
      'Proveedor':    r.nombre,
      'NIF/CIF':      r.nif,
      'Base Imp.':    Num.round2(r.base),
      'Tipo IVA':     `${r.tipoIVA}%`,
      'Cuota IVA':    Num.round2(r.cuotaIVA),
      'IRPF %':       r.irpfPct ? `${r.irpfPct}%` : '',
      'Ret. IRPF':    r.irpfAmount ? Num.round2(r.irpfAmount) : '',
      'Total':        Num.round2(r.total),
      'Pagado':       r.pagado ? 'Sí' : 'No',
      'Unidad':       r.unidad,
      'Origen':       r.origen,
    }));
    const ws2 = XLSX.utils.json_to_sheet(recRows);
    ws2['!cols'] = ws1['!cols'];
    XLSX.utils.book_append_sheet(wb, ws2, 'Facturas Recibidas');

    // Hoja 3: Resumen Liquidación
    const resumen: { Concepto: string; Importe: number | string }[] = [
      { Concepto: 'IVA Repercutido (ventas)', Importe: Num.round2(liquidacion.repercutido) },
      { Concepto: 'IVA Soportado (compras)',  Importe: Num.round2(liquidacion.soportado) },
      { Concepto: 'RESULTADO IVA (a pagar/compensar)', Importe: Num.round2(liquidacion.resultado) },
      { Concepto: '', Importe: '' },
      ...(totalIRPFEmitidas > 0 ? [
        { Concepto: 'IRPF Retenido en Emitidas', Importe: Num.round2(totalIRPFEmitidas) },
      ] : []),
      ...(totalIRPFRecibidas > 0 ? [
        { Concepto: 'IRPF Retenido en Recibidas', Importe: Num.round2(totalIRPFRecibidas) },
      ] : []),
      { Concepto: '', Importe: '' },
      ...IVA_RATES.map(rate => ({
        Concepto: `Base al ${rate}% (Emitidas)`,
        Importe: Num.round2(emitidas.filter(e => e.tipoIVA === rate).reduce((s,e) => s + e.base, 0)),
      })),
      ...IVA_RATES.map(rate => ({
        Concepto: `Base al ${rate}% (Recibidas)`,
        Importe: Num.round2(recibidas.filter(e => e.tipoIVA === rate).reduce((s,e) => s + e.base, 0)),
      })),
    ];
    const ws3 = XLSX.utils.json_to_sheet(resumen);
    ws3['!cols'] = [{ wch: 40 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Resumen IVA');

    const fname = `Libros_IVA_${periodLabel.replace(/\s/g, '_')}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast.success(`Excel "${fname}" descargado.`);
  };

  /* ── Helpers UI ──────────────────────────────────────────── */
  const periodLabel = quarter ? `${QUARTERS[quarter - 1]} ${year}` : `Año completo ${year}`;
  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('es-ES', { day:'2-digit', month:'short' }); }
    catch { return d; }
  };

  /* ══════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6 animate-fade-in pb-24 max-w-[1400px] mx-auto">

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] p-6 md:p-8 rounded-2xl">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[color:var(--arume-gold)]/80"/>
        <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-[color:var(--arume-gold)]/5 pointer-events-none"/>
        <div className="relative z-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--arume-gold)]">Dinero · Oficial</p>
          <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight mt-2 flex items-center gap-3">
            <BookOpen className="w-7 h-7 text-[color:var(--arume-gold)]" />
            Libros de IVA
          </h2>
          <p className="text-sm text-white/60 mt-1">Registro oficial de facturas · Celoso de Palma SL</p>

          {/* Controles periodo */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-white/10 rounded-2xl px-4 py-2 backdrop-blur-md">
              <button onClick={() => setYear(y => y - 1)} className="p-1 hover:bg-white/20 rounded-lg transition">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-black tabular-nums w-12 text-center">{year}</span>
              <button onClick={() => setYear(y => y + 1)} className="p-1 hover:bg-white/20 rounded-lg transition">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-1 bg-white/10 rounded-2xl p-1 backdrop-blur-md">
              <button onClick={() => setQuarter(null)}
                className={cn('px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition',
                  quarter === null ? 'bg-indigo-500 text-white' : 'text-indigo-200 hover:bg-white/10')}>
                Año
              </button>
              {[1,2,3,4].map(q => (
                <button key={q} onClick={() => setQuarter(q)}
                  className={cn('px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition',
                    quarter === q ? 'bg-indigo-500 text-white' : 'text-indigo-200 hover:bg-white/10')}>
                  T{q}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── RESUMEN LIQUIDACIÓN ────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-1.5">
            <ArrowUpRight className="w-3.5 h-3.5" /> IVA Repercutido
          </p>
          <p className="text-2xl font-black text-slate-800 mt-1">{Num.fmt(liquidacion.repercutido)}</p>
          <p className="text-[10px] text-slate-400 font-bold">{emitidas.length} facturas emitidas</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-1.5">
            <ArrowDownRight className="w-3.5 h-3.5" /> IVA Soportado
          </p>
          <p className="text-2xl font-black text-slate-800 mt-1">{Num.fmt(liquidacion.soportado)}</p>
          <p className="text-[10px] text-slate-400 font-bold">{recibidas.length} facturas recibidas</p>
        </div>
        <div className={cn('p-5 rounded-2xl border shadow-sm',
          liquidacion.resultado >= 0
            ? 'bg-amber-50 border-amber-200'
            : 'bg-emerald-50 border-emerald-200'
        )}>
          <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
            {liquidacion.resultado >= 0
              ? <><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> <span className="text-amber-600">A Pagar</span></>
              : <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> <span className="text-emerald-600">A Compensar</span></>
            }
          </p>
          <p className={cn('text-2xl font-black mt-1', liquidacion.resultado >= 0 ? 'text-amber-700' : 'text-emerald-700')}>
            {Num.fmt(Math.abs(liquidacion.resultado))}
          </p>
          <p className="text-[10px] text-slate-400 font-bold">{periodLabel}</p>
        </div>
      </div>

      {/* ── DESGLOSE POR TIPO IVA ─────────────────────────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-3 flex items-center gap-2">
          <Filter className="w-4 h-4 text-indigo-400" /> Desglose por Tipo
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {IVA_RATES.map(rate => {
            const emBase  = emitidas.filter(r => r.tipoIVA === rate).reduce((s,r) => s + r.base, 0);
            const emCuota = emitidas.filter(r => r.tipoIVA === rate).reduce((s,r) => s + r.cuotaIVA, 0);
            const rcBase  = recibidas.filter(r => r.tipoIVA === rate).reduce((s,r) => s + r.base, 0);
            const rcCuota = recibidas.filter(r => r.tipoIVA === rate).reduce((s,r) => s + r.cuotaIVA, 0);
            return (
              <div key={rate} className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <p className="text-sm font-black text-indigo-600 mb-2">IVA {rate}%</p>
                <div className="space-y-1 text-[10px]">
                  <div className="flex justify-between"><span className="text-emerald-600 font-bold">Repercutido:</span><span className="font-black text-slate-700">{Num.fmt(emCuota)}</span></div>
                  <div className="flex justify-between text-slate-400"><span>Base emitida:</span><span>{Num.fmt(emBase)}</span></div>
                  <div className="flex justify-between mt-1"><span className="text-rose-600 font-bold">Soportado:</span><span className="font-black text-slate-700">{Num.fmt(rcCuota)}</span></div>
                  <div className="flex justify-between text-slate-400"><span>Base recibida:</span><span>{Num.fmt(rcBase)}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── TABS + BÚSQUEDA + EXPORT ──────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex gap-1 bg-white rounded-2xl p-1 border border-slate-200 shadow-sm">
          <button onClick={() => setTab('recibidas')}
            className={cn('px-4 py-2 rounded-xl text-xs font-black transition',
              tab === 'recibidas' ? 'bg-rose-500 text-white' : 'text-slate-500 hover:bg-slate-100')}>
            <Receipt className="w-3.5 h-3.5 inline mr-1.5" />
            Recibidas ({recibidas.length})
          </button>
          <button onClick={() => setTab('emitidas')}
            className={cn('px-4 py-2 rounded-xl text-xs font-black transition',
              tab === 'emitidas' ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:bg-slate-100')}>
            <FileText className="w-3.5 h-3.5 inline mr-1.5" />
            Emitidas ({emitidas.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar proveedor, nº factura..."
              className="pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 w-56 transition" />
          </div>
          <button onClick={exportExcel}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition shadow-sm">
            <Download className="w-3.5 h-3.5" /> Excel Gestoría
          </button>
        </div>
      </div>

      {/* ── TABLA DE REGISTROS ─────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Totales barra */}
        <div className={cn('px-5 py-3 flex items-center justify-between border-b',
          tab === 'emitidas' ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100')}>
          <span className="text-xs font-black text-slate-700">
            {totales.count} registros · Base: {Num.fmt(totales.totalBase)} · IVA: {Num.fmt(totales.totalCuota)}
            {totales.totalIRPF > 0 && <span className="text-amber-600"> · IRPF: -{Num.fmt(totales.totalIRPF)}</span>}
          </span>
          <span className="text-sm font-black text-slate-800">Total: {Num.fmt(totales.totalTotal)}</span>
        </div>

        {/* Lista */}
        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BookOpen className="w-10 h-10 text-slate-300 mb-3" />
              <p className="text-sm font-black text-slate-400">Sin registros en este periodo</p>
              <p className="text-[10px] text-slate-400">Cambia el trimestre o año para ver datos</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 z-10">
                <tr>
                  <th className="text-left px-4 py-2.5 font-black text-slate-500 uppercase tracking-widest text-[9px]">Fecha</th>
                  <th className="text-left px-3 py-2.5 font-black text-slate-500 uppercase tracking-widest text-[9px]">Nº</th>
                  <th className="text-left px-3 py-2.5 font-black text-slate-500 uppercase tracking-widest text-[9px]">
                    {tab === 'emitidas' ? 'Cliente' : 'Proveedor'}
                  </th>
                  <th className="text-right px-3 py-2.5 font-black text-slate-500 uppercase tracking-widest text-[9px]">Base</th>
                  <th className="text-center px-3 py-2.5 font-black text-slate-500 uppercase tracking-widest text-[9px]">IVA</th>
                  <th className="text-right px-3 py-2.5 font-black text-slate-500 uppercase tracking-widest text-[9px]">Cuota</th>
                  <th className="text-right px-3 py-2.5 font-black text-amber-500 uppercase tracking-widest text-[9px]">IRPF</th>
                  <th className="text-right px-3 py-2.5 font-black text-slate-500 uppercase tracking-widest text-[9px]">Total</th>
                  <th className="text-center px-3 py-2.5 font-black text-slate-500 uppercase tracking-widest text-[9px]">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <motion.tr key={`${r.numFactura}-${r.fecha}-${i}`}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                    <td className="px-4 py-2.5 font-bold text-slate-500 whitespace-nowrap">{fmtDate(r.fecha)}</td>
                    <td className="px-3 py-2.5 font-bold text-slate-700 whitespace-nowrap max-w-[100px] truncate">{r.numFactura}</td>
                    <td className="px-3 py-2.5 font-bold text-slate-800 max-w-[200px] truncate">
                      {r.nombre}
                      {r.nif && <span className="ml-1.5 text-[9px] text-slate-400">{r.nif}</span>}
                      {r.origen !== 'factura' && (
                        <span className={cn('ml-1.5 text-[8px] font-black uppercase px-1.5 py-0.5 rounded',
                          r.origen === 'cierre' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'
                        )}>{r.origen}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-black text-slate-700 text-right tabular-nums">{Num.fmt(r.base)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-[9px] font-black bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{r.tipoIVA}%</span>
                    </td>
                    <td className="px-3 py-2.5 font-black text-slate-600 text-right tabular-nums">{Num.fmt(r.cuotaIVA)}</td>
                    <td className="px-3 py-2.5 font-bold text-right tabular-nums">
                      {r.irpfAmount ? <span className="text-amber-600">-{Num.fmt(r.irpfAmount)}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 font-black text-slate-800 text-right tabular-nums">{Num.fmt(r.total)}</td>
                    <td className="px-3 py-2.5 text-center">
                      {r.pagado
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                        : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mx-auto" />
                      }
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
