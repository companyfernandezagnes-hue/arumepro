import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  TrendingUp, TrendingDown, ChevronLeft, ChevronRight, 
  Building2, Hotel, ShoppingBag, Users, Brain,
  BarChart3, Landmark, Target, FolderOpen, Trophy,
  Sparkles, FileText, Loader2, X, Receipt, Globe
} from 'lucide-react';
const FileSpreadsheet = FileText;

import { PieChart, Pie, Cell, BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import { AppData } from '../types';
import { ArumeEngine, Num } from '../services/engine';
import { cn } from '../lib/utils';
import { askAI } from '../services/aiProviders';
import { Modelo303View } from './Modelo303View';
import { PackGestoria } from './PackGestoria';
import { RankingProveedores } from './RankingProveedores';
import { FlujosEfectivo } from './FlujosEfectivo';
import { PresupuestoVsReal } from './PresupuestoVsReal';
import { MultiDivisaView } from './MultiDivisaView';

export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';
type TabType = 'resultados' | 'fiscal' | 'kpis' | 'carpeta' | 'modelo303' | 'auditoria' | 'comparativa' | 'ranking' | 'flujos' | 'pvsreal' | 'divisas';

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante',      icon: Building2,  color: 'text-indigo-600', bg: 'bg-indigo-50'  },
  { id: 'DLV',  name: 'Catering Hoteles', icon: Hotel,      color: 'text-amber-600',  bg: 'bg-amber-50'   },
  { id: 'SHOP', name: 'Tienda Sake',      icon: ShoppingBag,color: 'text-emerald-600',bg: 'bg-emerald-50' },
  { id: 'CORP', name: 'Socios / Corp',    icon: Users,      color: 'text-slate-600',  bg: 'bg-slate-100'  },
];

const TABS: { id: TabType; label: string; icon: any }[] = [
  { id: 'resultados', label: 'Resultados P&L', icon: BarChart3  },
  { id: 'fiscal',     label: 'Cierre Fiscal',  icon: Landmark   },
  { id: 'kpis',       label: 'KPIs & BI',      icon: Target     },
  { id: 'carpeta',    label: 'Carpeta Docs',    icon: FolderOpen },
  { id: 'modelo303', label: 'IVA 303',      icon: Receipt    },

  { id: 'auditoria',    label: 'Auditoría Banco', icon: Landmark },
  { id: 'comparativa',  label: 'Comparativa',     icon: TrendingUp },
  { id: 'ranking',      label: 'Proveedores',     icon: Trophy },
  { id: 'flujos',       label: 'Flujos Efectivo', icon: Landmark },
  { id: 'pvsreal',      label: 'Meta vs Real',    icon: Target },
  { id: 'divisas',      label: 'Multi-Divisa',    icon: Globe },];

