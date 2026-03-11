import React, { useState, useMemo } from 'react';
import { 
  Scale, Download, FileText, Users, TrendingUp, TrendingDown, 
  CheckCircle2, Calendar, ChefHat, Zap, Wallet, Building2, 
  ArrowUpRight, ArrowDownRight, Calculator
} from 'lucide-react';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { AppData } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';

interface LiquidacionesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const LiquidacionesView = ({ data, onSave }: LiquidacionesViewProps) => {
  const [selectedPeriod, setSelectedPeriod] = useState(DateUtil.today().slice(0, 7)); // YYYY-MM
  
  // Estados interactivos para el personal
  const [propinasPct, setPropinasPct] = useState<number>(3);
  const [horasExtraEuro, setHorasExtraEuro] = useState<number>(0);

  // --- CÁLCULOS ROBUSTOS ---
  const stats = useMemo(() => {
    // 1. Obtener socios dinámicamente de la DB
    const sociosActivos = Array.isArray(data.socios) && data.socios.length > 0 
      ? data.socios.filter(s => s.active).map(s => s.n) 
      : ['ARUME', 'PAU'];

    // 2. Filtrar por periodo
    const periodFacturas = (data.facturas || []).filter(f => 
      f.date && f.date.startsWith(selectedPeriod) && f.tipo !== 'caja'
    );
    const periodAlbaranes = (data.albaranes || []).filter(a => 
      a.date && a.date.startsWith(selectedPeriod)
    );

    // 3. IVA Repercutido (Ventas - Facturas emitidas)
    let totalVentas = 0;
    let ivaRepercutido = 0;
    periodFacturas.forEach(f => {
      const t = Num.parse(f.total);
      totalVentas += t;
      ivaRepercutido += Num.parse(f.tax) || Num.round2(t - Num.parse(f.base));
    });

    // 4. IVA Soportado (Compras - Albaranes recibidos)
    let totalGastos = 0;
    let ivaSoportado = 0;
    periodAlbaranes.forEach(a => {
      const t = Num.parse(a.total);
      totalGastos += t;
      ivaSoportado += Num.parse(a.taxes) || Num.round2(t - Num.parse(a.base));
    });

    // 5. Gastos por Socio
    const partnerSpending: Record<string, number> = {};
    sociosActivos.forEach(p => partnerSpending[p] = 0);
    partnerSpending['OTROS / RESTAURANTE'] = 0;
    
    periodAlbaranes.forEach(a => {
      const socioName = (a.socio || '').toUpperCase();
      if (sociosActivos.includes(socioName)) {
        partnerSpending[socioName] += Num.parse(a.total);
      } else {
        partnerSpending['OTROS / RESTAURANTE'] += Num.parse(a.total);
      }
    });

    return {
      totalVentas,
      totalGastos,
      ivaRepercutido,
      ivaSoportado,
      ivaBalance: ivaRepercutido - ivaSoportado,
      partnerSpending,
      sociosActivos,
      countFacturas: periodFacturas.length,
      countAlbaranes: periodAlbaranes.length,
      propinasVal: Num.round2(totalVentas * (propinasPct / 100)),
      rawFacturas: periodFacturas,
      rawAlbaranes: periodAlbaranes
    };
  }, [data, selectedPeriod, propinasPct]);

  // --- EXPORTACIÓN PROFESIONAL A EXCEL PARA GESTORÍA ---
  const handleExportGestoria = () => {
    if (stats.countFacturas === 0 && stats.countAlbaranes === 0) {
      return alert("No hay datos en este mes para exportar.");
    }

    // Hoja 1: Resumen (Modelo 303)
    const resumenData = [
      { CONCEPTO: 'TOTAL VENTAS (BRUTO)', IMPORTE: Num.fmt(stats.totalVentas) },
      { CONCEPTO: 'IVA REPERCUTIDO (A PAGAR)', IMPORTE: Num.fmt(stats.ivaRepercutido) },
      { CONCEPTO: 'TOTAL GASTOS (BRUTO)', IMPORTE: Num.fmt(stats.totalGastos) },
      { CONCEPTO: 'IVA SOPORTADO (A DEDUCIR)', IMPORTE: Num.fmt(stats.ivaSoportado) },
      { CONCEPTO: 'RESULTADO LIQUIDACIÓN IVA', IMPORTE: Num.fmt(stats.ivaBalance) },
    ];
    const wsResumen = XLSX.utils.json_to_sheet(resumenData);
    wsResumen['!cols'] = [{ wch: 35 }, { wch: 15 }];

    // Hoja 2: Ventas
    const ventasData = stats.rawFacturas.map(f => ({
      FECHA: f.date, FACTURA: f.num, CLIENTE: f.cliente || f.prov, 
      BASE: Num.parse(f.base), IVA: Num.parse(f.tax), TOTAL: Num.parse(f.total)
    }));
    const wsVentas = XLSX.utils.json_to_sheet(ventasData);

    // Hoja 3: Compras
    const comprasData = stats.rawAlbaranes.map(a => ({
      FECHA: a.date, PROVEEDOR: a.prov, REF: a.num, SOCIO: a.socio,
      BASE: Num.parse(a.base), IVA: Num.parse(a.taxes), TOTAL: Num.parse(a.total)
    }));
    const wsCompras = XLSX.utils.json_to_sheet(comprasData);

    // Crear Libro
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen_Impuestos");
    XLSX.utils.book_append_sheet(wb, wsVentas, "Facturas_Emitidas");
    XLSX.utils.book_append_sheet(wb, wsCompras, "Gastos_Recibidos");

    XLSX.writeFile(wb, `Liquidacion_Gestoria_${selectedPeriod}.xlsx`);
  };

