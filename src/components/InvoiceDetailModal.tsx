import React, { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import {
  FileText, FileArchive, Package, Zap, X, Calendar, Hash, ShieldCheck, Link as LinkIcon,
  CheckCircle2, AlertTriangle, Clock, Download, Bot, Edit2, Save, RefreshCw, Trash2, Loader2 // 🛡️ FIX CRÍTICO: ¡Faltaba Loader2!
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// 🛡️ IMPORTACIONES CORREGIDAS (Apunta a types.ts, NO a InvoicesView)
import { Albaran, AppData, FacturaExtended, BusinessUnit } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
// 🚀 IMPORTAMOS EL MOTOR CENTRAL DE FACTURACIÓN
import { recomputeFacturaFromAlbaranes } from '../services/invoicing';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

interface BusinessUnitCfg {
  id: BusinessUnit;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
}

interface InvoiceDetailModalProps {
  factura: FacturaExtended;
  albaranes: Albaran[];
  businessUnits: BusinessUnitCfg[];
  mode: 'proveedor' | 'socio';
  onClose: () => void;
  onDownloadFile: (factura: FacturaExtended) => void;
  onTogglePago?: (id: string) => void; 
  onSaveData?: (newData: AppData) => Promise<void>; 
  fullData?: AppData; 
}

// 🏷️ CHIPS DE ESTADO
const statusChip = (f: FacturaExtended | undefined | null) => {
  if (!f) return { label: 'DESCONOCIDO', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  if (f.reconciled) return { label: 'CONCILIADA BANCO', cls: 'bg-blue-50 text-blue-600 border-blue-200' };
    if (f.paid) return { label: 'PAGADA OK',       cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' };
  switch (f.status) {
    case 'paid':       return { label: 'PAGADA OK',     cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' };
    case 'approved':   return { label: 'PENDIENTE PAGO', cls: 'bg-indigo-50 text-indigo-600 border-indigo-200' };
    case 'mismatch':   return { label: 'REVISIÓN URG.',  cls: 'bg-rose-50 text-rose-600 border-rose-200' };
    case 'draft':      return { label: 'BORRADOR IA',    cls: 'bg-amber-50 text-amber-600 border-amber-200' };
    case 'parsed':     return { label: 'LEÍDA',          cls: 'bg-slate-50 text-slate-600 border-slate-200' };
    case 'ingested':   return { label: 'NUEVA',          cls: 'bg-slate-50 text-slate-600 border-slate-200' };
    default:           return { label: 'SIN REVISAR',    cls: 'bg-amber-50 text-amber-600 border-amber-200' };
  }
};

// ♿ ENVOLTORIO DE ACCESIBILIDAD
function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const root = ref.current;
    const SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    // ✅ Enfocamos el primer elemento al montar (solo al inicio)
    const initialFocusables = Array.from(root.querySelectorAll<HTMLElement>(SEL))
      .filter(el => !el.hasAttribute('disabled') && !el.hasAttribute('hidden'));
    if (initialFocusables[0]) initialFocusables[0].focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      // ✅ Recalculamos en cada pulsación: captura el DOM actual,
      //    incluyendo inputs del modo edición que no existían al montar.
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(SEL))
        .filter(el => !el.hasAttribute('disabled') && !el.hasAttribute('hidden'));

      if (focusables.length === 0) { e.preventDefault(); return; }

      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement;

      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  return ref;
}
export const InvoiceDetailModal = React.memo(function InvoiceDetailModal({
  factura, albaranes, businessUnits, mode, onClose, onDownloadFile, onTogglePago, onSaveData, fullData
}: InvoiceDetailModalProps) {

  // 🚀 ESTADOS DE EDICIÓN
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    num: factura?.num || '',
    date: factura?.date || DateUtil.today(),
    prov: factura?.prov || factura?.cliente || '',
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, []);

      // 🔄 SINCRONIZACIÓN: si factura cambia externamente (ej. guardado desde otra pestaña
      // o actualización en tiempo real), reseteamos el form para evitar mostrar datos obsoletos.
      // Usamos factura.id como dependencia para no resetear en cada re-render menor.
      useEffect(() => {
            if (!isEditing) {
                    setEditForm({
                              num:  factura?.num  || '',
                              date: factura?.date || DateUtil.today(),
                              prov: factura?.prov || factura?.cliente || '',
                    });
            }
      }, [factura?.id]);
  
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { 
      if (e.key === 'Escape' && !isEditing) onClose(); 
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (factura?.file_base64) onDownloadFile(factura);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onDownloadFile, factura, isEditing]);

  const trapRef = useFocusTrap(true);

  if (!factura || typeof factura !== 'object') return null;

  const safeBusinessUnits = Array.isArray(businessUnits) ? businessUnits : [];
  const safeAlbaranes = Array.isArray(albaranes) ? albaranes : [];

  const unitById = useMemo(() => {
    const map = new Map<BusinessUnit, BusinessUnitCfg>();
    for (const u of safeBusinessUnits) {
      if (u && u.id) map.set(u.id, u);
    }
    return map;
  }, [safeBusinessUnits]);

  const titular = useMemo(() => {
    const raw = mode === 'socio' ? (factura.cliente || factura.prov) : (factura.prov || factura.cliente);
    return typeof raw === 'string' ? raw.trim().toUpperCase() : 'DESCONOCIDO';
  }, [factura, mode]);

  const refStr  = String(factura.num || 'S/N').toUpperCase();
  const dateStr = String(factura.date || 'S/F');
  const isIA = factura.source === 'gmail-sync' || factura.source === 'dropzone' || factura.source === 'email-ia' || factura.source === 'ia-auto';

  const albaranesVinculados = useMemo(() => {
    const ids = Array.isArray(factura.albaranIdsArr) ? factura.albaranIdsArr : [];
    if (ids.length === 0) return [];
    const setIds = new Set(ids);
    return safeAlbaranes.filter(a => a && a.id && setIds.has(a.id));
  }, [factura.albaranIdsArr, safeAlbaranes]);

  const sumaAlbaranes = useMemo(() => {
    // 🛡️ getSafeTotal: si a.total===0 suma las líneas (igual que el pie de tabla en AlbaranesList)
    return albaranesVinculados.reduce((acc, a) => {
      const t = Num.parse(a.total);
      const safe = t > 0 ? t : (a.items || []).reduce((s: number, it: any) => s + Num.parse(it.t), 0);
      return acc + Math.abs(safe);
    }, 0);
  }, [albaranesVinculados]);

  const total = Math.abs(Num.parse(factura.total) || 0);
  const base  = Math.abs(Num.parse(factura.base)  || Num.round2(total / 1.10));
  const iva   = Math.abs(Num.parse(factura.tax)   || Num.round2(total - base));

  const diferencia = Num.round2(sumaAlbaranes - total);
  const diffAbsoluta = Math.abs(diferencia);
  const isPerfectMatch = diffAbsoluta <= Math.max(0.50, total * 0.005); 
  
  const matchPercentage = total > 0 ? Math.min((sumaAlbaranes / total) * 100, 100) : 0;

  const chip = statusChip(factura);

  // 🚀 LÓGICA DE EDICIÓN Y SINCRONIZACIÓN
  const handleSaveEdits = async () => {
    if (!onSaveData || !fullData) return;
    setIsSaving(true);
    try {
      const newData = JSON.parse(JSON.stringify(fullData)) as AppData;
      const idx = newData.facturas?.findIndex(f => f.id === factura.id);
      
      if (idx !== undefined && idx > -1 && newData.facturas) {
        newData.facturas[idx] = {
          ...newData.facturas[idx],
          num: editForm.num,
          date: editForm.date,
          prov: mode === 'proveedor' ? editForm.prov : newData.facturas[idx].prov,
          cliente: mode === 'socio' ? editForm.prov : newData.facturas[idx].cliente,
        };
        await onSaveData(newData);
        setIsEditing(false);
      }
    } catch (error) {
      toast.info("Error al guardar los cambios.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncTotals = async () => {
    if (!onSaveData || !fullData) return;
    if (!await confirm(`⚠️ Se sobreescribirá el total de la factura (${Num.fmt(total)}) con la suma matemática de los albaranes (${Num.fmt(sumaAlbaranes)}).\n\n¿Proceder?`)) return;
    
    setIsSaving(true);
    try {
      const newData = JSON.parse(JSON.stringify(fullData)) as AppData;
      
      // 🚀 MAGIA APLICADA: En lugar de matemáticas manuales, llamamos a nuestro Motor Central
      recomputeFacturaFromAlbaranes(newData, factura.id, { strategy: 'useAlbTotals' });
      
      await onSaveData(newData);
    } catch (error) {
      toast.info("Error al sincronizar totales.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveAttachment = async () => {
    if (!onSaveData || !fullData) return;
    if (!await confirm(`⚠️ ¿Desvincular y eliminar el PDF adjunto de esta factura?`)) return;
    
    setIsSaving(true);
    try {
      const newData = JSON.parse(JSON.stringify(fullData)) as AppData;
      const idx = newData.facturas?.findIndex(f => f.id === factura.id);
      
      if (idx !== undefined && idx > -1 && newData.facturas) {
        newData.facturas[idx].file_base64 = undefined;
        newData.facturas[idx].attachmentSha = undefined;
        await onSaveData(newData);
        onClose(); 
      }
    } catch (error) {
      toast.info("Error al eliminar el adjunto.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = useCallback(() => {
    if (onDownloadFile && typeof onDownloadFile === 'function') onDownloadFile(factura);
  }, [onDownloadFile, factura]);
  
  const handleClose = useCallback(() => {
    if (onClose && typeof onClose === 'function') onClose();
  }, [onClose]);

  const unit = factura.unidad_negocio ? unitById.get(factura.unidad_negocio) : undefined;
  const UnitIcon = unit?.icon || Package;

  return (
    <AnimatePresence>
    <div
      className="fixed inset-0 z-[200] flex flex-col justify-end md:justify-center items-center p-0 md:p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="invoice-title" aria-describedby="invoice-desc"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 w-full h-full bg-[color:var(--arume-ink)]/70 backdrop-blur-md cursor-default"
        onClick={handleClose}
        aria-label="Cerrar modal"
      />

      <motion.div
        ref={trapRef}
        initial={{ y: 100, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 100, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', damping: 25, stiffness: 250 }}
        className="bg-[color:var(--arume-paper)] w-full max-w-2xl rounded-t-2xl md:rounded-2xl relative z-10 flex flex-col h-[85dvh] md:h-auto md:max-h-[90dvh] overflow-hidden focus:outline-none"
        style={{ boxShadow: '0 24px 80px rgba(11,11,12,0.35)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Línea acento superior: dorada si cuadra, rojo si no */}
        <span className={cn('absolute top-0 left-0 right-0 h-[2px] z-30',
          isPerfectMatch ? 'bg-[color:var(--arume-gold)]' : 'bg-[color:var(--arume-accent)]')}/>

        <div className="p-6 border-b border-[color:var(--arume-gray-100)] bg-white flex justify-between items-start md:items-center relative z-20 shrink-0 flex-col md:flex-row gap-4">
          <div className="flex items-center gap-4 min-w-0 w-full">
            <div className={cn("w-11 h-11 rounded-full flex items-center justify-center shrink-0 border",
              isPerfectMatch
                ? "bg-[color:var(--arume-gray-50)] text-[color:var(--arume-ink)] border-[color:var(--arume-gray-100)]"
                : "bg-[color:var(--arume-accent)]/10 text-[color:var(--arume-accent)] border-[color:var(--arume-accent)]/20")}>
              <FileText className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="space-y-2 w-full pr-4">
                  <input
                    type="text"
                    value={editForm.prov}
                    onChange={(e) => setEditForm({...editForm, prov: e.target.value.toUpperCase()})}
                    className="w-full font-serif text-xl md:text-2xl font-semibold text-[color:var(--arume-ink)] border-b-2 border-[color:var(--arume-ink)]/30 outline-none bg-[color:var(--arume-gray-50)] px-2 py-1 rounded-t-lg focus:border-[color:var(--arume-ink)]"
                    placeholder="Nombre titular"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editForm.num}
                      onChange={(e) => setEditForm({...editForm, num: e.target.value})}
                      className="w-1/2 text-xs font-mono uppercase bg-[color:var(--arume-gray-50)] border-b-2 border-[color:var(--arume-ink)]/30 outline-none px-2 py-1"
                      placeholder="Nº factura"
                    />
                    <input
                      type="date"
                      value={editForm.date}
                      onChange={(e) => setEditForm({...editForm, date: e.target.value})}
                      className="w-1/2 text-xs bg-[color:var(--arume-gray-50)] border-b-2 border-[color:var(--arume-ink)]/30 outline-none px-2 py-1"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Factura</p>
                  <h3 id="invoice-title" className="font-serif text-xl md:text-2xl font-semibold tracking-tight text-[color:var(--arume-ink)] leading-tight truncate pr-2 flex items-center gap-2 mt-0.5">
                    {titular}
                    {onSaveData && !factura.reconciled && (
                      <button onClick={() => setIsEditing(true)} className="p-1.5 bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-400)] hover:text-[color:var(--arume-ink)] hover:bg-[color:var(--arume-gray-100)] rounded-full transition"><Edit2 className="w-3 h-3"/></button>
                    )}
                  </h3>
                  <p id="invoice-desc" className="text-[11px] text-[color:var(--arume-gray-500)] mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className="bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)] px-2 py-0.5 rounded-full font-mono tabular-nums text-[color:var(--arume-ink)]">{refStr}</span>
                    <span className="flex items-center gap-1 tabular-nums"><Calendar className="w-3 h-3"/> {dateStr}</span>
                    {isIA && <span className="bg-[color:var(--arume-gold)]/15 text-[color:var(--arume-ink)] border border-[color:var(--arume-gold)]/30 px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold uppercase tracking-[0.1em]"><Bot className="w-3 h-3"/> IA</span>}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto w-full md:w-auto justify-end">
            {isEditing ? (
              <div className="flex gap-2">
                <button onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-600)] border border-[color:var(--arume-gray-200)] hover:bg-[color:var(--arume-gray-50)] transition">
                  Cancelar
                </button>
                <button onClick={handleSaveEdits} disabled={isSaving}
                  className="px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition flex items-center gap-2 active:scale-[0.98] disabled:opacity-50">
                  {isSaving ? <Loader2 className="w-3 h-3 animate-spin"/> : <Save className="w-3 h-3"/>} Guardar
                </button>
              </div>
            ) : (
              <>
                <span className={cn('text-[10px] font-semibold uppercase tracking-[0.15em] px-2.5 py-1 rounded-full border hidden sm:inline-block', chip.cls)} title="Estado de la factura">{chip.label}</span>
                <button type="button" onClick={handleClose}
                  className="p-2 bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-500)] rounded-full hover:bg-[color:var(--arume-gray-100)] hover:text-[color:var(--arume-ink)] transition shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6" style={{ WebkitOverflowScrolling: 'touch' }}>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-center">
              <span className="text-[10px] font-black text-slate-400 uppercase mb-2">Unidad Asignada</span>
              <span className={cn('text-[11px] font-black px-3 py-1.5 rounded-lg border uppercase tracking-wider shadow-sm inline-flex items-center gap-2 w-max', unit?.color || 'text-slate-600', unit?.bg || 'bg-slate-100', 'border-current opacity-90')}>
                <UnitIcon className="w-4 h-4"/> {unit?.name || 'Restaurante'}
              </span>
            </div>

            <div className={cn("p-5 rounded-3xl border shadow-sm flex flex-col justify-between", factura.file_base64 ? "bg-indigo-50/50 border-indigo-100" : "bg-slate-50 border-slate-100 border-dashed")}>
               {factura.file_base64 ? (
                 <>
                   <div className="flex justify-between items-start mb-2">
                     <span className="text-[10px] font-black text-indigo-400 uppercase flex items-center gap-1.5"><FileArchive className="w-3 h-3"/> Doc. Original</span>
                     {onSaveData && <button onClick={handleRemoveAttachment} className="text-rose-400 hover:text-rose-600 transition"><Trash2 className="w-3.5 h-3.5"/></button>}
                   </div>
                   <button onClick={handleDownload} className="w-full bg-white border border-indigo-200 text-indigo-600 font-black text-[10px] uppercase py-2 rounded-xl shadow-sm hover:bg-indigo-600 hover:text-white transition flex justify-center items-center gap-2">
                     <Download className="w-3.5 h-3.5"/> Descargar PDF
                   </button>
                 </>
               ) : (
                 <div className="text-center h-full flex flex-col items-center justify-center opacity-60">
                   <FileText className="w-5 h-5 text-slate-400 mb-1" />
                   <p className="text-[9px] font-black uppercase text-slate-500">Sin archivo adjunto</p>
                 </div>
               )}
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3"/> Auditoría 3‑Way Match
              </p>
              <div className="flex items-center gap-2">
                {!isPerfectMatch && onSaveData && !factura.reconciled && (
                   <button onClick={handleSyncTotals} disabled={isSaving} className="text-[9px] font-black px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 transition shadow-sm flex items-center gap-1">
                     {isSaving ? <Loader2 className="w-3 h-3 animate-spin"/> : <RefreshCw className="w-3 h-3"/>} Sincronizar Totales
                   </button>
                )}
                <span className={cn('text-[10px] font-black px-2.5 py-1 rounded-full border shadow-sm', isPerfectMatch ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200')}>
                  {isPerfectMatch ? 'CUADRA PERFECTO' : 'DIFERENCIA DETECTADA'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Albaranes</p>
                <p className="text-lg font-black text-slate-800 mt-1">{Num.fmt(sumaAlbaranes)}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 relative group overflow-hidden">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Factura</p>
                <p className="text-lg font-black text-slate-800 mt-1">{Num.fmt(total)}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Δ Diferencia</p>
                <p className={cn('text-lg font-black mt-1', isPerfectMatch ? 'text-emerald-600' : (diferencia < 0 ? 'text-rose-500' : 'text-amber-500'))}>
                  {Num.fmt(diffAbsoluta)}
                </p>
              </div>
            </div>

            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex shadow-inner mt-2">
              <motion.div initial={{ width: 0 }} animate={{ width: `${matchPercentage}%` }} transition={{ duration: 0.8 }} className="h-full bg-emerald-400" />
              {!isPerfectMatch && <motion.div initial={{ width: 0 }} animate={{ width: `${100 - matchPercentage}%` }} transition={{ duration: 0.8, delay: 0.4 }} className={cn("h-full", diferencia < 0 ? "bg-rose-400" : "bg-amber-400")} />}
            </div>

            {albaranesVinculados.length > 0 ? (
              <div className="space-y-2 mt-4 pt-4 border-t border-slate-100 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                {albaranesVinculados.map(alb => (
                  <div key={alb.id} className="flex justify-between items-center text-xs py-3 px-4 bg-slate-50 border border-slate-100 rounded-xl text-slate-600 hover:bg-white hover:shadow-sm transition-colors group">
                    <div className="flex items-center gap-3">
                      <Package className="w-4 h-4 opacity-50" aria-hidden="true" />
                      <div>
                        <p className="font-bold text-slate-700">{String(alb.date || 'Sin fecha')}</p>
                        <p className="text-[9px] font-mono uppercase mt-0.5 opacity-70">Ref: {String(alb.num || 'S/N')}</p>
                      </div>
                    </div>
                    <span className="font-black text-sm text-slate-900 group-hover:text-indigo-600 transition-colors">{Num.fmt(Math.abs(Num.parse(alb.total || 0)))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 mt-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm">
                  <Zap className="w-5 h-5 text-slate-300" aria-hidden="true" />
                </div>
                <p className="text-xs text-slate-700 font-black">Gasto Directo (o albarán borrado)</p>
                <p className="text-[9px] text-slate-400 uppercase tracking-widest mt-1">Sin albaranes vinculados</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-900 text-white shrink-0 relative z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.15)] rounded-t-3xl md:rounded-t-none">
          <div className="p-6 md:p-8 pb-safe">
            
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
                <p className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">Base</p>
                <p className="text-base font-black">{Num.fmt(base)}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
                <p className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">IVA</p>
                <p className="text-base font-black">{Num.fmt(iva)}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-3 text-center border border-white/20">
                <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-1">Total</p>
                <p className="text-base font-black text-emerald-400">{Num.fmt(total)}</p>
              </div>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="w-full md:w-auto flex justify-between items-end">
                <div>
                  <span className="text-[10px] font-black text-white/70 uppercase tracking-widest block mb-2">Estado Financiero</span>
                  <span
                    className={cn(
                      'text-[10px] font-black uppercase px-3 py-1.5 rounded-lg tracking-wider border flex items-center gap-1.5',
                      factura.paid
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-400/30'
                        : 'bg-rose-500/20 text-rose-400 border-rose-400/30'
                    )}
                  >
                    {factura.paid ? <ShieldCheck className="w-3 h-3"/> : <Clock className="w-3 h-3"/>}
                    {factura.paid ? 'PAGADA OK' : 'PENDIENTE PAGO'}
                  </span>
                </div>
                <span className="text-4xl md:text-5xl font-black tracking-tighter block md:hidden ml-4">
                  {Num.fmt(total)}
                </span>
              </div>

              <div className="flex w-full md:w-auto gap-3 mt-2 md:mt-0">
                {onTogglePago && !factura.reconciled && (
                  <button
                    onClick={() => onTogglePago(factura.id)}
                    className={cn(
                      "flex-1 py-3.5 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 shadow-lg active:scale-95",
                      factura.paid
                        ? "bg-amber-500 hover:bg-amber-600 text-white border border-amber-400"
                        : "bg-emerald-500 hover:bg-emerald-600 text-white border border-emerald-400"
                    )}
                  >
                    {factura.paid
                      ? <><Clock className="w-4 h-4"/> Desmarcar Pago</>
                      : <><CheckCircle2 className="w-4 h-4"/> Pagar Ahora</>
                    }
                  </button>
                )}
                {factura.file_base64 && typeof factura.file_base64 === 'string' && (
                  <button type="button" onClick={handleDownload} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3.5 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 shadow-lg active:scale-95 border border-indigo-500">
                    <FileArchive className="w-4 h-4" /> Bajar PDF
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
    </AnimatePresence>
  );
});
