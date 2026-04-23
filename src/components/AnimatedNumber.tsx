// ============================================================================
// 🎰 AnimatedNumber — contador que anima de 0 al valor objetivo
// Uso: <AnimatedNumber value={1240} format={Num.fmt} duration={900}/>
// ============================================================================
import React, { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}

export const AnimatedNumber: React.FC<Props> = ({
  value,
  format = (n) => n.toLocaleString('es-ES'),
  duration = 900,
  className,
}) => {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef(0);

  useEffect(() => {
    // Guardamos desde dónde empieza (para que re-renders cambien desde el valor actual, no desde 0)
    startValueRef.current = display;
    startTimeRef.current = null;

    const tick = (now: number) => {
      if (startTimeRef.current === null) startTimeRef.current = now;
      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / duration, 1);
      // Easing out-expo — empieza rápido, termina suave (sensación satisfactoria)
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const current = startValueRef.current + (value - startValueRef.current) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <span className={className}>{format(display)}</span>;
};
