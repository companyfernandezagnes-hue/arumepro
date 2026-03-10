import React, { useState, useMemo } from 'react';
import { 
  Lock, Unlock, ChevronLeft, ChevronRight, 
  CheckCircle2, AlertCircle, TrendingUp, TrendingDown, 
  BarChart3, ShieldCheck
} from 'lucide-react';
import { motion } from 'framer-motion';
import { AppData, CierreMensual } from '../types';
import { ArumeEngine, Num } from '../services/engine';
import { cn } from '../lib/utils';

interface CierreContableViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const CierreContableView: React.FC<CierreContableViewProps> = ({ data, onSave }) => {
  const [year, setYear] = useState(new Date().getFullYear());
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  const cierresMensuales = data.cierres_mensuales || [];

  // 🚀 OPTIMIZACIÓN: Calculamos los snapshots con el ArumeEngine centralizado
  // Esto asegura que la lógica de beneficio sea la misma en el Dashboard y aquí.
  const yearlySnapshots = useMemo(() => {
    return meses.map((_, i) => {
      const profitData = ArumeEngine.getProfit(data, i + 1, year);
      return {
        ventas: profitData.ingresos.total,
        compras: profitData.gastos.comida + profitData.gastos.bebida + profitData.gastos.otros,
        fijos: profitData.gastos.personal + profitData.gastos.estructura,
        amortizaciones: profitData.gastos.amortizacion,
        resultado: profitData.neto
      };
    });
  }, [data, year]);

  const handleCerrarMes = async (mesIndex: number, snapshot: any) => {
    if (snapshot.ventas === 0) {
      return alert("⚠️ Error: No se pueden cerrar periodos sin actividad comercial.");
    }

    const confirmMsg = `🔒 AUDITORÍA DE CIERRE - ${meses[mesIndex].toUpperCase()} ${year}\n\n` +
      `Se va a proceder al bloqueo de los resultados financieros:\n` +
      `• Facturación: ${Num.fmt(snapshot.ventas)}\n` +
      `• Beneficio Neto: ${Num.fmt(snapshot.resultado)}\n\n` +
      `¿Confirmas que los datos son correctos y deseas congelar el periodo?`;

    if (!window.confirm(confirmMsg)) return;

    const nuevoCierre: CierreMensual = {
      id: `cierre-${year}-${mesIndex}`,
      mes: mesIndex,
      anio: year,
      fecha_cierre: new Date().toISOString(),
      snapshot: snapshot
    };

    // 🛡️ Guardado seguro evitando duplicados por ID
    const nuevosCierres = [...cierresMensuales.filter(c => c.id !== nuevoCierre.id), nuevoCierre];
    
    await onSave({
      ...data,
      cierres_mensuales: nuevosCierres
    });
  };

  const handleAbrirMes = async (id: string) => {
    if (!window.confirm("⚠️ ALERTA: ¿Reabrir periodo auditado? Los datos volverán a calcularse en tiempo real según las facturas y cajas actuales.")) return;
    await onSave({
      ...data,
      cierres_mensuales: cierresMensuales.filter(c => c.id !== id)
    });
  };

