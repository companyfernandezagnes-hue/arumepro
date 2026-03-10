import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, TrendingDown, ChevronLeft, ChevronRight, 
  Building2, Hotel, ShoppingBag, Users, Brain,
  BarChart3, Landmark, Target, FolderOpen, CheckCircle2,
  Sparkles, FileSpreadsheet, Loader2, AlertTriangle, X
} from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import { AppData } from '../types';
import { ArumeEngine, Num } from '../services/engine';
import { cn } from '../lib/utils';
import { GoogleGenAI } from "@google/genai";

export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';
type TabType = 'resultados' | 'fiscal' | 'kpis' | 'carpeta';

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'DLV', name: 'Catering Hoteles', icon: Hotel, color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'CORP', name: 'Socios / Corp', icon: Users, color: 'text-slate-600', bg: 'bg-slate-100' }
];

const TABS: { id: TabType; label: string; icon: any }[] = [
  { id: 'resultados', label: 'Resultados P&L', icon: BarChart3 },
  { id: 'fiscal', label: 'Cierre Fiscal', icon: Landmark },
  { id: 'kpis', label: 'KPIs & BI', icon: Target },
  { id: 'carpeta', label: 'Carpeta Docs', icon: FolderOpen },
];

export const ReportsView = ({ data }: { data: AppData }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<TabType>('resultados');
  
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [exportHistory, setExportHistory] = useState<{date: string, type: string}[]>([]);

  const handleMonthChange = (offset: number) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(currentDate.getMonth() + offset);
    setCurrentDate(newDate);
    setAiInsight(null); 
  };

  const monthName = currentDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();
  const month = currentDate.getMonth();
  const year = currentDate.getFullYear();

  /* =======================================================
   * 🚀 CÁLCULO ASÍNCRONO NO BLOQUEANTE (Anti-Crash y Anti-Lag)
   * ======================================================= */
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    setLoadingStats(true);
    // Este pequeño retraso permite que React pinte el Loader antes de bloquear la CPU
    const timer = setTimeout(() => {
      try {
        const computedStats = ArumeEngine.getProfit(data, month + 1, year);
        setStats(computedStats);
      } catch (error) {
        console.error("Error al calcular P&L:", error);
      } finally {
        setLoadingStats(false);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [data, month, year]);

  /* =======================================================
   * 🏛️ CÁLCULOS FISCALES PRO (IVA Desglosado 10/21)
   * ======================================================= */
  const fiscalData = useMemo(() => {
    if (!stats) return { ivaSoportado: 0, ivaRepercutido: 0, liquidacionIva: 0, previsionIrpf: 0, desglose: { rep10:0, rep21:0 } };

    let ivaSop = 0;
    (data.albaranes || [])
      .filter(a => { const d = new Date(a.date); return d.getMonth() === month && d.getFullYear() === year; })
      .forEach(a => {
        if (a.items && a.items.length > 0) {
          a.items.forEach(i => {
            const iRate = Num.parse(i.rate) || 10;
            ivaSop += Num.parse(i.t) - (Num.parse(i.t) / (1 + iRate/100)); // Total - Base
          });
        } else {
          ivaSop += Num.parse(a.taxes); // Fallback
        }
      });
    
    // IVA REPERCUTIDO ESTIMADO POR PLATOS
    let ivaRep10 = 0; let ivaRep21 = 0;
    const ventasDelMes = (data.ventas_menu || []).filter(v => {
      const d = new Date(v.date); return d.getMonth() === month && d.getFullYear() === year;
    });

    if (ventasDelMes.length > 0 && data.platos) {
      ventasDelMes.forEach(v => {
        const p = data.platos?.find(x => x.id === v.id);
        if (p) {
          const qty = Num.parse(v.qty); const pvp = Num.parse(p.price);
          const ivaRate = (p.category?.match(/bebida|alcohol|vino/i)) ? 0.21 : 0.10;
          const neto = pvp / (1 + ivaRate);
          const cuota = (pvp - neto) * qty;
          if (ivaRate === 0.21) ivaRep21 += cuota; else ivaRep10 += cuota;
        }
      });
    } else {
      // Regla Pareto si no hay datos de TPV (80% comida, 20% bebida)
      ivaRep10 = (stats.ingresos.total * 0.80) - ((stats.ingresos.total * 0.80) / 1.10);
      ivaRep21 = (stats.ingresos.total * 0.20) - ((stats.ingresos.total * 0.20) / 1.21);
    }

    const ivaRepercutido = ivaRep10 + ivaRep21; 
    const liquidacionIva = ivaRepercutido - ivaSop;
    const previsionIrpf = stats.gastos.personal * 0.15; 

    return { ivaSoportado: ivaSop, ivaRepercutido, liquidacionIva, previsionIrpf, desglose: { rep10: ivaRep10, rep21: ivaRep21 } };
  }, [data, month, year, stats]);

  /* =======================================================
   * 🎯 BREAK EVEN & BI (Fórmula M2 Horeca)
   * ======================================================= */
  const biMetrics = useMemo(() => {
    if (!stats) return { breakEven: 0, isProfitable: false, margenContribucion: 0 };
    const costeVariablePct = (stats.ratios.foodCost + stats.ratios.drinkCost) / 100;
    const margenContribucion = 1 - costeVariablePct; 
    
    const breakEven = margenContribucion > 0 ? stats.gastos.estructura / margenContribucion : Infinity;
    const isProfitable = stats.ingresos.total >= breakEven;

    return { breakEven, isProfitable, margenContribucion };
  }, [stats]);

  // Data pre-calculada para Recharts
  const expenseChartData = stats ? [
    { name: 'Materia Prima', value: stats.gastos.comida + stats.gastos.bebida, color: '#10b981' },
    { name: 'Personal', value: stats.gastos.personal, color: '#f59e0b' },
    { name: 'Estructura', value: stats.gastos.estructura, color: '#f43f5e' },
  ].filter(d => d.value > 0) : [];

  const unitChartData = stats ? BUSINESS_UNITS.map(u => ({
    name: u.name.split(' ')[0], 
    Ingresos: stats.unitBreakdown[u.id].income,
    Gastos: stats.unitBreakdown[u.id].expenses,
  })).filter(d => d.Ingresos > 0 || d.Gastos > 0) : [];

  /* =======================================================
   * 🤖 DIRECTOR FINANCIERO IA
   * ======================================================= */
  const analyzeWithAI = async () => {
    if (!stats) return;
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("⚠️ Para proteger tu privacidad, añade la API Key en Configuración.");

    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Actúa como el Director Financiero (CFO) de un restaurante. Analiza este mes:
      Ingresos: ${stats.ingresos.total}€. Beneficio Neto: ${stats.neto}€.
      Food Cost: ${Num.round2(stats.ratios.foodCost)}%. Staff Cost: ${Num.round2(stats.ratios.staffCost)}%.
      Punto de Equilibrio: ${Num.round2(biMetrics.breakEven)}€.
      Escribe 3 párrafos muy cortos. Evalúa la salud, destaca el mayor problema y da un consejo accionable.`;

      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      setAiInsight(response.text || "Análisis no disponible.");
    } catch (error) {
      setAiInsight("⚠️ No he podido conectar con la IA. Revisa tu cuota o tu API Key.");
    } finally { setIsAnalyzing(false); }
  };

  /* =======================================================
   * 📁 EXPORTACIÓN REAL A EXCEL (XLSX)
   * ======================================================= */
  const handleExportExcel = () => {
    if (!stats) return;
    
    const wsPL = XLSX.utils.json_to_sheet([
      { Concepto: 'INGRESOS TOTALES', Valor: stats.ingresos.total },
      { Concepto: 'Coste Materia Prima', Valor: stats.gastos.comida + stats.gastos.bebida },
      { Concepto: 'Coste Personal', Valor: stats.gastos.personal },
      { Concepto: 'Costes Fijos (Estructura)', Valor: stats.gastos.estructura },
      { Concepto: 'BENEFICIO NETO', Valor: stats.neto },
    ]);
    wsPL['!cols'] = [{ wch: 26 }, { wch: 16 }]; 
    
    const wsFiscal = XLSX.utils.json_to_sheet([
      { Concepto: 'IVA Repercutido (10%)', Valor: Num.round2(fiscalData.desglose.rep10) },
      { Concepto: 'IVA Repercutido (21%)', Valor: Num.round2(fiscalData.desglose.rep21) },
      { Concepto: 'Total IVA Devengado', Valor: Num.round2(fiscalData.ivaRepercutido) },
      { Concepto: 'Total IVA Soportado (Deducible)', Valor: Num.round2(fiscalData.ivaSoportado) },
      { Concepto: 'LIQUIDACIÓN IVA', Valor: Num.round2(fiscalData.liquidacionIva) },
      { Concepto: 'Retención IRPF Estimada', Valor: Num.round2(fiscalData.previsionIrpf) },
    ]);
    wsFiscal['!cols'] = [{ wch: 28 }, { wch: 16 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsPL, "PyG");
    XLSX.utils.book_append_sheet(wb, wsFiscal, "Cierre Fiscal");
    
    const fileName = `Arume_Contabilidad_${month+1}_${year}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    setExportHistory([{ date: new Date().toLocaleString(), type: 'Excel Contable' }, ...exportHistory]);
  };

  // Custom Tooltip Memoizado para no re-renderizar Recharts
  const CustomTooltip = useMemo(() => ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs font-bold z-50">
          <p className="text-slate-400 mb-1">{payload[0].name || payload[0].payload.name}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }}>{entry.name}: {Num.fmt(entry.value)}</p>
          ))}
        </div>
      );
    }
    return null;
  }, []);

  if (loadingStats || !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-indigo-500">
        <Loader2 className="w-12 h-12 animate-spin mb-4" />
        <p className="font-black uppercase tracking-widest text-xs">Compilando Datos Financieros...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">
      
      {/* 🚀 HEADER HIGH-END */}
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100 gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tighter">Informes 360º</h2>
          <p className="text-xs text-indigo-500 font-bold uppercase tracking-widest mt-1 flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Inteligencia de Negocio
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
          <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-3xl border border-slate-100 shadow-inner w-full sm:w-auto justify-between sm:justify-center">
            <button onClick={() => handleMonthChange(-1)} className="w-12 h-12 flex items-center justify-center bg-white rounded-2xl text-slate-600 shadow-sm hover:bg-indigo-50 hover:text-indigo-600 transition-all"><ChevronLeft className="w-6 h-6" /></button>
            <div className="w-40 text-center flex flex-col">
              <span className="text-sm font-black text-slate-800 uppercase tracking-widest">{monthName}</span>
              <span className="text-[10px] text-slate-400 font-bold">PERIODO FISCAL</span>
            </div>
            <button onClick={() => handleMonthChange(1)} className="w-12 h-12 flex items-center justify-center bg-white rounded-2xl text-slate-600 shadow-sm hover:bg-indigo-50 hover:text-indigo-600 transition-all"><ChevronRight className="w-6 h-6" /></button>
          </div>

          <button 
            onClick={analyzeWithAI} disabled={isAnalyzing}
            className="w-full sm:w-auto bg-slate-900 text-white px-6 py-4 rounded-3xl text-xs font-black uppercase tracking-wider hover:bg-indigo-600 transition-all shadow-xl flex items-center justify-center gap-2 group disabled:opacity-50"
          >
            {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Brain className="w-5 h-5 group-hover:scale-110 transition-transform" />}
            {isAnalyzing ? 'Analizando...' : 'Director IA'}
          </button>
        </div>
      </header>

      {/* 🚀 AI INSIGHT BANNER */}
      <AnimatePresence>
        {aiInsight && (
          <motion.div initial={{ opacity: 0, y: -20, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -20, height: 0 }} className="bg-gradient-to-br from-indigo-600 to-purple-700 p-8 rounded-[3rem] shadow-2xl text-white relative overflow-hidden">
            <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 mb-4 opacity-80"><Brain className="w-5 h-5" /> Análisis Financiero</h3>
            <div className="text-sm md:text-base font-medium leading-relaxed whitespace-pre-line relative z-10">{aiInsight}</div>
            <button onClick={() => setAiInsight(null)} className="absolute top-6 right-6 text-white/50 hover:text-white transition"><X className="w-5 h-5" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🚀 NAVEGACIÓN BENTO TABS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-2 rounded-[2rem] shadow-sm border border-slate-100">
        {TABS.map(tab => (
          <button
            key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={cn("flex flex-col items-center justify-center py-4 rounded-2xl transition-all gap-2", activeTab === tab.id ? "bg-indigo-50 text-indigo-700 shadow-sm ring-1 ring-indigo-100" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600")}
          >
            <tab.icon className={cn("w-6 h-6", activeTab === tab.id && "animate-pulse")} />
            <span className="text-[10px] font-black uppercase tracking-wider">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 📊 TAB 1: RESULTADOS P&L */}
      {activeTab === 'resultados' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col justify-center">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Ingresos Mes</p>
              <p className="text-5xl font-black text-slate-800">{Num.fmt(stats.ingresos.total)}</p>
            </div>
            <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col justify-center">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Gastos Totales</p>
              <p className="text-5xl font-black text-rose-500">{Num.fmt(stats.gastos.total)}</p>
            </div>
            <div className={cn("p-8 rounded-[3rem] shadow-xl relative overflow-hidden flex flex-col justify-center", stats.neto >= 0 ? "bg-slate-900 text-white" : "bg-rose-600 text-white")}>
              <div className="absolute -right-4 -bottom-4 opacity-10">{stats.neto >= 0 ? <TrendingUp className="w-40 h-40" /> : <TrendingDown className="w-40 h-40" />}</div>
              <p className="text-xs font-black opacity-70 uppercase tracking-widest relative z-10 mb-2">Beneficio Neto</p>
              <p className="text-5xl font-black relative z-10">{Num.fmt(stats.neto)}</p>
              <div className="mt-4 relative z-10">
                <span className="text-xs font-bold px-3 py-1.5 bg-white/20 rounded-xl backdrop-blur-sm border border-white/10">Margen: {stats.ingresos.total > 0 ? Num.round2((stats.neto / stats.ingresos.total) * 100) : 0}%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm h-96 flex flex-col">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">Distribución de Gastos</h3>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={expenseChartData} cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={5} dataKey="value" isAnimationActive={false}>
                      {expenseChartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={CustomTooltip as any} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm h-96 flex flex-col">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">Rendimiento por Unidad</h3>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={unitChartData}>
                    <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip content={CustomTooltip as any} cursor={{ fill: 'transparent' }} />
                    <Bar dataKey="Ingresos" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                    <Bar dataKey="Gastos" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* 🏛️ TAB 2: CIERRE FISCAL */}
      {activeTab === 'fiscal' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-10 rounded-[3rem] shadow-2xl text-white text-center">
            <p className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2 flex justify-center items-center gap-2"><Landmark className="w-5 h-5" /> Previsión Liquidación IVA + IRPF</p>
            <p className="text-6xl font-black text-amber-400 tracking-tighter">{Num.fmt(fiscalData.liquidacionIva + fiscalData.previsionIrpf)}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-indigo-500" /> IVA Repercutido (Ventas)</h3>
              <div className="space-y-4">
                <div className="flex justify-between text-xs text-slate-500"><span>Estimación Comida (10%)</span><span>{Num.fmt(fiscalData.desglose.rep10)}</span></div>
                <div className="flex justify-between text-xs text-slate-500 border-b border-slate-100 pb-4"><span>Estimación Bebidas (21%)</span><span>{Num.fmt(fiscalData.desglose.rep21)}</span></div>
                <div className="flex justify-between font-black text-slate-800 text-xl pt-2"><span>Total Devengado</span><span>{Num.fmt(fiscalData.ivaRepercutido)}</span></div>
              </div>
            </div>
            <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2"><TrendingDown className="w-5 h-5 text-emerald-500" /> IVA Soportado (Gastos)</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-4"><span className="text-xs font-bold text-slate-500">Total IVA Deducible M.P.</span><span className="text-xl font-black text-emerald-600">{Num.fmt(fiscalData.ivaSoportado)}</span></div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* 🎯 TAB 3: KPIs & BI */}
      {activeTab === 'kpis' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-900 p-8 rounded-[3rem] shadow-xl text-white">
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-8 flex items-center gap-2"><Target className="w-5 h-5 text-indigo-400" /> Ratios Críticos</h3>
              <div className="space-y-4">
                <RatioRow label="Food Cost (Sólidos)" val={stats.ratios.foodCost} target={30} />
                <RatioRow label="Drink Cost (Líquidos)" val={stats.ratios.drinkCost} target={25} />
                <RatioRow label="Coste Laboral" val={stats.ratios.staffCost} target={35} />
                <div className="border-t border-slate-800 my-6"></div>
                <RatioRow label="PRIME COST" val={stats.ratios.primeCost} target={65} isMega />
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-indigo-50 p-8 rounded-[3rem] border border-indigo-100 shadow-sm text-center flex flex-col justify-center h-1/2">
                <p className="text-xs font-black text-indigo-500 uppercase tracking-widest mb-2">Punto de Equilibrio (Ventas Mínimas)</p>
                <p className="text-4xl font-black text-indigo-900">{Num.fmt(biMetrics.breakEven)}</p>
                <p className="text-[10px] text-indigo-400 font-bold mt-2">Margen Contribución: {Num.round2(biMetrics.margenContribucion * 100)}%</p>
              </div>
              <div className={cn("p-8 rounded-[3rem] border shadow-sm text-center flex flex-col justify-center h-1/2 transition-colors", biMetrics.isProfitable ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200")}>
                <p className={cn("text-xs font-black uppercase tracking-widest mb-2", biMetrics.isProfitable ? "text-emerald-600" : "text-rose-600")}>Estado Actual</p>
                <p className={cn("text-3xl font-black", biMetrics.isProfitable ? "text-emerald-900" : "text-rose-900")}>
                  {biMetrics.isProfitable ? "✅ EN BENEFICIOS" : "⚠️ EN PÉRDIDAS"}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* 📁 TAB 4: CARPETA DOCS */}
      {activeTab === 'carpeta' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm text-center group hover:border-emerald-300 transition-all hover:shadow-lg">
              <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform"><FileSpreadsheet className="w-10 h-10" /></div>
              <h3 className="text-xl font-black text-slate-800 mb-2">Exportar Excel Completo</h3>
              <p className="text-xs text-slate-500 mb-6">Genera un Excel descargable real para tu gestor con resultados de P&L y fiscalidad.</p>
              <button onClick={handleExportExcel} className="bg-emerald-600 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase shadow-lg hover:bg-emerald-700 active:scale-95 transition-all">
                Descargar Excel .xlsx
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

/* ====================================
 * COMPONENTES DE UI REUTILIZABLES
 * ==================================== */
const RatioRow = ({ label, val, target, isWarning = false, isMega = false }: any) => {
  const over = val > target;
  return (
    <div className={cn("flex items-center justify-between p-4 md:p-5 rounded-3xl border transition-colors hover:bg-slate-800/80", isMega ? "border-indigo-500/30 bg-indigo-500/10" : "border-slate-800 bg-slate-800/50")}>
       <div>
         <p className={cn("font-black uppercase tracking-wider", isMega ? "text-lg text-indigo-300" : "text-xs text-slate-300")}>{label}</p>
         <p className="text-[10px] font-bold text-slate-500 mt-1">Objetivo óptimo: &lt;{target}%</p>
       </div>
       <div className={cn("px-5 py-2 rounded-2xl font-black tracking-tight flex items-center gap-2", isMega ? "text-2xl" : "text-base", over ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30")}>
         {over ? '⚠️' : '✅'} {Num.round2(val)}%
       </div>
    </div>
  );
}
