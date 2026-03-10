import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, Package, Wallet, ChefHat, Users, History, Settings, Search,
  ArrowUpRight, ArrowDownRight, TrendingUp, AlertCircle, X, Download, RefreshCw,
  FileText, Truck, Scale, Zap, Building2, PieChart, Lock, Handshake, Import, Database,
  Sparkles, WifiOff
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

// 🛡️ TIPOS Y CONSTANTES
type TabKey = 
  | 'dashboard' | 'ia' | 'diario' | 'importador' 
  | 'facturas' | 'albaranes' | 'tesoreria' | 'liquidez' 
  | 'banco' | 'fixed' | 'informes' | 'menus' | 'stock' | 'cierre';

const TAB_LABELS: Record<TabKey, string> = {
  dashboard: 'Cuadro de Mando', ia: 'Asistente IA', diario: 'Caja Diaria', importador: 'Importador',
  facturas: 'Facturas', albaranes: 'Albaranes', tesoreria: 'Tesorería', liquidez: 'Liquidez',
  banco: 'Banco', fixed: 'Gastos Fijos', informes: 'Informes', menus: 'Menús', stock: 'Stock', cierre: 'Cierre Contable'
};

// 🛡️ JSON SAFE CLONE
const jsonSafeClone = <T,>(obj: T): T => {
  try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
};

