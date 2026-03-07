import React, { useMemo } from 'react';
import { 
  LayoutDashboard, 
  Wallet, 
  ArrowUpRight, 
  AlertCircle, 
  TrendingUp,
  Building2, 
  Hotel, // Cambiado el icono de Moto por Hotel
  ShoppingBag, 
  Users,
  SplitSquareHorizontal
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { ArumeEngine, Num } from '../services/engine';
import { cn } from '../lib/utils';
import { AppData } from '../types';

type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

// 🚀 NOMBRES ACTUALIZADOS: De "Delivery" a "Catering Hoteles"
const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string; hex: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50', hex: '#4f46e5' },
  { id: 'DLV', name: 'Catering Hoteles', icon: Hotel, color: 'text-amber-600', bg: 'bg-amber-50', hex: '#f59e0b' },
  { id: 'SHOP', name: 'Tienda & Sakes', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50', hex: '#10b981' },
  { id: 'CORP', name: 'Bloque Socios', icon: Users, color: 'text-slate-600', bg: 'bg-slate-100', hex: '#475569' },
];

export const DashboardView = ({ data }: { data: AppData }) => {
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  const stats = useMemo(() => ArumeEngine.getProfit(data, currentMonth, currentYear), [data, currentMonth, currentYear]);
  
  const chartData = useMemo(() => {
    return (data.cierres || []).slice(-7).map((c: any) => ({
      name: new Date(c.date).toLocaleDateString('es-ES', { weekday: 'short' }),
      venta: Num.parse(c.totalVenta)
    }));
  }, [data.cierres]);

  // 🚀 LÓGICA CRÍTICA REESCRITA PARA EL MODELO B2B (HOTELES)
  const unitBreakdown = useMemo(() => {
    const breakdown: Record<string, { income: number; expenses: number; profit: number }> = {
      REST: { income: 0, expenses: 0, profit: 0 },
      DLV: { income: 0, expenses: 0, profit: 0 },
      SHOP: { income: 0, expenses: 0, profit: 0 },
      CORP: { income: 0, expenses: 0, profit: 0 },
    };

    // 1. INGRESOS RESTAURANTE Y TIENDA (Vienen de los Cierres Z)
    (data.cierres || []).forEach((c: any) => {
      const d = new Date(c.date);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const unit = c.unidad_negocio || 'REST'; 
        if (breakdown[unit] && unit !== 'DLV') { // Ignoramos DLV aquí por seguridad
          breakdown[unit].income += Num.parse(c.totalVenta);
        }
      }
    });

    // 2. INGRESOS HOTELES (Vienen de Facturas Emitidas a Clientes)
    (data.facturas || []).forEach((f: any) => {
      const d = new Date(f.date);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        // Solo sumamos como ingreso si la factura es del bloque de Hoteles y es a un Cliente (no a un proveedor)
        if (f.unidad_negocio === 'DLV' && Num.parse(f.total) > 0 && f.cliente && f.cliente !== 'Z DIARIO') {
          breakdown['DLV'].income += Num.parse(f.total);
        }
      }
    });

    // 3. GASTOS VARIABLES (Albaranes de compras a proveedores)
    (data.albaranes || []).forEach((a: any) => {
      const d = new Date(a.date);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const unit = a.unidad_negocio || 'REST';
        if (breakdown[unit]) breakdown[unit].expenses += Num.parse(a.total);
      }
    });

    // 4. GASTOS FIJOS (Nóminas, alquileres, software divididos por bloque)
    const currentMonthKey = `pagos_${currentYear}_${currentMonth + 1}`;
    const pagadosIds = (data.control_pagos || {})[currentMonthKey] || [];
    
    (data.gastos_fijos || []).forEach((g: any) => {
      if (g.active !== false && pagadosIds.includes(g.id)) {
        const unit = g.unitId || 'REST';
        const amount = parseFloat(g.amount as any) || 0;
        let mensual = amount;
        if (g.freq === 'anual') mensual = amount / 12;
        if (g.freq === 'trimestral') mensual = amount / 3;
        
        if (breakdown[unit]) breakdown[unit].expenses += mensual;
      }
    });

    // 5. CALCULAR BENEFICIO NETO
    Object.keys(breakdown).forEach(k => {
      breakdown[k].profit = breakdown[k].income - breakdown[k].expenses;
    });

    return breakdown;
  }, [data.cierres, data.albaranes, data.facturas, data.gastos_fijos, data.control_pagos, currentMonth, currentYear]);

  return (
    <div className="space-y-6 animate-fade-in pb-24">
      {/* 🚀 BANNER MULTI-LOCAL */}
      <div className="bg-slate-900 p-6 rounded-[2.5rem] flex items-center justify-between shadow-xl text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <SplitSquareHorizontal className="w-32 h-32" />
        </div>
        <div className="relative z-10">
          <h2 className="text-xl font-black tracking-tight">Consolidado del Grupo</h2>
          <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest mt-1">Viendo métricas de todas las unidades de negocio</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Ingresos Mes</p>
          <h3 className="text-xl font-black text-slate-800">{Num.fmt(stats.ingresos.total)}</h3>
          <div className="flex items-center text-emerald-500 text-[10px] font-bold mt-1">
            <ArrowUpRight className="w-3 h-3 mr-1" /> +{stats.ratios.primeCost.toFixed(1)}% Prime
          </div>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Gastos Totales</p>
          <h3 className="text-xl font-black text-slate-800">{Num.fmt(stats.gastos.total)}</h3>
          <p className="text-[10px] text-slate-400 font-bold mt-1">Operativo mensual</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Beneficio Neto</p>
          <h3 className={cn("text-xl font-black", stats.neto >= 0 ? "text-emerald-600" : "text-rose-600")}>
            {Num.fmt(stats.neto)}
          </h3>
          <p className="text-[10px] text-slate-400 font-bold mt-1">EBITDA estimado</p>
        </div>
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Food Cost</p>
          <h3 className="text-xl font-black text-slate-800">{stats.ratios.foodCost.toFixed(1)}%</h3>
          <p className="text-[10px] text-indigo-500 font-bold mt-1">Objetivo: 28%</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Ventas Últimos 7 Días (Restaurante y Tienda)</h3>
        </div>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorVenta" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 800}} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 800}} tickFormatter={(v) => `${v}€`} />
              <Tooltip contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 800}} />
              <Area type="monotone" dataKey="venta" stroke="#4f46e5" strokeWidth={4} fillOpacity={1} fill="url(#colorVenta)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Desglose de Gastos Clásico */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">Desglose Global Gastos</h3>
          <div className="space-y-4">
            {[
              { label: 'Comida', val: stats.gastos.comida, color: 'bg-amber-500' },
              { label: 'Bebida', val: stats.gastos.bebida, color: 'bg-blue-500' },
              { label: 'Personal', val: stats.gastos.personal, color: 'bg-indigo-500' },
              { label: 'Estructura', val: stats.gastos.estructura, color: 'bg-slate-500' }
            ].map(g => (
              <div key={g.label} className="space-y-1">
                <div className="flex justify-between text-[10px] font-black uppercase">
                  <span className="text-slate-600">{g.label}</span>
                  <span className="text-slate-900">{Num.fmt(g.val)}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={cn("h-full rounded-full transition-all duration-500", g.color)} 
                    style={{ width: `${stats.gastos.total ? (g.val / stats.gastos.total) * 100 : 0}%` }} 
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 🚀 NUEVO: Rendimiento por Unidad (Multi-Local) */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-amber-500 to-emerald-500"></div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">Rentabilidad por Unidad</h3>
          <div className="space-y-5">
            {BUSINESS_UNITS.map(unit => {
              const uStat = unitBreakdown[unit.id] || { income: 0, expenses: 0, profit: 0 };
              const maxIncome = Math.max(...Object.values(unitBreakdown).map(u => u.income), 1);
              
              return (
                <div key={unit.id} className="group">
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={cn("p-2 rounded-xl", unit.bg)}>
                        <unit.icon className={cn("w-3 h-3", unit.color)} />
                      </div>
                      <span className="text-[10px] font-black text-slate-700 uppercase">{unit.name}</span>
                    </div>
                    <div className="text-right">
                      <span className={cn("text-sm font-black", uStat.profit >= 0 ? "text-emerald-600" : "text-rose-600")}>
                        {Num.fmt(uStat.profit)}
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                    <div 
                      className="h-full transition-all duration-1000" 
                      style={{ 
                        width: `${(uStat.income / maxIncome) * 100}%`, 
                        backgroundColor: unit.hex 
                      }} 
                    />
                  </div>
                  <p className="text-[8px] font-bold text-slate-400 mt-1 flex justify-between">
                    <span>Ingresos: {Num.fmt(uStat.income)}</span>
                    <span className="text-rose-400">Gastos: {Num.fmt(uStat.expenses)}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Alertas del Sistema */}
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">Alertas de Sistema</h3>
          <div className="space-y-3">
            {data.ingredientes.filter(i => i.stock <= i.min).slice(0, 3).map(ing => (
              <div key={ing.id} className="flex items-center gap-3 p-3 bg-rose-50 rounded-2xl border border-rose-100">
                <AlertCircle className="w-4 h-4 text-rose-500" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-rose-900">{ing.n}</p>
                  <p className="text-[9px] text-rose-400 font-black uppercase">Stock crítico: {ing.stock} {ing.unit}</p>
                </div>
              </div>
            ))}
            {data.facturas.filter((f: any) => !f.paid).length > 0 && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-2xl border border-amber-100">
                <Wallet className="w-4 h-4 text-amber-500" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-amber-900">Facturas Pendientes</p>
                  <p className="text-[9px] text-amber-400 font-black uppercase">{data.facturas.filter((f: any) => !f.paid).length} facturas por pagar</p>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
