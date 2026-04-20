// ============================================================================
// 🪴 EmptyState — Componente reutilizable para vistas vacías
// Patrón editorial Arume: icono en círculo fino + título serif + texto cuerpo
// + acción opcional en pill negro o dorado.
// ============================================================================
import React from 'react';
import { cn } from '../lib/utils';

interface EmptyStateProps {
  /** Icono Lucide como componente (no instanciado) */
  icon?: React.ComponentType<{ className?: string }>;
  /** Label pequeño en uppercase editorial encima del título */
  eyebrow?: string;
  /** Título en serif grande */
  title: string;
  /** Descripción cuerpo */
  message?: string;
  /** Botón de acción opcional */
  action?: {
    label: string;
    onClick: () => void;
    /** 'primary' = pill negro ink, 'gold' = pill dorado, 'ghost' = borde */
    variant?: 'primary' | 'gold' | 'ghost';
    icon?: React.ComponentType<{ className?: string }>;
  };
  /** Tamaño: 'sm' para paneles pequeños, 'md' para módulos enteros */
  size?: 'sm' | 'md';
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  eyebrow,
  title,
  message,
  action,
  size = 'md',
  className,
}) => {
  const ActionIcon = action?.icon;
  const isLarge = size === 'md';

  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      isLarge ? 'py-16 px-6' : 'py-10 px-4',
      className,
    )}>
      {Icon && (
        <div className={cn(
          'rounded-full flex items-center justify-center mb-5 border bg-[color:var(--arume-gray-50)] border-[color:var(--arume-gray-100)]',
          isLarge ? 'w-16 h-16' : 'w-12 h-12',
        )}>
          <Icon className={cn(
            'text-[color:var(--arume-gray-400)]',
            isLarge ? 'w-7 h-7' : 'w-5 h-5',
          )}/>
        </div>
      )}

      {eyebrow && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)] mb-1.5">
          {eyebrow}
        </p>
      )}

      <h3 className={cn(
        'font-serif font-semibold tracking-tight text-[color:var(--arume-ink)]',
        isLarge ? 'text-2xl md:text-3xl' : 'text-lg',
      )}>
        {title}
      </h3>

      {message && (
        <p className={cn(
          'text-[color:var(--arume-gray-500)] max-w-md mt-2 leading-relaxed',
          isLarge ? 'text-sm' : 'text-xs',
        )}>
          {message}
        </p>
      )}

      {action && (
        <button
          onClick={action.onClick}
          className={cn(
            'mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] transition active:scale-[0.98]',
            action.variant === 'gold'
              ? 'bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] hover:brightness-95'
              : action.variant === 'ghost'
              ? 'bg-transparent border border-[color:var(--arume-gray-200)] text-[color:var(--arume-gray-600)] hover:bg-[color:var(--arume-gray-50)]'
              : 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)]'
          )}
        >
          {ActionIcon && <ActionIcon className="w-3.5 h-3.5" />}
          {action.label}
        </button>
      )}
    </div>
  );
};
