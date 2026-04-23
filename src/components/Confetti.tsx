// ============================================================================
// 🎉 Confetti — explosión dorada para momentos de éxito
// Uso: triggerConfetti() desde cualquier sitio
// Monta <ConfettiRenderer/> una vez en App.tsx
// ============================================================================
import React, { useEffect, useState } from 'react';

type Particle = {
  id: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  rotation: number;
  size: number;
  color: string;
  life: number;
};

let emit: ((origin?: { x: number; y: number }) => void) | null = null;

/**
 * Lanza confetti dorado desde el centro de la pantalla (o desde un punto dado).
 * Ejemplo al guardar algo importante:
 *   import { triggerConfetti } from './Confetti';
 *   triggerConfetti();
 */
export const triggerConfetti = (origin?: { x: number; y: number }) => {
  emit?.(origin);
};

export const ConfettiRenderer: React.FC = () => {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    emit = (origin) => {
      const cx = origin?.x ?? window.innerWidth / 2;
      const cy = origin?.y ?? window.innerHeight / 2;
      const colors = ['#C9A86A', '#E0B77A', '#E08B5A', '#FAFAF7', '#8B1E2B'];
      const batch: Particle[] = Array.from({ length: 60 }).map((_, i) => ({
        id: Date.now() + i,
        x: cx,
        y: cy,
        angle: Math.random() * Math.PI * 2,
        speed: 4 + Math.random() * 8,
        rotation: Math.random() * 360,
        size: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0,
      }));
      setParticles((prev) => [...prev, ...batch]);
    };
    return () => { emit = null; };
  }, []);

  useEffect(() => {
    if (particles.length === 0) return;
    const id = setInterval(() => {
      setParticles((prev) =>
        prev
          .map((p) => ({
            ...p,
            x: p.x + Math.cos(p.angle) * p.speed,
            y: p.y + Math.sin(p.angle) * p.speed + p.life * 0.4, // gravedad
            rotation: p.rotation + 8,
            speed: p.speed * 0.96,
            life: p.life + 1,
          }))
          .filter((p) => p.life < 60)
      );
    }, 16);
    return () => clearInterval(id);
  }, [particles.length]);

  if (particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size * 0.4,
            background: p.color,
            transform: `rotate(${p.rotation}deg)`,
            opacity: Math.max(0, 1 - p.life / 60),
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
};
