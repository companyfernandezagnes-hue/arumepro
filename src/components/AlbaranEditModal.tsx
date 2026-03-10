import React from 'react';
import { Save, Trash2, X, Plus, Mic } from 'lucide-react';
import { Albaran } from '../types';
import { Num } from '../services/engine';
import { BusinessUnit } from '../views/AlbaranesView';

interface AlbaranEditModalProps {
  editForm: Albaran;
  sociosReales: any[];
  setEditForm: React.Dispatch<React.SetStateAction<Albaran | null>>;
  onClose: () => void;
  onSave: (e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  recordingMode: any;
  startVoiceRecording: (mode: 'new' | 'edit') => void;
}

export const AlbaranEditModal = ({ editForm, sociosReales, setEditForm, onClose, onSave, onDelete, recordingMode, startVoiceRecording }: AlbaranEditModalProps) => {
  
  const handleItemChange = (index: number, field: string, value: any) => {
    setEditForm(prev => {
      if (!prev || !prev.items) return prev;
      const newItems = [...prev.items];
      newItems[index] = { ...newItems[index], [field]: value };
      return { ...prev, items: newItems };
    });
  };

  const handleAddLine = () => {
    setEditForm(prev => {
      if (!prev) return prev;
      const newItems = [...(prev.items || []), { q: 1, n: '', t: 0, rate: 10, base: 0, tax: 0, unit: 0 }];
      return { ...prev, items: newItems };
    });
  };

  const deleteItemFromEdit = (index: number) => {
    setEditForm(prev => {
      if (!prev || !prev.items) return prev;
      const newItems = [...prev.items];
      newItems.splice(index, 1);
      return { ...prev, items: newItems };
    });
  };
  
  const vaciarItems = () => setEditForm(prev => prev ? ({ ...prev, items: [] }) : prev);

  return (
    <div className="fixed inset-0 z-[200] flex justify-center items-start pt-4 md:items-center md:pt-0 p-2 md:p-4">
      {/* Fondo oscuro para cerrar si haces clic fuera */}
      <div onClick={() => !recordingMode && onClose()} className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm" />
      
      <div className="bg-white w-full max-w-2xl rounded-[2rem] shadow-2xl relative z-10 flex flex-col max-h-[90vh] overflow-hidden animate-fade-in">
        
        {/* 🚀 CABECERA FIJA CON LOS BOTONES ARRIBA (A prueba de fallos) */}
        <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-30 shadow-sm shrink-0">
          <div>
            <h3 className="text-lg md:text-2xl font-black text-slate-800 leading-tight">Editar Albarán</h3>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Ref: {editForm.num || 'S/N'}</p>
          </div>
          
          <div className="flex items-center gap-2">
            <button type="button" disabled={recordingMode !== null} onClick={onClose} className="p-2 md:px-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-200 transition">
              <span className="hidden md:inline">Cancelar</span>
              <X className="w-4 h-4 md:hidden" />
            </button>
            <button type="button" disabled={recordingMode !== null} onClick={onSave} className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-xs hover:bg-indigo-700 transition flex items-center gap-2 shadow-md active:scale-95">
              <Save className="w-4 h-4" />
              <span>Guardar</span>
            </button>
          </div>
        </div>
        
        {/* 📜 ÁREA DE SCROLL PARA TODO LO DEMÁS */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar space-y-6 bg-slate-50/30">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Proveedor</p>
              <input value={editForm.prov} onChange={e => setEditForm(prev => prev ? {...prev, prov: e.target.value} : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2 text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white transition" />
            </div>
            
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Fecha</p>
              <input type="date" value={editForm.date} onChange={e => setEditForm(prev => prev ? {...prev, date: e.target.value} : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2 text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white transition" />
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Pagado por (Socio)</p>
              <select 
                value={editForm.socio || "Arume"} 
                onChange={(e) => setEditForm(prev => prev ? { ...prev, socio: e.target.value } : null)} 
                className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2 text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white transition"
              >
                <option value="Arume">Arume (Empresa)</option>
                {sociosReales.map((s: any) => (
                  <option key={s.id || s.n} value={s.n}>{s.n}</option>
                ))}
              </select>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Unidad Negocio</p>
              <select value={editForm.unitId || "REST"} onChange={(e) => setEditForm(prev => prev ? { ...prev, unitId: e.target.value as BusinessUnit } : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2 text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white transition">
                <option value="REST">Restaurante</option>
                <option value="DLV">Catering Hoteles</option>
                <option value="SHOP">Tienda Sake</option>
                <option value="CORP">Socios / Corp</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center ml-2">
              <p className="text-[9px] font-black text-slate-400 uppercase">Desglose de productos</p>
              <div className="flex gap-2">
                <button type="button" onClick={vaciarItems} className="bg-rose-50 text-rose-600 px-3 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-rose-100 transition shadow-sm">Vaciar</button>
                <button type="button" onClick={() => startVoiceRecording('edit')} className="bg-indigo-100 text-indigo-700 px-3 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 hover:bg-indigo-200 transition shadow-sm">
                  <Mic className="w-3 h-3" /> Dictar Cambios
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-2">
              {editForm.items?.map((it: any, i: number) => (
                <div key={i} className="flex justify-between items-center text-xs border-b border-slate-100 last:border-0 pb-2 last:pb-0 pt-2 first:pt-0 group gap-2">
                  <input type="number" value={it.q} onChange={e => handleItemChange(i, 'q', Number(e.target.value)||0)} className="w-12 bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-center outline-none focus:border-indigo-500" />
                  <span className="text-slate-400 font-bold">x</span>
                  <input type="text" value={it.n} onChange={e => handleItemChange(i, 'n', e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold outline-none focus:border-indigo-500" />
                  <input type="number" value={it.t} onChange={e => handleItemChange(i, 't', Number(e.target.value)||0)} className="w-20 bg-slate-50 border border-slate-200 rounded-lg p-2 font-black text-right outline-none focus:border-indigo-500" />
                  <button type="button" onClick={() => deleteItemFromEdit(i)} className="text-slate-300 hover:text-rose-500 transition ml-1 p-2 bg-slate-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              
              <button type="button" onClick={handleAddLine} className="mt-2 text-[10px] font-bold text-indigo-500 hover:text-indigo-700 flex items-center gap-1 p-2 bg-indigo-50 rounded-lg"><Plus className="w-3 h-3"/> Añadir línea manual</button>

              <div className="mt-4 pt-3 border-t border-slate-200 border-dashed flex justify-between text-xs text-slate-500 font-bold px-2">
                <span>Base: {Num.fmt(editForm.base || 0)}</span>
                <span>IVA: {Num.fmt(editForm.taxes || 0)}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl mt-4">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Total Importe</p>
              <p className="text-3xl font-black text-emerald-400">{Num.fmt(editForm.total)}</p>
            </div>
            <div className="text-right">
              <label className="flex items-center gap-2 cursor-pointer bg-slate-800 px-4 py-3 rounded-xl transition hover:bg-slate-700">
                <input type="checkbox" checked={editForm.paid} onChange={e => setEditForm(prev => prev ? {...prev, paid: e.target.checked} : null)} className="w-5 h-5 accent-emerald-500 rounded" />
                <span className="text-xs font-black uppercase tracking-wider">PAGADO</span>
              </label>
            </div>
          </div>

          {/* Botón de eliminar al final del scroll */}
          <div className="pt-6 pb-2">
            <button type="button" onClick={() => onDelete(editForm.id)} className="w-full flex items-center justify-center gap-2 bg-rose-50 text-rose-600 py-4 rounded-2xl font-black text-xs hover:bg-rose-100 transition border border-rose-100">
              <Trash2 className="w-4 h-4" /> ELIMINAR ESTE ALBARÁN
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
