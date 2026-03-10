import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, ChevronRight } from 'lucide-react';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { Cierre } from '../types';

// 🚀 IMPORTANTE: Interfaz alineada con lo que manda CashView
interface CashHistoryListProps {
  cierresMes: Cierre[];
  facturas: any[]; // Recibe las facturas para comprobaciones futuras si hiciera falta
  onDelete: (id: string) => void;
}

export const CashHistoryList: React.FC<CashHistoryListProps> = ({ cierresMes, onDelete }) => {
  // Ordenamos por fecha descendente
  const sorted = [...cierresMes].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="bg-white rounded-[2.5rem] p-6 border border-slate-100 shadow-md">
      <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-4">
        Historial de Cierres
      </h3>

      <div className="space-y-3 max-h-[420px] overflow-y-auto custom-scrollbar pr-2">
        <AnimatePresence>
          {sorted.length === 0 && (
            <div className="opacity-40 text-center py-10 text-xs font-bold">
              No hay cierres en este mes.
            </div>
          )}

          {sorted.map(c => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition p-4 rounded-2xl border border-slate-200"
            >
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-400 uppercase">
                  {c.date}
                </span>
                <span className="font-black text-slate-700 text-lg">
                  {Num.fmt(c.totalVenta)}
                </span>

                {c.descuadre !== 0 && (
                  <span
                    className={cn(
                      "text-[9px] font-bold mt-1",
                      c.descuadre > 0 ? "text-emerald-600" : "text-rose-500"
                    )}
                  >
                    {c.descuadre > 0 ? "+" : ""}
                    {c.descuadre.toFixed(2)}€ de descuadre
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {onDelete && (
                  <button
                    onClick={() => onDelete(c.id)}
                    className="text-rose-400 hover:text-rose-600 transition"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}

                <ChevronRight className="w-5 h-5 text-slate-400" />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
