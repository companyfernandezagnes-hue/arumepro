// ============================================================================
// 🏛️ ModelosAEATView — Gestión de modelos fiscales trimestrales/anuales
// - Muestra próximos vencimientos con semáforo
// - Permite marcar como presentada subiendo el justificante PDF
// - Histórico de modelos presentados con acceso al PDF
// ============================================================================
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  ShieldCheck, Clock, CheckCircle2, Upload, Download,
  AlertTriangle, Calendar, FileText, X, Plus, Eye, Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, ModeloAEAT, ModeloAEATId } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';
import { EmptyState } from './EmptyState';
import { triggerConfetti } from './Confetti';

interface Props {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

// ─── Catálogo de modelos AEAT ─────────────────────────────────────────────
// Fechas límite se calculan relativas al trimestre. Los trimestrales vencen el
// día 20 del mes siguiente al fin de trimestre. Los anuales el 30/31 de enero.
interface ModeloInfo {
  id: ModeloAEATId;
  nombre: string;
  descripcion: string;
  frecuencia: 'trimestral' | 'anual' | 'mensual';
  obligatorio: boolean; // false = solo si procede
}

const CATALOGO: ModeloInfo[] = [
  { id: '303', nombre: 'Modelo 303', descripcion: 'IVA trimestral',                     frecuencia: 'trimestral', obligatorio: true  },
  { id: '111', nombre: 'Modelo 111', descripcion: 'Retenciones IRPF trabajadores',       frecuencia: 'trimestral', obligatorio: true  },
  { id: '115', nombre: 'Modelo 115', descripcion: 'Retenciones IRPF alquiler local',     frecuencia: 'trimestral', obligatorio: true  },
  { id: '130', nombre: 'Modelo 130', descripcion: 'Pago fraccionado IRPF (autónomos)',   frecuencia: 'trimestral', obligatorio: false },
  { id: '390', nombre: 'Modelo 390', descripcion: 'Resumen anual IVA',                   frecuencia: 'anual',      obligatorio: true  },
  { id: '190', nombre: 'Modelo 190', descripcion: 'Resumen anual retenciones IRPF',      frecuencia: 'anual',      obligatorio: true  },
  { id: '200', nombre: 'Modelo 200', descripcion: 'Impuesto sobre Sociedades',           frecuencia: 'anual',      obligatorio: true  },
];

// Calcula fecha de vencimiento de un modelo según periodo
function calcVencimiento(info: ModeloInfo, anio: number, trimestre?: 1|2|3|4): string {
  if (info.frecuencia === 'anual') {
    // 390/190 → 30 enero del año siguiente
    // 200 → 25 julio del año siguiente (6 meses + 25 días desde cierre ejercicio)
    if (info.id === '200') return `${anio + 1}-07-25`;
    return `${anio + 1}-01-30`;
  }
  if (info.frecuencia === 'trimestral' && trimestre) {
    // Q1 → 20 abril, Q2 → 20 julio, Q3 → 20 octubre, Q4 → 30 enero año siguiente
    if (trimestre === 4) return `${anio + 1}-01-30`;
    const mes = trimestre * 3 + 1; // Q1=4, Q2=7, Q3=10
    return `${anio}-${String(mes).padStart(2, '0')}-20`;
  }
  return '';
}

// Formatea periodo para mostrar
function formatPeriodo(m: ModeloAEAT): string {
  if (m.trimestre) return `${m.anio} · Q${m.trimestre}`;
  if (m.mes) return `${m.anio} · ${String(m.mes).padStart(2, '0')}`;
  return String(m.anio);
}

// Año mínimo del ejercicio fiscal — Arume empezó en 2025, no se generan
// modelos pendientes anteriores a este año.
const ANIO_INICIO_EJERCICIO = 2025;

// ─── Generador de vencimientos pendientes ──────────────────────────────────
// Devuelve los modelos pendientes desde el trimestre anterior hasta el actual + 1
function generarPendientes(presentados: ModeloAEAT[]): ModeloAEAT[] {
  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;
  const trimActual = Math.floor((mesActual - 1) / 3) + 1 as 1|2|3|4;

  const pendientes: ModeloAEAT[] = [];
  const presentadoKey = new Set(
    presentados.map(p => `${p.modelo}__${p.anio}__${p.trimestre ?? ''}`)
  );

  // Generar últimos 8 trimestres (2 años hacia atrás) de modelos trimestrales
  for (let offset = -8; offset <= 1; offset++) {
    const q = (trimActual - 1 + offset);
    const anioOffset = anioActual + Math.floor(q / 4);
    const trimOffset = ((q % 4) + 4) % 4 + 1 as 1|2|3|4;

    if (anioOffset < ANIO_INICIO_EJERCICIO) continue;

    for (const info of CATALOGO.filter(c => c.frecuencia === 'trimestral')) {
      const key = `${info.id}__${anioOffset}__${trimOffset}`;
      if (presentadoKey.has(key)) continue;
      const venc = calcVencimiento(info, anioOffset, trimOffset);
      if (!venc) continue;
      pendientes.push({
        id: `aeat-${anioOffset}-Q${trimOffset}-${info.id}`,
        modelo: info.id,
        periodo: `${anioOffset}-Q${trimOffset}`,
        anio: anioOffset,
        trimestre: trimOffset,
        fecha_vencimiento: venc,
        presentada: false,
      });
    }
  }

  // Anuales (solo cuando aplica: generar los 2 últimos años, respetando inicio ejercicio)
  for (const anio of [anioActual - 2, anioActual - 1, anioActual]) {
    if (anio < ANIO_INICIO_EJERCICIO) continue;
    for (const info of CATALOGO.filter(c => c.frecuencia === 'anual')) {
      const key = `${info.id}__${anio}__`;
      if (presentadoKey.has(key)) continue;
      const venc = calcVencimiento(info, anio);
      if (!venc) continue;
      pendientes.push({
        id: `aeat-${anio}-${info.id}`,
        modelo: info.id,
        periodo: String(anio),
        anio,
        fecha_vencimiento: venc,
        presentada: false,
      });
    }
  }

  // Ordenar por fecha de vencimiento
  return pendientes.sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
}

// ─── Calcula urgencia de un vencimiento ───────────────────────────────────
// Devolvemos clases Tailwind directas para evitar color-mix() (sin soporte en Safari <17)
function urgencia(fechaVenc: string): {
  status: 'vencido' | 'urgente' | 'proximo' | 'futuro';
  dias: number;
  label: string;
  textCls: string;       // clase Tailwind para texto
  bgCls: string;         // clase Tailwind para fondo
  borderCls: string;     // clase Tailwind para borde
} {
  const hoy = new Date();
  const v = new Date(fechaVenc + 'T23:59:59');
  const diff = Math.ceil((v.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));

  if (diff < 0)   return { status: 'vencido', dias: diff, label: `Vencido ${Math.abs(diff)}d`,
    textCls: 'text-[color:var(--arume-danger)]', bgCls: 'bg-[color:var(--arume-danger)]/10', borderCls: 'border-[color:var(--arume-danger)]/20' };
  if (diff <= 7)  return { status: 'urgente', dias: diff, label: diff === 0 ? 'Hoy vence' : `${diff}d`,
    textCls: 'text-[color:var(--arume-warn)]',   bgCls: 'bg-[color:var(--arume-warn)]/10',   borderCls: 'border-[color:var(--arume-warn)]/20' };
  if (diff <= 30) return { status: 'proximo', dias: diff, label: `${diff}d`,
    textCls: 'text-[color:var(--arume-gray-600)]', bgCls: 'bg-[color:var(--arume-gray-50)]', borderCls: 'border-[color:var(--arume-gray-200)]' };
  return              { status: 'futuro',  dias: diff, label: `${diff}d`,
    textCls: 'text-[color:var(--arume-gray-400)]', bgCls: 'bg-[color:var(--arume-gray-50)]', borderCls: 'border-[color:var(--arume-gray-100)]' };
}

// ═══════════════════════════════════════════════════════════════════════════
export const ModelosAEATView: React.FC<Props> = ({ data, onSave }) => {
  const modelos: ModeloAEAT[] = useMemo(() => Array.isArray(data.modelos_aeat) ? data.modelos_aeat : [], [data.modelos_aeat]);

  const [uploadingFor, setUploadingFor] = useState<ModeloAEAT | null>(null);
  const [importeInput, setImporteInput] = useState('');
  const [nrcInput, setNrcInput] = useState('');
  const [notasInput, setNotasInput] = useState('');
  const [fileInput, setFileInput] = useState<{ base64: string; name: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showHistorico, setShowHistorico] = useState(false);

  // Separar pendientes y presentados
  const presentados = useMemo(() => modelos.filter(m => m.presentada).sort((a, b) => b.fecha_vencimiento.localeCompare(a.fecha_vencimiento)), [modelos]);
  const pendientes = useMemo(() => generarPendientes(modelos), [modelos]);

  const urgentes = pendientes.filter(p => {
    const u = urgencia(p.fecha_vencimiento);
    return u.status === 'vencido' || u.status === 'urgente';
  });
  const proximos = pendientes.filter(p => urgencia(p.fecha_vencimiento).status === 'proximo');
  const futuros = pendientes.filter(p => urgencia(p.fecha_vencimiento).status === 'futuro');

  // Abrir modal para marcar como presentada
  const handleOpenPresentar = (m: ModeloAEAT) => {
    setUploadingFor(m);
    setImporteInput('');
    setNrcInput('');
    setNotasInput('');
    setFileInput(null);
  };

  const handleCloseModal = () => {
    setUploadingFor(null);
    setFileInput(null);
  };

  // Subir PDF
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64: string = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    setFileInput({ base64: b64, name: file.name });
  };

