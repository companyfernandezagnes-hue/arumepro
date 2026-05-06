import React, { useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

// ============================================================
// useToast - Hook global de notificaciones no bloqueantes
// Reemplaza los alert() nativos en CashView, BancoView, etc.
// ============================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, default 3500
}

// Singleton event bus (sin context, funciona en cualquier arbol)
type Listener = (t: Toast) => void;
const listeners: Listener[] = [];
let idCounter = 0;

export const toast = {
  success: (message: string, duration = 3500) =>
    emit({ id: String(++idCounter), type: 'success', message, duration }),
  error: (message: string, duration = 5000) =>
    emit({ id: String(++idCounter), type: 'error', message, duration }),
  warning: (message: string, duration = 4000) =>
    emit({ id: String(++idCounter), type: 'warning', message, duration }),
  info: (message: string, duration = 3500) =>
    emit({ id: String(++idCounter), type: 'info', message, duration }),
};

function emit(t: Toast) {
  listeners.forEach(fn => fn(t));
}

// Hook interno para el renderer
function useToastState() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler: Listener = (t) => setToasts(prev => [...prev, t]);
    listeners.push(handler);
    return () => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, dismiss };
}

// Componente Renderer - añadir UNA vez en App.tsx o en cada vista
// Tambien escucha el evento DOM 'arume:toast' para errores de servicios
// que no tienen acceso directo al singleton (ej: supabase.ts)
export function ToastRenderer() {
  const { toasts, dismiss } = useToastState();

  // Puente: escucha eventos DOM emitidos por servicios (ej: supabase.ts)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; type: ToastType }>).detail;
      if (detail?.message && detail?.type) {
        emit({
          id: String(++idCounter),
          type: detail.type,
          message: detail.message,
          duration: detail.type === 'error' ? 5000 : 3500,
        });
      }
    };
    window.addEventListener('arume:toast', handler);
    return () => window.removeEventListener('arume:toast', handler);
  }, []);

  return (
    <div className="fixed top-4 right-4 z-[10001] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// Item individual — estilo editorial Arume
const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--arume-ok)' }} />,
  error:   <XCircle      className="w-4 h-4 shrink-0" style={{ color: 'var(--arume-danger)' }} />,
  warning: <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--arume-warn)' }} />,
  info:    <Info          className="w-4 h-4 shrink-0" style={{ color: 'var(--arume-info)' }} />,
};

const ACCENT: Record<ToastType, string> = {
  success: 'var(--arume-ok)',
  error:   'var(--arume-danger)',
  warning: 'var(--arume-warn)',
  info:    'var(--arume-info)',
};

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(t.id), t.duration ?? 3500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [t.id, t.duration, onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className="pointer-events-auto relative flex items-center gap-3 pl-4 pr-3 py-3 rounded-xl bg-[color:var(--arume-paper)] border border-[color:var(--arume-gray-100)] max-w-sm w-full overflow-hidden"
      style={{ boxShadow: '0 12px 40px rgba(11,11,12,0.12)' }}
    >
      {/* Barra lateral de color según tipo */}
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: ACCENT[t.type] }} />
      {ICONS[t.type]}
      <p className="flex-1 text-sm font-medium text-[color:var(--arume-ink)] leading-snug">{t.message}</p>
      <button
        onClick={() => onDismiss(t.id)}
        className="text-[color:var(--arume-gray-300)] hover:text-[color:var(--arume-ink)] transition shrink-0"
        aria-label="Cerrar"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

// Hook de compatibilidad: permite usar toast como hook en componentes
// Uso: const { toast } = useToast();
export function useToast() {
  return { toast };
}
