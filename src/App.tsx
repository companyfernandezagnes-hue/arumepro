import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, Package, Wallet, ChefHat, Users, Settings, Search,
  TrendingUp, X, RefreshCw, FileText, Truck, Scale, Zap, Building2, 
  PieChart, Lock, Import, Sparkles, WifiOff, AlertTriangle, Camera, Loader2,
  Receipt, Megaphone, Maximize
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// 🚀 SERVICIOS Y HOOKS
import { supabase } from './services/supabase';
import { useArumeData } from './hooks/useArumeData';
import { cn } from './lib/utils';
import { AppData, FacturaExtended } from './types';
import { GoogleGenAI } from "@google/genai";
import { DateUtil } from './services/engine';

// 📄 COMPONENTES (Vistas)
import { CashView } from './components/CashView';
import { ImportView } from './components/ImportView';
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
import { TelegramWidget } from './components/TelegramWidget';
import { AuthScreen } from './components/AuthScreen';

// 👑 MÓDULOS MAESTROS
import { ComprasDashboard } from './components/ComprasDashboard';
import { MarketingView } from './components/MarketingView'; 

// 🛡️ TIPOS Y CONSTANTES
type TabKey = 
  | 'dashboard' | 'ia' | 'diario' | 'importador' 
  | 'compras' | 'facturas' | 'albaranes' 
  | 'tesoreria' | 'liquidez' | 'banco' | 'fixed' 
  | 'informes' | 'menus' | 'stock' | 'cierre' | 'marketing';

const TAB_LABELS: Record<TabKey, string> = {
  dashboard: 'Dashboard', ia: 'IA', diario: 'Caja Diaria', importador: 'Importador',
  compras: 'Compras', facturas: 'Compras', albaranes: 'Compras', 
  tesoreria: 'Tesorería', liquidez: 'Liquidez',
  banco: 'Banco', fixed: 'G. Fijos', informes: 'Informes', menus: 'Menús', stock: 'Stock', cierre: 'Cierre',
  marketing: 'Marketing'
};

const jsonSafeClone = <T,>(obj: T): T => { try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; } };

/* =======================================================
 * 🗜️ COMPRESOR DE IMÁGENES
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
 * 🛡️ PARACAÍDAS ANTI-PANTALLAZO AZUL
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
             <button onClick={() => this.setState({hasError: false})} className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-200 transition">Intentar Recuperar</button>
             <button onClick={() => window.location.reload()} className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition">Reiniciar App</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* =======================================================
 * 🧭 1. BUSCADOR RÁPIDO (CMD + K)
 * ======================================================= */
type CmdItem<T extends string> = { key: T; label: string; group?: string; icon?: any; shortcut?: string; isAction?: boolean; badge?: string };