  // Guardar modelo como presentado
  const handleGuardar = async () => {
    if (!uploadingFor) return;
    if (!fileInput) {
      toast.warning('Sube el PDF del justificante antes de guardar.');
      return;
    }
    setIsSaving(true);
    try {
      const nuevo: ModeloAEAT = {
        ...uploadingFor,
        presentada: true,
        fecha_presentacion: new Date().toISOString().slice(0, 10),
        justificante_base64: fileInput.base64,
        justificante_nombre: fileInput.name,
        importe_pagado: parseFloat(importeInput.replace(',', '.')) || 0,
        nrc: nrcInput.trim() || undefined,
        notas: notasInput.trim() || undefined,
      };
      const newData = { ...data, modelos_aeat: [...modelos, nuevo] };
      await onSave(newData);
      toast.success(`✨ ${getInfoModelo(uploadingFor.modelo).nombre} registrado`);
      triggerConfetti(); // 🎉 un modelo menos del que preocuparse
      handleCloseModal();
    } catch (err: any) {
      toast.error('Error al guardar: ' + (err?.message || 'desconocido'));
    } finally {
      setIsSaving(false);
    }
  };

  // Descargar justificante
  const handleDescargar = (m: ModeloAEAT) => {
    if (!m.justificante_base64) {
      toast.info('No hay justificante guardado para este modelo.');
      return;
    }
    const a = document.createElement('a');
    a.href = m.justificante_base64;
    a.download = m.justificante_nombre || `${m.modelo}-${m.periodo}.pdf`;
    a.click();
  };