  const formatMonth = (iso: string) => {
    const [y, m] = iso.split('-');
    const date = new Date(Number(y), Number(m) - 1);
    return date.toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">
      
      {/* 🚀 HEADER ESTILO HOLDED */}
      <header className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tighter">Impuestos & Cierres</h2>
          <p className="text-xs text-indigo-500 font-bold uppercase tracking-widest mt-1 flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Panel Financiero Arume
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200 flex items-center gap-2 shadow-inner">
            <Calendar className="w-5 h-5 text-slate-400 ml-1" />
            <input 
              type="month" 
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-transparent text-sm font-black text-slate-700 outline-none w-36 cursor-pointer"
            />
          </div>
          <button 
            onClick={handleExportGestoria}
            className="bg-slate-900 text-white px-6 py-4 rounded-2xl text-xs font-black shadow-xl hover:bg-emerald-600 transition-all flex items-center gap-2 transform active:scale-95"
          >
            <Download className="w-4 h-4" />
            EXPORTAR EXCEL GESTORÍA
          </button>
        </div>
      </header>

      {/* 📊 DASHBOARD IVA (Top Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-emerald-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
            <TrendingUp className="w-12 h-12 text-emerald-200" />
          </div>
          <div className="relative z-10">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">IVA Repercutido (Ventas)</p>
            <h3 className="text-4xl font-black text-emerald-600 tracking-tighter">{Num.fmt(stats.ivaRepercutido)}</h3>
            <div className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-500 bg-slate-50 w-fit px-3 py-1.5 rounded-xl border border-slate-100">
              <ArrowUpRight className="w-4 h-4 text-emerald-500" /> Base Ventas: {Num.fmt(stats.totalVentas)}
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-rose-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
            <TrendingDown className="w-12 h-12 text-rose-200" />
          </div>
          <div className="relative z-10">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">IVA Soportado (Gastos)</p>
            <h3 className="text-4xl font-black text-rose-600 tracking-tighter">{Num.fmt(stats.ivaSoportado)}</h3>
            <div className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-500 bg-slate-50 w-fit px-3 py-1.5 rounded-xl border border-slate-100">
              <ArrowDownRight className="w-4 h-4 text-rose-500" /> Base Gastos: {Num.fmt(stats.totalGastos)}
            </div>
          </div>
        </div>

        <div className={cn(
          "p-8 rounded-[2.5rem] border shadow-lg relative overflow-hidden flex flex-col justify-center",
          stats.ivaBalance >= 0 ? "bg-slate-900 border-slate-800 text-white" : "bg-amber-500 border-amber-600 text-white"
        )}>
          <Scale className="absolute -right-4 -top-4 w-32 h-32 opacity-10" />
          <div className="relative z-10">
            <p className="text-xs font-black opacity-70 uppercase tracking-widest mb-2">
              Resultado IVA ({formatMonth(selectedPeriod)})
            </p>
            <h3 className="text-5xl font-black tracking-tighter">
              {Num.fmt(Math.abs(stats.ivaBalance))}
            </h3>
            <p className="text-sm font-bold mt-2 opacity-90 flex items-center gap-1">
              <Calculator className="w-4 h-4" />
              {stats.ivaBalance >= 0 ? "A pagar a Hacienda (Estimado)" : "A devolver por Hacienda"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 👥 LIQUIDACIÓN SOCIOS */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-indigo-500" /> Liquidación Socios
          </h3>
          <div className="space-y-3 flex-1">
            {Object.entries(stats.partnerSpending).map(([partner, amount]) => {
              if (amount === 0 && partner === 'OTROS / RESTAURANTE') return null;
              const isOther = partner === 'OTROS / RESTAURANTE';
              return (
                <div key={partner} className={cn("flex justify-between items-center p-4 rounded-2xl border transition-all", isOther ? "bg-slate-50 border-slate-100" : "bg-white border-indigo-50 hover:border-indigo-200 hover:shadow-sm")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-black text-xs shadow-inner", isOther ? "bg-slate-200 text-slate-500" : "bg-indigo-100 text-indigo-700")}>
                      {isOther ? '?' : partner.substring(0, 2)}
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-800">{partner}</p>
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{isOther ? 'Gastos generales' : 'Retirado en compras'}</p>
                    </div>
                  </div>
                  <p className="text-lg font-black text-slate-900">{Num.fmt(amount)}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* 🧑‍🍳 LIQUIDACIÓN PERSONAL (INTERACTIVO) */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-amber-500" /> Retribución Equipo
          </h3>
          <div className="space-y-6 flex-1">
            
            {/* Propinas Editables */}
            <div className="p-5 bg-amber-50 rounded-[2rem] border border-amber-100 relative">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <span className="text-[10px] font-black text-amber-800 uppercase tracking-widest">Bote Propinas (Estimado)</span>
                  <div className="flex items-center gap-2 mt-1">
                    <input 
                      type="number" 
                      value={propinasPct} 
                      onChange={e => setPropinasPct(Number(e.target.value))}
                      className="w-12 bg-white border border-amber-200 rounded-lg text-center font-bold text-amber-700 text-xs py-1 outline-none focus:ring-2 ring-amber-400"
                    />
                    <span className="text-xs font-bold text-amber-600">% de ventas netas</span>
                  </div>
                </div>
                <span className="text-3xl font-black text-amber-600 tracking-tighter">{Num.fmt(stats.propinasVal)}</span>
              </div>
              <div className="w-full h-2 bg-amber-200/50 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(propinasPct * 10, 100)}%` }}></div>
              </div>
            </div>
            
            {/* Horas extra Editables */}
            <div className="p-5 bg-indigo-50 rounded-[2rem] border border-indigo-100">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-indigo-800 uppercase tracking-widest mt-2">Bolsa Horas Extra</span>
                <input 
                  type="number" 
                  value={horasExtraEuro} 
                  onChange={e => setHorasExtraEuro(Number(e.target.value))}
                  placeholder="0.00"
                  className="w-28 bg-white border border-indigo-200 rounded-xl text-right font-black text-indigo-700 text-xl py-2 px-3 outline-none focus:ring-2 ring-indigo-400 shadow-sm"
                />
              </div>
              <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest mt-2">Repartir a final de mes</p>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
              <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Total Equipo:</span>
              <span className="text-xl font-black text-slate-900">{Num.fmt(stats.propinasVal + horasExtraEuro)}</span>
            </div>
          </div>
        </div>

        {/* 📑 GESTORÍA Y DOCUMENTOS */}
        <div className="bg-slate-900 p-8 rounded-[2.5rem] shadow-xl text-white flex flex-col relative overflow-hidden">
          <Zap className="absolute -right-10 -bottom-10 w-48 h-48 opacity-5 text-indigo-300" />
          <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2 relative z-10">
            <FileText className="w-5 h-5 text-emerald-400" /> Pack Documentos
          </h3>
          
          <div className="space-y-4 flex-1 relative z-10">
            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="text-xs font-bold text-slate-200">Facturas de Venta</p>
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest font-black mt-0.5">{stats.countFacturas} Registros</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="text-xs font-bold text-slate-200">Gastos y Compras</p>
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest font-black mt-0.5">{stats.countAlbaranes} Registros</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="text-xs font-bold text-slate-200">Resumen IVA Mod.303</p>
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest font-black mt-0.5">Autogenerado</p>
                </div>
              </div>
            </div>
          </div>

          <button 
            onClick={handleExportGestoria}
            className="w-full mt-6 bg-indigo-500 text-white py-5 rounded-[1.5rem] text-xs font-black uppercase tracking-widest hover:bg-indigo-400 transition shadow-lg active:scale-95 flex justify-center items-center gap-2 relative z-10"
          >
            <Download className="w-4 h-4" /> DESCARGAR PACK EXCEL
          </button>
        </div>
      </div>
    </div>
  );
};