function CommandPalette<T extends string>({ open, onClose, items, onSelect, onAction }: { open: boolean, onClose: ()=>void, items: CmdItem<T>[], onSelect: (k:T)=>void, onAction: (k:T)=>void }) {
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
      <div className="fixed inset-0 z-[300] flex justify-center items-start pt-[12vh] px-4" aria-modal="true" role="dialog">
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-label="Cerrar" className="absolute inset-0 w-full h-full bg-slate-900/50 backdrop-blur-sm cursor-default border-none outline-none" onClick={onClose} />
        <motion.div initial={{ y: -10, scale: 0.98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} className="relative w-full max-w-xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden z-10 flex flex-col max-h-[70vh]">
          <div className="p-3 border-b border-slate-100 flex items-center gap-3 bg-slate-50 shrink-0">
            <Search className="w-5 h-5 text-indigo-500" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar módulo o acción..." className="flex-1 outline-none text-sm font-semibold text-slate-800 bg-transparent" onKeyDown={(e) => { if (e.key === 'Enter' && filtered.length > 0) { filtered[0].isAction ? onAction(filtered[0].key) : onSelect(filtered[0].key); } if (e.key === 'Escape') onClose(); }} />
            <span className="text-[10px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded">ESC</span>
          </div>
          <div className="overflow-y-auto p-2 custom-scrollbar bg-white flex-1">
            {filtered.length === 0 && <p className="text-xs font-semibold text-slate-400 px-4 py-8 text-center">No hay resultados.</p>}
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {filtered.map((i) => {
                const Icon = i.icon;
                return (
                  <li key={i.key}>
                    <button className={cn("w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors flex items-center justify-between group", i.isAction ? "text-indigo-700 bg-indigo-50 hover:bg-indigo-100" : "text-slate-600 hover:bg-slate-100")} onClick={() => i.isAction ? onAction(i.key) : onSelect(i.key)}>
                      <div className="flex items-center gap-2">
                        {Icon && <Icon className={cn("w-4 h-4 transition-colors", i.isAction ? "text-indigo-500" : "text-slate-400 group-hover:text-indigo-500")} />}
                        {i.label}
                        {i.badge && <span className="ml-1 px-1.5 py-0.5 bg-fuchsia-100 text-fuchsia-600 text-[8px] font-black uppercase rounded">{i.badge}</span>}
                      </div>
                      {i.shortcut && <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors", i.isAction ? "bg-indigo-200 text-indigo-800" : "text-slate-400 bg-slate-100 group-hover:bg-indigo-100 group-hover:text-indigo-500")}>{i.shortcut}</span>}
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
 * 📱 2. NAVEGACIÓN MÓVIL (SIEMPRE FIJA Y COMPACTA)
 * ======================================================= */
type DockItemDef<T extends string> = { key: T; label: string; icon: any; group?: 'main'|'fin'|'ops'; shortcut?: string };

function MobileTabBar<T extends string>({ items, activeKey, onChange }: { items: DockItemDef<T>[], activeKey: T, onChange: (k:T)=>void }) {
  const groups = useMemo(() => ({
    main: items.filter(i => (i.group ?? 'main') === 'main'), 
    fin: items.filter(i => i.group === 'fin'), 
    ops: items.filter(i => i.group === 'ops'),
  }), [items]);

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-[120] bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe shadow-[0_-5px_15px_rgba(0,0,0,0.05)]">
      <div className="flex items-center overflow-x-auto no-scrollbar px-2 py-1.5 gap-1">
        {groups.main.map(it => <MobileTabButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
        <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />
        {groups.fin.map(it => <MobileTabButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
        <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />
        {groups.ops.map(it => <MobileTabButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
      </div>
    </nav>
  );
}

function MobileTabButton<T extends string>({ item, active, onClick }: { item: DockItemDef<T>, active: boolean, onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button type="button" onClick={onClick} className={cn("min-w-[56px] h-12 px-1 rounded-xl border border-transparent text-[8px] font-black flex flex-col items-center justify-center gap-1 transition-all shrink-0", active ? "bg-slate-800 text-white shadow-md" : "text-slate-500 hover:bg-slate-100")}>
      <Icon className={cn("w-4 h-4", active ? "text-white" : "")} />
      <span className="truncate w-full text-center px-0.5">{item.label}</span>
    </button>
  );
}

/* =======================================================
 * 🚀 3. EL DOCK DE ESCRITORIO (AUTO-OCULTABLE ESTILO MAC)
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

  const groups = useMemo(() => ({
    main: items.filter(i => (i.group ?? 'main') === 'main'), fin: items.filter(i => i.group === 'fin'), ops: items.filter(i => i.group === 'ops'),
  }), [items]);

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
                {groups.main.map(it => <DesktopTabButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
                <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />
                {groups.fin.map(it => <DesktopTabButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
                <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />
                {groups.ops.map(it => <DesktopTabButton key={it.key} item={it} active={it.key === activeKey} onClick={() => onChange(it.key)} />)}
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
 * 🏗️ 4. COMPONENTE APP PRINCIPAL
 * ======================================================= */
export default function App() {
  const { data: db, loading, saveData, setData, reloadData } = useArumeData();
  
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
    document.title = `${TAB_LABELS[tab]} - Arume Pro`; 
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

  useEffect(() => {
    const channel = supabase.channel('arume-changes', { config: { broadcast: { self: false } } }).on('postgres_changes', { event: '*', schema: 'public', table: 'arume_data' }, () => { reloadData(); }).subscribe();
    return () => { try { supabase.removeChannel(channel); } catch { /* noop */ } };
  }, [reloadData]);

  const REQUIRED: (keyof AppData)[] = ['banco','platos','recetas','ingredientes','ventas_menu','cierres','facturas','albaranes','gastos_fijos'];
  
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
    
    if (!next.config) { 
      next.config = { objetivoMensual: 45000, n8nUrlBanco: "", n8nUrlIA: "", emailGeneral: "" }; 
      changed = true; 
    }
    
    if (changed) setData(next);
  }, [db, loading, setData]);

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

  /* =======================================================
   * 📸 PROCESADOR DE CÁMARA CON COMPRESIÓN
   * ======================================================= */
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !db) return;
    
    e.target.value = '';
    
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        alert("⚠️ Configura tu clave de Gemini API en los Ajustes primero.");
        setIsConfigOpen(true);
        return;
    }

    setIsProcessingPhoto(true);

    try {
      const soloBase64 = await compressImageForAI(file);
      const ai = new GoogleGenAI({ apiKey });
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
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: soloBase64, mimeType: "image/jpeg" } }] }],
        config: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const cleanText = (response.text || "").replace(/(?:json)?/gi, '').replace(/```/g, '').trim();
      let rawJson;
      try {
        rawJson = JSON.parse(cleanText);
      } catch {
        throw new Error("Gemini no devolvió un JSON válido.");
      }

      const nuevaFacturaIA: FacturaExtended = {
        id: 'draft-camera-' + Date.now(), 
        tipo: 'compra', 
        num: rawJson.num || 'S/N', 
        date: rawJson.fecha || DateUtil.today(), 
        prov: rawJson.proveedor || 'Proveedor Desconocido',
        total: String(rawJson.total || 0), 
        base: String(rawJson.base || 0), 
        tax: String(rawJson.iva || 0),
        albaranIdsArr: rawJson.referencias_albaranes || [], 
        paid: false, 
        reconciled: false, 
        source: 'dropzone', 
        status: 'draft', 
        unidad_negocio: 'REST', 
        file_base64: `data:image/jpeg;base64,${soloBase64}`
      };

      const newData = JSON.parse(JSON.stringify(db));
      newData.facturas = [nuevaFacturaIA, ...(newData.facturas || [])];
      await handleSave(newData);
      
      alert("✅ Ticket escaneado y enviado al Centro de Compras para su revisión.");
      if (activeTab !== 'compras') handleTabChange('compras');

    } catch (e: any) {
      alert("❌ Error al procesar la imagen: " + (e.message || "Imagen ilegible"));
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
    { key: 'dashboard',  label: 'Dash',       icon: LayoutDashboard, group: 'main', shortcut: '⌘1' },
    { key: 'ia',         label: 'IA',         icon: Sparkles,        group: 'main' },
    { key: 'diario',     label: 'Caja',       icon: Wallet,          group: 'main', shortcut: '⌘2' },
    { key: 'importador', label: 'Subir',      icon: Import,          group: 'main' },
    
    { key: 'compras',    label: 'Compras',    icon: Receipt,         group: 'fin',  shortcut: '⌘3' },
    { key: 'banco',      label: 'Banco',      icon: Building2,       group: 'fin',  shortcut: '⌘4' },
    { key: 'tesoreria',  label: 'Tesorería',  icon: TrendingUp,      group: 'fin'  },
    { key: 'liquidez',   label: 'Liquidez',   icon: Scale,           group: 'fin'  },
    { key: 'fixed',      label: 'Fijos',      icon: Zap,             group: 'fin'  },
    { key: 'informes',   label: 'Informes',   icon: PieChart,        group: 'ops'  },
    { key: 'menus',      label: 'Menús',      icon: ChefHat,         group: 'ops'  },
    { key: 'stock',      label: 'Stock',      icon: Package,         group: 'ops'  },
    { key: 'marketing',  label: 'Marketing',  icon: Megaphone,       group: 'ops',  shortcut: '⌘5' },
    { key: 'cierre',     label: 'Cierre',     icon: Lock,            group: 'ops'  },
  ]), []);

  const cmdItems = useMemo<CmdItem<string>[]>(() => [
    ...navItems.map(n => ({ key: n.key, label: TAB_LABELS[n.key as TabKey], group: n.group, icon: n.icon, shortcut: n.shortcut, badge: n.key === 'marketing' ? 'Nuevo' : undefined })),
    { key: 'action_scan', label: 'Escanear Ticket o Factura', icon: Camera, isAction: true, shortcut: 'Enter' },
    { key: 'action_settings', label: 'Abrir Configuración (APIs)', icon: Settings, isAction: true }
  ], [navItems]);

  const content = useMemo(() => {
    const props = { data: db, onSave: handleSave };
    switch (activeTab) {
      case 'dashboard': return <DashboardView data={db} />;
      case 'ia':        return <AIConsultant data={db} />; 
      case 'diario':    return <CashView {...props} />;
      case 'importador':return <ImportView data={db} onSave={handleSave} onNavigate={(tab) => handleTabChange(tab as TabKey)} />;
      
      case 'compras':   
      case 'facturas':  
      case 'albaranes': return <ComprasDashboard {...props} />;
      
      case 'tesoreria': return <TesoreriaView {...props} />;
      case 'liquidez':  return <LiquidacionesView {...props} />;
      case 'banco':     return <BancoView {...props} />;
      case 'fixed':     return <FixedExpensesView {...props} />;
      case 'informes':  return <ReportsView data={db} />;
      case 'menus':     return <MenuView db={db} onSave={handleSave} />;
      case 'stock':     return <StockView {...props} />;
      case 'cierre':    return <CierreContableView {...props} />;
      
      case 'marketing': return <MarketingView data={db} />;
      
      default:          return <DashboardView data={db} />;
    }
  }, [activeTab, db, handleSave, handleTabChange]);

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
      <p className="text-indigo-400 font-bold text-[10px] uppercase tracking-widest">Iniciando Arume Pro...</p>
    </div>
  );

  if (!loading && !db) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-center p-4">
        <AlertTriangle className="w-12 h-12 text-amber-500 mb-4 animate-pulse" />
        <h2 className="text-lg font-bold text-white mb-1">Error de conexión</h2>
        <p className="text-slate-400 mb-6 text-xs max-w-sm">Supabase ha tardado en responder. Tus datos están a salvo.</p>
        <button onClick={() => window.location.reload()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-indigo-500 transition flex items-center gap-2">
          <RefreshCw className="w-3 h-3" /> Reintentar
        </button>
      </div>
    );
  }

  const showCameraButton = !['marketing', 'informes', 'cierre'].includes(activeTab);

  return (
    <AuthScreen>
      <div id="app-root-container" className="min-h-screen w-full bg-slate-50 relative pt-safe">
        
        <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handlePhotoCapture} className="hidden" />

        {/* 🌟 HEADER CONTABLE REACTIVO */}
        <header className="sticky top-0 z-[110] bg-white/90 backdrop-blur-xl border-b border-slate-200 px-4 py-2 flex justify-between items-center shadow-sm">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-1.5">
              ARUME <span className="bg-indigo-600 text-white px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest">PRO</span>
            </h1>
            <div className="w-px h-4 bg-slate-200 hidden sm:block"></div>
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

        {/* 🌟 CONTENEDOR PRINCIPAL */}
        <main className="w-full pb-32">
          <AnimatePresence mode="wait">
            <motion.div 
              key={activeTab} 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: -10 }} 
              transition={{ type: "spring", stiffness: 300, damping: 30 }} 
              className="p-2 md:p-6 w-full"
            >
              <ErrorBoundary key={activeTab}>
                {content}
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>

        {/* 🚀 FIX: BOTÓN DE CÁMARA MOVIDO A LA IZQUIERDA PARA NO PISAR A TELEGRAM */}
        {showCameraButton && (
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessingPhoto}
            className={cn(
              "fixed bottom-24 left-4 z-[90] w-14 h-14 rounded-full flex items-center justify-center text-white shadow-xl transition-all duration-300 md:hidden",
              isProcessingPhoto ? "bg-indigo-400 cursor-not-allowed scale-95" : "bg-indigo-600 hover:bg-indigo-700 hover:scale-105 active:scale-95",
              activeTab === 'compras' && "animate-bounce shadow-indigo-500/50"
            )}
            aria-label="Escanear ticket con cámara"
          >
            {isProcessingPhoto ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
          </button>
        )}

        {/* Overlay procesando foto */}
        <AnimatePresence>
          {isProcessingPhoto && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
              <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center">
                <Sparkles className="w-10 h-10 text-indigo-500 animate-pulse mb-3" />
                <h3 className="text-base font-black text-slate-800">Cerebro AI Analizando...</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Comprimiendo y Extrayendo</p>
                <div className="w-full h-1 bg-slate-100 rounded-full mt-4 overflow-hidden">
                  <div className="w-full h-full bg-indigo-500 animate-pulse"></div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <TelegramWidget currentModule={TAB_LABELS[activeTab]} telegramToken={db?.config?.telegramToken} chatId={db?.config?.telegramChatId} />
        
        {/* 🚀 BARRAS DE NAVEGACIÓN (Móvil Fija vs PC Auto-Hide) */}
        <MobileTabBar items={navItems} activeKey={activeTab} onChange={(k) => handleTabChange(k)} />
        <DesktopDock items={navItems} activeKey={activeTab} onChange={(k) => handleTabChange(k)} />
        
        <CommandPalette 
          open={isCmdOpen} onClose={() => setIsCmdOpen(false)} 
          items={cmdItems} 
          onSelect={(key) => handleTabChange(key as TabKey)} 
          onAction={(key) => { 
            if (key === 'action_scan') { fileInputRef.current?.click(); setIsCmdOpen(false); }
            if (key === 'action_settings') { setIsConfigOpen(true); setIsCmdOpen(false); }
          }} 
        />
        
        <SettingsModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} db={db} setDb={setData} onSave={handleSave} />
      </div>
    </AuthScreen>
  );
}