  // Eliminar modelo presentado
  const handleEliminar = async (m: ModeloAEAT) => {
    const ok = await confirm({
      title: `Eliminar ${getInfoModelo(m.modelo).nombre} ${formatPeriodo(m)}`,
      message: 'El registro y el justificante se eliminarán. Volverá a aparecer como pendiente.',
      danger: true,
    });
    if (!ok) return;
    const newData = { ...data, modelos_aeat: modelos.filter(x => x.id !== m.id) };
    await onSave(newData);
    toast.info('Modelo eliminado — vuelve a estar pendiente');
  };

  const getInfoModelo = (id: ModeloAEATId) => CATALOGO.find(c => c.id === id) || CATALOGO[0];

  // ─── Render item pendiente ──────────────────────────────────────────────
  const renderPendiente = (m: ModeloAEAT) => {
    const info = getInfoModelo(m.modelo);
    const urg = urgencia(m.fecha_vencimiento);
    return (
      <div key={m.id}
        className="bg-white border border-[color:var(--arume-gray-100)] rounded-2xl p-4 flex items-center gap-4 hover:shadow-sm transition">
        <div className={cn('w-12 h-12 rounded-full flex items-center justify-center border', urg.bgCls, urg.borderCls)}>
          <Calendar className={cn('w-5 h-5', urg.textCls)}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-serif text-lg font-semibold tracking-tight">{info.nombre}</p>
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] bg-[color:var(--arume-gray-50)] px-2 py-0.5 rounded-full border border-[color:var(--arume-gray-100)]">
              {formatPeriodo(m)}
            </span>
          </div>
          <p className="text-sm text-[color:var(--arume-gray-500)] mt-0.5">{info.descripcion}</p>
          <p className="text-[11px] text-[color:var(--arume-gray-400)] mt-1 tabular-nums">
            Vence: {m.fecha_vencimiento}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={cn('text-[10px] font-semibold uppercase tracking-[0.15em] px-3 py-1 rounded-full border', urg.textCls, urg.bgCls, urg.borderCls)}>
            {urg.label}
          </span>
          <button onClick={() => handleOpenPresentar(m)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition active:scale-[0.98]">
            <CheckCircle2 className="w-3.5 h-3.5"/> Marcar presentado
          </button>
        </div>
      </div>
    );
  };

