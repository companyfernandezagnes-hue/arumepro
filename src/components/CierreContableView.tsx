import React, { useState, useMemo, useCallback } from 'react';
import { 
  Lock, Unlock, ChevronLeft, ChevronRight, 
  CheckCircle2, AlertCircle, TrendingUp, TrendingDown, 
  BarChart3, ShieldCheck, Download, Wallet, Activity, Target, Scale, Lightbulb, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppData, CierreMensual } from '../types';
import { ArumeEngine, Num } from '../services/engine';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';

interface CierreContableViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const CierreContableView: React.FC<CierreContableViewProps> = ({ data, onSave }) => {
  const [year, setYear] = useState(new Date().getFullYear());
  const [isExporting, setIsExporting] = useState(false);

  const meses = useMemo(() => [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ], []);

  const cierresMensuales = useMemo(() => data.cierres_mensuales || [], [data.cierres_mensuales]);

  // 🚀 CEREBRO P&L: Calcula todo el año
  const yearlySnapshots = useMemo(() => {
    return meses.map((_, i) => {
      const cierreOficial = cierresMensuales.find(c => c.mes === i && c.anio === year);
      if (cierreOficial) return { ...cierreOficial.snapshot, isClosed: true, id: cierreOficial.id, fecha_cierre: cierreOficial.fecha_cierre };

      const profitData = ArumeEngine.getProfit(data, i + 1, year);
      return {
        ventas: profitData.ingresos.total,
        compras: profitData.gastos.comida + profitData.gastos.bebida + profitData.gastos.otros, // Costes Variables
        fijos: profitData.gastos.personal + profitData.gastos.estructura, // Costes Fijos
        amortizaciones: profitData.gastos.amortizacion,
        resultado: profitData.neto,
        isClosed: false, id: null, fecha_cierre: null
      };
    });
  }, [data, year, meses, cierresMensuales]);

  // 💰 KPIs ANUALES (Desglosados según teoría del Punto de Equilibrio)
  const kpis = useMemo(() => {
    return yearlySnapshots.reduce((acc, s) => ({
      ventas: acc.ventas + s.ventas,
      variables: acc.variables + s.compras,
      fijos: acc.fijos + s.fijos + s.amortizaciones,
      resultado: acc.resultado + s.resultado
    }), { ventas: 0, variables: 0, fijos: 0, resultado: 0 });
  }, [yearlySnapshots]);

  // 🧠 FÓRMULAS MAGISTRALES DEL PDF (Pág. 48-50)
  const margenContribucionValor = kpis.ventas - kpis.variables;
  const margenContribucionPct = kpis.ventas > 0 ? margenContribucionValor / kpis.ventas : 0;
  const puntoEquilibrio = margenContribucionPct > 0 ? kpis.fijos / margenContribucionPct : 0;
  
  const foodCostPct = kpis.ventas > 0 ? (kpis.variables / kpis.ventas) * 100 : 0;
  const margenNeto = kpis.ventas > 0 ? (kpis.resultado / kpis.ventas) * 100 : 0;

  // 📊 DATOS PARA EL GRÁFICO
  const chartData = useMemo(() => {
    return yearlySnapshots.map((s, i) => ({
      name: meses[i].substring(0, 3).toUpperCase(),
      Ventas: Num.round2(s.ventas),
      Gastos: Num.round2(s.compras + s.fijos + s.amortizaciones),
      Neto: Num.round2(s.resultado)
    }));
  }, [yearlySnapshots, meses]);

  const handleCerrarMes = useCallback(async (mesIndex: number, snapshot: any) => {
    if (snapshot.ventas <= 0 && snapshot.compras <= 0 && snapshot.fijos <= 0) return alert("⚠️ Bloqueo: No hay movimientos en este mes para auditar.");
    const confirmMsg = `🔒 AUDITORÍA DEFINITIVA - ${meses[mesIndex].toUpperCase()} ${year}\n\n¿Confirmas que los datos contables son correctos y deseas congelar el mes?`;
    if (!window.confirm(confirmMsg)) return;

    const cleanSnapshot = { ventas: snapshot.ventas, compras: snapshot.compras, fijos: snapshot.fijos, amortizaciones: snapshot.amortizaciones, resultado: snapshot.resultado };
    const nuevoCierre: CierreMensual = { id: `cierre-${year}-${mesIndex}`, mes: mesIndex, anio: year, fecha_cierre: new Date().toISOString(), snapshot: cleanSnapshot };

    try { await onSave({ ...data, cierres_mensuales: [...cierresMensuales.filter(c => c.id !== nuevoCierre.id), nuevoCierre] }); } 
    catch (error) { alert("❌ Error al guardar el cierre."); }
  }, [cierresMensuales, data, meses, onSave, year]);

