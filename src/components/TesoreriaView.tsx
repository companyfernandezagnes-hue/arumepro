import React, { useMemo } from 'react';
import { AppData, Albaran, Factura } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { Wallet, ArrowUpRight, ArrowDownRight, AlertCircle, CheckCircle2 } from 'lucide-react';

interface TesoreriaViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const TesoreriaView: React.FC<TesoreriaViewProps> = ({ data, onSave }) => {
  const hoy = new Date();

  const processedData = useMemo(() => {
    const albaranes = (data.albaranes || []).map(a => {
      const dueDate = a.dueDate || (() => {
        const d = DateUtil.parse(a.date);
        if (isNaN(d.getTime())) return a.date || '';
        const dias = a.creditDays || 30;
        d.setDate(d.getDate() + dias);
        try {
          return d.toISOString().split('T')[0];
        } catch (e) {
          return a.date || '';
        }
      })();
      return { ...a, dueDate, paid: !!a.paid };
    });

    const facturas = (data.facturas || []).map(f => {
      const dueDate = f.dueDate || (() => {
        const d = DateUtil.parse(f.date);
        if (isNaN(d.getTime())) return f.date || '';
        d.setDate(d.getDate() + 30);
        try {
          return d.toISOString().split('T')[0];
        } catch (e) {
          return f.date || '';
        }
      })();
      return { ...f, dueDate, paid: !!f.paid };
    });

    const pendientesCobrar = facturas.filter(f => !f.paid && !String(f.num).startsWith('Z-'));
    const pendientesPagar = albaranes.filter(a => !a.paid);

    const totalCobrar = pendientesCobrar.reduce((t, f) => t + Num.parse(f.total), 0);
    const totalPagar = pendientesPagar.reduce((t, a) => t + Num.parse(a.total), 0);
    const posicionNeta = totalCobrar - totalPagar;

    // Riesgo
    const getRiesgo = (fecha: string) => {
      if (!fecha) return { label: 'Sin fecha', cls: 'text-slate-300', icon: '❓' };
      const d = DateUtil.parse(fecha);
      if (isNaN(d.getTime())) return { label: 'Fecha inválida', cls: 'text-slate-300', icon: '❓' };
      const diff = Math.ceil((d.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));

      if (diff < 0) return { label: `Vencido hace ${Math.abs(diff)} días`, cls: 'text-rose-600 font-black animate-pulse', icon: '🔥' };
      if (diff <= 3) return { label: `Vence en ${diff} días`, cls: 'text-orange-500 font-bold', icon: '🟠' };
      if (diff <= 10) return { label: `Vence en ${diff} días`, cls: 'text-amber-500 font-bold', icon: '🟡' };
      return { label: `Vence en ${diff} días`, cls: 'text-slate-400', icon: '🟢' };
    };

    // Proveedores Críticos
    const mapaProveedores: Record<string, { total: number; count: number; urgencias: any[] }> = {};
    pendientesPagar.forEach(a => {
      const key = a.prov || 'Varios';
      if (!mapaProveedores[key]) mapaProveedores[key] = { total: 0, count: 0, urgencias: [] };
      mapaProveedores[key].total += Num.parse(a.total);
      mapaProveedores[key].count++;
      mapaProveedores[key].urgencias.push(getRiesgo(a.dueDate!));
    });

    const proveedoresOrdenados = Object.entries(mapaProveedores)
      .sort(([, A], [, B]) => B.total - A.total)
      .slice(0, 3);

    return {
      pendientesCobrar,
      pendientesPagar,
      totalCobrar,
      totalPagar,
      posicionNeta,
      proveedoresOrdenados,
      getRiesgo
    };
  }, [data.albaranes, data.facturas, hoy]);

  const handleCobrar = async (id: string) => {
    const fac = data.facturas.find(x => x.id === id);
    if (!fac) return;

    if (!confirm(`¿Confirmas COBRAR factura ${fac.num} por ${Num.fmt(fac.total)}?\n\nSe creará un ingreso en el Banco.`)) return;

    const newData = { ...data };
    const facIndex = newData.facturas.findIndex(x => x.id === id);
    if (facIndex !== -1) {
      newData.facturas[facIndex] = { ...newData.facturas[facIndex], paid: true };
    }

    newData.banco = [
      {
        id: 'mov-' + Date.now(),
        date: new Date().toISOString().slice(0, 10),
        desc: `Cobro factura ${fac.num} (${fac.cliente || fac.prov})`,
        amount: Num.parse(fac.total),
        status: 'matched',
        linkType: 'FACTURA',
        linkId: fac.id
      },
      ...(newData.banco || [])
    ];

    await onSave(newData);
  };

  const handlePagar = async (id: string) => {
    const alb = data.albaranes.find(x => x.id === id);
    if (!alb) return;

    if (!confirm(`¿Confirmas PAGAR albarán de ${alb.prov} por ${Num.fmt(alb.total)}?\n\nSe descontará del Banco.`)) return;

    const newData = { ...data };
    const albIndex = newData.albaranes.findIndex(x => x.id === id);
    if (albIndex !== -1) {
      newData.albaranes[albIndex] = { ...newData.albaranes[albIndex], paid: true };
    }

    newData.banco = [
      {
        id: 'mov-' + Date.now(),
        date: new Date().toISOString().slice(0, 10),
        desc: `Pago proveedor ${alb.prov} (Ref: ${alb.num})`,
        amount: -Math.abs(Num.parse(alb.total)),
        status: 'matched',
        linkType: 'ALBARAN',
        linkId: alb.id
      },
      ...(newData.banco || [])
    ];

    await onSave(newData);
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header */}
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tighter">Tesorería Operativa</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Saldo Futuro · Riesgo · Obligaciones</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Posición Neta</p>
          <p className={cn(
            "text-3xl font-black tracking-tighter",
            processedData.posicionNeta >= 0 ? 'text-emerald-500' : 'text-rose-500'
          )}>
            {Num.fmt(processedData.posicionNeta)}
          </p>
        </div>
      </header>

