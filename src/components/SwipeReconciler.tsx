import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Sparkles, ArrowDownLeft, Search, X as CloseIcon, Zap, Target } from 'lucide-react';
import { AppData, BankMovement } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
// 🚀 Importamos el cerebro de enlace
import { findMatches, executeLink } from '../services/bancoLogic';

export interface SwipeReconcilerProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  onClose: () => void;
}

/* =======================================================
 * 🎨 COMPONENTE: Rayo de Energía Seguro (Anti-Memory Leaks)
 * ======================================================= */
const EnergyBeam = ({ sourceId, targetId, isActive }: { sourceId: string, targetId: string, isActive: boolean }) => {
  const [coords, setCoords] = useState<{x1: number, y1: number, x2: number, y2: number} | null>(null);

  useEffect(() => {
    let animationFrameId: number;

    const updateCoords = () => {
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

    // Doble verificación suave para Framer Motion
    const t1 = setTimeout(updateCoords, 100);
    const t2 = setTimeout(updateCoords, 400);
    window.addEventListener('resize', updateCoords);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', updateCoords);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [sourceId, targetId, isActive]);

  if (!coords) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none z-[5] w-full h-full" style={{ overflow: 'visible' }}>
      <motion.path
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: isActive ? 1 : 0.3 }}
        d={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1 + 50}, ${coords.x2} ${coords.y2 - 50}, ${coords.x2} ${coords.y2}`}
        stroke={isActive ? "#10b981" : "#818cf8"} 
        strokeWidth={isActive ? "4" : "2"}
        fill="none"
        strokeDasharray={isActive ? "none" : "4 4"}
        className="transition-all duration-300"
        style={{ filter: isActive ? "drop-shadow(0 0 8px #34d399)" : "none" }}
      />
      {isActive && (
        <circle r="6" fill="#34d399" style={{ filter: "drop-shadow(0 0 10px #10b981)" }}>
          <animateMotion dur="0.6s" repeatCount="1" path={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1 + 50}, ${coords.x2} ${coords.y2 - 50}, ${coords.x2} ${coords.y2}`} />
        </circle>
      )}
    </svg>
  );
};


/* =======================================================
 * 💳 COMPONENTE PRINCIPAL (SWIPE)
 * ======================================================= */