  // ─── Render item presentado (histórico) ──────────────────────────────────
  const renderPresentado = (m: ModeloAEAT) => {
    const info = getInfoModelo(m.modelo);
    return (
      <div key={m.id}
        className="bg-white border border-[color:var(--arume-gray-100)] rounded-2xl p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-[color:var(--arume-ok)]/10 border border-[color:var(--arume-ok)]/20 flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5 text-[color:var(--arume-ok)]"/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-serif text-lg font-semibold tracking-tight">{info.nombre}</p>
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] bg-[color:var(--arume-gray-50)] px-2 py-0.5 rounded-full border border-[color:var(--arume-gray-100)]">
              {formatPeriodo(m)}
            </span>
          </div>
          <p className="text-[11px] text-[color:var(--arume-gray-500)] mt-0.5">
            Presentado el {m.fecha_presentacion} · {m.importe_pagado ? `${Num.fmt(m.importe_pagado)}` : 'Sin importe'}
            {m.nrc && <span className="ml-2 font-mono text-[color:var(--arume-gray-600)]">NRC: {m.nrc}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {m.justificante_base64 && (
            <button onClick={() => handleDescargar(m)}
              className="p-2 rounded-full border border-[color:var(--arume-gray-200)] text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)] hover:bg-[color:var(--arume-gray-50)] transition"
              title="Descargar justificante">
              <Download className="w-4 h-4"/>
            </button>
          )}
          <button onClick={() => handleEliminar(m)}
            className="p-2 rounded-full border border-[color:var(--arume-gray-200)] text-[color:var(--arume-gray-400)] hover:text-[color:var(--arume-danger)] hover:bg-[color:var(--arume-danger)]/10 hover:border-[color:var(--arume-danger)]/30 transition"
            title="Eliminar (volverá a pendiente)">
            <Trash2 className="w-4 h-4"/>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-24 max-w-[1200px] mx-auto">

      {/* HEADER */}
      <header className="relative overflow-hidden hero-breathing bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] p-6 md:p-8 rounded-2xl">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[color:var(--arume-gold)]/80"/>
        <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-[color:var(--arume-gold)]/5 pointer-events-none"/>
        <div className="relative z-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--arume-gold)]">Cierres · Fiscal</p>
          <h2 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight mt-2 flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-[color:var(--arume-gold)]"/> Modelos AEAT
          </h2>
          <p className="text-sm text-white/60 mt-1">Trimestrales, anuales y justificantes de presentación</p>
          <div className="flex items-center gap-2 mt-5 flex-wrap">
            {urgentes.length > 0 && (
              <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-danger)]/20 text-rose-200 border border-[color:var(--arume-danger)]/30 px-3 py-1.5 rounded-full">
                ⚠️ {urgentes.length} urgente{urgentes.length !== 1 ? 's' : ''}
              </span>
            )}
            {proximos.length > 0 && (
              <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-white/5 text-white/70 border border-white/10 px-3 py-1.5 rounded-full">
                {proximos.length} próximo{proximos.length !== 1 ? 's' : ''} (30d)
              </span>
            )}
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-white/5 text-white/70 border border-white/10 px-3 py-1.5 rounded-full">
              {presentados.length} presentado{presentados.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </header>

      {/* URGENTES */}
      {urgentes.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-[color:var(--arume-danger)]"/>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-danger)]">Urgente · acción requerida</p>
          </div>
          <div className="space-y-2">
            {urgentes.map(renderPendiente)}
          </div>
        </section>
      )}

