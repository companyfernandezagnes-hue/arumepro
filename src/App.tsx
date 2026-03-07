import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Package, Wallet, ChefHat, Users, History, Settings, Search,
  ArrowUpRight, ArrowDownRight, TrendingUp, AlertCircle, X, Download, RefreshCw,
  FileText, Truck, Scale, Zap, Building2, PieChart, Lock, Handshake, Import, Database,
  Sparkles 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// 🚀 IMPORTAMOS SUPABASE Y TU HOOK
import { supabase } from './services/supabase';
import { useArumeData } from './hooks/useArumeData';

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
import { DashboardView } from './components/DashboardView';
import { AIConsultant } from './components/AIConsultant'; 
import { NavButton } from './components/NavButton';
import { SettingsModal } from './components/SettingsModal';

/* =======================================================
 * 🛡️ ESCUDO ANTI-FALLOS (Recomendación de Copilot)
 * ======================================================= */
const jsonSafeClone = <T,>(obj: T): T => {
  try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
};

// --- Main App ---
export default function App() {
  // 🚀 CONEXIÓN A BASE DE DATOS
  const { data: db, loading, saveData, setData, reloadData } = useArumeData();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // Control de Scroll dinámico
  useEffect(() => {
    const contenedorPrincipal = document.getElementById('app-root-container');
    if (!contenedorPrincipal) return;

    if (isConfigOpen) {
      contenedorPrincipal.style.overflow = 'hidden'; 
    } else {
      contenedorPrincipal.style.overflow = 'auto';   
    }
  }, [isConfigOpen]);

  // 🚀 Realtime Subscription MEJORADO (Captura INSERT y UPDATE)
  useEffect(() => {
    const channel = supabase.channel('arume-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arume_data' }, payload => {
        console.log('🔄 Cambio detectado en arume_data:', payload.eventType);
        reloadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reloadData]);

  // Auto-migración y setup inicial
  useEffect(() => {
    if (db && !db.config?.n8nUrlBanco) {
      let finalData = { ...db };
      let needsUpdate = false;

      const keys = ['banco','platos','recetas','ingredientes','ventas_menu','cierres','facturas','albaranes','gastos_fijos','activos','proveedores','cierres_mensuales'];
      keys.forEach(k => { if(!finalData[k as keyof AppData]) { (finalData as any)[k] = []; needsUpdate = true; } });
      if(!finalData.diario) { finalData.diario = []; needsUpdate = true; }
      if(!finalData.control_pagos) { finalData.control_pagos = {}; needsUpdate = true; }
      if(!finalData.priceHistory) { finalData.priceHistory = {}; needsUpdate = true; }

      if (finalData.gastos_fijos) {
        finalData.gastos_fijos.forEach((g: any) => {
          if (!g.dia_pago) { g.dia_pago = 1; needsUpdate = true; }
          if (!g.name) { g.name = "⚠️ (Sin Nombre)"; needsUpdate = true; }
          if (g.active === undefined) { g.active = true; needsUpdate = true; }
          if (!g.cat) { g.cat = "varios"; needsUpdate = true; }
        });
      }

      if(!finalData.config) {
        finalData.config = { objetivoMensual: 40000, n8nUrlBanco: "https://ia.permatunnelopen.org/webhook/1085406f-324c-42f7-b50f-22f211f445cd", n8nUrlIA: "" };
        needsUpdate = true;
      }

      if (needsUpdate) {
        setData(finalData);
      }
    }
  }, [db, setData]);

  // 🚀 GUARDADO HÍBRIDO (El corazón que nunca falla)
  const handleSave = async (newData: AppData) => {
    const payload = jsonSafeClone(newData);

    // 1. Guardado Local (Inmediato, tu salvavidas si no hay internet)
    try {
      localStorage.setItem('arume_erp_backup', JSON.stringify(payload));
      setData(payload); // Actualiza la UI visualmente al instante
    } catch (e) {
      console.warn("Aviso: Memoria local llena, pero seguimos intentando la nube.");
    }

    // 2. Guardado en Supabase a través de tu Hook
    try {
      await saveData(payload);
      console.log("✅ Guardado en Supabase OK");
    } catch (e) {
      console.error("❌ Error guardando en Supabase. Se han guardado los datos localmente en tu dispositivo.", e);
      // Opcional: Mostrar un pequeño toast o alerta de que estás offline
    }
  };

  // ⚠️ PANTALLA DE CARGA INICIAL
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center animate-fade-in">
        <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
        <p className="text-slate-500 font-bold animate-pulse tracking-widest uppercase text-sm">Sincronizando Cerebro...</p>
      </div>
    );
  }

  // ⚠️ SI NO HAY DATOS (Pantalla de Restaurar Backup)
  if (!db || Object.keys(db).length === 0) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
        <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-xl mb-6">
          <Database className="w-12 h-12 text-indigo-500" />
        </div>
        <h1 className="text-3xl font-black text-slate-800 mb-2 tracking-tight">Carga tu Contabilidad</h1>
        <p className="text-slate-500 mb-8 max-w-md">La base de datos en la nube está limpia. Por favor, sube tu archivo JSON de copia de seguridad para restaurar Arume ERP.</p>
        
        <label className="bg-indigo-600 text-white px-8 py-4 rounded-full font-black shadow-lg hover:bg-indigo-700 hover:scale-105 transition-all cursor-pointer flex items-center gap-3">
          <Import className="w-5 h-5" />
          RESTAURAR ARCHIVO JSON
          <input 
            type="file" 
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = async (e) => {
                try {
                  const content = e.target?.result as string;
                  const parsed = JSON.parse(content);
                  await handleSave(parsed);
                  alert("¡Base de datos restaurada con éxito en la nube! 🚀");
                  window.location.reload();
                } catch (err) {
                  alert("Error leyendo el archivo JSON.");
                }
              };
              reader.readAsText(file);
            }}
          />
        </label>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <DashboardView data={db} />;
      case 'ia': return <AIConsultant data={db} />; 
      case 'diario': return <CashView data={db} onSave={handleSave} />;
      case 'importador': return <ImportView data={db} onSave={handleSave} onNavigate={setActiveTab} />;
      case 'facturas': return <InvoicesView data={db} onSave={handleSave} />;
      case 'albaranes': return <AlbaranesView data={db} onSave={handleSave} />;
      case 'tesoreria': return <TesoreriaView data={db} onSave={handleSave} />;
      case 'liquidez': return <LiquidacionesView data={db} onSave={handleSave} />;
      case 'banco': return <BancoView data={db} onSave={handleSave} />;
      case 'fixed': return <FixedExpensesView data={db} onSave={handleSave} />;
      case 'informes': return <ReportsView data={db} />;
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
      {/* Mobile Header */}
      <header className="mobile-header sticky top-0 z-[110] px-6 py-4 flex justify-between items-center bg-white border-b border-slate-200 shadow-sm lg:hidden">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tighter">ARUME <span className="text-indigo-600">PRO</span></h1>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Diamond Connected</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setIsConfigOpen(true)} className="btn-rueda w-10 h-10 flex items-center justify-center bg-slate-50 rounded-full text-lg border border-slate-100 shadow-sm cursor-pointer pointer-events-auto">
            ⚙️
          </button>
          <div className="bg-slate-100 px-3 py-1.5 rounded-full text-[10px] font-black text-slate-600 border border-slate-200 uppercase">
            Gerencia
          </div>
        </div>
      </header>

      {/* PC Header */}
      <div className="pc-header-visible hidden lg:flex z-[110]">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tighter">ARUME <span className="text-indigo-600">ERP</span></h1>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Panel de Control Integral</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-white px-4 py-2 rounded-full text-[11px] font-black text-emerald-600 border border-emerald-100 shadow-sm uppercase flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Online
          </div>
          <button onClick={() => setIsConfigOpen(true)} className="btn-rueda w-12 h-12 flex items-center justify-center bg-white rounded-full text-xl border border-slate-100 shadow-md cursor-pointer pointer-events-auto">
            ⚙️
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div id="app-root-container">
        <main className="animate-fade-in">
          {renderContent()}
        </main>

        {/* Navbar */}
        <nav id="navbar-container">
          <div className="flex items-center justify-between w-full overflow-x-auto gap-4 px-6 py-3 no-scrollbar">
            <NavButton icon={LayoutDashboard} label="Dash" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <NavButton icon={Sparkles} label="IA" active={activeTab === 'ia'} onClick={() => setActiveTab('ia')} />
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
        setDb={setData} 
        onSave={handleSave} 
      />
    </>
  );
}