export const ReportsView = ({ data, onSave }: { data: AppData; onSave?: (d: AppData) => Promise<void> }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab,   setActiveTab]   = useState<TabType>('resultados');
  const [aiInsight,   setAiInsight]   = useState<string|null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [exportHistory, setExportHistory] = useState<{date:string;type:string}[]>([]);

  const handleMonthChange = (offset: number) => {
    const d = new Date(currentDate); d.setMonth(currentDate.getMonth() + offset);
    setCurrentDate(d); setAiInsight(null);
  };

  const monthName = currentDate.toLocaleString('es-ES', { month:'long', year:'numeric' }).toUpperCase();
  const month     = currentDate.getMonth();
  const year      = currentDate.getFullYear();

  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    setLoadingStats(true);
    const timer = setTimeout(() => {
      try {
        // ✅ FIX: mes 1-12 (no 0-11)
        const computed = ArumeEngine.getProfit(data, month + 1, year);
        setStats(computed);
      } catch (err) {
        console.error('[ReportsView] Error P&L:', err);
        setStats(null);
      } finally {
        setLoadingStats(false);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [data, month, year]);

  const fiscalData = useMemo(() => {
    const empty = { ivaSoportado:0, ivaRepercutido:0, liquidacionIva:0, previsionIrpf:0, desglose:{ rep10:0, rep21:0 } };
    if (!stats || !data) return empty;

    let ivaSop = 0;
    (data.albaranes || [])
      .filter(a => { try { const d=new Date(a.date||''); return !isNaN(d.getTime()) && d.getMonth()===month && d.getFullYear()===year; } catch { return false; } })
      .forEach(a => {
        if (Array.isArray(a.items) && a.items.length > 0) {
          a.items.forEach(i => {
            const iRate = Num.parse((i as any).rate) || 10;
            const t     = Num.parse((i as any).t ?? (i as any).total ?? 0);
            ivaSop += t - (t / (1 + iRate/100));
          });
        } else {
          ivaSop += Num.parse(a.taxes);
        }
      });

    let ivaRep10 = 0, ivaRep21 = 0;
    const ventasDelMes = (data.ventas_menu || []).filter(v => {
      try { const d=new Date((v as any).date||''); return !isNaN(d.getTime()) && d.getMonth()===month && d.getFullYear()===year; } catch { return false; }
    });

    if (ventasDelMes.length > 0 && data.platos) {
      ventasDelMes.forEach(v => {
        const p = data.platos?.find(x => x.id === (v as any).id);
        if (!p) return;
        const qty     = Num.parse((v as any).qty);
        const pvp     = Num.parse(p.price ?? p.precio ?? 0);
        const ivaRate = String(p.categoria || p.category || '').match(/bebida|alcohol|vino/i) ? 0.21 : 0.10;
        const cuota   = (pvp - pvp/(1+ivaRate)) * qty;
        if (ivaRate === 0.21) ivaRep21 += cuota; else ivaRep10 += cuota;
      });
    } else {
      const T = stats.ingresos?.total ?? 0;
      ivaRep10 = (T*0.80) - ((T*0.80)/1.10);
      ivaRep21 = (T*0.20) - ((T*0.20)/1.21);
    }

    const ivaRepercutido = ivaRep10 + ivaRep21;
    const liquidacionIva = ivaRepercutido - ivaSop;
    const previsionIrpf  = (stats.gastos?.personal ?? 0) * 0.15;

    return { ivaSoportado:Num.round2(ivaSop), ivaRepercutido:Num.round2(ivaRepercutido), liquidacionIva:Num.round2(liquidacionIva), previsionIrpf:Num.round2(previsionIrpf), desglose:{ rep10:Num.round2(ivaRep10), rep21:Num.round2(ivaRep21) } };
  }, [data, month, year, stats]);

  const biMetrics = useMemo(() => {
    if (!stats) return { breakEven:0, isProfitable:false, margenContribucion:0 };
    const foodCost  = Num.parse(stats.ratios?.foodCost)  / 100;
    const drinkCost = Num.parse(stats.ratios?.drinkCost ?? stats.ratios?.bevCost) / 100;
    const margen    = 1 - (foodCost + drinkCost);
    const breakEven = margen > 0 ? (stats.gastos?.estructura ?? 0) / margen : Infinity;
    return { breakEven, isProfitable:(stats.ingresos?.total??0)>=breakEven, margenContribucion:margen };
  }, [stats]);

  const expenseChartData = stats ? [
    { name:'Materia Prima', value:(stats.gastos?.comida??0)+(stats.gastos?.bebida??0), color:'#10b981' },
    { name:'Personal',      value: stats.gastos?.personal??0,                          color:'#f59e0b' },
    { name:'Estructura',    value: stats.gastos?.estructura??0,                        color:'#f43f5e' },
  ].filter(d => d.value > 0) : [];

  const unitChartData = stats ? BUSINESS_UNITS.map(u => ({
    name    : u.name.split(' ')[0],
    Ingresos: stats.unitBreakdown?.[u.id]?.income   ?? 0,
    Gastos  : stats.unitBreakdown?.[u.id]?.expenses ?? 0,
  })).filter(d => d.Ingresos > 0 || d.Gastos > 0) : [];

  // ═══════════════════════════════════════════════════════════════════════
  // 📈 COMPARATIVA MES A MES — 12 meses de P&L
  // ═══════════════════════════════════════════════════════════════════════
  const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  const comparativaData = useMemo(() => {
    const rows: {
      mes: string; mesNum: number; year: number;
      ingresos: number; gastos: number; neto: number;
      foodCost: number; staffCost: number; primeCost: number;
      margen: number;
    }[] = [];

    // Últimos 12 meses desde el mes seleccionado
    for (let i = 11; i >= 0; i--) {
      const d = new Date(year, month - i, 1);
      const m = d.getMonth() + 1; // 1-12
      const y = d.getFullYear();
      try {
        const p = ArumeEngine.getProfit(data, m, y);
        const ing = p.ingresos?.total ?? 0;
        const gas = p.gastos?.total ?? 0;
        rows.push({
          mes: `${MESES_ES[m - 1]} ${String(y).slice(2)}`,
          mesNum: m, year: y,
          ingresos: ing,
          gastos: gas,
          neto: p.neto ?? 0,
          foodCost: Num.round2(p.ratios?.foodCost ?? 0),
          staffCost: Num.round2(p.ratios?.staffCost ?? 0),
          primeCost: Num.round2(p.ratios?.primeCost ?? 0),
          margen: ing > 0 ? Num.round2(((p.neto ?? 0) / ing) * 100) : 0,
        });
      } catch {
        rows.push({
          mes: `${MESES_ES[m - 1]} ${String(y).slice(2)}`,
          mesNum: m, year: y,
          ingresos: 0, gastos: 0, neto: 0,
          foodCost: 0, staffCost: 0, primeCost: 0, margen: 0,
        });
      }
    }

    // Promedios y totales
    const nonZero = rows.filter(r => r.ingresos > 0);
    const avgIngresos = nonZero.length > 0 ? Num.round2(nonZero.reduce((s, r) => s + r.ingresos, 0) / nonZero.length) : 0;
    const avgNeto = nonZero.length > 0 ? Num.round2(nonZero.reduce((s, r) => s + r.neto, 0) / nonZero.length) : 0;
    const totalIngresos = Num.round2(rows.reduce((s, r) => s + r.ingresos, 0));
    const totalNeto = Num.round2(rows.reduce((s, r) => s + r.neto, 0));

    // Mejor y peor mes
    const mejorMes = nonZero.length > 0 ? nonZero.reduce((a, b) => a.neto > b.neto ? a : b) : null;
    const peorMes = nonZero.length > 0 ? nonZero.reduce((a, b) => a.neto < b.neto ? a : b) : null;

    // Tendencia: comparar últimos 3 meses vs anteriores 3
    const last3 = rows.slice(-3);
    const prev3 = rows.slice(-6, -3);
    const avgLast3 = last3.reduce((s, r) => s + r.ingresos, 0) / 3;
    const avgPrev3 = prev3.reduce((s, r) => s + r.ingresos, 0) / 3;
    const tendencia = avgPrev3 > 0 ? Num.round2(((avgLast3 - avgPrev3) / avgPrev3) * 100) : 0;

    return { rows, avgIngresos, avgNeto, totalIngresos, totalNeto, mejorMes, peorMes, tendencia };
  }, [data, month, year]);

  const comparativaChartData = useMemo(() =>
    comparativaData.rows.map(r => ({
      name: r.mes,
      Ingresos: r.ingresos,
      Gastos: r.gastos,
      Neto: r.neto,
    }))
  , [comparativaData]);

  const handleExportComparativa = () => {
    const wsData = comparativaData.rows.map(r => ({
      Mes: r.mes,
      Ingresos: r.ingresos,
      Gastos: r.gastos,
      'Beneficio Neto': r.neto,
      'Margen %': r.margen,
      'Food Cost %': r.foodCost,
      'Staff Cost %': r.staffCost,
      'Prime Cost %': r.primeCost,
    }));
    wsData.push({
      Mes: 'TOTAL', Ingresos: comparativaData.totalIngresos, Gastos: 0,
      'Beneficio Neto': comparativaData.totalNeto, 'Margen %': 0,
      'Food Cost %': 0, 'Staff Cost %': 0, 'Prime Cost %': 0,
    });
    wsData.push({
      Mes: 'PROMEDIO', Ingresos: comparativaData.avgIngresos, Gastos: 0,
      'Beneficio Neto': comparativaData.avgNeto, 'Margen %': 0,
      'Food Cost %': 0, 'Staff Cost %': 0, 'Prime Cost %': 0,
    });
    const ws = XLSX.utils.json_to_sheet(wsData);
    ws['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comparativa');
    XLSX.writeFile(wb, `Arume_Comparativa_${year}.xlsx`);
  };

  const analyzeWithAI = async () => {
    if (!stats) return;
    setIsAnalyzing(true);
    try {
      const prompt = `Actúa como CFO de un restaurante. Analiza:
Ingresos: ${stats.ingresos?.total??0}€. Neto: ${stats.neto??0}€.
Food Cost: ${Num.round2(stats.ratios?.foodCost??0)}%. Staff Cost: ${Num.round2(stats.ratios?.staffCost??0)}%.
Break-Even: ${Num.round2(isFinite(biMetrics.breakEven)?biMetrics.breakEven:0)}€.
Escribe 3 párrafos muy cortos: evalúa la salud, el mayor problema y un consejo accionable.`;
      const res = await askAI([{ role: 'user', content: prompt }]);
      setAiInsight(res.text || 'Análisis no disponible.');
    } catch (e) { setAiInsight(`⚠️ ${(e as Error).message}`); }
    finally  { setIsAnalyzing(false); }
  };

  const handleExportExcel = () => {
    if (!stats) return;
    const wsPL = XLSX.utils.json_to_sheet([
      { Concepto:'INGRESOS TOTALES',         Valor: stats.ingresos?.total??0 },
      { Concepto:'Coste Materia Prima',       Valor:(stats.gastos?.comida??0)+(stats.gastos?.bebida??0) },
      { Concepto:'Coste Personal',            Valor: stats.gastos?.personal??0 },
      { Concepto:'Costes Fijos (Estructura)', Valor: stats.gastos?.estructura??0 },
      { Concepto:'BENEFICIO NETO',            Valor: stats.neto??0 },
    ]); wsPL['!cols']=[{wch:26},{wch:16}];

    const wsFiscal = XLSX.utils.json_to_sheet([
      { Concepto:'IVA Repercutido (10%)',     Valor: fiscalData.desglose.rep10 },
      { Concepto:'IVA Repercutido (21%)',     Valor: fiscalData.desglose.rep21 },
      { Concepto:'Total IVA Devengado',       Valor: fiscalData.ivaRepercutido  },
      { Concepto:'Total IVA Soportado',       Valor: fiscalData.ivaSoportado    },
      { Concepto:'LIQUIDACIÓN IVA',           Valor: fiscalData.liquidacionIva  },
      { Concepto:'Retención IRPF Estimada',   Valor: fiscalData.previsionIrpf   },
    ]); wsFiscal['!cols']=[{wch:28},{wch:16}];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsPL,     'PyG');
    XLSX.utils.book_append_sheet(wb, wsFiscal, 'Cierre Fiscal');
    XLSX.writeFile(wb, `Arume_Contabilidad_${month+1}_${year}.xlsx`);
    setExportHistory(prev => [{ date:new Date().toLocaleString(), type:'Excel Contable' }, ...prev]);
  };

  const CustomTooltip = useMemo(() => ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-slate-900 text-white p-2.5 rounded-lg shadow-xl border border-slate-700 text-xs font-bold">
        <p className="text-slate-400 mb-1">{payload[0].name || payload[0].payload?.name}</p>
        {payload.map((e:any,i:number) => <p key={i} style={{color:e.color}}>{e.name}: {Num.fmt(e.value)}</p>)}
      </div>
    );
  }, []);

  if (loadingStats || !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-indigo-500">
        <Loader2 className="w-10 h-10 animate-spin mb-3"/>
        <p className="font-black uppercase tracking-widest text-xs">Compilando Datos Financieros...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-3 pb-20 max-w-[1600px] mx-auto">

      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-100 gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-800 tracking-tight">Informes 360º</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest flex items-center gap-1">
            <Sparkles className="w-3 h-3"/> Inteligencia de Negocio
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full lg:w-auto">
          <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-lg border border-slate-100 shadow-inner">
            <button onClick={()=>handleMonthChange(-1)} className="w-8 h-8 flex items-center justify-center bg-white rounded-lg text-slate-600 shadow-sm hover:bg-indigo-50 hover:text-indigo-600 transition"><ChevronLeft className="w-4 h-4"/></button>
            <div className="w-36 text-center">
              <span className="text-xs font-black text-slate-800 uppercase tracking-wide">{monthName}</span>
              <span className="block text-[9px] text-slate-400 font-bold">PERIODO FISCAL</span>
            </div>
            <button onClick={()=>handleMonthChange(1)} className="w-8 h-8 flex items-center justify-center bg-white rounded-lg text-slate-600 shadow-sm hover:bg-indigo-50 hover:text-indigo-600 transition"><ChevronRight className="w-4 h-4"/></button>
          </div>
          <PackGestoria data={data} compact />
          <button onClick={analyzeWithAI} disabled={isAnalyzing}
            className="w-full sm:w-auto bg-slate-900 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide hover:bg-indigo-600 transition shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50">
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Brain className="w-4 h-4"/>}
            {isAnalyzing ? 'Analizando...' : 'Director IA'}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {aiInsight && (
          <motion.div initial={{opacity:0,y:-10,height:0}} animate={{opacity:1,y:0,height:'auto'}} exit={{opacity:0,y:-10,height:0}}
            className="bg-gradient-to-br from-indigo-600 to-purple-700 p-5 rounded-xl shadow-xl text-white relative">
            <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 mb-2 opacity-80"><Brain className="w-4 h-4"/> Análisis Financiero IA</h3>
            <div className="text-xs font-medium leading-relaxed whitespace-pre-line">{aiInsight}</div>
            <button onClick={()=>setAiInsight(null)} className="absolute top-4 right-4 text-white/50 hover:text-white"><X className="w-4 h-4"/></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 bg-white p-1.5 rounded-xl shadow-sm border border-slate-100">
        {TABS.map(tab => (
          <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
            className={cn('flex flex-col items-center justify-center py-2.5 rounded-lg transition-all gap-1', activeTab===tab.id?'bg-indigo-50 text-indigo-700 shadow-sm ring-1 ring-indigo-100':'text-slate-400 hover:bg-slate-50 hover:text-slate-600')}>
            <tab.icon className="w-4 h-4"/>
            <span className="text-[9px] font-black uppercase tracking-wide">{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'resultados' && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white px-4 py-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-center">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Ingresos Mes</p>
              <p className="text-3xl font-black text-slate-800 tabular-nums">{Num.fmt(stats.ingresos?.total??0)}</p>
            </div>
            <div className="bg-white px-4 py-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-center">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Gastos Totales</p>
              <p className="text-3xl font-black text-rose-500 tabular-nums">{Num.fmt(stats.gastos?.total??0)}</p>
            </div>
            <div className={cn('px-4 py-3 rounded-xl shadow-md relative overflow-hidden flex flex-col justify-center', (stats.neto??0)>=0?'bg-slate-900 text-white':'bg-rose-600 text-white')}>
              <div className="absolute -right-3 -bottom-3 opacity-10">{(stats.neto??0)>=0?<TrendingUp className="w-24 h-24"/>:<TrendingDown className="w-24 h-24"/>}</div>
              <p className="text-[10px] font-black opacity-70 uppercase tracking-widest z-10 mb-1">Beneficio Neto</p>
              <p className="text-3xl font-black z-10 tabular-nums">{Num.fmt(stats.neto??0)}</p>
              <span className="mt-2 text-[10px] font-bold px-2 py-0.5 bg-white/20 rounded w-fit z-10">
                Margen: {(()=>{ const t=stats.ingresos?.total??0; if(t<=0) return '0%'; const m=((stats.neto??0)/t)*100; if(m>999) return '>999%'; if(m<-999) return '<-999%'; return Num.round2(m)+'%'; })()}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm" style={{height:280}}>
              <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest mb-3">Distribución de Gastos</h3>
              <ResponsiveContainer width="100%" height={238}>
                <PieChart>
                  <Pie data={expenseChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={4} dataKey="value" isAnimationActive={false}>
                    {expenseChartData.map((_,i) => <Cell key={i} fill={expenseChartData[i].color}/>)}
                  </Pie>
                  <Tooltip content={CustomTooltip as any}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm" style={{height:280}}>
              <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest mb-3">Rendimiento por Unidad</h3>
              <ResponsiveContainer width="100%" height={238}>
                <BarChart data={unitChartData}>
                  <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false}/>
                  <Tooltip content={CustomTooltip as any} cursor={{fill:'transparent'}}/>
                  <Bar dataKey="Ingresos" fill="#4f46e5" radius={[3,3,0,0]} maxBarSize={30} isAnimationActive={false}/>
                  <Bar dataKey="Gastos"   fill="#f43f5e" radius={[3,3,0,0]} maxBarSize={30} isAnimationActive={false}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'fiscal' && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
          <div className="bg-slate-900 px-5 py-6 rounded-xl shadow-xl text-white text-center">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex justify-center items-center gap-1.5"><Landmark className="w-4 h-4"/> Previsión Liquidación IVA + IRPF</p>
            <p className="text-4xl font-black text-amber-400 tabular-nums tracking-tight">{Num.fmt(fiscalData.liquidacionIva + fiscalData.previsionIrpf)}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-indigo-500"/> IVA Repercutido</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-500"><span>Comida / 10%</span><span className="font-bold tabular-nums">{Num.fmt(fiscalData.desglose.rep10)}</span></div>
                <div className="flex justify-between text-xs text-slate-500 border-b border-slate-100 pb-3"><span>Bebidas / 21%</span><span className="font-bold tabular-nums">{Num.fmt(fiscalData.desglose.rep21)}</span></div>
                <div className="flex justify-between font-black text-slate-800 text-base pt-1"><span>Total Devengado</span><span className="tabular-nums">{Num.fmt(fiscalData.ivaRepercutido)}</span></div>
              </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-1.5"><TrendingDown className="w-4 h-4 text-emerald-500"/> IVA Soportado</h3>
              <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-3">
                <span className="text-xs font-bold text-slate-500">Total IVA Deducible (Compras)</span>
                <span className="text-xl font-black text-emerald-600 tabular-nums">{Num.fmt(fiscalData.ivaSoportado)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-500">Retención IRPF (est.)</span>
                <span className="text-base font-black text-amber-600 tabular-nums">{Num.fmt(fiscalData.previsionIrpf)}</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'kpis' && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-slate-900 p-4 rounded-xl shadow-xl text-white">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-1.5"><Target className="w-4 h-4 text-indigo-400"/> Ratios Críticos</h3>
              <div className="space-y-2.5">
                <RatioRow label="Food Cost (Sólidos)"   val={stats.ratios?.foodCost??0}  target={30}/>
                <RatioRow label="Drink Cost (Líquidos)" val={stats.ratios?.drinkCost??stats.ratios?.bevCost??0} target={25}/>
                <RatioRow label="Coste Laboral"         val={stats.ratios?.staffCost??0} target={35}/>
                <div className="border-t border-slate-800 my-3"/>
                <RatioRow label="PRIME COST" val={stats.ratios?.primeCost??0} target={65} isMega/>
              </div>
            </div>
            <div className="space-y-3">
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 shadow-sm text-center">
                <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">Punto de Equilibrio</p>
                <p className="text-3xl font-black text-indigo-900 tabular-nums">{Num.fmt(isFinite(biMetrics.breakEven)?biMetrics.breakEven:0)}</p>
                <p className="text-[10px] text-indigo-400 font-bold mt-1">Margen Contribución: {Num.round2(biMetrics.margenContribucion*100)}%</p>
              </div>
              <div className={cn('p-4 rounded-xl border shadow-sm text-center transition-colors', biMetrics.isProfitable?'bg-emerald-50 border-emerald-200':'bg-rose-50 border-rose-200')}>
                <p className={cn('text-[10px] font-black uppercase tracking-widest mb-1', biMetrics.isProfitable?'text-emerald-600':'text-rose-600')}>Estado Actual</p>
                <p className={cn('text-xl font-black', biMetrics.isProfitable?'text-emerald-900':'text-rose-900')}>
                  {biMetrics.isProfitable ? '✅ EN BENEFICIOS' : '⚠️ EN PÉRDIDAS'}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'carpeta' && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-center group hover:border-emerald-300 transition-all hover:shadow-md">
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                <FileSpreadsheet className="w-7 h-7"/>
              </div>
              <h3 className="text-sm font-black text-slate-800 mb-1">Exportar Excel Contable</h3>
              <p className="text-[10px] text-slate-500 mb-4">P&L + Fiscalidad para tu gestor.</p>
              <button onClick={handleExportExcel} className="bg-emerald-600 text-white px-5 py-2 rounded-lg font-black text-[10px] uppercase shadow-md hover:bg-emerald-700 active:scale-95 transition-all">
                Descargar .xlsx
              </button>
              {exportHistory.length > 0 && (
                <p className="text-[9px] text-slate-400 mt-3">Último export: {exportHistory[0].date}</p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'auditoria' && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-4">
          <BancoAuditoria data={data} />
        </motion.div>
      )}
      {activeTab === 'modelo303' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Modelo303View data={data} />
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          🏆 RANKING PROVEEDORES
          ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'ranking' && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
          <RankingProveedores data={data} />
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          💧 FLUJOS DE EFECTIVO
          ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'flujos' && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
          <FlujosEfectivo data={data} />
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          📊 PRESUPUESTO VS REAL
          ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'pvsreal' && onSave && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
          <PresupuestoVsReal data={data} onSave={onSave} />
        </motion.div>
      )}

      {activeTab === 'divisas' && onSave && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
          <MultiDivisaView data={data} onSave={onSave} />
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          📈 COMPARATIVA MES A MES
          ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'comparativa' && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">

          {/* KPI resumen arriba */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-white px-4 py-3 rounded-xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Acumulado 12 meses</p>
              <p className="text-xl font-black text-slate-800 tabular-nums">{Num.fmt(comparativaData.totalIngresos)}</p>
            </div>
            <div className="bg-white px-4 py-3 rounded-xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Beneficio Acum.</p>
              <p className={`text-xl font-black tabular-nums ${comparativaData.totalNeto >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{Num.fmt(comparativaData.totalNeto)}</p>
            </div>
            <div className="bg-white px-4 py-3 rounded-xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Media Mensual</p>
              <p className="text-xl font-black text-indigo-600 tabular-nums">{Num.fmt(comparativaData.avgIngresos)}</p>
            </div>
            <div className="bg-white px-4 py-3 rounded-xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tendencia 3m</p>
              <div className="flex items-center gap-1.5">
                {comparativaData.tendencia >= 0
                  ? <TrendingUp className="w-5 h-5 text-emerald-500"/>
                  : <TrendingDown className="w-5 h-5 text-rose-500"/>}
                <p className={`text-xl font-black tabular-nums ${comparativaData.tendencia >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {comparativaData.tendencia >= 0 ? '+' : ''}{comparativaData.tendencia}%
                </p>
              </div>
            </div>
          </div>

          {/* Mejor / Peor mes */}
          {comparativaData.mejorMes && comparativaData.peorMes && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-emerald-600"/>
                </div>
                <div>
                  <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Mejor mes</p>
                  <p className="text-sm font-black text-emerald-800">{comparativaData.mejorMes.mes}</p>
                  <p className="text-xs text-emerald-600 font-bold">{Num.fmt(comparativaData.mejorMes.neto)} neto</p>
                </div>
              </div>
              <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center">
                  <TrendingDown className="w-5 h-5 text-rose-600"/>
                </div>
                <div>
                  <p className="text-[9px] font-black text-rose-600 uppercase tracking-widest">Peor mes</p>
                  <p className="text-sm font-black text-rose-800">{comparativaData.peorMes.mes}</p>
                  <p className="text-xs text-rose-600 font-bold">{Num.fmt(comparativaData.peorMes.neto)} neto</p>
                </div>
              </div>
            </div>
          )}

          {/* Gráfico de barras */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Evolución 12 meses</p>
              <button onClick={handleExportComparativa}
                className="text-[9px] font-black text-indigo-500 hover:text-indigo-700 flex items-center gap-1 transition">
                <FileSpreadsheet className="w-3 h-3"/> Excel
              </button>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparativaChartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 9, fontWeight: 800, fill: '#94a3b8' }} tickLine={false} axisLine={false}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Bar dataKey="Ingresos" fill="#6366f1" radius={[4,4,0,0]} barSize={16}/>
                  <Bar dataKey="Gastos"   fill="#f43f5e" radius={[4,4,0,0]} barSize={16}/>
                  <Bar dataKey="Neto"     fill="#10b981" radius={[4,4,0,0]} barSize={16}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-4 mt-2">
              <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-indigo-500 rounded-sm inline-block"/>Ingresos</span>
              <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-rose-500 rounded-sm inline-block"/>Gastos</span>
              <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-500"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm inline-block"/>Neto</span>
            </div>
          </div>

          {/* Tabla detallada */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Detalle mensual</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    <th className="px-3 py-2.5 text-left">Mes</th>
                    <th className="px-3 py-2.5 text-right">Ingresos</th>
                    <th className="px-3 py-2.5 text-right">Gastos</th>
                    <th className="px-3 py-2.5 text-right">Neto</th>
                    <th className="px-3 py-2.5 text-right">Margen</th>
                    <th className="px-3 py-2.5 text-right hidden md:table-cell">Food%</th>
                    <th className="px-3 py-2.5 text-right hidden md:table-cell">Staff%</th>
                    <th className="px-3 py-2.5 text-right hidden lg:table-cell">Prime%</th>
                  </tr>
                </thead>
                <tbody>
                  {comparativaData.rows.map((r, i) => {
                    const isCurrent = r.mesNum === (month + 1) && r.year === year;
                    return (
                      <tr key={i} className={cn(
                        'border-t border-slate-50 transition-colors',
                        isCurrent ? 'bg-indigo-50/50 font-black' : 'hover:bg-slate-50',
                        r.ingresos === 0 && 'opacity-40'
                      )}>
                        <td className="px-3 py-2 font-black text-slate-700">
                          {r.mes}
                          {isCurrent && <span className="ml-1.5 text-[8px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">actual</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-800 font-bold">{Num.fmt(r.ingresos)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-600 font-bold">{Num.fmt(r.gastos)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-black ${r.neto >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {Num.fmt(r.neto)}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-bold ${r.margen >= 10 ? 'text-emerald-600' : r.margen >= 0 ? 'text-amber-600' : 'text-rose-600'}`}>
                          {r.ingresos > 0 ? `${r.margen}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 hidden md:table-cell">{r.ingresos > 0 ? `${r.foodCost}%` : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500 hidden md:table-cell">{r.ingresos > 0 ? `${r.staffCost}%` : '—'}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-bold hidden lg:table-cell ${r.primeCost > 65 ? 'text-rose-500' : r.primeCost > 55 ? 'text-amber-500' : 'text-emerald-500'}`}>
                          {r.ingresos > 0 ? `${r.primeCost}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white text-[10px] font-black">
                    <td className="px-3 py-2.5">TOTAL / MEDIA</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{Num.fmt(comparativaData.totalIngresos)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" colSpan={1}>—</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${comparativaData.totalNeto >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{Num.fmt(comparativaData.totalNeto)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-400" colSpan={4}>
                      Media: {Num.fmt(comparativaData.avgIngresos)}/mes
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Mini guía */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800">
            <p className="font-black mb-1">📈 ¿Cómo leer esta comparativa?</p>
            <ul className="space-y-0.5 text-[11px] text-blue-700">
              <li>• <b>Margen</b>: % de beneficio sobre ingresos. Objetivo &gt;10%</li>
              <li>• <b>Food Cost</b>: % del coste de materia prima. Objetivo &lt;30%</li>
              <li>• <b>Staff Cost</b>: % del coste de personal. Objetivo &lt;35%</li>
              <li>• <b>Prime Cost</b>: Food + Staff. Objetivo &lt;65% (regla de oro hostelería)</li>
              <li>• <b>Tendencia 3m</b>: compara la media de los últimos 3 meses con los 3 anteriores</li>
            </ul>
          </div>
        </motion.div>
      )}

    </div>
  );
};

const BancoAuditoria = ({ data }: { data: AppData }) => {
  const [selectedYear, setSelectedYear] = React.useState(() => new Date().getFullYear());

  const years = React.useMemo(() => {
    const ys = new Set<number>();
    (data.banco || []).forEach((b: any) => {
      const y = parseInt((b.date || '').slice(0, 4));
      if (y > 2000) ys.add(y);
    });
    (data.facturas || []).forEach((f: any) => {
      const y = parseInt((f.date || '').slice(0, 4));
      if (y > 2000) ys.add(y);
    });
    return Array.from(ys).sort((a, b) => b - a);
  }, [data]);

  const audit = React.useMemo(() => {
    const bancoMovs = (data.banco || []).filter((b: any) => {
      const y = parseInt((b.date || '').slice(0, 4));
      return y === selectedYear;
    });
    const salidas = bancoMovs.filter((b: any) => Num.parse(b.amount) < 0);
    const entradas = bancoMovs.filter((b: any) => Num.parse(b.amount) > 0);
    const totalSalidas = Math.abs(salidas.reduce((s: number, b: any) => s + Num.parse(b.amount), 0));
    const totalEntradas = entradas.reduce((s: number, b: any) => s + Num.parse(b.amount), 0);
    const facturasCompra = (data.facturas || []).filter((f: any) => {
      const y = parseInt((f.date || '').slice(0, 4));
      return y === selectedYear && (f.tipo === 'compra' || f.type === 'compra');
    });
    const totalFacturasCompra = facturasCompra.reduce((s: number, f: any) => s + Math.abs(Num.parse(f.total)), 0);
    const albaranesAnyo = (data.albaranes || []).filter((a: any) => {
      const y = parseInt((a.date || '').slice(0, 4));
      return y === selectedYear && !a.invoiced;
    });
    const totalAlbaranes = albaranesAnyo.reduce((s: number, a: any) => s + Math.abs(Num.parse(a.total)), 0);
    const totalRegistrado = totalFacturasCompra + totalAlbaranes;
    const diferencia = totalSalidas - totalRegistrado;
    const porcentajeCubierto = totalSalidas > 0 ? Math.min((totalRegistrado / totalSalidas) * 100, 100) : 0;
    const meses: { mes: string; salidas: number; registrado: number }[] = [];
    for (let m = 0; m < 12; m++) {
      const label = new Date(selectedYear, m, 1).toLocaleString('es-ES', { month: 'short' }).toUpperCase();
      const salidasMes = Math.abs(
        bancoMovs.filter((b: any) => { const d = new Date(b.date || ''); return d.getMonth() === m && Num.parse(b.amount) < 0; })
          .reduce((s: number, b: any) => s + Num.parse(b.amount), 0)
      );
      const registradoMes =
        facturasCompra.filter((f: any) => new Date(f.date || '').getMonth() === m)
          .reduce((s: number, f: any) => s + Math.abs(Num.parse(f.total)), 0) +
        albaranesAnyo.filter((a: any) => new Date(a.date || '').getMonth() === m)
          .reduce((s: number, a: any) => s + Math.abs(Num.parse(a.total)), 0);
      if (salidasMes > 0 || registradoMes > 0) meses.push({ mes: label, salidas: salidasMes, registrado: registradoMes });
    }
    return { totalSalidas, totalEntradas, totalFacturasCompra, totalAlbaranes, totalRegistrado, diferencia, porcentajeCubierto, numMovs: bancoMovs.length, numSalidas: salidas.length, numEntradas: entradas.length, meses };
  }, [data, selectedYear]);

  const pct = Math.round(audit.porcentajeCubierto);
  const gap = audit.diferencia;
  const gapColor = gap <= 0 ? 'text-emerald-600' : gap < 500 ? 'text-amber-600' : 'text-rose-600';
  const gapBg = gap <= 0 ? 'bg-emerald-50 border-emerald-200' : gap < 500 ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ejercicio:</span>
        {years.length === 0 && <span className="text-xs text-slate-400">Sin datos bancarios importados</span>}
        {years.map(y => (
          <button key={y} onClick={() => setSelectedYear(y)}
            className={`px-4 py-1.5 rounded-xl text-xs font-black border transition ${selectedYear === y ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
            {y}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Salidas Banco {selectedYear}</p>
          <p className="text-2xl font-black text-slate-900 tabular-nums">-{Num.fmt(audit.totalSalidas)}</p>
          <p className="text-[9px] text-slate-400 mt-1">{audit.numSalidas} movimientos</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Entradas Banco {selectedYear}</p>
          <p className="text-2xl font-black text-emerald-600 tabular-nums">+{Num.fmt(audit.totalEntradas)}</p>
          <p className="text-[9px] text-slate-400 mt-1">{audit.numEntradas} movimientos</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gastos Registrados</p>
          <p className="text-2xl font-black text-indigo-600 tabular-nums">{Num.fmt(audit.totalRegistrado)}</p>
          <p className="text-[9px] text-slate-400 mt-1">Facturas + Albaranes</p>
        </div>
        <div className={`p-4 rounded-2xl border shadow-sm ${gapBg}`}>
          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Sin Contabilizar</p>
          <p className={`text-2xl font-black tabular-nums ${gapColor}`}>{gap > 0 ? Num.fmt(gap) : '\u2713 Cuadra'}</p>
          <p className="text-[9px] text-slate-500 mt-1">{pct}% cubierto</p>
        </div>
      </div>
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs font-black text-slate-700">Cobertura contable del gasto bancario</p>
          <p className="text-xs font-black text-indigo-600">{pct}%</p>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${pct >= 90 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="grid grid-cols-3 mt-4 gap-2 text-center text-[10px]">
          <div className="bg-indigo-50 rounded-xl p-2">
            <p className="font-black text-indigo-700">{Num.fmt(audit.totalFacturasCompra)}</p>
            <p className="text-indigo-400 font-bold">Facturas compra</p>
          </div>
          <div className="bg-amber-50 rounded-xl p-2">
            <p className="font-black text-amber-700">{Num.fmt(audit.totalAlbaranes)}</p>
            <p className="text-amber-400 font-bold">Albaranes s/factura</p>
          </div>
          <div className={`rounded-xl p-2 ${gapBg}`}>
            <p className={`font-black ${gapColor}`}>{gap > 0 ? Num.fmt(gap) : '0,00 \u20ac'}</p>
            <p className="text-slate-400 font-bold">Pendiente</p>
          </div>
        </div>
      </div>
      {audit.meses.length > 0 && (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-800 uppercase tracking-widest mb-4">Desglose Mensual {selectedYear}</p>
          <div className="space-y-2">
            {audit.meses.map((m, i) => {
              const mesGap = m.salidas - m.registrado;
              const mesPct = m.salidas > 0 ? Math.min((m.registrado / m.salidas) * 100, 100) : 100;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-slate-400 w-8 flex-shrink-0">{m.mes}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${mesPct >= 90 ? 'bg-emerald-400' : mesPct >= 60 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${mesPct}%` }} />
                  </div>
                  <span className="text-[10px] font-black text-slate-700 w-20 text-right tabular-nums flex-shrink-0">-{Num.fmt(m.salidas)}</span>
                  <span className={`text-[10px] font-black w-16 text-right tabular-nums flex-shrink-0 ${mesGap > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                    {mesGap > 0 ? `-${Num.fmt(mesGap)}` : '\u2713'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {audit.numMovs === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Landmark className="w-12 h-12 mx-auto mb-3 opacity-20"/>
          <p className="text-xs font-black uppercase tracking-widest">Sin movimientos bancarios en {selectedYear}</p>
          <p className="text-[10px] mt-1">Importa el extracto en la secci\u00f3n Banco</p>
        </div>
      )}
    </div>
  );
};

const RatioRow = ({ label, val, target, isMega=false }: { label:string; val:number; target:number; isMega?:boolean }) => {
  const over = val > target;
  return (
    <div className={cn('flex items-center justify-between p-2.5 rounded-lg border transition-colors', isMega?'border-indigo-500/30 bg-indigo-500/10':'border-slate-800 bg-slate-800/50')}>
      <div>
        <p className={cn('font-black uppercase tracking-wider', isMega?'text-sm text-indigo-300':'text-[10px] text-slate-300')}>{label}</p>
        <p className="text-[9px] font-bold text-slate-500 mt-0.5">Objetivo: &lt;{target}%</p>
      </div>
      <div className={cn('px-3 py-1.5 rounded-lg font-black tracking-tight flex items-center gap-1.5', isMega?'text-lg':'text-sm', over?'bg-rose-500/20 text-rose-400 border border-rose-500/30':'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30')}>
        {over?'⚠️':'✅'} {Num.round2(val)}%
      </div>
    </div>
  );
};
