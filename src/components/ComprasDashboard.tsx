import React, { useState, useEffect, useMemo } from 'react';
import { Package, FileText, Command } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData } from '../types';
import { cn } from '../lib/utils';

import { AlbaranesView } from './AlbaranesView';
import { InvoicesView }  from './InvoicesView';

interface ComprasDashboardProps {
  data  : AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const ComprasDashboard = ({ data, onSave }: ComprasDashboardProps) => {
  const [activeSub, setActiveSub] = useState<'albaranes' | 'facturas'>('albaranes');

  const contadores = useMemo(() => {
    const albs = Array.isArray(data?.albaranes) ? data.albaranes : [];
    const facs = Array.isArray(data?.facturas)  ? data.facturas  : [];
    return {
      albaranesSueltos: albs.filter((a) => a && typeof a === 'object' && !a.invoiced).length,
      facturasBorrador: facs.filter((f) => f && typeof f === 'object' && f.status === 'draft').length,
    };
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active   = document.activeElement as HTMLElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (isTyping) return;
      if (e.altKey && e.key === '1') { e.preventDefault(); setActiveSub('albaranes'); }
      if (e.altKey && e.key === '2') { e.preventDefault(); setActiveSub('facturas');  }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative pb-10">

      <div className="sticky top-2 z-[100] flex justify-center mb-4 pointer-events-none px-2">
        <motion.div
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0,   opacity: 1 }}
          className="bg-slate-900/90 backdrop-blur-lg p-1 rounded-xl flex gap-1 shadow-lg border border-slate-700/60 pointer-events-auto"
        >
          <button
            onClick={() => setActiveSub('albaranes')}
            className={cn(
              'relative flex items-center gap-1.5 px-4 py-2 rounded-lg',
              'text-[10px] font-black uppercase tracking-widest transition-all duration-200',
              activeSub === 'albaranes'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800',
            )}
          >
            <Package className="w-3.5 h-3.5"/>
            Albaranes
            {contadores.albaranesSueltos > 0 && (
              <span className={cn(
                'ml-1 px-1.5 py-0.5 rounded text-[9px] font-black',
                activeSub === 'albaranes' ? 'bg-white/20 text-white' : 'bg-amber-500 text-white',
              )}>
                {contadores.albaranesSueltos}
              </span>
            )}
            <span className="hidden sm:inline ml-1 opacity-40 text-[8px] font-mono">⌥1</span>
          </button>

          <button
            onClick={() => setActiveSub('facturas')}
            className={cn(
              'relative flex items-center gap-1.5 px-4 py-2 rounded-lg',
              'text-[10px] font-black uppercase tracking-widest transition-all duration-200',
              activeSub === 'facturas'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800',
            )}
          >
            <FileText className="w-3.5 h-3.5"/>
            Facturas
            {contadores.facturasBorrador > 0 && (
              <span className={cn(
                'ml-1 px-1.5 py-0.5 rounded text-[9px] font-black',
                activeSub === 'facturas' ? 'bg-white/20 text-white' : 'bg-rose-500 text-white',
              )}>
                {contadores.facturasBorrador}
              </span>
            )}
            <span className="hidden sm:inline ml-1 opacity-40 text-[8px] font-mono">⌥2</span>
          </button>

          <div className="hidden sm:flex items-center px-2 border-l border-slate-700/50 ml-1">
            <Command className="w-3 h-3 text-slate-600 mr-1"/>
            <span className="text-[8px] text-slate-600 font-mono">⌥1/2</span>
          </div>
        </motion.div>
      </div>

      <AnimatePresence mode="wait">
        {activeSub === 'albaranes' ? (
          <motion.div
            key="albaranes"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0  }}
            exit   ={{ opacity: 0, x:  8 }}
            transition={{ duration: 0.15 }}
          >
            <AlbaranesView data={data} onSave={onSave} />
          </motion.div>
        ) : (
          <motion.div
            key="facturas"
            initial={{ opacity: 0, x: 8  }}
            animate={{ opacity: 1, x: 0  }}
            exit   ={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
          >
            <InvoicesView data={data} onSave={onSave} />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};
