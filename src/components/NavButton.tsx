import React from 'react';
import { cn } from '../lib/utils';

export const NavButton = ({ icon: Icon, label, active, onClick }: any) => (
  <button
    onClick={onClick}
    className={cn(
      "flex flex-col items-center gap-1 transition-all duration-300 min-w-[45px] shrink-0",
      active ? "text-indigo-600 scale-110" : "text-slate-400 hover:text-slate-600"
    )}
  >
    <Icon className={cn("w-6 h-6 transition-all", active ? "opacity-100" : "opacity-50")} />
    <span className="text-[8px] font-black uppercase tracking-tighter">{label.substr(0, 4)}</span>
  </button>
);
