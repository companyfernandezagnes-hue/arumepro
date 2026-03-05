import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, 
  Package, 
  Wallet, 
  ChefHat, 
  Users, 
  History,
  Settings,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  AlertCircle,
  X,
  Download,
  RefreshCw,
  FileText,
  Truck,
  Scale,
  Zap,
  Building2,
  PieChart,
  Lock,
  Handshake,
  Import
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { fetchArumeData, saveArumeData, supabase } from './services/supabase';
import { ArumeEngine, Num } from './services/engine';
import { cn } from './lib/utils';
import { AppData, Cierre } from './types';
import { CashView } from './components/CashView';
import { ImportView } from './components/ImportView';
import { InvoicesView } from './components/InvoicesView';
import { AlbaranesView } from './components/AlbaranesView';
import { TesoreriaView } from './components/TesoreriaView';
import { LiquidacionesView } from './components/LiquidacionesView';
import { BancoView } from './components/BancoView';
import { FixedExpensesView } from './components/FixedExpensesView';
import { ReportsView } from './components/ReportsView';
import { MenuView } from './components/MenuView';
import { CierreContableView } from './components/CierreContableView';
import { StockView } from './components/StockView';
import { NotificationService } from './services/notifications';

import { DashboardView } from './components/DashboardView';
import { NavButton } from './components/NavButton';
import { SettingsModal } from './components/SettingsModal';

// --- Main App ---

