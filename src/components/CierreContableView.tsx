import React, { useState, useMemo, useCallback } from 'react';
import { 
  Lock, Unlock, ChevronLeft, ChevronRight, 
  CheckCircle2, AlertCircle, TrendingUp, TrendingDown, 
  BarChart3, ShieldCheck, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppData, CierreMensual } from '../types';
import { ArumeEngine, Num } from '../services/engine';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';

interface CierreContableViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const CierreContableView: React.FC<CierreContableViewProps> = ({ data, onSave }) => {
  const [year, setYear] = useState(new Date().getFullYear());
  const [isExporting, setIsExporting] = useState(false);

  const meses = useMemo(() => [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ], []);

  const cierresMensuales = useMemo(() => data.cierres_mensuales || [], [data.cierres_mensuales]);

  // 🚀 OPTIMIZACIÓN EXTREMA: El cerebro solo calcula cuando cambian los datos reales o el año
  const yearlySnapshots = useMemo(() => {
    return meses.map((_, i) => {
      // 1. Miramos si ya hay un cierre oficial guardado
      const cierreOficial = cierresMensuales.find(c => c.mes === i && c.anio === year);
      
      // 2. Si está cerrado, usamos sus datos INMUTABLES. Si no, calculamos en tiempo real.
      if (cierreOficial) {
        return { ...cierreOficial.snapshot, isClosed: true, id: cierreOficial.id, fecha_cierre: cierreOficial.fecha_cierre };
      }

      // 3. Calculamos en vivo usando el Motor
      const profitData = ArumeEngine.getProfit(data, i + 1, year);
      return {
        ventas: profitData.ingresos.total,
        compras: profitData.gastos.comida + profitData.gastos.bebida + profitData.gastos.otros,
        fijos: profitData.gastos.personal + profitData.gastos.estructura,
        amortizaciones: profitData.gastos.amortizacion,
        resultado: profitData.neto,
        isClosed: false,
        id: null,
        fecha_cierre: null
      };
    });
  }, [data, year, meses, cierresMensuales]);

  // 💰 KPIs ANUALES RÁPIDOS
  const kpisAnuales = useMemo(() => {
    return yearlySnapshots.reduce((acc, s) => ({
      ventas: acc.ventas + s.ventas,
      resultado: acc.resultado + s.resultado
    }), { ventas: 0, resultado: 0 });
  }, [yearlySnapshots]);

  // 🔒 FUNCIÓN DE CIERRE BLINDADA
  const handleCerrarMes = useCallback(async (mesIndex: number, snapshot: any) => {
    if (snapshot.ventas <= 0) {
      return alert("⚠️ Bloqueo: No puedes auditar un mes que no tiene facturación registrada.");
    }

    const confirmMsg = `🔒 AUDITORÍA DEFINITIVA - ${meses[mesIndex].toUpperCase()} ${year}\n\n` +
      `Vas a congelar los resultados de este periodo:\n` +
      `• Ventas: ${Num.fmt(snapshot.ventas)}\n` +
      `• Bº Neto: ${Num.fmt(snapshot.resultado)}\n\n` +
      `¿Confirmas que los datos contables son correctos?`;

    if (!window.confirm(confirmMsg)) return;

    // Limpiamos los datos temporales del snapshot antes de guardar
    const cleanSnapshot = {
      ventas: snapshot.ventas, compras: snapshot.compras,
      fijos: snapshot.fijos, amortizaciones: snapshot.amortizaciones,
      resultado: snapshot.resultado
    };

    const nuevoCierre: CierreMensual = {
      id: `cierre-${year}-${mesIndex}`,
      mes: mesIndex,
      anio: year,
      fecha_cierre: new Date().toISOString(),
      snapshot: cleanSnapshot
    };

    // Actualizamos eliminando el antiguo (por si acaso) y metiendo el nuevo
    const nuevosCierres = [...cierresMensuales.filter(c => c.id !== nuevoCierre.id), nuevoCierre];
    
    try {
      await onSave({ ...data, cierres_mensuales: nuevosCierres });
    } catch (error) {
      alert("❌ Error de conexión al guardar el cierre. Inténtalo de nuevo.");
    }
  }, [cierresMensuales, data, meses, onSave, year]);

