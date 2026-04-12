import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, ChevronRight, CheckCircle2, AlertCircle, Building2, ShoppingBag } from 'lucide-react';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { Cierre } from '../types';

// 🚀 ESCUDO ANTI-CRASH: Aceptamos múltiples nombres de props por si cambia en el padre
interface CashHistoryListProps {
  cierresMes?: Cierre[];
  cierres?: Cierre[]; 
  facturas?: any[]; 
  onDelete?: (id: string) => void;
}

export const CashHistoryList: React.FC<CashHistoryListProps> = ({ 
  cierresMes, 
  cierres, 
  onDelete 
}) => {
  // 🛡️ PROTECCIÓN TOTAL: Cogemos los datos vengan como vengan. Si no hay, usamos un array vacío [].
  const datosSeguros = cierresMes || cierres || [];
  const arrayValido = Array.isArray(datosSeguros) ? datosSeguros : [];

  // Ordenamos por fecha de forma segura
  const sorted = [...arrayValido].sort((a, b) => {
    const dateA = a?.date || '';
    const dateB = b?.date || '';
    return dateB.localeCompare(dateA);
  });

  return (
    <div className="bg-white rounded-[2.5rem] p-6 border border-slate-100 shadow-md">
      <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-4">
        Historial de Cierres
      </h3>

      <div className="space-y-3 max-h-[420px] overflow-y-auto custom-scrollbar pr-2">
        <AnimatePresence>
          {sorted.length === 0 && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              className="opacity-40 text-center py-10 text-xs font-bold"
            >
              No hay cierres en este mes.
            </motion.div>
          )}

          {sorted.map(c => {
            // Verificamos si la caja está cuadrada (margen de 2 euros como máximo)
            const isOk = Math.abs(c.descuadre || 0) <= 2;
            // Identificamos la unidad de negocio para el icono
            const isRest = c.unitId === 'REST' || !c.unitId; // Asumimos REST por defecto si es antiguo

            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className={cn(
                  "flex items-center justify-between transition p-4 rounded-2xl border group",
                  isOk ? "bg-slate-50 hover:bg-slate-100 border-slate-200" : "bg-rose-50/30 hover:bg-rose-50 border-rose-100"
                )}
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 mb-1">
                    {/* Icono de la Unidad de Negocio */}
                    <div className={cn("p-1 rounded-md", isRest ? "bg-indigo-100 text-indigo-600" : "bg-emerald-100 text-emerald-600")}>
                      {isRest ? <Building2 className="w-3 h-3" /> : <ShoppingBag className="w-3 h-3" />}
                    </div>
                    <span className="text-[10px] font-black text-slate-400 uppercase">
                      {c.date}
                    </span>
                  </div>
                  
                  <span className="font-black text-slate-700 text-lg">
                    {Num.fmt(c.totalVenta)}
                  </span>

                  {c.descuadre !== 0 && (
                    <span
                      className={cn(
                        "text-[9px] font-bold mt-1 flex items-center gap-1",
                        c.descuadre > 0 ? "text-emerald-600" : "text-rose-500"
                      )}
                    >
                      {c.descuadre > 0 ? <CheckCircle2 className="w-3 h-3"/> : <AlertCircle className="w-3 h-3"/>}
                      {c.descuadre > 0 ? "+" : ""}
                      {Num.fmt(c.descuadre)} de descuadre
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {onDelete && (
                    <button
                      onClick={() => onDelete(c.id)}
                      className="p-2 bg-white rounded-xl text-rose-400 hover:text-white hover:bg-rose-500 shadow-sm opacity-0 group-hover:opacity-100 transition-all"
                      title="Eliminar cierre"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}

                  <ChevronRight className="w-5 h-5 text-slate-300" />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
