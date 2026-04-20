import React, { useMemo, useState } from 'react';
import { 
  FileText, CheckCircle2, Clock, Trash2, Link as LinkIcon, 
  AlertCircle, Sparkles, Package, ChevronDown, ChevronUp, Edit2, Zap,
  ArrowUp, ArrowDown, ArrowUpDown, Lock // 🛡️ FIX CRÍTICO: Faltaba el icono Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { EmptyState } from './EmptyState';

// 🛡️ APUNTAMOS A LA RAÍZ PARA EVITAR DEPENDENCIAS CIRCULARES
import { Albaran, FacturaExtended, BusinessUnit } from '../types'; 
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

interface InvoicesListProps {
  facturas: FacturaExtended[];
  searchQ: string;
  selectedUnit: BusinessUnit | 'ALL';
  mode: 'proveedor' | 'socio';
  filterStatus: 'all' | 'pending' | 'paid' | 'reconciled';
  year: number;
  businessUnits: any[];
  sociosReales: string[];
  superNorm: (s: string | undefined | null) => string;
  onOpenDetail: (factura: FacturaExtended) => void;
  onTogglePago: (id: string) => void;
  onDelete: (id: string) => void;
  albaranesSeguros?: Albaran[]; 
}

type SortField = 'date' | 'prov' | 'total';
type SortOrder = 'asc' | 'desc';

// 🛡️ HIGHLIGHTER SEGURO
const highlight = (text: string, q: string, superNormFn: (s: string | undefined | null) => string) => {
  if (!q || !text) return text;

  // Escapamos caracteres especiales de regex para evitar crashes con inputs como "C++"
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Buscamos en el texto ORIGINAL con regex case-insensitive.
  // Esto evita el bug de indice desfasado cuando superNormFn cambia la longitud del string.
  const regex = new RegExp(escaped, 'i');
  const match = regex.exec(text);
  if (!match) return text;

  const i = match.index;
  const len = match[0].length;
  
  return (
        <>
          {text.slice(0, i)}
              <mark className="bg-indigo-200/50 text-indigo-900 font-black px-0.5 rounded">{text.slice(i, i + len)}</mark>
          {text.slice(i + len)}
        </>
      );
};
// 🛡️ PARSER DE FECHA SEGURO
const extractYearSafe = (dateStr: string | undefined) => {
  if (!dateStr) return '';
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) return parts[2].length === 2 ? `20${parts[2]}` : parts[2];
  }
  return dateStr.substring(0, 4); 
};

/* =======================================================
 * 🧠 HOOK DE FILTRADO Y ORDENACIÓN PRO (Blindado)
 * ======================================================= */
