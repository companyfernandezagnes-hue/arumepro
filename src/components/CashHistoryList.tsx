import React from 'react';
import { Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { Cierre } from '../types';

// Definimos el tipo aquí para evitar importar de "views" que no existe
export type CashBusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

interface CashHistoryListProps {
  cierresMes: Cierre[];
  cashUnits: { id: CashBusinessUnit; name: string; icon: any; color: string; bg: string }[];
  onDelete: (id: string) => void;
}

export const CashHistoryList = React.memo(({ cierresMes, cashUnits, onDelete }: CashHistoryListProps) => {
  
  if (!cierresMes || cierresMes.length === 0) {
    return (
      <div className="py-12 text-center opacity-50 bg-slate-50 rounded-[2.5rem] border-2 border-dashed border-slate-200">
        <p className="text-slate-500 font-bold text-sm italic">No hay registros de caja este mes.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {cierresMes
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map((c) => {
          const unitConfig = cashUnits.find(u => u.id === (c.unitId || 'REST'));
          // Un cierre se considera "cuadrado" si el descuadre es 0
          const isOk = Math.abs(c.descuadre || 0) < 0.01;

          return (
            <div key={c.id} className={cn(
              "bg-white p-5 rounded-[2.5rem] border shadow-sm group relative hover:shadow-md transition-all duration-300", 
              isOk ? 'border-slate-100' : 'border-rose-100 bg-rose-50/20'
            )}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-3 py-1 rounded-full uppercase">
                      {c.date}
                    </span>
                    {unitConfig && (
                      <span className={cn("text-[9px] font-black px-3 py-1 rounded-full uppercase flex items-center gap-1.5", unitConfig.bg, unitConfig.color)}>
                        <unitConfig.icon className="w-3 h-3" /> {unitConfig.name}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-4 text-[11px] font-bold text-slate-600">
                      <span className="flex items-center gap-1">💵 {Num.parse(c.efectivo).toFixed(2)}€</span>
                      <span className="flex items-center gap-1">💳 {Num.parse(c.tarjeta).toFixed(2)}€</span>
                    </div>
                    
                    {c.unitId === 'REST' && (
                      <div className={cn(
                        "text-[10px] font-black uppercase flex items-center gap-1",
                        isOk ? "text-emerald-500" : "text-rose-500"
                      )}>
                        {isOk ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <AlertCircle className="w-3 h-3" />
                        )}
                        Descuadre: {c.descuadre > 0 ? '+' : ''}{Num.parse(c.descuadre).toFixed(2)}€
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-xl font-black text-slate-900 leading-none">
                    {Num.parse(c.totalVenta).toFixed(2)}€
                  </p>
                  <button 
                    onClick={() => onDelete(c.id)} 
                    className="mt-4 p-2 bg-rose-50 text-rose-500 rounded-xl opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500 hover:text-white"
                    title="Eliminar registro"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
});
