import React, { useMemo } from 'react';
import { Truck, CheckCircle2, Clock } from 'lucide-react';
import { Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { BusinessUnit } from '../views/AlbaranesView';

interface AlbaranesListProps {
  albaranes: Albaran[];
  searchQ: string;
  selectedUnit: BusinessUnit | 'ALL';
  businessUnits: any[];
  onOpenEdit: (albaran: Albaran) => void;
}

export const AlbaranesList = ({ albaranes, searchQ, selectedUnit, businessUnits, onOpenEdit }: AlbaranesListProps) => {
  
  const filteredAlbaranes = useMemo(() => {
    return albaranes.filter(a => {
      if (selectedUnit !== 'ALL' && (a.unitId || 'REST') !== selectedUnit) return false;
      const term = searchQ.toLowerCase();
      return (a.prov || '').toLowerCase().includes(term) || (a.num || '').toLowerCase().includes(term);
    }).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [albaranes, searchQ, selectedUnit]);

  if (filteredAlbaranes.length === 0) {
    return (
      <div className="py-20 text-center opacity-50 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200">
        <Truck className="w-12 h-12 mx-auto mb-3 text-slate-300" />
        <p className="text-slate-500 font-bold text-sm">Sin registros.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-20">
      {filteredAlbaranes.map(a => {
        const unitConfig = businessUnits.find(u => u.id === (a.unitId || 'REST'));
        return (
          <div key={a.id} onClick={() => onOpenEdit(a)} className={cn("bg-white p-5 rounded-3xl border border-slate-100 flex justify-between items-center shadow-sm hover:shadow-md transition cursor-pointer", a.reconciled && "ring-2 ring-emerald-400/50")}>
            <div>
              <h4 className="font-black text-slate-800 flex items-center gap-2 flex-wrap">
                {a.prov}
                {unitConfig && <span className={cn("text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1", unitConfig.color, unitConfig.bg)}><unitConfig.icon className="w-3 h-3" />{unitConfig.name}</span>}
              </h4>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[10px] text-slate-400 font-bold">{a.date}</p>
                {a.notes && <span className="text-[9px] text-indigo-400 bg-indigo-50 px-1.5 rounded font-bold">📝 Nota</span>}
                {a.reconciled && <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 rounded font-black">🔗 Conciliado</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="font-black text-slate-900 text-lg">{Num.fmt(a.total)}</p>
              <span className={cn("text-[8px] font-black uppercase", a.paid ? 'text-emerald-500' : 'text-rose-500')}>{a.paid ? 'Pagado' : 'Pendiente'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
