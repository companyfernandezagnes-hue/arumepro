import React, { useState, useMemo } from 'react';
import { 
  Lock, Unlock, ChevronLeft, ChevronRight, History, 
  CheckCircle2, AlertCircle, TrendingUp, TrendingDown 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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

  // 🚀 OPTIMIZACIÓN: Calculamos los snapshots de todo el año de una sola vez
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

  const cierresMensuales = data.cierres_mensuales || [];

  const handleCerrarMes = async (mesIndex: number, snapshot: any) => {
    if (snapshot.ventas === 0) {
      return alert("⚠️ No puedes cerrar un mes sin ventas registradas.");
    }

    const confirmMsg = `¿Cerrar ${meses[mesIndex]} ${year}?\n\n` +
      `Ventas: ${Num.fmt(snapshot.ventas)}\n` +
      `Resultado: ${Num.fmt(snapshot.resultado)}\n\n` +
      `🔒 Esto creará un registro permanente e inalterable.`;

    if (!confirm(confirmMsg)) return;

    const nuevoCierre: CierreMensual = {
      id: `cierre-${year}-${mesIndex}-${Date.now()}`,
      mes: mesIndex,
      anio: year,
      fecha_cierre: new Date().toISOString(),
      snapshot: snapshot
    };

    await onSave({
      ...data,
      cierres_mensuales: [...cierresMensuales, nuevoCierre]
    });
  };

  const handleAbrirMes = async (id: string) => {
    if (!confirm("⚠️ ¿Deseas reabrir este periodo? Los datos volverán a ser calculados en tiempo real.")) return;
    await onSave({
      ...data,
      cierres_mensuales: cierresMensuales.filter(c => c.id !== id)
    });
  };

  return (
    <div className="animate-fade-in space-y-8 pb-24">
      {/* HEADER CON SELECTOR DE AÑO */}
      <header className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="p-4 bg-indigo-50 rounded-3xl text-indigo-600">
            <Lock className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Cierre Contable</h2>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Auditoría y Bloqueo de Resultados</p>
          </div>
        </div>

        <div className="flex items-center bg-slate-100 p-2 rounded-[2rem] border border-slate-200 shadow-inner">
          <button onClick={() => setYear(y => y - 1)} className="p-3 hover:bg-white rounded-2xl transition shadow-sm text-slate-600"><ChevronLeft /></button>
          <span className="px-8 font-black text-xl text-slate-800">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-3 hover:bg-white rounded-2xl transition shadow-sm text-slate-600"><ChevronRight /></button>
        </div>
      </header>

      

      {/* GRID DE MESES */}
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
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn(
                "relative p-8 rounded-[3rem] border transition-all duration-500",
                isClosed 
                  ? "bg-slate-900 border-slate-800 text-white shadow-2xl" 
                  : "bg-white border-slate-100 hover:border-indigo-200 hover:shadow-xl"
              )}
            >
              {/* STATUS BADGE */}
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-2xl font-black tracking-tighter">{nombreMes}</h3>
                  <div className={cn("flex items-center gap-1.5 mt-1 text-[10px] font-black uppercase tracking-widest", isClosed ? "text-indigo-400" : "text-slate-400")}>
                    {isClosed ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    {isClosed ? "Contabilidad Cerrada" : "Periodo en Vivo"}
                  </div>
                </div>
                {datos.resultado !== 0 && (
                  <div className={cn("p-2 rounded-2xl", datos.resultado > 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500")}>
                    {datos.resultado > 0 ? <TrendingUp /> : <TrendingDown />}
                  </div>
                )}
              </div>

              {/* DATA ROWS */}
              <div className="space-y-4 mb-8">
                <div className="flex justify-between text-sm font-bold">
                  <span className="opacity-50">Ventas</span>
                  <span>{Num.fmt(datos.ventas)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-rose-400">
                  <span className="opacity-50">Costes Totales</span>
                  <span>-{Num.fmt(datos.compras + datos.fijos + datos.amortizaciones)}</span>
                </div>
                
                <div className={cn("h-px w-full my-4", isClosed ? "bg-slate-800" : "bg-slate-100")} />

                <div className="flex justify-between items-end">
                  <span className="text-[10px] font-black uppercase opacity-40">Resultado Neto</span>
                  <div className="text-right">
                    <p className={cn("text-2xl font-black tracking-tighter", 
                      datos.resultado >= 0 ? "text-emerald-400" : "text-rose-400"
                    )}>
                      {Num.fmt(datos.resultado)}
                    </p>
                    <p className="text-[10px] font-bold opacity-40">MARGEN: {datos.ventas > 0 ? ((datos.resultado / datos.ventas) * 100).toFixed(1) : 0}%</p>
                  </div>
                </div>
              </div>

              {/* ACTIONS */}
              {canClose && (
                <button 
                  onClick={() => handleCerrarMes(i, datos)}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-200"
                >
                  Congelar Resultados
                </button>
              )}

              {isClosed && (
                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Auditado
                  </div>
                  <button onClick={() => handleAbrirMes(cierre.id)} className="text-[10px] font-black text-rose-500 hover:underline">
                    REABRIR PERIODO
                  </button>
                </div>
              )}

              {isFuture && (
                <div className="flex items-center justify-center gap-2 py-4 text-slate-300">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">No Disponible</span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
