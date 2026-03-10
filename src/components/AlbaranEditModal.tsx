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
  onSave: () => void;
  onDelete: (id: string) => void;
  recordingMode: any;
  startVoiceRecording: (mode: 'new' | 'edit') => void;
}

export const AlbaranEditModal = ({ editForm, sociosReales, setEditForm, onClose, onSave, onDelete, recordingMode, startVoiceRecording }: AlbaranEditModalProps) => {
  
  const handleItemChange = (index: number, field: string, value: any) => {
    if (!editForm.items) return;
    const newItems = [...editForm.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setEditForm({ ...editForm, items: newItems });
  };

  const handleAddLine = () => {
    const newItems = [...(editForm.items || []), { q: 1, n: '', t: 0, rate: 10, base: 0, tax: 0, unit: 0 }];
    setEditForm({ ...editForm, items: newItems });
  };

  const deleteItemFromEdit = (index: number) => {
    if (!editForm.items) return;
    const newItems = [...editForm.items]; newItems.splice(index, 1);
    setEditForm({ ...editForm, items: newItems });
  };
  
  const vaciarItems = () => setEditForm(f => f ? ({ ...f, items: [] }) : f);

  return (
    <div className="fixed inset-0 z-[200] flex justify-center items-start pt-10 md:items-center md:pt-0 p-4">
      <div onClick={() => !recordingMode && onClose()} className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm" />
      
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col max-h-[85vh] overflow-hidden animate-fade-in">
        
        <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-end bg-white relative z-20">
            <button disabled={recordingMode !== null} onClick={onClose} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500 text-2xl transition disabled:opacity-0"><X className="w-6 h-6" /></button>
          <div>
            <h3 className="text-2xl font-black text-slate-800 tracking-tighter">Editando Albarán</h3>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1">Ref: {editForm.num || 'S/N'}</p>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 md:p-8 pt-4 custom-scrollbar space-y-6">
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Proveedor</p>
              <input value={editForm.prov} onChange={e => setEditForm({...editForm, prov: e.target.value})} className="w-full bg-white border border-slate-200 rounded p-1 text-sm font-bold outline-none focus:border-indigo-500" />
            </div>
            
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Fecha</p>
              <input type="date" value={editForm.date} onChange={e => setEditForm({...editForm, date: e.target.value})} className="w-full bg-white border border-slate-200 rounded p-1 text-sm font-bold outline-none focus:border-indigo-500" />
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Pagado por (Socio)</p>
              <select 
                value={editForm.socio || "Arume"} 
                onChange={(e) => setEditForm({ ...editForm, socio: e.target.value })} 
                className="w-full bg-white border border-slate-200 rounded p-1 text-sm font-bold outline-none focus:border-indigo-500"
              >
                <option value="Arume">Arume (Empresa)</option>
                {sociosReales.map((s: any) => (
                  <option key={s.id} value={s.n}>{s.n}</option>
                ))}
              </select>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Unidad Negocio</p>
              <select value={editForm.unitId || "REST"} onChange={(e) => setEditForm({ ...editForm, unitId: e.target.value as BusinessUnit })} className="w-full bg-white border border-slate-200 rounded p-1 text-sm font-bold outline-none focus:border-indigo-500">
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
                <button onClick={vaciarItems} className="bg-rose-50 text-rose-600 px-2 py-1.5 rounded-lg text-[9px] font-black uppercase hover:bg-rose-100 transition shadow-sm">Vaciar</button>
                <button onClick={() => startVoiceRecording('edit')} className="bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 hover:bg-indigo-200 transition shadow-sm">
                  <Mic className="w-3 h-3" /> Dictar Cambios
                </button>
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2">
              {editForm.items?.map((it: any, i: number) => (
                <div key={i} className="flex justify-between items-center text-xs border-b border-slate-200 last:border-0 pb-2 last:pb-0 pt-2 first:pt-0 group gap-2">
                  <input type="number" value={it.q} onChange={e => handleItemChange(i, 'q', Number(e.target.value)||0)} className="w-12 bg-white border border-slate-200 rounded p-1 font-bold text-center outline-none focus:border-indigo-500" />
                  <span className="text-slate-400 font-bold">x</span>
                  <input type="text" value={it.n} onChange={e => handleItemChange(i, 'n', e.target.value)} className="flex-1 bg-white border border-slate-200 rounded p-1 font-bold outline-none focus:border-indigo-500" />
                  <input type="number" value={it.t} onChange={e => handleItemChange(i, 't', Number(e.target.value)||0)} className="w-16 bg-white border border-slate-200 rounded p-1 font-black text-right outline-none focus:border-indigo-500" />
                  <button onClick={() => deleteItemFromEdit(i)} className="text-slate-300 hover:text-rose-500 transition ml-1"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              
              <button onClick={handleAddLine} className="mt-2 text-[10px] font-bold text-indigo-500 hover:text-indigo-700 flex items-center gap-1"><Plus className="w-3 h-3"/> Añadir línea manual</button>

              <div className="mt-4 pt-2 border-t border-slate-300 border-dashed flex justify-between text-[10px] text-slate-500 font-bold">
                <span>Base: {Num.fmt(editForm.base || 0)}</span>
                <span>IVA: {Num.fmt(editForm.taxes || 0)}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl">
            <div><p className="text-[10px] font-black text-slate-400 uppercase">Total Importe</p><p className="text-3xl font-black text-emerald-400">{Num.fmt(editForm.total)}</p></div>
            <div className="text-right">
              <label className="flex items-center gap-2 cursor-pointer bg-slate-800 p-2 rounded-xl">
                <input type="checkbox" checked={editForm.paid} onChange={e => setEditForm({...editForm, paid: e.target.checked})} className="w-4 h-4 accent-emerald-500" /><span className="text-[10px] font-bold">PAGADO</span>
              </label>
            </div>
          </div>
        </div>

        {/* BOTONES STICKY */}
        <div className="p-6 md:p-8 pt-4 pb-6 bg-white border-t border-slate-100 flex gap-3 relative z-20 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)]">
          <button onClick={() => onDelete(editForm.id)} className="w-12 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center hover:bg-rose-100 transition"><Trash2 className="w-4 h-4" /></button>
          <button onClick={onClose} className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-black text-xs hover:bg-slate-200 transition">CANCELAR</button>
          <button onClick={onSave} className="flex-[2] bg-indigo-600 text-white py-4 rounded-2xl font-black text-xs hover:bg-indigo-700 transition flex justify-center items-center gap-2 shadow-lg"><Save className="w-4 h-4" /> GUARDAR CAMBIOS</button>
        </div>
      </div>
    </div>
  );
};
