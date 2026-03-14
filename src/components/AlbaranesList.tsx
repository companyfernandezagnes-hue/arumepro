import React, { useMemo, useState, useEffect } from 'react';
import { Truck, CheckCircle2, Clock, Link as LinkIcon, Package, ChevronDown, ChevronUp, Edit2, Loader2, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

// 🛡️ CORRECCIÓN: El BusinessUnit viene de InvoicesView o de tu types global.
import { BusinessUnit } from './InvoicesView'; 

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
    if (!a.date) continue;
    const d = new Date(a.date);
    
    // INNOVACIÓN 1: Agrupación más inteligente
    let key = "";
    if (isToday(d)) key = "HOY";
    else if (isYesterday(d)) key = "AYER";
    else {
        const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
        key = `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    }

    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(a);
  }
  return m;
};

// 🚀 REACT.MEMO: Evita re-renders innecesarios
export const AlbaranesList = React.memo(({ 
  albaranes, searchQ, selectedUnit, businessUnits, onOpenEdit 
}: AlbaranesListProps) => {
  
  // 🛡️ PARACAÍDAS DE DATOS: Aseguramos que siempre sea un array
  const safeAlbaranes = Array.isArray(albaranes) ? albaranes : [];

  /* ----------------------- FILTRO + ORDEN ----------------------- */
  const filtered = useMemo(() => {
    const q = norm(searchQ);
    const out = safeAlbaranes.filter(a => {
      if (selectedUnit !== 'ALL' && (a.unitId || 'REST') !== selectedUnit) return false;
      if (!q) return true;
      return norm(a.prov).includes(q) || norm(a.num).includes(q) || norm(a.notes).includes(q);
    });
    return out.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [safeAlbaranes, searchQ, selectedUnit]);

  /* ----------------------- AGRUPACIÓN DATOS --------------------- */
  const groups = useMemo(() => groupByDateKey(filtered), [filtered]);

  /* ----------------------- ESTADO PARA EXPANDIR LÍNEAS ----------------------- */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpandedId(expandedId === id ? null : id);
  };

  /* ----------------------- PAGINACIÓN SUAVE ----------------------- */
  const pageSize = 50; // Reducido a 50 para evitar lags en móviles
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
        const maxPages = Math.ceil(filtered.length / pageSize);
        if (page < maxPages) {
            setIsLoadingMore(true);
            setTimeout(() => {
                setPage(p => Math.min(p + 1, maxPages));
                setIsLoadingMore(false);
            }, 300); // Pequeño delay visual
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [filtered.length, page]);

  // Resetear paginación si cambia el filtro
  useEffect(() => { setPage(1); }, [searchQ, selectedUnit]);

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

  /* ----------------------- RENDER LISTA ESTILO EXCEL ------------------------- */
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col max-h-[80vh] mb-20 relative">
      <div className="overflow-x-auto custom-scrollbar flex-1 pb-10">
        <table className="w-full text-left border-collapse whitespace-nowrap min-w-[900px]">
          
          {/* CABECERA FIJA */}
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-30 shadow-sm">
            <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-widest select-none">
              <th className="p-3 w-8 text-center"></th>
              <th className="p-3">Fecha</th>
              <th className="p-3">Ref</th>
              <th className="p-3">Proveedor</th>
              <th className="p-3 text-center">Unidad</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3 text-center">Estado</th>
              <th className="p-3 text-center">Acciones</th>
            </tr>
          </thead>
          
          <tbody className="divide-y divide-slate-100 text-[11px] font-medium text-slate-700 relative">
            <AnimatePresence mode="popLayout">
              {[...visibleGroups.entries()].map(([key, list]) => (
                <React.Fragment key={key}>
                  
                  {/* FILA DE AGRUPACIÓN (HOY, AYER, FECHA) */}
                  <tr>
                    <td colSpan={8} className="bg-slate-50/80 px-4 py-2 text-[10px] font-black text-indigo-500 uppercase tracking-widest border-y border-slate-200 sticky top-10 z-20 backdrop-blur-sm shadow-sm">
                      {key}
                    </td>
                  </tr>

                  {list.map(a => {
                    const unitConfig = businessUnits.find(u => u.id === (a.unitId || 'REST'));
                    const isExpanded = expandedId === a.id;
                    const hasItems = a.items && a.items.length > 0;

                    return (
                      <React.Fragment key={a.id}>
                        {/* FILA PRINCIPAL DEL ALBARÁN */}
                        <motion.tr 
                          layout 
                          onClick={() => onOpenEdit(a)} 
                          className={cn("hover:bg-indigo-50/40 cursor-pointer transition-colors group z-10 relative", isExpanded ? "bg-indigo-50/30" : "")}
                        >
                          <td className="p-3 text-center" onClick={(e) => hasItems ? toggleExpand(e, a.id) : null}>
                            {hasItems ? (
                              <button className={cn("p-1 rounded-md transition-colors", isExpanded ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600")}>
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            ) : (
                              <span className="w-3.5 h-3.5 inline-block"></span>
                            )}
                          </td>
                          <td className="p-3 font-semibold text-slate-800">{a.date}</td>
                          <td className="p-3 font-mono text-[10px] text-slate-500">{highlight(a.num || 'S/N', searchQ)}</td>
                          <td className="p-3 font-bold text-slate-900 truncate max-w-[200px]" title={a.prov}>
                            <div className="flex items-center gap-1.5">
                              <span className="truncate">{highlight(a.prov || 'Desconocido', searchQ)}</span>
                              {hasItems && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[8px] font-bold border border-slate-200">{a.items?.length || 0} lin</span>}
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            {unitConfig && <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold uppercase", unitConfig.bg, unitConfig.color)}>{unitConfig.name.split(' ')[0]}</span>}
                          </td>
                          <td className="p-3 text-right font-black text-slate-900 text-sm">{Num.fmt(a.total)}</td>
                          
                          <td className="p-3 text-center">
                            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}>
                              {a.reconciled ? (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200"><LinkIcon className="w-3 h-3" /> CONCILIADO</span>
                              ) : a.paid ? (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200"><CheckCircle2 className="w-3 h-3" /> PAGADO</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200"><Clock className="w-3 h-3" /> PENDIENTE</span>
                              )}
                            </motion.div>
                          </td>
                          
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {/* INNOVACIÓN 5: Botón Editar Inteligente */}
                              {a.reconciled ? (
                                 <button type="button" disabled className="p-1.5 rounded text-slate-300 cursor-not-allowed" title="Bloqueado por Banco"><Lock className="w-4 h-4"/></button>
                              ) : (
                                 <button type="button" onClick={(e) => { e.stopPropagation(); onOpenEdit(a); }} className="p-1.5 rounded text-indigo-500 hover:bg-indigo-100 transition" title="Editar">
                                   <Edit2 className="w-4 h-4" />
                                 </button>
                              )}
                            </div>
                          </td>
                        </motion.tr>

                        {/* DESGLOSE DE PRODUCTOS AL EXPANDIR (ESTILO EXCEL) */}
                        {isExpanded && hasItems && (
                          <motion.tr 
                            initial={{ opacity: 0, height: 0 }} 
                            animate={{ opacity: 1, height: 'auto' }} 
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-slate-50/50 relative overflow-hidden"
                          >
                            <td colSpan={8} className="p-0 border-b border-slate-200">
                              <div className="py-4 px-12 relative">
                                <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-indigo-100"></div>
                                <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden ml-6">
                                  <table className="w-full text-left text-[10px]">
                                    <thead className="bg-slate-100 text-slate-500 font-bold uppercase">
                                      <tr>
                                        <th className="px-3 py-2 w-16 text-center">Cant</th>
                                        <th className="px-3 py-2 w-12 text-center">Ud</th>
                                        <th className="px-3 py-2">Producto</th>
                                        <th className="px-3 py-2 w-16 text-center">% IVA</th>
                                        <th className="px-3 py-2 w-24 text-right">Precio Ud.</th>
                                        <th className="px-3 py-2 w-24 text-right">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {a.items?.map((it: any, idx: number) => (
                                        <tr key={idx} className="hover:bg-slate-50 transition-colors cursor-default">
                                          <td className="px-3 py-2 text-center font-bold text-slate-700">{it.q}</td>
                                          <td className="px-3 py-2 text-center text-slate-500">{it.u}</td>
                                          <td className="px-3 py-2 font-medium text-slate-800">{highlight(it.n || '', searchQ)}</td>
                                          <td className="px-3 py-2 text-center text-slate-500">{it.rate}%</td>
                                          <td className="px-3 py-2 text-right text-slate-500">{Num.fmt(it.unitPrice)}</td>
                                          <td className="px-3 py-2 text-right font-bold text-indigo-600">{Num.fmt(it.t)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}

                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              ))}
            </AnimatePresence>
          </tbody>
        </table>

        {/* INNOVACIÓN 2: Badge de Carga */}
        {isLoadingMore && (
           <div className="flex justify-center py-4 absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white to-transparent">
               <span className="bg-slate-800 text-white px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg">
                  <Loader2 className="w-3 h-3 animate-spin"/> Cargando más...
               </span>
           </div>
        )}

      </div>
    </div>
  );
});
