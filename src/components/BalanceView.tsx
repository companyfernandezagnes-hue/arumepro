/**
 * BalanceView.tsx — Balance de Situación simplificado
 * ────────────────────────────────────────────────────
 * Balance contable para Celoso de Palma SL:
 *
 *  ACTIVO (lo que la empresa TIENE)
 *    • Banco: saldo actual
 *    • Caja: efectivo pendiente de ingresar
 *    • Clientes: facturas emitidas sin cobrar
 *    • Stock valorado: ingredientes × coste
 *    • Activos fijos: mobiliario, maquinaria (amortizados)
 *
 *  PASIVO (lo que la empresa DEBE)
 *    • Proveedores: facturas/albaranes sin pagar
 *    • Hacienda: IVA pendiente de liquidar
 *    • Gastos fijos devengados pendientes
 *
 *  PATRIMONIO NETO = ACTIVO − PASIVO
 */
import React, { useMemo, useState } from 'react';
import {
  Scale, Landmark, Package, Users, Building2, Receipt,
  TrendingUp, TrendingDown, ChevronLeft, ChevronRight,
  Download, Info, Wallet, ShieldCheck, ChefHat, Truck,
  Home, Zap
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData } from '../types';
import { toast } from '../hooks/useToast';

/* ── Tipos locales ─────────────────────────────────────────── */
interface PartidaBalance {
  concepto: string;
  importe: number;
  detalle?: string;
  icon?: React.ElementType;
  color?: string;
}

