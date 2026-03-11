import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { cn } from '../lib/utils';

export type CmdItem<T extends string> = { key: T; label: string; group?: string; icon?: any };

type Props<T extends string> = {
  open: boolean;
  onClose: () => void;
  items: CmdItem<T>[];
  onSelect: (key: T) => void;
};

export function CommandPalette<T extends string>({ open, onClose, items, onSelect }: Props<T>) {
  const [q, setQ] = useState('');
  
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return items;
    return items.filter(i => i.label.toLowerCase().includes(qq));
  }, [q, items]);

  // Limpiar input al abrir
  useEffect(() => { if (open) setQ(''); }, [open]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[300] flex justify-center items-start pt-[15vh] px-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        aria-modal="true" role="dialog"
      >
        <button aria-label="Cerrar" className="absolute inset-0 w-full h-full bg-slate-900/40 backdrop-blur-sm cursor-default" onClick={onClose} />
        
        <motion.div
          initial={{ y: 20, scale: 0.95, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 20, scale: 0.95, opacity: 0 }}
          className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
        >
          <div className="p-4 border-b border-slate-100 flex items-center gap-3">
            <Search className="w-5 h-5 text-slate-400" />
            <input
              id="cmdp-input"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar un módulo (Ej: Facturas, Menús...)"
              className="flex-1 outline-none text-lg font-bold text-slate-800 placeholder-slate-300"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  onSelect(filtered[0].key);
                }
              }}
            />
            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-md">ESC</span>
          </div>
          
          <div className="max-h-[50vh] overflow-y-auto p-2 custom-scrollbar">
            {filtered.length === 0 && (
              <p className="text-sm font-bold text-slate-400 px-4 py-8 text-center">No se encontraron módulos.</p>
            )}
            <ul className="space-y-1">
              {filtered.map((i) => {
                const Icon = i.icon;
                return (
                  <li key={i.key}>
                    <button
                      className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition flex items-center justify-between group"
                      onClick={() => onSelect(i.key)}
                    >
                      <div className="flex items-center gap-3">
                        {Icon && <Icon className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" />}
                        {i.label}
                      </div>
                      {i.group && <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest group-hover:text-indigo-300">{i.group}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
