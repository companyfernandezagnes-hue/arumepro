import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import {
  FileText, FileArchive, Package, Zap, X, Calendar, Hash, ShieldCheck, Link as LinkIcon,
  CheckCircle2, AlertTriangle, Clock, Download, Bot
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
// 🛡️ Tipos importados correctamente
import { FacturaExtended, BusinessUnit } from './InvoicesView';
import { Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

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
  onTogglePago?: (id: string) => void; // 💡 Añadido opcionalmente para la innovación del botón de pago
}

// 🏷️ CHIPS DE ESTADO: (INTACTO - Recuperado de tu código)
const statusChip = (f: FacturaExtended | undefined | null) => {
  if (!f) return { label: 'DESCONOCIDO', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  if (f.reconciled) return { label: 'CONCILIADA', cls: 'bg-blue-50 text-blue-600 border-blue-200' };
  switch (f.status) {
    case 'paid':       return { label: 'PAGADA',     cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' };
    case 'approved':   return { label: 'APROBADA',   cls: 'bg-indigo-50 text-indigo-600 border-indigo-200' };
    case 'mismatch':   return { label: 'REVISIÓN',   cls: 'bg-rose-50 text-rose-600 border-rose-200' };
    case 'draft':      return { label: 'BORRADOR',   cls: 'bg-amber-50 text-amber-600 border-amber-200' };
    case 'parsed':     return { label: 'PARSEADA',   cls: 'bg-slate-50 text-slate-600 border-slate-200' };
    case 'ingested':   return { label: 'INGESTADA',  cls: 'bg-slate-50 text-slate-600 border-slate-200' };
    default:           return { label: 'PENDIENTE',  cls: 'bg-amber-50 text-amber-600 border-amber-200' };
  }
};

// ♿ ENVOLTORIO DE ACCESIBILIDAD (INTACTO - Recuperado de tu código)
function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  
  useEffect(() => {
    if (!active || !ref.current) return;
    const root = ref.current;
    const SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(SEL)).filter(el => !el.hasAttribute('disabled'));
    const first = focusables[0], last = focusables[focusables.length - 1];

    if (first) first.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (focusables.length === 0) { e.preventDefault(); return; }
      const activeEl = document.activeElement as HTMLElement;
      const goingBack = e.shiftKey;
      if (goingBack && activeEl === first) { e.preventDefault(); last.focus(); }
      else if (!goingBack && activeEl === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
  
  return ref;
}

export const InvoiceDetailModal = React.memo(function InvoiceDetailModal({
  factura, albaranes, businessUnits, mode, onClose, onDownloadFile, onTogglePago
}: InvoiceDetailModalProps) {

  // 🛡️ BLOQUEO DE SCROLL DE FONDO (Mejora de UX)
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, []);

  // 🛡️ PARACAÍDAS 1: Si no hay factura, destruimos el modal antes de que crashee
  if (!factura || typeof factura !== 'object') return null;

  // ♿ Cierre seguro con tecla ESC y atajo Ctrl+P para descargar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { 
      if (e.key === 'Escape') onClose(); 
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (factura.file_base64) onDownloadFile(factura);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onDownloadFile, factura]);

  const trapRef = useFocusTrap(true);

  // 🛡️ PARACAÍDAS 2: Arrays siempre seguros
  const safeBusinessUnits = Array.isArray(businessUnits) ? businessUnits : [];
  const safeAlbaranes = Array.isArray(albaranes) ? albaranes : [];

  // ✅ Indexación rápida de Unidades
  const unitById = useMemo(() => {
    const map = new Map<BusinessUnit, BusinessUnitCfg>();
    for (const u of safeBusinessUnits) {
      if (u && u.id) map.set(u.id, u);
    }
    return map;
  }, [safeBusinessUnits]);

  // 🛡️ PARACAÍDAS 3: Saneamiento extremo de cadenas
  const titular = useMemo(() => {
    const raw = mode === 'socio' ? (factura.cliente || factura.prov) : (factura.prov || factura.cliente);
    return typeof raw === 'string' ? raw.trim().toUpperCase() : 'DESCONOCIDO';
  }, [factura, mode]);

  const refStr  = typeof factura.num === 'string' ? factura.num.trim().toUpperCase() : 'S/N';
  const dateStr = typeof factura.date === 'string' ? factura.date : 'FECHA DESCONOCIDA';
  const isIA = factura.source === 'gmail-sync' || factura.source === 'dropzone' || factura.source === 'email-ia' || factura.source === 'ia-auto';

  // 🛡️ PARACAÍDAS 4: Filtrado de Albaranes seguro
  const albaranesVinculados = useMemo(() => {
    const ids = Array.isArray(factura.albaranIdsArr) ? factura.albaranIdsArr : [];
    if (ids.length === 0) return [];
    
    const setIds = new Set(ids);
    return safeAlbaranes.filter(a => a && a.id && setIds.has(a.id));
  }, [factura.albaranIdsArr, safeAlbaranes]);

  const sumaAlbaranes = useMemo(() => {
    return albaranesVinculados.reduce((acc, a) => acc + (Num.parse(a.total) || 0), 0);
  }, [albaranesVinculados]);

  // 🛡️ PARACAÍDAS 5: Matemáticas a prueba de fallos
  const total = Math.abs(Num.parse(factura.total) || 0);
  const base  = Math.abs(Num.parse(factura.base)  || Num.round2(total / 1.10));
  const iva   = Math.abs(Num.parse(factura.tax)   || Num.round2(total - base));

  // 💡 CÁLCULOS INNOVACIÓN: Barra de Progreso y Descuadre
  const diferencia = Math.abs(Num.round2(sumaAlbaranes - total));
  const isPerfectMatch = diferencia <= Math.max(0.50, total * 0.005);
  const matchPercentage = total > 0 ? Math.min((sumaAlbaranes / total) * 100, 100) : 0;

  const chip = statusChip(factura);

  const handleDownload = useCallback(() => {
    if (onDownloadFile && typeof onDownloadFile === 'function') onDownloadFile(factura);
  }, [onDownloadFile, factura]);
  
  const handleClose = useCallback(() => {
    if (onClose && typeof onClose === 'function') onClose();
  }, [onClose]);

  const unit = factura.unidad_negocio ? unitById.get(factura.unidad_negocio) : undefined;
  const UnitIcon = unit?.icon || Package;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col justify-end md:justify-center items-center p-0 md:p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="invoice-title"
      aria-describedby="invoice-desc"
    >
      {/* 🌑 INNOVACIÓN: Fondo Glassmorphism Inteligente */}
      <motion.div
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        className={cn(
          "absolute inset-0 w-full h-full backdrop-blur-md cursor-default transition-colors duration-700",
          isPerfectMatch ? "bg-slate-900/60" : "bg-slate-900/80"
        )}
        onClick={handleClose}
        aria-label="Cerrar modal"
      >
        {!isPerfectMatch && <div className="absolute inset-0 bg-rose-500/10 mix-blend-overlay"></div>}
      </motion.div>

      {/* 🚀 Contenedor Modal */}
      <motion.div
        ref={trapRef}
        initial={{ y: 100, opacity: 0, scale: 0.98 }} 
        animate={{ y: 0, opacity: 1, scale: 1 }} 
        exit={{ y: 100, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', damping: 25, stiffness: 250 }}
        className="bg-[#F8FAFC] w-full max-w-2xl rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col h-[85dvh] md:h-auto md:max-h-[85dvh] overflow-hidden focus:outline-none"
        onClick={(e) => e.stopPropagation()} 
      >
        {/* 📌 Header */}
        <div className="p-6 border-b border-slate-200 bg-white flex justify-between items-center relative z-20 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <div className={cn("w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-sm border", isPerfectMatch ? "bg-indigo-50 text-indigo-600 border-indigo-100" : "bg-rose-50 text-rose-600 border-rose-100")}>
              <FileText className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 id="invoice-title" className="text-lg md:text-xl font-black text-slate-800 leading-tight truncate pr-2">
                {titular}
              </h3>
              <p id="invoice-desc" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1 flex items-center gap-2">
                <span className="bg-slate-100 px-2 py-0.5 rounded text-indigo-500">REF: {refStr}</span>
                {isIA && <span className="bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded flex items-center gap-1"><Bot className="w-3 h-3"/> IA</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={cn('text-[9px] font-black px-2.5 py-1 rounded-full border', chip.cls)} title="Estado de la factura">
              {chip.label}
            </span>

            <button
              type="button"
              onClick={handleClose}
              className="p-2.5 bg-slate-50 text-slate-400 rounded-full hover:bg-rose-50 hover:text-rose-500 transition-colors shrink-0"
              aria-label="Cerrar modal"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 📜 Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6" style={{ WebkitOverflowScrolling: 'touch' }}>
          
          {/* Info general */}
          <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1.5">
                <Calendar className="w-3 h-3" aria-hidden="true" /> Fecha Emisión
              </span>
              <span className="text-xs font-black text-slate-700 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                {dateStr}
              </span>
            </div>

            <div className="flex justify-between items-center border-t border-slate-50 pt-4">
              <span className="text-[10px] font-black text-slate-400 uppercase">Unidad Asignada</span>
              <span
                className={cn(
                  'text-[9px] font-black px-2.5 py-1 rounded-md border uppercase tracking-wider shadow-sm flex items-center gap-1.5',
                  unit?.color || 'text-slate-600',
                  unit?.bg || 'bg-slate-100',
                  'border-current opacity-90'
                )}
              >
                <UnitIcon className="w-3 h-3"/> {unit?.name || 'Restaurante'}
              </span>
            </div>

            {/* Email Meta */}
            {factura.emailMeta && typeof factura.emailMeta === 'object' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-slate-50 pt-4">
                <div className="text-[10px] text-slate-500">
                  <span className="font-black uppercase block mb-1">Correo Origen</span>
                  <span className="text-xs font-mono text-slate-700 break-all">{factura.emailMeta.from || '—'}</span>
                </div>
                <div className="text-[10px] text-slate-500">
                  <span className="font-black uppercase block mb-1">Asunto</span>
                  <span className="text-xs text-slate-700 break-words">{factura.emailMeta.subject || '—'}</span>
                </div>
              </div>
            )}
          </div>

          {/* ⚖️ INNOVACIÓN 1: Cuadro 3-Way Match con Barra de Progreso */}
          <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3"/> Auditoría 3‑Way Match
              </p>
              <span className={cn(
                'text-[10px] font-black px-2.5 py-1 rounded-full border',
                isPerfectMatch ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'
              )}>
                {isPerfectMatch ? 'CUADRA PERFECTO' : 'DIFERENCIA DETECTADA'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Albaranes</p>
                <p className="text-lg font-black text-slate-800 mt-1">{Num.fmt(sumaAlbaranes)}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Factura</p>
                <p className="text-lg font-black text-slate-800 mt-1">{Num.fmt(total)}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Δ Diferencia</p>
                <p className={cn('text-lg font-black mt-1', isPerfectMatch ? 'text-emerald-600' : 'text-amber-600')}>
                  {Num.fmt(diferencia)}
                </p>
              </div>
            </div>

            {/* Barra de progreso visual */}
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex shadow-inner mt-2">
              <motion.div initial={{ width: 0 }} animate={{ width: `${matchPercentage}%` }} transition={{ duration: 0.8 }} className="h-full bg-emerald-400" />
              {!isPerfectMatch && <motion.div initial={{ width: 0 }} animate={{ width: `${100 - matchPercentage}%` }} transition={{ duration: 0.8, delay: 0.4 }} className="h-full bg-amber-400" />}
            </div>

            {/* Lista de albaranes o fallback */}
            {albaranesVinculados.length > 0 ? (
              <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                {albaranesVinculados.map(alb => (
                  <div key={alb.id} className="flex justify-between items-center text-xs py-3 px-4 bg-slate-50 border border-slate-100 rounded-xl text-slate-600 hover:bg-white hover:shadow-sm transition-colors">
                    <div className="flex items-center gap-3">
                      <Package className="w-4 h-4 opacity-50" aria-hidden="true" />
                      <div>
                        <p className="font-bold text-slate-700">{alb.date || 'Sin fecha'}</p>
                        <p className="text-[9px] font-mono uppercase mt-0.5 opacity-70">Ref: {alb.num || 'S/N'}</p>
                      </div>
                    </div>
                    <span className="font-black text-sm">{Num.fmt(Num.parse(alb.total || 0))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 mt-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm">
                  <Zap className="w-5 h-5 text-slate-300" aria-hidden="true" />
                </div>
                <p className="text-xs text-slate-700 font-black">Gasto Directo</p>
                <p className="text-[9px] text-slate-400 uppercase tracking-widest mt-1">Sin albaranes vinculados</p>
              </div>
            )}
          </div>
        </div>

        {/* 📌 Footer (INTACTO CON MEJORA DE BOTÓN) */}
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

              {/* INNOVACIÓN 2: Botones Dinámicos Inteligentes */}
              <div className="flex w-full md:w-auto gap-3 mt-2 md:mt-0">
                {onTogglePago && !factura.paid && !factura.reconciled && (
                  <button onClick={() => onTogglePago(factura.id)} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-3.5 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 shadow-lg active:scale-95 border border-emerald-400">
                    <CheckCircle2 className="w-4 h-4"/> Pagar Ahora
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
  );
});
