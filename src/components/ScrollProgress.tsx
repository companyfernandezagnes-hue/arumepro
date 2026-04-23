// ============================================================================
// 📜 ScrollProgress — barra dorada fina arriba que indica progreso de scroll
// Se monta una vez en App.
// ============================================================================
import React, { useEffect, useState } from 'react';

export const ScrollProgress: React.FC = () => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (total <= 0) { setProgress(0); return; }
      setProgress(Math.min(100, (scrolled / total) * 100));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 z-[500] h-[2px] pointer-events-none transition-[width] duration-75 ease-out"
      style={{
        width: `${progress}%`,
        background: 'linear-gradient(90deg, transparent 0%, #C9A86A 50%, #E08B5A 100%)',
      }}
    />
  );
};