export default function App() {
  const { data: db, loading, saveData, setData, reloadData } = useArumeData();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // 1. 📡 DETECTOR OFFLINE
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  // 2. 🔄 SINCRONIZACIÓN SUPABASE (Reforzada)
  useEffect(() => {
    const channel = supabase
      .channel('arume-changes', { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arume_data' }, () => {
        // console.debug('[Supabase] Sync triggered');
        reloadData();
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED' && status !== 'TIMED_OUT') console.warn('[Supabase] Status:', status);
      });
    return () => { try { supabase.removeChannel(channel); } catch { /* noop */ } };
  }, [reloadData]);

  // 3. 🏗️ SETUP INICIAL (Optimizada sin re-renders fantasma)
  const REQUIRED: (keyof AppData)[] = ['banco','platos','recetas','ingredientes','ventas_menu','cierres','facturas','albaranes','gastos_fijos'];
  useEffect(() => {
    if (!db || Object.keys(db).length === 0) return;
    const next = jsonSafeClone(db);
    let changed = false;
    for (const k of REQUIRED) {
      if (!Array.isArray(next[k])) { (next as any)[k] = []; changed = true; }
    }
    if (!next.config) { next.config = { objetivoMensual: 45000, n8nUrlBanco: "", n8nUrlIA: "" }; changed = true; }
    if (changed) setData(next);
  }, [db, setData]);

  // 4. 💾 GUARDADO MAESTRO (Con Cola de Espera)
  const isSyncingRef = useRef(false);
  const lastPayloadRef = useRef<AppData | null>(null);

  const handleSave = useCallback(async (newData: AppData) => {
    lastPayloadRef.current = jsonSafeClone(newData);
    if (isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    
    try {
      while (lastPayloadRef.current) {
        const payload = lastPayloadRef.current;
        lastPayloadRef.current = null;
        
        setData(payload); // 1. Actualiza UI Inmediatamente
        localStorage.setItem('arume_backup_last', JSON.stringify(payload)); // 2. Blindaje local
        if (!isOffline) await saveData(payload); // 3. A la nube si hay red
      }
    } catch (error) {
      console.error("Error crítico al guardar:", error);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [saveData, setData, isOffline]);

  // 5. 🧠 RENDERIZADO MEMOIZADO
  const content = useMemo(() => {
    const props = { data: db, onSave: handleSave };
    switch (activeTab) {
      case 'dashboard': return <DashboardView data={db} />;
      case 'ia':        return <AIConsultant data={db} />; 
      case 'diario':    return <CashView {...props} />;
      case 'importador':return <ImportView data={db} onSave={handleSave} onNavigate={(tab) => setActiveTab(tab as TabKey)} />;
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
  }, [activeTab, db, handleSave]);

  // --- PANTALLAS DE CARGA ---
  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full mb-4" />
      <p className="text-indigo-400 font-black text-[10px] tracking-[0.3em] uppercase">Arume Cloud Sync...</p>
    </div>
  );

  return (
    <div id="app-root-container" className="min-h-screen bg-[#F8FAFC] flex flex-col font-sans">
      
      {/* HEADER DINÁMICO */}
      <header className="sticky top-0 z-[110] bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tighter flex items-center gap-2">
            ARUME <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg text-xs tracking-normal">PRO</span>
          </h1>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{TAB_LABELS[activeTab]}</p>
        </div>
        
        <div className="flex items-center gap-3">
          {isOffline && (
            <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
               <WifiOff className="w-3 h-3 text-amber-500" />
               <span className="text-[9px] text-amber-600 font-black uppercase">Sin Red</span>
            </div>
          )}
          {isSyncing && !isOffline && <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin" />}
          <button 
            onClick={() => setIsConfigOpen(true)}
            aria-label="Configuración"
            className="w-10 h-10 bg-slate-50 border border-slate-200 rounded-full flex items-center justify-center hover:bg-white text-xl shadow-sm transition"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* ÁREA DE CONTENIDO (Animación suave) */}
      <main className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="p-4 lg:p-8 max-w-[1600px] mx-auto pb-32"
          >
            {content}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* NAVBAR (Con scroll táctil iOS optimizado) */}
      <nav id="navbar-container" className="fixed bottom-0 left-0 right-0 z-[120] bg-white/90 backdrop-blur-xl border-t border-slate-200 flex justify-center items-center">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full px-4 py-3" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* GRUPO PRINCIPAL */}
          <NavButton icon={LayoutDashboard} label="Dash" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} className="min-w-[64px]" />
          <NavButton icon={Sparkles} label="IA" active={activeTab === 'ia'} onClick={() => setActiveTab('ia')} className="min-w-[64px]" />
          <NavButton icon={Wallet} label="Caja" active={activeTab === 'diario'} onClick={() => setActiveTab('diario')} className="min-w-[64px]" />
          <NavButton icon={Import} label="Subir" active={activeTab === 'importador'} onClick={() => setActiveTab('importador')} className="min-w-[64px]" />
          
          <div className="w-px h-6 bg-slate-200 mx-2 shrink-0" />

          {/* GRUPO FINANZAS */}
          <NavButton icon={FileText} label="Factur" active={activeTab === 'facturas'} onClick={() => setActiveTab('facturas')} className="min-w-[64px]" />
          <NavButton icon={Truck} label="Albar" active={activeTab === 'albaranes'} onClick={() => setActiveTab('albaranes')} className="min-w-[64px]" />
          <NavButton icon={TrendingUp} label="Tesor" active={activeTab === 'tesoreria'} onClick={() => setActiveTab('tesoreria')} className="min-w-[64px]" />
          <NavButton icon={Scale} label="Liqui" active={activeTab === 'liquidez'} onClick={() => setActiveTab('liquidez')} className="min-w-[64px]" />
          <NavButton icon={Building2} label="Banco" active={activeTab === 'banco'} onClick={() => setActiveTab('banco')} className="min-w-[64px]" />
          <NavButton icon={Zap} label="Fijos" active={activeTab === 'fixed'} onClick={() => setActiveTab('fixed')} className="min-w-[64px]" />

          <div className="w-px h-6 bg-slate-200 mx-2 shrink-0" />

          {/* GRUPO OPERACIONES */}
          <NavButton icon={PieChart} label="Info" active={activeTab === 'informes'} onClick={() => setActiveTab('informes')} className="min-w-[64px]" />
          <NavButton icon={ChefHat} label="Menu" active={activeTab === 'menus'} onClick={() => setActiveTab('menus')} className="min-w-[64px]" />
          <NavButton icon={Package} label="Stock" active={activeTab === 'stock'} onClick={() => setActiveTab('stock')} className="min-w-[64px]" />
          <NavButton icon={Lock} label="Cierre" active={activeTab === 'cierre'} onClick={() => setActiveTab('cierre')} className="min-w-[64px]" />
        </div>
      </nav>

      <SettingsModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} db={db} setDb={setData} onSave={handleSave} />
    </div>
  );
}
