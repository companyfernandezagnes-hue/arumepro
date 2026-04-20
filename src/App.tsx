import AuthScreen from './components/AuthScreen';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, Package, Wallet, ChefHat, Users, Settings, Search,
  TrendingUp, X, RefreshCw, FileText, Truck, Scale, Zap, Building2, 
  PieChart, Lock, Import, Sparkles, WifiOff, AlertTriangle, Camera, Loader2,
  Receipt, Megaphone, Maximize, ShoppingBag, BookOpen, Bell, Bot
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// SERVICIOS Y HOOKS
import { supabase } from './services/supabase';
import { useArumeData } from './hooks/useArumeData';
import { cn } from './lib/utils';
import { AppData, FacturaExtended } from './types';
import { scanBase64 } from './services/aiProviders';
import { DateUtil } from './services/engine';
import { toast, ToastRenderer } from './hooks/useToast';
import { ConfirmProvider } from './hooks/useConfirm';
import { PushService } from './services/pushNotifications';
import { ArumeAgent } from './services/arumeAgent';

// COMPONENTES (Vistas) — lazy loaded para evitar imports circulares
const CashView = React.lazy(() => import('./components/CashView').then(m => ({ default: m.CashView })));
const ImportView = React.lazy(() => import('./components/ImportView').then(m => ({ default: m.ImportView })));
const TesoreriaView = React.lazy(() => import('./components/TesoreriaView').then(m => ({ default: m.TesoreriaView })));
const LiquidacionesView = React.lazy(() => import('./components/LiquidacionesView').then(m => ({ default: m.LiquidacionesView })));
const BancoView = React.lazy(() => import('./components/BancoView').then(m => ({ default: m.BancoView })));
const FixedExpensesView = React.lazy(() => import('./components/FixedExpensesView').then(m => ({ default: m.FixedExpensesView })));
const ReportsView = React.lazy(() => import('./components/ReportsView').then(m => ({ default: m.ReportsView })));
const MenuView = React.lazy(() => import('./components/MenuView').then(m => ({ default: m.MenuView })));
const CierreContableView = React.lazy(() => import('./components/CierreContableView').then(m => ({ default: m.CierreContableView })));
const StockView = React.lazy(() => import('./components/StockView').then(m => ({ default: m.StockView })));
const DashboardView = React.lazy(() => import('./components/DashboardView').then(m => ({ default: m.DashboardView })));
const SettingsModal = React.lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
const TelegramWidget = React.lazy(() => import('./components/TelegramWidget').then(m => ({ default: m.TelegramWidget })));

// MÓDULOS MAESTROS — lazy loaded
const ComprasDashboard = React.lazy(() => import('./components/ComprasDashboard').then(m => ({ default: m.ComprasDashboard })));
const MarketingView = React.lazy(() => import('./components/MarketingView').then(m => ({ default: m.MarketingView })));
const ProveedoresView = React.lazy(() => import('./components/ProveedoresView').then(m => ({ default: m.ProveedoresView })));
const PresupuestosView = React.lazy(() => import('./components/PresupuestosView').then(m => ({ default: m.PresupuestosView })));
const ShopView = React.lazy(() => import('./components/ShopView').then(m => ({ default: m.ShopView })));
const AIConsultant = React.lazy(() => import('./components/AIConsultant').then(m => ({ default: m.AIConsultant })));
const CuentasFamiliaresView = React.lazy(() => import('./components/CuentasFamiliaresView').then(m => ({ default: m.CuentasFamiliaresView })));
const LibrosIVAView = React.lazy(() => import('./components/LibrosIVAView').then(m => ({ default: m.LibrosIVAView })));
const BalanceView = React.lazy(() => import('./components/BalanceView').then(m => ({ default: m.BalanceView })));
const NominasView = React.lazy(() => import('./components/NominasView').then(m => ({ default: m.NominasView })));
const NotificacionesView = React.lazy(() => import('./components/NotificacionesView').then(m => ({ default: m.NotificacionesView })));
const AutomatizacionesView = React.lazy(() => import('./components/AutomatizacionesView').then(m => ({ default: m.AutomatizacionesView })));

// TIPOS Y CONSTANTES
type TabKey =
  | 'dashboard' | 'ia' | 'diario' | 'importador'
  | 'compras' | 'facturas' | 'albaranes'
  | 'tesoreria' | 'liquidez' | 'banco' | 'fixed'
  | 'informes' | 'menus' | 'stock' | 'cierre' | 'marketing' | 'proveedores' | 'presupuestos' | 'shop'
  | 'cuentas' | 'librosiva' | 'balance' | 'nominas' | 'notificaciones' | 'agente';

