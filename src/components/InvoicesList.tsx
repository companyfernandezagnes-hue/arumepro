import React, { useMemo, useState } from 'react';
import { FileText, CheckCircle2, Clock, Trash2, Link as LinkIcon, AlertCircle, Sparkles, Package, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
// 🛡️ Tipados importados del padre
import { FacturaExtended, BusinessUnit } from './InvoicesView'; 
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

// IMPORTAMOS Albaran si lo necesitas de los tipos
import { Albaran } from '../types';

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
  // 💡 AÑADIMOS albaranesSeguros PARA EL INSPECTOR
  albaranesSeguros?: Albaran[]; 
}

type SortField = 'date' | 'prov' | 'total';
type SortOrder = 'asc' | 'desc';

/* =======================================================
 * 🧠 HOOK DE FILTRADO Y ORDENACIÓN PRO
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

        const fDate = f.date || '';
        if (yearStr && !fDate.startsWith(yearStr)) return false;

        const unitToCompare = f.unidad_negocio || 'REST';
        if (selectedUnit !== 'ALL' && unitToCompare !== selectedUnit) return false;
        
        if (f.tipo === 'caja' || (f as any).tipo === 'banco') return false;

        const normCliente = superNorm(f.cliente);
        const normProv = superNorm(f.prov);
        const isSocio = normalizedSocios.some(socio => socio && (normCliente.includes(socio) || normProv.includes(socio)));
        
        if (mode === 'proveedor' && isSocio) return false;
        if (mode === 'socio' && !isSocio) return false;

        if (filterStatus === 'pending' && f.paid) return false;
        if (filterStatus === 'paid' && !f.paid) return false;
        if (filterStatus === 'reconciled' && !f.reconciled) return false;

        if (searchN) {
          const matchProv = normProv.includes(searchN);
          const matchClient = normCliente.includes(searchN);
          const matchNum = superNorm(f.num || '').includes(searchN);
          if (!matchProv && !matchClient && !matchNum) return false;
        }
        
        return true;
      });

      // ORDENACIÓN DINÁMICA
      return list.sort((a, b) => {
        let valA, valB;
        if (sortField === 'date') {
          valA = a.date || ''; valB = b.date || '';
        } else if (sortField === 'prov') {
          valA = superNorm(mode === 'socio' ? a.cliente : a.prov);
          valB = superNorm(mode === 'socio' ? b.cliente : b.prov);
        } else {
          valA = Math.abs(Num.parse(a.total)); valB = Math.abs(Num.parse(b.total));
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
 * 🎨 COMPONENTE UI: TABLA CONTABLE DENSA
 * ======================================================= */
