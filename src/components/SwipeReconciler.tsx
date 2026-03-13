import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Sparkles, ArrowDownLeft, Search, X as CloseIcon, Zap } from 'lucide-react';
import { AppData, BankMovement } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
// 🚀 Importamos el cerebro 
import { findMatches, executeLink } from '../services/bancoLogic';

export interface SwipeReconcilerProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  onClose: () => void;
}

/* =======================================================
 * 🎨 COMPONENTE: Rayo de Energía (Para mostrar el enlace)
 * ======================================================= */
const EnergyBeam = ({ sourceId, targetId, isActive }: { sourceId: string, targetId: string, isActive: boolean }) => {
  const [coords, setCoords] = useState<{x1: number, y1: number, x2: number, y2: number} | null>(null);

  useEffect(() => {
    const update = () => {
      const el1 = document.getElementById(sourceId);
      const el2 = document.getElementById(targetId);
      if (el1 && el2) {
        const r1 = el1.getBoundingClientRect();
        const r2 = el2.getBoundingClientRect();
        setCoords({
          x1: r1.left + r1.width / 2,
          y1: r1.bottom,
          x2: r2.left + r2.width / 2,
          y2: r2.top
        });
      }
    };
    // Pequeño timeout para dar tiempo a framer-motion a posicionar los elementos
    const t = setTimeout(update, 200);
    window.addEventListener('resize', update);
    return () => { clearTimeout(t); window.removeEventListener('resize', update); };
  }, [sourceId, targetId]);

  if (!coords) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none z-0 w-full h-full" style={{ overflow: 'visible' }}>
      <motion.path
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: isActive ? 1 : 0.3 }}
        d={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1 + 50}, ${coords.x2} ${coords.y2 - 50}, ${coords.x2} ${coords.y2}`}
        stroke={isActive ? "#10b981" : "#818cf8"} // Emerald en hover, Indigo por defecto
        strokeWidth={isActive ? "4" : "2"}
        fill="none"
        strokeDasharray={isActive ? "none" : "4 4"}
        className="transition-all duration-300"
        style={{ filter: isActive ? "drop-shadow(0 0 8px #34d399)" : "none" }}
      />
      {isActive && (
        <circle r="6" fill="#34d399" style={{ filter: "drop-shadow(0 0 10px #10b981)" }}>
          <animateMotion dur="0.8s" repeatCount="1" path={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1 + 50}, ${coords.x2} ${coords.y2 - 50}, ${coords.x2} ${coords.y2}`} />
        </circle>
      )}
    </svg>
  );
};