const TAB_LABELS: Record<TabKey, string> = {
  dashboard: 'Dashboard', ia: 'IA', diario: 'Caja Diaria', importador: 'Importador',
  compras: 'Compras', facturas: 'Compras', albaranes: 'Compras',
  tesoreria: 'Tesorería', liquidez: 'Liquidez',
  banco: 'Banco', fixed: 'G. Fijos', informes: 'Informes', menus: 'Menús', stock: 'Stock', cierre: 'Cierre',
  marketing: 'Marketing',
  proveedores: 'Proveedores',
  presupuestos: 'Presupuestos',
  shop: 'Tienda',
  cuentas: 'Cuentas Familia',
  librosiva: 'Libros IVA',
  balance: 'Balance',
  nominas: 'Nóminas',
  notificaciones: 'Notificaciones',
  agente: 'Agente',
};

const jsonSafeClone = <T,>(obj: T): T => { try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; } };

/* =======================================================
 * COMPRESOR DE IMÁGENES
 * ======================================================= */
const compressImageForAI = async (file: File): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  const MAX_W = 1200, MAX_H = 1200; 
  const ratio = Math.min(MAX_W / bitmap.width, MAX_H / bitmap.height, 1);
  
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  
  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx) ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.7));
  
  return new Promise<string>((res) => {
    const reader = new FileReader();
    reader.onload = () => res((reader.result as string).split(',')[1]);
    reader.readAsDataURL(blob);
  });
};

