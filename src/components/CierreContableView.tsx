import React, { useState } from 'react';
import { 
  Lock, 
  Unlock, 
  ChevronLeft, 
  ChevronRight, 
  Calendar,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  History,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { motion } from 'motion/react';
import { AppData, CierreMensual } from '../types';
import { ArumeEngine, Num } from '../services/engine';
import { cn } from '../lib/utils';

interface CierreContableViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const CierreContableView: React.FC<CierreContableViewProps> = ({ data, onSave }) => {
  const [year, setYear] = useState(new Date().getFullYear());
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  const cierresMensuales = data.cierres_mensuales || [];

  const getSnapshot = (mesIndex: number, anio: number) => {
    const profitData = ArumeEngine.getProfit(data, mesIndex, anio);
    return {
      ventas: profitData.ingresos.total,
      compras: profitData.gastos.comida + profitData.gastos.bebida + profitData.gastos.otros,
      fijos: profitData.gastos.personal + profitData.gastos.estructura,
      amortizaciones: profitData.gastos.amortizacion,
      resultado: profitData.neto
    };
  };

  const handleCerrarMes = async (mesIndex: number, anio: number) => {
    if (!confirm(`¿Estás SEGURO de cerrar ${meses[mesIndex]} ${anio}?\n\n⚠️ Esta acción guardará una copia fija de los datos.`)) return;

    const snapshot = getSnapshot(mesIndex, anio);
    const nuevoCierre: CierreMensual = {
      id: Date.now().toString(),
      mes: mesIndex,
      anio: anio,
      fecha_cierre: new Date().toISOString(),
      snapshot: snapshot
    };

    const newData = {
      ...data,
      cierres_mensuales: [...cierresMensuales, nuevoCierre]
    };

    await onSave(newData);
  };

  const handleAbrirMes = async (id: string) => {
    if (!confirm("⚠️ ¿Reabrir este mes? \n\nLos datos volverán a calcularse en vivo.")) return;

    const newData = {
      ...data,
      cierres_mensuales: cierresMensuales.filter(c => c.id !== id)
    };

    await onSave(newData);
  };

  const changeYear = (delta: number) => {
    setYear(prev => prev + delta);
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header */}
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Cierre Contable</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest flex items-center gap-2">
            <History className="w-3 h-3" />
            Congelar Periodos y Auditoría
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button 
              onClick={() => changeYear(-1)} 
              className="w-10 h-10 flex items-center justify-center text-slate-500 font-bold hover:bg-white rounded-lg transition shadow-sm"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-6 py-1 font-black text-slate-700 flex items-center text-lg">
              {year}
            </span>
            <button 
              onClick={() => changeYear(1)} 
              className="w-10 h-10 flex items-center justify-center text-slate-500 font-bold hover:bg-white rounded-lg transition shadow-sm"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {meses.map((nombreMes, i) => {
          const cierre = cierresMensuales.find(c => c.mes === i && c.anio === year);
          const isClosed = !!cierre;
          const datos = isClosed ? cierre.snapshot : getSnapshot(i, year);
          
          const today = new Date();
          const currentMonth = today.getMonth();
          const currentYear = today.getFullYear();
          
          const canClose = !isClosed && (year < currentYear || (year === currentYear && i <= currentMonth));

          return (
            <motion.div 
              layout
              key={`${year}-${i}`}
              className={cn(
                "p-6 rounded-[2.5rem] shadow-sm relative overflow-hidden transition-all duration-300 border group",
                isClosed 
                  ? 'bg-slate-900 text-white border-slate-800' 
                  : (canClose 
                      ? 'bg-white border-slate-100 hover:shadow-xl hover:border-indigo-100' 
                      : 'bg-slate-50 border-transparent opacity-60 grayscale')
              )}
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className={cn("font-black text-xl", isClosed ? 'text-white' : 'text-slate-800')}>
                    {nombreMes}
                  </h3>
                  <p className={cn("text-[9px] font-bold uppercase tracking-widest mt-1", isClosed ? 'text-indigo-400' : 'text-slate-400')}>
                    {isClosed ? 'Periodo Congelado' : 'Periodo Abierto'}
                  </p>
                </div>
                <div className={cn(
                  "px-3 py-1 rounded-full text-[9px] font-black uppercase flex items-center gap-1.5",
                  isClosed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-100 text-slate-500'
                )}>
                  {isClosed ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {isClosed ? 'CERRADO' : 'ABIERTO'}
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center text-xs">
                  <span className={isClosed ? 'text-slate-400' : 'text-slate-500'}>Ventas Totales</span>
                  <span className={cn("font-black", isClosed ? 'text-white' : 'text-slate-900')}>
                    {Num.fmt(datos.ventas)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className={isClosed ? 'text-slate-400' : 'text-slate-500'}>Compras (Var.)</span>
                  <span className={cn("font-black", isClosed ? 'text-rose-300' : 'text-rose-500')}>
                    -{Num.fmt(datos.compras)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className={isClosed ? 'text-slate-400' : 'text-slate-500'}>Estructura (Fijo)</span>
                  <span className={cn("font-black", isClosed ? 'text-orange-300' : 'text-orange-500')}>
                    -{Num.fmt(datos.fijos)}
                  </span>
                </div>
                
                <div className={cn("w-full h-px my-4", isClosed ? 'bg-slate-800' : 'bg-slate-100')}></div>
                
                <div className="flex justify-between items-center">
                  <span className={cn("text-[10px] font-black uppercase tracking-widest", isClosed ? 'text-slate-500' : 'text-slate-400')}>
                    Beneficio Neto
                  </span>
                  <div className="text-right">
                    <p className={cn(
                      "text-xl font-black",
                      datos.resultado >= 0 
                        ? (isClosed ? 'text-emerald-400' : 'text-emerald-600') 
                        : (isClosed ? 'text-rose-400' : 'text-rose-600')
                    )}>
                      {Num.fmt(datos.resultado)}
                    </p>
                    <p className={cn("text-[9px] font-bold", isClosed ? 'text-slate-500' : 'text-slate-400')}>
                      Margen: {datos.ventas > 0 ? ((datos.resultado / datos.ventas) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                </div>
              </div>

              {canClose && (
                <button 
                  onClick={() => handleCerrarMes(i, year)} 
                  className="w-full py-4 bg-indigo-50 text-indigo-600 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm active:scale-95"
                >
                  ❄️ CONGELAR MES {nombreMes.toUpperCase()}
                </button>
              )}
              
              {isClosed && (
                <div className="mt-6 pt-4 border-t border-slate-800 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    <p className="text-[9px] text-slate-500 italic">
                      Auditado {new Date(cierre.fecha_cierre).toLocaleDateString()}
                    </p>
                  </div>
                  <button 
                    onClick={() => handleAbrirMes(cierre.id)} 
                    className="text-[9px] font-black text-rose-400 hover:text-white hover:bg-rose-500 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                  >
                    <Unlock className="w-2.5 h-2.5" />
                    REABRIR
                  </button>
                </div>
              )}

              {!isClosed && !canClose && (
                <div className="flex items-center gap-2 justify-center py-4 text-slate-400">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Periodo Futuro</span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
