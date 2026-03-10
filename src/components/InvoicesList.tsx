import React, { useMemo } from 'react';
import { FileText, CheckCircle2, Clock, Trash2, Link as LinkIcon, AlertCircle } from 'lucide-react';
import { Factura } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { BusinessUnit } from '../views/InvoicesView';

interface InvoicesListProps {
  facturas: Factura[];
  searchQ: string;
  selectedUnit: BusinessUnit | 'ALL';
  mode: 'proveedor' | 'socio';
  filterStatus: 'all' | 'pending' | 'paid' | 'reconciled';
  year: number;
  businessUnits: any[];
  sociosReales: string[];
  superNorm: (s: string | undefined | null) => string;
  onOpenDetail: (factura: Factura) => void;
  onTogglePago: (id: string) => void;
  onDelete: (id: string) => void;
}

export const InvoicesList = ({
  facturas, searchQ, selectedUnit, mode, filterStatus, year, businessUnits, sociosReales, superNorm, onOpenDetail, onTogglePago, onDelete
}: InvoicesListProps) => {

  const historyList = useMemo(() => {
    try {
      return facturas.filter(f => {
        if (!f) return false;
        if (f.status === 'draft') return false;
        if (!(f.date || '').startsWith(year.toString())) return false;
        if (selectedUnit !== 'ALL' && f.unidad_negocio !== selectedUnit) return false;
        
        // 🚀 FILTRO ERP ESTRICTO: Determinar tipo real
        // Si es una factura antigua sin tipo, inferimos usando la lógica antigua como salvavidas
        const esSocioAntiguo = f.cliente && f.cliente !== 'Arume' ? true : false;
        const invoiceType = f.tipo || (esSocioAntiguo ? 'socio' : 'proveedor');

        // 1. JAMÁS mostrar cajas o bancos en la lista de facturas
        if (invoiceType === 'caja' || invoiceType === 'banco') return false;

        // 2. Filtrar por la pestaña activa (Proveedores vs Socios)
        if (mode === 'proveedor' && invoiceType !== 'proveedor') return false;
        if (mode === 'socio' && invoiceType !== 'socio') return false;

        // 3. Filtrar por estado de pago
        if (filterStatus === 'pending' && f.paid) return false;
        if (filterStatus === 'paid' && !f.paid) return false;
        if (filterStatus === 'reconciled' && !f.reconciled) return false;

        // 4. Búsqueda por texto
        if (searchQ) {
          const ownerNorm = superNorm(f.prov || f.cliente || '');
          const searchN = superNorm(searchQ);
          if (!ownerNorm.includes(searchN) && !superNorm(f.num || '').includes(searchN)) return false;
        }
        
        return true;
      }).sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());
    } catch (e) {
      console.error("Error en historyList:", e);
      return [];
    }
  }, [facturas, year, filterStatus, searchQ, selectedUnit, mode, superNorm]); // Ya no dependemos de la lista hardcodeada de sociosReales para filtrar

  if (historyList.length === 0) {
    return (
      <div className="py-20 flex flex-col items-center justify-center opacity-50 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
        <FileText className="w-12 h-12 mb-3 text-slate-300" />
        <p className="text-slate-500 font-bold text-sm">No hay facturas en esta vista.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {historyList.map(f => {
        const unitConfig = businessUnits.find(u => u.id === f.unidad_negocio);
        return (
          <div key={f.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition">
            <div className="flex-1 cursor-pointer" onClick={() => onOpenDetail(f)}>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded uppercase">{f.date}</span>
                
                {unitConfig && (
                  <span className={cn(
                    "text-[9px] font-black px-2 py-0.5 rounded border uppercase",
                    unitConfig.color, unitConfig.bg, "border-current opacity-70"
                  )}>
                    {unitConfig.name.split(' ')[0]}
                  </span>
                )}

                {f.source === 'email-ia' ? (
                  <span className="text-[9px] font-black text-purple-600 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">🤖 LEÍDA POR IA</span>
                ) : (
                  <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">📦 CERRADA MANUAL</span>
                )}
                {f.reconciled ? (
                  <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                    <LinkIcon className="w-2 h-2" /> BANCO OK
                  </span>
                ) : (
                  <span className="text-[9px] font-black text-rose-500 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">ESPERANDO BANCO</span>
                )}
              </div>
              <p className="font-black text-slate-800 text-base">
                {mode === 'socio' ? (f.cliente || f.prov || '—') : (f.prov || f.cliente || '—')}
              </p>
              <p className="text-xs text-slate-400 font-bold font-mono mt-0.5">Ref: {f.num}</p>
            </div>
            
            <div className="flex items-center justify-between md:justify-end gap-6 md:w-auto w-full border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
              <div className="text-left md:text-right">
                <p className="font-black text-slate-900 text-xl">{Num.fmt(Math.abs(Num.parse(f.total)))}</p>
              </div>
              <div className="flex gap-2">
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); onTogglePago(f.id); }}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all shadow-sm flex items-center gap-1",
                    f.paid ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  )}
                >
                  {f.paid ? <><CheckCircle2 className="w-3 h-3"/> CASH OK</> : <><Clock className="w-3 h-3"/> PENDIENTE</>}
                </button>
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(f.id); }}
                  className="w-9 h-9 flex items-center justify-center bg-white border border-slate-200 text-slate-400 rounded-xl hover:bg-rose-500 hover:border-rose-500 hover:text-white transition shadow-sm"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
