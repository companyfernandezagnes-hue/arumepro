import React, { useMemo, useState, useEffect } from 'react';
import { 
  Truck, CheckCircle2, Clock, Link as LinkIcon, Package, 
  ChevronDown, ChevronUp, Edit2, Loader2, Lock,
  ArrowUp, ArrowDown, Sparkles // 🛡️ FIX: ¡Añadio Sparkles para evitar el pantallazo rojo!
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
// 🛡️ CORRECCIÓN CRÍTICA: Todo viene de '../types', CERO dependencias de InvoicesView.
import { Albaran, BusinessUnit } from '../types'; 
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

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
      <mark className="bg-indigo-200/50 text-indigo-900 font-black px-0.5 rounded">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
};

const isToday = (d: Date) => d.toDateString() === new Date().toDateString();
const isYesterday = (d: Date) => {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return d.toDateString() === y.toDateString();
};

// 🛡️ EXTRACTOR DE TOTAL SEGURO (Blindaje absoluto contra el bug del 0,00€)
const getSafeTotal = (a: any) => {
  if (!a) return 0;
  // 1. Si el total ya viene bien en la raíz (texto o número)
  const rootTotal = Num.parse(a.total || 0);
  if (rootTotal > 0) return rootTotal;
  
  // 2. Si la raíz falló, sumamos las líneas a la fuerza
  const lines = Array.isArray(a.items) ? a.items : (Array.isArray(a.lineas) ? a.lineas : []);
  const sum = lines.reduce((acc: number, l: any) => {
    // Busca t, total, o multiplica q * unitPrice
    const lineTotal = Num.parse(l.t ?? l.total ?? 0);
    const calculated = Num.parse(l.q || 1) * Num.parse(l.unitPrice || l.unit_price || 0);
    return acc + (lineTotal > 0 ? lineTotal : calculated);
  }, 0);
  
  return Num.round2(sum);
};