/* =======================================================
 * PARACAÍDAS ANTI-PANTALLAZO AZUL
 * ======================================================= */
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  constructor(props: any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any, info: any) { console.error('UI Crash Interceptado:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-white border border-slate-200 rounded-xl shadow-sm m-4 text-center">
          <AlertTriangle className="w-12 h-12 text-rose-500 mb-3 mx-auto" />
          <h2 className="text-base font-black text-slate-800">Error en este módulo</h2>
          <p className="text-xs text-slate-500 mt-1 mb-4">El resto de la app sigue funcionando. Tus datos están a salvo.</p>
          <div className="flex gap-2 justify-center">
            <button onClick={() => { try { localStorage.removeItem('arume_shadow_backup'); } catch(e){} this.setState({hasError: false}); }} className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-200 transition">Intentar Recuperar</button>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition">Reiniciar App</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* =======================================================
 * 1. BUSCADOR RÁPIDO (CMD + K)
 * ======================================================= */
type CmdItem<T extends string> = { key: T; label: string; group?: string; icon?: any; shortcut?: string; isAction?: boolean; badge?: string };

function CommandPalette<T extends string>({ open, onClose, items, onSelect, onAction }: { open: boolean, onClose: ()=>void, items: CmdItem<T>[], onSelect: (k:T)=>void, onAction: (k:T)=>void }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return items;
    return items.filter(i => i.label.toLowerCase().includes(qq));
  }, [q, items]);

  // Agrupar por grupo si no hay búsqueda activa
  const groupedEntries = useMemo(() => {
    if (q.trim()) return null;
    const order = ['inicio','compras','ventas','dinero','personal','cierres','tienda','marketing','sistema'];
    const labels: Record<string, string> = {
      inicio:'Inicio', compras:'Compras', ventas:'Ventas', dinero:'Dinero',
      personal:'Personal', cierres:'Cierres', tienda:'Tienda',
      marketing:'Marketing', sistema:'Sistema',
    };
    const map: Record<string, CmdItem<T>[]> = {};
    for (const it of filtered) {
      const g = it.group || 'otros';
      (map[g] = map[g] || []).push(it);
    }
    return order
      .filter(k => map[k]?.length)
      .map(k => ({ group: k, label: labels[k] || k, items: map[k] }))
      .concat(
        Object.keys(map)
          .filter(k => !order.includes(k))
          .map(k => ({ group: k, label: labels[k] || k, items: map[k] }))
      );
  }, [q, filtered]);

  useEffect(() => { if (open) setQ(''); }, [open]);
  if (!open) return null;

  const renderItem = (i: CmdItem<T>) => {
    const Icon = i.icon;
    return (
      <button
        className={cn(
          "w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors flex items-center justify-between group",
          i.isAction
            ? "bg-[color:var(--arume-gold)]/10 text-[color:var(--arume-ink)] hover:bg-[color:var(--arume-gold)]/20 border border-[color:var(--arume-gold)]/30"
            : "text-[color:var(--arume-ink)] hover:bg-[color:var(--arume-gray-50)] border border-transparent"
        )}
        onClick={() => i.isAction ? onAction(i.key) : onSelect(i.key)}
      >
        <div className="flex items-center gap-2.5">
          {Icon && <Icon className={cn("w-4 h-4", i.isAction ? "text-[color:var(--arume-gold)]" : "text-[color:var(--arume-gray-400)] group-hover:text-[color:var(--arume-ink)]")} />}
          <span className="font-medium">{i.label}</span>
          {i.badge && (
            <span className="ml-1 px-2 py-0.5 bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] text-[9px] font-bold uppercase tracking-[0.15em] rounded-full">
              {i.badge}
            </span>
          )}
        </div>
        {i.shortcut && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-[color:var(--arume-gray-200)] text-[color:var(--arume-gray-500)] bg-[color:var(--arume-gray-50)]">
            {i.shortcut}
          </span>
        )}
      </button>
    );
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] flex justify-center items-start pt-[10vh] px-4" aria-modal="true" role="dialog">
        <motion.button
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          aria-label="Cerrar"
          className="absolute inset-0 w-full h-full bg-[color:var(--arume-ink)]/70 backdrop-blur-sm cursor-default border-none outline-none"
          onClick={onClose}
        />
        <motion.div
          initial={{ y: -10, scale: 0.98, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          className="relative w-full max-w-xl rounded-2xl bg-[color:var(--arume-paper)] border border-[color:var(--arume-gray-100)] overflow-hidden z-10 flex flex-col max-h-[75vh]"
          style={{ boxShadow: '0 24px 80px rgba(11,11,12,0.35)' }}
        >
          {/* Línea dorada superior */}
          <span className="absolute top-0 left-0 right-0 h-[2px] bg-[color:var(--arume-gold)]"/>

          {/* Buscador */}
          <div className="p-4 border-b border-[color:var(--arume-gray-100)] flex items-center gap-3 shrink-0">
            <Search className="w-4 h-4 text-[color:var(--arume-gray-400)]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar módulo o acción…"
              className="flex-1 outline-none text-base text-[color:var(--arume-ink)] placeholder:text-[color:var(--arume-gray-400)] bg-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  filtered[0].isAction ? onAction(filtered[0].key) : onSelect(filtered[0].key);
                }
                if (e.key === 'Escape') onClose();
              }}
            />
            <span className="text-[10px] font-semibold text-[color:var(--arume-gray-500)] border border-[color:var(--arume-gray-200)] bg-white px-2 py-0.5 rounded">ESC</span>
          </div>

          {/* Lista */}
          <div className="overflow-y-auto p-2 custom-scrollbar flex-1">
            {filtered.length === 0 && (
              <p className="text-sm text-[color:var(--arume-gray-400)] px-4 py-10 text-center">
                No hay resultados para “{q}”.
              </p>
            )}
            {groupedEntries ? (
              <div className="space-y-4 p-2">
                {groupedEntries.map(({ group, label, items: list }) => (
                  <div key={group}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-400)] px-2 mb-1.5">{label}</p>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {list.map(i => <li key={i.key}>{renderItem(i)}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2">
                {filtered.map(i => <li key={i.key}>{renderItem(i)}</li>)}
              </ul>
            )}
          </div>

          {/* Footer con atajos */}
          <div className="border-t border-[color:var(--arume-gray-100)] px-4 py-2.5 flex items-center justify-between text-[10px] text-[color:var(--arume-gray-400)] font-semibold uppercase tracking-[0.15em]">
            <span>↑↓ navegar · ⏎ abrir</span>
            <span>Arume Pro</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

/* =======================================================
 * 2. NAVEGACIÓN MÓVIL
 * ======================================================= */
type NavGroup = 'inicio' | 'compras' | 'ventas' | 'dinero' | 'personal' | 'cierres' | 'tienda' | 'marketing' | 'sistema';
const NAV_GROUPS: NavGroup[] = ['inicio', 'compras', 'ventas', 'dinero', 'personal', 'cierres', 'tienda', 'marketing', 'sistema'];
type DockItemDef<T extends string> = { key: T; label: string; icon: any; group?: NavGroup; shortcut?: string };

function MobileTabBar<T extends string>({ items, activeKey, onChange }: { items: DockItemDef<T>[], activeKey: T, onChange: (k:T)=>void }) {
  const grouped = useMemo(() => {
    const map: Record<NavGroup, DockItemDef<T>[]> = {
      inicio: [], compras: [], ventas: [], dinero: [],
      personal: [], cierres: [], tienda: [], marketing: [], sistema: [],
    };
    for (const it of items) {
      const g: NavGroup = (it.group ?? 'inicio');
      map[g].push(it);
    }
    return map;
  }, [items]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll horizontal con rueda del ratón (escritorio)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    // { passive: false } es NECESARIO para que preventDefault funcione
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const scrollByAmount = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: 'smooth' });
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[120] bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe shadow-[0_-5px_15px_rgba(0,0,0,0.05)]">
      <div className="relative flex items-center">
        {/* Flecha izquierda — siempre visible */}
        <button
          onClick={() => scrollByAmount(-1)}
          className="shrink-0 w-7 h-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors active:scale-90"
          aria-label="Scroll izquierda"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>

        <div
          ref={scrollRef}
          className="flex-1 flex items-center overflow-x-auto flex-nowrap py-1.5 gap-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {NAV_GROUPS.map((g, gi) => {
            const list = grouped[g];
            if (!list || list.length === 0) return null;
            return (
              <React.Fragment key={g}>
                {gi > 0 && <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />}
                {list.map(it => <MobileTabButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
              </React.Fragment>
            );
          })}
          <div className="w-2 shrink-0" />
        </div>

        {/* Flecha derecha — siempre visible */}
        <button
          onClick={() => scrollByAmount(1)}
          className="shrink-0 w-7 h-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors active:scale-90"
          aria-label="Scroll derecha"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </nav>
  );
}

