// ============================================================================
// 📅 FixYearsModal — corrector masivo de años incorrectos en albaranes/facturas
// Detecta documentos con año fuera de [actual-2, actual+1] y permite corregir
// el año en bloque (manteniendo día y mes originales).
// ============================================================================
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, AlertTriangle, Calendar, CheckCircle2, Search,
} from 'lucide-react';
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';
import { EmptyState } from './EmptyState';
import { triggerConfetti } from './Confetti';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

interface DocSospechoso {
  tipo: 'factura' | 'albaran';
  id: string;
  prov: string;
  num: string;
  dateActual: string;        // YYYY-MM-DD
  yearActual: number;
  dateNueva: string;          // propuesta
  yearNuevo: number;
  total: number;
  motivo: string;
}

const YEAR_NOW = new Date().getFullYear();
const YEAR_MIN = YEAR_NOW - 2;
const YEAR_MAX = YEAR_NOW + 1;

export const FixYearsModal: React.FC<Props> = ({ isOpen, onClose, data, onSave }) => {
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [yearObjetivo, setYearObjetivo] = useState(YEAR_NOW);

  // Detectar documentos sospechosos
  const sospechosos = useMemo<DocSospechoso[]>(() => {
    const out: DocSospechoso[] = [];
    const ahora = new Date();

    const procesar = (docs: any[], tipo: 'factura' | 'albaran') => {
      for (const d of docs) {
        if (!d || tipo === 'factura' && d.tipo === 'caja') continue;
        const date = String(d.date || d.fecha || '');
        const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) continue;
        const y = parseInt(m[1], 10);
        const mm = m[2];
        const dd = m[3];

        let motivo = '';
        if (y < YEAR_MIN) motivo = `Año ${y} demasiado antiguo`;
        else if (y > YEAR_MAX) motivo = `Año ${y} futuro anómalo`;
        else {
          // Año razonable, pero ¿quizás +365 días atrás?
          const parsed = new Date(date + 'T12:00:00');
          const diffDays = Math.floor((ahora.getTime() - parsed.getTime()) / 86_400_000);
          if (diffDays > 400) motivo = `Hace ${Math.floor(diffDays / 365)} año(s) — revisa`;
        }
        if (!motivo) continue;

        out.push({
          tipo,
          id: d.id,
          prov: String(d.prov || d.proveedor || d.cliente || '—'),
          num: String(d.num || 'S/N'),
          dateActual: date,
          yearActual: y,
          dateNueva: `${yearObjetivo}-${mm}-${dd}`,
          yearNuevo: yearObjetivo,
          total: Math.abs(Num.parse(d.total || 0)),
          motivo,
        });
      }
    };

    procesar(data.facturas || [], 'factura');
    procesar(data.albaranes || [], 'albaran');
    // Ordenar por año ascendente (los más raros arriba)
    out.sort((a, b) => a.yearActual - b.yearActual);
    return out;
  }, [data.facturas, data.albaranes, yearObjetivo]);

  const toggleAll = () => {
    if (seleccionados.size === sospechosos.length) {
      setSeleccionados(new Set());
    } else {
      setSeleccionados(new Set(sospechosos.map(s => `${s.tipo}__${s.id}`)));
    }
  };

  const toggleOne = (tipo: string, id: string) => {
    const key = `${tipo}__${id}`;
    const next = new Set(seleccionados);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSeleccionados(next);
  };

  const aplicar = async () => {
    if (seleccionados.size === 0) {
      toast.info('Selecciona al menos uno.');
      return;
    }
    setSaving(true);
    try {
      const newData = JSON.parse(JSON.stringify(data)) as AppData;
      let facturasCount = 0, albaranesCount = 0;

      if (newData.facturas) {
        newData.facturas = newData.facturas.map((f: any) => {
          if (seleccionados.has(`factura__${f.id}`)) {
            const d = String(f.date || f.fecha || '');
            const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (m) {
              const newDate = `${yearObjetivo}-${m[2]}-${m[3]}`;
              facturasCount++;
              return { ...f, date: newDate, fecha: newDate, reviewed: true };
            }
          }
          return f;
        });
      }
      if (newData.albaranes) {
        newData.albaranes = newData.albaranes.map((a: any) => {
          if (seleccionados.has(`albaran__${a.id}`)) {
            const d = String(a.date || a.fecha || '');
            const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (m) {
              const newDate = `${yearObjetivo}-${m[2]}-${m[3]}`;
              albaranesCount++;
              return { ...a, date: newDate, fecha: newDate };
            }
          }
          return a;
        });
      }

      await onSave(newData);
      toast.success(`✨ Corregidos ${facturasCount} factura${facturasCount !== 1 ? 's' : ''} + ${albaranesCount} albarán${albaranesCount !== 1 ? 'es' : ''}`);
      triggerConfetti();
      setSeleccionados(new Set());
      onClose();
    } catch (err: any) {
      toast.error('Error al guardar: ' + (err?.message || 'desconocido'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-[color:var(--arume-ink)]/70 backdrop-blur-sm cursor-default"
          onClick={onClose}
        />
        <motion.div
          initial={{ y: 40, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0, scale: 0.97 }}
          className="relative bg-[color:var(--arume-paper)] w-full max-w-3xl max-h-[90vh] rounded-2xl flex flex-col overflow-hidden"
          style={{ boxShadow: '0 24px 80px rgba(11,11,12,0.35)' }}
        >
          <span className="absolute top-0 left-0 right-0 h-[2px] bg-[color:var(--arume-warn)]"/>

          {/* Header */}
          <div className="p-6 border-b border-[color:var(--arume-gray-100)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-warn)]">⚠ Corrector de años</p>
                <h3 className="font-serif text-2xl font-semibold tracking-tight mt-1">Documentos con fecha sospechosa</h3>
                <p className="text-sm text-[color:var(--arume-gray-500)] mt-1">
                  La IA a veces lee mal el año. Aquí puedes corregirlos en bloque — se mantiene el día y mes originales.
                </p>
              </div>
              <button onClick={onClose}
                className="p-2 bg-[color:var(--arume-gray-50)] rounded-full hover:bg-[color:var(--arume-gray-100)] transition">
                <X className="w-4 h-4"/>
              </button>
            </div>

            {sospechosos.length > 0 && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <div>
                  <label className="text-[10px] font-black text-[color:var(--arume-gray-500)] uppercase tracking-[0.15em] block mb-1">Cambiar año a</label>
                  <select value={yearObjetivo} onChange={e => setYearObjetivo(parseInt(e.target.value))}
                    className="bg-white border border-[color:var(--arume-gray-200)] rounded-xl px-4 py-2 text-sm font-bold outline-none focus:border-[color:var(--arume-ink)]">
                    {[YEAR_NOW - 1, YEAR_NOW, YEAR_NOW + 1].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <button onClick={toggleAll}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-200)] text-[color:var(--arume-gray-600)] hover:bg-white transition self-end">
                  {seleccionados.size === sospechosos.length ? 'Deseleccionar' : 'Seleccionar todos'}
                </button>
                <div className="ml-auto self-end text-[11px] font-semibold text-[color:var(--arume-gray-500)]">
                  {seleccionados.size}/{sospechosos.length} seleccionado{seleccionados.size !== 1 ? 's' : ''}
                </div>
              </div>
            )}
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto p-5">
            {sospechosos.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                eyebrow="Sin sospechas"
                title="¡Todas las fechas están bien!"
                message={`No hay documentos con año fuera de ${YEAR_MIN}-${YEAR_MAX} ni con fechas extrañas.`}
              />
            ) : (
              <div className="space-y-2">
                {sospechosos.map((s) => {
                  const key = `${s.tipo}__${s.id}`;
                  const checked = seleccionados.has(key);
                  return (
                    <button key={key} onClick={() => toggleOne(s.tipo, s.id)}
                      className={cn('w-full text-left flex items-center gap-3 p-3 rounded-xl border transition',
                        checked
                          ? 'bg-[color:var(--arume-warn)]/10 border-[color:var(--arume-warn)]/40 shadow-sm'
                          : 'bg-white border-[color:var(--arume-gray-100)] hover:border-[color:var(--arume-warn)]/30')}>
                      <input type="checkbox" checked={checked} readOnly
                        className="w-4 h-4 accent-[color:var(--arume-warn)] pointer-events-none"/>
                      <span className={cn('text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full shrink-0',
                        s.tipo === 'albaran' ? 'bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-600)] border border-[color:var(--arume-gray-200)]'
                        : 'bg-[color:var(--arume-ink)]/5 text-[color:var(--arume-ink)] border border-[color:var(--arume-gray-200)]')}>
                        {s.tipo === 'albaran' ? '📦 Albarán' : '🧾 Factura'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-[color:var(--arume-ink)] truncate">{s.prov}</p>
                        <p className="text-[11px] text-[color:var(--arume-gray-500)] font-mono">{s.num} · {Num.fmt(s.total)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-sm text-[color:var(--arume-danger)] line-through tabular-nums">{s.dateActual}</span>
                        <span className="text-[color:var(--arume-gray-400)]">→</span>
                        <span className="font-mono text-sm text-[color:var(--arume-ok)] font-semibold tabular-nums">{`${yearObjetivo}-${s.dateActual.slice(5)}`}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {sospechosos.length > 0 && (
            <div className="p-4 border-t border-[color:var(--arume-gray-100)] bg-[color:var(--arume-gray-50)] flex items-center justify-between gap-3">
              <p className="text-[11px] text-[color:var(--arume-gray-500)]">
                Solo cambia el <b>año</b>. Día, mes y resto de datos se mantienen.
              </p>
              <div className="flex gap-2">
                <button onClick={onClose}
                  className="px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-600)] border border-[color:var(--arume-gray-200)] hover:bg-white transition">
                  Cancelar
                </button>
                <button onClick={aplicar} disabled={saving || seleccionados.size === 0}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition active:scale-[0.98] disabled:opacity-50">
                  {saving ? 'Guardando…' : `Corregir ${seleccionados.size}`}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