// 🚀 REACT.MEMO: Evita re-renders innecesarios
export const AlbaranesList = React.memo(({ 
  albaranes, searchQ, selectedUnit, businessUnits, onOpenEdit 
}: AlbaranesListProps) => {
  
  const safeAlbaranes = Array.isArray(albaranes) ? albaranes : [];

  /* ----------------------- ESTADO DE ORDENACIÓN (ZOHO / HOLDED STYLE) ----------------------- */
  const [sortConfig, setSortConfig] = useState<{ key: 'date' | 'prov' | 'total', asc: boolean }>({ key: 'date', asc: false });

  const handleSort = (key: 'date' | 'prov' | 'total') => {
    setSortConfig(current => ({
      key,
      asc: current.key === key ? !current.asc : (key === 'prov' ? true : false) // Proveedor por defecto A-Z, los demás de mayor a menor
    }));
  };

  /* ----------------------- FILTRO + ORDENACIÓN BLINDADA ----------------------- */
  const filteredAndSorted = useMemo(() => {
    const q = norm(searchQ);
    // 1. Filtrar
    const filtered = safeAlbaranes.filter(a => {
      if (selectedUnit !== 'ALL' && (a.unitId || 'REST') !== selectedUnit) return false;
      if (!q) return true;
      return norm(a.prov).includes(q) || norm(a.num).includes(q) || norm(a.notes).includes(q)
        || (a.items || []).some(it => norm(it.n || '').includes(q));
    });

    // 2. Ordenar según la columna seleccionada
    return filtered.sort((a, b) => {
      let valA: any, valB: any;

      if (sortConfig.key === 'date') {
        valA = a.date || ''; valB = b.date || '';
      } else if (sortConfig.key === 'prov') {
        valA = (a.prov || '').toLowerCase(); valB = (b.prov || '').toLowerCase();
      } else if (sortConfig.key === 'total') {
        valA = getSafeTotal(a); // 🛡️ Uso del extractor seguro para ordenar correctamente
        valB = getSafeTotal(b);
      }

      if (valA < valB) return sortConfig.asc ? -1 : 1;
      if (valA > valB) return sortConfig.asc ? 1 : -1;
      return 0;
    });
  }, [safeAlbaranes, searchQ, selectedUnit, sortConfig]);

  /* ----------------------- AGRUPACIÓN DINÁMICA (INNOVACIÓN ODOO/QUICKBOOKS) --------------------- */
  const groups = useMemo(() => {
    const m = new Map<string, Albaran[]>();
    
    for (const a of filteredAndSorted) {
      let key = "Listado de Albaranes";

      if (sortConfig.key === 'date') {
        if (!a.date) { key = "Sin Fecha"; }
        else {
          const d = new Date(a.date);
          if (isToday(d)) key = "HOY";
          else if (isYesterday(d)) key = "AYER";
          else {
              const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
              key = `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
          }
        }
      } else if (sortConfig.key === 'prov') {
        key = a.prov ? a.prov.toUpperCase() : "SIN PROVEEDOR";
      } else if (sortConfig.key === 'total') {
        key = sortConfig.asc ? "De Menor a Mayor Importe" : "De Mayor a Menor Importe"; // Agrupación plana para totales
      }

      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return m;
  }, [filteredAndSorted, sortConfig]);

  /* ----------------------- ESTADO PARA EXPANDIR LÍNEAS ----------------------- */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpandedId(expandedId === id ? null : id);
  };

  /* ----------------------- PAGINACIÓN SUAVE ----------------------- */
  const pageSize = 50; 
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
        const maxPages = Math.ceil(filteredAndSorted.length / pageSize);
        if (page < maxPages) {
            setIsLoadingMore(true);
            setTimeout(() => {
                setPage(p => Math.min(p + 1, maxPages));
                setIsLoadingMore(false);
            }, 300);
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [filteredAndSorted.length, page]);

  useEffect(() => { setPage(1); }, [searchQ, selectedUnit, sortConfig]);

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

  /* ----------------------- COMPONENTE CABECERA ORDENABLE ----------------------- */
  const SortableHeader = ({ title, sortKey, align = 'left' }: { title: string, sortKey: 'date'|'prov'|'total', align?: 'left'|'center'|'right' }) => {
    const isActive = sortConfig.key === sortKey;
    return (
      <th className={cn("p-3 cursor-pointer group transition-colors hover:bg-slate-100/80", align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left')} onClick={() => handleSort(sortKey)}>
        <div className={cn("flex items-center gap-1.5 inline-flex", align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start')}>
          <span className={cn("transition-colors", isActive ? "text-indigo-600 font-black" : "text-slate-500 font-bold")}>{title}</span>
          <span className={cn("p-0.5 rounded transition-all", isActive ? "bg-indigo-100 text-indigo-600" : "text-slate-300 opacity-0 group-hover:opacity-100 group-hover:bg-slate-200")}>
            {isActive ? (sortConfig.asc ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <span>↕</span>}
          </span>
        </div>
      </th>
    );
  };

  /* ----------------------- CÁLCULO DE TOTALES GLOBALES (SEGURO) ----------------------- */
  const totales = useMemo(() => {
    return filteredAndSorted.reduce((acc, a) => {
      const t = getSafeTotal(a);
      const b = Math.abs(Num.parse(a.base || 0)) || Num.round2(t / 1.10);
      const i = Math.abs(Num.parse(a.taxes || a.iva || 0)) || Num.round2(t - b);
      return { base: acc.base + b, iva: acc.iva + i, total: acc.total + t };
    }, { base: 0, iva: 0, total: 0 });
  }, [filteredAndSorted]);

  /* ----------------------- EMPTY STATE --------------------------- */
  if (filteredAndSorted.length === 0) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="py-24 text-center bg-white rounded-[2.5rem] border border-slate-200 flex flex-col items-center justify-center shadow-sm"
      >
        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100 shadow-inner">
          <Truck className="w-8 h-8 text-slate-300" />
        </div>
        <p className="text-slate-800 font-black text-base uppercase tracking-widest">Carpeta Vacía</p>
        <p className="text-slate-400 text-xs mt-2 font-medium">No hay albaranes que coincidan con estos filtros.</p>
      </motion.div>
    );
  }

  /* ----------------------- RENDER LISTA PREMIUM ------------------------- */
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col max-h-[80vh] mb-20 relative overflow-hidden">
      <div className="overflow-x-auto custom-scrollbar flex-1 pb-10">
        <table className="w-full text-left border-collapse whitespace-nowrap min-w-[900px]">
          
          {/* CABECERA FIJA ESTILO PREMIUM */}
          <thead className="sticky top-0 bg-white/95 backdrop-blur-sm z-30 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <tr className="text-[10px] uppercase tracking-widest select-none border-b border-slate-200">
              <th className="p-3 w-8 text-center text-slate-400">#</th>
              <SortableHeader title="Fecha" sortKey="date" />
              <th className="p-3 text-slate-500 font-bold">Ref / Ticket</th>
              <SortableHeader title="Proveedor" sortKey="prov" />
              <th className="p-3 text-center text-slate-500 font-bold">Negocio</th>
              <th className="p-3 text-right text-slate-500 font-bold">Base</th>
              <th className="p-3 text-right text-slate-500 font-bold">IVA</th>
              <SortableHeader title="Total" sortKey="total" align="right" />
              <th className="p-3 text-center text-slate-500 font-bold w-28">Estado Banco</th>
              <th className="p-3 text-center text-slate-500 font-bold w-12"></th>
            </tr>
          </thead>
          
          <tbody className="text-[11px] font-medium text-slate-700 relative">
            <AnimatePresence mode="popLayout">
              {[...visibleGroups.entries()].map(([key, list]) => (
                <React.Fragment key={key}>
                  
                  {/* FILA DE AGRUPACIÓN INTELIGENTE */}
                  <tr>
                    <td colSpan={10} className="bg-slate-50/80 border-y border-slate-200 sticky top-10 z-20 backdrop-blur-sm shadow-sm"><div className="px-5 py-2.5 text-[10px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> {key} <span className="text-slate-400 font-medium normal-case ml-2">({list.length} docs)</span>
                  </div></td>
                  </tr>

                  {list.map(a => {
                    const unitConfig = businessUnits.find(u => u.id === (a.unitId || 'REST'));
                    const isExpanded = expandedId === a.id;
                    const hasItems = a.items && a.items.length > 0;
                    
                    // 🛡️ CÁLCULO SEGURO PARA LA VISTA DEL ALBARÁN
                    const aTotal = getSafeTotal(a);
                    const aBase = Math.abs(Num.parse(a.base || 0)) || Num.round2(aTotal / 1.10);
                    const aTax = Math.abs(Num.parse(a.taxes || a.iva || 0)) || Num.round2(aTotal - aBase);
                    
                    const isIA = a.notes?.includes('IA') || a.source?.includes('ia');

                    return (
                      <React.Fragment key={a.id}>
                        {/* FILA PRINCIPAL DEL ALBARÁN */}
                        <motion.tr 
                          layout 
                          onClick={() => onOpenEdit(a)} 
                          className={cn("cursor-pointer transition-all duration-200 group z-10 relative border-b border-slate-50 last:border-none", isExpanded ? "bg-indigo-50/40 shadow-inner" : "hover:bg-slate-50")}
                        >
                          <td className="p-3 text-center" onClick={(e) => hasItems ? toggleExpand(e, a.id) : null}>
                            {hasItems ? (
                              <button className={cn("p-1 rounded-md transition-all duration-300", isExpanded ? "bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] shadow-md rotate-180" : "text-slate-400 hover:bg-slate-200 hover:text-slate-700")}>
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="w-3.5 h-3.5 inline-block"></span>
                            )}
                          </td>
                          <td className="p-3 font-semibold text-slate-600">{a.date}</td>
                          <td className="p-3 font-mono text-[10px] text-slate-400 group-hover:text-slate-600 transition-colors">{highlight(a.num || 'S/N', searchQ)}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              {isIA && <span title="Extraído con IA" className="inline-flex shrink-0"><Sparkles className="w-3.5 h-3.5 text-purple-400"/></span>}
                              <span className="font-black text-slate-800 truncate max-w-[200px]">{highlight(a.prov || 'Desconocido', searchQ)}</span>
                              {hasItems && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500 border border-slate-200 group-hover:bg-white group-hover:border-slate-300 transition-colors">{a.items?.length || 0} prod.</span>}
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            {unitConfig && <span className={cn("text-[9px] px-2 py-1 rounded-md font-bold uppercase tracking-wider border", unitConfig.bg, unitConfig.color, `border-${unitConfig.color.split('-')[1]}-200`)}>{unitConfig.name.split(' ')[0]}</span>}
                          </td>
                          <td className="p-3 text-right text-slate-500 tabular-nums">{Num.fmt(aBase)}</td>
                          <td className="p-3 text-right text-slate-500 tabular-nums">{Num.fmt(aTax)}</td>
                          
                          {/* 🛡️ RENDER SEGURO DEL TOTAL */}
                          <td className="p-3 text-right font-black text-slate-900 text-[13px]">{Num.fmt(aTotal)}</td>
                          
                          <td className="p-3 text-center">
                            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}>
                              {a.reconciled ? (
                                <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-emerald-700 bg-emerald-100/50 px-2.5 py-1 rounded-md border border-emerald-200/50 shadow-sm"><LinkIcon className="w-3 h-3" /> CONCILIADO</span>
                              ) : a.paid ? (
                                <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-blue-700 bg-blue-100/50 px-2.5 py-1 rounded-md border border-blue-200/50 shadow-sm"><CheckCircle2 className="w-3 h-3" /> PAGADO</span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 shadow-sm"><Clock className="w-3 h-3" /> PENDIENTE</span>
                              )}
                            </motion.div>
                          </td>
                          
                          <td className="p-3 text-center pr-5">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                              {a.reconciled ? (
                                 <button type="button" disabled className="p-2 rounded-lg bg-slate-50 text-slate-300 cursor-not-allowed border border-slate-100" title="Bloqueado por Banco"><Lock className="w-4 h-4"/></button>
                              ) : (
                                 <button type="button" onClick={(e) => { e.stopPropagation(); onOpenEdit(a); }} className="p-2 rounded-lg bg-white text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 shadow-sm transition-all hover:shadow" title="Editar Documento">
                                   <Edit2 className="w-4 h-4" />
                                 </button>
                              )}
                            </div>
                          </td>
                        </motion.tr>

                        {/* DESGLOSE DE PRODUCTOS AL EXPANDIR (ZOHO BOOKS STYLE) */}
                        {isExpanded && hasItems && (
                          <motion.tr 
                            initial={{ opacity: 0, height: 0 }} 
                            animate={{ opacity: 1, height: 'auto' }} 
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-indigo-50/20 relative overflow-hidden border-b border-indigo-100/50"
                          >
                            <td colSpan={10} className="p-0">
                              <div className="py-4 px-14 relative">
                                <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-indigo-200/50 rounded-full"></div>
                                <div className="bg-white border border-indigo-100 rounded-xl shadow-[0_4px_20px_-5px_rgba(0,0,0,0.05)] overflow-hidden ml-4">
                                  <table className="w-full text-left text-[10px]">
                                    <thead className="bg-slate-50 text-slate-400 font-black uppercase tracking-widest border-b border-slate-100">
                                      <tr>
                                        <th className="px-4 py-2.5 w-16 text-center">Cant</th>
                                        <th className="px-2 py-2.5 w-12 text-center">Ud</th>
                                        <th className="px-4 py-2.5">Concepto / Producto</th>
                                        <th className="px-4 py-2.5 w-16 text-center">% IVA</th>
                                        <th className="px-4 py-2.5 w-24 text-right">Precio Ud.</th>
                                        <th className="px-4 py-2.5 w-24 text-right">Total Lin.</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                      {a.items?.map((it: any, idx: number) => (
                                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors cursor-default">
                                          <td className="px-4 py-2.5 text-center font-black text-slate-700 bg-slate-50/50">{it.q}</td>
                                          <td className="px-2 py-2.5 text-center text-slate-400 font-bold">{it.u}</td>
                                          <td className="px-4 py-2.5 font-bold text-slate-800">{highlight(it.n || '', searchQ)}</td>
                                          <td className="px-4 py-2.5 text-center text-slate-400 font-bold bg-slate-50/50">{it.rate}%</td>
                                          <td className="px-4 py-2.5 text-right text-slate-500 font-mono">{Num.fmt(it.unitPrice || it.unit_price)}</td>
                                          {/* 🛡️ LECTURA SEGURA DE LÍNEA */}
                                          <td className="px-4 py-2.5 text-right font-black text-indigo-600 bg-indigo-50/20">{Num.fmt(Num.parse(it.t ?? it.total ?? 0))}</td>
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
          
          <tfoot className="sticky bottom-0 bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] z-30 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.1)]">
            <tr className="text-xs font-bold uppercase tracking-widest">
              <td className="p-4" colSpan={5}>TOTALES ({filteredAndSorted.length} docs)</td>
              <td className="p-4 text-right text-slate-300 tabular-nums">{Num.fmt(totales.base)}</td>
              <td className="p-4 text-right text-slate-300 tabular-nums">{Num.fmt(totales.iva)}</td>
              <td className="p-4 text-right text-emerald-400 text-base font-black tabular-nums">{Num.fmt(totales.total)}</td>
              <td className="p-4" colSpan={3}></td>
            </tr>
          </tfoot>

        </table>
      </div>

      {/* BADGE DE CARGA INFINITA */}
      {isLoadingMore && (
         <div className="flex justify-center py-6 absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white/90 to-transparent">
             <span className="bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-xl border border-slate-700">
                <Loader2 className="w-3.5 h-3.5 animate-spin"/> Recuperando registros...
             </span>
         </div>
      )}

    </div>
  );
});