export const InvoicesList = React.memo(({
  facturas, searchQ, selectedUnit, mode, filterStatus, year, businessUnits, sociosReales, superNorm, onOpenDetail, onTogglePago, onDelete, albaranesSeguros = []
}: InvoicesListProps) => {

  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  // 💡 ESTADO PARA EL INSPECTOR DE ALBARANES
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const historyList = useInvoicesFilters(facturas, year, filterStatus, searchQ, selectedUnit, mode, sociosReales, superNorm, sortField, sortOrder);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpandedId(expandedId === id ? null : id);
  };

  // CÁLCULO DE TOTALES (Base, IVA y Total)
  const totales = useMemo(() => {
    return historyList.reduce((acc, f) => {
      const t = Math.abs(Num.parse(f.total || 0));
      const b = Num.parse(f.base || 0) || Num.round2(t / 1.10);
      const i = Num.parse(f.tax || 0) || Num.round2(t - b);
      return { base: acc.base + b, iva: acc.iva + i, total: acc.total + t };
    }, { base: 0, iva: 0, total: 0 });
  }, [historyList]);

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return '↕';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  if (historyList.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="py-20 flex flex-col items-center justify-center bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3">
          <FileText className="w-6 h-6 text-slate-300" />
        </div>
        <p className="text-slate-500 font-bold text-xs uppercase tracking-widest">Lista Vacía</p>
        <p className="text-slate-400 text-[10px] mt-1 text-center max-w-xs">No hay {mode === 'socio' ? 'liquidaciones' : 'facturas'} para estos filtros.</p>
      </motion.div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col max-h-[75vh]">
      <div className="overflow-x-auto custom-scrollbar flex-1">
        <table className="w-full text-left border-collapse whitespace-nowrap min-w-[900px]">
          
          {/* CABECERA FIJA */}
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-20 shadow-sm">
            <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-widest select-none">
              <th className="p-3 w-8 text-center"></th> {/* Columna para el botón de expandir */}
              <th className="p-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort('date')}>
                Fecha <span className="opacity-50 ml-1">{getSortIcon('date')}</span>
              </th>
              <th className="p-3">Ref</th>
              <th className="p-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort('prov')}>
                Titular <span className="opacity-50 ml-1">{getSortIcon('prov')}</span>
              </th>
              <th className="p-3 text-center">Unidad</th>
              <th className="p-3 text-right">Base</th>
              <th className="p-3 text-right">IVA</th>
              <th className="p-3 text-right cursor-pointer hover:bg-slate-100 transition text-slate-800" onClick={() => handleSort('total')}>
                Total <span className="opacity-50 ml-1">{getSortIcon('total')}</span>
              </th>
              <th className="p-3 text-center">Estado</th>
              <th className="p-3 text-center">Acciones</th>
            </tr>
          </thead>
          
          {/* FILAS */}
          <tbody className="divide-y divide-slate-100 text-[11px] font-medium text-slate-700 relative">
            <AnimatePresence initial={false}>
              {historyList.map(f => {
                const unitConfig = Array.isArray(businessUnits) ? businessUnits.find(u => u.id === (f.unidad_negocio || 'REST')) : null;
                const titular = mode === 'socio' ? (f.cliente || f.prov || '—') : (f.prov || f.cliente || '—');
                const isIA = f.source === 'gmail-sync' || f.source === 'dropzone' || f.source === 'email-ia';
                const fTotal = Math.abs(Num.parse(f.total || 0));
                const fBase = Num.parse(f.base || 0) || Num.round2(fTotal / 1.10);
                const fTax = Num.parse(f.tax || 0) || Num.round2(fTotal - fBase);
                
                const hasAlbaranes = f.albaranIdsArr && f.albaranIdsArr.length > 0;
                const isExpanded = expandedId === f.id;

                // Buscamos los objetos de los albaranes vinculados
                const albaranesVinculados = hasAlbaranes ? albaranesSeguros.filter(a => f.albaranIdsArr?.includes(a.id)) : [];

                return (
                  <React.Fragment key={f.id}>
                    {/* FILA PRINCIPAL */}
                    <motion.tr 
                      layout
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      onClick={() => onOpenDetail(f)}
                      className={cn("hover:bg-indigo-50/40 cursor-pointer transition-colors group z-10 relative", isExpanded ? "bg-indigo-50/30" : "")}
                    >
                      <td className="p-3 text-center" onClick={(e) => hasAlbaranes ? toggleExpand(e, f.id) : null}>
                        {hasAlbaranes ? (
                          <button className={cn("p-1 rounded-md transition-colors", isExpanded ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600")}>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        ) : (
                           <span className="w-3.5 h-3.5 inline-block"></span> 
                        )}
                      </td>
                      <td className="p-3 font-semibold text-slate-800">{f.date || '—'}</td>
                      <td className="p-3 font-mono text-[10px] text-slate-500">{f.num || 'S/N'}</td>
                      <td className="p-3 font-bold text-slate-900 truncate max-w-[200px]" title={titular}>
                        <div className="flex items-center gap-1.5">
                          {isIA && <Sparkles className="w-3 h-3 text-purple-400 shrink-0" title="Extraído con IA"/>}
                          <span className="truncate">{titular}</span>
                          {hasAlbaranes && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[8px] font-bold border border-slate-200">{f.albaranIdsArr?.length}</span>}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {unitConfig && <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold uppercase", unitConfig.bg, unitConfig.color)}>{unitConfig.name.split(' ')[0]}</span>}
                      </td>
                      <td className="p-3 text-right text-slate-500">{Num.fmt(fBase)}</td>
                      <td className="p-3 text-right text-slate-500">{Num.fmt(fTax)}</td>
                      <td className="p-3 text-right font-black text-slate-900">{Num.fmt(fTotal)}</td>
                      
                      <td className="p-3 text-center">
                        {f.reconciled ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200" title="Conciliado en Banco"><LinkIcon className="w-3 h-3" /> BANCO</span>
                        ) : f.paid ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200" title="Pagada en Efectivo"><CheckCircle2 className="w-3 h-3" /> PAGADA</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200" title="Pendiente de Pago"><Clock className="w-3 h-3" /> PDTE</span>
                        )}
                      </td>

                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={(e) => { e.stopPropagation(); onTogglePago(f.id); }} className={cn("p-1.5 rounded transition", f.paid ? "text-emerald-600 hover:bg-emerald-100" : "text-slate-400 hover:bg-slate-200 hover:text-slate-700")} title={f.paid ? "Marcar Pendiente" : "Marcar Pagada"}>
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(f.id); }} className="p-1.5 rounded text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition" title="Eliminar">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>

                    {/* 💡 FILA EXPANDIDA: INSPECTOR DE ALBARANES */}
                    {isExpanded && hasAlbaranes && (
                      <motion.tr 
                        initial={{ opacity: 0, height: 0 }} 
                        animate={{ opacity: 1, height: 'auto' }} 
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-slate-50/50 relative overflow-hidden"
                      >
                        <td colSpan={10} className="p-0 border-b border-slate-200">
                          <div className="py-4 px-12 relative flex items-start gap-6 overflow-x-auto custom-scrollbar">
                            {/* Línea conectora visual */}
                            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-indigo-100"></div>

                            {albaranesVinculados.map((alb, index) => (
                              <div key={alb.id} className="relative z-10 flex flex-col items-center bg-white p-3 rounded-lg border border-slate-200 shadow-sm min-w-[140px] hover:border-indigo-300 transition-colors cursor-default">
                                {/* Flechita que apunta al albarán */}
                                <div className="absolute -left-6 top-1/2 w-6 h-0.5 bg-indigo-200"></div>
                                <div className="absolute -left-6 top-1/2 w-1.5 h-1.5 rounded-full bg-indigo-400 -translate-y-1/2"></div>
                                
                                <Package className="w-4 h-4 text-indigo-400 mb-1" />
                                <span className="text-[10px] font-bold text-slate-500">{alb.date}</span>
                                <span className="font-mono text-xs font-semibold text-slate-800 my-0.5">{alb.num || 'S/N'}</span>
                                <span className="text-sm font-black text-emerald-600">{Num.fmt(alb.total)}</span>
                              </div>
                            ))}
                            
                            {/* Resumen al final de la línea */}
                            <div className="relative z-10 flex flex-col justify-center h-full ml-4">
                               <div className="bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-lg text-center">
                                 <p className="text-[9px] font-bold uppercase text-indigo-400 mb-0.5">Suma Albaranes</p>
                                 <p className="text-sm font-black text-indigo-700">
                                   {Num.fmt(albaranesVinculados.reduce((acc, a) => acc + (Num.parse(a.total) || 0), 0))}
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
          
          {/* FILA DE TOTALES FIJA ABAJO */}
          <tfoot className="sticky bottom-0 bg-slate-900 text-white z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
            <tr className="text-xs font-bold uppercase tracking-widest">
              <td className="p-3 rounded-bl-lg" colSpan={5}>TOTALES ({historyList.length} docs)</td>
              <td className="p-3 text-right text-slate-300">{Num.fmt(totales.base)}</td>
              <td className="p-3 text-right text-slate-300">{Num.fmt(totales.iva)}</td>
              <td className="p-3 text-right text-emerald-400 text-sm font-black">{Num.fmt(totales.total)}</td>
              <td className="p-3 rounded-br-lg" colSpan={2}></td>
            </tr>
          </tfoot>

        </table>
      </div>
    </div>
  );
});
