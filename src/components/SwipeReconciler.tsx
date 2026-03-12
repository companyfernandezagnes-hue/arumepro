import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Sparkles, ArrowDownLeft, Search, X as CloseIcon } from 'lucide-react';
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
// 🚀 Importamos el cerebro 
import { findMatches, executeLink } from '../services/bancoLogic';

export interface SwipeReconcilerProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  onClose: () => void;
}

export const SwipeReconciler: React.FC<SwipeReconcilerProps> = ({ data, onSave, onClose }) => {
  const pendingMovements = useMemo(() => {
    return (data.banco || []).filter((b: any) => b.status === 'pending');
  }, [data.banco]);

  const [currentIndex, setCurrentIndex] = useState(0);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') next();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, pendingMovements.length]);

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
    const newData = JSON.parse(JSON.stringify(data));
    executeLink(newData, currentItem.id, matchType, docId, comision); 
    await onSave(newData);
  };

  const progressPercent = Math.round((currentIndex / pendingMovements.length) * 100);

  return (
    <div className="fixed inset-0 z-[1000] flex justify-center items-center p-4 overflow-hidden">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/95 backdrop-blur-xl" />
      
      <div className="relative z-10 w-full max-w-lg flex flex-col items-center">
        <div className="w-full flex justify-between items-center mb-6 px-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg"><Sparkles className="w-5 h-5 text-white" /></div>
            <div>
              <h3 className="text-white font-black text-lg leading-none">Swipe Mode</h3>
              <p className="text-indigo-400 text-[10px] font-black uppercase tracking-widest mt-1">{pendingMovements.length - currentIndex} RESTANTES</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white hover:rotate-90 transition-all"><CloseIcon className="w-8 h-8" /></button>
        </div>

        <AnimatePresence mode="popLayout">
          <motion.div 
            key={currentItem.id}
            initial={{ scale: 0.9, opacity: 0, y: 50 }} animate={{ scale: 1, opacity: 1, y: 0, x: 0, rotate: 0 }} exit={{ scale: 0.9, opacity: 0, x: -200, rotate: -10 }} 
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.7}
            onDragEnd={(e, { offset, velocity }) => { if (offset.x < -50 || velocity.x < -500) next(); }}
            className="w-full bg-white rounded-[3rem] p-8 shadow-2xl flex flex-col min-h-[500px] cursor-grab active:cursor-grabbing"
          >
            <div className="text-center mb-8 pointer-events-none">
              <span className={cn("text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest mb-4 inline-block", Num.parse(currentItem.amount) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                {Num.parse(currentItem.amount) > 0 ? 'Ingreso detectado' : 'Gasto detectado'}
              </span>
              <h2 className="text-2xl font-black text-slate-800 leading-tight mb-2 line-clamp-2">{currentItem.desc}</h2>
              <p className="text-5xl font-black text-slate-900 tracking-tighter">{Num.fmt(currentItem.amount)}</p>
              <p className="text-[10px] text-slate-400 font-bold mt-3 uppercase tracking-widest bg-slate-50 inline-block px-3 py-1 rounded-lg">Fecha: {currentItem.date}</p>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 mb-6">
              {matches.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 text-center">Coincidencias (Tap para enlazar)</p>
                  {matches.map((m: any, idx: number) => (
                    <motion.div 
                      key={idx} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => handleLinkLocal(m.type, m.id, m.comision || 0)}
                      className={cn("flex justify-between items-center p-4 rounded-2xl border-2 cursor-pointer transition-all shadow-sm hover:shadow-md",
                        m.color === 'emerald' ? "bg-emerald-50 border-emerald-100 hover:border-emerald-300" : 
                        m.color === 'teal' ? "bg-teal-50 border-teal-100 hover:border-teal-300" :
                        m.color === 'amber' ? "bg-amber-50 border-amber-100 hover:border-amber-300" :
                        m.color === 'indigo' ? "bg-indigo-50 border-indigo-100 hover:border-indigo-300" : "bg-rose-50 border-rose-100 hover:border-rose-300"
                      )}
                    >
                      <div className="text-left">
                        <span className={cn("text-[8px] font-black uppercase tracking-widest",
                          m.color === 'emerald' ? "text-emerald-700" : m.color === 'teal' ? "text-teal-700" :
                          m.color === 'amber' ? "text-amber-700" : m.color === 'indigo' ? "text-indigo-700" : "text-rose-700"
                        )}>{m.type}</span>
                        <p className="text-xs font-black text-slate-800 mt-1">{m.title}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-sm text-slate-800">{Num.fmt(m.amount)}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-30 py-10 pointer-events-none">
                  <Search className="w-12 h-12 mb-4" />
                  <p className="text-xs font-black uppercase tracking-widest">No hay coincidencias claras</p>
                  <p className="text-[10px] font-bold mt-1">Sáltalo o usa la lista manual</p>
                </div>
              )}
            </div>

            <div className="flex gap-4 mt-auto">
              <button onClick={next} className="flex-1 bg-slate-100 text-slate-400 py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200 hover:text-slate-600 transition flex items-center justify-center gap-2">
                <ArrowDownLeft className="w-4 h-4 rotate-45" /> SALTAR
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 w-full px-8">
          <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${progressPercent}%` }} className="h-full bg-indigo-500 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
};
