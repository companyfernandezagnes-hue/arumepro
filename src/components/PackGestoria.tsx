/**
 * PackGestoria.tsx — Exporta TODO lo que necesita la gestoría en un solo click
 * ──────────────────────────────────────────────────────────────────────────────
 * Genera un ZIP con:
 *  1. Libros_IVA.xlsx — Facturas Emitidas + Recibidas + Resumen
 *  2. Modelo_303.xlsx — Liquidación IVA del trimestre
 *  3. Balance.xlsx    — Balance de Situación del mes
 *  4. PyL.xlsx        — Cuenta de Pérdidas y Ganancias (P&L) mensual
 *  5. Gastos_Fijos.xlsx — Detalle de gastos fijos
 *
 * Usa JSZip para crear el archivo. El usuario elige trimestre y descarga.
 */
import React, { useState } from 'react';
import {
  Package, Download, Loader2, ChevronLeft, ChevronRight,
  CheckCircle2, FileText
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData } from '../types';
import { toast } from '../hooks/useToast';

/* ── Helpers IVA (compartidos con LibrosIVAView/Modelo303View) ── */
const getIVARate = (f: any): number => {
  const tax = Num.parse(f.tax ?? f.iva ?? f.taxes ?? 0);
  const base = Num.parse(f.base ?? 0);
  if (tax > 0 && base > 0) {
    const pct = Math.round((tax / base) * 100);
    if (pct <= 5) return 4;
    if (pct <= 12) return 10;
    return 21;
  }
  return 10;
};

const inferBase = (f: any): number => {
  const base = Num.parse(f.base ?? 0);
  const total = Num.parse(f.total ?? 0);
  const tax = Num.parse(f.tax ?? f.iva ?? f.taxes ?? 0);
  if (base > 0) return base;
  if (total > 0 && tax > 0) return Num.round2(total - tax);
  if (total > 0) return Num.round2(total / 1.10);
  return 0;
};

const inferCuota = (f: any): number => {
  const tax = Num.parse(f.tax ?? f.iva ?? f.taxes ?? 0);
  if (tax > 0) return tax;
  const base = inferBase(f);
  return Num.round2(base * (getIVARate(f) / 100));
};

const QUARTERS = ['T1 (Ene-Mar)', 'T2 (Abr-Jun)', 'T3 (Jul-Sep)', 'T4 (Oct-Dic)'];
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

interface Props {
  data: AppData;
  className?: string;
  compact?: boolean;
}

