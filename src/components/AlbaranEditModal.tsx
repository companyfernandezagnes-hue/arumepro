import React, { useCallback } from 'react';
import { Save, Trash2, X, Plus, Mic, Package, Calculator, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
// Si BusinessUnit está en types, impórtalo de ahí. Si no, lo definimos para que no falle:
export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

interface AlbaranEditModalProps {
  editForm: Albaran;
  sociosReales: any[];
  setEditForm: React.Dispatch<React.SetStateAction<Albaran | null>>;
  onClose: () => void;
  onSave: (e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  recordingMode: 'new' | 'edit' | null;
  startVoiceRecording: (mode: 'new' | 'edit') => void;
}

export const AlbaranEditModal = ({ 
  editForm, sociosReales, setEditForm, onClose, onSave, onDelete, recordingMode, startVoiceRecording 
}: AlbaranEditModalProps) => {
  
  // 🚀 CEREBRO CONTABLE: Recalcula Base e IVA automáticamente al cambiar Total o Cantidad
  const handleItemChange = useCallback((index: number, field: string, value: any) => {
    setEditForm(prev => {
      if (!prev || !prev.items) return prev;
      
      const newItems = [...prev.items];
      const item = { ...newItems[index], [field]: value };

      // Si cambiamos precio, cantidad o IVA, recalculamos las matemáticas de la línea
      if (['t', 'rate', 'q'].includes(field)) {
        const totalLinea = Num.parse(item.t);
        const ivaRate = Num.parse(item.rate) || 10;
        const qty = Num.parse(item.q) || 1;

        item.base = Num.round2(totalLinea / (1 + ivaRate / 100));
        item.tax = Num.round2(totalLinea - item.base);
        item.unitPrice = qty > 0 ? Num.round2(totalLinea / qty) : 0;
      }

      newItems[index] = item;

      // Recalculamos los totales globales del Albarán
      const globalTotal = newItems.reduce((acc, it) => acc + Num.parse(it.t), 0);
      const globalBase = newItems.reduce((acc, it) => acc + Num.parse(it.base), 0);
      const globalTax = newItems.reduce((acc, it) => acc + Num.parse(it.tax), 0);

      return { 
        ...prev, 
        items: newItems, 
        total: Num.round2(globalTotal), 
        base: Num.round2(globalBase), 
        taxes: Num.round2(globalTax) 
      };
    });
  }, [setEditForm]);

  const handleAddLine = () => {
    setEditForm(prev => {
      if (!prev) return prev;
      const newItems = [...(prev.items || []), { q: 1, n: '', t: 0, rate: 10, base: 0, tax: 0, unitPrice: 0 }];
      return { ...prev, items: newItems };
    });
  };

  const deleteItemFromEdit = (index: number) => {
    setEditForm(prev => {
      if (!prev || !prev.items) return prev;
      const newItems = [...prev.items];
      newItems.splice(index, 1);
      
      // Recalculamos totales al borrar
      const globalTotal = newItems.reduce((acc, it) => acc + Num.parse(it.t), 0);
      const globalBase = newItems.reduce((acc, it) => acc + Num.parse(it.base), 0);
      const globalTax = newItems.reduce((acc, it) => acc + Num.parse(it.tax), 0);

      return { ...prev, items: newItems, total: Num.round2(globalTotal), base: Num.round2(globalBase), taxes: Num.round2(globalTax) };
    });
  };
  
  const vaciarItems = () => setEditForm(prev => prev ? ({ ...prev, items: [], total: 0, base: 0, taxes: 0 }) : prev);

  const isRecording = recordingMode === 'edit';

  return (
    <div className="fixed inset-0 z-[200] flex justify-center items-start pt-4 md:items-center md:pt-0 p-0 md:p-4">
      {/* Fondo oscuro */}
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={() => !recordingMode && onClose()} 
        className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" 
      />
      
      <motion.div 
        initial={{ y: "100%", md: { y: 20, opacity: 0 } }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-[#F8FAFC] w-full max-w-3xl rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col h-[90dvh] md:max-h-[85vh] overflow-hidden"
      >
        {/* 🚀 CABECERA FIJA */}
        <div className="p-5 md:p-6 border-b border-slate-200 flex justify-between items-center bg-white sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center hidden md:flex">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-black text-slate-800 leading-none">Editar Albarán</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Ref: <span className="text-indigo-500">{editForm.num || 'S/N'}</span></p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button type="button" disabled={recordingMode !== null} onClick={onClose} className="p-2 md:px-4 bg-slate-50 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-100 transition border border-slate-200 disabled:opacity-50">
              <span className="hidden md:inline">Cancelar</span>
              <X className="w-5 h-5 md:hidden" />
            </button>
            <button type="button" disabled={recordingMode !== null} onClick={onSave} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-xs hover:bg-indigo-700 transition flex items-center gap-2 shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50">
              <Save className="w-4 h-4" />
              <span>Guardar</span>
            </button>
          </div>
        </div>
        
        {/* 📜 ÁREA DE SCROLL */}
        <div className="flex-1 overflow-y-auto p-5 md:p-6 custom-scrollbar space-y-6">
          
          {/* BANNER GRABACIÓN */}
          <AnimatePresence>
            {isRecording && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-rose-500 text-white p-4 rounded-2xl flex items-center gap-3 shadow-lg shadow-rose-500/20">
                <div className="w-3 h-3 bg-white rounded-full animate-pulse shrink-0" />
                <div>
                  <p className="text-xs font-black uppercase tracking-widest">Escuchando cambios...</p>
                  <p className="text-[10px] opacity-80">"Añade 2 cajas de tomates a 15 euros"</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Proveedor</p>
              <input value={editForm.prov} onChange={e => setEditForm(prev => prev ? {...prev, prov: e.target.value} : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition" />
            </div>
            
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Fecha</p>
              <input type="date" value={editForm.date} onChange={e => setEditForm(prev => prev ? {...prev, date: e.target.value} : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition" />
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Responsable Pago</p>
              <select value={editForm.socio || "Arume"} onChange={(e) => setEditForm(prev => prev ? { ...prev, socio: e.target.value } : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition cursor-pointer">
                <option value="Arume">Arume (Empresa)</option>
                {sociosReales.map((s: any) => <option key={s.id || s.n} value={s.n}>{s.n}</option>)}
              </select>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Unidad Negocio</p>
              <select value={editForm.unitId || "REST"} onChange={(e) => setEditForm(prev => prev ? { ...prev, unitId: e.target.value as BusinessUnit } : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition cursor-pointer">
                <option value="REST">Restaurante</option>
                <option value="DLV">Catering Hoteles</option>
                <option value="SHOP">Tienda Sake</option>
                <option value="CORP">Socios / Corp</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-end px-1">
              <div>
                <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Desglose de Líneas</p>
                <p className="text-[9px] text-slate-400 font-bold mt-0.5">Calculadora automática integrada</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={vaciarItems} className="bg-white border border-rose-200 text-rose-500 px-3 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-rose-50 transition shadow-sm">Vaciar</button>
                <button type="button" onClick={() => startVoiceRecording('edit')} className={cn("px-3 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 transition shadow-sm", isRecording ? "bg-rose-500 text-white animate-pulse" : "bg-slate-900 text-white hover:bg-slate-800")}>
                  <Mic className="w-3 h-3" /> {isRecording ? "DICTANDO..." : "DICTAR CAMBIOS (VOSK/IA)"}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-[2rem] p-4 md:p-6 border border-slate-200 shadow-sm space-y-3 overflow-hidden">
              {/* CABECERA TABLA */}
              <div className="hidden md:grid grid-cols-12 gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-2">
                <div className="col-span-2 text-center">Cant.</div>
                <div className="col-span-5">Concepto</div>
                <div className="col-span-2 text-center">IVA %</div>
                <div className="col-span-2 text-right">Total Línea</div>
                <div className="col-span-1"></div>
              </div>

              <AnimatePresence>
                {editForm.items?.map((it: any, i: number) => (
                  <motion.div 
                    layout 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
                    key={`item-${i}`} 
                    className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 md:p-1.5 rounded-xl border border-slate-100 group"
                  >
                    <div className="col-span-3 md:col-span-2 flex items-center gap-1">
                      <input type="number" step="0.01" value={it.q} onChange={e => handleItemChange(i, 'q', Number(e.target.value)||0)} className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold text-center outline-none focus:border-indigo-500 text-xs shadow-sm" />
                      <span className="text-slate-400 font-bold text-xs md:hidden">x</span>
                    </div>
                    
                    <div className="col-span-9 md:col-span-5">
                      <input type="text" placeholder="Producto..." value={it.n} onChange={e => handleItemChange(i, 'n', e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold outline-none focus:border-indigo-500 text-xs shadow-sm" />
                    </div>

                    <div className="col-span-4 md:col-span-2 mt-2 md:mt-0">
                      <select value={it.rate || 10} onChange={e => handleItemChange(i, 'rate', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold text-center outline-none focus:border-indigo-500 text-xs shadow-sm cursor-pointer text-slate-600">
                        <option value={0}>0%</option>
                        <option value={4}>4%</option>
                        <option value={10}>10%</option>
                        <option value={21}>21%</option>
                      </select>
                    </div>

                    <div className="col-span-6 md:col-span-2 mt-2 md:mt-0 relative">
                      <input type="number" step="0.01" value={it.t} onChange={e => handleItemChange(i, 't', Number(e.target.value)||0)} className="w-full bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg p-2 font-black text-right outline-none focus:border-indigo-500 text-sm shadow-sm" />
                      <span className="absolute right-8 top-1/2 -translate-y-1/2 text-xs font-black text-indigo-300 pointer-events-none hidden md:block">€</span>
                    </div>

                    <div className="col-span-2 md:col-span-1 flex justify-end mt-2 md:mt-0">
                      <button type="button" onClick={() => deleteItemFromEdit(i)} className="text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition p-2 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              <button type="button" onClick={handleAddLine} className="w-full py-3 mt-2 text-xs font-black text-slate-500 hover:text-indigo-600 bg-white border-2 border-dashed border-slate-200 hover:border-indigo-200 rounded-xl flex items-center justify-center gap-2 transition-colors">
                <Plus className="w-4 h-4"/> Añadir Línea Manual
              </button>

              <div className="mt-6 pt-4 border-t border-slate-200 flex justify-between md:justify-end items-center text-xs font-bold px-2 gap-8">
                <div className="text-slate-500 flex flex-col items-end">
                  <span className="text-[9px] uppercase tracking-widest">Base Imponible</span>
                  <span>{Num.fmt(editForm.base || 0)}</span>
                </div>
                <div className="text-slate-500 flex flex-col items-end">
                  <span className="text-[9px] uppercase tracking-widest">Impuestos (IVA)</span>
                  <span>{Num.fmt(editForm.taxes || 0)}</span>
                </div>
              </div>
            </div>
          </div>

        </div>
        
        {/* 📌 FOOTER FIJO DE TOTALES Y ACCIONES */}
        <div className="bg-slate-900 shrink-0 relative z-20 pb-safe">
          <div className="p-5 md:p-6 flex justify-between items-center">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Albarán</p>
              <div className="flex items-center gap-3">
                <p className="text-3xl md:text-4xl font-black text-emerald-400 tracking-tighter">{Num.fmt(editForm.total || 0)}</p>
                {editForm.total === 0 && <AlertCircle className="w-5 h-5 text-rose-500 animate-pulse" title="El total es cero" />}
              </div>
            </div>
            
            <div className="flex flex-col items-end gap-3">
              <label className="flex items-center gap-2 cursor-pointer bg-slate-800 px-4 py-2.5 rounded-xl transition hover:bg-slate-700 border border-slate-700">
                <input type="checkbox" checked={editForm.paid} onChange={e => setEditForm(prev => prev ? {...prev, paid: e.target.checked} : null)} className="w-5 h-5 accent-emerald-500 rounded bg-slate-900 border-slate-600" />
                <span className="text-xs font-black uppercase tracking-wider text-white">MARCAR PAGADO</span>
              </label>
              
              <button type="button" onClick={() => onDelete(editForm.id)} className="flex items-center gap-1 text-[10px] font-black text-rose-400 uppercase hover:text-rose-300 transition">
                <Trash2 className="w-3 h-3" /> Borrar Documento
              </button>
            </div>
          </div>
        </div>

      </motion.div>
    </div>
  );
};