  return (
    <div className="animate-fade-in space-y-8 pb-24">
      {/* 🏛️ HEADER PROFESIONAL */}
      <header className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="p-4 bg-indigo-600 text-white rounded-3xl shadow-lg shadow-indigo-200">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Libro de Cierres</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">Auditoría · Diamond Connected</p>
          </div>
        </div>

        <div className="flex items-center bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
          <button onClick={() => setYear(y => y - 1)} className="p-3 hover:bg-white rounded-xl transition shadow-sm text-slate-600"><ChevronLeft className="w-5 h-5"/></button>
          <span className="px-6 font-black text-lg text-slate-800">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-3 hover:bg-white rounded-xl transition shadow-sm text-slate-600"><ChevronRight className="w-5 h-5"/></button>
        </div>
      </header>

      {/* 📊 RESUMEN ANUAL KPI (Mejora Auditoría #51) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white flex justify-between items-center">
              <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Acumulado Anual</p>
                  <p className="text-3xl font-black text-emerald-400 mt-1">
                      {Num.fmt(yearlySnapshots.reduce((acc, s) => acc + s.ventas, 0))}
                  </p>
              </div>
              <BarChart3 className="w-10 h-10 text-slate-700" />
          </div>
          <div className="bg-indigo-50 p-6 rounded-[2.5rem] border border-indigo-100 flex justify-between items-center">
              <div>
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Resultado Neto Ejercicio</p>
                  <p className={cn("text-3xl font-black mt-1", 
                    yearlySnapshots.reduce((acc, s) => acc + s.resultado, 0) >= 0 ? "text-indigo-600" : "text-rose-600"
                  )}>
                      {Num.fmt(yearlySnapshots.reduce((acc, s) => acc + s.resultado, 0))}
                  </p>
              </div>
              <TrendingUp className="w-10 h-10 text-indigo-200" />
          </div>
      </div>

      {/* 📅 GRID DE MESES */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {meses.map((nombreMes, i) => {
          const cierre = cierresMensuales.find(c => c.mes === i && c.anio === year);
          const isClosed = !!cierre;
          const datos = isClosed ? cierre.snapshot : yearlySnapshots[i];
          
          const now = new Date();
          const isFuture = year > now.getFullYear() || (year === now.getFullYear() && i > now.getMonth());
          const canClose = !isClosed && !isFuture;

          return (
            <motion.div
              key={`${year}-${i}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                "relative p-8 rounded-[3rem] border transition-all duration-300",
                isClosed 
                  ? "bg-white border-emerald-200 shadow-xl shadow-emerald-50/50" 
                  : "bg-white border-slate-100 hover:border-indigo-200 hover:shadow-2xl"
              )}
            >
              {/* STATUS INDICATOR */}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-black tracking-tighter text-slate-800">{nombreMes}</h3>
                  <div className={cn("flex items-center gap-1.5 mt-1 text-[9px] font-black uppercase tracking-wider", isClosed ? "text-emerald-500" : "text-slate-400")}>
                    {isClosed ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                    {isClosed ? "Auditado y Cerrado" : "Periodo en Edición"}
                  </div>
                </div>
                {isClosed && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
              </div>

              {/* FINANCES MINI-GRID */}
              <div className="space-y-3 mb-8">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Facturación</span>
                  <span className="text-sm font-black text-slate-700">{Num.fmt(datos.ventas)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Costes Totales</span>
                  <span className="text-sm font-bold text-rose-500">-{Num.fmt(datos.compras + datos.fijos + datos.amortizaciones)}</span>
                </div>
                
                <div className="h-px bg-slate-100 my-2" />

                <div className="flex justify-between items-end">
                  <span className="text-[9px] font-black text-slate-300 uppercase">Beneficio Neto</span>
                  <div className="text-right">
                    <p className={cn("text-xl font-black tracking-tighter leading-none", 
                      datos.resultado >= 0 ? "text-emerald-600" : "text-rose-600"
                    )}>
                      {Num.fmt(datos.resultado)}
                    </p>
                    <p className="text-[8px] font-bold text-slate-400 mt-1 uppercase">
                        Margen: {datos.ventas > 0 ? ((datos.resultado / datos.ventas) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                </div>
              </div>

              {/* CTA BUTTONS */}
              {canClose && (
                <button 
                  onClick={() => handleCerrarMes(i, datos)}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-600 transition-all active:scale-95 shadow-lg"
                >
                  ❄️ CONGELAR RESULTADOS
                </button>
              )}

              {isClosed && (
                <button 
                  onClick={() => handleAbrirMes(cierre.id)} 
                  className="w-full py-4 bg-white border border-rose-100 text-rose-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-50 transition-all"
                >
                  🔓 REABRIR AUDITORÍA
                </button>
              )}

              {isFuture && (
                <div className="flex items-center justify-center gap-2 py-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <AlertCircle className="w-3 h-3 text-slate-300" />
                  <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Periodo no vencido</span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
