import React from 'react';
import { FileText, FileArchive, Package, Zap, X } from 'lucide-react';
import { Factura, Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { BusinessUnit } from '../views/InvoicesView';

interface InvoiceDetailModalProps {
  factura: Factura;
  albaranes: Albaran[];
  businessUnits: any[];
  mode: 'proveedor' | 'socio';
  onClose: () => void;
  onDownloadFile: (factura: Factura) => void;
}

export const InvoiceDetailModal = ({ factura, albaranes, businessUnits, mode, onClose, onDownloadFile }: InvoiceDetailModalProps) => {
  return (
    // 🚀 CONTENEDOR PRINCIPAL: Centrado en PC, anclado al fondo en móvil
    <div className="fixed inset-0 z-[100] flex flex-col justify-end md:justify-center items-center p-0 md:p-4">
      {/* Fondo oscuro para cerrar si haces clic fuera */}
      <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm" onClick={onClose} />
      
      {/* 🚀 MODAL: Altura máxima 90vh para garantizar que nunca se salga de la pantalla */}
      <div className="bg-slate-50 w-full max-w-md rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col h-[90vh] md:max-h-[85vh] overflow-hidden animate-fade-in">
        
        {/* 📌 CABECERA FIJA (shrink-0 asegura que no se comprima) */}
        <div className="p-6 border-b border-slate-200 bg-white flex justify-between items-center relative z-20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0"> {/* min-w-0 evita que un nombre largo rompa el flexbox */}
              <h3 className="text-lg md:text-xl font-black text-slate-800 leading-tight truncate">
                {mode === 'socio' ? (factura.cliente || factura.prov) : (factura.prov || factura.cliente)}
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Detalle de Factura</p>
            </div>
          </div>
          
          <button type="button" onClick={onClose} className="p-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 hover:text-slate-800 transition shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 📜 ÁREA CENTRAL DE SCROLL */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
          
          {/* Bloque de Información General */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-400 uppercase">Referencia</span>
              <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-lg">{factura.num}</span>
            </div>
            
            <div className="flex justify-between items-center border-t border-slate-100 pt-3">
              <span className="text-[10px] font-black text-slate-400 uppercase">Fecha Emisión</span>
              <span className="text-xs font-bold text-slate-700">{factura.date}</span>
            </div>
            
            <div className="flex justify-between items-center border-t border-slate-100 pt-3">
              <span className="text-[10px] font-black text-slate-400 uppercase">Unidad Asignada</span>
              <span className={cn(
                "text-[9px] font-black px-2 py-1 rounded-lg border uppercase tracking-wider",
                businessUnits.find(u => u.id === factura.unidad_negocio)?.color,
                businessUnits.find(u => u.id === factura.unidad_negocio)?.bg,
                "border-current"
              )}>
                {businessUnits.find(u => u.id === factura.unidad_negocio)?.name || 'Restaurante'}
              </span>
            </div>

            {/* Botón de Descargar PDF (Si existe) */}
            {factura.file_base64 && (
              <div className="pt-4 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => onDownloadFile(factura)}
                  className="w-full bg-slate-800 text-white py-3 rounded-xl font-black text-xs hover:bg-slate-900 transition flex items-center justify-center gap-2 shadow-md active:scale-95"
                >
                  <FileArchive className="w-4 h-4" /> VER DOCUMENTO ORIGINAL
                </button>
              </div>
            )}
          </div>

          {/* Bloque de Albaranes Vinculados */}
          <div>
            {factura.albaranIdsArr && factura.albaranIdsArr.length > 0 ? (
              <>
                <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-3 pl-1">
                  Albaranes Vinculados ({factura.albaranIdsArr.length})
                </p>
                <div className="space-y-2">
                  {factura.albaranIdsArr.map(id => {
                    const alb = albaranes.find(a => a.id === id);
                    return alb ? (
                      <div key={id} className="flex justify-between items-center text-xs py-3 px-4 bg-white border border-slate-200 rounded-2xl text-slate-600 font-bold shadow-sm">
                        <span className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-slate-400"/> 
                          {alb.date}
                        </span>
                        <span className="text-slate-900 font-black">{Num.fmt(alb.total)}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              </>
            ) : (
              <div className="text-center py-8 bg-white rounded-2xl border border-dashed border-slate-300 shadow-sm">
                <Zap className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-600 font-black">Gasto Directo</p>
                <p className="text-[10px] text-slate-400 uppercase mt-1 tracking-widest">Sin albaranes previos</p>
              </div>
            )}
          </div>
        </div>

        {/* 📌 FOOTER FIJO (Para el Total) */}
        <div className="p-6 bg-slate-900 text-white shrink-0 relative z-20 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.15)] pb-8 md:pb-6">
          <div className="flex justify-between items-end">
            <div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Total Factura</span>
              <span className={cn("text-xs font-bold uppercase px-2 py-0.5 rounded-md", factura.paid ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400")}>
                {factura.paid ? 'PAGADA' : 'PENDIENTE'}
              </span>
            </div>
            <span className="text-4xl font-black tracking-tighter">{Num.fmt(Math.abs(Num.parse(factura.total)))}</span>
          </div>
        </div>

      </div>
    </div>
  );
};
