import React, { useState, useMemo } from 'react';
import { 
  Scale, 
  Download, 
  Send, 
  FileText, 
  Users, 
  TrendingUp, 
  TrendingDown, 
  CheckCircle2, 
  AlertCircle,
  Calendar,
  RefreshCw,
  ArrowRight,
  ChefHat,
  Zap
} from 'lucide-react';
import { motion } from 'motion/react';
import { AppData, Albaran, Factura } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';

interface LiquidacionesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

const REAL_PARTNERS = ['PAU', 'JERONI', 'AGNES', 'ONLY ONE', 'TIENDA DE SAKES'];

export const LiquidacionesView = ({ data, onSave }: LiquidacionesViewProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

  // --- CALCULATIONS ---
  const stats = useMemo(() => {
    const year = parseInt(selectedPeriod.split('-')[0]);
    const month = parseInt(selectedPeriod.split('-')[1]) - 1;

    const periodFacturas = (data.facturas || []).filter(f => {
      const d = DateUtil.parse(f.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    const periodAlbaranes = (data.albaranes || []).filter(a => {
      const d = DateUtil.parse(a.date);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    // IVA Repercutido (Facturas emitidas)
    const ivaRepercutido = periodFacturas.reduce((acc, f) => acc + (Num.parse(f.total) - (Num.parse(f.total) / 1.1)), 0); // Simplificado 10%
    const totalVentas = periodFacturas.reduce((acc, f) => acc + Num.parse(f.total), 0);

    // IVA Soportado (Albaranes/Gastos)
    const ivaSoportado = periodAlbaranes.reduce((acc, a) => acc + (Num.parse(a.taxes) || 0), 0);
    const totalGastos = periodAlbaranes.reduce((acc, a) => acc + Num.parse(a.total), 0);

    // Partner Settlements
    const partnerSpending: Record<string, number> = {};
    REAL_PARTNERS.forEach(p => partnerSpending[p] = 0);
    
    periodAlbaranes.forEach(a => {
      if (a.socio && REAL_PARTNERS.includes(a.socio)) {
        partnerSpending[a.socio] += Num.parse(a.total);
      }
    });

    return {
      totalVentas,
      totalGastos,
      ivaRepercutido,
      ivaSoportado,
      ivaBalance: ivaRepercutido - ivaSoportado,
      partnerSpending,
      countFacturas: periodFacturas.length,
      countAlbaranes: periodAlbaranes.length,
      // Mock data for other things
      propinas: totalVentas * 0.03, // 3% estimation
      horasExtra: 450,
      docsGestoria: [
        { id: '1', name: 'Modelo 303 (Borrador)', status: 'ready' },
        { id: '2', name: 'Resumen Retenciones 111', status: 'pending' },
        { id: '3', name: 'Certificado de Estar al Corriente', status: 'ready' }
      ]
    };
  }, [data.facturas, data.albaranes, selectedPeriod]);

  const handleExportGestoria = async () => {
    if (!confirm(`¿Enviar liquidación de ${selectedPeriod} a la Gestoría?`)) return;
    
    setIsExporting(true);
    try {
      // n8n Webhook Integration
      const n8nWebhook = "https://ia.permatunnelopen.org/webhook/gestoria-export";
      const payload = {
        period: selectedPeriod,
        stats,
        facturas: data.facturas.filter(f => f.date.startsWith(selectedPeriod)),
        albaranes: data.albaranes.filter(a => a.date.startsWith(selectedPeriod)),
        timestamp: new Date().toISOString()
      };

      await proxyFetch(n8nWebhook, {
        method: 'POST',
        body: payload
      });
      
      alert("¡Documentos enviados a Gestoría con éxito! ✅");
    } catch (err) {
      console.error(err);
      alert("Error al conectar con n8n. Verifica el túnel.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header */}
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tighter">Liquidaciones & Gestoría</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Cierre de Periodo · IVA · Socios</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-slate-50 p-2 rounded-2xl border border-slate-100 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input 
              type="month" 
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-transparent text-xs font-black text-slate-700 outline-none"
            />
          </div>
          <button 
            onClick={handleExportGestoria}
            disabled={isExporting}
            className="bg-slate-900 text-white px-6 py-3 rounded-2xl text-[10px] font-black shadow-lg hover:bg-indigo-600 transition flex items-center gap-2 disabled:opacity-50"
          >
            {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            ENVIAR GESTORÍA
          </button>
        </div>
      </header>

      {/* IVA & Totals Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden">
          <TrendingUp className="absolute -right-4 -top-4 w-24 h-24 opacity-5 text-emerald-500" />
          <p className="text-[10px] font-black text-slate-400 uppercase mb-1">IVA Repercutido</p>
          <h3 className="text-2xl font-black text-emerald-600">{Num.fmt(stats.ivaRepercutido)}</h3>
          <p className="text-[9px] text-slate-400 font-bold mt-1">Ventas: {Num.fmt(stats.totalVentas)}</p>
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden">
          <TrendingDown className="absolute -right-4 -top-4 w-24 h-24 opacity-5 text-rose-500" />
          <p className="text-[10px] font-black text-slate-400 uppercase mb-1">IVA Soportado</p>
          <h3 className="text-2xl font-black text-rose-600">{Num.fmt(stats.ivaSoportado)}</h3>
          <p className="text-[9px] text-slate-400 font-bold mt-1">Gastos: {Num.fmt(stats.totalGastos)}</p>
        </div>
        <div className={cn(
          "p-6 rounded-[2rem] border shadow-sm relative overflow-hidden",
          stats.ivaBalance >= 0 ? "bg-indigo-50 border-indigo-100" : "bg-amber-50 border-amber-100"
        )}>
          <Scale className="absolute -right-4 -top-4 w-24 h-24 opacity-10 text-indigo-500" />
          <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Balance IVA (Estimado)</p>
          <h3 className={cn("text-2xl font-black", stats.ivaBalance >= 0 ? "text-indigo-600" : "text-amber-600")}>
            {Num.fmt(stats.ivaBalance)}
          </h3>
          <p className="text-[9px] text-slate-400 font-bold mt-1">A liquidar en trimestre</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Partner Settlements */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-xs font-black text-slate-800 uppercase mb-6 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-500" />
            Liquidación Socios
          </h3>
          <div className="space-y-3">
            {REAL_PARTNERS.map(partner => (
              <div key={partner} className="flex justify-between items-center p-3 bg-slate-50 rounded-2xl hover:bg-slate-100 transition">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center font-black text-indigo-600 shadow-sm text-[10px]">
                    {partner.charAt(0)}
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-800">{partner}</p>
                    <p className="text-[8px] text-slate-400 font-bold uppercase">Gasto personal</p>
                  </div>
                </div>
                <p className="text-sm font-black text-slate-900">{Num.fmt(stats.partnerSpending[partner])}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Staff Settlements */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-xs font-black text-slate-800 uppercase mb-6 flex items-center gap-2">
            <ChefHat className="w-4 h-4 text-amber-500" />
            Liquidación Personal
          </h3>
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black text-amber-800 uppercase">Propinas Estimadas</span>
                <span className="text-sm font-black text-amber-600">{Num.fmt(stats.propinas)}</span>
              </div>
              <div className="h-1.5 bg-amber-200/30 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 w-3/4 rounded-full"></div>
              </div>
              <p className="text-[8px] text-amber-600 font-bold mt-2 uppercase">Basado en 3% de ventas brutas</p>
            </div>
            
            <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black text-indigo-800 uppercase">Horas Extra / Refuerzos</span>
                <span className="text-sm font-black text-indigo-600">{Num.fmt(stats.horasExtra)}</span>
              </div>
              <p className="text-[8px] text-indigo-400 font-bold uppercase">Pendiente de validación gerencia</p>
            </div>

            <button className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-[10px] font-black text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition uppercase">
              + Añadir Concepto Personal
            </button>
          </div>
        </div>

        {/* Gestoria & Docs */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-xs font-black text-slate-800 uppercase mb-6 flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-500" />
            Documentos Gestoría
          </h3>
          <div className="space-y-3">
            {stats.docsGestoria.map(doc => (
              <div key={doc.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100 group hover:bg-white hover:shadow-md transition cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center",
                    doc.status === 'ready' ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
                  )}>
                    <FileText className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-700">{doc.name}</span>
                </div>
                {doc.status === 'ready' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <RefreshCw className="w-4 h-4 text-amber-400 animate-spin-slow" />}
              </div>
            ))}
            
            <div className="mt-6 p-4 bg-indigo-600 rounded-2xl text-white shadow-lg relative overflow-hidden">
              <Zap className="absolute -right-2 -bottom-2 w-16 h-16 opacity-20" />
              <p className="text-[10px] font-black uppercase opacity-80">Exportación Inteligente</p>
              <p className="text-xs font-bold mt-1">¿Necesitas un informe a medida?</p>
              <button className="mt-3 bg-white text-indigo-600 px-4 py-2 rounded-xl text-[10px] font-black hover:bg-indigo-50 transition">
                PEDIR A IA
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

