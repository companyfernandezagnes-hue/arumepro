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
    <div className="fixed inset-0 z-[100] flex justify-center items-center p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl relative z-10 animate-fade-in">
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500 text-2xl transition">✕</button>
        
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-800 leading-tight">
              {mode === 'socio' ? (factura.cliente || factura.prov) : (factura.prov || factura.cliente)}
            </h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Detalle de Factura</p>
          </div>
        </div>

        <div className="bg-slate-50 p-4 rounded-2xl mt-6 mb-6 border border-slate-100">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase">Referencia</span>
            <span className="text-xs font-mono font-bold text-slate-700">{factura.num}</span>
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase">Fecha Emisión</span>
            <span className="text-xs font-bold text-slate-700">{factura.date}</span>
          </div>
          <div className="flex justify-between items-center border-t border-slate-200 pt-2 mt-2">
            <span className="text-[10px] font-black text-slate-400 uppercase">Unidad Asignada</span>
            <span className={cn(
              "text-[9px] font-black px-2 py-0.5 rounded border uppercase",
              businessUnits.find(u => u.id === factura.unidad_negocio)?.color,
              businessUnits.find(u => u.id === factura.unidad_negocio)?.bg,
              "border-current"
            )}>
              {businessUnits.find(u => u.id === factura.unidad_negocio)?.name || 'Restaurante'}
            </span>
          </div>

          {factura.file_base64 && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <button 
                onClick={() => onDownloadFile(factura)}
                className="w-full bg-slate-800 text-white py-3 rounded-xl font-black text-xs hover:bg-slate-900 transition flex items-center justify-center gap-2"
              >
                <FileArchive className="w-4 h-4" /> DESCARGAR DOCUMENTO ORIGINAL
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2 mb-6 max-h-48 overflow-y-auto custom-scrollbar pr-2">
          {factura.albaranIdsArr && factura.albaranIdsArr.length > 0 ? (
            <>
              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-3 border-b border-indigo-100 pb-2">Albaranes Vinculados ({factura.albaranIdsArr.length})</p>
              {factura.albaranIdsArr.map(id => {
                const alb = albaranes.find(a => a.id === id);
                return alb ? (
                  <div key={id} className="flex justify-between text-xs py-2 px-3 bg-white border border-slate-100 rounded-xl text-slate-600 font-bold hover:shadow-sm transition">
                    <span className="flex items-center gap-2"><Package className="w-3 h-3 text-slate-300"/> {alb.date}</span>
                    <span className="text-slate-900">{Num.fmt(alb.total)}</span>
                  </div>
                ) : null;
              })}
            </>
          ) : (
            <div className="text-center py-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <Zap className="w-6 h-6 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500 font-bold">Gasto Directo</p>
              <p className="text-[9px] text-slate-400 uppercase">Sin albaranes previos</p>
            </div>
          )}
        </div>

        <div className="flex justify-between items-end bg-slate-900 p-5 rounded-2xl text-white shadow-lg mt-4">
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Total Factura</span>
          <span className="text-3xl font-black">{Num.fmt(Math.abs(Num.parse(factura.total)))}</span>
        </div>
      </div>
    </div>
  );
};
