import React, { useState, useEffect, useCallback } from 'react';
import { 
  LayoutDashboard, Package, Wallet, ChefHat, Users, History, Settings, Search,
  ArrowUpRight, ArrowDownRight, TrendingUp, AlertCircle, X, Download, RefreshCw,
  FileText, Truck, Scale, Zap, Building2, PieChart, Lock, Handshake, Import, Database,
  Sparkles 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// 🚀 SERVICIOS Y HOOKS
import { supabase } from './services/supabase';
import { useArumeData } from './hooks/useArumeData';
import { ArumeEngine, Num } from './services/engine';
import { cn } from './lib/utils';
import { AppData } from './types';

// 📄 COMPONENTES (Vistas)
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

const jsonSafeClone = <T,>(obj: T): T => {
  try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
};

export default function App() {
  const { data: db, loading, saveData, setData, reloadData } = useArumeData();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // 1. Sincronización Supabase
  useEffect(() => {
    const channel = supabase.channel('arume-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arume_data' }, () => reloadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reloadData]);

  // 2. Setup Inicial
  useEffect(() => {
    if (db && Object.keys(db).length > 0) {
      let finalData = jsonSafeClone(db);
      let needsUpdate = false;
      const collections: (keyof AppData)[] = [
        'banco', 'platos', 'recetas', 'ingredientes', 'ventas_menu', 
        'cierres', 'facturas', 'albaranes', 'gastos_fijos'
      ];
      collections.forEach(key => {
        if (!finalData[key] || !Array.isArray(finalData[key])) {
          (finalData as any)[key] = [];
          needsUpdate = true;
        }
      });
      if (needsUpdate) setData(finalData);
    }
  }, [db, setData]);

  // 3. Guardado Híbrido
  const handleSave = useCallback(async (newData: AppData) => {
    if (isSyncing) return;
    setIsSyncing(true);
    const payload = jsonSafeClone(newData);
    try {
      setData(payload);
      localStorage.setItem('arume_backup_last', JSON.stringify(payload));
      await saveData(payload);
    } catch (error) { console.error("Error al guardar:", error); }
    finally { setIsSyncing(false); }
  }, [isSyncing, saveData, setData]);

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full mb-4" />
      <p className="text-indigo-400 font-black text-[10px] tracking-[0.3em] uppercase">Arume Cloud Sync...</p>
    </div>
  );

  // 4. RENDERIZADO
  const renderContent = () => {
    const props = { data: db, onSave: handleSave };
    switch (activeTab) {
      case 'dashboard': return <DashboardView data={db} />;
      case 'ia':        return <AIConsultant data={db} />; 
      case 'diario':    return <CashView {...props} />;
      case 'importador':return <ImportView data={db} onSave={handleSave} onNavigate={setActiveTab} />;
      case 'facturas':  return <InvoicesView {...props} />;
      case 'albaranes': return <AlbaranesView {...props} />;
      case 'tesoreria': return <TesoreriaView {...props} />;
      case 'liquidez':  return <LiquidacionesView {...props} />;
      case 'banco':     return <BancoView {...props} />;
      case 'fixed':     return <FixedExpensesView {...props} />;
      case 'informes':  return <ReportsView data={db} />;
      case 'menus':     return <MenuView db={db} onSave={handleSave} />;
      case 'stock':     return <StockView {...props} />;
      case 'cierre':    return <CierreContableView {...props} />;
      default:          return <DashboardView data={db} />;
    }
  };

  return (
    <div id="app-root-container" className="min-h-screen bg-[#F8FAFC] flex flex-col font-sans">
      
      {/* HEADER DINÁMICO */}
      <header className="sticky top-0 z-[110] bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tighter flex items-center gap-2">
            ARUME <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg text-xs tracking-normal">PRO</span>
          </h1>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{activeTab} system</p>
        </div>
        <div className="flex items-center gap-3">
          {isSyncing && <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin" />}
          <button onClick={() => setIsConfigOpen(true)} className="w-10 h-10 bg-slate-50 border border-slate-200 rounded-full flex items-center justify-center hover:bg-white text-xl">⚙️</button>
        </div>
      </header>

      {/* ÁREA DE CONTENIDO */}
      <main className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="p-4 lg:p-8 max-w-[1600px] mx-auto pb-32"
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 🔵 NAVBAR COMPLETA */}
      <nav id="navbar-container" className="fixed bottom-0 left-0 right-0 z-[120] bg-white/90 backdrop-blur-xl border-t border-slate-200 flex justify-center items-center">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full px-4 py-3">
          {/* GRUPO PRINCIPAL */}
          <NavButton icon={LayoutDashboard} label="Dash" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavButton icon={Sparkles} label="IA" active={activeTab === 'ia'} onClick={() => setActiveTab('ia')} />
          <NavButton icon={Wallet} label="Caja" active={activeTab === 'diario'} onClick={() => setActiveTab('diario')} />
          <NavButton icon={Import} label="Subir" active={activeTab === 'importador'} onClick={() => setActiveTab('importador')} />
          
          <div className="w-px h-6 bg-slate-200 mx-2 shrink-0" />

          {/* GRUPO FINANZAS */}
          <NavButton icon={FileText} label="Factur" active={activeTab === 'facturas'} onClick={() => setActiveTab('facturas')} />
          <NavButton icon={Truck} label="Albar" active={activeTab === 'albaranes'} onClick={() => setActiveTab('albaranes')} />
          <NavButton icon={TrendingUp} label="Tesor" active={activeTab === 'tesoreria'} onClick={() => setActiveTab('tesoreria')} />
          <NavButton icon={Scale} label="Liqui" active={activeTab === 'liquidez'} onClick={() => setActiveTab('liquidez')} />
          <NavButton icon={Building2} label="Banco" active={activeTab === 'banco'} onClick={() => setActiveTab('banco')} />
          <NavButton icon={Zap} label="Fijos" active={activeTab === 'fixed'} onClick={() => setActiveTab('fixed')} />

          <div className="w-px h-6 bg-slate-200 mx-2 shrink-0" />

          {/* GRUPO OPERACIONES */}
          <NavButton icon={PieChart} label="Info" active={activeTab === 'informes'} onClick={() => setActiveTab('informes')} />
          <NavButton icon={ChefHat} label="Menu" active={activeTab === 'menus'} onClick={() => setActiveTab('menus')} />
          <NavButton icon={Package} label="Stock" active={activeTab === 'stock'} onClick={() => setActiveTab('stock')} />
          <NavButton icon={Lock} label="Cierre" active={activeTab === 'cierre'} onClick={() => setActiveTab('cierre')} />
        </div>
      </nav>

      <SettingsModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} db={db} setDb={setData} onSave={handleSave} />
    </div>
  );
}