function useInvoicesFilters(
  facturas: FacturaExtended[], 
  year: number, 
  filterStatus: string, 
  searchQ: string, 
  selectedUnit: string, 
  mode: string, 
  sociosReales: string[], 
  superNorm: (s: string | undefined | null) => string,
  sortField: SortField,
  sortOrder: SortOrder
) {
  return useMemo(() => {
    try {
      if (!Array.isArray(facturas)) return [];

      const searchN = searchQ ? superNorm(searchQ) : '';
      const normalizedSocios = Array.isArray(sociosReales) ? sociosReales.map(s => superNorm(s)) : [];
      const yearStr = year ? year.toString() : '';

      let list = facturas.filter(f => {
        if (!f || typeof f !== 'object') return false;
        if (f.status === 'draft') return false; 

        const fYear = extractYearSafe(f.date);
        if (yearStr && fYear !== yearStr) return false;

        const unitToCompare = f.unidad_negocio || 'REST';
        if (selectedUnit !== 'ALL' && unitToCompare !== selectedUnit) return false;
        
        // 🛑 FILTRO MÁGICO: Ocultamos Cajas (gastos menores), Banco y Ventas (Cajas Z)
        if (f.tipo === 'caja' || (f as any).tipo === 'banco' || f.tipo === 'venta') return false;
        if (f.cliente === 'Z DIARIO' || String(f.num || '').toUpperCase().startsWith('Z') || String(f.num || '').toUpperCase().startsWith('CAJA')) return false;

        const normCliente = superNorm(String(f.cliente || ''));
        const normProv = superNorm(String(f.prov || ''));
        const isSocio = normalizedSocios.some(socio => socio && (normCliente.includes(socio) || normProv.includes(socio)));
        
        if (mode === 'proveedor' && isSocio) return false;
        if (mode === 'socio' && !isSocio) return false;

        if (filterStatus === 'pending' && (f.paid || f.reconciled)) return false;
        if (filterStatus === 'paid' && !f.paid) return false;
        if (filterStatus === 'reconciled' && !f.reconciled) return false;

        if (searchN) {
          const matchProv = normProv.includes(searchN);
          const matchClient = normCliente.includes(searchN);
          const matchNum = superNorm(String(f.num || '')).includes(searchN);
          if (!matchProv && !matchClient && !matchNum) return false;
        }
        
        return true;
      });

      return list.sort((a, b) => {
        let valA, valB;
        if (sortField === 'date') {
          valA = new Date(a.date || 0).getTime();
          valB = new Date(b.date || 0).getTime();
        } else if (sortField === 'prov') {
          valA = superNorm(String(mode === 'socio' ? a.cliente : a.prov));
          valB = superNorm(String(mode === 'socio' ? b.cliente : b.prov));
        } else {
          valA = Math.abs(Num.parse(a.total)); 
          valB = Math.abs(Num.parse(b.total));
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });

    } catch (e) {
      console.error("Error crítico en el filtrado de InvoicesList:", e);
      return []; 
    }
  }, [facturas, year, filterStatus, searchQ, selectedUnit, mode, sociosReales, superNorm, sortField, sortOrder]);
}

/* =======================================================
 * 🎨 COMPONENTE UI: TABLA CONTABLE DENSA Y PREMIUM
 * ======================================================= */
export const InvoicesList = React.memo(({
  facturas, searchQ, selectedUnit, mode, filterStatus, year, businessUnits, sociosReales, superNorm, onOpenDetail, onTogglePago, onDelete, albaranesSeguros = []
}: InvoicesListProps) => {

  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const historyList = useInvoicesFilters(facturas, year, filterStatus, searchQ, selectedUnit, mode, sociosReales, superNorm, sortField, sortOrder);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder(field === 'prov' ? 'asc' : 'desc'); 
    }
  };

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpandedId(expandedId === id ? null : id);
  };

  const totales = useMemo(() => {
    return historyList.reduce((acc, f) => {
      const t = Math.abs(Num.parse(f.total || 0));
      const b = Math.abs(Num.parse(f.base) || Num.round2(t / 1.10));
      const i = Math.abs(Num.parse(f.tax) || Num.round2(t - b));
      return { base: acc.base + b, iva: acc.iva + i, total: acc.total + t };
    }, { base: 0, iva: 0, total: 0 });
  }, [historyList]);

  const SortableHeader = ({ title, sortKey, align = 'left' }: { title: string, sortKey: SortField, align?: 'left'|'center'|'right' }) => {
    const isActive = sortField === sortKey;
    return (
      <th className={cn("p-3 cursor-pointer group transition-colors hover:bg-slate-100/80", align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left')} onClick={() => handleSort(sortKey)}>
        <div className={cn("flex items-center gap-1.5 inline-flex", align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start')}>
          <span className={cn("transition-colors", isActive ? "text-indigo-600 font-black" : "text-slate-500 font-bold")}>{title}</span>
          <span className={cn("p-0.5 rounded transition-all", isActive ? "bg-indigo-100 text-indigo-600" : "text-slate-300 opacity-0 group-hover:opacity-100 group-hover:bg-slate-200")}>
            {isActive ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
          </span>
        </div>
      </th>
    );
  };

  if (historyList.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm">
        <EmptyState
          icon={FileText}
          eyebrow="Bóveda"
          title="Nada que mostrar aquí"
          message={`No hay ${mode === 'socio' ? 'liquidaciones' : 'facturas'} que coincidan con los filtros aplicados. Prueba a quitar filtros o cambiar el año.`}
        />
      </motion.div>
    );
  }

  return (
    <div className="bg-white border border-[color:var(--arume-gray-100)] rounded-2xl shadow-sm flex flex-col max-h-[75vh] overflow-hidden">
      <div className="overflow-x-auto custom-scrollbar flex-1 pb-6">
        <table className="w-full text-left border-collapse whitespace-nowrap min-w-[950px]">

          <thead className="sticky top-0 bg-[color:var(--arume-paper)]/95 backdrop-blur-sm z-20">
            <tr className="text-[10px] font-semibold uppercase tracking-[0.2em] select-none border-b border-[color:var(--arume-gray-100)] text-[color:var(--arume-gray-500)]">
              <th className="p-3 w-10 text-center"></th>
              <SortableHeader title="Fecha" sortKey="date" />
              <th className="p-3">Referencia</th>
              <SortableHeader title="Titular" sortKey="prov" />
              <th className="p-3 text-center">Unidad</th>
              <th className="p-3 text-right">Base</th>
              <th className="p-3 text-right">IVA</th>
              <SortableHeader title="Total" sortKey="total" align="right" />
              <th className="p-3 text-center w-28">Estado</th>
              <th className="p-3 text-center w-24">Acciones</th>
            </tr>
          </thead>
          
          <tbody className="text-[11px] font-medium text-slate-700 relative">
            <AnimatePresence mode="popLayout">
              {historyList.map(f => {
                const unitConfig = Array.isArray(businessUnits) ? businessUnits.find(u => u.id === (f.unidad_negocio || 'REST')) : null;
                const titularStr = String(mode === 'socio' ? (f.cliente || f.prov || '—') : (f.prov || f.cliente || '—'));
                const isIA = f.source === 'gmail-sync' || f.source === 'dropzone' || f.source === 'email-ia' || f.source === 'ia-auto';
                
                // 🛡️ EXTRACCIÓN SEGURA DE TOTALES
                const fTotal = Math.abs(Num.parse(f.total ?? 0));
                const fBase = Math.abs(Num.parse(f.base)) || Num.round2(fTotal / 1.10);
                const fTax = Math.abs(Num.parse(f.tax)) || Num.round2(fTotal - fBase);
                
                const hasAlbaranes = Array.isArray(f.albaranIdsArr) && f.albaranIdsArr.length > 0;
                const isExpanded = expandedId === f.id;

                const albaranesVinculados = hasAlbaranes ? albaranesSeguros.filter(a => a && f.albaranIdsArr?.includes(a.id)) : [];

                return (
                  <React.Fragment key={f.id}>
                    <motion.tr 
                      layout
                      initial={{ opacity: 0, x: -10 }} 
                      animate={{ opacity: 1, x: 0 }} 
                      exit={{ opacity: 0, scale: 0.95 }}
                      onClick={() => onOpenDetail(f)}
                      className={cn("cursor-pointer transition-colors group z-10 relative border-b border-[color:var(--arume-gray-100)]/60 last:border-none",
                        isExpanded ? "bg-[color:var(--arume-gray-50)]" : "hover:bg-[color:var(--arume-gray-50)]/60")}
                    >
                      <td className="p-3 text-center" onClick={(e) => hasAlbaranes ? toggleExpand(e, f.id) : null}>
                        {hasAlbaranes ? (
                          <button className={cn("p-1.5 rounded-full transition",
                            isExpanded ? "bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] rotate-180" : "text-[color:var(--arume-gray-400)] hover:bg-[color:var(--arume-gray-100)] hover:text-[color:var(--arume-ink)]")}>
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                           <span className="w-4 h-4 inline-block"></span>
                        )}
                      </td>
                      <td className="p-3 text-[color:var(--arume-gray-600)] tabular-nums">{String(f.date || '—')}</td>
                      <td className="p-3 font-mono text-[10px] text-[color:var(--arume-gray-400)] group-hover:text-[color:var(--arume-gray-700)] transition-colors">{highlight(String(f.num || 'S/N'), searchQ, superNorm)}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {isIA && <span title="Extraído con IA" className="inline-flex shrink-0"><Sparkles className="w-3.5 h-3.5 text-[color:var(--arume-gold)]"/></span>}
                          <span className="font-semibold text-[color:var(--arume-ink)] truncate max-w-[220px]">{highlight(titularStr, searchQ, superNorm)}</span>
                          {hasAlbaranes && <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-500)] border border-[color:var(--arume-gray-100)]">{f.albaranIdsArr?.length} albs</span>}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {unitConfig ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-[0.1em] bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-600)] border border-[color:var(--arume-gray-100)]">{unitConfig.name.split(' ')[0]}</span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-[0.1em] bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-400)] border border-[color:var(--arume-gray-100)]">VAR</span>
                        )}
                      </td>
                      <td className="p-3 text-right text-[color:var(--arume-gray-500)] tabular-nums">{Num.fmt(fBase)}</td>
                      <td className="p-3 text-right text-[color:var(--arume-gray-500)] tabular-nums">{Num.fmt(fTax)}</td>
                      <td className="p-3 text-right font-serif font-semibold text-[color:var(--arume-ink)] text-[14px] tabular-nums">{Num.fmt(fTotal)}</td>

                      <td className="p-3 text-center">
                        {f.reconciled ? (
                          <span className="inline-flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--arume-info)] bg-[color:var(--arume-info)]/10 px-2 py-1 rounded-full border border-[color:var(--arume-info)]/20" title="Conciliado en banco"><LinkIcon className="w-3 h-3" /> Banco</span>
                        ) : f.paid ? (
                          <span className="inline-flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--arume-ok)] bg-[color:var(--arume-ok)]/10 px-2 py-1 rounded-full border border-[color:var(--arume-ok)]/20" title="Pagada"><CheckCircle2 className="w-3 h-3" /> Pagada</span>
                        ) : (
                          <span className="inline-flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--arume-warn)] bg-[color:var(--arume-warn)]/10 px-2 py-1 rounded-full border border-[color:var(--arume-warn)]/20" title="Pendiente"><Clock className="w-3 h-3" /> Pend.</span>
                        )}
                      </td>

                      <td className="p-3 text-center pr-5">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 transform translate-x-2 group-hover:translate-x-0">
                          {f.reconciled ? (
                             <button type="button" disabled className="p-1.5 rounded-full bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-300)] cursor-not-allowed border border-[color:var(--arume-gray-100)]" title="Bloqueado por banco"><Lock className="w-4 h-4"/></button>
                          ) : (
                            <>
                              <button type="button" onClick={(e) => { e.stopPropagation(); onTogglePago(f.id); }}
                                className={cn("p-1.5 rounded-full transition border",
                                  f.paid
                                    ? "bg-[color:var(--arume-ok)]/10 text-[color:var(--arume-ok)] border-[color:var(--arume-ok)]/20"
                                    : "bg-white text-[color:var(--arume-gray-400)] hover:text-[color:var(--arume-ok)] border-[color:var(--arume-gray-200)] hover:border-[color:var(--arume-ok)]/30")}
                                title={f.paid ? "Desmarcar pago" : "Marcar pagada"}>
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(f.id); }}
                                className="p-1.5 rounded-full bg-white text-[color:var(--arume-gray-400)] hover:bg-[color:var(--arume-danger)]/10 hover:text-[color:var(--arume-danger)] border border-[color:var(--arume-gray-200)] hover:border-[color:var(--arume-danger)]/30 transition"
                                title="Eliminar factura">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </motion.tr>

                    {isExpanded && hasAlbaranes && (
                      <motion.tr 
                        initial={{ opacity: 0, height: 0 }} 
                        animate={{ opacity: 1, height: 'auto' }} 
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-indigo-50/20 relative overflow-hidden border-b border-indigo-100/50"
                      >
                        <td colSpan={10} className="p-0">
                          <div className="py-5 px-14 relative flex items-start gap-4 overflow-x-auto custom-scrollbar">
                            
                            <div className="absolute left-7 top-0 bottom-6 w-0.5 bg-indigo-200/50 rounded-b-full"></div>

                            {albaranesVinculados.map((alb) => (
                              <div key={alb.id} className="relative z-10 flex flex-col items-center bg-white p-3 rounded-xl border border-slate-200 shadow-sm min-w-[150px] hover:border-indigo-400 transition-all cursor-default group/alb">
                                <div className="absolute -left-6 top-1/2 w-6 h-0.5 bg-indigo-200/50"></div>
                                <div className="absolute -left-7 top-1/2 w-2 h-2 rounded-full bg-indigo-300 -translate-y-1/2 border-2 border-slate-50"></div>
                                
                                <div className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center mb-2 group-hover/alb:bg-indigo-50 transition-colors">
                                  <Package className="w-4 h-4 text-slate-400 group-hover/alb:text-indigo-500" />
                                </div>
                                <span className="text-[10px] font-bold text-slate-500 mb-0.5">{String(alb.date || 'S/F')}</span>
                                <span className="font-mono text-xs font-black text-slate-800 truncate w-full text-center" title={String(alb.num || 'S/N')}>{String(alb.num || 'S/N')}</span>
                                <span className="text-sm font-black text-emerald-600 mt-1 tabular-nums">{Num.fmt(Math.abs(Num.parse(alb.total || 0)))}</span>
                              </div>
                            ))}
                            
                            <div className="relative z-10 flex flex-col justify-center h-full ml-4">
                               <div className="bg-indigo-50 border border-indigo-100 px-4 py-3 rounded-2xl text-center shadow-inner">
                                 <p className="text-[9px] font-black uppercase text-indigo-400 tracking-widest mb-1">Suma Total Albaranes</p>
                                 <p className="text-base font-black text-indigo-700 tabular-nums">
                                   {Num.fmt(albaranesVinculados.reduce((acc, a) => acc + Math.abs(Num.parse(a.total || 0)), 0))}
                                 </p>
                               </div>
                            </div>

                          </div>
                        </td>
                      </motion.tr>
                    )}
                  </React.Fragment>
                );
              })}
            </AnimatePresence>
          </tbody>
          
          <tfoot className="sticky bottom-0 bg-slate-900 text-white z-30 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.1)]">
            <tr className="text-xs font-bold uppercase tracking-widest">
              <td className="p-4" colSpan={5}>TOTALES ({historyList.length} documentos)</td>
              <td className="p-4 text-right text-slate-300 tabular-nums">{Num.fmt(totales.base)}</td>
              <td className="p-4 text-right text-slate-300 tabular-nums">{Num.fmt(totales.iva)}</td>
              <td className="p-4 text-right text-emerald-400 text-base font-black tabular-nums">{Num.fmt(totales.total)}</td>
              <td className="p-4" colSpan={2}></td>
            </tr>
          </tfoot>

        </table>
      </div>
    </div>
  );
});
