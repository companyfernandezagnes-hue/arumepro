import React, { useMemo } from 'react';
import { FileText, FileArchive, Package, Zap, X, Calendar, Hash } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
// 🛡️ Importamos FacturaExtended para mantener el tipado estricto
import { FacturaExtended, BusinessUnit } from './InvoicesView'; 
import { Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

interface InvoiceDetailModalProps {
  factura: FacturaExtended;
  albaranes: Albaran[];
  businessUnits: any[];
  mode: 'proveedor' | 'socio';
  onClose: () => void;
  onDownloadFile: (factura: FacturaExtended) => void;
}

// 🚀 OPTIMIZACIÓN: React.memo evita que el modal se re-renderice si la vista de fondo cambia
export const InvoiceDetailModal = React.memo(({ 
  factura, albaranes, businessUnits, mode, onClose, onDownloadFile 
}: InvoiceDetailModalProps) => {

  // 🛡️ SANITIZACIÓN DE DATOS (Auditoría Copilot)
  const safeProvName = useMemo(() => {
    const raw = mode === 'socio' ? (factura.cliente || factura.prov) : (factura.prov || factura.cliente);
    return raw ? raw.trim().toUpperCase() : 'DESCONOCIDO';
  }, [factura, mode]);

  const safeRef = factura.num ? factura.num.trim().toUpperCase() : 'S/N';
  const safeDate = factura.date || 'Fecha desconocida';

  // Albaranes filtrados de forma segura
  const albaranesVinculados = useMemo(() => {
    if (!factura.albaranIdsArr || factura.albaranIdsArr.length === 0) return [];
    return factura.albaranIdsArr
      .map(id => albaranes.find(a => a.id === id))
      .filter(Boolean) as Albaran[];
  }, [factura.albaranIdsArr, albaranes]);

  return (
    <AnimatePresence>
      {/* 🚀 CONTENEDOR PRINCIPAL: Uso de dvh para Safari Mobile */}
      <div className="fixed inset-0 z-[200] flex flex-col justify-end md:justify-center items-center p-0 md:p-4">
        
        {/* Fondo oscuro - Click para cerrar */}
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
          onClick={onClose} 
        />
        
        {/* 🚀 MODAL: max-h-[85dvh] protege contra el teclado de iOS y la barra de navegación */}
        <motion.div 
          initial={{ y: "100%", md: { y: 20, opacity: 0 } }} 
          animate={{ y: 0, opacity: 1 }} 
          exit={{ y: "100%", md: { y: 20, opacity: 0 } }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="bg-[#F8FAFC] w-full max-w-md rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col h-[85dvh] md:h-auto md:max-h-[85dvh] overflow-hidden"
          onClick={(e) => e.stopPropagation()} // Evita que clics internos cierren el modal
        >
          
          {/* 📌 CABECERA FIJA */}
          <div className="p-6 border-b border-slate-200 bg-white flex justify-between items-center relative z-20 shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center shrink-0 shadow-sm border border-indigo-100">
                <FileText className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg md:text-xl font-black text-slate-800 leading-tight truncate">
                  {safeProvName}
                </h3>
                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mt-0.5">
                  Detalle de {mode === 'socio' ? 'Liquidación' : 'Factura'}
                </p>
              </div>
            </div>
            
            <button 
              type="button" 
              onClick={onClose} 
              className="p-2.5 bg-slate-50 text-slate-400 rounded-full hover:bg-rose-50 hover:text-rose-500 transition-colors shrink-0"
              aria-label="Cerrar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 📜 ÁREA CENTRAL DE SCROLL */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6" style={{ WebkitOverflowScrolling: 'touch' }}>
            
            {/* Bloque de Información General */}
            <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1.5"><Hash className="w-3 h-3"/> Referencia</span>
                <span className="text-xs font-mono font-black text-slate-700 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">{safeRef}</span>
              </div>
              
              <div className="flex justify-between items-center border-t border-slate-50 pt-4">
                <span className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1.5"><Calendar className="w-3 h-3"/> Emisión</span>
                <span className="text-xs font-black text-slate-700">{safeDate}</span>
              </div>
              
              <div className="flex justify-between items-center border-t border-slate-50 pt-4">
                <span className="text-[10px] font-black text-slate-400 uppercase">Unidad Asignada</span>
                <span className={cn(
                  "text-[9px] font-black px-2.5 py-1 rounded-md border uppercase tracking-wider shadow-sm",
                  businessUnits.find(u => u.id === factura.unidad_negocio)?.color || "text-slate-600",
                  businessUnits.find(u => u.id === factura.unidad_negocio)?.bg || "bg-slate-100",
                  "border-current opacity-90"
                )}>
                  {businessUnits.find(u => u.id === factura.unidad_negocio)?.name || 'Restaurante'}
                </span>
              </div>

              {/* Botón de Descargar PDF Original */}
              {factura.file_base64 && (
                <div className="pt-5 border-t border-slate-100 mt-2">
                  <button 
                    type="button"
                    onClick={() => onDownloadFile(factura)}
                    className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-600 transition-colors flex items-center justify-center gap-2 shadow-lg active:scale-95"
                  >
                    <FileArchive className="w-4 h-4" /> Ver Documento Original
                  </button>
                </div>
              )}
            </div>

            {/* Bloque de Albaranes Vinculados */}
            <div>
              {albaranesVinculados.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-3 px-1">
                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">
                      Albaranes Incluidos
                    </p>
                    <span className="text-[10px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">
                      {albaranesVinculados.length}
                    </span>
                  </div>
                  
                  <div className="space-y-2.5">
                    {albaranesVinculados.map(alb => (
                      <div key={alb.id} className="flex justify-between items-center text-xs py-3.5 px-4 bg-white border border-slate-100 rounded-2xl text-slate-600 shadow-sm hover:border-indigo-100 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-1.5 bg-slate-50 rounded-lg"><Package className="w-4 h-4 text-slate-400"/></div>
                          <div>
                            <p className="font-bold text-slate-700">{alb.date}</p>
                            <p className="text-[9px] font-mono text-slate-400 uppercase mt-0.5">Ref: {alb.num || 'S/N'}</p>
                          </div>
                        </div>
                        <span className="text-slate-900 font-black text-sm">{Num.fmt(alb.total)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-10 bg-white rounded-3xl border border-dashed border-slate-200 shadow-sm">
                  <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Zap className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-sm text-slate-700 font-black">Gasto Directo</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Sin albaranes vinculados</p>
                </div>
              )}
            </div>
          </div>

          {/* 📌 FOOTER FIJO (Safe Area Support) */}
          <div className="bg-slate-900 text-white shrink-0 relative z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.15)] rounded-t-3xl md:rounded-t-none">
            <div className="p-6 md:p-8 pb-safe"> {/* pb-safe asegura margen en iOS */}
              <div className="flex justify-between items-end">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Total Contabilizado</span>
                  <span className={cn(
                    "text-[10px] font-black uppercase px-3 py-1.5 rounded-lg tracking-wider", 
                    factura.paid ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                  )}>
                    {factura.paid ? 'ESTADO: PAGADA' : 'ESTADO: PENDIENTE'}
                  </span>
                </div>
                <span className="text-4xl md:text-5xl font-black tracking-tighter text-white">
                  {Num.fmt(Math.abs(Num.parse(factura.total)))}
                </span>
              </div>
            </div>
          </div>

        </motion.div>
      </div>
    </AnimatePresence>
  );
});
