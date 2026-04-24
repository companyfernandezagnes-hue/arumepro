import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, CheckCircle2, AlertCircle, Building2, ShoppingBag, Pencil } from 'lucide-react';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { Cierre } from '../types';

// 🚀 ESCUDO ANTI-CRASH: Aceptamos múltiples nombres de props por si cambia en el padre
interface CashHistoryListProps {
  cierresMes?: Cierre[];
  cierres?: Cierre[];
  facturas?: any[];
  onDelete?: (id: string) => void;
  onEdit?: (cierre: Cierre) => void;
}

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export const CashHistoryList: React.FC<CashHistoryListProps> = ({
  cierresMes,
  cierres,
  onDelete,
  onEdit,
}) => {
  // 🛡️ PROTECCIÓN TOTAL
  const datosSeguros = cierresMes || cierres || [];
  const arrayValido = Array.isArray(datosSeguros) ? datosSeguros : [];

  const sorted = [...arrayValido].sort((a, b) => {
    const dateA = a?.date || '';
    const dateB = b?.date || '';
    return dateB.localeCompare(dateA);
  });

  // Fecha de hoy para resaltar
  const hoyISO = new Date().toLocaleDateString('sv-SE');

  return (
    <div className="bg-white rounded-2xl p-6 border border-[color:var(--arume-gray-100)] shadow-sm">
      <div className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Historial</p>
        <h3 className="font-serif text-xl font-semibold tracking-tight mt-1">Cierres del mes</h3>
        <p className="text-[11px] text-[color:var(--arume-gray-400)] mt-1">
          Pulsa un cierre para editarlo si te equivocaste o faltó algo.
        </p>
      </div>

      <div className="space-y-2 max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
        <AnimatePresence>
          {sorted.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="opacity-50 text-center py-12 text-sm"
            >
              <p className="font-serif text-lg text-[color:var(--arume-gray-400)]">Sin cierres este mes</p>
              <p className="text-[11px] text-[color:var(--arume-gray-400)] mt-1">Cuando cierres caja aparecerá aquí.</p>
            </motion.div>
          )}

          {sorted.map(c => {
            const isOk = Math.abs(c.descuadre || 0) <= 2;
            const isRest = c.unitId === 'REST' || !c.unitId;

            // Parse de fecha seguro + día de la semana
            let diaSemana = '';
            let diaNum = '';
            let esFinde = false;
            let esHoy = false;
            try {
              const d = new Date((c.date || '') + 'T00:00:00');
              if (!isNaN(d.getTime())) {
                diaSemana = DIAS_CORTOS[d.getDay()];
                diaNum = String(d.getDate()).padStart(2, '0');
                esFinde = d.getDay() === 0 || d.getDay() === 6;
                esHoy = c.date === hoyISO;
              }
            } catch {}

            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className={cn(
                  'group relative flex items-center gap-3 p-3 rounded-xl border transition',
                  isOk
                    ? 'bg-white border-[color:var(--arume-gray-100)] hover:border-[color:var(--arume-ink)]/30'
                    : 'bg-[color:var(--arume-danger)]/5 border-[color:var(--arume-danger)]/20 hover:border-[color:var(--arume-danger)]/40',
                  onEdit && 'cursor-pointer hover:shadow-sm'
                )}
                onClick={() => onEdit?.(c)}
              >
                {/* Cuadradito fecha tipo Google Calendar */}
                <div className={cn(
                  'flex flex-col items-center justify-center w-12 h-12 rounded-xl border shrink-0',
                  esHoy
                    ? 'bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] border-[color:var(--arume-gold)]'
                    : esFinde
                    ? 'bg-[color:var(--arume-accent)]/10 text-[color:var(--arume-accent)] border-[color:var(--arume-accent)]/20'
                    : 'bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-700)] border-[color:var(--arume-gray-100)]'
                )}>
                  <span className="text-[9px] font-bold uppercase leading-none">{diaSemana}</span>
                  <span className="font-serif text-xl font-semibold leading-none mt-0.5 tabular-nums">{diaNum}</span>
                </div>

                {/* Info principal */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className={cn('p-0.5 rounded-md', isRest ? 'text-[color:var(--arume-ink)]' : 'text-[color:var(--arume-ok)]')}>
                      {isRest ? <Building2 className="w-3 h-3" /> : <ShoppingBag className="w-3 h-3" />}
                    </div>
                    <span className="text-[11px] font-semibold text-[color:var(--arume-gray-500)] uppercase tracking-[0.1em]">
                      {isRest ? 'Restaurante' : 'Tienda'}
                    </span>
                    {esHoy && (
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--arume-gold)] bg-[color:var(--arume-gold)]/15 px-1.5 py-0.5 rounded-full">
                        Hoy
                      </span>
                    )}
                  </div>
                  <p className="font-serif text-lg font-semibold tabular-nums mt-0.5 text-[color:var(--arume-ink)]">
                    {Num.fmt(c.totalVenta)}
                  </p>
                  {c.descuadre !== 0 && c.descuadre !== undefined && (
                    <p className={cn(
                      'text-[10px] font-semibold mt-0.5 flex items-center gap-1',
                      Math.abs(c.descuadre) <= 2 ? 'text-[color:var(--arume-gray-400)]' :
                      c.descuadre > 0 ? 'text-[color:var(--arume-ok)]' : 'text-[color:var(--arume-danger)]'
                    )}>
                      {Math.abs(c.descuadre) <= 2 ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {c.descuadre > 0 ? '+' : ''}{Num.fmt(c.descuadre)} descuadre
                    </p>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                  {onEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(c); }}
                      className="p-2 rounded-full bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)] hover:bg-[color:var(--arume-gray-100)] border border-[color:var(--arume-gray-100)] transition"
                      title="Editar este cierre"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                      className="p-2 rounded-full bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-400)] hover:text-[color:var(--arume-danger)] hover:bg-[color:var(--arume-danger)]/10 hover:border-[color:var(--arume-danger)]/30 border border-[color:var(--arume-gray-100)] transition"
                      title="Eliminar cierre"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
