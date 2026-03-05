import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  BarChart3, 
  PieChart, 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Download, 
  Zap, 
  Scale, 
  Calculator,
  ArrowUpRight,
  ArrowDownRight,
  Info,
  Bot
} from 'lucide-react';
import { AppData } from '../types';
import { ArumeEngine, Num } from '../services/engine';
import { motion, AnimatePresence } from 'motion/react';
import { NotificationService } from '../services/notifications';
import { Send } from 'lucide-react';

interface ReportsViewProps {
  db: AppData;
}

type TabType = 'pnl' | 'fiscal' | 'kpis';

export const ReportsView: React.FC<ReportsViewProps> = ({ db }) => {
  const [activeTab, setActiveTab] = useState<TabType>('pnl');
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [quarter, setQuarter] = useState(Math.ceil((today.getMonth() + 1) / 3));
  const [iaAnalysis, setIaAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const changeMonth = (delta: number) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth > 11) {
      newMonth = 0;
      newYear++;
    } else if (newMonth < 0) {
      newMonth = 11;
      newYear--;
    }
    setMonth(newMonth);
    setYear(newYear);
  };

  const changeQuarter = (q: number) => {
    setQuarter(q);
  };

  // --- MOTOR FISCAL (IVA 303) ---
  const calcularModelo303 = () => {
    const monthsInTrim = [(quarter - 1) * 3, (quarter - 1) * 3 + 1, (quarter - 1) * 3 + 2];
    
    const inPeriod = (dateStr: string) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getFullYear() === year && monthsInTrim.includes(d.getMonth());
    };

    // A. IVA DEVENGADO (VENTAS)
    let devengado = { base: 0, iva: 0, total: 0 };
    
    (db.cierres || []).filter(z => inPeriod(z.date)).forEach(z => {
      const total = Num.parse(z.totalVenta);
      const base = total / 1.10; // Estándar hostelería 10%
      devengado.base += base;
      devengado.iva += (total - base);
      devengado.total += total;
    });

    (db.facturas || []).filter(f => inPeriod(f.date) && !String(f.num).startsWith('Z-')).forEach(f => {
      const total = Num.parse(f.total);
      let base = f.base ? Num.parse(f.base) : (total / 1.10);
      let tax = f.tax ? Num.parse(f.tax) : (total - base);
      devengado.base += base;
      devengado.iva += tax;
      devengado.total += total;
    });

    // B. IVA DEDUCIBLE (GASTOS)
    let deducible = { base4: 0, iva4: 0, base10: 0, iva10: 0, base21: 0, iva21: 0, total: 0 };

    (db.albaranes || []).filter(a => inPeriod(a.date)).forEach(a => {
      const total = Num.parse(a.total);
      const prov = (a.prov || '').toLowerCase();
      let tipo = 10; 

      if (prov.match(/luz|agua|tel|gestor|seguro|alquiler|reparacion|maquinaria|limpieza|amazon/)) tipo = 21;
      else if (prov.match(/pan|leche|huevo|fruta|verdura|harina/)) tipo = 4;
      else if (prov.match(/alcohol|bebida|vino|cerveza|licor/)) tipo = 21;

      const div = 1 + (tipo / 100);
      const base = total / div;
      const quota = total - base;

      if (tipo === 4) { deducible.base4 += base; deducible.iva4 += quota; }
      else if (tipo === 10) { deducible.base10 += base; deducible.iva10 += quota; }
      else if (tipo === 21) { deducible.base21 += base; deducible.iva21 += quota; }
      deducible.total += total;
    });

    // Sumar Gastos Fijos (Prorrateados para el trimestre)
    (db.gastos_fijos || []).filter(g => g.active !== false).forEach(g => {
      let amount = Num.parse(g.amount);
      // Ajustar al trimestre
      if (g.freq === 'mensual') amount *= 3;
      else if (g.freq === 'anual') amount /= 4;
      else if (g.freq === 'semanal') amount *= 13; // 13 semanas en un trimestre aprox
      
      if (g.cat !== 'personal') { 
        const base = amount / 1.21;
        deducible.base21 += base;
        deducible.iva21 += (amount - base);
        deducible.total += amount;
      }
    });

    const totalSoportado = deducible.iva4 + deducible.iva10 + deducible.iva21;
    const resultado = devengado.iva - totalSoportado;

    return { devengado, deducible, resultado, totalSoportado };
  };

  // --- MOTOR IRPF (Modelo 130) ---
  const calcularModelo130 = () => {
    const ivaData = calcularModelo303();
    const baseVentas = ivaData.devengado.base;
    const baseCompras = ivaData.deducible.base4 + ivaData.deducible.base10 + ivaData.deducible.base21;
    
    // Gastos de personal (estimados para el trimestre)
    let personalQ = 0;
    (db.gastos_fijos || []).filter(g => g.active !== false && g.cat === 'personal').forEach(g => {
      let val = Num.parse(g.amount);
      if (g.freq === 'mensual') val *= 3;
      else if (g.freq === 'anual') val /= 4;
      else if (g.freq === 'semanal') val *= 13;
      personalQ += val;
    });

    const beneficio = baseVentas - baseCompras - personalQ;
    const cuotaIRPF = beneficio > 0 ? beneficio * 0.20 : 0;

    return { beneficio, cuotaIRPF };
  };

  const exportIVA = () => {
    const data = calcularModelo303();
    const csv = `CONCEPTO;BASE;IVA\n` +
                `Repercutido;${data.devengado.base.toFixed(2)};${data.devengado.iva.toFixed(2)}\n` +
                `Soportado 4%;${data.deducible.base4.toFixed(2)};${data.deducible.iva4.toFixed(2)}\n` +
                `Soportado 10%;${data.deducible.base10.toFixed(2)};${data.deducible.iva10.toFixed(2)}\n` +
                `Soportado 21%;${data.deducible.base21.toFixed(2)};${data.deducible.iva21.toFixed(2)}\n` +
                `RESULTADO LIQUIDACION;;${data.resultado.toFixed(2)}`;
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `IVA_T${quarter}_${year}.csv`;
    link.click();
  };

  const analizarConIA = async () => {
    setIsAnalyzing(true);
    setIaAnalysis(null);
    
    const profitData = ArumeEngine.getProfit(db, month, year);
    
    // Recopilamos datos para el análisis
    const inMonth = (d: string) => { 
      const date = new Date(d); 
      return date.getMonth() === month && date.getFullYear() === year; 
    };
    const ventasZ = (db.cierres || []).filter(z => inMonth(z.date));
    const numTickets = ventasZ.reduce((acc, z) => acc + (parseInt(z.tickets) || 0), 0); 
    const ticketMedio = numTickets > 0 ? profitData.ingresos.caja / numTickets : 0;

    const payload = {
      mes: `${month + 1}-${year}`,
      ingresos: profitData.ingresos.total,
      beneficio: profitData.neto,
      foodCostPct: profitData.ratios.foodCost,
      drinkCostPct: profitData.ratios.drinkCost,
      staffCostPct: profitData.ratios.staffCost,
      primeCostPct: profitData.ratios.primeCost,
      ticketMedio: ticketMedio
    };

    try {
      const n8nUrl = db.config?.n8nUrlIA;
      
      if (n8nUrl) {
        const response = await fetch(n8nUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("Error en el servidor de n8n");
        const result = await response.json();
        setIaAnalysis(result.analisis || result.texto || "Análisis completado sin comentarios.");
      } else {
        // Simulación si no hay URL
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        let consejo = "";
        if (profitData.ratios.primeCost > 65) {
          consejo = "⚠️ Tu Prime Cost está por encima del 65%. Debes revisar urgentemente los costes de personal o renegociar con proveedores de alimentación.";
        } else if (profitData.ratios.foodCost > 30) {
          consejo = "🍲 El Food Cost es elevado. Considera revisar las mermas en cocina o ajustar los precios de los platos con menor margen.";
        } else if (profitData.neto < 0) {
          consejo = "📉 El mes ha cerrado en pérdidas. Es vital reducir los gastos de estructura fijos o aumentar el ticket medio mediante venta sugestiva.";
        } else {
          consejo = "✅ ¡Buen trabajo! Los ratios están bajo control. Podrías invertir un poco más en marketing para aumentar el volumen de clientes ahora que el margen es saludable.";
        }
        setIaAnalysis(consejo);
      }
    } catch (error) {
      console.error(error);
      setIaAnalysis("Error al conectar con el analista IA.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const profitData = ArumeEngine.getProfit(db, month, year);
  const mesNombre = new Date(year, month).toLocaleDateString('es-ES', { month: 'long' });

  const enviarResumenTelegram = async () => {
    const p = profitData;
    const msg = `📊 *RESUMEN MENSUAL: ${mesNombre.toUpperCase()} ${year}*\n\n` +
      `💰 *Ingresos:* ${Num.fmt(p.ingresos.total)}\n` +
      `📉 *Gastos:* ${Num.fmt(p.gastos.total)}\n` +
      `✨ *Beneficio:* ${Num.fmt(p.neto)}\n\n` +
      `*Ratios Clave:*\n` +
      `🍔 Food Cost: ${p.ratios.foodCost.toFixed(1)}%\n` +
      `👥 Staff Cost: ${p.ratios.staffCost.toFixed(1)}%\n` +
      `⚡ Prime Cost: ${p.ratios.primeCost.toFixed(1)}%\n\n` +
      `_Enviado desde Arume ERP_`;
    
    await NotificationService.sendAlert(db, msg, 'INFO');
    alert("Resumen enviado a Telegram.");
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header & Tabs */}
      <div className="flex flex-col gap-4">
        <header className="flex justify-between items-center px-2">
          <div>
            <h2 className="text-2xl font-black text-slate-800">Informes 360º</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Analítica y Fiscalidad</p>
          </div>
          <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-100">
            <button 
              onClick={() => setActiveTab('pnl')} 
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition ${activeTab === 'pnl' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:bg-slate-50'}`}
            >
              Resultados
            </button>
            <button 
              onClick={() => setActiveTab('fiscal')} 
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition ${activeTab === 'fiscal' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-slate-50'}`}
            >
              Fiscal (IVA)
            </button>
            <button 
              onClick={() => setActiveTab('kpis')} 
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition ${activeTab === 'kpis' ? 'bg-emerald-500 text-white shadow' : 'text-slate-400 hover:bg-slate-50'}`}
            >
              KPIs Pro
            </button>
          </div>
        </header>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'pnl' && (
          <motion.div 
            key="pnl"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Month Selector */}
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100">
              <button onClick={() => changeMonth(-1)} className="w-10 h-10 rounded-full bg-slate-50 hover:bg-indigo-100 text-indigo-600 flex items-center justify-center transition">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h3 className="text-sm font-black text-slate-800 uppercase flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-500" />
                {mesNombre} {year}
              </h3>
              <button onClick={() => changeMonth(1)} className="w-10 h-10 rounded-full bg-slate-50 hover:bg-indigo-100 text-indigo-600 flex items-center justify-center transition">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <button 
              onClick={enviarResumenTelegram}
              className="w-full py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-50 transition shadow-sm"
            >
              <Send className="w-4 h-4 text-indigo-500" />
              Enviar Resumen a Telegram
            </button>

            {/* Net Profit Card */}
            <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-xl text-center relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-400 via-slate-900 to-slate-900"></div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 relative z-10">Beneficio Neto (Antes Impuestos)</p>
              <p className={`text-5xl font-black relative z-10 ${profitData.neto >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {Num.fmt(profitData.neto)}
              </p>
              <div className="mt-4 flex justify-center gap-4 relative z-10">
                <div className="px-3 py-1 bg-white/5 rounded-full border border-white/10 text-[9px] font-bold uppercase text-slate-400">
                  Margen: {((profitData.neto / (profitData.ingresos.total || 1)) * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Breakdown List */}
            <div className="space-y-3">
              <div className="bg-white p-5 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                    <ArrowUpRight className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700">Ingresos Totales</p>
                    <p className="text-[9px] text-slate-400">Ventas Caja + Facturas B2B</p>
                  </div>
                </div>
                <p className="text-lg font-black text-slate-800">{Num.fmt(profitData.ingresos.total)}</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center">
                    <ArrowDownRight className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700">Gastos Variables</p>
                    <p className="text-[9px] text-slate-400">Mercaderías (Comida/Bebida)</p>
                  </div>
                </div>
                <p className="text-lg font-black text-rose-500">-{Num.fmt(profitData.gastos.comida + profitData.gastos.bebida + profitData.gastos.otros)}</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center">
                    <PieChart className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700">Estructura Fija</p>
                    <p className="text-[9px] text-slate-400">Personal y Local</p>
                  </div>
                </div>
                <p className="text-lg font-black text-rose-500">-{Num.fmt(profitData.gastos.personal + profitData.gastos.estructura)}</p>
              </div>
              
              <div className="bg-white p-5 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm opacity-75">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center">
                    <Calculator className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700">Amortizaciones</p>
                    <p className="text-[9px] text-slate-400">Desgaste maquinaria y activos</p>
                  </div>
                </div>
                <p className="text-lg font-black text-slate-600">-{Num.fmt(profitData.gastos.amortizacion)}</p>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'fiscal' && (
          <motion.div 
            key="fiscal"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Quarter Selector */}
            <div className="flex justify-center">
              <div className="flex bg-slate-100 p-1 rounded-xl shadow-inner">
                {[1, 2, 3, 4].map(q => (
                  <button 
                    key={q}
                    onClick={() => changeQuarter(q)} 
                    className={`px-6 py-2 rounded-lg text-[10px] font-black transition ${quarter === q ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    T{q}
                  </button>
                ))}
              </div>
            </div>

            {/* IVA Summary Card */}
            {(() => {
              const iva = calcularModelo303();
              const irpf = calcularModelo130();
              const totalPagar = (iva.resultado > 0 ? iva.resultado : 0) + irpf.cuotaIRPF;

              return (
                <>
                  <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden text-center">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500 rounded-full blur-[100px] opacity-20 -mr-16 -mt-16"></div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Total Estimado a Pagar (IVA + IRPF)</p>
                    <h3 className="text-5xl md:text-6xl font-black tracking-tight mb-2">{Num.fmt(totalPagar)}</h3>
                    <p className="text-xs text-slate-400">Previsión para el final del trimestre {quarter}T {year}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Modelo 303 */}
                    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden">
                      <div className="flex justify-between items-center mb-6">
                        <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black uppercase">Modelo 303 (IVA)</span>
                        <Scale className="w-5 h-5 text-indigo-500" />
                      </div>
                      
                      <div className="space-y-4">
                        <div className="flex justify-between items-end border-b border-slate-50 pb-2">
                          <span className="text-xs font-bold text-slate-400">IVA Repercutido (+)</span>
                          <span className="text-lg font-black text-slate-800">{Num.fmt(iva.devengado.iva)}</span>
                        </div>
                        <div className="flex justify-between items-end border-b border-slate-50 pb-2">
                          <span className="text-xs font-bold text-slate-400">IVA Soportado (-)</span>
                          <span className="text-lg font-black text-emerald-500">-{Num.fmt(iva.totalSoportado)}</span>
                        </div>
                        <div className="flex justify-between items-end pt-2">
                          <span className="text-xs font-black text-slate-800 uppercase">Resultado IVA</span>
                          <span className={`text-2xl font-black ${iva.resultado > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                            {Num.fmt(iva.resultado)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Modelo 130 */}
                    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden">
                      <div className="flex justify-between items-center mb-6">
                        <span className="px-3 py-1 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-black uppercase">Modelo 130 (IRPF)</span>
                        <Calculator className="w-5 h-5 text-rose-500" />
                      </div>
                      
                      <div className="space-y-4">
                        <div className="flex justify-between items-end border-b border-slate-50 pb-2">
                          <span className="text-xs font-bold text-slate-400">Beneficio Neto (Trim.)</span>
                          <span className="text-lg font-black text-slate-800">{Num.fmt(irpf.beneficio)}</span>
                        </div>
                        <div className="flex justify-between items-end border-b border-slate-50 pb-2">
                          <span className="text-xs font-bold text-slate-400">Tipo Impositivo</span>
                          <span className="text-lg font-black text-slate-400">20%</span>
                        </div>
                        <div className="flex justify-between items-end pt-2">
                          <span className="text-xs font-black text-slate-800 uppercase">Cuota a Pagar</span>
                          <span className="text-2xl font-black text-rose-500">{Num.fmt(irpf.cuotaIRPF)}</span>
                        </div>
                      </div>
                      <p className="text-[9px] text-slate-300 mt-4 italic flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        *Calculado como el 20% del rendimiento neto positivo.
                      </p>
                    </div>
                  </div>

                  {/* Detailed Table */}
                  <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Concepto</th>
                          <th className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Base</th>
                          <th className="p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Cuota IVA</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 text-xs font-medium text-slate-600">
                        <tr>
                          <td className="p-4 font-bold text-slate-800">IVA Ventas (10% Est.)</td>
                          <td className="p-4 text-right font-mono">{Num.fmt(iva.devengado.base)}</td>
                          <td className="p-4 text-right font-bold text-emerald-600">{Num.fmt(iva.devengado.iva)}</td>
                        </tr>
                        <tr className="bg-rose-50/30">
                          <td className="p-4 font-bold text-slate-800">Soportado 4%</td>
                          <td className="p-4 text-right font-mono">{Num.fmt(iva.deducible.base4)}</td>
                          <td className="p-4 text-right font-bold text-rose-500">{Num.fmt(iva.deducible.iva4)}</td>
                        </tr>
                        <tr className="bg-rose-50/30">
                          <td className="p-4 font-bold text-slate-800">Soportado 10%</td>
                          <td className="p-4 text-right font-mono">{Num.fmt(iva.deducible.base10)}</td>
                          <td className="p-4 text-right font-bold text-rose-500">{Num.fmt(iva.deducible.iva10)}</td>
                        </tr>
                        <tr className="bg-rose-50/30">
                          <td className="p-4 font-bold text-slate-800">Soportado 21%</td>
                          <td className="p-4 text-right font-mono">{Num.fmt(iva.deducible.base21)}</td>
                          <td className="p-4 text-right font-bold text-rose-500">{Num.fmt(iva.deducible.iva21)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  
                  <button 
                    onClick={exportIVA} 
                    className="w-full py-4 bg-slate-100 text-slate-600 font-black text-xs rounded-2xl hover:bg-slate-200 transition flex items-center justify-center gap-2 border border-slate-200"
                  >
                    <Download className="w-4 h-4" />
                    DESCARGAR CSV FISCAL
                  </button>
                </>
              );
            })()}
          </motion.div>
        )}

        {activeTab === 'kpis' && (
          <motion.div 
            key="kpis"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Month Selector */}
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100">
              <button onClick={() => changeMonth(-1)} className="w-10 h-10 rounded-full bg-slate-50 hover:bg-indigo-100 text-indigo-600 flex items-center justify-center transition">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h3 className="text-sm font-black text-slate-800 uppercase">{mesNombre} {year}</h3>
              <button onClick={() => changeMonth(1)} className="w-10 h-10 rounded-full bg-slate-50 hover:bg-indigo-100 text-indigo-600 flex items-center justify-center transition">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 gap-4">
              {(() => {
                const inMonth = (d: string) => { 
                  const date = new Date(d); 
                  return date.getMonth() === month && date.getFullYear() === year; 
                };
                const ventasZ = (db.cierres || []).filter(z => inMonth(z.date));
                const numTickets = ventasZ.reduce((acc, z) => acc + (parseInt(z.tickets) || 0), 0); 
                const ticketMedio = numTickets > 0 ? profitData.ingresos.caja / numTickets : 0;

                return (
                  <>
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm text-center">
                      <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <Calculator className="w-6 h-6" />
                      </div>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Ticket Medio</p>
                      <p className="text-2xl font-black text-slate-800">{Num.fmt(ticketMedio)}</p>
                    </div>
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm text-center">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 ${profitData.ratios.primeCost > 65 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        <Zap className="w-6 h-6" />
                      </div>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Prime Cost</p>
                      <p className={`text-2xl font-black ${profitData.ratios.primeCost > 65 ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {profitData.ratios.primeCost.toFixed(1)}%
                      </p>
                      <p className="text-[8px] text-slate-400 mt-1">Objetivo: &lt; 65%</p>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Distribution Charts */}
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
              <h3 className="font-black text-slate-800 text-sm flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-500" />
                Distribución de Costes
              </h3>
              
              <div className="space-y-5">
                <div>
                  <div className="flex justify-between text-xs font-bold mb-2">
                    <span className="text-slate-600">Personal (Staff Cost)</span>
                    <span className={profitData.ratios.staffCost > 35 ? 'text-rose-500' : 'text-slate-800'}>
                      {profitData.ratios.staffCost.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, profitData.ratios.staffCost)}%` }}
                      className="bg-blue-500 h-full rounded-full"
                    />
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1.5 text-right">Ideal: 30-35%</p>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold mb-2">
                    <span className="text-slate-600">Comida (Food Cost)</span>
                    <span className={profitData.ratios.foodCost > 30 ? 'text-rose-500' : 'text-slate-800'}>
                      {profitData.ratios.foodCost.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, profitData.ratios.foodCost)}%` }}
                      className="bg-orange-500 h-full rounded-full"
                    />
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1.5 text-right">Ideal: 25-30%</p>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold mb-2">
                    <span className="text-slate-600">Bebida (Pour Cost)</span>
                    <span className={profitData.ratios.drinkCost > 25 ? 'text-rose-500' : 'text-slate-800'}>
                      {profitData.ratios.drinkCost.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, profitData.ratios.drinkCost)}%` }}
                      className="bg-purple-500 h-full rounded-full"
                    />
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1.5 text-right">Ideal: 18-22%</p>
                </div>
              </div>
            </div>

            {/* AI Analyst Button */}
            <div className="space-y-4">
              <button 
                onClick={analizarConIA} 
                disabled={isAnalyzing}
                className="w-full py-5 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white font-black text-xs rounded-[2rem] hover:shadow-xl hover:scale-[1.02] transition-all flex flex-col items-center justify-center gap-2 shadow-lg disabled:opacity-70 disabled:scale-100"
              >
                {isAnalyzing ? (
                  <>
                    <Bot className="w-8 h-8 animate-bounce" />
                    <span className="tracking-widest uppercase">Analizando datos del mes...</span>
                  </>
                ) : (
                  <>
                    <Bot className="w-8 h-8" />
                    <span className="tracking-widest uppercase">IA: Analizar Rendimiento {mesNombre}</span>
                  </>
                )}
              </button>

              {iaAnalysis && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-indigo-50 border border-indigo-100 p-6 rounded-[2rem] text-xs text-indigo-900 leading-relaxed font-medium shadow-sm relative"
                >
                  <div className="absolute -top-2 -left-2 w-8 h-8 bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-md">
                    <Bot className="w-4 h-4" />
                  </div>
                  <p className="font-black text-indigo-600 uppercase mb-3 tracking-widest text-[10px]">Consejo del Director Financiero IA:</p>
                  {iaAnalysis}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