/* ══════════════════════════════════════════════════════════════ */
export const BalanceView: React.FC<{ data: AppData }> = ({ data }) => {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear]   = useState(now.getFullYear());

  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const fechaCorte = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`;

  const handlePrev = () => { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); };
  const handleNext = () => { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); };

  /* ── Cálculo del balance ─────────────────────────────────── */
  const balance = useMemo(() => {
    const safe = data || {};
    const facturas    = Array.isArray(safe.facturas)    ? safe.facturas    : [];
    const albaranes   = Array.isArray(safe.albaranes)   ? safe.albaranes   : [];
    const cierres     = Array.isArray(safe.cierres)     ? safe.cierres     : [];
    const banco       = Array.isArray(safe.banco)        ? safe.banco       : [];
    const ingredientes= Array.isArray(safe.ingredientes) ? safe.ingredientes: [];
    const gastosFijos = Array.isArray(safe.gastos_fijos) ? safe.gastos_fijos: [];
    const activos     = Array.isArray(safe.activos)      ? safe.activos     : [];

    const beforeCutoff = (d?: string) => !!d && d <= fechaCorte;

    // ═══════════════════════════════════════════════════════
    // ACTIVO
    // ═══════════════════════════════════════════════════════

    // 1. Saldo bancario (suma de todos los movimientos hasta la fecha de corte)
    const saldoInicial = Num.parse((safe.config as any)?.saldoInicial ?? 0);
    const movsBanco = banco.filter((m: any) => beforeCutoff(m.date));
    const saldoBanco = saldoInicial + movsBanco.reduce((s: number, m: any) => s + Num.parse(m.amount ?? 0), 0);

    // 2. Caja (efectivo de cierres Z no ingresado en banco)
    // Simplificado: efectivo de los últimos 7 cierres no conciliados
    const cierresNoConc = (cierres as any[]).filter(c =>
      beforeCutoff(c.date) && !c.conciliado_banco
    );
    const efectivoPendiente = cierresNoConc.reduce((s: number, c: any) =>
      s + Num.parse(c.efectivo ?? 0), 0
    );

    // 3. Clientes (facturas de venta no cobradas)
    const clientesPendientes = (facturas as any[]).filter(f =>
      f.tipo === 'venta' && !f.paid && beforeCutoff(f.date)
    );
    const derechosCobro = clientesPendientes.reduce((s: number, f: any) =>
      s + Num.parse(f.total ?? 0), 0
    );

    // 4. Stock valorado
    const valorStock = ingredientes.reduce((s: number, i: any) => {
      const stock = Num.parse(i.stock ?? i.stockActual ?? 0);
      const cost  = Num.parse(i.cost ?? i.coste ?? 0);
      return s + Num.round2(stock * cost);
    }, 0);

    // 5. Activos fijos (valor neto contable = importe - amortización acumulada)
    const activosFijos = activos.map((a: any) => {
      const importe  = Num.parse(a.importe ?? 0);
      const fechaC   = a.fecha_compra || a.fecha || '2024-01-01';
      const vidaMeses = Num.parse(a.vida_util_meses ?? 120); // 10 años por defecto
      const mesesTranscurridos = Math.max(0, Math.min(vidaMeses,
        (new Date(fechaCorte).getTime() - new Date(fechaC).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      ));
      const amortAcum = Num.round2((importe / vidaMeses) * mesesTranscurridos);
      return {
        nombre: a.nombre || a.n || 'Activo',
        bruto: importe,
        amort: amortAcum,
        neto: Num.round2(importe - amortAcum),
      };
    });
    const totalActivosFijos = activosFijos.reduce((s, a) => s + a.neto, 0);

    // ═══════════════════════════════════════════════════════
    // PASIVO
    // ═══════════════════════════════════════════════════════

    // 1. Proveedores (facturas de compra + albaranes sin pagar)
    const facturasCompraImpagadas = (facturas as any[]).filter(f =>
      f.tipo === 'compra' && !f.paid && beforeCutoff(f.date)
    );
    const deudasFacturas = facturasCompraImpagadas.reduce((s: number, f: any) =>
      s + Num.parse(f.total ?? 0), 0
    );
    const albaranesImpagados = (albaranes as any[]).filter(a =>
      !a.paid && beforeCutoff(a.date)
    );
    const deudasAlbaranes = albaranesImpagados.reduce((s: number, a: any) =>
      s + Num.parse(a.total ?? 0), 0
    );
    const totalProveedores = Num.round2(deudasFacturas + deudasAlbaranes);

    // 2. Hacienda (IVA repercutido - soportado del trimestre en curso)
    const qStart = Math.floor(month / 3) * 3;
    const inQuarter = (d?: string) => {
      if (!d) return false;
      const dd = new Date(d);
      return dd.getFullYear() === year && dd.getMonth() >= qStart && dd.getMonth() <= month;
    };
    const ivaRepercutido = (cierres as any[])
      .filter(c => inQuarter(c.date))
      .reduce((s: number, c: any) => {
        const tv = Num.parse(c.totalVenta ?? 0);
        return s + Num.round2(tv - tv / 1.10);
      }, 0);
    const ivaSoportado = (albaranes as any[])
      .filter(a => inQuarter(a.date))
      .reduce((s: number, a: any) => s + Num.parse(a.taxes ?? a.iva ?? 0), 0)
      + (facturas as any[])
        .filter(f => f.tipo === 'compra' && inQuarter(f.date))
        .reduce((s: number, f: any) => s + Num.parse(f.tax ?? 0), 0);
    const ivaAPagar = Num.round2(Math.max(0, ivaRepercutido - ivaSoportado));

    // 3. Gastos fijos devengados este mes (aprox. nóminas + SS + alquiler pendientes)
    const gfMensuales = (gastosFijos as any[]).filter(g =>
      g.active && (g.freq === 'mensual' || !g.freq)
    );
    const totalGFMes = gfMensuales.reduce((s: number, g: any) => s + Num.parse(g.amount ?? 0), 0);

    // ═══════════════════════════════════════════════════════
    // RESUMEN
    // ═══════════════════════════════════════════════════════
    const activo: PartidaBalance[] = [
      { concepto: 'Saldo en banco',          importe: saldoBanco,          icon: Landmark,  color: 'indigo',  detalle: `${movsBanco.length} movimientos` },
      { concepto: 'Caja (efectivo pendiente)',importe: efectivoPendiente,   icon: Wallet,    color: 'emerald', detalle: `${cierresNoConc.length} cierres sin conciliar` },
      { concepto: 'Clientes (por cobrar)',    importe: derechosCobro,       icon: Users,     color: 'blue',    detalle: `${clientesPendientes.length} facturas pendientes` },
      { concepto: 'Stock valorado',           importe: valorStock,          icon: Package,   color: 'amber',   detalle: `${ingredientes.length} referencias` },
      { concepto: 'Activos fijos (neto)',     importe: totalActivosFijos,   icon: Home,      color: 'slate',   detalle: `${activosFijos.length} activos registrados` },
    ];

    const pasivo: PartidaBalance[] = [
      { concepto: 'Proveedores (por pagar)',  importe: totalProveedores,    icon: Truck,     color: 'rose',    detalle: `${facturasCompraImpagadas.length + albaranesImpagados.length} docs pendientes` },
      { concepto: 'Hacienda (IVA trimestre)', importe: ivaAPagar,           icon: Receipt,   color: 'amber',   detalle: `IVA rep. ${Num.fmt(ivaRepercutido)} − sop. ${Num.fmt(ivaSoportado)}` },
      { concepto: 'Gastos fijos mes',         importe: totalGFMes,          icon: Zap,       color: 'purple',  detalle: `${gfMensuales.length} partidas mensuales` },
    ];

    const totalActivo    = activo.reduce((s, p) => s + p.importe, 0);
    const totalPasivo    = pasivo.reduce((s, p) => s + p.importe, 0);
    const patrimonioNeto = Num.round2(totalActivo - totalPasivo);

    return { activo, pasivo, totalActivo, totalPasivo, patrimonioNeto, activosFijos };
  }, [data, year, month, fechaCorte]);

  /* ── Excel export ────────────────────────────────────────── */
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    const rows = [
      { Sección: '═══ ACTIVO ═══', Concepto: '', Importe: '' },
      ...balance.activo.map(p => ({ Sección: 'ACTIVO', Concepto: p.concepto, Importe: Num.round2(p.importe) })),
      { Sección: '', Concepto: 'TOTAL ACTIVO', Importe: Num.round2(balance.totalActivo) },
      { Sección: '', Concepto: '', Importe: '' },
      { Sección: '═══ PASIVO ═══', Concepto: '', Importe: '' },
      ...balance.pasivo.map(p => ({ Sección: 'PASIVO', Concepto: p.concepto, Importe: Num.round2(p.importe) })),
      { Sección: '', Concepto: 'TOTAL PASIVO', Importe: Num.round2(balance.totalPasivo) },
      { Sección: '', Concepto: '', Importe: '' },
      { Sección: '═══ PATRIMONIO NETO ═══', Concepto: 'Activo − Pasivo', Importe: Num.round2(balance.patrimonioNeto) },
    ];

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 20 }, { wch: 35 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Balance');

    if (balance.activosFijos.length > 0) {
      const afRows = balance.activosFijos.map(a => ({
        Activo: a.nombre,
        'Valor Bruto': a.bruto,
        'Amort. Acum.': a.amort,
        'Valor Neto': a.neto,
      }));
      const ws2 = XLSX.utils.json_to_sheet(afRows);
      ws2['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Activos Fijos');
    }

    const fname = `Balance_${MONTHS[month]}_${year}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast.success(`Excel "${fname}" descargado.`);
  };

  /* ── Helpers de color ────────────────────────────────────── */
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-100 text-indigo-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    blue: 'bg-blue-100 text-blue-600',
    amber: 'bg-amber-100 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
    rose: 'bg-rose-100 text-rose-600',
    purple: 'bg-purple-100 text-purple-600',
  };

  const PartidaRow = ({ p, type }: { p: PartidaBalance; type: 'activo' | 'pasivo' }) => {
    const Icon = p.icon || (type === 'activo' ? TrendingUp : TrendingDown);
    return (
      <div className="flex items-center justify-between py-3 px-4 hover:bg-slate-50/50 transition border-b border-slate-50 last:border-none">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0', colorMap[p.color || 'slate'])}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-700 truncate">{p.concepto}</p>
            {p.detalle && <p className="text-[9px] text-slate-400 font-bold">{p.detalle}</p>}
          </div>
        </div>
        <span className={cn('text-sm font-black tabular-nums flex-shrink-0 ml-3',
          p.importe >= 0 ? 'text-slate-800' : 'text-rose-600'
        )}>
          {Num.fmt(p.importe)}
        </span>
      </div>
    );
  };

  /* ══════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6 animate-fade-in pb-24 max-w-[1200px] mx-auto">

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden hero-breathing bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] p-6 md:p-8 rounded-2xl">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[color:var(--arume-gold)]/80"/>
        <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-[color:var(--arume-gold)]/5 pointer-events-none"/>
        <div className="relative z-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--arume-gold)]">Dinero · Contable</p>
          <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight mt-2 flex items-center gap-3">
            <Scale className="w-7 h-7 text-[color:var(--arume-gold)]" />
            Balance de situación
          </h2>
          <p className="text-sm text-white/60 mt-1">Celoso de Palma SL · {MONTHS[month]} {year}</p>

          {/* Selector periodo */}
          <div className="mt-4 flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white/10 rounded-2xl px-4 py-2 backdrop-blur-md">
              <button onClick={handlePrev} className="p-1 hover:bg-white/20 rounded-lg transition">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-black tabular-nums text-center whitespace-nowrap min-w-[130px]">
                {MONTHS[month]} {year}
              </span>
              <button onClick={handleNext} className="p-1 hover:bg-white/20 rounded-lg transition">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <button onClick={exportExcel}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition shadow-sm">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
        </div>
      </div>

      {/* ── PATRIMONIO NETO (gran KPI) ─────────────────────── */}
      <div className={cn('p-6 rounded-2xl border shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4',
        balance.patrimonioNeto >= 0
          ? 'bg-gradient-to-r from-emerald-50 to-white border-emerald-200'
          : 'bg-gradient-to-r from-rose-50 to-white border-rose-200'
      )}>
        <div className="flex items-center gap-4">
          <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center shadow-md',
            balance.patrimonioNeto >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
          )}>
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Patrimonio Neto</p>
            <p className="text-xs text-slate-400 font-bold">= Activo − Pasivo (lo que vale la empresa)</p>
          </div>
        </div>
        <p className={cn('text-4xl font-black tracking-tighter',
          balance.patrimonioNeto >= 0 ? 'text-emerald-600' : 'text-rose-600'
        )}>
          {Num.fmt(balance.patrimonioNeto)}
        </p>
      </div>

      {/* ── ACTIVO Y PASIVO ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ACTIVO */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
              <h3 className="text-sm font-black text-emerald-800 uppercase tracking-widest">Activo</h3>
            </div>
            <span className="text-lg font-black text-emerald-700 tabular-nums">{Num.fmt(balance.totalActivo)}</span>
          </div>
          <div>
            {balance.activo.map((p, i) => <PartidaRow key={i} p={p} type="activo" />)}
          </div>
          <div className="px-5 py-3 bg-emerald-50/50 border-t border-emerald-100 text-right">
            <span className="text-xs font-black text-emerald-700 uppercase tracking-widest">
              Total Activo: {Num.fmt(balance.totalActivo)}
            </span>
          </div>
        </div>

        {/* PASIVO */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-rose-50 border-b border-rose-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-rose-500" />
              <h3 className="text-sm font-black text-rose-800 uppercase tracking-widest">Pasivo</h3>
            </div>
            <span className="text-lg font-black text-rose-700 tabular-nums">{Num.fmt(balance.totalPasivo)}</span>
          </div>
          <div>
            {balance.pasivo.map((p, i) => <PartidaRow key={i} p={p} type="pasivo" />)}
          </div>
          <div className="px-5 py-3 bg-rose-50/50 border-t border-rose-100 text-right">
            <span className="text-xs font-black text-rose-700 uppercase tracking-widest">
              Total Pasivo: {Num.fmt(balance.totalPasivo)}
            </span>
          </div>
        </div>
      </div>

      {/* ── ACTIVOS FIJOS DETALLE ──────────────────────────── */}
      {balance.activosFijos.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <Home className="w-4 h-4 text-slate-400" />
            <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Detalle Activos Fijos (Amortización)</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-4 py-2 font-black text-slate-500 text-[9px] uppercase tracking-widest">Activo</th>
                <th className="text-right px-3 py-2 font-black text-slate-500 text-[9px] uppercase tracking-widest">Valor Bruto</th>
                <th className="text-right px-3 py-2 font-black text-slate-500 text-[9px] uppercase tracking-widest">Amort. Acum.</th>
                <th className="text-right px-3 py-2 font-black text-slate-500 text-[9px] uppercase tracking-widest">Valor Neto</th>
              </tr>
            </thead>
            <tbody>
              {balance.activosFijos.map((a, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                  <td className="px-4 py-2 font-bold text-slate-700">{a.nombre}</td>
                  <td className="px-3 py-2 font-bold text-slate-500 text-right tabular-nums">{Num.fmt(a.bruto)}</td>
                  <td className="px-3 py-2 font-bold text-rose-400 text-right tabular-nums">-{Num.fmt(a.amort)}</td>
                  <td className="px-3 py-2 font-black text-slate-800 text-right tabular-nums">{Num.fmt(a.neto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── INFO EDUCATIVA ─────────────────────────────────── */}
      <div className="bg-indigo-50 p-5 rounded-2xl border border-indigo-100 flex items-start gap-3">
        <Info className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="text-[10px] text-indigo-700 font-bold leading-relaxed space-y-1">
          <p><strong>ACTIVO</strong> = lo que la empresa TIENE (dinero, stock, lo que le deben clientes, mobiliario...)</p>
          <p><strong>PASIVO</strong> = lo que la empresa DEBE (proveedores sin pagar, IVA pendiente, nóminas...)</p>
          <p><strong>PATRIMONIO NETO</strong> = Activo − Pasivo = el valor real de Celoso de Palma SL</p>
          <p className="text-indigo-400 mt-2">Los activos fijos se amortizan: su valor contable baja con el tiempo (vida útil). Esto es fiscal, no significa que valgan menos en la realidad.</p>
        </div>
      </div>
    </div>
  );
};
