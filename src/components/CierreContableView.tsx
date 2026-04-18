import React, { useState, useMemo, useCallback } from 'react';
import { Lock, Unlock, ChevronLeft, ChevronRight, CheckCircle2, TrendingUp, TrendingDown, BarChart3, ShieldCheck, Download, Wallet, Activity, Target, Scale, Lightbulb, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, CierreMensual } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';
interface CierreContableViewProps {
  data : AppData;
  onSave: (newData: AppData) => Promise<void>;
}
const extractMonthYear = (v?: string | number | null): { month: number; year: number } => {
  if (!v) return { month:-1, year:-1 };
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{2})/);
  if (m) return { year:parseInt(m[1],10), month:parseInt(m[2],10) };
  m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{2,4})/);
  if (m) { let y = parseInt(m[3],10); if (y < 100) y += 2000; return { year:y, month:parseInt(m[2],10) }; }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return { year:d.getFullYear(), month:d.getMonth()+1 };
  return { month:-1, year:-1 };
};
const normalizeGastoFijo = (g: any) => ({
  name : String(g.name || g.concepto || g.categoria || g.desc || ''),
  amount: Num.parse(g.amount ?? g.importe ?? g.total ?? 0),
  freq : String(g.freq || g.periodicidad || 'mensual').toLowerCase(),
});
export const CierreContableView: React.FC<CierreContableViewProps> = ({ data, onSave }) => {
  const [year, setYear] = useState(new Date().getFullYear());
  const [isExporting, setIsExporting] = useState(false);
  // Previsión año siguiente
  const [prevCrecVentas, setPrevCrecVentas] = useState(5);   // % crecimiento ventas
  const [prevInflacion, setPrevInflacion]   = useState(3);   // % inflación gastos
  const [isClosingYear, setIsClosingYear]   = useState(false);
  const meses = useMemo(() => [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
  ], []);
  const cierresMensuales = useMemo(() => Array.isArray(data?.cierres_mensuales) ? data.cierres_mensuales : [], [data?.cierres_mensuales]);
  const yearlySnapshots = useMemo(() => {
    return meses.map((_, i) => {
      const cierreOficial = cierresMensuales.find(c => c.mes === i && c.anio === year);
      if (cierreOficial) return { ...cierreOficial.snapshot, isClosed: true, id: cierreOficial.id, fecha_cierre: cierreOficial.fecha_cierre, gastosBancoNoContabilizado: 0 };
      const targetMonth = i + 1;
      let ventas = 0;
      const cajas = data?.cierres || [];
      cajas.forEach((c:any) => {
        const d = extractMonthYear(c.date || c.fecha);
        if (d.year === year && d.month === targetMonth) {
          ventas += Num.parse(c.totalVenta ?? c.totalVentas ?? c.total_calculado ?? c.total_real ?? c.total ?? c.amount ?? 0);
        }
      });
      (data?.facturas||[]).forEach(f => {
        if (f?.tipo !== 'venta') return;
        const d = extractMonthYear(f.date || (f as any).fecha);
        if (d.year === year && d.month === targetMonth) {
          const base = Num.parse(f.base);
          ventas += base > 0 ? base : Num.round2(Num.parse(f.total) / 1.10);
        }
      });
      let compras = 0;
      const processedAlbaranes = new Set<string>();
      (data?.facturas||[]).forEach(f => {
        if (f?.tipo !== 'compra') return;
        const d = extractMonthYear(f.date || (f as any).fecha);
        if (d.year === year && d.month === targetMonth) {
          const base = Num.parse(f.base);
          compras += base > 0 ? base : Num.round2(Num.parse(f.total) / 1.10);
          if (Array.isArray(f.albaranIdsArr)) f.albaranIdsArr.forEach(id => processedAlbaranes.add(String(id)));
        }
      });
      (data?.albaranes||[]).forEach(a => {
        if (!a?.id || processedAlbaranes.has(String(a.id))) return;
        const d = extractMonthYear(a.date || (a as any).fecha);
        if (d.year === year && d.month === targetMonth) {
          const base = Num.parse((a as any).base);
          compras += base > 0 ? base : Num.round2(Num.parse(a.total) / 1.10);
        }
      });
      let personal=0, suministros=0, otrosFijos=0;
      (data?.gastos_fijos||[]).forEach((g:any) => {
        if (!g) return;
        const ng = normalizeGastoFijo(g);
        const eff = ng.freq;
        const startRef = extractMonthYear(g.startDate || g.date || g.fecha);
        if (g.date || g.fecha) {
          const d = extractMonthYear(g.date || g.fecha);
          if (d.year !== year || d.month !== targetMonth) return;
        } else if (eff === 'once') {
          if (startRef.month < 0 || startRef.year !== year || startRef.month !== targetMonth) return;
        } else if (eff === 'bimensual') {
          if (startRef.month > 0) { const diff=(year-startRef.year)*12+(targetMonth-startRef.month); if (diff<0||diff%2!==0) return; }
        } else if (eff === 'trimestral') {
          if (startRef.month > 0) { const diff=(year-startRef.year)*12+(targetMonth-startRef.month); if (diff<0||diff%3!==0) return; }
        } else if (eff === 'semestral') {
          if (startRef.month > 0) { const diff=(year-startRef.year)*12+(targetMonth-startRef.month); if (diff<0||diff%6!==0) return; }
        } else if (eff === 'anual') {
          if (startRef.month > 0) { const diff=(year-startRef.year)*12+(targetMonth-startRef.month); if (diff<0||diff%12!==0) return; }
        }
        const amount = ng.amount;
        if (amount <= 0) return;
        const gType = String(g.type || '').toLowerCase();
        const gCat = String(g.cat || '').toLowerCase();
        const name = ng.name.toLowerCase();
        const isPersonal = gType === 'payroll' || gCat === 'personal' || name.match(/nomina|nómina|seguridad social|irpf|personal|sueldo|payroll/) !== null;
        const isSuministro = gCat === 'suministros' || gType === 'utility' || name.match(/luz|agua|gas\b|internet|telefono|telefonía|endesa|iberdrola|basura|suministro/) !== null;
        if (isPersonal) { personal += amount; }
        else if (isSuministro) { suministros += amount; }
        else { otrosFijos += amount; }
      });
      const fijos = personal + suministros + otrosFijos;

      // ── Amortizaciones en meses abiertos ───────────────────────────
      let amortizaciones = 0;
      (data?.activos || []).forEach((activo: any) => {
        if (!activo || activo.activo === false) return;
        const vida = Num.parse(activo.vida_util_meses);
        if (vida <= 0) return;
        const inicio = extractMonthYear(activo.fecha_compra);
        if (inicio.month < 0) return;
        const elapsed = (year - inicio.year) * 12 + (targetMonth - inicio.month);
        if (elapsed >= 0 && elapsed < vida)
          amortizaciones += Num.round2(Num.parse(activo.importe) / vida);
      });
      // ────────────────────────────────────────────────────────────────
      const resultado = ventas - compras - fijos - amortizaciones;

      // ── NUEVO: calcular gasto bancario real vs. lo registrado ──────────────────
      const salidasBancoMes = Math.abs(
        (data.banco || []).filter((b: any) => {
          const d = extractMonthYear(b.date || b.fecha);
          return d.year === year && d.month === targetMonth && Num.parse(b.amount) < 0;
        }).reduce((s: number, b: any) => s + Num.parse(b.amount), 0)
      );
      const gastosRegistradosMes = compras + fijos;
      const gastosBancoNoContabilizado = Math.max(0, salidasBancoMes - gastosRegistradosMes);
      // ──────────────────────────────────────────────────────────────────────────

      return { ventas, compras, fijos, personal, suministros, otrosFijos, amortizaciones, resultado, isClosed:false, id:null, fecha_cierre:null, salidasBancoMes, gastosBancoNoContabilizado };
    });
  }, [data, year, meses, cierresMensuales]);
  const kpis = useMemo(() => yearlySnapshots.reduce((acc, s) => ({
    ventas  : acc.ventas + Num.parse(s.ventas ?? 0),
    variables: acc.variables + Num.parse(s.compras ?? 0),
    fijos   : acc.fijos + Num.parse(s.fijos ?? 0) + Num.parse(s.amortizaciones ?? 0),
    resultado: acc.resultado + Num.parse(s.resultado ?? 0),
    totalBancoNoContabilizado: acc.totalBancoNoContabilizado + Num.parse((s as any).gastosBancoNoContabilizado ?? 0),
  }), { ventas:0, variables:0, fijos:0, resultado:0, totalBancoNoContabilizado:0 }), [yearlySnapshots]);
  const margenContribucionValor = kpis.ventas - kpis.variables;
  const margenContribucionPct = kpis.ventas > 0 ? margenContribucionValor / kpis.ventas : 0;
  const puntoEquilibrio = margenContribucionPct > 0 ? kpis.fijos / margenContribucionPct : 0;
  const foodCostPct = kpis.ventas > 0 ? (kpis.variables / kpis.ventas) * 100 : 0;
  const margenNeto = kpis.ventas > 0 ? (kpis.resultado / kpis.ventas) * 100 : 0;
  const chartData = useMemo(() => yearlySnapshots.map((s, i) => ({
    name : meses[i].substring(0,3).toUpperCase(),
    Ventas: Num.round2(s.ventas ?? 0),
    Gastos: Num.round2((s.compras??0) + (s.fijos??0) + (s.amortizaciones??0)),
    Neto  : Num.round2(s.resultado ?? 0),
  })), [yearlySnapshots, meses]);
  const handleCerrarMes = useCallback(async (mesIndex: number, snapshot: any) => {
    if (!snapshot.ventas && !snapshot.compras && !snapshot.fijos) return void toast.info('⚠️ No hay movimientos en este mes para auditar.');
    if (!await confirm(`🔒 AUDITORÍA DEFINITIVA — ${meses[mesIndex].toUpperCase()} ${year}\n\n¿Confirmas que los datos son correctos y deseas congelar el mes?`)) return;
    const clean = { ventas:snapshot.ventas, compras:snapshot.compras, fijos:snapshot.fijos, personal:snapshot.personal, suministros:snapshot.suministros, otrosFijos:snapshot.otrosFijos, amortizaciones:snapshot.amortizaciones??0, resultado:snapshot.resultado };
    const nuevo: CierreMensual = { id:`cierre-${year}-${mesIndex}`, mes:mesIndex, anio:year, fecha_cierre:new Date().toISOString(), snapshot:clean };
    try { await onSave({ ...data, cierres_mensuales:[...cierresMensuales.filter(c=>c.id!==nuevo.id), nuevo] }); }
    catch { toast.info('❌ Error al guardar el cierre.'); }
  }, [cierresMensuales, data, meses, onSave, year]);
  const handleAbrirMes = useCallback(async (id: string|null) => {
    if (!id) return;
    if (!await confirm('⚠️ Si reabres este mes, los números se recalcularán en vivo. ¿Continuar?')) return;
    try { await onSave({ ...data, cierres_mensuales:cierresMensuales.filter(c=>c.id!==id) }); }
    catch { toast.info('❌ Error al reabrir.'); }
  }, [cierresMensuales, data, onSave]);
  // ── Cerrar el año entero (12 meses) de golpe ───────────────────────────────
  const mesesAbiertosConDatos = useMemo(() =>
    yearlySnapshots
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !s.isClosed && ((s.ventas ?? 0) > 0 || (s.compras ?? 0) > 0 || (s.fijos ?? 0) > 0)),
    [yearlySnapshots]
  );
  const handleCerrarAño = useCallback(async () => {
    if (mesesAbiertosConDatos.length === 0) {
      return void toast.info('Todos los meses con datos ya están cerrados.');
    }
    const nombres = mesesAbiertosConDatos.map(({ i }) => meses[i]).join(', ');
    if (!await confirm(`🔒 CIERRE ANUAL ${year}\n\nSe cerrarán ${mesesAbiertosConDatos.length} meses de golpe:\n${nombres}\n\n¿Seguro que los datos son correctos?`)) return;
    setIsClosingYear(true);
    try {
      const nuevos: CierreMensual[] = mesesAbiertosConDatos.map(({ s, i }) => ({
        id: `cierre-${year}-${i}`,
        mes: i,
        anio: year,
        fecha_cierre: new Date().toISOString(),
        snapshot: {
          ventas: s.ventas, compras: s.compras, fijos: s.fijos,
          personal: s.personal, suministros: s.suministros, otrosFijos: s.otrosFijos,
          amortizaciones: s.amortizaciones ?? 0, resultado: s.resultado,
        },
      }));
      const ids = new Set(nuevos.map(n => n.id));
      await onSave({
        ...data,
        cierres_mensuales: [
          ...cierresMensuales.filter(c => !ids.has(c.id)),
          ...nuevos,
        ],
      });
      toast.success(`✅ Año ${year} cerrado — ${nuevos.length} meses congelados`);
    } catch { toast.info('❌ Error al cerrar el año.'); }
    finally { setIsClosingYear(false); }
  }, [mesesAbiertosConDatos, year, data, cierresMensuales, meses, onSave]);

  // ── Previsión año siguiente ────────────────────────────────────────────────
  const prevision = useMemo(() => {
    const gCrec = prevCrecVentas / 100;
    const gInfl = prevInflacion / 100;
    // Usa los totales del año actual como base
    const base = kpis;
    // Compras/materia prima escalan con ventas (mantienen food cost %)
    const ventasPrev = Num.round2(base.ventas * (1 + gCrec));
    const foodCostPctActual = base.ventas > 0 ? base.variables / base.ventas : 0.30;
    const comprasPrev = Num.round2(ventasPrev * foodCostPctActual);
    const fijosPrev = Num.round2(base.fijos * (1 + gInfl));
    const resultadoPrev = Num.round2(ventasPrev - comprasPrev - fijosPrev);
    const margenPrev = ventasPrev > 0 ? (resultadoPrev / ventasPrev) * 100 : 0;
    // Proyección mensual (distribución proporcional al año actual)
    const mensual = yearlySnapshots.map((s, i) => {
      const share = base.ventas > 0 ? (s.ventas ?? 0) / base.ventas : 1 / 12;
      const ventasMes = Num.round2(ventasPrev * share);
      const comprasMes = Num.round2(ventasMes * foodCostPctActual);
      const fijosMes = Num.round2(fijosPrev / 12);
      return {
        mes: meses[i],
        ventas: ventasMes,
        compras: comprasMes,
        fijos: fijosMes,
        resultado: Num.round2(ventasMes - comprasMes - fijosMes),
      };
    });
    return { ventasPrev, comprasPrev, fijosPrev, resultadoPrev, margenPrev, mensual, foodCostPctActual: foodCostPctActual * 100 };
  }, [kpis, prevCrecVentas, prevInflacion, yearlySnapshots, meses]);

  const handleExportPrevision = () => {
    try {
      const rows = prevision.mensual.map(m => ({
        'PERIODO': `${m.mes} ${year + 1}`,
        'VENTAS PREVISTAS': m.ventas,
        'COMPRAS PREVISTAS': m.compras,
        'FIJOS PREVISTOS': m.fijos,
        'RESULTADO PREVISTO': m.resultado,
      }));
      rows.push({
        'PERIODO': `TOTAL ${year + 1}`,
        'VENTAS PREVISTAS': prevision.ventasPrev,
        'COMPRAS PREVISTAS': prevision.comprasPrev,
        'FIJOS PREVISTOS': prevision.fijosPrev,
        'RESULTADO PREVISTO': prevision.resultadoPrev,
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{wch:22},{wch:20},{wch:20},{wch:20},{wch:22}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Prevision_${year + 1}`);
      XLSX.writeFile(wb, `Prevision_Arume_${year + 1}.xlsx`);
    } catch { toast.info('Error al exportar la previsión.'); }
  };

  const handleExportYear = () => {
    setIsExporting(true);
    try {
      const rows = yearlySnapshots.map((s,i) => ({
        'PERIODO'                    : `${meses[i]} ${year}`,
        'ESTADO'                     : s.isClosed ? 'CERRADO' : 'ABIERTO',
        'INGRESOS (Sin IVA)'         : Num.round2(s.ventas??0),
        'MATERIA PRIMA'              : Num.round2(s.compras??0),
        'GASTO PERSONAL'             : Num.round2(s.personal??0),
        'SUMINISTROS'                : Num.round2(s.suministros??0),
        'OTROS FIJOS'                : Num.round2(s.otrosFijos??0),
        'BENEFICIO NETO'             : Num.round2(s.resultado??0),
        'SALIDAS BANCO REALES'       : Num.round2((s as any).salidasBancoMes??0),
        'GASTO BANCO NO CONTABILIZADO': Num.round2((s as any).gastosBancoNoContabilizado??0),
        'RESULTADO AJUSTADO BANCO'   : Num.round2((s.resultado??0) - ((s as any).gastosBancoNoContabilizado??0)),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{wch:18},{wch:10},{wch:20},{wch:18},{wch:18},{wch:14},{wch:14},{wch:16},{wch:20},{wch:26},{wch:24}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `P&L_${year}`);
      XLSX.writeFile(wb, `Cuenta_Resultados_Arume_${year}.xlsx`);
    } catch { toast.info('Error al exportar.'); }
    finally { setIsExporting(false); }
  };
  const now = new Date();
  return (
    <div className="animate-fade-in space-y-3 pb-20 max-w-[1600px] mx-auto">
      <header className="bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-indigo-500 to-purple-600"/>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-sm"><ShieldCheck className="w-5 h-5"/></div>
          <div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">Cierre Contable P&L</h2>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-[0.15em]">Auditoría & Rentabilidad</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleExportYear} disabled={isExporting} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition border border-emerald-200 disabled:opacity-50">
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Download className="w-3.5 h-3.5"/>} P&G Excel
          </button>
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button onClick={()=>setYear(y=>y-1)} className="p-1.5 bg-white hover:bg-slate-50 rounded-md transition shadow-sm text-slate-600"><ChevronLeft className="w-3.5 h-3.5"/></button>
            <span className="px-3 font-black text-sm text-slate-800 tabular-nums">{year}</span>
            <button onClick={()=>setYear(y=>y+1)} className="p-1.5 bg-white hover:bg-slate-50 rounded-md transition shadow-sm text-slate-600"><ChevronRight className="w-3.5 h-3.5"/></button>
          </div>
        </div>
      </header>
      {kpis.totalBancoNoContabilizado > 0 && (
        <motion.div initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 items-center">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0"/>
          <div className="flex-1">
            <p className="text-xs font-black text-amber-900">⚠️ Gastos bancarios pendientes de contabilizar: <span className="text-amber-700">{Num.fmt(kpis.totalBancoNoContabilizado)}</span></p>
            <p className="text-[10px] font-bold text-amber-600 mt-0.5">El banco registra más salidas de lo que tienes documentado. El resultado real sería aproximadamente <span className="font-black">{Num.fmt(kpis.resultado - kpis.totalBancoNoContabilizado)}</span> (ya incluye estos gastos estimados).</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Resultado ajustado</p>
            <p className="text-lg font-black text-amber-800 tabular-nums">{Num.fmt(kpis.resultado - kpis.totalBancoNoContabilizado)}</p>
          </div>
        </motion.div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="bg-slate-900 p-5 rounded-xl text-white shadow-xl relative overflow-hidden flex-1">
            <div className="absolute -right-3 -bottom-3 text-white/5"><Target className="w-32 h-32"/></div>
            <div className="relative z-10">
              <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1 mb-1.5"><Scale className="w-3.5 h-3.5"/> Break-Even</p>
              <h3 className="text-3xl font-black tracking-tighter tabular-nums mb-0.5">{Num.fmt(puntoEquilibrio)}</h3>
              <p className="text-[10px] font-bold text-slate-400">Facturación YTD mínima para cubrir fijos <span className="text-white">({Num.fmt(kpis.fijos)})</span></p>
              <div className="mt-4 pt-3 border-t border-white/10 flex justify-between items-end">
                <div>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Margen Contribución</p>
                  <p className="text-xl font-black tabular-nums">{Num.round2(margenContribucionPct*100)}%</p>
                </div>
                <div>
                  {kpis.ventas >= puntoEquilibrio && puntoEquilibrio > 0
                    ? <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded text-[9px] font-black uppercase">¡En Beneficios!</span>
                    : <span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-1 rounded text-[9px] font-black uppercase">En Pérdidas</span>}
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={cn('p-3 rounded-xl border shadow-sm', foodCostPct>35?'bg-rose-50 border-rose-100':'bg-white border-slate-200')}>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Coste M.P.</p>
              <p className={cn('text-2xl font-black tabular-nums', foodCostPct>35?'text-rose-600':'text-slate-800')}>{Num.round2(foodCostPct)}%</p>
              <div className="w-full bg-slate-100 h-1 rounded-full mt-2 overflow-hidden">
                <div className={cn('h-full', foodCostPct>35?'bg-rose-500':'bg-emerald-400')} style={{width:`${Math.min(foodCostPct,100)}%`}}/>
              </div>
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-1.5 text-right">Ideal &lt;35%</p>
            </div>
            <div className={cn('p-3 rounded-xl border shadow-sm', kpis.resultado>=0?'bg-indigo-50 border-indigo-100':'bg-rose-50 border-rose-100')}>
              <p className={cn('text-[9px] font-black uppercase tracking-widest flex items-center gap-0.5 mb-1', kpis.resultado>=0?'text-indigo-500':'text-rose-500')}><Wallet className="w-3 h-3"/> Neto YTD</p>
              <p className={cn('text-xl font-black tabular-nums tracking-tight', kpis.resultado>=0?'text-indigo-700':'text-rose-700')}>{Num.fmt(kpis.resultado)}</p>
              <p className={cn('text-[9px] font-bold uppercase mt-1.5', kpis.resultado>=0?'text-indigo-400':'text-rose-400')}>Margen: {Num.round2(margenNeto)}%</p>
            </div>
          </div>
        </div>
        <div className="lg:col-span-7 bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h3 className="text-xs font-black text-slate-800 flex items-center gap-1.5"><Activity className="w-4 h-4 text-indigo-500"/> P&L {year}</h3>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Ingresos vs Gastos vs Neto</p>
            </div>
          </div>
          <div className="flex-1 min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%" minHeight={220}>
              <ComposedChart data={chartData} margin={{top:6,right:0,left:-24,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                <XAxis dataKey="name" tick={{fontSize:9,fill:'#94a3b8',fontWeight:'bold'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:9,fill:'#94a3b8',fontWeight:'bold'}} axisLine={false} tickLine={false} tickFormatter={v=>`${v/1000}k`}/>
                <RechartsTooltip contentStyle={{borderRadius:8,border:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}} formatter={(v:number,n:string)=>[Num.fmt(v),n]} labelStyle={{fontWeight:'black',color:'#1e293b',marginBottom:'2px'}}/>
                <Bar dataKey="Gastos" fill="#fb7185" radius={[3,3,0,0]} maxBarSize={22}/>
                <Bar dataKey="Ventas" fill="#34d399" radius={[3,3,0,0]} maxBarSize={22}/>
                <Line type="monotone" dataKey="Neto" stroke="#4f46e5" strokeWidth={2.5} dot={{r:3,strokeWidth:2,fill:'#fff'}}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex gap-3 items-start">
        <div className="bg-white p-2 rounded-lg shadow-sm shrink-0"><Lightbulb className="w-5 h-5 text-amber-500"/></div>
        <div>
          <h4 className="text-xs font-black text-indigo-900 mb-0.5">Diagnóstico Financiero</h4>
          <p className="text-[10px] font-bold text-indigo-700/80 leading-relaxed">
            {kpis.ventas === 0
              ? 'Aún no hay datos de ventas registrados este año.'
              : kpis.resultado < 0
                ? `Estás por debajo del break-even. Faltan ${Num.fmt(puntoEquilibrio-kpis.ventas)} en ventas para entrar en beneficios.`
                : foodCostPct > 35
                  ? `¡En beneficios! Pero el coste de M.P. (${Num.round2(foodCostPct)}%) es alto. Revisa los Platos Perro.`
                  : '¡Excelente salud financiera! Coste de M.P. óptimo y superando el break-even.'}
          </p>
        </div>
      </div>
      <div>
        <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest mb-3 ml-2">Auditoría Mensual · Desglose P&L</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <AnimatePresence mode="popLayout">
            {meses.map((nombreMes, i) => {
              const datos = yearlySnapshots[i];
              const isClosed = datos.isClosed;
              const isFuture = year > now.getFullYear() || (year === now.getFullYear() && i > now.getMonth());
              const canClose = !isClosed && !isFuture;
              const margenM = (datos.ventas??0) > 0 ? ((datos.resultado??0) / (datos.ventas??1)) * 100 : 0;
              const gastosM = (datos.compras??0)+(datos.personal??0)+(datos.suministros??0)+(datos.otrosFijos??0);
              const bancoPendiente = (datos as any).gastosBancoNoContabilizado ?? 0;
              const resultadoAjustado = (datos.resultado??0) - bancoPendiente;
              return (
                <motion.div
                  key={`${year}-${i}`}
                  initial={{opacity:0,scale:0.97,y:10}}
                  animate={{opacity:1,scale:1,y:0}}
                  transition={{duration:0.2,delay:i*0.03}}
                  className={cn(
                    'relative p-3.5 rounded-xl border transition-all duration-200 flex flex-col group',
                    isClosed ? 'bg-white border-emerald-200 shadow-sm'
                    : isFuture ? 'bg-slate-50/50 border-slate-100 opacity-60 grayscale-[0.5]'
                    : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md',
                  )}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className={cn('text-sm font-black tracking-tight', isFuture?'text-slate-400':'text-slate-800')}>{nombreMes}</h3>
                      <div className={cn('flex items-center gap-0.5 mt-0.5 text-[8px] font-black uppercase tracking-wider', isClosed?'text-emerald-600':isFuture?'text-slate-400':'text-indigo-500')}>
                        {isClosed?<Lock className="w-2 h-2"/>:<Unlock className="w-2 h-2"/>}
                        {isClosed?'Auditado':isFuture?'Futuro':'En Edición'}
                      </div>
                    </div>
                    {isClosed && <div className="bg-emerald-50 border border-emerald-100 p-1 rounded-lg"><CheckCircle2 className="w-3 h-3 text-emerald-500"/></div>}
                  </div>
                  <div className="space-y-1.5 mb-3 flex-1">
                    <div className="flex justify-between items-center bg-emerald-50/50 px-2 py-1 rounded-md border border-emerald-100">
                      <span className="text-[9px] font-black text-emerald-600 uppercase tracking-wider">Ventas</span>
                      <span className="text-[10px] font-black text-emerald-700 tabular-nums">{Num.fmt(datos.ventas??0)}</span>
                    </div>
                    <div className="bg-rose-50/30 rounded-md border border-rose-100 p-1.5">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[9px] font-black text-rose-600 uppercase tracking-wider">Total Gastos</span>
                        <span className="text-[10px] font-bold text-rose-600 tabular-nums">-{Num.fmt(gastosM)}</span>
                      </div>
                      <div className="space-y-0.5 border-t border-rose-100/50 pt-1">
                        {([
                          ['↳ Compras', datos.compras??0],
                          ['↳ Personal', datos.personal??0],
                          ['↳ Suministros', datos.suministros??0],
                          ['↳ Otros Fijos', datos.otrosFijos??0],
                        ] as [string,number][]).map(([label,val]) => (
                          <div key={label} className="flex justify-between items-center">
                            <span className="text-[8px] font-bold text-rose-400 uppercase">{label}</span>
                            <span className="text-[9px] font-bold text-rose-500 tabular-nums">{Num.fmt(val)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {!isClosed && bancoPendiente > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5 text-amber-500 shrink-0"/>
                          <span className="text-[8px] font-black text-amber-700 uppercase tracking-wider">Banco pendiente</span>
                        </div>
                        <span className="text-[9px] font-black text-amber-700 tabular-nums">-{Num.fmt(bancoPendiente)}</span>
                      </div>
                    )}
                    <div className="pt-1.5 flex justify-between items-end border-t border-slate-100">
                      <div>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Beneficio Neto</span>
                        {!isClosed && bancoPendiente > 0 && (
                          <span className="text-[8px] font-bold text-amber-600 block">(banco: {Num.fmt(resultadoAjustado)})</span>
                        )}
                      </div>
                      <p className={cn('text-lg font-black tracking-tighter tabular-nums', (datos.resultado??0)>=0?'text-indigo-600':'text-rose-600')}>
                        {Num.fmt(datos.resultado??0)}
                      </p>
                    </div>
                    {!isFuture && (
                      <div className="w-full bg-slate-100 h-0.5 rounded-full overflow-hidden">
                        <div className={cn('h-full', (datos.resultado??0)>=0?'bg-indigo-500':'bg-rose-400')} style={{width:`${Math.min(Math.max(margenM,0),100)}%`}}/>
                      </div>
                    )}
                  </div>
                  <div className="mt-auto pt-1.5">
                    {canClose && (
                      <button onClick={()=>handleCerrarMes(i,datos)} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-black text-[9px] uppercase tracking-widest hover:bg-indigo-700 transition active:scale-95 shadow-sm flex items-center justify-center gap-1">
                        <Lock className="w-2.5 h-2.5"/> Congelar Mes
                      </button>
                    )}
                    {isClosed && (
                      <button onClick={()=>handleAbrirMes(datos.id)} className="w-full py-1.5 bg-white border border-rose-200 text-rose-600 rounded-lg font-bold text-[9px] uppercase tracking-widest hover:bg-rose-50 transition shadow-sm flex items-center justify-center gap-1">
                        <Unlock className="w-2.5 h-2.5"/> Reabrir
                      </button>
                    )}
                    {isFuture && (
                      <div className="w-full py-1.5 flex justify-center items-center gap-1 opacity-40">
                        <Clock className="w-2.5 h-2.5 text-slate-400"/>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">En Espera</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          📊 RESUMEN ANUAL & CIERRE DEL AÑO
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-purple-700 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/15 rounded-lg"><ShieldCheck className="w-5 h-5"/></div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest">Resumen Anual {year}</h3>
              <p className="text-[11px] opacity-80">P&L del año completo</p>
            </div>
          </div>
          <button
            onClick={handleCerrarAño}
            disabled={isClosingYear || mesesAbiertosConDatos.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white text-indigo-700 rounded-xl font-black text-xs uppercase tracking-widest shadow-md hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isClosingYear
              ? <><Loader2 className="w-4 h-4 animate-spin"/> Cerrando…</>
              : mesesAbiertosConDatos.length === 0
                ? <><CheckCircle2 className="w-4 h-4"/> Año ya cerrado</>
                : <><Lock className="w-4 h-4"/> Cerrar Año ({mesesAbiertosConDatos.length} meses)</>
            }
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/10 rounded-xl p-3 backdrop-blur">
            <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Ventas netas</p>
            <p className="text-xl font-black tabular-nums">{Num.fmt(kpis.ventas)}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3 backdrop-blur">
            <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Compras</p>
            <p className="text-xl font-black tabular-nums">{Num.fmt(kpis.variables)}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3 backdrop-blur">
            <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Fijos + Amort.</p>
            <p className="text-xl font-black tabular-nums">{Num.fmt(kpis.fijos)}</p>
          </div>
          <div className={cn('rounded-xl p-3 backdrop-blur', kpis.resultado >= 0 ? 'bg-emerald-500/30' : 'bg-rose-500/30')}>
            <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Resultado</p>
            <p className="text-xl font-black tabular-nums">{Num.fmt(kpis.resultado)}</p>
            <p className="text-[9px] opacity-80 mt-0.5">Margen {margenNeto.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          🔮 PREVISIÓN AÑO SIGUIENTE
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-fuchsia-500 to-violet-500 text-white rounded-lg"><Target className="w-5 h-5"/></div>
            <div>
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Previsión {year + 1}</h3>
              <p className="text-[10px] text-slate-400 font-bold">Proyección basada en {year}</p>
            </div>
          </div>
          <button onClick={handleExportPrevision}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-fuchsia-50 text-fuchsia-600 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-fuchsia-100 border border-fuchsia-200">
            <Download className="w-3.5 h-3.5"/> Excel
          </button>
        </div>

        {/* Parámetros editables */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-50 rounded-xl p-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Crecimiento ventas (%)</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range"
                min="-20" max="50" step="1"
                value={prevCrecVentas}
                onChange={e => setPrevCrecVentas(parseInt(e.target.value))}
                className="flex-1 accent-fuchsia-500"
              />
              <input
                type="number"
                value={prevCrecVentas}
                onChange={e => setPrevCrecVentas(parseInt(e.target.value || '0'))}
                className="w-16 text-center bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm font-black"
              />
              <span className="text-sm font-black text-slate-600">%</span>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Inflación gastos fijos (%)</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range"
                min="-10" max="30" step="1"
                value={prevInflacion}
                onChange={e => setPrevInflacion(parseInt(e.target.value))}
                className="flex-1 accent-fuchsia-500"
              />
              <input
                type="number"
                value={prevInflacion}
                onChange={e => setPrevInflacion(parseInt(e.target.value || '0'))}
                className="w-16 text-center bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm font-black"
              />
              <span className="text-sm font-black text-slate-600">%</span>
            </div>
          </div>
        </div>

        {/* Totales previstos */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Ventas previstas</p>
            <p className="text-lg font-black text-emerald-700 tabular-nums">{Num.fmt(prevision.ventasPrev)}</p>
            <p className="text-[9px] text-emerald-500 mt-0.5">{prevCrecVentas >= 0 ? '+' : ''}{prevCrecVentas}% vs {year}</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Compras previstas</p>
            <p className="text-lg font-black text-amber-700 tabular-nums">{Num.fmt(prevision.comprasPrev)}</p>
            <p className="text-[9px] text-amber-500 mt-0.5">Food cost {prevision.foodCostPctActual.toFixed(1)}%</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Fijos previstos</p>
            <p className="text-lg font-black text-slate-700 tabular-nums">{Num.fmt(prevision.fijosPrev)}</p>
            <p className="text-[9px] text-slate-400 mt-0.5">{prevInflacion >= 0 ? '+' : ''}{prevInflacion}% inflación</p>
          </div>
          <div className={cn('rounded-xl p-3 border', prevision.resultadoPrev >= 0 ? 'bg-indigo-50 border-indigo-100' : 'bg-rose-50 border-rose-100')}>
            <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Resultado previsto</p>
            <p className={cn('text-lg font-black tabular-nums', prevision.resultadoPrev >= 0 ? 'text-indigo-700' : 'text-rose-700')}>{Num.fmt(prevision.resultadoPrev)}</p>
            <p className="text-[9px] opacity-70 mt-0.5">Margen {prevision.margenPrev.toFixed(1)}%</p>
          </div>
        </div>

        {/* Tabla mensual prevista */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-3 font-black text-slate-500 text-[10px] uppercase tracking-widest">Mes</th>
                <th className="text-right py-2 px-3 font-black text-emerald-600 text-[10px] uppercase tracking-widest">Ventas</th>
                <th className="text-right py-2 px-3 font-black text-amber-600 text-[10px] uppercase tracking-widest">Compras</th>
                <th className="text-right py-2 px-3 font-black text-slate-500 text-[10px] uppercase tracking-widest">Fijos</th>
                <th className="text-right py-2 px-3 font-black text-indigo-600 text-[10px] uppercase tracking-widest">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {prevision.mensual.map((m, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 px-3 font-bold text-slate-700">{m.mes}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-700">{Num.fmt(m.ventas)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-amber-700">{Num.fmt(m.compras)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-600">{Num.fmt(m.fijos)}</td>
                  <td className={cn('py-2 px-3 text-right tabular-nums font-black', m.resultado >= 0 ? 'text-indigo-700' : 'text-rose-700')}>{Num.fmt(m.resultado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-start gap-2 bg-slate-50 rounded-xl p-3">
          <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5"/>
          <p className="text-[10px] text-slate-600 font-medium leading-relaxed">
            <b>Cómo funciona:</b> las ventas crecen/decrecen según el % que indiques. Las compras mantienen el food cost actual ({prevision.foodCostPctActual.toFixed(1)}%). Los fijos se ajustan con el % de inflación. Los meses conservan la estacionalidad del año actual.
          </p>
        </div>
      </div>

    </div>
  );
};