      {/* PRÓXIMOS */}
      {proximos.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-[color:var(--arume-gray-500)]"/>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Próximos 30 días</p>
          </div>
          <div className="space-y-2">
            {proximos.map(renderPendiente)}
          </div>
        </section>
      )}

      {/* FUTUROS */}
      {futuros.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-[color:var(--arume-gray-400)]"/>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-400)]">Más adelante</p>
          </div>
          <div className="space-y-2">
            {futuros.slice(0, 6).map(renderPendiente)}
          </div>
          {futuros.length > 6 && (
            <p className="text-[11px] text-[color:var(--arume-gray-400)] mt-2 text-center">
              (+{futuros.length - 6} futuros — aparecerán a medida que se acerquen)
            </p>
          )}
        </section>
      )}

      {/* HISTÓRICO */}
      <section>
        <button onClick={() => setShowHistorico(s => !s)}
          className="w-full flex items-center justify-between bg-white border border-[color:var(--arume-gray-100)] rounded-2xl p-4 hover:shadow-sm transition">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-[color:var(--arume-ok)]"/>
            <div className="text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Histórico</p>
              <p className="font-serif text-lg font-semibold">{presentados.length} modelos presentados</p>
            </div>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-400)]">
            {showHistorico ? 'Ocultar' : 'Ver todo'}
          </span>
        </button>
        <AnimatePresence>
          {showHistorico && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="space-y-2 mt-2">
                {presentados.length === 0 ? (
                  <EmptyState
                    icon={ShieldCheck}
                    eyebrow="Sin histórico"
                    title="Aún no has presentado ningún modelo"
                    message="Cuando marques un modelo como presentado aparecerá aquí con su justificante."
                    size="sm"
                  />
                ) : presentados.map(renderPresentado)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* MODAL: marcar como presentada */}
      <AnimatePresence>
        {uploadingFor && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[color:var(--arume-ink)]/70 backdrop-blur-sm cursor-default"
              onClick={handleCloseModal}
            />
            <motion.div
              initial={{ y: 30, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 30, opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative bg-[color:var(--arume-paper)] w-full max-w-lg rounded-2xl z-10 overflow-hidden"
              style={{ boxShadow: '0 24px 80px rgba(11,11,12,0.35)' }}
            >
              <span className="absolute top-0 left-0 right-0 h-[2px] bg-[color:var(--arume-gold)]"/>

              <div className="p-6 border-b border-[color:var(--arume-gray-100)] flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Registrar presentación</p>
                  <h3 className="font-serif text-xl font-semibold mt-0.5">
                    {getInfoModelo(uploadingFor.modelo).nombre} · {formatPeriodo(uploadingFor)}
                  </h3>
                </div>
                <button onClick={handleCloseModal}
                  className="p-2 bg-[color:var(--arume-gray-50)] rounded-full hover:bg-[color:var(--arume-gray-100)] transition">
                  <X className="w-4 h-4"/>
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Importe pagado */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] mb-1.5 block">
                    Importe pagado (€)
                  </label>
                  <input type="text" value={importeInput} onChange={e => setImporteInput(e.target.value)}
                    placeholder="0,00 — negativo si devolución"
                    className="w-full px-4 py-2.5 rounded-xl bg-white border border-[color:var(--arume-gray-200)] text-sm outline-none focus:border-[color:var(--arume-ink)] transition"/>
                </div>

                {/* NRC */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] mb-1.5 block">
                    NRC (opcional)
                  </label>
                  <input type="text" value={nrcInput} onChange={e => setNrcInput(e.target.value)}
                    placeholder="Número de referencia AEAT"
                    className="w-full px-4 py-2.5 rounded-xl bg-white border border-[color:var(--arume-gray-200)] text-sm font-mono outline-none focus:border-[color:var(--arume-ink)] transition"/>
                </div>

                {/* Notas */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] mb-1.5 block">
                    Notas (opcional)
                  </label>
                  <textarea value={notasInput} onChange={e => setNotasInput(e.target.value)}
                    placeholder="Ej: devolución aplazada / error detectado…"
                    rows={2}
                    className="w-full px-4 py-2.5 rounded-xl bg-white border border-[color:var(--arume-gray-200)] text-sm outline-none focus:border-[color:var(--arume-ink)] transition resize-none"/>
                </div>

                {/* PDF justificante */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] mb-1.5 block">
                    Justificante AEAT (PDF) *
                  </label>
                  <input ref={fileRef} type="file" accept="application/pdf,image/*" onChange={handleFileChange} className="hidden"/>
                  {fileInput ? (
                    <div className="flex items-center gap-2 p-3 bg-[color:var(--arume-ok)]/5 border border-[color:var(--arume-ok)]/20 rounded-xl">
                      <CheckCircle2 className="w-4 h-4 text-[color:var(--arume-ok)]"/>
                      <span className="flex-1 text-sm truncate">{fileInput.name}</span>
                      <button onClick={() => setFileInput(null)} className="text-[color:var(--arume-gray-400)] hover:text-[color:var(--arume-danger)]">
                        <X className="w-4 h-4"/>
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => fileRef.current?.click()}
                      className="w-full p-4 border-2 border-dashed border-[color:var(--arume-gray-200)] rounded-xl text-center hover:border-[color:var(--arume-ink)]/30 hover:bg-[color:var(--arume-gray-50)] transition">
                      <Upload className="w-5 h-5 mx-auto text-[color:var(--arume-gray-400)] mb-1"/>
                      <p className="text-sm font-semibold">Sube el PDF del justificante</p>
                      <p className="text-[11px] text-[color:var(--arume-gray-400)] mt-0.5">El que te manda la gestoría o descargas de AEAT</p>
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 border-t border-[color:var(--arume-gray-100)] flex gap-2 justify-end">
                <button onClick={handleCloseModal}
                  className="px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-600)] border border-[color:var(--arume-gray-200)] hover:bg-[color:var(--arume-gray-50)] transition">
                  Cancelar
                </button>
                <button onClick={handleGuardar} disabled={isSaving || !fileInput}
                  className="px-5 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition active:scale-[0.98] disabled:opacity-50 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5"/> Guardar presentación
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};
