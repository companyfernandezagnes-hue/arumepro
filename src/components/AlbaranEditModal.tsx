import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Save, Trash2, X, Plus, Mic, Package, AlertCircle, Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

interface AlbaranEditModalProps {
  editForm: Albaran;
  sociosReales: any[];
  setEditForm: React.Dispatch<React.SetStateAction<Albaran | null>>;
  onClose: () => void;
  onSave: (e?: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  recordingMode?: 'new' | 'edit' | null;
  startVoiceRecording?: (mode: 'new' | 'edit') => void;
}

/* =======================================================
 * 🧠 MOTOR DE APRENDIZAJE DE IVA (AI LEARNING)
 * ======================================================= */
const GLOBAL_VAT_CATALOG = {
  alcohol: [/CERVEZA/i, /VINO/i, /CAVA/i, /CHAMP/i, /WHISKY/i, /WHISKEY/i, /RON/i, /GINEBRA/i, /GIN/i, /LICOR/i, /VERMUT/i, /ALCOHOL/i],
  softSugared: [/REFRESC/i, /COLA/i, /TÓNICA/i, /TONICA/i, /NARANJA/i, /LIMON/i, /ENERG/i, /ZUMO\s*(?:AZUC|EDULC)/i],
  packaging: [/ENVASE/i, /ENVAS/i, /EMBALA/i, /PACK/i, /BANDEJA/i, /CAJA/i, /BOLSA/i, /TAPA/i, /VASO/i]
};

// Intenta predecir el IVA en base al nombre (Heurística legal AEAT)
const predictVat = (name: string, learnedMemory: Record<string, number>, defaultVat = 10) => {
  const normName = (name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  
  // 1. Si el usuario ya nos ha enseñado este IVA, manda la memoria
  if (learnedMemory[normName] !== undefined) {
    return { expected: learnedMemory[normName], reason: 'Memoria (Lo cambiaste tú antes)' };
  }

  // 2. Si no, tiramos del catálogo global de la AEAT (Alcohol y Azucarados al 21%)
  const hit = (arr: RegExp[]) => arr.some(rx => rx.test(name));
  
  if (hit(GLOBAL_VAT_CATALOG.alcohol)) return { expected: 21, reason: 'Catálogo (Alcohol -> 21%)' };
  if (hit(GLOBAL_VAT_CATALOG.softSugared)) return { expected: 21, reason: 'Catálogo (Refrescos Azucarados -> 21%)' };
  if (hit(GLOBAL_VAT_CATALOG.packaging)) return { expected: 21, reason: 'Catálogo (Envases -> 21%)' };

  // 3. Fallback por defecto (Hostelería = 10%)
  return { expected: defaultVat, reason: 'IVA General Hostelería' };
};


/* =======================================================
 * 📦 COMPONENTE PRINCIPAL
 * ======================================================= */
export const AlbaranEditModal = ({ 
  editForm, sociosReales, setEditForm, onClose, onSave, onDelete, recordingMode, startVoiceRecording 
}: AlbaranEditModalProps) => {

  // 🛡️ PROTECCIÓN CRÍTICA: Si el formulario es null, no renderizamos nada para evitar el crash
  if (!editForm) return null;

  const [saving, setSaving] = useState(false);
  const undoRef = useRef<any[]>([]); // Memoria de Deshacer
  
  // Simulación de "Memoria Persistida" (En producción debería ir al onSave o LocalStorage)
  const [learnedVatRules, setLearnedVatRules] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('arume_vat_rules') || '{}'); } catch { return {}; }
  });

  // Guardar en la "pila" de deshacer antes de cada gran cambio
  const pushUndo = (state: any) => {
    undoRef.current = [JSON.parse(JSON.stringify(state)), ...undoRef.current].slice(0, 10);
  };
  
  const handleUndo = () => {
    const lastState = undoRef.current.shift();
    if (lastState) setEditForm(lastState);
  };

  /* =======================================================
   * 🧮 FUNCIONES MATEMÁTICAS ESTRICTAS (Anti-Crash)
   * ======================================================= */
  const clampNum = (n: any, min = 0, max = Number.POSITIVE_INFINITY) => 
    Number.isFinite(Number(n)) ? Math.min(Math.max(Number(n), min), max) : 0;

  const recalcLine = (raw: any) => {
    const rate = clampNum(raw.rate ?? 10, 0, 21);
    const q    = clampNum(raw.q    ?? 1, 0.0001);
    const t    = clampNum(raw.t    ?? (raw.unitPrice ? raw.unitPrice * q : 0), 0);
    
    const base = Num.round2(t / (1 + rate / 100));
    const tax  = Num.round2(t - base);
    const unitPrice = Num.round2(t / q);
    
    return { ...raw, rate, q, t: Num.round2(t), base, tax, unitPrice };
  };

  const recalcTotals = (items: any[]) => {
    const globalTotal = items.reduce((acc, it) => acc + Num.parse(it.t), 0);
    const globalBase  = items.reduce((acc, it) => acc + Num.parse(it.base), 0);
    const globalTax   = items.reduce((acc, it) => acc + Num.parse(it.tax), 0);
    return {
      total: Num.round2(globalTotal),
      base : Num.round2(globalBase),
      taxes: Num.round2(globalTax)
    };
  };

  const handleItemChange = useCallback((index: number, field: string, value: any) => {
    setEditForm(prev => {
      if (!prev || !prev.items) return prev;
      
      // Guardamos para Undo si el cambio es sustancial
      if (['rate', 'u'].includes(field)) pushUndo(prev);

      const items = [...prev.items];
      const raw = { ...items[index] };

      if (field === 'q')         raw.q = value;
      else if (field === 't')    raw.t = value;
      else if (field === 'rate') raw.rate = value;
      else if (field === 'n')    raw.n = String(value || '');
      else if (field === 'u')    raw.u = value; 
      else if (field === 'unitPrice') raw.unitPrice = value;

      items[index] = recalcLine(raw);
      const totals = recalcTotals(items);
      return { ...prev, items, ...totals };
    });
  }, [setEditForm]);

  const handleAddLine = () => {
    setEditForm(prev => {
      if (!prev) return prev;
      pushUndo(prev);
      const newItems = [...(prev.items || []), { q: 1, n: '', t: 0, rate: 10, base: 0, tax: 0, unitPrice: 0, u: 'uds' }];
      return { ...prev, items: newItems };
    });
  };

  const deleteItemFromEdit = (index: number) => {
    setEditForm(prev => {
      if (!prev || !prev.items) return prev;
      pushUndo(prev);
      const newItems = [...prev.items];
      newItems.splice(index, 1);
      const totals = recalcTotals(newItems);
      return { ...prev, items: newItems, ...totals };
    });
  };
  
  const vaciarItems = () => {
    setEditForm(prev => {
      if (!prev) return prev;
      pushUndo(prev);
      return { ...prev, items: [], total: 0, base: 0, taxes: 0 };
    });
  };

  // 🚀 Aprender IVA Manualmente
  const handleLearnVat = (index: number, name: string, rate: number) => {
    const normName = (name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    if (!normName) return;
    
    const newRules = { ...learnedVatRules, [normName]: rate };
    setLearnedVatRules(newRules);
    localStorage.setItem('arume_vat_rules', JSON.stringify(newRules)); 
    
    handleItemChange(index, 'rate', rate);
  };

  /* =======================================================
   * ⌨️ ATAJOS DE TECLADO (UX Pro)
   * ======================================================= */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (recordingMode) return; 
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') { 
        e.preventDefault(); 
        onSaveClick(e as any); 
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        const active = document.activeElement as HTMLElement | null;
        const idx = Number(active?.getAttribute('data-idx') ?? -1);
        if (idx >= 0) {
          e.preventDefault();
          setEditForm(prev => {
            if(!prev) return prev;
            pushUndo(prev);
            const items = [...(prev.items||[])];
            const clone = { ...items[idx] };
            items.splice(idx+1, 0, clone);
            const totals = recalcTotals(items);
            return { ...prev, items, ...totals };
          });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recordingMode, onClose, onSave, setEditForm]);

  const onSaveClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (recordingMode || saving) return;
    setSaving(true);
    try { await onSave(e); } finally { setSaving(false); }
  };

  const isRecordingState = recordingMode === 'edit';
  const safeSociosReales = Array.isArray(sociosReales) ? sociosReales : []; // 🛡️ Protección de Array

  return (
    <div className="fixed inset-0 z-[200] flex justify-center items-start pt-4 md:items-center md:pt-0 p-0 md:p-4">
      {/* Fondo oscuro y click to close */}
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={() => !recordingMode && onClose()} 
        className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" 
      />
      
      {/* 🛡️ FIX FRAMER: Quitado el objeto en 'initial' que rompía React */}
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="bg-[#F8FAFC] w-full max-w-4xl rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col h-[90dvh] md:max-h-[85vh] overflow-hidden"
      >
        {/* 🚀 CABECERA FIJA */}
        <div className="p-5 md:p-6 border-b border-slate-200 bg-white flex justify-between items-center sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full hidden md:flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-black text-slate-800 leading-none">Editar Albarán</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Ref: <span className="text-indigo-500">{editForm.num || 'S/N'}</span></p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button type="button" disabled={recordingMode !== null || saving} onClick={onClose} className="p-2 md:px-4 bg-slate-50 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-100 transition border border-slate-200 disabled:opacity-50">
              <span className="hidden md:inline">Cancelar</span>
              <X className="w-5 h-5 md:hidden" />
            </button>
            <button type="button" disabled={recordingMode !== null || saving} onClick={onSaveClick} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-xs hover:bg-indigo-700 transition flex items-center gap-2 shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50">
              <Save className="w-4 h-4" />
              <span>{saving ? 'Guardando...' : 'Guardar'}</span>
            </button>
          </div>
        </div>
        
        {/* 📜 ÁREA DE SCROLL */}
        <div className="flex-1 overflow-y-auto p-5 md:p-6 custom-scrollbar space-y-6 relative">
          
          {/* BANNER GRABACIÓN */}
          <AnimatePresence>
            {isRecordingState && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-rose-500 text-white p-4 rounded-2xl flex items-center gap-3 shadow-lg shadow-rose-500/20 overflow-hidden">
                <div className="w-3 h-3 bg-white rounded-full animate-pulse shrink-0" />
                <div>
                  <p className="text-xs font-black uppercase tracking-widest">Escuchando cambios...</p>
                  <p className="text-[10px] opacity-80">Ej: "Añade 2 kilos de tomates a 15 euros"</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* DATOS CABECERA */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Proveedor</p>
              <input value={editForm.prov || ''} onChange={e => setEditForm(prev => prev ? {...prev, prov: e.target.value} : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition" />
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Fecha</p>
              <input type="date" value={editForm.date || ''} onChange={e => setEditForm(prev => prev ? {...prev, date: e.target.value} : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition" />
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1.5">Responsable Pago</p>
              <select value={editForm.socio || "Arume"} onChange={(e) => setEditForm(prev => prev ? { ...prev, socio: e.target.value } : null)} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition cursor-pointer">
                <option value="Arume">Arume (Empresa)</option>
                {safeSociosReales.map((s: any) => <option key={s.id || s.n} value={s.n}>{s.n}</option>)}
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

          {/* LÍNEAS DEL ALBARÁN */}
          <div className="space-y-3">
            <div className="flex justify-between items-end px-1">
              <div>
                <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Desglose de Líneas</p>
                <p className="text-[9px] text-slate-400 font-bold mt-0.5">Calculadora IVA automática</p>
              </div>
              <div className="flex gap-2">
                {undoRef.current.length > 0 && (
                  <button type="button" onClick={handleUndo} className="bg-white border border-slate-200 text-slate-500 px-3 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-slate-50 transition shadow-sm">Deshacer</button>
                )}
                <button type="button" onClick={vaciarItems} className="bg-white border border-rose-200 text-rose-500 px-3 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-rose-50 transition shadow-sm">Vaciar</button>
                {startVoiceRecording && (
                  <button type="button" onClick={() => startVoiceRecording('edit')} className={cn("px-3 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 transition shadow-sm", isRecordingState ? "bg-rose-500 text-white animate-pulse" : "bg-slate-900 text-white hover:bg-slate-800")}>
                    <Mic className="w-3 h-3" /> {isRecordingState ? "DICTANDO..." : "DICTAR CAMBIOS"}
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-[2rem] p-4 md:p-6 border border-slate-200 shadow-sm space-y-3 overflow-hidden">
              
              {/* CABECERA TABLA DESKTOP */}
              <div className="hidden md:grid grid-cols-12 gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-2">
                <div className="col-span-2 text-center">Cant. / Unid.</div>
                <div className="col-span-4">Concepto</div>
                <div className="col-span-2 text-center">IVA %</div>
                <div className="col-span-2 text-right">Unitario Bruto</div>
                <div className="col-span-1 text-right">Total Línea</div>
                <div className="col-span-1 text-right"></div>
              </div>

              <AnimatePresence>
                {(editForm.items || []).map((it: any, i: number) => {
                  
                  // 🧠 IA AUDITORÍA: Validar si el IVA puesto coincide con lo que esperamos
                  const predicted = predictVat(it.n || '', learnedVatRules, 10);
                  const hasVatMismatch = it.rate !== predicted.expected && (it.n || '').trim() !== '' && it.t > 0;

                  return (
                    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} key={`item-${i}`} className="flex flex-col gap-2">
                      <div className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 md:p-1.5 rounded-xl border border-slate-100 group">
                        
                        {/* Cantidad + Unidad */}
                        <div className="col-span-4 md:col-span-2 flex items-center gap-1">
                          <input data-idx={i} type="number" step="0.01" inputMode="decimal" value={it.q ?? 0} onChange={e => handleItemChange(i, 'q', Number(e.target.value)||0)} onBlur={e => handleItemChange(i, 'q', Num.round2(e.currentTarget.value))} className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold text-center outline-none focus:border-indigo-500 text-xs shadow-sm" aria-label={`Cantidad línea ${i+1}`} />
                          <select value={it.u || 'uds'} onChange={e => handleItemChange(i, 'u', e.target.value)} className="bg-white border border-slate-200 rounded-lg p-2 text-xs font-bold text-slate-600 focus:border-indigo-500 outline-none cursor-pointer">
                            <option value="uds">uds</option><option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option>
                          </select>
                        </div>
                        
                        {/* Concepto */}
                        <div className="col-span-8 md:col-span-4">
                          <input data-idx={i} type="text" placeholder="Producto..." value={it.n || ''} onChange={e => handleItemChange(i, 'n', e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold outline-none focus:border-indigo-500 text-xs shadow-sm" aria-label={`Producto línea ${i+1}`} />
                        </div>

                        {/* % IVA */}
                        <div className="col-span-4 md:col-span-2 mt-2 md:mt-0">
                          <select data-idx={i} value={it.rate || 10} onChange={e => handleItemChange(i, 'rate', Number(e.target.value))} className={cn("w-full bg-white rounded-lg p-2 font-bold text-center outline-none text-xs shadow-sm cursor-pointer", hasVatMismatch ? "border-2 border-amber-400 text-amber-700" : "border border-slate-200 text-slate-600 focus:border-indigo-500")}>
                            <option value={0}>0%</option><option value={4}>4%</option><option value={10}>10%</option><option value={21}>21%</option>
                          </select>
                        </div>

                        {/* Precio Unitario */}
                        <div className="col-span-4 md:col-span-2 mt-2 md:mt-0">
                          <input data-idx={i} type="number" step="0.0001" inputMode="decimal" value={it.unitPrice ?? (it.q ? Num.round2((it.t || 0)/it.q) : 0)} onChange={e => handleItemChange(i, 'unitPrice', Number(e.target.value))} onBlur={e => handleItemChange(i, 'unitPrice', Num.round2(e.currentTarget.value))} className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold text-right outline-none focus:border-indigo-500 text-xs shadow-sm" placeholder="€/ud" />
                        </div>

                        {/* Total Línea */}
                        <div className="col-span-4 md:col-span-1 mt-2 md:mt-0 relative">
                          <input data-idx={i} type="number" step="0.01" inputMode="decimal" value={it.t ?? 0} onChange={e => handleItemChange(i, 't', Number(e.target.value)||0)} onBlur={e => handleItemChange(i, 't', Num.round2(e.currentTarget.value))} className="w-full bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg p-2 font-black text-right outline-none focus:border-indigo-500 text-xs shadow-sm" />
                        </div>

                        {/* Acciones */}
                        <div className="col-span-12 md:col-span-1 flex justify-end mt-2 md:mt-0 gap-1">
                          <button type="button" onClick={() => { pushUndo(editForm); const items = [...(editForm.items||[])]; items.splice(i+1, 0, {...items[i]}); setEditForm({...editForm, items, ...recalcTotals(items)}); }} className="text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition p-2 rounded-lg" title="Clonar línea (Ctrl+D)"><Plus className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => deleteItemFromEdit(i)} className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition p-2 rounded-lg" title="Eliminar línea"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>

                      {/* 🧠 ALERTAS IVA */}
                      {hasVatMismatch && (
                        <div className="ml-2 mr-2 mb-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[10px]">
                          <div className="flex items-center gap-2 text-amber-700 font-bold">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>IA sugiere aplicar <strong>{predicted.expected}% IVA</strong> ({predicted.reason}).</span>
                          </div>
                          <div className="flex gap-2 w-full sm:w-auto">
                            <button type="button" onClick={() => handleItemChange(i, 'rate', predicted.expected)} className="bg-white border border-amber-300 text-amber-700 px-3 py-1.5 rounded-lg font-black hover:bg-amber-100 transition shadow-sm flex-1 sm:flex-none">Aplicar Aquí</button>
                            <button type="button" onClick={() => handleLearnVat(i, it.n, it.rate)} className="bg-amber-600 text-white px-3 py-1.5 rounded-lg font-black hover:bg-amber-700 transition shadow-sm flex items-center justify-center gap-1 flex-1 sm:flex-none"><Bot className="w-3 h-3"/> Enseñar a la IA</button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
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
          <div className="p-5 md:p-6 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="w-full md:w-auto flex justify-between items-center md:block">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Documento</p>
              <p className="text-3xl md:text-4xl font-black text-emerald-400 tracking-tighter">{Num.fmt(editForm.total || 0)}</p>
            </div>
            
            <div className="flex w-full md:w-auto items-center justify-between md:justify-end gap-4">
              <label className="flex items-center gap-2 cursor-pointer bg-slate-800 px-4 py-3 rounded-xl transition hover:bg-slate-700 border border-slate-700">
                <input type="checkbox" checked={editForm.paid || false} onChange={e => setEditForm(prev => prev ? {...prev, paid: e.target.checked} : null)} className="w-5 h-5 accent-emerald-500 rounded bg-slate-900 border-slate-600" />
                <span className="text-xs font-black uppercase tracking-wider text-white">MARCAR PAGADO</span>
              </label>
              
              <button type="button" onClick={() => onDelete(editForm.id)} className="flex items-center justify-center w-12 h-12 bg-rose-500/10 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition" title="Borrar Documento">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

      </motion.div>
    </div>
  );
};
