import React, { useMemo } from 'react';
import { Truck, CheckCircle2, Clock, Link as LinkIcon, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
// Si BusinessUnit está en types, importa desde allí, si no, usa el que definiste:
import { BusinessUnit } from './AlbaranesView';

interface AlbaranesListProps {
  albaranes: Albaran[];
  searchQ: string;
  selectedUnit: BusinessUnit | 'ALL';
  businessUnits: any[];
  onOpenEdit: (albaran: Albaran) => void;
}

// 🚀 REACT.MEMO: Evita que la lista entera se re-renderice si escribes en un input del padre
export const AlbaranesList = React.memo(({ 
  albaranes, searchQ, selectedUnit, businessUnits, onOpenEdit 
}: AlbaranesListProps) => {
  
  // 🧠 CEREBRO DE FILTRADO OPTIMIZADO
  const filteredAlbaranes = useMemo(() => {
    // 1. Normalizamos la búsqueda una sola vez FUERA del bucle
    const term = searchQ ? searchQ.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : '';
    
    return albaranes.filter(a => {
      // 2. Filtro rápido por Unidad de Negocio
      if (selectedUnit !== 'ALL' && (a.unitId || 'REST') !== selectedUnit) return false;
      
      // 3. Filtro por búsqueda de texto
      if (term) {
        const provNorm = (a.prov || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const numNorm = (a.num || '').toLowerCase();
        if (!provNorm.includes(term) && !numNorm.includes(term)) return false;
      }
      
      return true;
    }).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [albaranes, searchQ, selectedUnit]);

  // ESTADO VACÍO (UI Consistente)
  if (filteredAlbaranes.length === 0) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="py-24 text-center opacity-60 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center"
      >
        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
          <Truck className="w-8 h-8 text-slate-300" />
        </div>
        <p className="text-slate-500 font-black text-sm uppercase tracking-widest">Sin Registros</p>
        <p className="text-slate-400 text-xs mt-1">No hay albaranes que coincidan con tu búsqueda.</p>
      </motion.div>
    );
  }

  // RENDER DE LISTA CON ANIMACIONES
  return (
    <div className="space-y-3 pb-20">
      <AnimatePresence mode="popLayout">
        {filteredAlbaranes.map(a => {
          const unitConfig = businessUnits.find(u => u.id === (a.unitId || 'REST'));
          
          return (
            <motion.div 
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              key={a.id} 
              onClick={() => onOpenEdit(a)} 
              className={cn(
                "bg-white p-4 md:p-5 rounded-[2rem] border shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 group",
                a.reconciled ? "border-emerald-200 bg-emerald-50/10" : "border-slate-100 hover:border-indigo-100"
              )}
            >
              <div className="flex-1 min-w-0">
                {/* 🏷️ CHIPS DE ESTADO */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full uppercase tracking-tighter border border-slate-200">
                    {a.date}
                  </span>
                  
                  {unitConfig && (
                    <span className={cn(
                      "text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-sm",
                      unitConfig.color, unitConfig.bg
                    )}>
                      <unitConfig.icon className="w-3 h-3" />
                      {unitConfig.name.split(' ')[0]}
                    </span>
                  )}

                  {a.reconciled && (
                    <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm">
                      <LinkIcon className="w-3 h-3" /> CONCILIADO
                    </span>
                  )}
                  
                  {a.notes && (
                    <span className="text-[9px] font-black text-indigo-500 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full flex items-center gap-1">
                      📝 NOTA
                    </span>
                  )}
                </div>

                {/* 🏢 PROVEEDOR Y REF */}
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-50 rounded-xl hidden md:block border border-slate-100">
                    <Package className="w-5 h-5 text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-black text-slate-800 text-lg md:text-xl leading-none truncate">
                      {a.prov || 'Desconocido'}
                    </h4>
                    <p className="text-[10px] text-slate-400 font-bold font-mono mt-1 uppercase tracking-widest">
                      REF: {a.num || 'S/N'}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* 💰 TOTALES Y PAGO */}
              <div className="text-left md:text-right shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 flex md:flex-col justify-between items-center md:items-end">
                <p className="font-black text-slate-900 text-2xl tracking-tighter leading-none">
                  {Num.fmt(a.total)}
                </p>
                <div className={cn(
                  "mt-2 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase flex items-center gap-1.5 shadow-sm",
                  a.paid ? 'bg-emerald-500 text-white shadow-emerald-500/20' : 'bg-slate-100 text-slate-500'
                )}>
                  {a.paid ? <><CheckCircle2 className="w-3 h-3"/> PAGADO</> : <><Clock className="w-3 h-3"/> PENDIENTE</>}
                </div>
              </div>

            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
});
