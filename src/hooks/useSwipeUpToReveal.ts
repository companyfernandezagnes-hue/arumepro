import { useEffect, useRef } from 'react';

type Options = {
  edgeHeight?: number;
  minDeltaY?: number;
  minVelocity?: number;
  preventBounce?: boolean;
  onReveal: () => void;
  onlyCoarsePointer?: boolean;
};

export function useSwipeUpToReveal({
  edgeHeight = 40,
  minDeltaY = 30,
  minVelocity = 0.004,
  preventBounce = true,
  onReveal,
  onlyCoarsePointer = true,
}: Options) {
  const startY = useRef(0);
  const startT = useRef(0);
  const inEdgeZone = useRef(false);
  const triggered = useRef(false);

  useEffect(() => {
    if (onlyCoarsePointer && !window.matchMedia?.('(pointer: coarse)').matches) {
      return;
    }

    const onTouchStart = (e: TouchEvent) => {
      if (!e.touches || e.touches.length === 0) return;
      const y = e.touches[0].clientY;
      const h = window.innerHeight;

      inEdgeZone.current = (h - y) <= edgeHeight;
      triggered.current = false;

      if (inEdgeZone.current) {
        startY.current = y;
        startT.current = performance.now();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!inEdgeZone.current || triggered.current) return;

      const y = e.touches?.[0]?.clientY ?? startY.current;
      const dy = startY.current - y;
      const dt = Math.max(1, performance.now() - startT.current);
      const v = dy / dt;

      if (dy >= minDeltaY || v >= minVelocity) {
        triggered.current = true;
        onReveal();
        if (preventBounce) e.preventDefault?.();
      }
    };

    const onTouchEnd = () => { inEdgeZone.current = false; };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart as any);
      window.removeEventListener('touchmove', onTouchMove as any);
      window.removeEventListener('touchend', onTouchEnd as any);
    };
  }, [edgeHeight, minDeltaY, minVelocity, preventBounce, onReveal, onlyCoarsePointer]);
}