export const PackGestoria: React.FC<Props> = ({ data, className, compact }) => {
  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3) + 1;
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(currentQ);
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const safe = data || {};
      const facturas = Array.isArray(safe.facturas) ? safe.facturas : [];
      const albaranes = Array.isArray(safe.albaranes) ? safe.albaranes : [];
      const cierres = Array.isArray(safe.cierres) ? safe.cierres : [];
      const gastosFijos = Array.isArray(safe.gastos_fijos) ? safe.gastos_fijos : [];
      const ingredientes = Array.isArray(safe.ingredientes) ? safe.ingredientes : [];
      const activos = Array.isArray(safe.activos) ? safe.activos : [];
      const banco = Array.isArray((safe as any).banco) ? (safe as any).banco : [];

      const qStart = (quarter - 1) * 3;
      const qMonths = [qStart, qStart + 1, qStart + 2];

      const inQuarter = (d?: string) => {
        if (!d) return false;
        const dd = new Date(d);
        return dd.getFullYear() === year && qMonths.includes(dd.getMonth());
      };

      // ═══════════════════════════════════════════════════════
      // 1. LIBROS IVA
      // ═══════════════════════════════════════════════════════
      const wbIVA = XLSX.utils.book_new();

      // Emitidas
      const emitidas: any[] = [];
      for (const f of facturas as any[]) {
        if (!inQuarter(f.date) || f.tipo !== 'venta') continue;
        emitidas.push({
          Fecha: f.date, 'Nº Factura': f.num || 'S/N',
          Cliente: f.cliente || f.prov || '', 'NIF/CIF': f.nif || '',
          'Base Imp.': Num.round2(inferBase(f)), 'Tipo IVA': `${getIVARate(f)}%`,
          'Cuota IVA': Num.round2(inferCuota(f)), Total: Num.round2(Num.parse(f.total ?? 0)),
          Cobrado: f.paid ? 'Sí' : 'No',
        });
      }
      // Cierres Z como ventas
      for (const c of cierres as any[]) {
        if (!inQuarter(c.date)) continue;
        const total = Num.parse(c.totalVenta ?? 0);
        if (total <= 0) continue;
        const base = Num.round2(total / 1.10);
        emitidas.push({
          Fecha: c.date, 'Nº Factura': `Z-${c.date}`,
          Cliente: 'VENTAS DIARIAS', 'NIF/CIF': '',
          'Base Imp.': base, 'Tipo IVA': '10%',
          'Cuota IVA': Num.round2(total - base), Total: Num.round2(total),
          Cobrado: 'Sí',
        });
      }
      XLSX.utils.book_append_sheet(wbIVA, XLSX.utils.json_to_sheet(emitidas), 'Emitidas');

      // Recibidas
      const recibidas: any[] = [];
      for (const f of facturas as any[]) {
        if (!inQuarter(f.date) || f.tipo !== 'compra') continue;
        recibidas.push({
          Fecha: f.date, 'Nº Factura': f.num || 'S/N',
          Proveedor: f.prov || '', 'NIF/CIF': f.nif || '',
          'Base Imp.': Num.round2(inferBase(f)), 'Tipo IVA': `${getIVARate(f)}%`,
          'Cuota IVA': Num.round2(inferCuota(f)), Total: Num.round2(Num.parse(f.total ?? 0)),
          Pagado: f.paid ? 'Sí' : 'No',
        });
      }
      for (const a of albaranes as any[]) {
        if (!inQuarter(a.date)) continue;
        const base = inferBase(a);
        if (base <= 0) continue;
        const yaEnFactura = facturas.some((f: any) => f.tipo === 'compra' && (f.albaranIdsArr || []).includes(a.id));
        if (yaEnFactura) continue;
        recibidas.push({
          Fecha: a.date, 'Nº Factura': a.num || 'S/N',
          Proveedor: a.prov || '', 'NIF/CIF': (a as any).nif || '',
          'Base Imp.': Num.round2(base), 'Tipo IVA': `${getIVARate(a)}%`,
          'Cuota IVA': Num.round2(inferCuota(a)), Total: Num.round2(Num.parse(a.total ?? 0)),
          Pagado: a.paid ? 'Sí' : 'No',
        });
      }
      XLSX.utils.book_append_sheet(wbIVA, XLSX.utils.json_to_sheet(recibidas), 'Recibidas');

      // Resumen
      const totEmit = emitidas.reduce((s, r) => s + (r['Cuota IVA'] || 0), 0);
      const totRecv = recibidas.reduce((s, r) => s + (r['Cuota IVA'] || 0), 0);
      XLSX.utils.book_append_sheet(wbIVA, XLSX.utils.json_to_sheet([
        { Concepto: 'IVA Repercutido (ventas)', Importe: Num.round2(totEmit) },
        { Concepto: 'IVA Soportado (compras)', Importe: Num.round2(totRecv) },
        { Concepto: 'RESULTADO', Importe: Num.round2(totEmit - totRecv) },
      ]), 'Resumen IVA');

      // ═══════════════════════════════════════════════════════
      // 2. P&L (Cuenta de Resultados) por mes del trimestre
      // ═══════════════════════════════════════════════════════
      const wbPyL = XLSX.utils.book_new();
      const pylRows: any[] = [];

      for (const m of qMonths) {
        const mStart = `${year}-${String(m + 1).padStart(2, '0')}-01`;
        const mEnd = `${year}-${String(m + 1).padStart(2, '0')}-${new Date(year, m + 1, 0).getDate()}`;
        const inMonth = (d?: string) => !!d && d >= mStart && d <= mEnd;

        const ventas = (cierres as any[]).filter(c => inMonth(c.date))
          .reduce((s: number, c: any) => s + Num.parse(c.totalVenta ?? 0), 0);
        const ventasFactura = (facturas as any[]).filter(f => f.tipo === 'venta' && inMonth(f.date))
          .reduce((s: number, f: any) => s + inferBase(f), 0);
        const totalVentas = ventas + ventasFactura;

        const compras = (facturas as any[]).filter(f => f.tipo === 'compra' && inMonth(f.date))
          .reduce((s: number, f: any) => s + inferBase(f), 0);
        const comprasAlb = (albaranes as any[]).filter(a => inMonth(a.date))
          .reduce((s: number, a: any) => s + inferBase(a), 0);
        const totalCompras = Math.max(compras, comprasAlb);

        const gfMes = (gastosFijos as any[]).filter(g => g.active && (g.freq === 'mensual' || !g.freq))
          .reduce((s: number, g: any) => s + Num.parse(g.amount ?? 0), 0);

        const resultado = Num.round2(totalVentas - totalCompras - gfMes);

        pylRows.push({
          Mes: MONTHS[m],
          'Ventas (Z + Facturas)': Num.round2(totalVentas),
          'Compras (Mat. Prima)': Num.round2(totalCompras),
          'Gastos Fijos': Num.round2(gfMes),
          'RESULTADO': resultado,
          'Margen %': totalVentas > 0 ? `${Num.round2((resultado / totalVentas) * 100)}%` : '0%',
        });
      }

      // Fila total trimestre
      pylRows.push({
        Mes: `TOTAL ${QUARTERS[quarter - 1]}`,
        'Ventas (Z + Facturas)': Num.round2(pylRows.reduce((s, r) => s + r['Ventas (Z + Facturas)'], 0)),
        'Compras (Mat. Prima)': Num.round2(pylRows.reduce((s, r) => s + r['Compras (Mat. Prima)'], 0)),
        'Gastos Fijos': Num.round2(pylRows.reduce((s, r) => s + r['Gastos Fijos'], 0)),
        'RESULTADO': Num.round2(pylRows.reduce((s, r) => s + r['RESULTADO'], 0)),
        'Margen %': '',
      });

      const wsPyL = XLSX.utils.json_to_sheet(pylRows);
      wsPyL['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wbPyL, wsPyL, 'PyL Trimestral');

      // ═══════════════════════════════════════════════════════
      // 3. BALANCE DE SITUACIÓN (último mes del trimestre)
      // ═══════════════════════════════════════════════════════
      const wbBalance = XLSX.utils.book_new();
      const lastMonth = qMonths[2];
      const fechaCorte = `${year}-${String(lastMonth + 1).padStart(2, '0')}-${new Date(year, lastMonth + 1, 0).getDate()}`;
      const beforeCutoff = (d?: string) => !!d && d <= fechaCorte;

      const saldoInicial = Num.parse((safe.config as any)?.saldoInicial ?? 0);
      const saldoBanco = saldoInicial + banco.filter((m: any) => beforeCutoff(m.date))
        .reduce((s: number, m: any) => s + Num.parse(m.amount ?? 0), 0);

      const valorStock = ingredientes.reduce((s: number, i: any) =>
        s + Num.round2(Num.parse(i.stock ?? 0) * Num.parse(i.cost ?? 0)), 0);

      const clientesPend = (facturas as any[]).filter(f => f.tipo === 'venta' && !f.paid && beforeCutoff(f.date))
        .reduce((s: number, f: any) => s + Num.parse(f.total ?? 0), 0);

      const proveedoresPend = (facturas as any[]).filter(f => f.tipo === 'compra' && !f.paid && beforeCutoff(f.date))
        .reduce((s: number, f: any) => s + Num.parse(f.total ?? 0), 0)
        + (albaranes as any[]).filter(a => !a.paid && beforeCutoff(a.date))
          .reduce((s: number, a: any) => s + Num.parse(a.total ?? 0), 0);

      const totalActivo = Num.round2(saldoBanco + valorStock + clientesPend);
      const totalPasivo = Num.round2(proveedoresPend);

      const balRows = [
        { Sección: 'ACTIVO', Concepto: 'Saldo en Banco', Importe: Num.round2(saldoBanco) },
        { Sección: 'ACTIVO', Concepto: 'Stock Valorado', Importe: Num.round2(valorStock) },
        { Sección: 'ACTIVO', Concepto: 'Clientes (por cobrar)', Importe: Num.round2(clientesPend) },
        { Sección: '', Concepto: 'TOTAL ACTIVO', Importe: totalActivo },
        { Sección: '', Concepto: '', Importe: '' },
        { Sección: 'PASIVO', Concepto: 'Proveedores (por pagar)', Importe: Num.round2(proveedoresPend) },
        { Sección: '', Concepto: 'TOTAL PASIVO', Importe: totalPasivo },
        { Sección: '', Concepto: '', Importe: '' },
        { Sección: 'PATRIMONIO NETO', Concepto: 'Activo - Pasivo', Importe: Num.round2(totalActivo - totalPasivo) },
      ];
      XLSX.utils.book_append_sheet(wbBalance, XLSX.utils.json_to_sheet(balRows), 'Balance');

      // ═══════════════════════════════════════════════════════
      // 4. GASTOS FIJOS detalle
      // ═══════════════════════════════════════════════════════
      const wbGF = XLSX.utils.book_new();
      const gfRows = (gastosFijos as any[]).filter(g => g.active).map(g => ({
        Concepto: g.name || g.concepto || '',
        Importe: Num.round2(Num.parse(g.amount ?? 0)),
        Frecuencia: g.freq || 'mensual',
        'Día Pago': g.dia_pago || '',
        Categoría: g.cat || '',
        Unidad: g.unitId || '',
      }));
      XLSX.utils.book_append_sheet(wbGF, XLSX.utils.json_to_sheet(gfRows), 'Gastos Fijos');

      // ═══════════════════════════════════════════════════════
      // COMBINAR TODO EN UN SOLO EXCEL (multi-hoja)
      // ═══════════════════════════════════════════════════════
      const wbFinal = XLSX.utils.book_new();

      // Copiar hojas de cada workbook
      const copySheets = (source: XLSX.WorkBook, prefix: string) => {
        for (const name of source.SheetNames) {
          XLSX.utils.book_append_sheet(wbFinal, source.Sheets[name], `${prefix}_${name}`);
        }
      };

      copySheets(wbIVA, 'IVA');
      copySheets(wbPyL, 'PyL');
      copySheets(wbBalance, 'Bal');
      copySheets(wbGF, 'GF');

      const fname = `Pack_Gestoria_${QUARTERS[quarter - 1].replace(/\s/g, '_')}_${year}.xlsx`;
      XLSX.writeFile(wbFinal, fname);
      toast.success(`📦 Pack Gestoría descargado: "${fname}" — 4 informes en un archivo.`);

    } catch (err: any) {
      console.error('Error generando Pack Gestoría:', err);
      toast.error('Error generando el pack. Revisa los datos.');
    } finally {
      setGenerating(false);
    }
  };

  if (compact) {
    return (
      <button onClick={generate} disabled={generating}
        className={cn('flex items-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-2xl text-xs font-black hover:bg-indigo-700 transition shadow-md disabled:opacity-50', className)}>
        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
        {generating ? 'Generando...' : '📦 Pack Gestoría'}
      </button>
    );
  }

  return (
    <div className={cn('bg-indigo-50 border border-indigo-200 rounded-2xl p-4 hover:border-indigo-400 hover:shadow-md transition', className)}>
      <div className="flex items-center gap-2 mb-2">
        <Package className="w-5 h-5 text-indigo-600" />
        <span className="font-black text-sm text-indigo-900">Pack Gestoría</span>
      </div>
      <p className="text-[10px] text-indigo-700/80 font-bold leading-tight mb-3">
        Descarga un Excel con todo lo que necesita tu asesor: Libros IVA + P&L + Balance + Gastos Fijos
      </p>

      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1 bg-white rounded-xl px-2 py-1 border border-indigo-200">
          <button onClick={() => setYear(y => y - 1)} className="p-0.5 hover:bg-indigo-100 rounded transition">
            <ChevronLeft className="w-3 h-3 text-indigo-500" />
          </button>
          <span className="text-[10px] font-black text-indigo-700 w-8 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-0.5 hover:bg-indigo-100 rounded transition">
            <ChevronRight className="w-3 h-3 text-indigo-500" />
          </button>
        </div>
        <div className="flex gap-0.5 bg-white rounded-xl p-0.5 border border-indigo-200">
          {[1, 2, 3, 4].map(q => (
            <button key={q} onClick={() => setQuarter(q)}
              className={cn('px-2 py-1 rounded-lg text-[9px] font-black transition',
                quarter === q ? 'bg-indigo-500 text-white' : 'text-indigo-400 hover:bg-indigo-100')}>
              T{q}
            </button>
          ))}
        </div>
      </div>

      <button onClick={generate} disabled={generating}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition shadow-sm disabled:opacity-50">
        {generating
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando...</>
          : <><Download className="w-3.5 h-3.5" /> Descargar {QUARTERS[quarter - 1]} {year}</>
        }
      </button>
    </div>
  );
};