      {/* Top Proveedores Críticos */}
      <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
        <h3 className="text-xs font-black text-slate-800 uppercase mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-500" />
          Top Proveedores Críticos
        </h3>
        <div className="space-y-1">
          {processedData.proveedoresOrdenados.length > 0 ? (
            processedData.proveedoresOrdenados.map(([prov, info]) => {
              const hasCritical = info.urgencias.some(u => u.icon === '🔥');
              const hasWarning = info.urgencias.some(u => u.icon === '🟠');
              return (
                <div key={prov} className="flex justify-between items-center py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition px-4 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">
                      {hasCritical ? '🔥' : (hasWarning ? '🟠' : '🟢')}
                    </span>
                    <div>
                      <p className="font-bold text-slate-700 text-sm">{prov}</p>
                      <p className="text-[9px] text-slate-400 font-bold uppercase">{info.count} facturas pendientes</p>
                    </div>
                  </div>
                  <p className="font-black text-rose-500 text-sm">{Num.fmt(info.total)}</p>
                </div>
              );
            })
          ) : (
            <div className="text-center py-8">
              <CheckCircle2 className="w-8 h-8 text-emerald-200 mx-auto mb-2" />
              <p className="text-xs text-slate-400 italic font-bold">No hay deudas críticas 🎉</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Por Cobrar */}
        <div className="space-y-3">
          <div className="flex justify-between items-center px-4">
            <h3 className="font-black text-emerald-600 text-xs uppercase flex items-center gap-2 tracking-widest">
              ⬇️ Por Cobrar 
              <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[10px]">
                {processedData.pendientesCobrar.length}
              </span>
            </h3>
            <span className="font-black text-emerald-600 text-sm">{Num.fmt(processedData.totalCobrar)}</span>
          </div>
          <div className="bg-emerald-50/50 p-3 rounded-[2rem] border border-emerald-100 min-h-[200px] space-y-3">
            {processedData.pendientesCobrar.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-emerald-300">
                <CheckCircle2 className="w-10 h-10 mb-2 opacity-20" />
                <p className="text-xs font-bold italic">Todo cobrado ✅</p>
              </div>
            ) : (
              processedData.pendientesCobrar.map(f => {
                const r = processedData.getRiesgo(f.dueDate!);
                return (
                  <div key={f.id} className="bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm flex justify-between items-center relative overflow-hidden group hover:shadow-md transition-all">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-400"></div>
                    <div className="flex-1 min-w-0 pr-4">
                      <p className="font-bold text-slate-700 text-sm truncate">{f.cliente || f.prov || 'Cliente'}</p>
                      <p className={cn("text-[9px] uppercase mt-0.5", r.cls)}>{r.label}</p>
                      <p className="text-[8px] text-slate-400 font-mono mt-1">Ref: {f.num}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black text-emerald-600 text-lg tracking-tighter">{Num.fmt(f.total)}</p>
                      <button 
                        onClick={() => handleCobrar(f.id)} 
                        className="text-[9px] bg-emerald-100 text-emerald-700 px-4 py-2 rounded-xl font-black mt-2 hover:bg-emerald-600 hover:text-white transition shadow-sm active:scale-95"
                      >
                        COBRAR
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Por Pagar */}
        <div className="space-y-3">
          <div className="flex justify-between items-center px-4">
            <h3 className="font-black text-rose-500 text-xs uppercase flex items-center gap-2 tracking-widest">
              ⬆️ Por Pagar 
              <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full text-[10px]">
                {processedData.pendientesPagar.length}
              </span>
            </h3>
            <span className="font-black text-rose-500 text-sm">{Num.fmt(processedData.totalPagar)}</span>
          </div>
          <div className="bg-rose-50/50 p-3 rounded-[2rem] border border-rose-100 min-h-[200px] space-y-3">
            {processedData.pendientesPagar.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-rose-300">
                <CheckCircle2 className="w-10 h-10 mb-2 opacity-20" />
                <p className="text-xs font-bold italic">Sin deudas ✅</p>
              </div>
            ) : (
              processedData.pendientesPagar.map(a => {
                const r = processedData.getRiesgo(a.dueDate!);
                return (
                  <div key={a.id} className="bg-white p-4 rounded-2xl border border-rose-100 shadow-sm flex justify-between items-center relative overflow-hidden group hover:shadow-md transition-all">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-400"></div>
                    <div className="flex-1 min-w-0 pr-4">
                      <p className="font-bold text-slate-700 text-sm truncate">{a.prov}</p>
                      <p className={cn("text-[9px] uppercase mt-0.5", r.cls)}>{r.label}</p>
                      <p className="text-[8px] text-slate-400 font-mono mt-1">Ref: {a.num}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black text-rose-600 text-lg tracking-tighter">{Num.fmt(a.total)}</p>
                      <button 
                        onClick={() => handlePagar(a.id)} 
                        className="text-[9px] bg-rose-100 text-rose-700 px-4 py-2 rounded-xl font-black mt-2 hover:bg-rose-600 hover:text-white transition shadow-sm active:scale-95"
                      >
                        PAGAR
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
