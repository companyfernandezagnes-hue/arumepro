import React, { useState, useMemo } from 'react';
import {
  Scale, Download, FileText, Users, TrendingUp, TrendingDown,
  CheckCircle2, Calendar, Wallet, Building2,
  ArrowUpRight, ArrowDownRight, Calculator, Receipt,
  Hotel, ShoppingBag, ChevronDown, ChevronUp, Info,
  Crown, Handshake, PiggyBank
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { AppData, Socio, PagosSocios } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

interface LiquidacionesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

// ─── Tipo de fuente de venta ───────────────────────────────────────────────
type FuenteVenta = 'caja' | 'b2b_bilty' | 'b2b_evento' | 'b2b_presupuesto';

const FUENTE_META: Record<FuenteVenta, { label: string; color: string; bg: string; iva: number }> = {
  caja:            { label: 'Caja (TPV/Z)',     color: 'text-indigo-700',  bg: 'bg-indigo-50',  iva: 10 },
  b2b_bilty:       { label: 'Bilty / Verifactu', color: 'text-amber-700',  bg: 'bg-amber-50',   iva: 10 },
  b2b_evento:      { label: 'Eventos B2B',       color: 'text-purple-700', bg: 'bg-purple-50',  iva: 21 },
  b2b_presupuesto: { label: 'Presupuestos B2B',  color: 'text-teal-700',   bg: 'bg-teal-50',    iva: 21 },
};

export const LiquidacionesView = ({ data, onSave }: LiquidacionesViewProps) => {
  const [selectedPeriod, setSelectedPeriod]   = useState(DateUtil.today().slice(0, 7));
  const [propinasPct,    setPropinasPct]       = useState<number>(3);
  const [showDetalle,    setShowDetalle]       = useState(false);
  const [activeTab,      setActiveTab]         = useState<'iva'|'equipo'|'reparto'|'export'>('iva');

  // 🆕 Handler marcar pagado (reparto socios)
  const pagosSocios: PagosSocios = (data.pagos_socios || {}) as PagosSocios;
  const getPagoKey = (socioId: string) => `${selectedPeriod}_${socioId}`;
  const isPagado = (socioId: string) => !!pagosSocios[getPagoKey(socioId)];
  const togglePagoSocio = async (socioId: string, nombre: string, importe: number) => {
    const key = getPagoKey(socioId);
    const yaPagado = !!pagosSocios[key];
    if (yaPagado) {
      const ok = await confirm({
        title: `Desmarcar pago a ${nombre}`,
        message: `Se cancelará el registro del pago de ${Num.fmt(pagosSocios[key].importe)}. ¿Confirmas?`,
      });
      if (!ok) return;
      const nuevos = { ...pagosSocios };
      delete nuevos[key];
      await onSave({ ...data, pagos_socios: nuevos });
      toast.info(`Pago a ${nombre} desmarcado`);
    } else {
      const ok = await confirm({
        title: `Marcar como pagado a ${nombre}`,
        message: `Se registrará el pago de ${Num.fmt(importe)} correspondiente a ${selectedPeriod}.`,
        confirmLabel: 'Sí, pagado',
      });
      if (!ok) return;
      await onSave({
        ...data,
        pagos_socios: {
          ...pagosSocios,
          [key]: { importe, fecha: DateUtil.today(), notas: `Reparto ${selectedPeriod}` },
        },
      });
      toast.success(`Pago a ${nombre} registrado`);
    }
  };

  // ─── Cálculos principales ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const sociosData    = Array.isArray(data.socios) ? data.socios : [];
    const sociosActivos = sociosData.filter(s => s.active);

    // ── Ventas de CAJA (cierres Z) ──────────────────────────────────────
    const cierresMes = (data.cierres || []).filter(c =>
      c.date && c.date.startsWith(selectedPeriod)
    );
    const ventasCaja   = cierresMes.reduce((s, c) => s + Num.parse((c as any).totalVenta || 0), 0);
    const baseCaja     = Num.round2(ventasCaja / 1.10);
    const ivaCaja      = Num.round2(ventasCaja - baseCaja);

    // ── Ventas B2B de cobros_b2b (Tesorería) ────────────────────────────
    const cobrosB2B = ((data as any).cobros_b2b || []).filter((c: any) =>
      c.fecha && c.fecha.startsWith(selectedPeriod)
    );

    let ventasB2BBilty = 0, ivaB2BBilty = 0;
    let ventasB2BEvento = 0, ivaB2BEvento = 0;
    let ventasB2BPresup = 0, ivaB2BPresup = 0;

    cobrosB2B.forEach((c: any) => {
      const total = Num.parse(c.total || 0);
      const base  = Num.parse(c.base  || 0) || Num.round2(total / 1.10);
      const iva   = Num.round2(total - base);
      if (c.tipo === 'bilty')        { ventasB2BBilty  += total; ivaB2BBilty  += iva; }
      else if (c.tipo === 'evento')  { ventasB2BEvento += total; ivaB2BEvento += iva; }
      else if (c.tipo === 'presupuesto') { ventasB2BPresup += total; ivaB2BPresup += iva; }
    });

    // ── Facturas antiguas tipo 'venta' (compatibilidad) ─────────────────
    // SOLO las que no son cierres de caja (tipo='caja') ni B2B duplicadas
    const facturasVenta = (data.facturas || []).filter(f =>
      f.date && f.date.startsWith(selectedPeriod) &&
      f.tipo === 'venta' &&
      f.cliente && f.cliente !== 'Z DIARIO' && f.cliente !== 'Z DIARIO AUTO'
    );
    const ventasFactLeg  = facturasVenta.reduce((s, f) => s + Num.parse(f.total), 0);
    const ivaFactLeg     = facturasVenta.reduce((s, f) => {
      const t = Num.parse(f.total); const b = Num.parse(f.base) || Num.round2(t / 1.10);
      return s + Num.round2(t - b);
    }, 0);

    // ── Totales repercutidos ─────────────────────────────────────────────
    const totalVentas       = Num.round2(ventasCaja + ventasB2BBilty + ventasB2BEvento + ventasB2BPresup + ventasFactLeg);
    const ivaRepercutido    = Num.round2(ivaCaja + ivaB2BBilty + ivaB2BEvento + ivaB2BPresup + ivaFactLeg);

    // ── IVA Soportado (albaranes) ────────────────────────────────────────
    const periodAlbaranes = (data.albaranes || []).filter(a =>
      a.date && a.date.startsWith(selectedPeriod)
    );
    const totalGastos    = periodAlbaranes.reduce((s, a) => s + Num.parse(a.total), 0);
    const ivaSoportado   = periodAlbaranes.reduce((s, a) => {
      const t = Num.parse(a.total); const b = Num.parse((a as any).base) || Num.round2(t / 1.10);
      return s + Num.round2(t - b);
    }, 0);

    // ── Gastos fijos pagados este mes ────────────────────────────────────
    const [y, m] = selectedPeriod.split('-').map(Number);
    const monthKey     = `pagos_${y}_${m}`;
    const controlPagos = (data.control_pagos || {}) as any;
    const pagados      = (controlPagos[monthKey] || []) as string[];
    const gastosFijosMes = (data.gastos_fijos || []).filter((g: any) =>
      g.active !== false && pagados.includes(g.id) &&
      g.type !== 'income' && g.type !== 'grant'
    );
    const totalGastosFijos  = gastosFijosMes.reduce((s: number, g: any) => s + Num.parse(g.amount || 0), 0);
    const ivaGastosFijos    = gastosFijosMes.reduce((s: number, g: any) => {
      const t = Num.parse(g.amount || 0);
      if (g.type === 'payroll') return s; // nóminas sin IVA
      return s + Num.round2(t - Num.round2(t / 1.21)); // asumimos 21% si no especificado
    }, 0);

    const ivaSoportadoTotal = Num.round2(ivaSoportado + ivaGastosFijos);
    const ivaBalance        = Num.round2(ivaRepercutido - ivaSoportadoTotal);

    // ── Gastos suplidos por socios ───────────────────────────────────────
    const partnerSpending: Record<string, { total: number; isOperativo: boolean }> = {};
    sociosActivos.forEach(p => {
      partnerSpending[p.n.toUpperCase()] = { total: 0, isOperativo: (p as any).role === 'operativo' };
    });
    partnerSpending['OTROS / RESTAURANTE'] = { total: 0, isOperativo: false };

    periodAlbaranes.forEach(a => {
      const socioName = ((a as any).socio || '').toUpperCase();
      const match     = sociosActivos.find(s => s.n.toUpperCase() === socioName);
      if (match) {
        if ((match as any).role === 'operativo') {
          const base = Num.parse((a as any).base) || Num.round2(Num.parse(a.total) / 1.10);
          partnerSpending[socioName].total += base;
        } else {
          partnerSpending[socioName].total += Num.parse(a.total);
        }
      } else {
        partnerSpending['OTROS / RESTAURANTE'].total += Num.parse(a.total);
      }
    });

    const propinasVal = Num.round2(ventasCaja * (propinasPct / 100));

    // ── Reparto de socios: Fundadores vs Comisionistas B2B ──────────────
    // Base imponible B2B (neto sin IVA) — pool para comisiones B2B
    const baseB2B = Num.round2(
      (ventasB2BBilty  - ivaB2BBilty) +
      (ventasB2BEvento - ivaB2BEvento) +
      (ventasB2BPresup - ivaB2BPresup)
    );

    // Gastos directos B2B (albaranes con unidad DLV + gastos fijos DLV)
    const gastosB2BAlb = periodAlbaranes
      .filter((a: any) => (a.unidad_negocio || a.unitId) === 'DLV')
      .reduce((s: number, a: any) => s + Num.parse(a.total), 0);
    const gastosB2BFijos = gastosFijosMes
      .filter((g: any) => g.unitId === 'DLV')
      .reduce((s: number, g: any) => s + Num.parse(g.amount || 0), 0);
    const baseB2BNeto = Num.round2(baseB2B - gastosB2BAlb - gastosB2BFijos);

    // Comisionistas B2B: cobran % sobre baseB2BNeto
    const comisionistas = sociosActivos
      .filter((s: any) => s.role === 'comisionista_b2b')
      .map((s: any) => {
        const pct = Number(s.porcentaje) || 0;
        const importe = Num.round2(baseB2BNeto * (pct / 100));
        return { id: s.id || s.n, nombre: s.n, porcentaje: pct, importe: Math.max(0, importe) };
      });
    const totalComisionesB2B = comisionistas.reduce((s, c) => s + c.importe, 0);

    // Beneficio estimado para socios fundadores (sociedad principal)
    // = (Ventas totales − IVA repercutido) − (Gastos − IVA soportado) − comisiones B2B ya pagadas
    const baseVentas = Num.round2(totalVentas - ivaRepercutido);
    const baseGastos = Num.round2((totalGastos + totalGastosFijos) - ivaSoportadoTotal);
    const beneficioEstimado = Num.round2(baseVentas - baseGastos - totalComisionesB2B);

    // Fundadores: cobran % del beneficio
    const fundadoresList = sociosActivos.filter((s: any) => s.role === 'socio_fundador');
    const sumPctFundadores = fundadoresList.reduce((s: number, f: any) => s + (Number(f.porcentaje) || 0), 0);
    const fundadores = fundadoresList.map((s: any) => {
      // Si no han configurado porcentajes, se reparte a partes iguales
      const pct = sumPctFundadores > 0
        ? (Number(s.porcentaje) || 0)
        : (fundadoresList.length > 0 ? 100 / fundadoresList.length : 0);
      const importe = Num.round2(beneficioEstimado * (pct / 100));
      return { id: s.id || s.n, nombre: s.n, porcentaje: Num.round2(pct), importe };
    });

    // ── Desglose por fuente (para la UI) ────────────────────────────────
    const desglose: { fuente: FuenteVenta; ventas: number; iva: number }[] = ([
      { fuente: 'caja'            as FuenteVenta, ventas: Num.round2(ventasCaja),       iva: Num.round2(ivaCaja)       },
      { fuente: 'b2b_bilty'       as FuenteVenta, ventas: Num.round2(ventasB2BBilty),   iva: Num.round2(ivaB2BBilty)   },
      { fuente: 'b2b_evento'      as FuenteVenta, ventas: Num.round2(ventasB2BEvento),  iva: Num.round2(ivaB2BEvento)  },
      { fuente: 'b2b_presupuesto' as FuenteVenta, ventas: Num.round2(ventasB2BPresup),  iva: Num.round2(ivaB2BPresup)  },
    ]).filter(d => d.ventas > 0);
    if (ventasFactLeg > 0) desglose.push({
      fuente: 'b2b_bilty', // facturas legacy: agrupa con Bilty en display
      ventas: Num.round2(ventasFactLeg),
      iva:    Num.round2(ivaFactLeg),
    });

    return {
      totalVentas, ivaRepercutido,
      totalGastos: Num.round2(totalGastos + totalGastosFijos),
      ivaSoportadoTotal, ivaBalance,
      partnerSpending, propinasVal,
      desglose,
      countAlbaranes: periodAlbaranes.length,
      countCierres:   cierresMes.length,
      countCobrosB2B: cobrosB2B.length,
      rawAlbaranes:   periodAlbaranes,
      rawCierres:     cierresMes,
      rawCobrosB2B:   cobrosB2B,
      rawFacturasLeg: facturasVenta,
      // 🆕 Reparto socios
      baseB2B, baseB2BNeto, totalComisionesB2B,
      beneficioEstimado,
      fundadores, comisionistas,
    };
  }, [data, selectedPeriod, propinasPct]);

  // ─── Export Excel ─────────────────────────────────────────────────────────
  const handleExportGestoria = () => {
    const wb = XLSX.utils.book_new();

    // Hoja 1: Resumen IVA
    const resumen = [
      { CONCEPTO: '── INGRESOS ──',                      IMPORTE: '' },
      { CONCEPTO: 'Total Ventas (bruto)',                  IMPORTE: Num.fmt(stats.totalVentas) },
      { CONCEPTO: 'IVA Repercutido (a ingresar)',         IMPORTE: Num.fmt(stats.ivaRepercutido) },
      { CONCEPTO: '',                                      IMPORTE: '' },
      { CONCEPTO: '── GASTOS ──',                         IMPORTE: '' },
      { CONCEPTO: 'Total Gastos + Compromisos (bruto)',   IMPORTE: Num.fmt(stats.totalGastos) },
      { CONCEPTO: 'IVA Soportado (deducible)',            IMPORTE: Num.fmt(stats.ivaSoportadoTotal) },
      { CONCEPTO: '',                                      IMPORTE: '' },
      { CONCEPTO: '── RESULTADO ──',                      IMPORTE: '' },
      { CONCEPTO: stats.ivaBalance >= 0 ? 'A PAGAR A HACIENDA' : 'A DEVOLVER POR HACIENDA',
        IMPORTE: Num.fmt(Math.abs(stats.ivaBalance)) },
    ];
    stats.desglose.forEach(d => resumen.splice(3, 0, {
      CONCEPTO: `  · ${FUENTE_META[d.fuente].label}`,
      IMPORTE:  `${Num.fmt(d.ventas)} (IVA: ${Num.fmt(d.iva)})`,
    }));
    const wsRes = XLSX.utils.json_to_sheet(resumen);
    wsRes['!cols'] = [{ wch: 40 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen_IVA');

    // Hoja 2: Cierres Caja
    if (stats.rawCierres.length > 0) {
      const wsCaja = XLSX.utils.json_to_sheet(stats.rawCierres.map((c: any) => ({
        FECHA: c.date, UNIDAD: c.unitId || 'REST',
        TOTAL_VENTA: Num.parse(c.totalVenta || 0),
        EFECTIVO: Num.parse(c.efectivo || 0),
        TARJETA: Num.parse(c.tarjeta || 0),
        APPS: Num.parse(c.apps || 0),
      })));
      XLSX.utils.book_append_sheet(wb, wsCaja, 'Cierres_Caja');
    }

    // Hoja 3: Cobros B2B
    if (stats.rawCobrosB2B.length > 0) {
      const wsB2B = XLSX.utils.json_to_sheet(stats.rawCobrosB2B.map((c: any) => ({
        FECHA: c.fecha, TIPO: c.tipo, CLIENTE: c.cliente,
        CONCEPTO: c.concepto, BASE: Num.parse(c.base || 0),
        IVA: Num.round2(Num.parse(c.total || 0) - Num.parse(c.base || 0)),
        TOTAL: Num.parse(c.total || 0),
        COBRADO: c.paid ? 'SÍ' : 'NO',
      })));
      XLSX.utils.book_append_sheet(wb, wsB2B, 'Cobros_B2B');
    }

    // Hoja 4: Compras / Albaranes
    if (stats.rawAlbaranes.length > 0) {
      const wsAlb = XLSX.utils.json_to_sheet(stats.rawAlbaranes.map((a: any) => ({
        FECHA: a.date, PROVEEDOR: a.prov, REF: a.num, SOCIO: a.socio || '—',
        BASE: Num.parse(a.base || 0), IVA: Num.parse(a.taxes || 0),
        TOTAL: Num.parse(a.total), PAGADO: a.paid ? 'SÍ' : 'NO',
      })));
      XLSX.utils.book_append_sheet(wb, wsAlb, 'Compras_Albaranes');
    }

    // Hoja 5: Gastos suplidos socios
    const supl = Object.entries(stats.partnerSpending)
      .filter(([, d]) => d.total > 0)
      .map(([nombre, d]) => ({
        PERSONA: nombre,
        TIPO: d.isOperativo ? 'Operativo (Base sin IVA)' : 'Socio/Empresa',
        IMPORTE_A_DEVOLVER: Num.fmt(d.total),
      }));
    if (supl.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(supl), 'Gastos_Suplidos');
    }

    // 🆕 Hoja 6: Reparto Socios Fundadores (sociedad principal)
    if (stats.fundadores.length > 0) {
      const fundRows: any[] = [
        { CONCEPTO: '── BENEFICIO A REPARTIR ──', IMPORTE: '' },
        { CONCEPTO: 'Base ventas (sin IVA)',                IMPORTE: Num.fmt(Num.round2(stats.totalVentas - stats.ivaRepercutido)) },
        { CONCEPTO: 'Base gastos (sin IVA)',                IMPORTE: Num.fmt(Num.round2(stats.totalGastos - stats.ivaSoportadoTotal)) },
        { CONCEPTO: 'Comisiones B2B descontadas',          IMPORTE: Num.fmt(stats.totalComisionesB2B) },
        { CONCEPTO: 'Beneficio estimado',                    IMPORTE: Num.fmt(stats.beneficioEstimado) },
        { CONCEPTO: '', IMPORTE: '' },
        { CONCEPTO: '── REPARTO ──', IMPORTE: '' },
        ...stats.fundadores.map(f => ({
          CONCEPTO: `${f.nombre} (${f.porcentaje}%)`,
          IMPORTE:  Num.fmt(f.importe),
        })),
      ];
      const wsFund = XLSX.utils.json_to_sheet(fundRows);
      wsFund['!cols'] = [{ wch: 42 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsFund, 'Reparto_Fundadores');
    }

    // 🆕 Hoja 7: Comisiones Socios B2B (distribución hoteles)
    if (stats.comisionistas.length > 0) {
      const comRows: any[] = [
        { CONCEPTO: '── POOL B2B ──', IMPORTE: '' },
        { CONCEPTO: 'Base imponible B2B (bruto)',         IMPORTE: Num.fmt(stats.baseB2B) },
        { CONCEPTO: 'Base B2B neta (tras gastos directos)', IMPORTE: Num.fmt(stats.baseB2BNeto) },
        { CONCEPTO: '', IMPORTE: '' },
        { CONCEPTO: '── COMISIONES ──', IMPORTE: '' },
        ...stats.comisionistas.map(c => ({
          CONCEPTO: `${c.nombre} (${c.porcentaje}% s/neto)`,
          IMPORTE:  Num.fmt(c.importe),
        })),
        { CONCEPTO: 'TOTAL COMISIONES B2B', IMPORTE: Num.fmt(stats.totalComisionesB2B) },
      ];
      const wsCom = XLSX.utils.json_to_sheet(comRows);
      wsCom['!cols'] = [{ wch: 42 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsCom, 'Comisiones_B2B');
    }

    XLSX.writeFile(wb, `Liquidacion_Arume_${selectedPeriod}.xlsx`);
  };

  const fmt = (iso: string) =>
    new Date(iso + '-01').toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">

      {/* HEADER */}
      <header className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tighter">Impuestos & Liquidaciones</h2>
          <p className="text-xs text-indigo-500 font-bold uppercase tracking-widest mt-1 flex items-center gap-1">
            <Building2 className="w-3 h-3"/> Panel Fiscal Arume · IVA Caja + B2B Separado
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-slate-400"/>
            <input type="month" value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)}
              className="bg-transparent text-sm font-black text-slate-700 outline-none w-36 cursor-pointer"/>
          </div>
          <button onClick={handleExportGestoria}
            className="bg-slate-900 text-white px-6 py-3 rounded-2xl text-xs font-black shadow-xl hover:bg-emerald-600 transition-all flex items-center gap-2 active:scale-95">
            <Download className="w-4 h-4"/> PACK EXCEL GESTORÍA
          </button>
        </div>
      </header>

      {/* TABS */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key:'iva',     label:'📊 IVA & Ventas'       },
          { key:'equipo',  label:'👥 Equipo & Reembolsos' },
          { key:'reparto', label:'👑 Reparto Socios'     },
          { key:'export',  label:'📦 Detalle Exportar'   },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={cn('px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition border',
              activeTab === t.key
                ? 'bg-slate-900 text-white border-slate-900 shadow-lg'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ══════════════════════════════════════════════════
         * TAB IVA & VENTAS
         * ═════════════════════════════════════════════════ */}
        {activeTab === 'iva' && (
          <motion.div key="iva" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-6">

            {/* KPI Cards top */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* IVA Repercutido */}
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                <div className="absolute -right-6 -top-6 w-32 h-32 bg-emerald-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                  <TrendingUp className="w-12 h-12 text-emerald-200"/>
                </div>
                <div className="relative z-10">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">IVA Repercutido (Ventas)</p>
                  <h3 className="text-4xl font-black text-emerald-600 tracking-tighter">{Num.fmt(stats.ivaRepercutido)}</h3>
                  <p className="mt-3 text-xs font-bold text-slate-400 flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3 text-emerald-500"/> Base total: {Num.fmt(stats.totalVentas)}
                  </p>
                </div>
              </div>

              {/* IVA Soportado */}
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
                <div className="absolute -right-6 -top-6 w-32 h-32 bg-rose-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                  <TrendingDown className="w-12 h-12 text-rose-200"/>
                </div>
                <div className="relative z-10">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">IVA Soportado (Gastos)</p>
                  <h3 className="text-4xl font-black text-rose-600 tracking-tighter">{Num.fmt(stats.ivaSoportadoTotal)}</h3>
                  <p className="mt-3 text-xs font-bold text-slate-400 flex items-center gap-1">
                    <ArrowDownRight className="w-3 h-3 text-rose-500"/> Base gastos: {Num.fmt(stats.totalGastos)}
                  </p>
                </div>
              </div>

              {/* Resultado */}
              <div className={cn('p-8 rounded-[2.5rem] border shadow-lg relative overflow-hidden flex flex-col justify-center',
                stats.ivaBalance >= 0 ? 'bg-slate-900 border-slate-800 text-white' : 'bg-amber-500 border-amber-600 text-white')}>
                <Scale className="absolute -right-4 -top-4 w-32 h-32 opacity-10"/>
                <div className="relative z-10">
                  <p className="text-[10px] font-black opacity-70 uppercase tracking-widest mb-2">
                    Resultado IVA · {fmt(selectedPeriod)}
                  </p>
                  <h3 className="text-5xl font-black tracking-tighter">{Num.fmt(Math.abs(stats.ivaBalance))}</h3>
                  <p className="text-sm font-bold mt-2 opacity-90 flex items-center gap-1">
                    <Calculator className="w-4 h-4"/>
                    {stats.ivaBalance >= 0 ? 'A pagar a Hacienda (estimado)' : 'A devolver por Hacienda'}
                  </p>
                </div>
              </div>
            </div>

            {/* 🆕 Desglose por fuente de venta */}
            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
              <button onClick={() => setShowDetalle(v => !v)}
                className="w-full flex items-center justify-between px-8 py-5 hover:bg-slate-50 transition">
                <div className="flex items-center gap-3">
                  <Receipt className="w-5 h-5 text-indigo-500"/>
                  <div className="text-left">
                    <p className="text-sm font-black text-slate-800">Desglose por origen de venta</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                      Caja · Bilty · Eventos · Presupuestos — IVA separado
                    </p>
                  </div>
                </div>
                {showDetalle
                  ? <ChevronUp className="w-5 h-5 text-slate-400"/>
                  : <ChevronDown className="w-5 h-5 text-slate-400"/>}
              </button>

              <AnimatePresence>
                {showDetalle && (
                  <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}
                    className="overflow-hidden border-t border-slate-100">
                    <div className="p-6 space-y-3">
                      {stats.desglose.length === 0 ? (
                        <p className="text-center text-xs text-slate-400 py-8">Sin ventas registradas en {fmt(selectedPeriod)}</p>
                      ) : (
                        <>
                          {/* Cabecera */}
                          <div className="grid grid-cols-4 text-[9px] font-black text-slate-400 uppercase tracking-widest px-4 pb-2">
                            <span>Origen</span>
                            <span className="text-right">Ventas Brutas</span>
                            <span className="text-right">Base Imp.</span>
                            <span className="text-right">IVA</span>
                          </div>
                          {stats.desglose.map((d, i) => {
                            const meta = FUENTE_META[d.fuente];
                            const base = Num.round2(d.ventas - d.iva);
                            return (
                              <div key={i} className={cn('grid grid-cols-4 items-center px-4 py-3 rounded-2xl', meta.bg)}>
                                <div>
                                  <span className={cn('text-[10px] font-black', meta.color)}>{meta.label}</span>
                                  <span className="ml-2 text-[9px] text-slate-400">({meta.iva}%)</span>
                                </div>
                                <span className="text-right font-black text-slate-800 text-sm tabular-nums">{Num.fmt(d.ventas)}</span>
                                <span className="text-right font-bold text-slate-600 text-xs tabular-nums">{Num.fmt(base)}</span>
                                <span className={cn('text-right font-black text-xs tabular-nums', meta.color)}>{Num.fmt(d.iva)}</span>
                              </div>
                            );
                          })}
                          {/* Total */}
                          <div className="grid grid-cols-4 items-center px-4 py-3 bg-slate-900 rounded-2xl mt-2">
                            <span className="text-xs font-black text-white uppercase">TOTAL</span>
                            <span className="text-right font-black text-white text-sm tabular-nums">{Num.fmt(stats.totalVentas)}</span>
                            <span className="text-right font-bold text-slate-300 text-xs tabular-nums">{Num.fmt(Num.round2(stats.totalVentas - stats.ivaRepercutido))}</span>
                            <span className="text-right font-black text-emerald-400 text-xs tabular-nums">{Num.fmt(stats.ivaRepercutido)}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 px-2 flex items-start gap-1.5 pt-1">
                            <Info className="w-3 h-3 mt-0.5 flex-shrink-0"/>
                            Los cierres de caja (Z) se incluyen al 10%. Eventos y presupuestos B2B al 21%. Bilty según la factura.
                          </p>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Contadores rápidos */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label:'Cierres de Caja', val: stats.countCierres,   icon: Building2, color:'text-indigo-600', bg:'bg-indigo-50' },
                { label:'Cobros B2B',      val: stats.countCobrosB2B, icon: Hotel,     color:'text-amber-600',  bg:'bg-amber-50'  },
                { label:'Albaranes',       val: stats.countAlbaranes, icon: ShoppingBag,color:'text-slate-600', bg:'bg-slate-100' },
              ].map(k => {
                const Icon = k.icon;
                return (
                  <div key={k.label} className={cn('flex items-center gap-3 p-5 rounded-[2rem] border border-slate-100', k.bg)}>
                    <Icon className={cn('w-8 h-8', k.color)}/>
                    <div>
                      <p className="text-2xl font-black text-slate-800">{k.val}</p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{k.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ══════════════════════════════════════════════════
         * TAB EQUIPO & SUPLIDOS
         * ═════════════════════════════════════════════════ */}
        {activeTab === 'equipo' && (
          <motion.div key="equipo" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-6">

            {/* Propinas */}
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h3 className="text-sm font-black text-slate-800">Propinas Estimadas</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                    {propinasPct}% sobre ventas caja · {Num.fmt(stats.propinasVal)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-400 uppercase">%</span>
                  <input type="range" min={0} max={10} step={0.5} value={propinasPct}
                    onChange={e => setPropinasPct(Number(e.target.value))}
                    className="w-32 accent-indigo-600"/>
                  <span className="text-sm font-black text-indigo-600 w-8">{propinasPct}%</span>
                </div>
              </div>
            </div>

            {/* Gastos suplidos */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-indigo-500"/> Reembolso gastos personales · {fmt(selectedPeriod)}
              </h3>
              <div className="space-y-3">
                {Object.entries(stats.partnerSpending)
                  .filter(([, d]) => d.total > 0)
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([partner, d]) => {
                    const isOther = partner === 'OTROS / RESTAURANTE';
                    return (
                      <div key={partner}
                        className={cn('flex justify-between items-center p-4 rounded-2xl border transition-all',
                          isOther ? 'bg-slate-50 border-slate-100' : 'bg-white border-indigo-50 hover:border-indigo-200 hover:shadow-sm')}>
                        <div className="flex items-center gap-3">
                          <div className={cn('w-10 h-10 rounded-full flex items-center justify-center font-black text-xs shadow-inner',
                            isOther ? 'bg-slate-200 text-slate-500' :
                            d.isOperativo ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-indigo-100 text-indigo-700')}>
                            {isOther ? '?' : partner.slice(0, 2)}
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-800">{partner}</p>
                            {d.isOperativo
                              ? <p className="text-[8px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-black uppercase tracking-widest mt-1 inline-block">Devolución (Sin IVA)</p>
                              : <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{isOther ? 'Del restaurante' : 'Total con IVA'}</p>
                            }
                          </div>
                        </div>
                        <p className="text-xl font-black text-indigo-600 tabular-nums">{Num.fmt(d.total)}</p>
                      </div>
                    );
                  })}
                {Object.values(stats.partnerSpending).every(d => d.total === 0) && (
                  <p className="text-center text-xs text-slate-400 py-10">Sin reembolsos pendientes en {fmt(selectedPeriod)}</p>
                )}
              </div>

              <div className="mt-6 bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1 flex items-center gap-1">
                  <Info className="w-3 h-3"/> Nota
                </p>
                <p className="text-xs text-indigo-700">
                  Los <strong>operativos</strong> (Agnès, Pau, Only One) reciben devolución sobre la <strong>base imponible sin IVA</strong>, ya que el IVA lo reclaméis vosotros a Hacienda. Los <strong>socios fundadores</strong> reciben el total del ticket.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ══════════════════════════════════════════════════
         * TAB REPARTO SOCIOS — Fundadores + Comisionistas B2B
         * ═════════════════════════════════════════════════ */}
        {activeTab === 'reparto' && (
          <motion.div key="reparto" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-6">

            {/* KPI Beneficio estimado */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <PiggyBank className="w-3 h-3"/> Beneficio estimado
                </p>
                <h3 className={cn('text-3xl font-black tracking-tighter',
                  stats.beneficioEstimado >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  {Num.fmt(stats.beneficioEstimado)}
                </h3>
                <p className="text-[10px] text-slate-400 mt-2">Base ventas − Base gastos − Comisiones B2B</p>
              </div>
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <Hotel className="w-3 h-3"/> Base B2B neta
                </p>
                <h3 className="text-3xl font-black text-amber-600 tracking-tighter">{Num.fmt(stats.baseB2BNeto)}</h3>
                <p className="text-[10px] text-slate-400 mt-2">Base imponible B2B − gastos directos DLV</p>
              </div>
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                  <Handshake className="w-3 h-3"/> Total comisiones B2B
                </p>
                <h3 className="text-3xl font-black text-purple-600 tracking-tighter">{Num.fmt(stats.totalComisionesB2B)}</h3>
                <p className="text-[10px] text-slate-400 mt-2">Suma de % de los comisionistas B2B</p>
              </div>
            </div>

            {/* Fundadores */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-500"/> Socios Fundadores · Sociedad Principal
              </h3>
              {stats.fundadores.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">
                  <p>Sin socios fundadores configurados.</p>
                  <p className="mt-1 text-[10px]">Ajustes → Socios: marca <code>role: socio_fundador</code> y asigna <code>porcentaje</code>.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.fundadores.map(f => {
                    const pagado = isPagado(f.id);
                    return (
                      <div key={f.id} className={cn(
                        'flex justify-between items-center p-4 rounded-2xl border transition-all',
                        pagado ? 'bg-emerald-50 border-emerald-200 opacity-80' : 'bg-amber-50 border-amber-100'
                      )}>
                        <div className="flex items-center gap-3">
                          <div className={cn('w-10 h-10 rounded-full flex items-center justify-center font-black text-xs',
                            pagado ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800')}>
                            {f.nombre.slice(0,2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-800 flex items-center gap-2">
                              {f.nombre}
                              {pagado && <CheckCircle2 className="w-4 h-4 text-emerald-600"/>}
                            </p>
                            <p className={cn('text-[10px] font-bold uppercase tracking-widest',
                              pagado ? 'text-emerald-700' : 'text-amber-700')}>
                              {pagado ? `Pagado · ${pagosSocios[getPagoKey(f.id)].fecha}` : `${f.porcentaje}% del beneficio`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className={cn('text-xl font-black tabular-nums',
                            f.importe >= 0 ? (pagado ? 'text-emerald-600' : 'text-amber-700') : 'text-rose-600')}>
                            {Num.fmt(f.importe)}
                          </p>
                          <button onClick={() => togglePagoSocio(f.id, f.nombre, f.importe)}
                            className={cn(
                              'px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                              pagado
                                ? 'bg-white border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-500'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                            )}>
                            {pagado ? 'Desmarcar' : '✓ Pagar'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-4 bg-amber-50/50 border border-amber-100 rounded-2xl p-4">
                <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-1 flex items-center gap-1">
                  <Info className="w-3 h-3"/> Fórmula
                </p>
                <p className="text-xs text-amber-800">
                  Beneficio = (Ventas sin IVA) − (Gastos sin IVA) − (Comisiones B2B). Se reparte según el <strong>% asignado a cada fundador</strong>.
                  Si no hay % definidos, se reparte a partes iguales automáticamente.
                </p>
              </div>
            </div>

            {/* Comisionistas B2B */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
                <Handshake className="w-5 h-5 text-purple-500"/> Comisionistas B2B · Distribución Hoteles
              </h3>
              {stats.comisionistas.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">
                  <p>Sin comisionistas B2B configurados.</p>
                  <p className="mt-1 text-[10px]">Ajustes → Socios: añade 2 registros con <code>role: comisionista_b2b</code> y su <code>porcentaje</code>.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.comisionistas.map(c => {
                    const pagado = isPagado(c.id);
                    return (
                      <div key={c.id} className={cn(
                        'flex justify-between items-center p-4 rounded-2xl border transition-all',
                        pagado ? 'bg-emerald-50 border-emerald-200 opacity-80' : 'bg-purple-50 border-purple-100'
                      )}>
                        <div className="flex items-center gap-3">
                          <div className={cn('w-10 h-10 rounded-full flex items-center justify-center font-black text-xs',
                            pagado ? 'bg-emerald-200 text-emerald-800' : 'bg-purple-200 text-purple-800')}>
                            {c.nombre.slice(0,2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-800 flex items-center gap-2">
                              {c.nombre}
                              {pagado && <CheckCircle2 className="w-4 h-4 text-emerald-600"/>}
                            </p>
                            <p className={cn('text-[10px] font-bold uppercase tracking-widest',
                              pagado ? 'text-emerald-700' : 'text-purple-700')}>
                              {pagado ? `Pagado · ${pagosSocios[getPagoKey(c.id)].fecha}` : `${c.porcentaje}% sobre neto B2B`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className={cn('text-xl font-black tabular-nums',
                            pagado ? 'text-emerald-600' : 'text-purple-700')}>
                            {Num.fmt(c.importe)}
                          </p>
                          <button onClick={() => togglePagoSocio(c.id, c.nombre, c.importe)}
                            className={cn(
                              'px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                              pagado
                                ? 'bg-white border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-500'
                                : 'bg-purple-600 text-white hover:bg-purple-700 shadow-sm'
                            )}>
                            {pagado ? 'Desmarcar' : '✓ Pagar'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-4 bg-purple-50/50 border border-purple-100 rounded-2xl p-4">
                <p className="text-[10px] font-black text-purple-700 uppercase tracking-widest mb-1 flex items-center gap-1">
                  <Info className="w-3 h-3"/> Fórmula
                </p>
                <p className="text-xs text-purple-800">
                  Pool = Base B2B (bilty+eventos+presupuestos sin IVA) − Gastos directos DLV (albaranes y gastos fijos con unidad DLV).
                  Cada comisionista cobra su <strong>% sobre el neto</strong>. Las comisiones se descuentan del beneficio de los fundadores.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ══════════════════════════════════════════════════
         * TAB EXPORT DETALLE
         * ═════════════════════════════════════════════════ */}
        {activeTab === 'export' && (
          <motion.div key="export" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            className="bg-slate-900 rounded-[2.5rem] p-8 text-white">
            <h3 className="text-lg font-black mb-6 flex items-center gap-2">
              <Download className="w-5 h-5 text-indigo-400"/> Pack Excel Gestoría · {fmt(selectedPeriod)}
            </h3>
            <div className="space-y-3 mb-8">
              {[
                { icon: CheckCircle2, label:'Resumen IVA (Mod. 303)',  sub:`Rep. ${Num.fmt(stats.ivaRepercutido)} / Sop. ${Num.fmt(stats.ivaSoportadoTotal)}` },
                { icon: Building2,   label:'Cierres de Caja',         sub:`${stats.countCierres} registros` },
                { icon: Hotel,       label:'Cobros B2B (Bilty · Eventos · Presupuestos)', sub:`${stats.countCobrosB2B} registros` },
                { icon: FileText,    label:'Compras / Albaranes',      sub:`${stats.countAlbaranes} registros` },
                { icon: Users,       label:'Reembolso Gastos Personales', sub:`Desglose operativos y fundadores` },
                { icon: Crown,       label:'Reparto Socios Fundadores', sub:`${stats.fundadores.length} fundador(es) · Beneficio ${Num.fmt(stats.beneficioEstimado)}` },
                { icon: Handshake,   label:'Comisiones B2B',            sub:`${stats.comisionistas.length} comisionista(s) · ${Num.fmt(stats.totalComisionesB2B)}` },
              ].map((row, i) => {
                const Icon = row.icon;
                return (
                  <div key={i} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-emerald-400"/>
                      <div>
                        <p className="text-xs font-bold text-slate-200">{row.label}</p>
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest font-black mt-0.5">{row.sub}</p>
                      </div>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 opacity-60"/>
                  </div>
                );
              })}
            </div>
            <button onClick={handleExportGestoria}
              className="w-full bg-indigo-500 text-white py-5 rounded-[1.5rem] text-sm font-black uppercase tracking-widest hover:bg-indigo-400 transition shadow-lg active:scale-95 flex justify-center items-center gap-2">
              <Download className="w-5 h-5"/> DESCARGAR PACK EXCEL
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};
