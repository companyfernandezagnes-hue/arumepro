import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Trash2, HelpCircle } from 'lucide-react';
import { cn } from '../lib/utils';

// ============================================================
// 🛡️ useConfirm — Reemplaza window.confirm() con modal React
// Compatible con iOS Safari PWA donde confirm() está bloqueado
//
// Uso simple (string — retrocompatible con window.confirm):
//   const ok = await confirm('¿Eliminar este elemento?');
//
// Uso avanzado (objeto):
//   const ok = await confirm({
//     title: '¿Eliminar factura?',
//     message: 'Los albaranes volverán a la sala de espera.',
//     danger: true,
//     confirmLabel: 'Sí, eliminar',
//   });
// ============================================================

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Rojo — para eliminar, borrar, purgar */
  danger?: boolean;
  /** Ámbar — para advertencias (continuar sin datos, valores vacíos...) */
  warning?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

// ── Singleton global — un solo modal activo en toda la app ───────────────────
let _setConfirmState: React.Dispatch<React.SetStateAction<ConfirmState | null>> | null = null;

/**
 * Muestra el modal de confirmación.
 * Acepta string (retrocompatible) o ConfirmOptions.
 * Devuelve true si el usuario confirma, false si cancela o cierra.
 */
export function confirm(opts: ConfirmOptions | string): Promise<boolean> {
  // Normalizar string → objeto
  if (typeof opts === 'string') {
    const isDanger  = /🛑|eliminar|borrar|archivar|limpiar/i.test(opts);
    const isWarning = /⚠️|continuar|sin número|quedarán en blanco/i.test(opts);
    const lines     = opts.split('\n').map(l => l.replace(/^[⚠️🛑✅❌📎🗑️\s]+/, '').trim()).filter(Boolean);
    opts = {
      title:   lines[0] || opts,
      message: lines.slice(1).join('\n') || undefined,
      danger:  isDanger,
      warning: isWarning && !isDanger,
    };
  }

  return new Promise((resolve) => {
    if (!_setConfirmState) {
      // Fallback si ConfirmProvider no está montado todavía
      resolve(window.confirm(opts.title + (opts.message ? '\n\n' + opts.message : '')));
      return;
    }
    _setConfirmState({ ...opts, resolve });
  });
}

/**
 * Montar UNA sola vez en App.tsx, junto a <ToastRenderer />.
 * No necesita props.
 */
export function ConfirmProvider() {
  const [state, setState] = useState<ConfirmState | null>(null);

  React.useEffect(() => {
    _setConfirmState = setState;
    return () => { _setConfirmState = null; };
  }, []);

  const handleResolve = useCallback((value: boolean) => {
    state?.resolve(value);
    setState(null);
  }, [state]);

  // Atajos de teclado: Enter confirma, Escape cancela
  React.useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleResolve(false);
      if (e.key === 'Enter')  handleResolve(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, handleResolve]);

  // ── Variante visual ─────────────────────────────────────────────────────────
  const variant = state?.danger ? 'danger' : state?.warning ? 'warning' : 'info';

  const CFG = {
    danger:  { icon: <Trash2        className="w-5 h-5" style={{ color: 'var(--arume-danger)' }} />, accent: 'var(--arume-danger)', btnBg: 'bg-[color:var(--arume-danger)] hover:brightness-95', label: 'Eliminar'  },
    warning: { icon: <AlertTriangle className="w-5 h-5" style={{ color: 'var(--arume-warn)'   }} />, accent: 'var(--arume-warn)',   btnBg: 'bg-[color:var(--arume-warn)] hover:brightness-95',   label: 'Continuar' },
    info:    { icon: <HelpCircle    className="w-5 h-5" style={{ color: 'var(--arume-ink)'    }} />, accent: 'var(--arume-ink)',    btnBg: 'bg-[color:var(--arume-ink)] hover:bg-[color:var(--arume-gray-700)]', label: 'Confirmar' },
  } as const;

  const cfg = CFG[variant];

  return (
    <AnimatePresence>
      {state && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-[color:var(--arume-ink)]/70 backdrop-blur-sm"
          onClick={() => handleResolve(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="relative bg-[color:var(--arume-paper)] rounded-2xl w-full max-w-sm p-7 flex flex-col gap-5 overflow-hidden"
            style={{ boxShadow: '0 24px 80px rgba(11,11,12,0.35)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Línea acento superior */}
            <span className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: cfg.accent }} />

            {/* Icono + label variante */}
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full flex items-center justify-center bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)]">
                {cfg.icon}
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">
                {variant === 'danger' ? 'Confirmar eliminación' : variant === 'warning' ? 'Confirmar acción' : 'Confirmar'}
              </p>
            </div>

            {/* Texto */}
            <div className="space-y-2">
              <h3 className="font-serif text-xl font-semibold tracking-tight leading-snug text-[color:var(--arume-ink)]">{state.title}</h3>
              {state.message && (
                <p className="text-sm text-[color:var(--arume-gray-500)] leading-relaxed whitespace-pre-line">{state.message}</p>
              )}
            </div>

            {/* Atajo de teclado */}
            <p className="text-[10px] font-semibold text-[color:var(--arume-gray-300)] uppercase tracking-[0.15em]">
              Enter confirma · Esc cancela
            </p>

            {/* Botones */}
            <div className="flex gap-2">
              <button
                onClick={() => handleResolve(false)}
                className="flex-1 py-2.5 px-4 rounded-full border border-[color:var(--arume-gray-200)] text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-600)] hover:bg-[color:var(--arume-gray-50)] transition active:scale-[0.98]"
              >
                {state.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                autoFocus
                onClick={() => handleResolve(true)}
                className={cn('flex-1 py-2.5 px-4 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] text-white transition active:scale-[0.98]', cfg.btnBg)}
              >
                {state.confirmLabel ?? cfg.label}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