export const SwipeReconciler: React.FC<SwipeReconcilerProps> = ({ data, onSave, onClose }) => {
  
  // 🛡️ MEJORA 1: Filtramos los pendientes de forma segura
  const pendingMovements = useMemo(() => {
    return (data.banco || []).filter((b: BankMovement) => b.status === 'pending');
  }, [data.banco]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [hoveredMatch, setHoveredMatch] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  
  const next = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(20); // Zumbido háptico
    setCurrentIndex(prev => Math.min(prev + 1, pendingMovements.length));
  }, [pendingMovements.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLinking) return;
      if (e.key === 'ArrowLeft') next();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [next, isLinking, onClose]);

  // PANTALLA FINAL (Todo Conciliado)
  if (pendingMovements.length === 0 || currentIndex >= pendingMovements.length) {
    return (
      <div className="fixed inset-0 z-[1000] flex justify-center items-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/95 backdrop-blur-xl" />
        <motion.div 
          initial={{ scale: 0.5, opacity: 0, y: 30 }} 
          animate={{ scale: 1, opacity: 1, y: 0 }} 
          transition={{ type: "spring", damping: 15, stiffness: 200 }}
          className="relative z-10 flex flex-col items-center text-center"
        >
          <motion.div 
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2, type: "spring" }}
            className="w-28 h-28 bg-emerald-500 rounded-full flex items-center justify-center mb-6 shadow-[0_0_60px_-10px_rgba(16,185,129,0.7)] border-4 border-emerald-300"
          >
            <CheckCircle2 className="w-14 h-14 text-white" />
          </motion.div>
          <h2 className="text-4xl font-black text-white tracking-tighter mb-2">¡Todo al día!</h2>
          <p className="text-emerald-400 font-bold uppercase tracking-widest mb-8">Banco 100% Conciliado</p>
          <button onClick={onClose} className="bg-white text-slate-900 px-8 py-4 rounded-full font-black text-sm hover:scale-105 active:scale-95 transition-all shadow-xl">
            VOLVER AL PANEL
          </button>
        </motion.div>
      </div>
    );
  }

  // 🛡️ Extraemos el item de forma segura
  const currentItem = pendingMovements[currentIndex];
  if (!currentItem) return null; // Fallback extremo

  const isIncome = Num.parse(currentItem.amount) > 0;

  // 🚀 USAMOS EL CEREBRO DE BÚSQUEDA
  const matches = useMemo(() => {
    return findMatches(currentItem, data);
  }, [currentItem, data]);

  const handleLinkLocal = async (matchType: string, docId: string, comision: number = 0) => {
    if (isLinking) return;
    setIsLinking(true);
    setHoveredMatch(docId); // Forzamos el rayo láser
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]); // Patrón de éxito háptico

    // Esperamos a que la animación termine (700ms)
    await new Promise(r => setTimeout(r, 700));

    try {
      const newData = JSON.parse(JSON.stringify(data));
      executeLink(newData, currentItem.id, matchType, docId, comision); 
      await onSave(newData);
      
      // Solo avanzamos si todo ha ido bien
      setCurrentIndex(prev => prev + 1);
    } catch (e) {
      console.error("Error al enlazar en SwipeReconciler:", e);
      alert("Error al intentar enlazar. Revisa tu conexión.");
    } finally {
      setIsLinking(false);
      setHoveredMatch(null);
    }
  };

  const progressPercent = Math.round((currentIndex / pendingMovements.length) * 100);

  return (
    <div className="fixed inset-0 z-[1000] flex justify-center items-center p-4 overflow-hidden">
      
      {/* INNOVACIÓN 1: Mood Lighting Dinámico */}
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1, backgroundColor: isIncome ? 'rgba(15, 23, 42, 0.94)' : 'rgba(15, 23, 42, 0.97)' }} 
        exit={{ opacity: 0 }} 
        onClick={() => !isLinking && onClose()} 
        className="absolute inset-0 backdrop-blur-2xl transition-colors duration-700" 
      >
        <div className={cn("absolute inset-0 opacity-[0.08] mix-blend-screen transition-colors duration-1000", isIncome ? "bg-emerald-400" : "bg-rose-500")} />
      </motion.div>
      
      <div className={cn("relative z-10 w-full max-w-lg flex flex-col items-center transition-all duration-300", isLinking && "pointer-events-none")}>
        
        {/* HEADER TOP */}
        <div className="w-full flex justify-between items-center mb-6 px-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(79,70,229,0.5)] border border-indigo-400">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-white font-black text-lg leading-none tracking-tight">Swipe Mode</h3>
              <p className="text-indigo-400 text-[10px] font-black uppercase tracking-widest mt-1">{pendingMovements.length - currentIndex} RESTANTES</p>
            </div>
          </div>
          <button onClick={onClose} disabled={isLinking} className="p-2 bg-white/10 rounded-full text-white/50 hover:text-white hover:bg-white/20 transition-all disabled:opacity-0">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* TARJETA PRINCIPAL */}
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
            dragElastic={0.2} // 🛡️ MEJORA 4: Resistencia más firme
            onDragEnd={(e, { offset, velocity }) => { if (offset.x < -80 || velocity.x < -600) next(); }}
            className={cn(
              "w-full rounded-[3rem] p-8 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.6)] flex flex-col min-h-[500px] relative overflow-hidden",
              isLinking ? "bg-emerald-50 border-4 border-emerald-400" : "bg-white border border-slate-200 cursor-grab active:cursor-grabbing"
            )}
          >
            {/* INNOVACIÓN 2: Flash fotográfico al enlazar */}
            <AnimatePresence>
              {isLinking && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.5 }} className="absolute inset-0 bg-white z-[100] mix-blend-overlay" />
              )}
            </AnimatePresence>

            {/* INFO DEL MOVIMIENTO BANCARIO */}
            <div className="text-center mb-8 pointer-events-none relative z-10 pt-2">
              <span className={cn("text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest mb-4 inline-flex items-center gap-1.5 shadow-sm border", 
                isIncome ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"
              )}>
                {isLinking ? <Zap className="w-3 h-3 animate-pulse" /> : <Target className="w-3 h-3" />}
                {isIncome ? 'Ingreso Bancario' : 'Cargo Bancario'}
              </span>
              
              <h2 className="text-xl md:text-2xl font-black text-slate-800 leading-tight mb-2 line-clamp-2 px-4">{currentItem.desc}</h2>
              
              <p id={`bank-amount-${currentItem.id}`} className={cn("text-5xl md:text-6xl font-black tracking-tighter inline-block relative my-2", isIncome ? "text-emerald-500" : "text-slate-900")}>
                {Num.fmt(currentItem.amount)}
              </p>
              
              <div className="mt-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest bg-slate-50 border border-slate-100 inline-block px-3 py-1 rounded-lg shadow-inner">
                  Fecha Valor: {currentItem.date}
                </span>
              </div>
            </div>

            {/* OPCIONES DE COINCIDENCIA */}
            <div className="flex-1 relative z-10 w-full mt-2">
              {matches.length > 0 ? (
                <div className="space-y-3 relative">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 text-center">Coincidencias Sugeridas</p>
                  
                  {matches.map((m: any, idx: number) => {
                    const matchIdStr = `match-card-${m.id}`;
                    const isHovered = hoveredMatch === m.id;
                    const isPerfectMatch = matches.length === 1 && idx === 0; // INNOVACIÓN 3
                    
                    return (
                      <div key={idx} className="relative">
                        {/* 🌟 RAYO DE ENERGÍA SVG */}
                        <EnergyBeam 
                          sourceId={`bank-amount-${currentItem.id}`} 
                          targetId={matchIdStr} 
                          isActive={isHovered} 
                        />

                        <motion.div 
                          id={matchIdStr}
                          onHoverStart={() => !isLinking && setHoveredMatch(m.id)}
                          onHoverEnd={() => !isLinking && setHoveredMatch(null)}
                          whileHover={!isLinking ? { scale: 1.02, y: -2 } : {}} 
                          whileTap={!isLinking ? { scale: 0.98 } : {}}
                          onClick={() => handleLinkLocal(m.type, m.id, m.comision || 0)}
                          className={cn(
                            "flex justify-between items-center p-4 rounded-2xl border-2 cursor-pointer transition-all relative z-20 bg-white overflow-hidden group",
                            isHovered ? "border-emerald-400 shadow-[0_10px_20px_-5px_rgba(16,185,129,0.3)] bg-emerald-50/30" : "border-slate-200 hover:border-indigo-300 shadow-sm",
                            isPerfectMatch && !isHovered && "border-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.2)]" // Resplandor de auto-match
                          )}
                        >
                          <div className="text-left min-w-0 pr-4 relative z-10">
                            <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded border",
                              m.color === 'emerald' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : 
                              m.color === 'teal' ? "bg-teal-50 text-teal-700 border-teal-200" :
                              m.color === 'amber' ? "bg-amber-50 text-amber-700 border-amber-200" : 
                              m.color === 'indigo' ? "bg-indigo-50 text-indigo-700 border-indigo-200" : 
                              "bg-rose-50 text-rose-700 border-rose-200"
                            )}>{m.type}</span>
                            <p className="text-sm font-black text-slate-800 mt-2 truncate">{m.title}</p>
                            
                            {isPerfectMatch && <p className="text-[8px] text-indigo-500 font-bold mt-1 uppercase flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> 100% Seguro</p>}
                          </div>

                          <div className="text-right shrink-0 relative z-10">
                            <p className={cn("font-black text-lg tracking-tight transition-colors", isHovered ? "text-emerald-600" : "text-slate-900")}>
                              {Num.fmt(m.amount)}
                            </p>
                          </div>
                        </motion.div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-12 pointer-events-none">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100">
                    <Search className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Sin Coincidencias</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1 max-w-[200px] leading-relaxed">No hay facturas ni cierres de TPV en el sistema que sumen este importe exacto.</p>
                </div>
              )}
            </div>

            {/* BOTÓN SALTAR */}
            <div className="mt-auto pt-6 relative z-10">
              <button disabled={isLinking} onClick={next} className="w-full bg-slate-50 border border-slate-200 text-slate-400 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 hover:text-slate-600 transition-all flex items-center justify-center gap-2 disabled:opacity-0 active:scale-95">
                <ArrowDownLeft className="w-4 h-4 rotate-45" /> SALTAR ESTE MOVIMIENTO
              </button>
            </div>

          </motion.div>
        </AnimatePresence>

        {/* BARRA DE PROGRESO BOTTOM */}
        <div className="mt-8 w-full max-w-sm px-4">
          <div className="flex justify-between text-[9px] font-black text-indigo-200 uppercase tracking-widest mb-2 px-1">
            <span>Progreso</span>
            <span>{currentIndex} / {pendingMovements.length}</span>
          </div>
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
            <motion.div 
              initial={{ width: 0 }} 
              animate={{ width: `${progressPercent}%` }} 
              transition={{ ease: "circOut", duration: 0.5 }}
              className="h-full bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]" 
            />
          </div>
        </div>

      </div>
    </div>
  );
};