function MobileTabButton<T extends string>({ item, active, onClick }: { item: DockItemDef<T>, active: boolean, onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button type="button" onClick={onClick} className={cn("min-w-[64px] w-[64px] h-12 px-1 rounded-xl border border-transparent text-[8px] font-black flex flex-col items-center justify-center gap-1 transition-all shrink-0", active ? "bg-slate-800 text-white shadow-md" : "text-slate-500 hover:bg-slate-100")}>
      <Icon className={cn("w-4 h-4", active ? "text-white" : "")} />
      <span className="truncate w-full text-center px-0.5">{item.label}</span>
    </button>
  );
}

/* =======================================================
 * 3. DOCK DE ESCRITORIO (AUTO-OCULTABLE ESTILO MAC)
 * ======================================================= */
function DesktopDock<T extends string>({ items, activeKey, onChange }: { items: DockItemDef<T>[], activeKey: T, onChange: (k:T)=>void }) {
  const [visible, setVisible] = useState(false);
  const [hoveringDock, setHoveringDock] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const handleShow = useCallback(() => {
    setVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => { if (!hoveringDock) setVisible(false); }, 3000);
  }, [hoveringDock]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => { if (window.innerHeight - e.clientY <= 20) handleShow(); };
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [handleShow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement; const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!isTyping && e.key.toLowerCase() === 'd') setVisible(v => !v);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => { if (!hoveringDock) setVisible(false); }, 2500);
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [visible, hoveringDock]);

  const grouped = useMemo(() => {
    const map: Record<NavGroup, DockItemDef<T>[]> = {
      inicio: [], compras: [], ventas: [], dinero: [],
      personal: [], cierres: [], tienda: [], marketing: [], sistema: [],
    };
    for (const it of items) {
      const g: NavGroup = (it.group ?? 'inicio');
      map[g].push(it);
    }
    return map;
  }, [items]);

  return (
    <div className="hidden lg:block">
      <AnimatePresence>
        {!visible && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed bottom-1 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full bg-slate-300 z-[119] pointer-events-none" />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visible && (
          <motion.nav
            initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] flex justify-center"
          >
            <div className="bg-white/95 backdrop-blur-md shadow-2xl border border-slate-200/50 rounded-full px-6 py-2 max-w-full overflow-x-auto relative" onMouseEnter={() => setHoveringDock(true)} onMouseLeave={() => { setHoveringDock(false); handleShow(); }}>
              <div className="flex items-center gap-1 no-scrollbar">
                {NAV_GROUPS.map((g, gi) => {
                  const list = grouped[g];
                  if (!list || list.length === 0) return null;
                  return (
                    <React.Fragment key={g}>
                      {gi > 0 && <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />}
                      {list.map(it => <DesktopTabButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}

function DesktopTabButton<T extends string>({ item, active, onClick }: { item: DockItemDef<T>, active: boolean, onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button type="button" onClick={onClick} className={cn("min-w-[60px] h-14 px-1 rounded-2xl border border-transparent text-[9px] font-bold flex flex-col items-center justify-center gap-1 transition-all shrink-0", active ? "bg-slate-800 text-white shadow-md" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 hover:border-slate-200")}>
      <Icon className={cn("w-4 h-4", active ? "text-white" : "")} />
      <span className="truncate w-full text-center px-0.5">{item.label}</span>
    </button>
  );
}

/* =======================================================
 * 4. COMPONENTE APP PRINCIPAL
 * ======================================================= */
export default function App() {
  const { data: db, loading, saveData, setData, reloadData } = useArumeData();
  const dbRef = useRef<typeof db>(db);
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    dbRef.current = db;
    setDataVersion(v => v + 1);
  }, [db]);

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const hash = window.location.hash.replace('#', '') as TabKey;
    return TAB_LABELS[hash] ? hash : 'dashboard'; 
  });

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isCmdOpen, setIsCmdOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);

  const handleTabChange = useCallback((tab: TabKey) => {
    if (navigator.vibrate) navigator.vibrate(30); 
    setActiveTab(tab);
    window.location.hash = tab;
    document.title = `${TAB_LABELS[tab]} · Arume Sake Bar`;
    setIsCmdOpen(false);
  }, []);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error intentando abrir pantalla completa: ${err.message}`);
      });
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const onOnline = () => setIsOffline(false); const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  // ── Registro Service Worker + Smart Checks ──
  useEffect(() => {
    PushService.registerSW();
  }, []);
  useEffect(() => {
    if (!loading && db) {
      PushService.runSmartChecks(db);
      ArumeAgent.runScheduled(db);
    }
  }, [loading, db]);

  useEffect(() => {
    const channel = supabase.channel('arume-changes', { config: { broadcast: { self: false } } }).on('postgres_changes', { event: '*', schema: 'public', table: 'arume_data' }, () => { reloadData(); }).subscribe();
    return () => { try { supabase.removeChannel(channel); } catch { /* noop */ } };
  }, [reloadData]);

  const REQUIRED: (keyof AppData)[] = ['banco','platos','recetas','ingredientes','ventas_menu','cierres','facturas','albaranes','gastos_fijos', 'socios', 'control_pagos', 'cierres_mensuales', 'activos'];
  
  useEffect(() => {
    if (loading || !db) return; 
    let changed = false;
    const next = { ...db };
    for (const k of REQUIRED) { 
      if (!next[k] || !Array.isArray(next[k])) { 
        (next as any)[k] = []; 
        changed = true; 
      } 
    }
    if (!next.socios || next.socios.length === 0) {
      next.socios = [
        { id: 's-jeronimo', n: 'Jerónimo', active: true, role: 'socio_fundador' },
        { id: 's-pedro',    n: 'Pedro',    active: true, role: 'socio_fundador' },
        { id: 's-pau',      n: 'Pau',      active: true, role: 'operativo'      },
        { id: 's-agnes',    n: 'Agnès',    active: true, role: 'operativo'      },
        { id: 's-onlyone',  n: 'Only One', active: true, role: 'operativo'      },
      ] as any; 
      changed = true;
    }
    if (!next.config) { 
      next.config = { 
        objetivoMensual: 45000, 
        n8nUrlBanco: "", 
        n8nUrlIA: "",
        reparto: {
          sociedadPrincipal: [
            { nombre: 'Jerónimo', porcentaje: 50 },
            { nombre: 'Pedro',    porcentaje: 50 },
          ],
          acuerdosB2B: [
            { nombre: 'Albert (Cocinero)',    porcentaje: 20 },
            { nombre: 'Antonio (Consultoría)',porcentaje: 10 },
            { nombre: 'Sociedad Principal',   porcentaje: 70 },
          ],
        },
      }; 
      changed = true; 
    } else if (!next.config.reparto) {
      next.config.reparto = {
        sociedadPrincipal: [
          { nombre: 'Jerónimo', porcentaje: 50 },
          { nombre: 'Pedro',    porcentaje: 50 },
        ],
        acuerdosB2B: [
          { nombre: 'Albert (Cocinero)',    porcentaje: 20 },
          { nombre: 'Antonio (Consultoría)',porcentaje: 10 },
          { nombre: 'Sociedad Principal',   porcentaje: 70 },
        ],
      };
      changed = true;
    }
    if (changed) setData(next);
  }, [db, loading, setData]);

  const isSyncingRef   = useRef(false);
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

  // ── Captura de foto / ticket con cámara ──────────────────────────────────
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !db) return;
    e.target.value = '';

    setIsProcessingPhoto(true);
    try {
      const soloBase64 = await compressImageForAI(file);
      const prompt = `Actúa como un Auditor Contable. Lee esta imagen de un ticket o factura. Extrae TODO lo posible. Devuelve SOLO un JSON estricto sin comentarios:
      {
        "proveedor": "Nombre de la empresa",
        "nif": "NIF o CIF si aparece",
        "num": "Número de factura oficial",
        "fecha": "YYYY-MM-DD",
        "total": 0,
        "base": 0,
        "iva": 0,
        "referencias_albaranes": ["Array de strings con números de albarán o pedido si los hay"]
      }`;

      const { raw } = await scanBase64(soloBase64, 'image/jpeg', prompt);
      const rawJson = raw as Record<string, any>;

      const nuevaFacturaIA: FacturaExtended = {
        id:             'draft-camera-' + Date.now(),
        tipo:           'compra',
        num:            rawJson.num      || 'S/N',
        date:           rawJson.fecha    || DateUtil.today(),
        prov:           rawJson.proveedor || 'Proveedor Desconocido',
        total:          String(rawJson.total || 0),
        base:           String(rawJson.base  || 0),
        tax:            String(rawJson.iva   || 0),
        albaranIdsArr:  rawJson.referencias_albaranes || [],
        paid:           false,
        reconciled:     false,
        source:         'dropzone',
        status:         'draft',
        unidad_negocio: 'REST',
        file_base64:    `data:image/jpeg;base64,${soloBase64}`,
      };

      const newData = JSON.parse(JSON.stringify(db));
      newData.facturas = [nuevaFacturaIA, ...(newData.facturas || [])];
      await handleSave(newData);

      // 🆕 FIX: toast en lugar de alert() bloqueante
      toast.success('Ticket escaneado y enviado al Centro de Compras para revisión.');
      if (activeTab !== 'compras') handleTabChange('compras');

    } catch (e: any) {
      // 🆕 FIX: toast en lugar de alert() bloqueante
      toast.error('Error al procesar la imagen: ' + (e?.message || 'Imagen ilegible'));
    } finally {
      setIsProcessingPhoto(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (isTyping) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        if (e.key.toLowerCase() === 'k') { e.preventDefault(); setIsCmdOpen(v => !v); }
        if (e.key === '1') { e.preventDefault(); handleTabChange('dashboard'); }
        if (e.key === '2') { e.preventDefault(); handleTabChange('diario'); }
        if (e.key === '3') { e.preventDefault(); handleTabChange('compras'); } 
        if (e.key === '4') { e.preventDefault(); handleTabChange('banco'); }
        if (e.key === '5') { e.preventDefault(); handleTabChange('marketing'); } 
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleTabChange]);

  const navItems = useMemo<DockItemDef<TabKey>[]>(() => ([
    // 📊 INICIO
    { key: 'dashboard',   label: 'Dash',       icon: LayoutDashboard, group: 'inicio', shortcut: '⌘1' },
    { key: 'ia',          label: 'IA',          icon: Sparkles,        group: 'inicio' },
    // 📥 COMPRAS (entradas, albaranes, facturas, proveedores)
    { key: 'importador',  label: 'Subir',       icon: Import,          group: 'compras' },
    { key: 'compras',     label: 'Facturas',    icon: Receipt,         group: 'compras', shortcut: '⌘3' },
    { key: 'proveedores', label: 'Proveed.',    icon: Users,           group: 'compras' },
    // 💰 VENTAS (caja, menús, presupuestos)
    { key: 'diario',      label: 'Caja',        icon: Wallet,          group: 'ventas',  shortcut: '⌘2' },
    { key: 'menus',       label: 'Menús',       icon: ChefHat,         group: 'ventas'  },
    { key: 'presupuestos',label: 'Presuptos.',  icon: FileText,        group: 'ventas'  },
    // 🏦 DINERO (banco, tesorería, liquidez, libros IVA, balance)
    { key: 'banco',       label: 'Banco',       icon: Building2,       group: 'dinero',  shortcut: '⌘4' },
    { key: 'tesoreria',   label: 'Tesorería',   icon: TrendingUp,      group: 'dinero'  },
    { key: 'liquidez',    label: 'Liquidez',    icon: Scale,           group: 'dinero'  },
    { key: 'librosiva',   label: 'Libros IVA',  icon: BookOpen,        group: 'dinero'  },
    { key: 'balance',     label: 'Balance',     icon: Scale,           group: 'dinero'  },
    // 👥 PERSONAL
    { key: 'nominas',     label: 'Nóminas',     icon: Users,           group: 'personal' },
    { key: 'fixed',       label: 'Fijos',       icon: Zap,             group: 'personal' },
    // 📋 CIERRES & INFORMES
    { key: 'cierre',      label: 'Cierre',      icon: Lock,            group: 'cierres'  },
    { key: 'informes',    label: 'Informes',    icon: PieChart,        group: 'cierres'  },
    // 🛒 TIENDA (Shop + Stock)
    { key: 'shop',        label: 'Tienda',      icon: ShoppingBag,     group: 'tienda'   },
    { key: 'stock',       label: 'Stock',       icon: Package,         group: 'tienda'   },
    // 📣 MARKETING
    { key: 'marketing',   label: 'Marketing',   icon: Megaphone,       group: 'marketing', shortcut: '⌘5' },
    // ⚙️ SISTEMA (agente, alertas)
    { key: 'agente',         label: 'Agente',   icon: Bot,             group: 'sistema'  },
    { key: 'notificaciones', label: 'Alertas',  icon: Bell,            group: 'sistema'  },
  ]), []);

  const cmdItems = useMemo<CmdItem<string>[]>(() => [
    ...navItems.map(n => ({ key: n.key, label: TAB_LABELS[n.key as TabKey], group: n.group, icon: n.icon, shortcut: n.shortcut, badge: n.key === 'marketing' ? 'Nuevo' : undefined })),
    // 🔒 Vista privada — solo accesible vía Cmd+K, no sale en el dock (invisible para gestoría)
    { key: 'cuentas',         label: '🔒 Cuentas Familia (Privado)', icon: Lock,     shortcut: 'Privado' },
    { key: 'action_scan',     label: 'Escanear Ticket o Factura',    icon: Camera,   isAction: true, shortcut: 'Enter' },
    { key: 'action_settings', label: 'Abrir Configuración (APIs)',   icon: Settings, isAction: true },
  ], [navItems]);

  // ── ROUTING ──────────────────────────────────────────────────────────────
  const S = useCallback(({ children }: { children: React.ReactNode }) => (
    <React.Suspense fallback={<div className="flex items-center justify-center p-12"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/></div>}>
      {children}
    </React.Suspense>
  ), []);

  const content = useMemo(() => {
    const props = { data: dbRef.current, onSave: handleSave };
    switch (activeTab) {
      case 'dashboard':    return <S><DashboardView data={dbRef.current} onNavigate={handleTabChange} /></S>;
      case 'ia':           return <S><AIConsultant data={dbRef.current} /></S>;
      case 'diario':       return <S><CashView {...props} /></S>;
      case 'importador':   return <S><ImportView data={dbRef.current} onSave={handleSave} onNavigate={(tab) => handleTabChange(tab as TabKey)} /></S>;
      case 'compras':
      case 'facturas':
      case 'albaranes':    return <S><ComprasDashboard {...props} /></S>;
      case 'tesoreria':    return <S><TesoreriaView data={dbRef.current} onSave={handleSave} onNavigate={handleTabChange} /></S>;
      case 'liquidez':     return <S><LiquidacionesView {...props} /></S>;
      case 'banco':        return <S><BancoView {...props} /></S>;
      case 'fixed':        return <S><FixedExpensesView {...props} /></S>;
      case 'proveedores':  return <S><ProveedoresView data={dbRef.current} onSave={handleSave} /></S>;
      case 'presupuestos': return <S><PresupuestosView data={dbRef.current} onSave={handleSave} /></S>;
      case 'shop':         return <S><ShopView data={dbRef.current} onSave={handleSave} /></S>;
      case 'informes':     return <S><ReportsView data={dbRef.current} onSave={handleSave} /></S>;
      case 'menus':        return <S><MenuView db={dbRef.current} onSave={handleSave} /></S>;
      case 'stock':        return <S><StockView {...props} /></S>;
      case 'cierre':       return <S><CierreContableView {...props} /></S>;
      case 'marketing':    return <S><MarketingView data={dbRef.current} /></S>;
      case 'cuentas':      return <S><CuentasFamiliaresView data={dbRef.current} onSave={handleSave} /></S>;
      case 'librosiva':    return <S><LibrosIVAView data={dbRef.current} /></S>;
      case 'balance':      return <S><BalanceView data={dbRef.current} /></S>;
      case 'nominas':      return <S><NominasView data={dbRef.current} onSave={handleSave} /></S>;
      case 'notificaciones': return <S><NotificacionesView data={dbRef.current} onSave={handleSave} /></S>;
      case 'agente':         return <S><AutomatizacionesView data={dbRef.current} onSave={handleSave} /></S>;
      default:             return <S><DashboardView data={dbRef.current} onNavigate={handleTabChange} /></S>;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dataVersion, handleSave, handleTabChange]);

  // ── Pantallas de carga / error ────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] flex flex-col items-center justify-center relative overflow-hidden">
      {/* halo dorado sutil */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-[color:var(--arume-gold)]/5 blur-3xl pointer-events-none"/>
      <div className="relative z-10 flex flex-col items-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-[color:var(--arume-gold)] mb-3">Arume Pro</p>
        <h1 className="font-serif text-4xl md:text-5xl font-semibold tracking-tight text-white mb-8">
          Preparando tu negocio
        </h1>
        {/* 3 dots animados minimalistas */}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[color:var(--arume-gold)] animate-bounce" style={{ animationDelay: '0ms' }}/>
          <span className="w-2 h-2 rounded-full bg-[color:var(--arume-gold)] animate-bounce" style={{ animationDelay: '150ms' }}/>
          <span className="w-2 h-2 rounded-full bg-[color:var(--arume-gold)] animate-bounce" style={{ animationDelay: '300ms' }}/>
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40 mt-8">
          Sincronizando con Supabase…
        </p>
      </div>
    </div>
  );

  if (!loading && !db) return (
    <div className="min-h-screen bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] flex flex-col items-center justify-center text-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-[2px] bg-[color:var(--arume-danger)]"/>
      <div className="relative z-10 max-w-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--arume-danger)]">Conexión</p>
        <h2 className="font-serif text-3xl font-semibold tracking-tight text-white mt-2 mb-3">Error de conexión</h2>
        <p className="text-sm text-white/60 mb-8">Supabase ha tardado en responder. Tus datos están a salvo.</p>
        <button onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] hover:brightness-95 transition active:scale-[0.98]">
          <RefreshCw className="w-3.5 h-3.5" /> Reintentar
        </button>
      </div>
    </div>
  );

  const showCameraButton = !['marketing', 'informes', 'cierre'].includes(activeTab);

  // ── RENDER PRINCIPAL ──────────────────────────────────────────────────────
  return (
    <AuthScreen>
      <div id="app-root-container" className="min-h-screen w-full bg-[color:var(--arume-paper)] relative pt-safe overflow-x-hidden">

        <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handlePhotoCapture} className="hidden" />

        {/* HEADER */}
        <header className="sticky top-0 z-[110] bg-white/90 backdrop-blur-xl border-b border-slate-200 px-4 py-2 flex justify-between items-center shadow-sm">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-1.5">
              ARUME <span className="bg-indigo-600 text-white px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest">SAKE BAR</span>
            </h1>
            <span className="hidden md:inline text-[8px] font-bold text-slate-400 uppercase tracking-widest">Celoso de Palma SL</span>
            <div className="w-px h-4 bg-slate-200 hidden sm:block" />
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest hidden sm:block">{TAB_LABELS[activeTab]}</p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setIsCmdOpen(true)} className="hidden sm:flex items-center gap-1.5 px-2 py-1.5 bg-slate-50 text-slate-500 rounded border border-slate-200 hover:bg-slate-100 hover:text-slate-800 transition text-[10px] font-bold">
              <Search className="w-3 h-3" /> Acciones (⌘K)
            </button>
            {isOffline && (
              <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2 py-1.5 rounded">
                <WifiOff className="w-3 h-3 text-rose-500" />
                <span className="text-[9px] text-rose-600 font-bold uppercase">Offline</span>
              </div>
            )}
            {isSyncing && !isOffline && (
              <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 px-2 py-1.5 rounded">
                <RefreshCw className="w-3 h-3 text-indigo-500 animate-spin" />
                <span className="text-[9px] text-indigo-600 font-bold uppercase">Guardando</span>
              </div>
            )}
            <button onClick={toggleFullScreen} aria-label="Pantalla Completa" className="hidden sm:flex w-8 h-8 items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-indigo-600 rounded transition">
              <Maximize className="w-4 h-4" />
            </button>
            <button onClick={() => setIsConfigOpen(true)} aria-label="Configuración" className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-indigo-600 rounded transition">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* MAIN */}
        <main className="w-full pb-32">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="p-2 md:p-6 w-full"
            >
              <ErrorBoundary key={activeTab}>
                {content}
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>

        {/* BOTÓN CÁMARA (móvil) */}
        {showCameraButton && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessingPhoto}
            className={cn(
              "fixed bottom-20 left-3 z-[90] w-12 h-12 rounded-full flex items-center justify-center text-white shadow-xl transition-all duration-300 md:hidden",
              isProcessingPhoto
                ? "bg-indigo-400 cursor-not-allowed scale-95"
                : "bg-indigo-600 hover:bg-indigo-700 hover:scale-105 active:scale-95",
              activeTab === 'compras' && "animate-bounce shadow-indigo-500/50"
            )}
            aria-label="Escanear ticket con cámara"
          >
            {isProcessingPhoto ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
          </button>
        )}

        {/* OVERLAY PROCESANDO FOTO */}
        <AnimatePresence>
          {isProcessingPhoto && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
              <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center">
                <Sparkles className="w-10 h-10 text-indigo-500 animate-pulse mb-3" />
                <h3 className="text-base font-black text-slate-800">Cerebro AI Analizando...</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Comprimiendo y Extrayendo</p>
                <div className="w-full h-1 bg-slate-100 rounded-full mt-4 overflow-hidden">
                  <div className="w-full h-full bg-indigo-500 animate-pulse" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <React.Suspense fallback={null}>
          <TelegramWidget currentModule={TAB_LABELS[activeTab]} chatId={db?.config?.telegramChatId} />
        </React.Suspense>

        <MobileTabBar items={navItems} activeKey={activeTab} onChange={(k) => handleTabChange(k)} />
        {/* DesktopDock desactivado — MobileTabBar ahora funciona en todos los tamaños */}

        <CommandPalette
          open={isCmdOpen}
          onClose={() => setIsCmdOpen(false)}
          items={cmdItems}
          onSelect={(key) => handleTabChange(key as TabKey)}
          onAction={(key) => {
            if (key === 'action_scan')     { fileInputRef.current?.click(); setIsCmdOpen(false); }
            if (key === 'action_settings') { setIsConfigOpen(true);         setIsCmdOpen(false); }
          }}
        />

        <React.Suspense fallback={null}>
          <SettingsModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} db={db} setDb={setData} onSave={handleSave} />
        </React.Suspense>

      </div>

      {/* Singletons globales — fuera del div principal, dentro de AuthScreen */}
      <ToastRenderer />
      <ConfirmProvider />

    </AuthScreen>
  );
}
