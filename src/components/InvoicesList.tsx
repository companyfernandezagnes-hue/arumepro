import React, { useMemo } from 'react';
import { FileText, CheckCircle2, Clock, Trash2, Link as LinkIcon, AlertCircle, Building2, User, Sparkles, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
// 🛡️ Tipados importados del padre
import { FacturaExtended, BusinessUnit } from './InvoicesView'; 
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
}

/* =======================================================
 * 🧠 HOOK DE FILTRADO: LÓGICA DE SUPERVIVENCIA EXTREMA
 * ======================================================= */
function useInvoicesFilters(
  facturas: FacturaExtended[], 
  year: number, 
  filterStatus: string, 
  searchQ: string, 
  selectedUnit: string, 
  mode: string, 
  sociosReales: string[], 
  superNorm: (s: string | undefined | null) => string
) {
  return useMemo(() => {
    try {
      if (!Array.isArray(facturas)) return [];

      const searchN = searchQ ? superNorm(searchQ) : '';
      const normalizedSocios = Array.isArray(sociosReales) ? sociosReales.map(s => superNorm(s)) : [];
      const yearStr = year ? year.toString() : '';

      const list = facturas.filter(f => {
        // 1. Descartar basura o borradores IA
        if (!f || typeof f !== 'object') return false;
        if (f.status === 'draft') return false;

        // 2. Filtro de Año Seguro (Usando startsWith evita errores de zona horaria)
        const fDate = f.date || '';
        if (yearStr && !fDate.startsWith(yearStr)) return false;

        // 3. Filtro Unidad Seguro
        const unitToCompare = f.unidad_negocio || 'REST';
        if (selectedUnit !== 'ALL' && unitToCompare !== selectedUnit) return false;
        
        // 4. JAMÁS mostrar cajas o bancos
        if (f.tipo === 'caja' || (f as any).tipo === 'banco') return false;

        // 5. Evaluar Proveedor vs Socio
        const normCliente = superNorm(f.cliente);
        const normProv = superNorm(f.prov);
        const isSocio = normalizedSocios.some(socio => socio && (normCliente.includes(socio) || normProv.includes(socio)));
        
        if (mode === 'proveedor' && isSocio) return false;
        if (mode === 'socio' && !isSocio) return false;

        // 6. Estados de pago y conciliación
        if (filterStatus === 'pending' && f.paid) return false;
        if (filterStatus === 'paid' && !f.paid) return false;
        if (filterStatus === 'reconciled' && !f.reconciled) return false;

        // 7. Búsqueda por texto segura
        if (searchN) {
          const matchProv = normProv.includes(searchN);
          const matchClient = normCliente.includes(searchN);
          const matchNum = superNorm(f.num || '').includes(searchN);
          if (!matchProv && !matchClient && !matchNum) return false;
        }
        
        return true;
      });

      // Ordenación segura: Las más recientes primero
      return list.sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA); // localeCompare es más seguro que new Date() para ISO strings
      });

    } catch (e) {
      console.error("Error crítico en el filtrado de InvoicesList:", e);
      return []; 
    }
  }, [facturas, year, filterStatus, searchQ, selectedUnit, mode, sociosReales, superNorm]);
}

/* =======================================================
 * 🎨 COMPONENTE UI: LISTA DE FACTURAS
 * ======================================================= */
