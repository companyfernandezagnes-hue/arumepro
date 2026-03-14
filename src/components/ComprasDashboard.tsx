import React, { useState, useEffect, useMemo } from 'react';
import { Package, FileText, ShieldCheck, Zap } from 'lucide-react';
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

  // 🧠 Contadores Inteligentes en tiempo real
  const contadores = useMemo(() => {
    const albs = Array.isArray(data?.albaranes) ? data.albaranes : [];
    const facs = Array.isArray(data?.facturas) ? data.facturas : [];
    
    return {
      albaranesSuletos: albs.filter(a => !a.invoiced).length,
      facturasBorrador: facs.filter(f => f.status === 'draft').length
    };
  }, [data]);

  // ⌨️ Atajos de teclado (Alt+1 y Alt+2)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (isTyping) return;

      if (e.altKey && e.key === '1') setActiveSub('albaranes');
      if (e.altKey && e.key === '2') setActiveSub('facturas');
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="relative animate-fade-in">
      
      {/* NAVEGACIÓN SUPERIOR FLOTANTE (TIPO APPLE) */}
      <div className="sticky top-2 z-[100] flex justify-center mb-4 pointer-events-none px-4">
        <div className="bg-slate-900/90 backdrop-blur-lg p-1.5 rounded-full flex gap-1 shadow-2xl pointer-events-auto border border-slate-700">
          
          <button 
            onClick={() => setActiveSub('albaranes')}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all",
              activeSub === 'albaranes' ? "bg-white text-slate-900 shadow-md scale-105" : "text-slate-300 hover:text-white hover:bg-slate-800"
            )}
          >
            <Package className="w-4 h-4" /> 
            1. Recepción
            {contadores.albaranesSuletos > 0 && (
              <span className={cn(
                "ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] transition-colors",
                activeSub === 'albaranes' ? "bg-indigo-100 text-indigo-700" : "bg-slate-700 text-slate-300"
              )}>{contadores.albaranesSuletos}</span>
            )}
          </button>

          <button 
            onClick={() => setActiveSub('facturas')}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all",
              activeSub === 'facturas' ? "bg-white text-slate-900 shadow-md scale-105" : "text-slate-300 hover:text-white hover:bg-slate-800"
            )}
          >
            <FileText className="w-4 h-4" /> 
            2. Auditoría & Histórico
            {contadores.facturasBorrador > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] bg-rose-500 text-white animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.6)]">
                {contadores.facturasBorrador}
              </span>
            )}
          </button>

        </div>
      </div>

      {/* RENDERIZADO DE LAS PANTALLAS (Toda tu lógica antigua funciona aquí dentro) */}
      <AnimatePresence mode="wait">
        {activeSub === 'albaranes' && (
          <motion.div key="albaranes" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.2 }}>
             <div className="max-w-[1600px] mx-auto px-4 mb-2 flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
               <Zap className="w-3 h-3 text-amber-500" /> Sube aquí los tickets del día. Cuando llegue el PDF oficial, pasa a la fase 2.
             </div>
             
             {/* 📦 ALBARANES: Esto carga todo el archivo AlbaranesView.tsx automáticamente */}
             <div className="-mt-4">
               <AlbaranesView data={data} onSave={onSave} />
             </div>
          </motion.div>
        )}

        {activeSub === 'facturas' && (
          <motion.div key="facturas" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
             <div className="max-w-[1600px] mx-auto px-4 mb-2 flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
               <ShieldCheck className="w-3 h-3 text-emerald-500" /> Agrupa los albaranes, extrae los PDFs del correo IMAP y consolida tus gastos.
             </div>

             {/* 🧾 FACTURAS: Esto carga todo el archivo InvoicesView.tsx automáticamente */}
             <div className="-mt-4">
               <InvoicesView data={data} onSave={onSave} />
             </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};
