import React from 'react';
import { cn } from '../lib/utils';
// Importamos el tipo de Lucide para que TypeScript sepa qué es un icono
import { LucideIcon } from 'lucide-react'; 

interface NavButtonProps {
  icon: LucideIcon | React.ElementType;
  label: string;
  active?: boolean;
  onClick: () => void;
}

export const NavButton = ({ icon: Icon, label, active, onClick }: NavButtonProps) => (
  <button
    onClick={onClick}
    aria-label={label} // ♿ Accesibilidad: Lee la palabra completa aunque se recorte en pantalla
    aria-current={active ? "page" : undefined} // ♿ Accesibilidad: Indica que estás en esta pestaña
    className={cn(
      "group flex flex-col items-center justify-center gap-1.5 transition-all duration-300 min-w-[56px] shrink-0 p-1 rounded-xl",
      active ? "text-indigo-600" : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"
    )}
  >
    {/* El icono reacciona de forma más suave */}
    <Icon 
      className={cn(
        "w-6 h-6 transition-all duration-300 ease-out", 
        active ? "scale-110 opacity-100 drop-shadow-sm" : "scale-100 opacity-50 group-hover:opacity-80"
      )} 
    />
    
    {/* Usamos slice (moderno) y mostramos hasta 5 letras para que se entienda mejor */}
    <span className={cn(
      "text-[9px] font-black uppercase tracking-widest transition-all duration-300",
      active ? "opacity-100" : "opacity-70"
    )}>
      {label.length > 5 ? label.slice(0, 5) : label}
    </span>
  </button>
);