export const InvoicesList = React.memo(({
  facturas, searchQ, selectedUnit, mode, filterStatus, year, businessUnits, sociosReales, superNorm, onOpenDetail, onTogglePago, onDelete
}: InvoicesListProps) => {

  const historyList = useInvoicesFilters(facturas, year, filterStatus, searchQ, selectedUnit, mode, sociosReales, superNorm);

  if (historyList.length === 0) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="py-24 flex flex-col items-center justify-center bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200"
      >
        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
          <FileText className="w-8 h-8 text-slate-300" />
        </div>
        <p className="text-slate-500 font-black text-sm uppercase tracking-widest">Lista Vacía</p>
        <p className="text-slate-400 text-xs mt-1 text-center max-w-xs">
          No hay {mode === 'socio' ? 'liquidaciones' : 'facturas'} para estos filtros en {year}.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      <AnimatePresence mode="popLayout">
        {historyList.map(f => {
          const unitConfig = Array.isArray(businessUnits) 
            ? businessUnits.find(u => u.id === (f.unidad_negocio || 'REST')) 
            : null;
            
          const titular = mode === 'socio' ? (f.cliente || f.prov || '—') : (f.prov || f.cliente || '—');

          return (
            <motion.div 
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              key={f.id} 
              className="bg-white p-4 md:p-5 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-lg transition-all duration-300 group cursor-pointer"
              onClick={() => onOpenDetail(f)}
            >
              <div className="flex-1">
                {/* 🏷️ CHIPS DE ESTADO */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-3 py-1 rounded-full uppercase tracking-tighter border border-slate-200">
                    {f.date || 'Sin fecha'}
                  </span>
                  
                  {unitConfig && (
                    <span className={cn(
                      "text-[9px] font-black px-2.5 py-1 rounded-full uppercase flex items-center gap-1 shadow-sm",
                      unitConfig.bg, unitConfig.color
                    )}>
                      <unitConfig.icon className="w-3 h-3" /> {unitConfig.name.split(' ')[0]}
                    </span>
                  )}

                  {f.source === 'gmail-sync' || f.source === 'dropzone' || f.source === 'email-ia' ? (
                    <span className="text-[9px] font-black text-purple-600 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200"><Sparkles className="w-3 h-3 inline mr-1"/> IA</span>
                  ) : (
                    <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200"><Package className="w-3 h-3 inline mr-1"/> MANUAL</span>
                  )}
                  
                  {f.reconciled ? (
                    <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1 shadow-sm">
                      <LinkIcon className="w-3 h-3" /> BANCO OK
                    </span>
                  ) : (
                    <span className="text-[9px] font-black text-rose-500 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> PENDIENTE BANCO
                    </span>
                  )}
                </div>

                {/* 🏢 TITULAR Y REF */}
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-50 rounded-xl hidden md:block">
                    {mode === 'socio' ? <User className="w-5 h-5 text-slate-400" /> : <Building2 className="w-5 h-5 text-slate-400" />}
                  </div>
                  <div>
                    <p className="font-black text-slate-800 text-lg leading-none">{titular}</p>
                    <p className="text-[10px] text-slate-400 font-bold font-mono mt-1 uppercase tracking-widest">REF: {f.num || 'S/N'}</p>
                  </div>
                </div>
              </div>
              
              {/* 💰 ACCIONES Y TOTAL */}
              <div className="flex items-center justify-between md:justify-end gap-6 md:w-auto w-full border-t md:border-t-0 pt-4 md:pt-0 border-slate-100">
                <div className="text-left md:text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Total</p>
                  <p className="font-black text-slate-900 text-2xl tracking-tighter leading-none">{Num.fmt(Math.abs(Num.parse(f.total || 0)))}</p>
                </div>
                
                <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onTogglePago(f.id); }}
                    className={cn(
                      "px-4 py-3 rounded-2xl text-[10px] font-black uppercase transition-all shadow-sm flex items-center gap-1.5 active:scale-95",
                      f.paid 
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20' 
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    )}
                  >
                    {f.paid ? <><CheckCircle2 className="w-4 h-4"/> PAGADA</> : <><Clock className="w-4 h-4"/> PENDIENTE</>}
                  </button>
                  
                  <button 
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete(f.id); }}
                    className="w-12 h-12 flex items-center justify-center bg-white border border-slate-200 text-slate-400 rounded-2xl hover:bg-rose-500 hover:border-rose-500 hover:text-white transition-all shadow-sm active:scale-95"
                    title="Eliminar registro"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
});