export default function App() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [db, setDb] = useState<AppData | null>(null);

  // Realtime Subscription
  useEffect(() => {
    const channel = supabase.channel('arume-data')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'arume_data' }, payload => {
        console.log('🔄 Cambio detectado desde n8n!', payload);
        setDb(payload.new.data);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const cloudData = await fetchArumeData();
        let finalData = cloudData || {};

        // Inicializar estructuras si no existen
        const keys = ['banco','platos','recetas','ingredientes','ventas_menu','cierres','facturas','albaranes','gastos_fijos','activos','proveedores','cierres_mensuales'];
        keys.forEach(k => { if(!finalData[k]) finalData[k] = []; });
        if(!finalData.diario) finalData.diario = [];
        if(!finalData.control_pagos) finalData.control_pagos = {};
        if(!finalData.priceHistory) finalData.priceHistory = {};

        // Auto-migración Gastos Fijos
        if (finalData.gastos_fijos) {
          finalData.gastos_fijos.forEach((g: any) => {
            if (!g.dia_pago) g.dia_pago = 1;
            if (!g.name) g.name = "⚠️ (Sin Nombre)";
            if (g.active === undefined) g.active = true;
            if (!g.cat) g.cat = "varios";
          });
        }

        if(!finalData.config) finalData.config = { 
          objetivoMensual: 40000,
          n8nUrlBanco: "https://ia.permatunnelopen.org/webhook/1085406f-324c-42f7-b50f-22f211f445cd",
          n8nUrlIA: ""
        };
        if(!finalData.config.n8nUrlBanco) {
          finalData.config.n8nUrlBanco = "https://ia.permatunnelopen.org/webhook/1085406f-324c-42f7-b50f-22f211f445cd";
        }
        if(finalData.config.n8nUrlIA === undefined) {
          finalData.config.n8nUrlIA = "";
        }

        // Auto-migración (Lógica de tu app.js)
        if (finalData.diario.length > 0) {
          finalData.diario.forEach((old: any) => {
            let isoDate = old.date || old.fecha;
            if(isoDate && isoDate.includes('/')) {
              const [d,m,y] = isoDate.split('/');
              isoDate = `${y.length===2?'20'+y:y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
            }
            const totalOld = Num.parse(old.totalVenta || old.total || 0);
            const exists = finalData.cierres.some((c: any) => c.date === isoDate && Math.abs(Num.parse(c.totalVenta) - totalOld) < 1);
            if (!exists && isoDate) {
              finalData.cierres.push({
                id: old.id || `mig-${Date.now()}-${Math.random()}`,
                date: isoDate,
                totalVenta: totalOld,
                efectivo: Num.parse(old.totalCaja || old.cash || 0),
                tarjeta: Num.parse(old.totalTarjeta || old.card || 0),
                apps: Num.parse(old.glovo || 0) + Num.parse(old.uber || 0),
                tickets: parseInt(old.tickets || 0),
                conciliado_banco: false
              });
            }
          });
        }

        setDb(finalData);
      } catch (e) {
        console.error("Error cargando datos:", e);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const handleSave = async (newData: AppData) => {
    try {
      await saveArumeData(newData);
      setDb({ ...newData, lastSync: Date.now() });
    } catch (e) {
      console.error("Error guardando:", e);
    }
  };

  const renderContent = () => {
    if (!db) return null;
    switch (activeTab) {
      case 'dashboard': return <DashboardView data={db} />;
      case 'diario': return <CashView data={db} onSave={handleSave} />;
      case 'importador': return <ImportView data={db} onSave={handleSave} onNavigate={setActiveTab} />;
      case 'facturas': return <InvoicesView data={db} onSave={handleSave} />;
      case 'albaranes': return <AlbaranesView data={db} onSave={handleSave} />;
      case 'tesoreria': return <TesoreriaView data={db} onSave={handleSave} />;
      case 'liquidez': return <LiquidacionesView data={db} onSave={handleSave} />;
      case 'banco': return <BancoView data={db} onSave={handleSave} />;
      case 'fixed': return <FixedExpensesView data={db} onSave={handleSave} />;
      case 'informes': return <ReportsView db={db} />;
      case 'menus': return <MenuView db={db} onSave={handleSave} />;
      case 'cierre': return <CierreContableView data={db} onSave={handleSave} />;
      case 'stock': return <StockView data={db} onSave={handleSave} />;
      default: return (
        <div className="p-20 text-center space-y-4 animate-fade-in">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
            <Zap className="w-8 h-8 text-slate-300" />
          </div>
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Módulo en Construcción</p>
            <p className="text-[10px] text-slate-300 font-bold uppercase mt-1">Estamos migrando {activeTab} a React</p>
          </div>
        </div>
      );
    }
  };

  return (
    <>
      <AnimatePresence>
        {loading && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/90 z-[9999] flex flex-col justify-center items-center"
          >
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="font-black text-slate-400 animate-pulse uppercase text-[10px] tracking-widest">Sincronizando Cerebro...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Header */}
      <header className="mobile-header sticky top-0 z-40 px-6 py-4 flex justify-between items-center bg-white border-b border-slate-200 shadow-sm lg:hidden">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tighter">ARUME <span className="text-indigo-600">PRO</span></h1>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Diamond Connected</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setIsConfigOpen(true)} className="btn-rueda w-10 h-10 flex items-center justify-center bg-slate-50 rounded-full text-lg border border-slate-100 shadow-sm">
            ⚙️
          </button>
          <div className="bg-slate-100 px-3 py-1.5 rounded-full text-[10px] font-black text-slate-600 border border-slate-200 uppercase">
            Gerencia
          </div>
        </div>
      </header>

      {/* PC Header */}
      <div className="pc-header-visible hidden lg:flex">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tighter">ARUME <span className="text-indigo-600">ERP</span></h1>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Panel de Control Integral</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-white px-4 py-2 rounded-full text-[11px] font-black text-emerald-600 border border-emerald-100 shadow-sm uppercase flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Online
          </div>
          <button onClick={() => setIsConfigOpen(true)} className="btn-rueda w-12 h-12 flex items-center justify-center bg-white rounded-full text-xl border border-slate-100 shadow-md">
            ⚙️
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div id="app-root-container">
        <main className="animate-fade-in">
          {renderContent()}
        </main>

        {/* Navbar - Replicando los 12 botones de tu app.js */}
        <nav id="navbar-container">
          <div className="flex items-center justify-between w-full overflow-x-auto gap-4 px-6 py-3 no-scrollbar">
            <NavButton icon={LayoutDashboard} label="Dash" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <NavButton icon={Wallet} label="Diar" active={activeTab === 'diario'} onClick={() => setActiveTab('diario')} />
            <NavButton icon={Import} label="Impo" active={activeTab === 'importador'} onClick={() => setActiveTab('importador')} />
            <NavButton icon={FileText} label="Fact" active={activeTab === 'facturas'} onClick={() => setActiveTab('facturas')} />
            <div className="w-px h-6 bg-slate-200 shrink-0" />
            <NavButton icon={Truck} label="Alba" active={activeTab === 'albaranes'} onClick={() => setActiveTab('albaranes')} />
            <NavButton icon={TrendingUp} label="Teso" active={activeTab === 'tesoreria'} onClick={() => setActiveTab('tesoreria')} />
            <NavButton icon={Scale} label="Liqu" active={activeTab === 'liquidez'} onClick={() => setActiveTab('liquidez')} />
            <NavButton icon={Building2} label="Banc" active={activeTab === 'banco'} onClick={() => setActiveTab('banco')} />
            <NavButton icon={Zap} label="Fijo" active={activeTab === 'fixed'} onClick={() => setActiveTab('fixed')} />
            <div className="w-px h-6 bg-slate-200 shrink-0" />
            <NavButton icon={PieChart} label="Info" active={activeTab === 'informes'} onClick={() => setActiveTab('informes')} />
            <NavButton icon={ChefHat} label="Menu" active={activeTab === 'menus'} onClick={() => setActiveTab('menus')} />
            <NavButton icon={Package} label="Stoc" active={activeTab === 'stock'} onClick={() => setActiveTab('stock')} />
            <NavButton icon={Lock} label="Cier" active={activeTab === 'cierre'} onClick={() => setActiveTab('cierre')} />
          </div>
        </nav>
      </div>

      <SettingsModal 
        isOpen={isConfigOpen} 
        onClose={() => setIsConfigOpen(false)} 
        db={db} 
        setDb={setDb} 
        onSave={handleSave} 
      />
    </>
  );
}
