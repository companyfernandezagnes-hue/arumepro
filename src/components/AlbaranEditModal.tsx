import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Save, Trash2, X, Plus, Mic, Package, AlertCircle, Bot, Wand2, MinusCircle, Calculator, Undo2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
 * MOTOR DE APRENDIZAJE DE IVA
 * ======================================================= */
const GLOBAL_VAT_CATALOG = {
  alcohol:     [/CERVEZA/i, /VINO/i, /CAVA/i, /CHAMP/i, /WHISKY/i, /WHISKEY/i, /RON/i, /GINEBRA/i, /GIN/i, /LICOR/i, /VERMUT/i, /ALCOHOL/i],
  softSugared: [/REFRESC/i, /COLA/i, /TÓNICA/i, /TONICA/i, /NARANJA/i, /LIMON/i, /ENERG/i, /ZUMO\s*(?:AZUC|EDULC)/i],
  packaging:   [/ENVASE/i, /ENVAS/i, /EMBALA/i, /PACK/i, /BANDEJA/i, /CAJA/i, /BOLSA/i, /TAPA/i, /VASO/i],
};

const predictVat = (name: string, learnedMemory: Record<string, number>, defaultVat = 10) => {
  const normName = (name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (learnedMemory[normName] !== undefined) return { expected: learnedMemory[normName], reason: 'Memoria (Lo cambiaste tú antes)' };
  const hit = (arr: RegExp[]) => arr.some(rx => rx.test(name));
  if (hit(GLOBAL_VAT_CATALOG.alcohol))     return { expected: 21, reason: 'Catálogo (Alcohol → 21%)' };
  if (hit(GLOBAL_VAT_CATALOG.softSugared)) return { expected: 21, reason: 'Catálogo (Refrescos azucarados → 21%)' };
  if (hit(GLOBAL_VAT_CATALOG.packaging))   return { expected: 21, reason: 'Catálogo (Envases → 21%)' };
  return { expected: defaultVat, reason: 'IVA General Hostelería' };
};

/* =======================================================
 * RECALCULADOR DE TOTALES
 * 🆕 FIX: maneja líneas negativas (descuentos) correctamente
 * ======================================================= */
const recalcTotalsSafe = (items: any[]) => {
  const safeItems = Array.isArray(items) ? items : [];

  const getLineTotal = (it: any) => {
    const rawTotal = Num.parse(it.total ?? it.t ?? 0);
    // 🆕 FIX: !== 0 en vez de > 0 — así los descuentos negativos no se ignoran
    if (rawTotal !== 0) return rawTotal;
    const basePlusTax = Num.parse(it.base ?? 0) + Num.parse(it.tax ?? 0);
    if (basePlusTax !== 0) return basePlusTax;
    return Num.parse(it.q ?? 1) * Num.parse(it.unitPrice ?? it.unit_price ?? 0);
  };

  const globalTotal = safeItems.reduce((acc, it) => acc + getLineTotal(it), 0);
  const globalBase  = safeItems.reduce((acc, it) => acc + (Num.parse(it.base) || 0), 0);
  const globalTax   = safeItems.reduce((acc, it) => acc + (Num.parse(it.tax)  || 0), 0);

  return {
    total: Num.round2(globalTotal),
    base:  Num.round2(globalBase),
    taxes: Num.round2(globalTax),
  };
};

/* =======================================================
 * HELPER: recalcula base/tax de una línea a partir de su total
 * ======================================================= */
const recalcLineTax = (it: any): any => {
  const rate = it.rate || 10;
  const base = Num.round2(it.t / (1 + rate / 100));
  const tax  = Num.round2(it.t - base);
  return { ...it, base, tax };
};

/* =======================================================
 * COMPONENTE PRINCIPAL
 * ======================================================= */
export const AlbaranEditModal = ({
  editForm, sociosReales, setEditForm, onClose, onSave, onDelete, recordingMode, startVoiceRecording,
}: AlbaranEditModalProps) => {

  if (!editForm) return null;

  const [saving,          setSaving]          = useState(false);
  const [highlightedIdx,  setHighlightedIdx]  = useState<number | null>(null); // 🆕 para animar cambio de IVA
  const undoRef = useRef<any[]>([]);

  const [learnedVatRules, setLearnedVatRules] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('arume_vat_rules') || '{}'); } catch { return {}; }
  });

  // ── Efecto sanador al abrir ─────────────────────────────────────────────
  useEffect(() => {
    if (!editForm || !Array.isArray(editForm.items)) return;

    const normItems = editForm.items.map((it: any) => {
      const q         = Num.parse(it.q ?? 1);
      const unitPrice = Num.round2(Num.parse(it.unitPrice ?? it.unit_price ?? 0));
      const t_in      = Num.parse(it.total ?? it.t ?? (q > 0 ? q * unitPrice : 0));
      const rate      = Number(it.rate ?? 10);
      const base      = Num.round2(t_in / (1 + rate / 100));
      const tax       = Num.round2(t_in - base);
      return { ...it, q, n: String(it.n || 'Articulo'), u: String(it.u || 'uds'), rate, unitPrice, t: Num.round2(t_in), total: Num.round2(t_in), base, tax };
    });

    const totals = recalcTotalsSafe(normItems);
    setEditForm(prev => prev ? ({
      ...prev,
      items: normItems,
      total: String(Num.round2(Num.parse(prev.total || String(totals.total)))),
      base:  String(Num.round2(Num.parse(prev.base  || String(totals.base)))),
      taxes: String(Num.round2(Num.parse(prev.taxes || (prev as any).iva || String(totals.taxes)))),
    }) : prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushUndo = (state: any) => {
    undoRef.current = [JSON.parse(JSON.stringify(state)), ...undoRef.current].slice(0, 10);
  };

  const handleUndo = () => {
    const last = undoRef.current.shift();
    if (last) setEditForm(last);
  };

  /* =======================================================
   * CALCULADORA DE LÍNEAS
   * 🆕 FIX CRÍTICO: cambiar IVA ahora recalcula el total
   * ======================================================= */
  const handleItemChange = useCallback((index: number, field: string, value: any) => {
    setEditForm(prev => {
      if (!prev || !prev.items) return prev;
      if (['rate', 'u', 'n'].includes(field)) pushUndo(prev);

      const items = [...prev.items];
      let it = { ...items[index] };

      if (field === 'q') {
        it.q    = Num.parse(value);
        it.t    = Num.round2(it.q * (Num.parse(it.unitPrice) || 0));
        it.total = it.t;
      }
      else if (field === 'unitPrice') {
        it.unitPrice = Num.parse(value);
        it.t    = Num.round2((Num.parse(it.q) || 1) * it.unitPrice);
        it.total = it.t;
      }
      else if (field === 't' || field === 'total') {
        it.t    = Num.parse(value);
        it.total = it.t;
        // Cuando el usuario edita el total, actualizamos también unitPrice
        if (Num.parse(it.q) > 0) it.unitPrice = Num.round2(it.t / Num.parse(it.q));
      }
      else if (field === 'rate') {
        // 🆕 FIX CRÍTICO: recalcular total a partir de unitPrice × qty con el NUEVO rate
        // unitPrice es la base unitaria (sin IVA) → total = base × (1 + rate/100)
        it.rate = Number(value) as 0 | 4 | 10 | 21;
        const baseLinea = Num.round2((Num.parse(it.q) || 1) * (Num.parse(it.unitPrice) || 0));
        it.t    = Num.round2(baseLinea * (1 + it.rate / 100));
        it.total = it.t;
        // Animar visualmente la celda que cambió
        setHighlightedIdx(index);
        setTimeout(() => setHighlightedIdx(null), 800);
      }
      else if (field === 'n') it.n = String(value || '');
      else if (field === 'u') it.u = value;

      // Recalcular base/tax de la línea con el total actualizado
      it = recalcLineTax(it);

      items[index] = it;
      const totals = recalcTotalsSafe(items);
      return { ...prev, items, total: String(totals.total), base: String(totals.base), taxes: String(totals.taxes) };
    });
  }, [setEditForm]);

  const handleAddLine = () => {
    setEditForm(prev => {
      if (!prev) return prev;
      pushUndo(prev);
      return { ...prev, items: [...(prev.items || []), { q: 1, n: '', u: 'uds', unitPrice: 0, t: 0, total: 0, rate: 10, base: 0, tax: 0 }] };
    });
  };

  const deleteItemFromEdit = (index: number) => {
    setEditForm(prev => {
      if (!prev || !prev.items) return prev;
      pushUndo(prev);
      const newItems = [...prev.items];
      newItems.splice(index, 1);
      const totals = recalcTotalsSafe(newItems);
      return { ...prev, items: newItems, total: String(totals.total), base: String(totals.base), taxes: String(totals.taxes) };
    });
  };

  const vaciarItems = () => {
    setEditForm(prev => {
      if (!prev) return prev;
      pushUndo(prev);
      return { ...prev, items: [], total: '0', base: '0', taxes: '0' };
    });
  };

  const handleLearnVat = (index: number, name: string, rate: number) => {
    const normName = (name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!normName) return;
    const newRules = { ...learnedVatRules, [normName]: rate };
    setLearnedVatRules(newRules);
    localStorage.setItem('arume_vat_rules', JSON.stringify(newRules));
    handleItemChange(index, 'rate', rate);
  };

  // ── forceSyncTotal ──────────────────────────────────────────────────────
  // 🆕 FIX: recalcula también base/tax de cada línea antes de sincronizar
  const forceSyncTotal = () => {
    const fixedItems = (editForm.items || []).map(recalcLineTax);
    const totals = recalcTotalsSafe(fixedItems);
    setEditForm({ ...editForm, items: fixedItems, total: String(totals.total), base: String(totals.base), taxes: String(totals.taxes) });
  };

  // ── Guardado ────────────────────────────────────────────────────────────
  const onSaveClick = async (e?: React.MouseEvent | KeyboardEvent) => {
    e?.preventDefault?.();
    if (saving) return;
    setSaving(true);
    try { if (onSave) await onSave(e as any); }
    catch (err) { console.error('Error guardando:', err); }
    finally { setSaving(false); }
  };

  // ── Atajos de teclado ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (recordingMode) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') { e.preventDefault(); onSaveClick(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        const active = document.activeElement as HTMLElement | null;
        const idx = Number(active?.getAttribute('data-idx') ?? -1);
        if (idx >= 0) {
          e.preventDefault();
          setEditForm(prev => {
            if (!prev) return prev;
            pushUndo(prev);
            const items = [...(prev.items || [])];
            items.splice(idx + 1, 0, { ...items[idx] });
            const totals = recalcTotalsSafe(items);
            return { ...prev, items, total: String(totals.total), base: String(totals.base), taxes: String(totals.taxes) };
          });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recordingMode, onClose, onSave, setEditForm]);

  const isRecordingState  = recordingMode === 'edit';
  const safeSociosReales  = Array.isArray(sociosReales) ? sociosReales : [];

  // ── Descuadre ───────────────────────────────────────────────────────────
  const sumLineas = useMemo(() =>
    (editForm.items || []).reduce((acc, it) => acc + (Num.parse((it as any).t ?? (it as any).total) || 0), 0),
    [editForm.items]
  );
  const globalTotal  = Num.parse(editForm.total);
  const diff         = Num.round2(globalTotal - sumLineas);
  const hasDescuadre = Math.abs(diff) > 0.05;

  // ── Desglose IVA en footer ──────────────────────────────────────────────
  const ivaDesglose = useMemo(() => {
    const d = { base4: 0, iva4: 0, base10: 0, iva10: 0, base21: 0, iva21: 0 };
    for (const it of (editForm.items || [])) {
      const base = Num.parse((it as any).base) || 0;
      const tax  = Num.parse((it as any).tax)  || 0;
      const r    = Number((it as any).rate) || 10;
      if (r === 4)       { d.base4  += base; d.iva4  += tax; }
      else if (r === 21) { d.base21 += base; d.iva21 += tax; }
      else               { d.base10 += base; d.iva10 += tax; }
    }
    return {
      '4%':  { base: Num.round2(d.base4),  iva: Num.round2(d.iva4)  },
      '10%': { base: Num.round2(d.base10), iva: Num.round2(d.iva10) },
      '21%': { base: Num.round2(d.base21), iva: Num.round2(d.iva21) },
    };
  }, [editForm.items]);

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[500] flex justify-center items-start pt-4 md:items-center md:pt-0 p-0 md:p-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => !recordingMode && onClose()}
          className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
        />

        <motion.div
          initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          onClick={e => e.stopPropagation()}
          className="bg-[#F8FAFC] w-full max-w-5xl rounded-t-[2.5rem] md:rounded-2xl shadow-2xl relative z-10 flex flex-col h-[90dvh] md:max-h-[90vh] overflow-hidden"
        >
          {/* CABECERA */}
          <div className="p-5 md:p-6 border-b border-slate-200 bg-white flex justify-between items-center sticky top-0 z-30 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-600 rounded-2xl hidden md:flex items-center justify-center text-white shadow-lg">
                <Package className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl md:text-2xl font-black text-slate-800 leading-none flex items-center gap-2">
                  Auditoría de Albarán
                  {editForm.invoiced && (
                    <span className="bg-emerald-100 text-emerald-700 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-widest ml-2">Facturado</span>
                  )}
                </h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                  Ref: <span className="text-indigo-500">{editForm.num || 'S/N'}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" disabled={saving} onClick={onClose}
                className="p-2 md:px-4 bg-slate-50 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-100 transition border border-slate-200 disabled:opacity-50">
                <span className="hidden md:inline">Cancelar</span>
                <X className="w-5 h-5 md:hidden" />
              </button>
            </div>
          </div>

          {/* ÁREA DE SCROLL */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar space-y-6 relative">

            {/* Banner grabación */}
            <AnimatePresence>
              {isRecordingState && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="bg-rose-500 text-white p-4 rounded-2xl flex items-center gap-3 shadow-lg shadow-rose-500/20 overflow-hidden">
                  <div className="w-3 h-3 bg-white rounded-full animate-pulse shrink-0" />
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest">Escuchando cambios...</p>
                    <p className="text-[10px] opacity-80">Ej: "Añade 2 kilos de tomates a 15 euros"</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Datos cabecera documento */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Proveedor</label>
                <input value={editForm.prov || ''} onChange={e => setEditForm(prev => prev ? { ...prev, prov: e.target.value } : null)}
                  className="w-full font-bold text-sm bg-slate-50 p-2.5 rounded-xl border border-transparent focus:border-indigo-300 focus:bg-white outline-none transition-all" />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Fecha</label>
                <input type="date" value={editForm.date || ''} onChange={e => setEditForm(prev => prev ? { ...prev, date: e.target.value } : null)}
                  className="w-full font-bold text-sm bg-slate-50 p-2.5 rounded-xl border border-transparent focus:border-indigo-300 focus:bg-white outline-none transition-all" />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Responsable</label>
                <select value={editForm.socio || 'Arume'} onChange={e => setEditForm(prev => prev ? { ...prev, socio: e.target.value } : null)}
                  className="w-full font-bold text-sm bg-slate-50 p-2.5 rounded-xl border border-transparent focus:border-indigo-300 focus:bg-white outline-none transition-all cursor-pointer">
                  <option value="Arume">Arume (Empresa)</option>
                  {safeSociosReales.map((s: any) => <option key={s.id || s.n} value={s.n}>{s.n}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Unidad Negocio</label>
                <select value={editForm.unitId || 'REST'} onChange={e => setEditForm(prev => prev ? { ...prev, unitId: e.target.value as BusinessUnit } : null)}
                  className="w-full font-bold text-sm bg-slate-50 p-2.5 rounded-xl border border-transparent focus:border-indigo-300 focus:bg-white outline-none transition-all cursor-pointer">
                  <option value="REST">Restaurante</option>
                  <option value="DLV">Catering Hoteles</option>
                  <option value="SHOP">Tienda Sake</option>
                  <option value="CORP">Socios / Corp</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Divisa</label>
                <select value={(editForm as any).currency || 'EUR'} onChange={e => setEditForm(prev => prev ? { ...prev, currency: e.target.value, exchangeRate: e.target.value === 'EUR' ? undefined : (prev as any).exchangeRate } : null)}
                  className="w-full font-bold text-sm bg-slate-50 p-2.5 rounded-xl border border-transparent focus:border-indigo-300 focus:bg-white outline-none transition-all cursor-pointer">
                  <option value="EUR">🇪🇺 EUR</option>
                  <option value="JPY">🇯🇵 JPY</option>
                  <option value="USD">🇺🇸 USD</option>
                  <option value="GBP">🇬🇧 GBP</option>
                  <option value="CHF">🇨🇭 CHF</option>
                  <option value="CNY">🇨🇳 CNY</option>
                  <option value="KRW">🇰🇷 KRW</option>
                </select>
              </div>
            </div>

            {/* Tabla de productos */}
            <div className="space-y-3">
              <div className="flex justify-between items-end px-1">
                <h3 className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-slate-700">
                  <Calculator className="w-4 h-4 text-indigo-500" /> Líneas de Producto
                  <span className="text-[10px] font-bold text-slate-400 normal-case tracking-normal">
                    ({(editForm.items || []).length} líneas)
                  </span>
                </h3>
                <div className="flex gap-2">
                  {undoRef.current.length > 0 && (
                    <button type="button" onClick={handleUndo}
                      className="bg-white border border-slate-200 text-slate-600 px-3 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-slate-50 transition shadow-sm flex items-center gap-1">
                      <Undo2 className="w-3 h-3" /> Deshacer
                    </button>
                  )}
                  <button type="button" onClick={vaciarItems}
                    className="bg-white border border-rose-200 text-rose-500 px-3 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-rose-50 transition shadow-sm">
                    Vaciar
                  </button>
                  {startVoiceRecording && (
                    <button type="button" onClick={() => startVoiceRecording('edit')}
                      className={cn('px-3 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 transition shadow-sm',
                        isRecordingState ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-900 text-white hover:bg-slate-800'
                      )}>
                      <Mic className="w-3 h-3" /> {isRecordingState ? 'DICTANDO...' : 'DICTAR CAMBIOS'}
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="overflow-x-auto w-full custom-scrollbar">
                  <table className="w-full text-left whitespace-nowrap min-w-[700px]">
                    <thead className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 sticky top-0 z-10">
                      <tr>
                        <th className="p-3 w-20 text-center">Cant.</th>
                        <th className="p-3 w-20 text-center">Ud.</th>
                        <th className="p-3 min-w-[200px]">Concepto</th>
                        <th className="p-3 w-32 text-center">IVA %</th>
                        <th className="p-3 w-32 text-right">Unitario s/IVA</th>
                        <th className="p-3 w-32 text-right">Total c/IVA</th>
                        <th className="p-3 w-12 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <AnimatePresence>
                        {(editForm.items || []).map((it: any, i: number) => {
                          const predicted     = predictVat(it.n || '', learnedVatRules, 10);
                          const hasVatMismatch = it.rate !== predicted.expected && (it.n || '').trim() !== '' && Num.parse(it.t ?? it.total) > 0;
                          const isHighlighted  = highlightedIdx === i;

                          return (
                            <motion.tr layout
                              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                              key={`item-${i}`}
                              className={cn(
                                'hover:bg-indigo-50/40 even:bg-slate-50/50 transition-colors group',
                                isHighlighted && 'bg-indigo-100/60' // 🆕 highlight al cambiar IVA
                              )}>
                              <td className="p-2">
                                <input data-idx={i} type="number" step="0.01" inputMode="decimal"
                                  value={it.q ?? 0} onChange={e => handleItemChange(i, 'q', e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold text-center outline-none focus:border-indigo-500 text-xs shadow-sm transition-all" />
                              </td>
                              <td className="p-2">
                                <select value={it.u || 'uds'} onChange={e => handleItemChange(i, 'u', e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-bold text-slate-600 focus:border-indigo-500 outline-none cursor-pointer transition-all">
                                  <option value="uds">uds</option><option value="kg">kg</option>
                                  <option value="g">g</option><option value="l">l</option><option value="ml">ml</option>
                                </select>
                              </td>
                              <td className="p-2">
                                <input data-idx={i} type="text" placeholder="Nombre del producto..."
                                  value={it.n || ''} onChange={e => handleItemChange(i, 'n', e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold outline-none focus:border-indigo-500 text-xs shadow-sm transition-all" />
                                {hasVatMismatch && (
                                  <div className="mt-1 flex items-center gap-2 text-[9px] text-amber-600 font-bold bg-amber-50 px-2 py-1 rounded-md border border-amber-200 w-fit">
                                    <AlertCircle className="w-3 h-3" /> IA sugiere {predicted.expected}%
                                    <button type="button" onClick={() => handleItemChange(i, 'rate', predicted.expected)} className="ml-1 underline hover:text-amber-800">Aplicar</button>
                                    <span className="opacity-50">|</span>
                                    <button type="button" onClick={() => handleLearnVat(i, it.n, it.rate)} className="flex items-center gap-0.5 hover:text-amber-800">
                                      <Bot className="w-3 h-3" /> Ignorar y Aprender
                                    </button>
                                  </div>
                                )}
                              </td>
                              <td className="p-2">
                                <div className="flex justify-center gap-1">
                                  {[4, 10, 21].map(r => (
                                    <button key={r} type="button" onClick={() => handleItemChange(i, 'rate', r)}
                                      className={cn('text-[10px] font-bold px-2 py-1.5 rounded-lg transition-all border',
                                        it.rate === r
                                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                                      )}>
                                      {r}%
                                    </button>
                                  ))}
                                </div>
                              </td>
                              <td className="p-2">
                                <input data-idx={i} type="number" step="0.0001" inputMode="decimal"
                                  value={it.unitPrice ?? 0} onChange={e => handleItemChange(i, 'unitPrice', e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded-lg p-2 font-bold text-right outline-none focus:border-indigo-500 text-xs shadow-sm transition-all" />
                              </td>
                              <td className="p-2 relative group/tooltip">
                                <input data-idx={i} type="number" step="0.01" inputMode="decimal"
                                  value={it.t ?? it.total ?? 0} onChange={e => handleItemChange(i, 't', e.target.value)}
                                  className={cn(
                                    'w-full border rounded-lg p-2 font-black text-right outline-none text-xs shadow-sm transition-all',
                                    isHighlighted
                                      ? 'bg-indigo-100 border-indigo-400 text-indigo-800' // 🆕 highlight en el total
                                      : 'bg-indigo-50 border-indigo-100 text-indigo-700 focus:border-indigo-500'
                                  )} />
                                <div className="absolute bottom-full right-0 mb-1 hidden group-hover/tooltip:block bg-slate-800 text-white text-[9px] font-bold px-2 py-1 rounded whitespace-nowrap shadow-lg z-50">
                                  Base: {Num.fmt(it.base)} + IVA: {Num.fmt(it.tax)}
                                </div>
                              </td>
                              <td className="p-2 text-center">
                                <div className="flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button type="button" title="Clonar (Ctrl+D)"
                                    onClick={() => {
                                      pushUndo(editForm);
                                      const items = [...(editForm.items || [])];
                                      items.splice(i + 1, 0, { ...items[i] });
                                      const t = recalcTotalsSafe(items);
                                      setEditForm({ ...editForm, items, total: String(t.total), base: String(t.base), taxes: String(t.taxes) });
                                    }}
                                    className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg bg-white border border-slate-200 shadow-sm">
                                    <Plus className="w-3 h-3" />
                                  </button>
                                  <button type="button" title="Eliminar" onClick={() => deleteItemFromEdit(i)}
                                    className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg bg-white border border-slate-200 shadow-sm">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                            </motion.tr>
                          );
                        })}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
                <div className="p-3 bg-slate-50 border-t border-slate-100">
                  <button type="button" onClick={handleAddLine}
                    className="w-full py-3 text-xs font-black text-indigo-600 bg-indigo-50/50 border-2 border-dashed border-indigo-200 hover:bg-indigo-100 rounded-xl flex items-center justify-center gap-2 transition-colors">
                    <Plus className="w-4 h-4" /> Añadir Línea Manual
                  </button>
                </div>
              </div>
            </div>

            {/* 🆕 Desglose de IVA por tipo (visible si hay líneas) */}
            {(editForm.items || []).length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(ivaDesglose).map(([label, v]) => (
                  v.base > 0 || v.iva > 0 ? (
                    <div key={label} className="bg-white border border-slate-200 rounded-2xl p-3 text-center shadow-sm">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">IVA {label}</p>
                      <p className="text-[10px] font-bold text-slate-600">Base: <span className="text-slate-900">{Num.fmt(v.base)}</span></p>
                      <p className="text-[10px] font-bold text-slate-600">Cuota: <span className="text-indigo-600">{Num.fmt(v.iva)}</span></p>
                    </div>
                  ) : null
                ))}
              </div>
            )}

            {/* Notas */}
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block ml-1">Notas del Documento</label>
              <textarea value={editForm.notes || ''} onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                className="w-full h-16 font-medium text-xs bg-slate-50 p-3 rounded-2xl border border-transparent focus:border-indigo-300 focus:bg-white outline-none transition-all resize-none shadow-sm"
                placeholder="Observaciones internas, número de pedido..." />
            </div>

          </div>

          {/* FOOTER FIJO */}
          <div className="bg-slate-900 text-white shrink-0 relative z-20 pb-safe rounded-b-[2.5rem]">
            <div className="p-5 md:p-6 flex flex-col md:flex-row justify-between items-center gap-4">

              <div className="flex gap-8 w-full md:w-auto">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Base Imponible</p>
                  <p className="text-xl font-bold text-slate-300 tabular-nums">{Num.fmt(editForm.base || 0)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Impuestos</p>
                  <p className="text-xl font-bold text-slate-300 tabular-nums">{Num.fmt(editForm.taxes || 0)}</p>
                </div>
                <div className="bg-white/5 px-4 py-2 rounded-2xl border border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Factura</p>
                    {hasDescuadre && (
                      <button onClick={forceSyncTotal}
                        className="text-[8px] bg-rose-500/20 text-rose-400 border border-rose-500/30 px-1.5 py-0.5 rounded font-bold flex items-center gap-1 animate-pulse hover:bg-rose-500/40 transition-colors"
                        title="Sincronizar con líneas">
                        <Wand2 className="w-2.5 h-2.5" /> Corregir {Num.fmt(diff)}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" step="0.01"
                      value={editForm.total}
                      onChange={e => setEditForm({ ...editForm, total: e.target.value as any })}
                      className={cn(
                        'bg-slate-800 border border-slate-700 p-2 rounded-xl text-3xl font-black tracking-tighter outline-none w-40 transition-colors focus:border-indigo-500',
                        hasDescuadre ? 'text-rose-400 border-rose-500/50 focus:border-rose-500' : 'text-emerald-400'
                      )} />
                  </div>
                </div>
              </div>

              <div className="flex w-full md:w-auto items-center justify-between md:justify-end gap-3 mt-4 md:mt-0">
                <label className={cn(
                  'flex-1 md:flex-none flex items-center justify-center gap-2 cursor-pointer bg-slate-800 px-4 py-3 rounded-xl transition hover:bg-slate-700 border border-slate-700',
                  editForm.paid ? 'bg-emerald-500/20 border-emerald-500/50' : ''
                )}>
                  <input type="checkbox" checked={editForm.paid || false}
                    onChange={e => setEditForm(prev => prev ? { ...prev, paid: e.target.checked } : null)}
                    className="w-5 h-5 accent-emerald-500 rounded bg-slate-900 border-slate-600" />
                  <span className={cn('text-[10px] font-black uppercase tracking-wider', editForm.paid ? 'text-emerald-400' : 'text-white')}>
                    Pagado
                  </span>
                </label>

                <button type="button" onClick={() => onDelete(editForm.id)}
                  className="flex items-center justify-center w-12 h-12 bg-rose-500/10 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition"
                  title="Borrar Documento">
                  <Trash2 className="w-5 h-5" />
                </button>

                <button type="button" disabled={saving} onClick={onSaveClick}
                  className="flex-1 md:flex-none px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95 disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span className="hidden sm:inline">{saving ? 'Guardando...' : 'Guardar'}</span>
                </button>
              </div>

            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