  // 🔓 REABRIR MES
  const handleAbrirMes = useCallback(async (id: string | null) => {
    if (!id) return;
    if (!window.confirm("⚠️ ALERTA DE AUDITORÍA: Si reabres este mes, los números se recalcularán usando las facturas que haya ahora mismo en el sistema. ¿Continuar?")) return;
    
    try {
      await onSave({ ...data, cierres_mensuales: cierresMensuales.filter(c => c.id !== id) });
    } catch (error) {
      alert("❌ Error al intentar reabrir el periodo.");
    }
  }, [cierresMensuales, data, onSave]);

  // 📊 EXPORTADOR PARA LA GESTORÍA
  const handleExportYear = () => {
    setIsExporting(true);
    try {
      const rows = yearlySnapshots.map((s, i) => ({
        'PERIODO': `${meses[i]} ${year}`,
        'ESTADO': s.isClosed ? 'CERRADO (Auditado)' : 'ABIERTO (En vivo)',
        'INGRESOS TOTALES': Num.round2(s.ventas),
        'COSTES VARIABLES': Num.round2(s.compras),
        'COSTES FIJOS': Num.round2(s.fijos),
        'AMORTIZACIONES': Num.round2(s.amortizaciones),
        'BENEFICIO NETO': Num.round2(s.resultado),
        'MARGEN (%)': s.ventas > 0 ? Num.round2((s.resultado / s.ventas) * 100) : 0
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Balance_${year}`);
      XLSX.writeFile(wb, `Balance_Arume_Pro_${year}.xlsx`);
    } catch (error) {
      alert("Hubo un error al generar el Excel.");
    } finally {
      setIsExporting(false);
    }
  };

  const now = new Date();

  return (
    <div className="animate-fade-in space-y-8 pb-24">
      {/* 🏛️ HEADER PROFESIONAL */}
      <header className="bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="p-4 bg-indigo-600 text-white rounded-3xl shadow-lg shadow-indigo-200 shrink-0">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Libro de Cierres</h2>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-[0.2em] mt-0.5">Auditoría Financiera Real</p>
          </div>
        </div>

        <div className="flex gap-3 w-full md:w-auto justify-end">
          <button 
            onClick={handleExportYear} 
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-3 bg-emerald-50 text-emerald-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition border border-emerald-100 shadow-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span className="hidden md:inline">Descargar P&G</span>
          </button>
          
          <div className="flex items-center bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
            <button onClick={() => setYear(y => y - 1)} className="p-2.5 bg-white hover:bg-slate-50 rounded-xl transition shadow-sm text-slate-600"><ChevronLeft className="w-5 h-5"/></button>
            <span className="px-6 font-black text-lg text-slate-800 tabular-nums">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="p-2.5 bg-white hover:bg-slate-50 rounded-xl transition shadow-sm text-slate-600"><ChevronRight className="w-5 h-5"/></button>
          </div>
        </div>
      </header>

      {/* 📊 RESUMEN ANUAL KPI */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white flex justify-between items-center shadow-xl">
              <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Facturación Acumulada</p>
                  <p className="text-4xl font-black text-emerald-400 mt-1 tracking-tighter">
                      {Num.fmt(kpisAnuales.ventas)}
                  </p>
              </div>
              <BarChart3 className="w-12 h-12 text-slate-700 opacity-50" />
          </div>
          <div className="bg-indigo-50 p-6 rounded-[2.5rem] border border-indigo-100 flex justify-between items-center shadow-sm">
              <div>
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Resultado Neto del Ejercicio</p>
                  <p className={cn("text-4xl font-black mt-1 tracking-tighter", 
                    kpisAnuales.resultado >= 0 ? "text-indigo-600" : "text-rose-600"
                  )}>
                      {Num.fmt(kpisAnuales.resultado)}
                  </p>
              </div>
              <TrendingUp className="w-12 h-12 text-indigo-200 opacity-50" />
          </div>
      </div>

      {/* 📅 GRID DE MESES */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <AnimatePresence mode='popLayout'>
          {meses.map((nombreMes, i) => {
            const datos = yearlySnapshots[i];
            const isClosed = datos.isClosed;
            const isFuture = year > now.getFullYear() || (year === now.getFullYear() && i > now.getMonth());
            const canClose = !isClosed && !isFuture;

            return (
              <motion.div
                key={`${year}-${i}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "relative p-6 md:p-8 rounded-[3rem] border transition-all duration-300 flex flex-col",
                  isClosed 
                    ? "bg-white border-emerald-200 shadow-xl shadow-emerald-50/50" 
                    : isFuture 
                      ? "bg-slate-50/50 border-slate-100 opacity-70"
                      : "bg-white border-slate-200 hover:border-indigo-300 hover:shadow-2xl"
                )}
              >
                {/* STATUS INDICATOR */}
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className={cn("text-xl md:text-2xl font-black tracking-tighter", isFuture ? "text-slate-400" : "text-slate-800")}>{nombreMes}</h3>
                    <div className={cn("flex items-center gap-1 mt-1 text-[9px] font-black uppercase tracking-wider", isClosed ? "text-emerald-600" : isFuture ? "text-slate-400" : "text-indigo-500")}>
                      {isClosed ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                      {isClosed ? "Auditado y Cerrado" : isFuture ? "No Disponible" : "Periodo en Edición"}
                    </div>
                  </div>
                  {isClosed && <div className="bg-emerald-100 p-2 rounded-full"><CheckCircle2 className="w-5 h-5 text-emerald-600" /></div>}
                </div>

                {/* FINANCES MINI-GRID */}
                <div className="space-y-3 mb-8 flex-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Facturación</span>
                    <span className="text-sm font-black text-slate-700 tabular-nums">{Num.fmt(datos.ventas)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Costes Operativos</span>
                    <span className="text-sm font-bold text-rose-500 tabular-nums">-{Num.fmt(datos.compras + datos.fijos + datos.amortizaciones)}</span>
                  </div>
                  
                  <div className="h-px bg-slate-100 my-4" />

                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Beneficio Neto</span>
                    <div className="text-right">
                      <p className={cn("text-2xl font-black tracking-tighter leading-none tabular-nums", 
                        datos.resultado >= 0 ? "text-emerald-600" : "text-rose-600"
                      )}>
                        {Num.fmt(datos.resultado)}
                      </p>
                      <p className="text-[9px] font-black text-slate-400 mt-1.5 uppercase tracking-wider">
                          Margen: {datos.ventas > 0 ? ((datos.resultado / datos.ventas) * 100).toFixed(1) : 0}%
                      </p>
                    </div>
                  </div>
                </div>

                {/* CTA BUTTONS */}
                <div className="mt-auto">
                  {canClose && (
                    <button 
                      onClick={() => handleCerrarMes(i, datos)}
                      className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-600 transition-all active:scale-95 shadow-lg shadow-slate-900/20"
                    >
                      ❄️ CONGELAR RESULTADOS
                    </button>
                  )}

                  {isClosed && (
                    <div className="flex items-center justify-between bg-slate-50 p-2 pl-4 rounded-2xl border border-slate-100">
                       <span className="text-[9px] font-bold text-slate-400 uppercase">Cerrado</span>
                       <button 
                         onClick={() => handleAbrirMes(datos.id)} 
                         className="px-4 py-2 bg-white border border-rose-100 text-rose-500 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-rose-50 transition-all shadow-sm"
                       >
                         🔓 REABRIR
                       </button>
                    </div>
                  )}

                  {isFuture && (
                    <div className="w-full py-4 bg-slate-100/50 rounded-2xl border border-dashed border-slate-200 flex justify-center items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Aún no disponible</span>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
