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
    danger:  { iconBg: 'bg-rose-50',   icon: <Trash2     className="w-6 h-6 text-rose-500"   />, btn: 'bg-rose-500 hover:bg-rose-600',     label: 'Eliminar'   },
    warning: { iconBg: 'bg-amber-50',  icon: <AlertTriangle className="w-6 h-6 text-amber-500"/>, btn: 'bg-amber-500 hover:bg-amber-600',   label: 'Continuar'  },
    info:    { iconBg: 'bg-indigo-50', icon: <HelpCircle  className="w-6 h-6 text-indigo-500"/>, btn: 'bg-indigo-600 hover:bg-indigo-700', label: 'Confirmar'  },
  } as const;

  const cfg = CFG[variant];

  return (
    <AnimatePresence>
      {state && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          onClick={() => handleResolve(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.93, y: 10 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.93, y: 10 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5"
            onClick={e => e.stopPropagation()}
          >
            {/* Icono */}
            <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center mx-auto shadow-sm', cfg.iconBg)}>
              {cfg.icon}
            </div>

            {/* Texto */}
            <div className="text-center space-y-1.5">
              <h3 className="text-base font-black text-slate-800 leading-snug">{state.title}</h3>
              {state.message && (
                <p className="text-xs text-slate-500 leading-relaxed whitespace-pre-line">{state.message}</p>
              )}
            </div>

            {/* Atajo de teclado */}
            <p className="text-center text-[9px] font-bold text-slate-300 uppercase tracking-widest -mt-2">
              Enter para confirmar · Esc para cancelar
            </p>

            {/* Botones */}
            <div className="flex gap-3">
              <button
                onClick={() => handleResolve(false)}
                className="flex-1 py-3 px-4 rounded-2xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 transition-colors active:scale-95"
              >
                {state.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                autoFocus
                onClick={() => handleResolve(true)}
                className={cn('flex-1 py-3 px-4 rounded-2xl text-xs font-black text-white transition-all shadow-lg active:scale-95', cfg.btn)}
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