export const SwipeReconciler: React.FC<SwipeReconcilerProps> = ({ data, onSave, onClose }) => {
  const pendingMovements = useMemo(() => {
    return (data.banco || []).filter((b: BankMovement) => b.status === 'pending');
  }, [data.banco]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [hoveredMatch, setHoveredMatch] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && !isLinking) next();
      if (e.key === 'Escape' && !isLinking) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, pendingMovements.length, isLinking]);

  const next = () => setCurrentIndex(prev => prev + 1);

  if (pendingMovements.length === 0 || currentIndex >= pendingMovements.length) {
    return (
      <div className="fixed inset-0 z-[1000] flex justify-center items-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/95 backdrop-blur-xl" />
        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative z-10 flex flex-col items-center text-center">
          <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center mb-6 shadow-[0_0_60px_-10px_rgba(16,185,129,0.5)]">
            <CheckCircle2 className="w-12 h-12 text-white" />
          </div>
          <h2 className="text-4xl font-black text-white tracking-tighter mb-2">¡Todo al día!</h2>
          <p className="text-emerald-400 font-bold uppercase tracking-widest mb-8">No hay más movimientos pendientes</p>
          <button onClick={onClose} className="bg-white text-slate-900 px-8 py-4 rounded-full font-black text-sm hover:scale-105 transition shadow-xl">
            VOLVER AL PANEL
          </button>
        </motion.div>
      </div>
    );
  }

  const currentItem = pendingMovements[currentIndex];

  // 🚀 USAMOS EL CEREBRO DE BUSQUEDA
  const matches = useMemo(() => {
    return findMatches(currentItem, data);
  }, [currentItem, data]);

  const handleLinkLocal = async (matchType: string, docId: string, comision: number = 0) => {
    if (isLinking) return;
    setIsLinking(true);
    setHoveredMatch(docId); // Forzamos el rayo láser en verde

    // Esperamos 800ms para que se vea la animación del rayo de energía
    await new Promise(r => setTimeout(r, 800));

    try {
      const newData = JSON.parse(JSON.stringify(data));
      executeLink(newData, currentItem.id, matchType, docId, comision); 
      await onSave(newData);
      // La lista de pendientes se actualizará sola, pero avanzamos el index por seguridad visual
      next();
    } catch (e) {
      alert("Error al enlazar");
    } finally {
      setIsLinking(false);
      setHoveredMatch(null);
    }
  };

  const progressPercent = Math.round((currentIndex / pendingMovements.length) * 100);

  return (
    <div className="fixed inset-0 z-[1000] flex justify-center items-center p-4 overflow-hidden">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !isLinking && onClose()} className="absolute inset-0 bg-slate-900/95 backdrop-blur-xl" />
      
      <div className="relative z-10 w-full max-w-lg flex flex-col items-center">
        <div className="w-full flex justify-between items-center mb-6 px-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(79,70,229,0.5)]">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-white font-black text-lg leading-none">Swipe Mode</h3>
              <p className="text-indigo-400 text-[10px] font-black uppercase tracking-widest mt-1">{pendingMovements.length - currentIndex} RESTANTES</p>
            </div>
          </div>
          <button onClick={onClose} disabled={isLinking} className="text-white/40 hover:text-white hover:rotate-90 transition-all disabled:opacity-0"><CloseIcon className="w-8 h-8" /></button>
        </div>

        <AnimatePresence mode="popLayout">
          <motion.div 
            key={currentItem.id}
            initial={{ scale: 0.9, opacity: 0, y: 50 }} 
            animate={{ 
              scale: isLinking ? 1.05 : 1, 
              opacity: isLinking ? 0 : 1, 
              y: isLinking ? -100 : 0, 
              x: 0, 
              rotate: 0 
            }} 
            exit={{ scale: 0.9, opacity: 0, x: -200, rotate: -10 }} 
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            drag={!isLinking ? "x" : false} 
            dragConstraints={{ left: 0, right: 0 }} 
            dragElastic={0.7}
            onDragEnd={(e, { offset, velocity }) => { if (offset.x < -50 || velocity.x < -500) next(); }}
            className={cn(
              "w-full rounded-[3rem] p-8 shadow-2xl flex flex-col min-h-[500px] relative overflow-hidden",
              isLinking ? "bg-emerald-50 border-4 border-emerald-400" : "bg-white cursor-grab active:cursor-grabbing"
            )}
          >
            {/* Destello verde cuando se enlaza */}
            <AnimatePresence>
              {isLinking && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.2 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-emerald-400 z-0 pointer-events-none" />
              )}
            </AnimatePresence>

            <div className="text-center mb-8 pointer-events-none relative z-10">
              <span className={cn("text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest mb-4 inline-flex items-center gap-1", Num.parse(currentItem.amount) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                {isLinking ? <Zap className="w-3 h-3 animate-pulse" /> : null}
                {Num.parse(currentItem.amount) > 0 ? 'Ingreso en Banco' : 'Cargo en Banco'}
              </span>
              <h2 className="text-2xl font-black text-slate-800 leading-tight mb-2 line-clamp-2">{currentItem.desc}</h2>
              <p id={`bank-amount-${currentItem.id}`} className="text-5xl font-black text-slate-900 tracking-tighter inline-block relative">
                {Num.fmt(currentItem.amount)}
              </p>
              <p className="text-[10px] text-slate-400 font-bold mt-3 uppercase tracking-widest bg-slate-50 inline-block px-3 py-1 rounded-lg">Fecha: {currentItem.date}</p>
            </div>

            <div className="flex-1 relative z-10">
              {matches.length > 0 ? (
                <div className="space-y-4 relative">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 text-center">Coincidencias (Tap para enlazar)</p>
                  
                  {matches.map((m: any, idx: number) => {
                    const matchIdStr = `match-card-${m.id}`;
                    const isHovered = hoveredMatch === m.id;
                    
                    return (
                      <div key={idx} className="relative">
                        {/* 🌟 RAYO DE ENERGÍA (SVG) */}
                        <EnergyBeam 
                          sourceId={`bank-amount-${currentItem.id}`} 
                          targetId={matchIdStr} 
                          isActive={isHovered} 
                        />

                        <motion.div 
                          id={matchIdStr}
                          onHoverStart={() => !isLinking && setHoveredMatch(m.id)}
                          onHoverEnd={() => !isLinking && setHoveredMatch(null)}
                          whileHover={!isLinking ? { scale: 1.03, y: -2 } : {}} 
                          whileTap={!isLinking ? { scale: 0.98 } : {}}
                          onClick={() => handleLinkLocal(m.type, m.id, m.comision || 0)}
                          className={cn("flex justify-between items-center p-4 rounded-2xl border-2 cursor-pointer transition-all shadow-sm relative z-20 bg-white",
                            isHovered ? "border-emerald-400 shadow-emerald-200/50 shadow-lg" : "border-slate-200 hover:border-indigo-300"
                          )}
                        >
                          <div className="text-left">
                            <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded",
                              m.color === 'emerald' ? "bg-emerald-50 text-emerald-700" : m.color === 'teal' ? "bg-teal-50 text-teal-700" :
                              m.color === 'amber' ? "bg-amber-50 text-amber-700" : m.color === 'indigo' ? "bg-indigo-50 text-indigo-700" : "bg-rose-50 text-rose-700"
                            )}>{m.type}</span>
                            <p className="text-sm font-black text-slate-800 mt-2">{m.title}</p>
                          </div>
                          <div className="text-right">
                            <p className={cn("font-black text-lg", isHovered ? "text-emerald-600" : "text-slate-800")}>{Num.fmt(m.amount)}</p>
                          </div>
                        </motion.div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-30 py-10 pointer-events-none">
                  <Search className="w-12 h-12 mb-4" />
                  <p className="text-xs font-black uppercase tracking-widest">Sin coincidencias</p>
                  <p className="text-[10px] font-bold mt-1">Sáltalo deslizando</p>
                </div>
              )}
            </div>

            <div className="flex gap-4 mt-auto pt-6 relative z-10">
              <button disabled={isLinking} onClick={next} className="flex-1 bg-slate-100 text-slate-400 py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200 hover:text-slate-600 transition flex items-center justify-center gap-2 disabled:opacity-50">
                <ArrowDownLeft className="w-4 h-4 rotate-45" /> SALTAR
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 w-full px-8">
          <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${progressPercent}%` }} className="h-full bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]" />
          </div>
        </div>
      </div>
    </div>
  );
};
