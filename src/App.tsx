import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, Package, Wallet, ChefHat, Users, Settings, Search,
  TrendingUp, AlertCircle, X, Download, RefreshCw, FileText, Truck, 
  Scale, Zap, Building2, PieChart, Lock, Import, Sparkles, WifiOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// 🚀 SERVICIOS Y HOOKS
import { supabase } from './services/supabase';
import { useArumeData } from './hooks/useArumeData';
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

const jsonSafeClone = <T,>(obj: T): T => { try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; } };

/* =======================================================
 * 🧭 1. BUSCADOR RÁPIDO (CMD + K)
 * ======================================================= */
type CmdItem<T extends string> = { key: T; label: string; group?: string; icon?: any };

function CommandPalette<T extends string>({ open, onClose, items, onSelect }: { open: boolean, onClose: ()=>void, items: CmdItem<T>[], onSelect: (k:T)=>void }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return items;
    return items.filter(i => i.label.toLowerCase().includes(qq));
  }, [q, items]);

  useEffect(() => { if (open) setQ(''); }, [open]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] flex justify-center items-start pt-[15vh] px-4" aria-modal="true" role="dialog">
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-label="Cerrar" className="absolute inset-0 w-full h-full bg-slate-900/40 backdrop-blur-sm cursor-default border-none outline-none" onClick={onClose} />
        <motion.div initial={{ y: -20, scale: 0.95, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} className="relative w-full max-w-xl rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden z-10">
          <div className="p-4 border-b border-slate-100 flex items-center gap-3">
            <Search className="w-6 h-6 text-indigo-500" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar módulo (Ej: Facturas...)" className="flex-1 outline-none text-xl font-black text-slate-800 placeholder-slate-300" onKeyDown={(e) => { if (e.key === 'Enter' && filtered.length > 0) onSelect(filtered[0].key); if (e.key === 'Escape') onClose(); }} />
            <button onClick={onClose} className="p-2 bg-slate-100 text-slate-400 rounded-xl hover:bg-rose-50 hover:text-rose-500 transition"><X className="w-4 h-4"/></button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-3 custom-scrollbar">
            {filtered.length === 0 && <p className="text-sm font-bold text-slate-400 px-4 py-8 text-center">No se encontraron módulos.</p>}
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {filtered.map((i) => {
                const Icon = i.icon;
                return (
                  <li key={i.key}>
                    <button className="w-full text-left px-4 py-4 rounded-2xl text-sm font-black text-slate-600 bg-slate-50 border border-slate-100 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-all flex items-center justify-between group shadow-sm" onClick={() => onSelect(i.key)}>
                      <div className="flex items-center gap-3">
                        {Icon && <Icon className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />}
                        {i.label}
                      </div>
                      {i.group && <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest bg-white px-2 py-1 rounded-md border border-slate-100 group-hover:border-indigo-100">{i.group}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

/* =======================================================
 * 📱 2. HOOK SWIPE UP (Móviles)
 * ======================================================= */
function useSwipeUpToReveal(onReveal: () => void) {
  const startY = useRef(0);
  useEffect(() => {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    const onTouchStart = (e: TouchEvent) => {
      if (!e.touches.length) return;
      const y = e.touches[0].clientY;
      if (window.innerHeight - y <= 40) startY.current = y;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === 0) return;
      const y = e.touches[0].clientY;
      if (startY.current - y >= 30) {
        onReveal();
        startY.current = 0;
      }
    };
    const onTouchEnd = () => { startY.current = 0; };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [onReveal]);
}

/* =======================================================
 * 🚀 3. EL DOCK ESTILO MAC (Auto Hide)
 * ======================================================= */
type DockItemDef<T extends string> = { key: T; label: string; icon: any; group?: 'main'|'fin'|'ops'; };

function AutoHideDock<T extends string>({ items, activeKey, onChange, isOffline, isSyncing }: { items: DockItemDef<T>[], activeKey: T, onChange: (k:T)=>void, isOffline?: boolean, isSyncing?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [hoveringDock, setHoveringDock] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const handleShow = useCallback(() => {
    setVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => { if (!hoveringDock) setVisible(false); }, 3000);
  }, [hoveringDock]);

  // Hover inferior
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => { if (window.innerHeight - e.clientY <= 30) handleShow(); };
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [handleShow]);

  // Swipe móvil
  useSwipeUpToReveal(handleShow);

  // Tecla D
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!isTyping && e.key.toLowerCase() === 'd') setVisible(v => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => { if (!hoveringDock) setVisible(false); }, 2500);
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [visible, hoveringDock]);

  const groups = useMemo(() => ({
    main: items.filter(i => (i.group ?? 'main') === 'main'), fin: items.filter(i => i.group === 'fin'), ops: items.filter(i => i.group === 'ops'),
  }), [items]);

  return (
    <>
      <AnimatePresence>
        {!visible && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed bottom-2 left-1/2 -translate-x-1/2 w-16 h-1.5 rounded-full bg-slate-300/60 z-[119] pointer-events-none" />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visible && (
          <motion.nav
            initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-[120] px-4 pb-4 pt-10 flex justify-center"
            onMouseEnter={() => setHoveringDock(true)} onMouseLeave={() => { setHoveringDock(false); handleShow(); }}
          >
            <div className="bg-white/90 backdrop-blur-xl border border-slate-200/50 shadow-2xl rounded-[2rem] p-3 max-w-full overflow-x-auto">
              <div className="flex items-center gap-1.5 no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
                {groups.main.map(it => <DockButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
                <div className="w-px h-8 bg-slate-200 mx-2 shrink-0" />
                {groups.fin.map(it => <DockButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
                <div className="w-px h-8 bg-slate-200 mx-2 shrink-0" />
                {groups.ops.map(it => <DockButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
              </div>
              <div className="mt-3 flex items-center justify-center gap-3">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-3 py-1 rounded-lg">Busca rápido con <kbd className="font-sans text-indigo-500">⌘ K</kbd></span>
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}

function DockButton<T extends string>({ item, active, onClick }: { item: DockItemDef<T>, active: boolean, onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button type="button" onClick={onClick} className={cn("min-w-[64px] h-14 px-3 rounded-2xl border text-[10px] font-black uppercase tracking-wider flex flex-col items-center justify-center gap-1 transition active:scale-95 shrink-0", active ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-500 border-slate-100 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100")}>
      <Icon className={cn("w-5 h-5", active ? "text-white" : "")} />
      <span className="hidden sm:block">{item.label}</span>
    </button>
  );
}

/* =======================================================
 * 🏗️ 4. COMPONENTE APP PRINCIPAL
 * ======================================================= */
export default function App() {
  const { data: db, loading, saveData, setData, reloadData } = useArumeData();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  
  const [isCmdOpen, setIsCmdOpen] = useState(false);

  useEffect(() => {
    const onOnline = () => setIsOffline(false); const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  useEffect(() => {
    const channel = supabase.channel('arume-changes', { config: { broadcast: { self: false } } }).on('postgres_changes', { event: '*', schema: 'public', table: 'arume_data' }, () => { reloadData(); }).subscribe();
    return () => { try { supabase.removeChannel(channel); } catch { /* noop */ } };
  }, [reloadData]);

  const REQUIRED: (keyof AppData)[] = ['banco','platos','recetas','ingredientes','ventas_menu','cierres','facturas','albaranes','gastos_fijos'];
  useEffect(() => {
    if (!db || Object.keys(db).length === 0) return;
    const next = jsonSafeClone(db); let changed = false;
    for (const k of REQUIRED) { if (!Array.isArray(next[k])) { (next as any)[k] = []; changed = true; } }
    if (!next.config) { next.config = { objetivoMensual: 45000, n8nUrlBanco: "", n8nUrlIA: "" }; changed = true; }
    if (changed) setData(next);
  }, [db, setData]);

  const isSyncingRef = useRef(false);
  const lastPayloadRef = useRef<AppData | null>(null);

  const handleSave = useCallback(async (newData: AppData) => {
    lastPayloadRef.current = jsonSafeClone(newData);
    if (isSyncingRef.current) return;
    isSyncingRef.current = true; setIsSyncing(true);
    try {
      while (lastPayloadRef.current) {
        const payload = lastPayloadRef.current; lastPayloadRef.current = null;
        setData(payload); 
        localStorage.setItem('arume_backup_last', JSON.stringify(payload)); 
        if (!isOffline) await saveData(payload); 
      }
    } catch (error) { console.error("Error crítico al guardar:", error); } 
    finally { isSyncingRef.current = false; setIsSyncing(false); }
  }, [saveData, setData, isOffline]);

  // ⌨️ ATAJO BUSCADOR (Ctrl+K)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setIsCmdOpen(v => !v); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const navItems = useMemo<DockItemDef<TabKey>[]>(() => ([
    { key: 'dashboard',  label: 'Dash',       icon: LayoutDashboard, group: 'main' },
    { key: 'ia',         label: 'IA',         icon: Sparkles,        group: 'main' },
    { key: 'diario',     label: 'Caja',       icon: Wallet,          group: 'main' },
    { key: 'importador', label: 'Subir',      icon: Import,          group: 'main' },
    { key: 'facturas',   label: 'Facturas',   icon: FileText,        group: 'fin'  },
    { key: 'albaranes',  label: 'Albaranes',  icon: Truck,           group: 'fin'  },
    { key: 'tesoreria',  label: 'Tesorería',  icon: TrendingUp,      group: 'fin'  },
    { key: 'liquidez',   label: 'Liquidez',   icon: Scale,           group: 'fin'  },
    { key: 'banco',      label: 'Banco',      icon: Building2,       group: 'fin'  },
    { key: 'fixed',      label: 'Fijos',      icon: Zap,             group: 'fin'  },
    { key: 'informes',   label: 'Informes',   icon: PieChart,        group: 'ops'  },
    { key: 'menus',      label: 'Menús',      icon: ChefHat,         group: 'ops'  },
    { key: 'stock',      label: 'Stock',      icon: Package,         group: 'ops'  },
    { key: 'cierre',     label: 'Cierre',     icon: Lock,            group: 'ops'  },
  ]), []);

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

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full mb-4" />
      <p className="text-indigo-400 font-black text-[10px] tracking-[0.3em] uppercase">Arume Cloud Sync...</p>
    </div>
  );

  return (
    <div id="app-root-container" className="min-h-screen bg-[#F8FAFC] flex flex-col font-sans relative overflow-x-hidden">
      
      <header className="sticky top-0 z-[110] bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tighter flex items-center gap-2">
            ARUME <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg text-xs tracking-normal">PRO</span>
          </h1>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{TAB_LABELS[activeTab]}</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button onClick={() => setIsCmdOpen(true)} className="hidden sm:flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200 hover:text-slate-700 transition font-black text-[10px] uppercase tracking-widest">
            <Search className="w-4 h-4" /> Buscar Módulo (⌘K)
          </button>

          {isOffline && (
            <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
               <WifiOff className="w-3 h-3 text-amber-500" />
               <span className="text-[9px] text-amber-600 font-black uppercase">Sin Red</span>
            </div>
          )}
          {isSyncing && !isOffline && <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin" />}
          <button onClick={() => setIsConfigOpen(true)} aria-label="Configuración" className="w-10 h-10 bg-slate-50 border border-slate-200 rounded-full flex items-center justify-center hover:bg-white text-xl shadow-sm transition">
            ⚙️
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15, ease: 'easeOut' }} className="p-4 lg:p-8 max-w-[1600px] mx-auto pb-10">
            {content}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 🚀 EL DOCK INVISIBLE Y EL BUSCADOR (Incrustados para evitar errores de ruta) */}
      <AutoHideDock items={navItems} activeKey={activeTab} onChange={(k) => setActiveTab(k)} isOffline={isOffline} isSyncing={isSyncing} />
      <CommandPalette open={isCmdOpen} onClose={() => setIsCmdOpen(false)} items={navItems.map(n => ({ key: n.key, label: TAB_LABELS[n.key], group: n.group, icon: n.icon }))} onSelect={(key) => { setActiveTab(key); setIsCmdOpen(false); }} />
      <SettingsModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} db={db} setDb={setData} onSave={handleSave} />
    </div>
  );
}
