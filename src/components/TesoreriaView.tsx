import React, { useMemo, useState, useCallback } from 'react';
import { AppData, Albaran, Factura } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
// 🛡️ EL FIX: He añadido 'Loader2' a la lista de iconos importados
import { Wallet, ArrowUpRight, ArrowDownRight, AlertCircle, CheckCircle2, TrendingUp, TrendingDown, Clock, Building2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TesoreriaViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

// 🛡️ FECHAS SEGURAS (Previene saltos por Zona Horaria)
const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysDiffLocal = (from: Date, to: Date) => {
  const A = startOfLocalDay(from).getTime();
  const B = startOfLocalDay(to).getTime();
  const MS = 1000 * 60 * 60 * 24;
  return Math.floor((B - A) / MS);
};
const safeISODateLocal = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const TesoreriaView: React.FC<TesoreriaViewProps> = ({ data, onSave }) => {
  // 🔒 Hoy estable (una sola vez por render) para evitar recomputar
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [savingId, setSavingId] = useState<string | null>(null);

  const processedData = useMemo(() => {
    // Normalizadores de fecha de vencimiento (sin UTC drift)
    const computeDueDate = (dateStr: string | undefined, creditDays: number | undefined, fallbackDays = 30) => {
      const base = DateUtil.parse(dateStr || '');
      if (isNaN(base.getTime())) return dateStr || '';
      const d = startOfLocalDay(new Date(base));
      d.setDate(d.getDate() + (creditDays ?? fallbackDays));
      return safeISODateLocal(d);
    };

    const albaranes = (data.albaranes || []).map(a => ({
      ...a,
      dueDate: a.dueDate || computeDueDate(a.date, a.creditDays),
      paid: !!a.paid,
    }));

    const facturas = (data.facturas || []).map(f => ({
      ...f,
      dueDate: f.dueDate || computeDueDate(f.date, 30),
      paid: !!f.paid,
    }));

    // 🛡️ Filtro operativo adaptado a NUESTROS estados
    const isOperative = (doc: any) => {
      if (!('status' in doc)) return true; // Si no tiene status, asumimos que es antiguo/válido
      return doc.status !== 'draft' && doc.status !== 'mismatch'; 
    };

    const pendientesCobrar = facturas
      .filter(f => isOperative(f))
      .filter(f => !f.paid && !String(f.num).startsWith('Z-'))
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

    const pendientesPagar = albaranes
      .filter(a => isOperative(a))
      .filter(a => !a.paid)
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

    const totalCobrar = pendientesCobrar.reduce((t, f) => t + Num.parse(f.total), 0);
    const totalPagar = pendientesPagar.reduce((t, a) => t + Num.parse(a.total), 0);
    const posicionNeta = Num.round(totalCobrar - totalPagar);

    // 🧮 Riesgo (vencimiento) robusto
    const getRiesgo = (fecha: string) => {
      if (!fecha) return { label: 'Sin fecha', cls: 'text-slate-300', icon: <Clock className="w-3.5 h-3.5" /> };
      const d = DateUtil.parse(fecha);
      if (isNaN(d.getTime())) return { label: 'Fecha inválida', cls: 'text-slate-300', icon: <AlertCircle className="w-3.5 h-3.5" /> };
      const diff = daysDiffLocal(today, d); // positivo: falta, negativo: vencido
      
      if (diff < 0) return { label: `Vencido hace ${Math.abs(diff)} días`, cls: 'text-rose-600 font-black animate-pulse bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100', icon: <AlertCircle className="w-3.5 h-3.5 text-rose-500" /> };
      if (diff === 0) return { label: `Vence HOY`, cls: 'text-orange-500 font-black bg-orange-50 px-2 py-0.5 rounded-md border border-orange-100', icon: <AlertCircle className="w-3.5 h-3.5 text-orange-500" /> };
      if (diff <= 3) return { label: `Vence en ${diff} días`, cls: 'text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100', icon: <Clock className="w-3.5 h-3.5 text-amber-500" /> };
      if (diff <= 10) return { label: `Vence en ${diff} días`, cls: 'text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-md', icon: <Clock className="w-3.5 h-3.5 text-indigo-400" /> };
      return { label: `Vence en ${diff} días`, cls: 'text-slate-500 font-medium', icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> };
    };

    // 🔥 Proveedores Críticos (Top 3 Deudas)
    const mapaProveedores: Record<string, { total: number; count: number; urgencias: ReturnType<typeof getRiesgo>[] }> = {};
    pendientesPagar.forEach(a => {
      const key = a.prov || 'Varios';
      if (!mapaProveedores[key]) mapaProveedores[key] = { total: 0, count: 0, urgencias: [] };
      const tot = Num.parse(a.total);
      mapaProveedores[key].total = Num.round(mapaProveedores[key].total + tot);
      mapaProveedores[key].count++;
      mapaProveedores[key].urgencias.push(getRiesgo(a.dueDate!));
    });

    const proveedoresOrdenados = Object.entries(mapaProveedores)
      .sort(([, A], [, B]) => B.total - A.total)
      .slice(0, 3);

    return {
      pendientesCobrar,
      pendientesPagar,
      totalCobrar: Num.round(totalCobrar),
      totalPagar: Num.round(totalPagar),
      posicionNeta,
      proveedoresOrdenados,
      getRiesgo
    };
  }, [data.albaranes, data.facturas, today]);

  // 🧰 Helper: Idempotencia para movimientos de banco (Evita duplicados)
  const hasExistingLinkedMovement = useCallback((linkType: 'FACTURA'|'ALBARAN', linkId: string, amountAbs: number) => {
    const movimientos = data.banco || [];
    return movimientos.some(m =>
      m.linkType === linkType &&
      m.linkId === linkId &&
      Math.abs(Num.parse(m.amount)) === Math.abs(amountAbs)
    );
  }, [data.banco]);

  const handleCobrar = async (id: string) => {
    const fac = data.facturas.find(x => x.id === id);
    if (!fac) return;

    const amount = Num.parse(fac.total);
    if (!confirm(`¿Confirmas COBRAR factura ${fac.num} por ${Num.fmt(amount)}?\n\nSe creará un ingreso en el Banco (si no existe ya).`)) return;

    try {
      setSavingId(id);

      // 🔒 Clonado inmutable PROFUNDO
      const newData: AppData = {
        ...data,
        facturas: [...(data.facturas || [])],
        albaranes: [...(data.albaranes || [])],
        banco: [...(data.banco || [])],
      };

      const facIndex = newData.facturas.findIndex(x => x.id === id);
      if (facIndex !== -1) {
        newData.facturas[facIndex] = { ...newData.facturas[facIndex], paid: true, status: 'paid' };
      }

      if (!hasExistingLinkedMovement('FACTURA', id, amount)) {
        newData.banco.unshift({
          id: newId('mov'),
          date: safeISODateLocal(new Date()),
          desc: `Cobro factura ${fac.num} (${fac.cliente || fac.prov || 'Cliente'})`,
          amount: Num.round(amount),
          status: 'matched',
          linkType: 'FACTURA',
          linkId: fac.id,
          category: 'Ingreso Ventas'
        } as any);
      }

      await onSave(newData);
    } finally {
      setSavingId(null);
    }
  };

  const handlePagar = async (id: string) => {
    const alb = data.albaranes.find(x => x.id === id);
    if (!alb) return;

    const amount = -Math.abs(Num.parse(alb.total));
    if (!confirm(`¿Confirmas PAGAR albarán de ${alb.prov} por ${Num.fmt(Math.abs(amount))}?\n\nSe descontará del Banco (si no existe ya).`)) return;

    try {
      setSavingId(id);

      const newData: AppData = {
        ...data,
        facturas: [...(data.facturas || [])],
        albaranes: [...(data.albaranes || [])],
        banco: [...(data.banco || [])],
      };

      const albIndex = newData.albaranes.findIndex(x => x.id === id);
      if (albIndex !== -1) {
        newData.albaranes[albIndex] = { ...newData.albaranes[albIndex], paid: true };
      }

      if (!hasExistingLinkedMovement('ALBARAN', id, Math.abs(amount))) {
        newData.banco.unshift({
          id: newId('mov'),
          date: safeISODateLocal(new Date()),
          desc: `Pago proveedor ${alb.prov} (Ref: ${alb.num})`,
          amount: Num.round(amount),
          status: 'matched',
          linkType: 'ALBARAN',
          linkId: alb.id,
          category: 'Pago Proveedores'
        } as any);
      }

      const facVinculada = newData.facturas.find(f => f.albaranIdsArr?.includes(id));
      if (facVinculada && !facVinculada.paid) {
        const allPaid = facVinculada.albaranIdsArr?.every(aId => {
          const a = newData.albaranes?.find(al => al.id === aId);
          return a?.paid;
        });
        if (allPaid) {
           facVinculada.paid = true;
           facVinculada.status = 'paid';
        }
      }

      await onSave(newData);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">
      
      {/* 🏛️ HEADER PROFESIONAL */}
      <header className="bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
        
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="p-4 bg-blue-600 text-white rounded-[1.5rem] shadow-[0_0_20px_rgba(59,130,246,0.3)] shrink-0">
            <Wallet className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Tesorería Operativa</h2>
            <p className="text-[10px] text-blue-500 font-bold uppercase tracking-[0.2em] mt-0.5">Control de Cobros y Pagos</p>
          </div>
        </div>

        <div className="text-left md:text-right bg-slate-50 p-4 rounded-2xl border border-slate-100 w-full md:w-auto flex flex-row md:flex-col justify-between items-center md:items-end">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Posición Neta Estimada</p>
          <p className={cn("text-3xl font-black tracking-tighter tabular-nums", processedData.posicionNeta >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
            {Num.fmt(processedData.posicionNeta)}
          </p>
        </div>
      </header>

      {/* 🔥 TOP PROVEEDORES CRÍTICOS */}
      <div className="bg-slate-900 p-6 md:p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 opacity-10 pointer-events-none">
          <AlertCircle className="w-64 h-64 text-white" />
        </div>
        
        <h3 className="text-xs font-black text-white uppercase mb-6 flex items-center gap-2 relative z-10">
          <AlertCircle className="w-4 h-4 text-rose-500" />
          Deuda Crítica con Proveedores (Top 3)
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
          {processedData.proveedoresOrdenados.length > 0 ? (
            processedData.proveedoresOrdenados.map(([prov, info]) => {
              const hasCritical = info.urgencias.some(u => u.label.includes('Vencido'));
              return (
                <div key={prov} className="flex flex-col justify-between p-5 bg-slate-800 rounded-2xl border border-slate-700/50 shadow-inner">
                  <div className="flex justify-between items-start mb-4">
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-700">
                      <Building2 className={cn("w-5 h-5", hasCritical ? "text-rose-500" : "text-amber-500")} />
                    </div>
                    <span className="text-[9px] text-slate-400 font-black uppercase bg-slate-900 px-2 py-1 rounded-md border border-slate-700">{info.count} Docs</span>
                  </div>
                  <div>
                    <p className="font-black text-white text-lg truncate mb-1" title={prov}>{prov}</p>
                    <p className={cn("font-black text-2xl tracking-tighter tabular-nums", hasCritical ? "text-rose-400" : "text-amber-400")}>
                      {Num.fmt(info.total)}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-3 text-center py-8 bg-slate-800/50 rounded-2xl border border-slate-700/50 border-dashed flex flex-col items-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3 opacity-50" />
              <p className="text-sm text-emerald-300 font-black tracking-widest uppercase">Salud Financiera Óptima</p>
              <p className="text-[10px] text-slate-400 mt-1 uppercase">No hay deudas acumuladas con proveedores.</p>
            </div>
          )}
        </div>
      </div>

      {/* 🗂️ GRID DE CUENTAS A COBRAR Y PAGAR */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* 🟢 POR COBRAR (Cuentas a Cobrar - AR) */}
        <div className="bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col h-[700px]">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" /> Cuentas a Cobrar (AR)
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                {processedData.pendientesCobrar.length} documentos pendientes
              </p>
            </div>
            <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100 text-right">
              <span className="font-black text-emerald-600 text-2xl tabular-nums tracking-tighter">{Num.fmt(processedData.totalCobrar)}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
            <AnimatePresence mode="popLayout">
              {processedData.pendientesCobrar.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-24 text-emerald-600/40 h-full">
                  <CheckCircle2 className="w-16 h-16 mb-4 opacity-50" />
                  <p className="text-sm font-black uppercase tracking-widest">Todo cobrado</p>
                </motion.div>
              ) : (
                processedData.pendientesCobrar.map(f => {
                  const r = processedData.getRiesgo(f.dueDate!);
                  return (
                    <motion.div 
                      key={f.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, x: -50, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex justify-between items-center group hover:border-emerald-200 transition-all hover:shadow-md"
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-black text-slate-800 text-sm truncate">{f.cliente || f.prov || 'Cliente'}</p>
                          <span className="text-[8px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-bold tracking-widest border border-slate-200">Factura</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className={cn("text-[9px] uppercase font-bold flex items-center gap-1 w-max", r.cls)}>
                            {r.icon} {r.label}
                          </p>
                          <p className="text-[9px] text-slate-400 font-mono">Ref: {f.num}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end">
                        <p className="font-black text-emerald-600 text-lg tracking-tighter tabular-nums mb-2">{Num.fmt(f.total)}</p>
                        <button
                          onClick={() => handleCobrar(f.id)}
                          disabled={savingId === f.id}
                          className={cn(
                            "text-[9px] px-5 py-2 rounded-xl font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 flex items-center gap-1.5",
                            savingId === f.id ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-emerald-600/20"
                          )}
                        >
                          {savingId === f.id ? <Loader2 className="w-3 h-3 animate-spin"/> : <ArrowDownRight className="w-3 h-3"/>}
                          {savingId === f.id ? "PROCESANDO" : "Registrar Cobro"}
                        </button>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 🔴 POR PAGAR (Cuentas a Pagar - AP) */}
        <div className="bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col h-[700px]">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-rose-500" /> Cuentas a Pagar (AP)
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                {processedData.pendientesPagar.length} documentos pendientes
              </p>
            </div>
            <div className="bg-rose-50 p-3 rounded-2xl border border-rose-100 text-right">
              <span className="font-black text-rose-600 text-2xl tabular-nums tracking-tighter">{Num.fmt(processedData.totalPagar)}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
            <AnimatePresence mode="popLayout">
              {processedData.pendientesPagar.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-24 text-rose-600/40 h-full">
                  <CheckCircle2 className="w-16 h-16 mb-4 opacity-50" />
                  <p className="text-sm font-black uppercase tracking-widest">Sin deudas</p>
                </motion.div>
              ) : (
                processedData.pendientesPagar.map(a => {
                  const r = processedData.getRiesgo(a.dueDate!);
                  return (
                    <motion.div 
                      key={a.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, x: 50, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex justify-between items-center group hover:border-rose-200 transition-all hover:shadow-md"
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-black text-slate-800 text-sm truncate">{a.prov}</p>
                          <span className="text-[8px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-bold tracking-widest border border-slate-200">Albarán</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className={cn("text-[9px] uppercase font-bold flex items-center gap-1 w-max", r.cls)}>
                            {r.icon} {r.label}
                          </p>
                          <p className="text-[9px] text-slate-400 font-mono">Ref: {a.num}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end">
                        <p className="font-black text-rose-600 text-lg tracking-tighter tabular-nums mb-2">{Num.fmt(a.total)}</p>
                        <button
                          onClick={() => handlePagar(a.id)}
                          disabled={savingId === a.id}
                          className={cn(
                            "text-[9px] px-5 py-2 rounded-xl font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 flex items-center gap-1.5",
                            savingId === a.id ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-rose-600 text-white hover:bg-rose-700 hover:shadow-rose-600/20"
                          )}
                        >
                          {savingId === a.id ? <Loader2 className="w-3 h-3 animate-spin"/> : <ArrowUpRight className="w-3 h-3"/>}
                          {savingId === a.id ? "PROCESANDO" : "Emitir Pago"}
                        </button>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </div>

      </div>
    </div>
  );
};
