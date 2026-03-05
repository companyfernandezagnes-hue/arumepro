import React, { useMemo } from 'react';
import { 
  LayoutDashboard, 
  Wallet, 
  ArrowUpRight, 
  AlertCircle, 
  TrendingUp 
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

export const DashboardView = ({ data }: { data: AppData }) => {
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  const stats = useMemo(() => ArumeEngine.getProfit(data, currentMonth, currentYear), [data, currentMonth, currentYear]);
  
  const chartData = useMemo(() => {
    return (data.cierres || []).slice(-7).map(c => ({
      name: new Date(c.date).toLocaleDateString('es-ES', { weekday: 'short' }),
      venta: Num.parse(c.totalVenta)
    }));
  }, [data.cierres]);

  return (
    <div className="space-y-6 animate-fade-in">
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
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Ventas Últimos 7 Días</h3>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4">Desglose de Gastos</h3>
          <div className="space-y-4">
            {[
              { label: 'Comida', val: stats.gastos.comida, color: 'bg-amber-500' },
              { label: 'Bebida', val: stats.gastos.bebida, color: 'bg-blue-500' },
              { label: 'Personal', val: stats.gastos.personal, color: 'bg-indigo-500' },
              { label: 'Estructura', val: stats.gastos.estructura, color: 'bg-slate-500' }
            ].map(g => (
              <div key={g.label} className="space-y-1">
                <div className="flex justify-between text-[10px] font-black uppercase">
                  <span>{g.label}</span>
                  <span>{Num.fmt(g.val)}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={cn("h-full rounded-full", g.color)} 
                    style={{ width: `${stats.gastos.total ? (g.val / stats.gastos.total) * 100 : 0}%` }} 
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

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
            {data.facturas.filter(f => !f.paid).length > 0 && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-2xl border border-amber-100">
                <Wallet className="w-4 h-4 text-amber-500" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-amber-900">Facturas Pendientes</p>
                  <p className="text-[9px] text-amber-400 font-black uppercase">{data.facturas.filter(f => !f.paid).length} facturas por pagar</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
