import React, { useMemo, useState, useEffect } from 'react';
import { Truck, CheckCircle2, Clock, Link as LinkIcon, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { BusinessUnit } from './AlbaranesView';

interface AlbaranesListProps {
  albaranes: Albaran[];
  searchQ: string;
  selectedUnit: BusinessUnit | 'ALL';
  businessUnits: any[];
  onOpenEdit: (albaran: Albaran) => void;
}

/* ----------------------- HELPERS PRO ------------------------------- */
const norm = (s?: string) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const highlight = (text: string, q: string) => {
  if (!q) return text;
  const n = norm(text);
  const nq = norm(q);
  const i = n.indexOf(nq);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-amber-200 px-0.5 rounded text-slate-800">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
};

const isToday = (d: Date) => d.toDateString() === new Date().toDateString();
const isYesterday = (d: Date) => {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return d.toDateString() === y.toDateString();
};

const groupByDateKey = (list: Albaran[]) => {
  const m = new Map<string, Albaran[]>();
  for (const a of list) {
    const d = new Date(a.date || '');
    const key = isToday(d) ? "HOY" : isYesterday(d) ? "AYER" : (a.date || '').slice(0, 10);
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(a);
  }
  return m;
};

// 🚀 REACT.MEMO: Evita re-renders innecesarios
export const AlbaranesList = React.memo(({ 
  albaranes, searchQ, selectedUnit, businessUnits, onOpenEdit 
}: AlbaranesListProps) => {
  
  /* ----------------------- FILTRO + ORDEN ----------------------- */
  const filtered = useMemo(() => {
    const q = norm(searchQ);
    const out = albaranes.filter(a => {
      if (selectedUnit !== 'ALL' && (a.unitId || 'REST') !== selectedUnit) return false;
      if (!q) return true;
      return norm(a.prov).includes(q) || norm(a.num).includes(q) || norm(a.notes).includes(q);
    });
    return out.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [albaranes, searchQ, selectedUnit]);

  /* ----------------------- AGRUPACIÓN DATOS --------------------- */
  const groups = useMemo(() => groupByDateKey(filtered), [filtered]);

  /* ----------------------- PAGINACIÓN SUAVE ----------------------- */
  const pageSize = 100;
  const [page, setPage] = useState(1);

  useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
        setPage(p => Math.min(p + 1, Math.ceil(filtered.length / pageSize)));
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [filtered.length]);

  // Aplanamos las keys agrupadas pero solo mostramos hasta el límite de página actual
  const visibleGroups = useMemo(() => {
    const result = new Map<string, Albaran[]>();
    let count = 0;
    for (const [key, list] of groups.entries()) {
      if (count >= page * pageSize) break;
      const toTake = Math.min(list.length, (page * pageSize) - count);
      result.set(key, list.slice(0, toTake));
      count += toTake;
    }
    return result;
  }, [groups, page]);

  /* ----------------------- EMPTY STATE --------------------------- */
  if (filtered.length === 0) {
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

  /* ----------------------- RENDER LISTA ------------------------- */
  return (
    <div className="space-y-6 pb-20">
      <AnimatePresence mode="popLayout">
        {[...visibleGroups.entries()].map(([key, list]) => (
          <motion.section 
            key={key} 
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="space-y-3"
          >
            {/* Header de grupo (HOY, AYER, FECHA) */}
            <div className="px-2 text-[10px] font-black text-indigo-500 uppercase tracking-widest border-b border-slate-100 pb-1">
              {key}
            </div>

            {list.map(a => {
              const unitConfig = businessUnits.find(u => u.id === (a.unitId || 'REST'));

              return (
                <motion.div 
                  layout 
                  initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  key={a.id} 
                  role="button" tabIndex={0}
                  onClick={() => onOpenEdit(a)} 
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpenEdit(a); }}
                  aria-label={`Albarán ${a.num} de ${a.prov}, Total ${a.total} euros`}
                  className={cn(
                    "bg-white p-4 md:p-5 rounded-[2rem] border shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 group focus:ring-2 ring-indigo-500/50 outline-none",
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
                        <span className={cn("text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-sm", unitConfig.color, unitConfig.bg)}>
                          <unitConfig.icon className="w-3 h-3" /> {unitConfig.name.split(' ')[0]}
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
                        <h4 className="font-black text-slate-800 text-lg md:text-xl leading-none truncate group-hover:text-indigo-600 transition">
                          {highlight(a.prov || 'Desconocido', searchQ)}
                        </h4>
                        <p className="text-[10px] text-slate-400 font-bold font-mono mt-1 uppercase tracking-widest">
                          REF: {highlight(a.num || 'S/N', searchQ)}
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

          </motion.section>
        ))}
      </AnimatePresence>
    </div>
  );
});
