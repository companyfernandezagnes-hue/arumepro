import React from 'react';
import { Trash2 } from 'lucide-react';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { Cierre } from '../types';
import { CashBusinessUnit } from '../views/CashView';

interface CashHistoryListProps {
  cierresMes: Cierre[];
  cashUnits: { id: CashBusinessUnit; name: string; icon: any; color: string; bg: string }[];
  facturas: any[];
  onDelete: (id: string) => void;
}

// React.memo evita que la lista se vuelva a renderizar cuando escribes en el formulario
export const CashHistoryList = React.memo(({ cierresMes, cashUnits, facturas, onDelete }: CashHistoryListProps) => {
  
  if (!cierresMes || cierresMes.length === 0) {
    return (
      <div className="py-12 text-center opacity-50 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200">
        <p className="text-slate-500 font-bold text-sm">No hay cierres registrados este mes.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {cierresMes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((c) => {
        const unitConfig = cashUnits.find(u => u.id === (c.unitId || 'REST'));
        const fZ = facturas?.find((f: any) => f.num === c.id); 
        
        return (
          <div key={c.id} className={cn(
            "bg-white p-5 rounded-[2rem] border shadow-sm flex justify-between items-center group relative hover:shadow-md transition", 
            fZ?.reconciled ? 'border-emerald-200' : 'border-slate-100'
          )}>
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest bg-slate-100 px-2 py-1 rounded-lg w-fit">{c.date}</p>
                {unitConfig && (
                  <span className={cn("text-[8px] font-black px-2 py-1 rounded uppercase flex items-center gap-1", unitConfig.bg, unitConfig.color)}>
                    <unitConfig.icon className="w-3 h-3" /> {unitConfig.name}
                  </span>
                )}
              </div>
              
              {c.unitId === 'REST' && (
                <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 font-bold mt-2">
                  <span>💵 Ef: {Num.parse(c.efectivo).toFixed(0)}€</span>
                  <span>💳 Tj: {Num.parse(c.tarjeta).toFixed(0)}€</span>
                </div>
              )}
              
              {c.descuadre !== 0 && c.unitId === 'REST' && (
                <p className={cn("text-[9px] font-black uppercase mt-1", c.descuadre > 0 ? "text-emerald-500" : "text-rose-500")}>
                  Descuadre: {c.descuadre > 0 ? '+' : ''}{c.descuadre.toFixed(2)}€
                </p>
              )}
            </div>
            
            <div className="text-right shrink-0">
              <p className="text-xl font-black text-slate-900">{Num.parse(c.totalVenta).toFixed(2)}€</p>
              <button 
                onClick={() => onDelete(c.id)} 
                className="text-[8px] text-rose-400 font-bold uppercase hover:text-rose-600 opacity-0 group-hover:opacity-100 transition mt-2 flex items-center gap-1 ml-auto"
              >
                <Trash2 className="w-3 h-3" /> Borrar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
});