  const handleAbrirMes = useCallback(async (id: string | null) => {
    if (!id) return;
    if (!window.confirm("⚠️ ALERTA: Si reabres este mes, los números se recalcularán vivos. ¿Continuar?")) return;
    try { await onSave({ ...data, cierres_mensuales: cierresMensuales.filter(c => c.id !== id) }); } 
    catch (error) { alert("❌ Error al reabrir."); }
  }, [cierresMensuales, data, onSave]);

  const handleExportYear = () => {
    setIsExporting(true);
    try {
      const rows = yearlySnapshots.map((s, i) => ({
        'PERIODO': `${meses[i]} ${year}`,
        'ESTADO': s.isClosed ? 'CERRADO' : 'ABIERTO',
        'INGRESOS TOTALES': Num.round2(s.ventas),
        'COSTES VARIABLES (Materias)': Num.round2(s.compras),
        'COSTES FIJOS': Num.round2(s.fijos),
        'BENEFICIO NETO': Num.round2(s.resultado)
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{wch: 18}, {wch: 15}, {wch: 20}, {wch: 25}, {wch: 20}, {wch: 20}];
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, `Balance_${year}`); XLSX.writeFile(wb, `Balance_Arume_${year}.xlsx`);
    } catch (error) { alert("Error al exportar."); } finally { setIsExporting(false); }
  };

  const now = new Date();

  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">
      
      {/* 🏛️ HEADER PROFESIONAL */}
      <header className="bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-purple-600"></div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="p-4 bg-indigo-600 text-white rounded-[1.5rem] shadow-[0_0_20px_rgba(79,70,229,0.3)] shrink-0">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Cierre Contable P&L</h2>
            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-[0.2em] mt-0.5">Auditoría & Análisis de Rentabilidad</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 w-full md:w-auto justify-end">
          <button onClick={handleExportYear} disabled={isExporting} className="flex items-center gap-2 px-5 py-3 bg-emerald-50 text-emerald-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition border border-emerald-200 shadow-sm disabled:opacity-50">
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4" />}
            <span className="hidden md:inline">Descargar P&G</span>
          </button>
          <div className="flex items-center bg-slate-100 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
            <button onClick={() => setYear(y => y - 1)} className="p-2.5 bg-white hover:bg-slate-50 rounded-xl transition shadow-sm text-slate-600"><ChevronLeft className="w-4 h-4"/></button>
            <span className="px-6 font-black text-lg text-slate-800 tabular-nums">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="p-2.5 bg-white hover:bg-slate-50 rounded-xl transition shadow-sm text-slate-600"><ChevronRight className="w-4 h-4"/></button>
          </div>
        </div>
      </header>

      {/* 📊 DASHBOARD FINANCIERO: LA MENTE DEL CFO */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* PANEL IZQUIERDO: KPIs ESTRATÉGICOS (Basados en el PDF) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Tarjeta de Punto de Equilibrio */}
          <div className="bg-slate-900 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden flex-1">
            <div className="absolute -right-4 -bottom-4 text-white/5"><Target className="w-48 h-48" /></div>
            <div className="relative z-10 flex flex-col h-full justify-center">
              <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 mb-2"><Scale className="w-4 h-4"/> Punto de Equilibrio (Break-Even)</p>
              <h3 className="text-4xl lg:text-5xl font-black tracking-tighter tabular-nums mb-1">{Num.fmt(puntoEquilibrio)}</h3>
              <p className="text-xs font-bold text-slate-400">Facturación YTD necesaria para cubrir los <span className="text-white">Costes Fijos ({Num.fmt(kpis.fijos)})</span></p>
              
              <div className="mt-8 pt-6 border-t border-white/10 flex justify-between items-end">
                <div>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Margen Contribución</p>
                  <p className="text-2xl font-black tabular-nums text-white">{Num.round2(margenContribucionPct * 100)}%</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Situación Actual</p>
                  {kpis.ventas >= puntoEquilibrio && puntoEquilibrio > 0 ? (
                    <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase">¡En Beneficios!</span>
                  ) : (
                    <span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase">En Pérdidas</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tarjetas Gemelas: Food Cost y Resultado Neto */}
          <div className="grid grid-cols-2 gap-4">
            <div className={cn("p-6 rounded-[2rem] border shadow-sm flex flex-col justify-center", foodCostPct > 35 ? "bg-rose-50 border-rose-100" : "bg-white border-slate-200")}>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Coste Materia Prima</p>
              <p className={cn("text-3xl font-black tabular-nums tracking-tighter", foodCostPct > 35 ? "text-rose-600" : "text-slate-800")}>{Num.round2(foodCostPct)}%</p>
              <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 overflow-hidden">
                <div className={cn("h-full", foodCostPct > 35 ? "bg-rose-500" : "bg-emerald-400")} style={{ width: `${Math.min(foodCostPct, 100)}%` }} />
              </div>
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-2 text-right">Ideal: &lt; 35%</p>
            </div>

            <div className={cn("p-6 rounded-[2rem] border shadow-sm flex flex-col justify-center", kpis.resultado >= 0 ? "bg-indigo-50 border-indigo-100" : "bg-rose-50 border-rose-100")}>
              <p className={cn("text-[9px] font-black uppercase tracking-widest flex items-center gap-1 mb-1", kpis.resultado >= 0 ? "text-indigo-500" : "text-rose-500")}><Wallet className="w-3 h-3"/> Neto YTD</p>
              <p className={cn("text-2xl lg:text-3xl font-black tabular-nums tracking-tighter", kpis.resultado >= 0 ? "text-indigo-700" : "text-rose-700")}>{Num.fmt(kpis.resultado)}</p>
              <p className={cn("text-[10px] font-bold uppercase mt-2", kpis.resultado >= 0 ? "text-indigo-400" : "text-rose-400")}>Margen: {Num.round2(margenNeto)}%</p>
            </div>
          </div>
        </div>

        {/* PANEL DERECHO: GRÁFICO EVOLUTIVO */}
        <div className="lg:col-span-7 bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2"><Activity className="w-5 h-5 text-indigo-500"/> Evolución P&L {year}</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Ingresos vs Gastos vs Neto</p>
            </div>
            <div className="hidden sm:flex gap-4">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-400"></div><span className="text-[9px] font-black uppercase text-slate-500">Ingresos</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-rose-400"></div><span className="text-[9px] font-black uppercase text-slate-500">Gastos</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-indigo-600"></div><span className="text-[9px] font-black uppercase text-slate-500">Neto</span></div>
            </div>
          </div>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={false} tickLine={false} tickFormatter={(v)=>`${v/1000}k`} />
                <RechartsTooltip 
                  contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                  formatter={(val: number, name: string) => [Num.fmt(val), name]}
                  labelStyle={{ fontWeight: 'black', color: '#1e293b', marginBottom: '4px' }}
                />
                <Bar dataKey="Gastos" fill="#fb7185" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Bar dataKey="Ventas" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Line type="monotone" dataKey="Neto" stroke="#4f46e5" strokeWidth={3} dot={{r: 4, strokeWidth: 2, fill: '#fff'}} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* 💡 CONSULTOR FINANCIERO */}
      <div className="bg-indigo-50/50 border border-indigo-100 rounded-3xl p-6 flex gap-4 items-start">
        <div className="bg-white p-3 rounded-2xl shadow-sm"><Lightbulb className="w-6 h-6 text-amber-500" /></div>
        <div>
          <h4 className="text-sm font-black text-indigo-900 mb-1">Diagnóstico Financiero de Arume</h4>
          <p className="text-xs font-bold text-indigo-700/80 leading-relaxed">
            {kpis.ventas === 0 ? "Aún no hay datos de ventas registrados este año." : 
             kpis.resultado < 0 ? `Estás por debajo del punto de equilibrio. Faltan ${Num.fmt(puntoEquilibrio - kpis.ventas)} en ventas para empezar a ganar dinero. Revisa la ingeniería de tu menú e intenta potenciar los 'Platos Estrella' y 'Platos Vaca' que tienen buen margen de contribución.` : 
             foodCostPct > 35 ? `¡Estás en beneficios! Pero cuidado, tu coste de materia prima (${Num.round2(foodCostPct)}%) es alto. Revisa el Menú Engineering de tus platos para ver si hay 'Platos Perro' que estén hundiendo tu rentabilidad o sube precios en los más populares.` : 
             "¡Excelente salud financiera! Tienes un coste de materia prima óptimo y estás superando tu punto de equilibrio. Sigue potenciando tus 'Platos Estrella'."}
          </p>
        </div>
      </div>

      {/* 📅 GRID DE MESES PARA CIERRE OFICIAL (Botones Refinados) */}
      <div className="mt-8">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4 ml-4">Auditoría Mensual</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          <AnimatePresence mode='popLayout'>
            {meses.map((nombreMes, i) => {
              const datos = yearlySnapshots[i];
              const isClosed = datos.isClosed;
              const isFuture = year > now.getFullYear() || (year === now.getFullYear() && i > now.getMonth());
              const canClose = !isClosed && !isFuture;

              const margenMensual = datos.ventas > 0 ? (datos.resultado / datos.ventas) * 100 : 0;
              const gastosMes = datos.compras + datos.fijos + datos.amortizaciones;

              return (
                <motion.div
                  key={`${year}-${i}`}
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
                  className={cn(
                    "relative p-5 rounded-[2rem] border transition-all duration-300 flex flex-col group",
                    isClosed 
                      ? "bg-white border-emerald-200 shadow-[0_5px_20px_-10px_rgba(16,185,129,0.15)]" 
                      : isFuture 
                        ? "bg-slate-50/50 border-slate-100 opacity-60 grayscale-[0.5]"
                        : "bg-white border-slate-200 hover:border-indigo-300 hover:shadow-lg"
                  )}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className={cn("text-lg font-black tracking-tighter", isFuture ? "text-slate-400" : "text-slate-800")}>{nombreMes}</h3>
                      <div className={cn("flex items-center gap-1 mt-0.5 text-[8px] font-black uppercase tracking-wider", isClosed ? "text-emerald-600" : isFuture ? "text-slate-400" : "text-indigo-500")}>
                        {isClosed ? <Lock className="w-2 h-2" /> : <Unlock className="w-2 h-2" />}
                        {isClosed ? "Auditado" : isFuture ? "Futuro" : "En Edición"}
                      </div>
                    </div>
                    {isClosed && <div className="bg-emerald-50 border border-emerald-100 p-1.5 rounded-full"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /></div>}
                  </div>

                  <div className="space-y-1.5 mb-5 flex-1">
                    <div className="flex justify-between items-center bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-100">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Ventas</span>
                      <span className="text-[11px] font-black text-slate-700 tabular-nums">{Num.fmt(datos.ventas)}</span>
                    </div>
                    <div className="flex justify-between items-center bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-100">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Gastos</span>
                      <span className="text-[11px] font-bold text-rose-500 tabular-nums">-{Num.fmt(gastosMes)}</span>
                    </div>
                    
                    <div className="pt-2 flex justify-between items-end">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Neto</span>
                      <p className={cn("text-xl font-black tracking-tighter leading-none tabular-nums", datos.resultado >= 0 ? "text-emerald-600" : "text-rose-600")}>
                        {Num.fmt(datos.resultado)}
                      </p>
                    </div>
                    
                    {!isFuture && (
                      <div className="w-full bg-slate-100 h-1 rounded-full mt-1.5 overflow-hidden flex">
                        <div className={cn("h-full", datos.resultado >= 0 ? "bg-emerald-400" : "bg-rose-400")} style={{ width: `${Math.min(Math.max(margenMensual, 0), 100)}%` }} />
                      </div>
                    )}
                  </div>

                  {/* BOTONES ELEGANTES (Más pequeños y finos) */}
                  <div className="mt-auto pt-2">
                    {canClose && (
                      <button onClick={() => handleCerrarMes(i, datos)} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95 shadow-sm flex items-center justify-center gap-1.5">
                        <Lock className="w-3 h-3" /> Congelar Mes
                      </button>
                    )}
                    {isClosed && (
                      <button onClick={() => handleAbrirMes(datos.id)} className="w-full py-2 bg-white border border-rose-200 text-rose-600 rounded-xl font-bold text-[9px] uppercase tracking-widest hover:bg-rose-50 transition-all shadow-sm flex items-center justify-center gap-1.5">
                        <Unlock className="w-3 h-3" /> Reabrir Mes
                      </button>
                    )}
                    {isFuture && (
                      <div className="w-full py-2 flex justify-center items-center gap-1.5 opacity-50">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">En Espera</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
