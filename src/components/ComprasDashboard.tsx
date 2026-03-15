import React, { useState, useEffect, useMemo } from 'react';
import { Package, FileText, Command } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppData } from '../types';
import { cn } from '../lib/utils';

// 📦 MUÑECAS RUSAS GIGANTES: Al traer "View", nos traemos sus "Lists" y "Modals" automáticamente.
import { AlbaranesView } from './AlbaranesView';
import { InvoicesView } from './InvoicesView';

interface ComprasDashboardProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const ComprasDashboard = ({ data, onSave }: ComprasDashboardProps) => {
  const [activeSub, setActiveSub] = useState<'albaranes' | 'facturas'>('albaranes');

  // 🧠 Contadores Inteligentes Blindados (A prueba de datos corruptos)
  const contadores = useMemo(() => {
    const safeData = data || {};
    const albs = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
    const facs = Array.isArray(safeData.facturas) ? safeData.facturas : [];
    
    return {
      albaranesSueltos: albs.filter((a: any) => a && typeof a === 'object' && !a.invoiced).length,
      facturasBorrador: facs.filter((f: any) => f && typeof f === 'object' && f.status === 'draft').length
    };
  }, [data]);

  // ⌨️ Atajos de teclado (Alt+1 y Alt+2)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (isTyping) return;

      if (e.altKey && e.key === '1') { e.preventDefault(); setActiveSub('albaranes'); }
      if (e.altKey && e.key === '2') { e.preventDefault(); setActiveSub('facturas'); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="relative animate-fade-in pb-12">
      
      {/* 🚀 NAVEGACIÓN SUPERIOR FLOTANTE (ESTILO HOLDED / LINEAR) */}
      <div className="sticky top-6 z-[100] flex justify-center mb-8 pointer-events-none px-4">
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-slate-900/80 backdrop-blur-xl p-1.5 rounded-[2rem] flex gap-1.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] pointer-events-auto border border-slate-700/50 relative overflow-hidden"
        >
          
          {/* PESTAÑA 1: ALBARANES */}
          <button 
            onClick={() => setActiveSub('albaranes')}
            className={cn(
              "relative flex items-center gap-2.5 px-6 py-3 rounded-full text-[11px] font-black uppercase tracking-widest transition-all duration-300 overflow-hidden group",
              activeSub === 'albaranes' ? "text-slate-900" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            )}
          >
            {activeSub === 'albaranes' && (
              <motion.div layoutId="comprasTabBg" className="absolute inset-0 bg-white" initial={false} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <Package className={cn("w-4 h-4", activeSub === 'albaranes' ? "text-indigo-600" : "text-slate-500")} /> 
              1. Recepción
            </span>
            
            <div className="relative z-10 flex items-center gap-2 ml-1">
              {contadores.albaranesSueltos > 0 && (
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] transition-colors shadow-sm",
                  activeSub === 'albaranes' ? "bg-indigo-100 text-indigo-700" : "bg-slate-800 text-slate-300 border border-slate-700"
                )}>
                  {contadores.albaranesSueltos}
                </span>
              )}
              <span className={cn(
                "hidden md:flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity",
                activeSub === 'albaranes' ? "bg-slate-100 text-slate-400" : "bg-slate-800 text-slate-500"
              )}>
                <Command className="w-2.5 h-2.5"/> 1
              </span>
            </div>
          </button>

          {/* PESTAÑA 2: FACTURAS */}
          <button 
            onClick={() => setActiveSub('facturas')}
            className={cn(
              "relative flex items-center gap-2.5 px-6 py-3 rounded-full text-[11px] font-black uppercase tracking-widest transition-all duration-300 overflow-hidden group",
              activeSub === 'facturas' ? "text-slate-900" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            )}
          >
            {activeSub === 'facturas' && (
              <motion.div layoutId="comprasTabBg" className="absolute inset-0 bg-white" initial={false} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <FileText className={cn("w-4 h-4", activeSub === 'facturas' ? "text-indigo-600" : "text-slate-500")} /> 
              2. Facturación
            </span>
            
            <div className="relative z-10 flex items-center gap-2 ml-1">
              {contadores.facturasBorrador > 0 && (
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] transition-colors shadow-sm animate-pulse",
                  activeSub === 'facturas' ? "bg-rose-100 text-rose-700" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                )}>
                  {contadores.facturasBorrador} IA
                </span>
              )}
              <span className={cn(
                "hidden md:flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity",
                activeSub === 'facturas' ? "bg-slate-100 text-slate-400" : "bg-slate-800 text-slate-500"
              )}>
                <Command className="w-2.5 h-2.5"/> 2
              </span>
            </div>
          </button>

        </motion.div>
      </div>

      {/* 🧩 RENDERIZADO DE LAS PANTALLAS (Transiciones Ultra-Suaves) */}
      <div className="px-2 md:px-0">
        <AnimatePresence mode="wait">
          {activeSub === 'albaranes' && (
            <motion.div key="albaranes" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
              <AlbaranesView data={data} onSave={onSave} />
            </motion.div>
          )}

          {activeSub === 'facturas' && (
            <motion.div key="facturas" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
              <InvoicesView data={data} onSave={onSave} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
};
