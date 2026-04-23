// ============================================================================
// 💀 Skeleton — placeholder con shimmer animado mientras carga
// ============================================================================
import React from 'react';
import { cn } from '../lib/utils';

interface Props {
  className?: string;
  /** Alto. Por defecto h-4 (línea de texto) */
  height?: string;
  /** Ancho. Por defecto w-full */
  width?: string;
  /** Radio: 'sm' (rounded-md) | 'md' (rounded-xl) | 'full' (pill/circle) */
  radius?: 'sm' | 'md' | 'full';
  /** Cantidad de líneas (para listas) */
  lines?: number;
}

export const Skeleton: React.FC<Props> = ({
  className,
  height = 'h-4',
  width = 'w-full',
  radius = 'md',
  lines = 1,
}) => {
  const radiusCls = radius === 'sm' ? 'rounded-md' : radius === 'full' ? 'rounded-full' : 'rounded-xl';
  if (lines > 1) {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={cn('shimmer', height, i === lines - 1 ? 'w-2/3' : width, radiusCls)}/>
        ))}
      </div>
    );
  }
  return <div className={cn('shimmer', height, width, radiusCls, className)}/>;
};

/** Skeleton en forma de tarjeta KPI — número grande + label */
export const KpiSkeleton: React.FC = () => (
  <div className="bg-white border border-[color:var(--arume-gray-100)] rounded-2xl p-5">
    <Skeleton height="h-3" width="w-24" radius="sm"/>
    <div className="mt-3">
      <Skeleton height="h-7" width="w-32" radius="sm"/>
    </div>
    <div className="mt-2">
      <Skeleton height="h-3" width="w-20" radius="sm"/>
    </div>
  </div>
);

/** Skeleton de fila de lista (factura, movimiento banco, etc.) */
export const RowSkeleton: React.FC = () => (
  <div className="bg-white border border-[color:var(--arume-gray-100)] rounded-xl p-4 flex items-center gap-3">
    <Skeleton width="w-10" height="h-10" radius="full"/>
    <div className="flex-1">
      <Skeleton height="h-4" width="w-1/2" radius="sm"/>
      <div className="mt-1.5">
        <Skeleton height="h-3" width="w-1/3" radius="sm"/>
      </div>
    </div>
    <Skeleton height="h-6" width="w-20" radius="sm"/>
  </div>
);
