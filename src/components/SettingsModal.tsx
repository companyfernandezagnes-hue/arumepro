import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Save, Key, Eye, EyeOff, Bot, Link as LinkIcon, 
  Building2, Users, Sparkles, CheckCircle2, X,
  Mail, MessageCircle, Send, ShieldAlert, DownloadCloud, Trash2,
  Mic, Megaphone, Plug, Plus, Minus, Brain
} from 'lucide-react';
import { AppData } from '../types';
import { cn } from '../lib/utils';
import { NotificationService } from '../services/notifications';
import { ExportTools } from './ExportTools';
import { PackGestoria } from './PackGestoria';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';
import { AIDiagnosticPanel } from './AIDiagnosticPanel';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: AppData | null;
  setDb: (db: AppData) => void;
  onSave: (db: AppData) => void;
}

// ─── Helper: input con ojo show/hide ─────────────────────────────────────────
const SecretInput = ({
  value, onChange, placeholder, colorClass = 'indigo', linkHref, linkLabel, monoFont = true
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  colorClass?: 'indigo' | 'emerald' | 'violet' | 'orange' | 'pink' | 'cyan' | 'slate' | 'amber';
  linkHref?: string;
  linkLabel?: string;
  monoFont?: boolean;
}) => {
  const [show, setShow] = useState(false);
  const borderMap: Record<string, string> = {
    indigo:  'border-indigo-200 focus:border-indigo-400 text-indigo-900',
    emerald: 'border-emerald-200 focus:border-emerald-400 text-emerald-900',
    violet:  'border-violet-200 focus:border-violet-400 text-violet-900',
    orange:  'border-orange-200 focus:border-orange-400 text-orange-900',
    pink:    'border-pink-200 focus:border-pink-400 text-pink-900',
    cyan:    'border-cyan-200 focus:border-cyan-400 text-cyan-900',
    amber:   'border-amber-200 focus:border-amber-400 text-amber-900',
    slate:   'border-slate-200 focus:border-slate-400 text-slate-700',
  };
  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'w-full p-3 pr-10 bg-white rounded-xl text-xs border outline-none transition-all',
            monoFont ? 'font-mono font-bold' : 'font-bold',
            borderMap[colorClass],
            value.trim() ? 'bg-emerald-50/20' : ''
          )}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {linkHref && (
        <a href={linkHref} target="_blank" rel="noreferrer"
          className="text-[9px] font-bold text-slate-400 hover:text-indigo-500 hover:underline transition block">
          {linkLabel || 'Obtener clave →'}
        </a>
      )}
    </div>
  );
};

// ─── Pill de estado en footer ─────────────────────────────────────────────────
const StatusPill = ({ active, label }: { active: boolean; label: string }) => (
  <div className={cn(
    'px-3 py-1.5 rounded-lg border flex items-center gap-2',
    active ? 'bg-emerald-100/50 border-emerald-200 text-emerald-700' : 'bg-slate-100 border-slate-200 text-slate-400'
  )}>
    <div className={cn('w-1.5 h-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-slate-400')} />
    <span className="text-[8px] font-black uppercase tracking-widest">{label}</span>
  </div>
);

// ─── Título de sección ────────────────────────────────────────────────────────
const SectionTitle = ({ icon: Icon, title, color = 'slate', badge }: {
  icon: React.ElementType; title: string; color?: string; badge?: string;
}) => {
  const colorMap: Record<string, string> = {
    indigo: 'text-indigo-500', emerald: 'text-emerald-500', violet: 'text-violet-500',
    orange: 'text-orange-500', pink: 'text-pink-500', cyan: 'text-cyan-500',
    blue: 'text-blue-500', rose: 'text-rose-500', amber: 'text-amber-500', slate: 'text-slate-400',
  };
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
        <Icon className={cn('w-5 h-5', colorMap[color] ?? colorMap.slate)} />
        {title}
      </h3>
      {badge && <span className="text-[9px] bg-slate-100 text-slate-500 px-2 py-1 rounded-full font-black uppercase">{badge}</span>}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════════
export const SettingsModal = ({ isOpen, onClose, db, setDb, onSave }: SettingsModalProps) => {

  const [config, setConfig] = useState(db?.config || {});

  // ── IAs ────────────────────────────────────────────────────────────────────
  const [claudeKey,   setClaudeKey]   = useState('');
  const [geminiKey,   setGeminiKey]   = useState('');
  const [groqKey,     setGroqKey]     = useState('');
  const [cerebrasKey, setCerebrasKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [mistralKey,  setMistralKey]  = useState('');

  // ── Voz ────────────────────────────────────────────────────────────────────
  const [voiceProvider, setVoiceProvider] = useState<'browser' | 'groq'>('browser');

  // ── Marketing ──────────────────────────────────────────────────────────────
  const [igToken,  setIgToken]  = useState('');
  const [igPageId, setIgPageId] = useState('');

  // ── Integraciones externas (Madisa, Restoo, etc.) ───────────────────────────
  const [extIntegrations, setExtIntegrations] = useState<{ name: string; key: string }[]>([
    { name: 'Madisa', key: '' },
    { name: 'Restoo', key: '' },
  ]);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setConfig(db?.config || {});
    setClaudeKey(localStorage.getItem('claude_api_key') || '');
    setGeminiKey(localStorage.getItem('gemini_api_key') || '');
    setGroqKey(localStorage.getItem('groq_api_key') || '');
    setCerebrasKey(localStorage.getItem('cerebras_api_key') || '');
    setDeepseekKey(localStorage.getItem('deepseek_api_key') || '');
    setMistralKey(localStorage.getItem('mistral_api_key') || '');
    setVoiceProvider((localStorage.getItem('voice_provider') as 'browser' | 'groq') || 'browser');
    setIgToken(localStorage.getItem('ig_graph_token') || '');
    setIgPageId(localStorage.getItem('ig_page_id') || '');
    try {
      const saved = JSON.parse(localStorage.getItem('ext_integrations') || '[]');
      if (Array.isArray(saved) && saved.length > 0) setExtIntegrations(saved);
    } catch { /* nada guardado aún */ }
  }, [isOpen, db]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setConfig(prev => ({ ...prev, [name]: type === 'number' ? Number(value) : value }));
  };

  const handleSaveAll = () => {
    if (!db) return;

    // IAs
    if (claudeKey.trim())   localStorage.setItem('claude_api_key',   claudeKey.trim());   else localStorage.removeItem('claude_api_key');
    if (geminiKey.trim())   localStorage.setItem('gemini_api_key',   geminiKey.trim());   else localStorage.removeItem('gemini_api_key');
    if (groqKey.trim())     localStorage.setItem('groq_api_key',     groqKey.trim());     else localStorage.removeItem('groq_api_key');
    if (cerebrasKey.trim()) localStorage.setItem('cerebras_api_key', cerebrasKey.trim()); else localStorage.removeItem('cerebras_api_key');
    if (deepseekKey.trim()) localStorage.setItem('deepseek_api_key', deepseekKey.trim()); else localStorage.removeItem('deepseek_api_key');
    if (mistralKey.trim())  localStorage.setItem('mistral_api_key',  mistralKey.trim());  else localStorage.removeItem('mistral_api_key');

    // Voz
    localStorage.setItem('voice_provider', voiceProvider);

    // Marketing
    if (igToken.trim())  localStorage.setItem('ig_graph_token', igToken.trim());  else localStorage.removeItem('ig_graph_token');
    if (igPageId.trim()) localStorage.setItem('ig_page_id',     igPageId.trim()); else localStorage.removeItem('ig_page_id');

    // Integraciones externas
    const validExt = extIntegrations.filter(i => i.name.trim());
    localStorage.setItem('ext_integrations', JSON.stringify(validExt));
    validExt.forEach(i => {
      const k = `ext_api_${i.name.trim().toLowerCase().replace(/\s+/g, '_')}`;
      if (i.key.trim()) localStorage.setItem(k, i.key.trim()); else localStorage.removeItem(k);
    });

    // Config en Supabase
    const newData = { ...db, config: { ...(db.config || {}), ...config } };
    setDb(newData);
    onSave(newData);

    setIsSaved(true);
    setTimeout(() => { setIsSaved(false); onClose(); }, 1500);
  };

  const probarTelegram = async () => {
    if (!config.telegramToken || !config.telegramChatId)
      return void toast.warning('Falta el Token o el Chat ID para probar Telegram.');
    try {
      // Envío DIRECTO a Telegram API
      const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text: '🍶 *TEST DE CONEXIÓN EXITOSO*\n\nArume PRO está conectado a Telegram vía API directa.',
          parse_mode: 'Markdown',
        }),
      });
      if (res.ok) {
        toast.success('✅ Mensaje enviado. Revisa tu Telegram.');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`❌ Error Telegram: ${(err as any)?.description || res.status}`);
      }
    } catch (e: any) {
      toast.error(`❌ Error de red: ${e?.message || 'Sin conexión'}`);
    }
  };

  const handleGlobalBackup = () => {
    if (!db) return;
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `Arume_Backup_Total_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Repara retroactivamente todos los albaranes sin campo `socio` asignándoles
   * un socio por defecto. Imprescindible para que aparezcan en el librito
   * familiar (CuentasFamiliaresView). Los albaranes guardados antes de feb-2025
   * nunca tuvieron este campo, por eso esta herramienta es necesaria.
   */
  const handleRepairAlbaranesSinSocio = async () => {
    if (!db) return;
    const albaranes = db.albaranes || [];
    const sinSocio = albaranes.filter(a => !a.socio || String(a.socio).trim() === '');
    if (sinSocio.length === 0) {
      toast.success('Todos los albaranes ya tienen socio asignado. Nada que reparar.');
      return;
    }
    const ok = await confirm({
      title: `¿Reparar ${sinSocio.length} albaranes?`,
      message: `Se detectaron ${sinSocio.length} albaranes sin campo "socio". Se les asignará "Arume" (empresa) por defecto. Podrás reasignar manualmente los que sean personales después.`,
      confirmLabel: 'Reparar ahora',
    });
    if (!ok) return;
    const newData = JSON.parse(JSON.stringify(db)) as AppData;
    newData.albaranes = (newData.albaranes || []).map((a: any) =>
      (!a.socio || String(a.socio).trim() === '') ? { ...a, socio: 'Arume' } : a
    );
    setDb(newData);
    onSave(newData);
    toast.success(`✅ ${sinSocio.length} albaranes reparados. Revisa el librito familiar.`);
  };

  const handleHardReset = async () => {
    const ok = await confirm({
      title: '¿Limpiar caché local?',
      message: 'Esto NO borra tus datos en la nube. Solo resetea el navegador si la app va lenta o se cuelga.',
      warning: true,
      confirmLabel: 'Limpiar y recargar',
    });
    if (ok) { localStorage.removeItem('arume_backup_last'); sessionStorage.clear(); window.location.reload(); }
  };

  const addExtIntegration    = () => setExtIntegrations(p => [...p, { name: '', key: '' }]);
  const removeExtIntegration = (i: number) => setExtIntegrations(p => p.filter((_, idx) => idx !== i));
  const updateExtIntegration = (i: number, field: 'name' | 'key', val: string) =>
    setExtIntegrations(p => p.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  // Estado de conexiones para pills
  const hasGemini   = !!geminiKey.trim();
  const hasGroq     = !!groqKey.trim();
  const hasCerebras = !!cerebrasKey.trim();
  const hasDeepseek = !!deepseekKey.trim();
  const hasMistral  = !!mistralKey.trim();
  const hasIG       = !!igToken.trim();
  const hasTelegram = !!(config.telegramToken && config.telegramChatId);
  const hasPSD2     = !!config.n8nUrlBanco;

  return (
    <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4 sm:p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm"
      />

      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="bg-slate-100 w-full max-w-5xl rounded-3xl shadow-2xl relative z-10 flex flex-col my-auto overflow-hidden border border-slate-200"
      >
        <button onClick={onClose} className="absolute top-6 right-6 text-white/70 hover:text-white z-20 bg-slate-900/50 p-2.5 rounded-full backdrop-blur-md transition hover:rotate-90">
          <X className="w-5 h-5" />
        </button>

        {/* ── HEADER ───────────────────────────────────────────────────────── */}
        <header className="bg-slate-900 p-8 text-white relative overflow-hidden shrink-0">
          <div className="absolute -right-10 -top-10 opacity-5"><Bot className="w-64 h-64" /></div>
          <div className="relative z-10">
            <h2 className="text-3xl font-black tracking-tighter flex items-center gap-3">
              Panel de Control <Sparkles className="w-6 h-6 text-indigo-400" />
            </h2>
            <p className="text-xs text-indigo-300 font-bold uppercase tracking-widest mt-1">Configuración Core del ERP Multi-Local</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {hasGemini   && <span className="text-[8px] font-black uppercase tracking-widest bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 px-2 py-0.5 rounded-full">● Gemini ON</span>}
              {hasGroq     && <span className="text-[8px] font-black uppercase tracking-widest bg-emerald-600/40 border border-emerald-500/40 text-emerald-200 px-2 py-0.5 rounded-full">● Groq ON</span>}
              {hasCerebras && <span className="text-[8px] font-black uppercase tracking-widest bg-violet-600/40 border border-violet-500/40 text-violet-200 px-2 py-0.5 rounded-full">● Cerebras ON</span>}
              {hasDeepseek && <span className="text-[8px] font-black uppercase tracking-widest bg-cyan-600/40 border border-cyan-500/40 text-cyan-200 px-2 py-0.5 rounded-full">● DeepSeek ON</span>}
              {hasMistral  && <span className="text-[8px] font-black uppercase tracking-widest bg-rose-600/40 border border-rose-500/40 text-rose-200 px-2 py-0.5 rounded-full">● Mistral ON</span>}
              {hasIG       && <span className="text-[8px] font-black uppercase tracking-widest bg-pink-600/40 border border-pink-500/40 text-pink-200 px-2 py-0.5 rounded-full">● Instagram ON</span>}
            </div>
          </div>
        </header>

        {/* ── CUERPO ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* ══════════════════════════════════════════════════════════════
                1. CEREBROS IA — Gemini + Groq + Cerebras + DeepSeek
            ══════════════════════════════════════════════════════════════ */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 relative flex flex-col space-y-3 lg:col-span-2">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-400 rounded-t-[2.5rem]" />
              <SectionTitle icon={Brain} title="Cerebros IA" color="indigo" />

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">

                {/* Claude (Anthropic) — PRINCIPAL */}
                <div className="bg-pink-50 p-3 rounded-2xl border-2 border-pink-200 space-y-2 ring-2 ring-pink-100">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-[10px] font-black text-pink-800 uppercase tracking-widest">🟣 Claude</span>
                    <span className="text-[8px] text-pink-500 font-bold">⭐ PRINCIPAL · imágenes + PDF</span>
                  </div>
                  <SecretInput value={claudeKey} onChange={setClaudeKey} placeholder="sk-ant-..." colorClass="pink"
                    linkHref="https://console.anthropic.com/settings/keys" linkLabel="Crear clave en Anthropic →" />
                  <p className="text-[8px] text-pink-500 font-bold leading-tight">Sonnet 4.5 — primera opción para leer facturas, tickets y albaranes. Si falla, cae a Gemini.</p>
                </div>

                {/* Gemini */}
                <div className="bg-indigo-50 p-3 rounded-2xl border border-indigo-100 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-[10px] font-black text-indigo-800 uppercase tracking-widest">🔵 Gemini</span>
                    <span className="text-[8px] text-indigo-400 font-bold">fallback · imágenes + PDF</span>
                  </div>
                  <SecretInput value={geminiKey} onChange={setGeminiKey} placeholder="AIzaSy..." colorClass="indigo"
                    linkHref="https://aistudio.google.com/apikey" linkLabel="Gratis en AI Studio →" />
                  <p className="text-[8px] text-indigo-400 font-bold leading-tight">Respaldo si Claude está saturado o sin clave. También necesario para escaneo multipágina.</p>
                </div>

                {/* Groq */}
                <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">🟢 Groq</span>
                    <span className="text-[8px] text-emerald-400 font-bold">velocidad + voz Whisper</span>
                  </div>
                  <SecretInput value={groqKey} onChange={setGroqKey} placeholder="gsk_..." colorClass="emerald"
                    linkHref="https://console.groq.com/keys" linkLabel="Gratis en Groq Console →" />
                  <p className="text-[8px] text-emerald-400 font-bold leading-tight">Respaldo ultrarrápido + Whisper para dictado de voz. Tier gratuito generoso</p>
                </div>

                {/* Cerebras */}
                <div className="bg-violet-50 p-3 rounded-2xl border border-violet-100 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-[10px] font-black text-violet-800 uppercase tracking-widest">🟣 Cerebras</span>
                    <span className="text-[8px] text-violet-400 font-bold">ultra rápido · Llama 4</span>
                  </div>
                  <SecretInput value={cerebrasKey} onChange={setCerebrasKey} placeholder="csk-..." colorClass="violet"
                    linkHref="https://cloud.cerebras.ai" linkLabel="Crear cuenta en Cerebras →" />
                  <p className="text-[8px] text-violet-400 font-bold leading-tight">Chip propio 10x más rápido que GPU. ~0.10$/M tokens. Ideal para PDFs de texto y AIConsultant</p>
                </div>

                {/* DeepSeek */}
                <div className="bg-cyan-50 p-3 rounded-2xl border border-cyan-100 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-[10px] font-black text-cyan-800 uppercase tracking-widest">🔷 DeepSeek</span>
                    <span className="text-[8px] bg-emerald-100 text-emerald-700 font-black px-1.5 py-0.5 rounded-full">5M tokens gratis</span>
                  </div>
                  <SecretInput value={deepseekKey} onChange={setDeepseekKey} placeholder="sk-..." colorClass="cyan"
                    linkHref="https://platform.deepseek.com/api-keys" linkLabel="Gratis sin tarjeta →" />
                  <p className="text-[8px] text-cyan-400 font-bold leading-tight">5M tokens gratis al registrarse. Ideal para AIConsultant e informes. Sin tarjeta.</p>
                </div>

                {/* Mistral */}
                <div className="bg-rose-50 p-3 rounded-2xl border border-rose-100 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-[10px] font-black text-rose-800 uppercase tracking-widest">🇪🇺 Mistral</span>
                    <span className="text-[8px] bg-emerald-100 text-emerald-700 font-black px-1.5 py-0.5 rounded-full">1B tokens/mes gratis</span>
                  </div>
                  <SecretInput value={mistralKey} onChange={setMistralKey} placeholder="..." colorClass="slate"
                    linkHref="https://console.mistral.ai/api-keys" linkLabel="Gratis en Mistral Console →" />
                  <p className="text-[8px] text-rose-400 font-bold leading-tight">Europeo 🇪🇺 (GDPR). Visión con Pixtral. 1B tokens/mes gratis. Perfecto como backup de Gemini.</p>
                </div>

              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                1b. DIAGNÓSTICO DE IA — testea cada proveedor
            ══════════════════════════════════════════════════════════════ */}
            <div className="lg:col-span-2">
              <AIDiagnosticPanel />
            </div>

            {/* ══════════════════════════════════════════════════════════════
                2. MOTOR DE VOZ — Navegador vs Groq Whisper
            ══════════════════════════════════════════════════════════════ */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 relative">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-teal-400 rounded-t-[2.5rem]" />
              <SectionTitle icon={Mic} title="Motor de Voz" color="emerald" />

              <div className="space-y-3">
                {/* Opción Navegador */}
                <button
                  type="button"
                  onClick={() => setVoiceProvider('browser')}
                  className={cn(
                    'w-full p-4 rounded-2xl border-2 text-left transition-all',
                    voiceProvider === 'browser'
                      ? 'border-emerald-400 bg-emerald-50'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-black text-slate-800">🌐 Navegador nativo</p>
                      <p className="text-[9px] text-slate-500 font-bold mt-0.5">webkitSpeechRecognition — gratis, sin configuración</p>
                    </div>
                    {voiceProvider === 'browser' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1 leading-tight">Funciona offline. Puede fallar con ruido de cocina o acento marcado. Sin coste.</p>
                </button>

                {/* Opción Groq Whisper */}
                <button
                  type="button"
                  onClick={() => { if (hasGroq) setVoiceProvider('groq'); }}
                  className={cn(
                    'w-full p-4 rounded-2xl border-2 text-left transition-all',
                    voiceProvider === 'groq'
                      ? 'border-emerald-400 bg-emerald-50'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300',
                    !hasGroq ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-black text-slate-800">⚡ Groq Whisper <span className="text-emerald-600">PRO</span></p>
                      <p className="text-[9px] text-slate-500 font-bold mt-0.5">Transcripción IA — requiere key de Groq activa</p>
                    </div>
                    {voiceProvider === 'groq' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1 leading-tight">Preciso con cualquier acento y ruido ambiente. ~300ms de respuesta. Gratis en tier Groq.</p>
                  {!hasGroq && <p className="text-[9px] text-amber-600 font-black mt-1.5">⚠ Añade la key de Groq en la sección IA para activar</p>}
                </button>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                3. TELEGRAM BOT
            ══════════════════════════════════════════════════════════════ */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-sky-400 rounded-t-[2.5rem]" />
              <SectionTitle icon={MessageCircle} title="Conexión Telegram" color="blue" />
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input type="password" name="telegramToken" value={config.telegramToken || ''} onChange={handleChange}
                    placeholder="Bot Token (@BotFather)"
                    className="w-full p-3 bg-slate-50 rounded-xl text-xs font-mono outline-none border border-slate-200 focus:border-blue-400" />
                  <input type="text" name="telegramChatId" value={config.telegramChatId || ''} onChange={handleChange}
                    placeholder="Chat ID"
                    className="w-full p-3 bg-slate-50 rounded-xl text-xs font-mono outline-none border border-slate-200 focus:border-blue-400" />
                </div>
                <button onClick={probarTelegram}
                  className="w-full py-2.5 bg-blue-50 text-blue-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-100 transition shadow-sm flex items-center justify-center gap-2">
                  <Send className="w-3 h-3" /> PROBAR CONEXIÓN TELEGRAM
                </button>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                4. MARKETING — Instagram Graph API + Google Drive
            ══════════════════════════════════════════════════════════════ */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 relative">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pink-500 via-rose-500 to-orange-400 rounded-t-[2.5rem]" />
              <SectionTitle icon={Megaphone} title="Marketing & Redes" color="pink" />

              <div className="space-y-3">
                {/* Instagram Graph API */}
                <div className="bg-pink-50 p-3 rounded-2xl border border-pink-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-pink-800 uppercase tracking-widest">📸 Instagram Graph API</span>
                    <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer"
                      className="text-[8px] font-bold text-pink-500 hover:underline">Generar token →</a>
                  </div>
                  <SecretInput value={igToken} onChange={setIgToken} placeholder="Token de página (EAAb...)" colorClass="pink" />
                  <input
                    type="text"
                    value={igPageId}
                    onChange={e => setIgPageId(e.target.value)}
                    placeholder="Instagram Business Account ID"
                    className="w-full p-3 bg-white rounded-xl text-xs font-mono font-bold border border-pink-200 focus:border-pink-400 outline-none transition-all text-pink-900"
                  />
                  <p className="text-[8px] text-pink-400 font-bold leading-tight">
                    Permite publicar desde MarketingView. Necesitas Facebook Business + cuenta Pro de Instagram. Token caduca cada 60 días.
                  </p>
                </div>

                {/* Google Drive */}
                <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100 space-y-2">
                  <span className="text-[10px] font-black text-amber-800 uppercase tracking-widest">📁 Google Drive (Fotos & Vídeos)</span>
                  <input
                    type="url"
                    name="driveUrl"
                    value={config.driveUrl || ''}
                    onChange={handleChange}
                    placeholder="https://drive.google.com/drive/folders/..."
                    className="w-full p-3 bg-white rounded-xl text-xs font-mono font-bold border border-amber-200 focus:border-amber-400 outline-none transition-all text-amber-900"
                  />
                  <p className="text-[8px] text-amber-500 font-bold leading-tight">Carpeta compartida con el contenido del restaurante para generar posts automáticos</p>
                </div>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                5. ENDPOINT PSD2 (BANCO)
            ══════════════════════════════════════════════════════════════ */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 relative">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-green-400 rounded-t-[2.5rem]" />
              <SectionTitle icon={LinkIcon} title="Endpoint PSD2" color="emerald" />
              <div className="space-y-3">
                <input type="text" name="n8nUrlBanco" value={config.n8nUrlBanco || ''} onChange={handleChange}
                  placeholder="Endpoint Backend PSD2 (sincronización bancaria)"
                  className="w-full p-3 bg-slate-50 rounded-xl text-[11px] font-mono outline-none border border-slate-200 focus:border-emerald-400 text-slate-500" />
                <p className="text-[9px] text-slate-400 font-bold leading-tight px-1">
                  URL del backend que gestiona la sincronización bancaria PSD2. Requiere certificados de servidor.
                </p>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                7. INTEGRACIONES EXTERNAS — Madisa / Restoo / Cover Manager…
            ══════════════════════════════════════════════════════════════ */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 relative lg:col-span-2">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400 rounded-t-[2.5rem]" />
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <Plug className="w-5 h-5 text-orange-500" />
                  Integraciones Externas
                  <span className="text-[9px] bg-orange-50 text-orange-500 px-2 py-1 rounded-full font-black uppercase border border-orange-100 ml-1">Restaurante</span>
                </h3>
                <button
                  type="button"
                  onClick={addExtIntegration}
                  className="flex items-center gap-1.5 text-[10px] font-black text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-3 py-2 rounded-xl transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Añadir app
                </button>
              </div>
              <p className="text-[9px] text-slate-400 font-bold mb-4 leading-tight">
                Guarda aquí los tokens de las apps que usas en el restaurante (Madisa, Restoo, Cover Manager, TPV…). Cuando integremos cada servicio, el código leerá la clave desde aquí automáticamente.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {extIntegrations.map((item, i) => (
                  <div key={i} className="bg-orange-50 border border-orange-100 rounded-2xl p-3 space-y-2 relative group">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item.name}
                        onChange={e => updateExtIntegration(i, 'name', e.target.value)}
                        placeholder="Nombre app (ej: Madisa)"
                        className="flex-1 p-2 bg-white rounded-xl text-xs font-black border border-orange-200 focus:border-orange-400 outline-none text-slate-800"
                      />
                      <button
                        type="button"
                        onClick={() => removeExtIntegration(i)}
                        className="text-slate-300 hover:text-rose-500 transition opacity-0 group-hover:opacity-100 shrink-0"
                        title="Eliminar integración"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                    </div>
                    <SecretInput
                      value={item.key}
                      onChange={v => updateExtIntegration(i, 'key', v)}
                      placeholder="API Key / Token..."
                      colorClass="orange"
                    />
                    {item.key.trim() && (
                      <p className="text-[8px] font-black text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Key guardada
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                8. EMPRESA Y REPARTOS
            ══════════════════════════════════════════════════════════════ */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <SectionTitle icon={Building2} title="Datos Comerciales" color="slate" />
                <div className="space-y-3">
                  <input type="text" name="empresa" placeholder="Nombre Comercial" value={config.empresa || ''} onChange={handleChange}
                    className="w-full p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none border border-slate-200" />
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" name="nif" placeholder="NIF / CIF" value={config.nif || ''} onChange={handleChange}
                      className="w-full p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none border border-slate-200" />
                    <input type="number" name="objetivoMensual" placeholder="Objetivo €" value={config.objetivoMensual || 0} onChange={handleChange}
                      className="w-full p-3 bg-emerald-50 rounded-xl text-xs font-black outline-none border border-emerald-100 text-emerald-700" />
                  </div>
                  <input type="number" name="saldoInicial" placeholder="Saldo Banco Inicial €" value={config.saldoInicial || 0} onChange={handleChange}
                    className="w-full p-3 bg-blue-50 rounded-xl text-xs font-black outline-none border border-blue-100 text-blue-700"
                    title="Saldo en Banco el día 1 de uso de Arume" />
                </div>
              </div>
              <div>
                <SectionTitle icon={Users} title="Repartos B2B" color="amber" />
                <div className="space-y-3">
                  {[
                    { label: 'Cocinero',    name: 'repartoDeliveryCocinero', def: 20 },
                    { label: 'Admin Ventas', name: 'repartoDeliveryAdmin',    def: 10 },
                  ].map(({ label, name, def }) => (
                    <div key={name} className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-black text-slate-400 uppercase ml-1">{label}</span>
                      <div className="relative w-24">
                        <input type="number" name={name} value={(config as Record<string, number>)[name] ?? def} onChange={handleChange}
                          className="w-full bg-white rounded-lg p-2 text-right font-black text-slate-800 outline-none border border-slate-200" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs pointer-events-none">%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                9. BÓVEDA DE SEGURIDAD & MANTENIMIENTO
            ══════════════════════════════════════════════════════════════ */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
              <SectionTitle icon={DownloadCloud} title="Bóveda de Seguridad & Mantenimiento" color="emerald" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <button onClick={handleGlobalBackup}
                  className="flex flex-col items-start p-4 bg-emerald-50 border border-emerald-200 hover:border-emerald-400 hover:shadow-md transition-all rounded-2xl text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <DownloadCloud className="w-4 h-4 text-emerald-600" />
                    <span className="font-black text-sm text-emerald-900">Backup Físico Total</span>
                  </div>
                  <p className="text-[10px] text-emerald-700/80 font-bold leading-tight">Descarga un JSON con toda tu base de datos actual para tener copias de seguridad locales.</p>
                </button>
                <PackGestoria data={db!} />
                <div className="flex flex-col justify-center h-full">
                  <ExportTools db={db} onSave={setDb} />
                </div>
                <button onClick={handleRepairAlbaranesSinSocio}
                  className="flex flex-col items-start p-4 bg-amber-50 border border-amber-200 hover:border-amber-400 hover:shadow-md transition-all rounded-2xl text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="w-4 h-4 text-amber-600" />
                    <span className="font-black text-sm text-amber-900">Reparar albaranes sin socio</span>
                  </div>
                  <p className="text-[10px] text-amber-700/80 font-bold leading-tight">
                    {(() => {
                      const n = (db?.albaranes || []).filter(a => !a.socio || String(a.socio).trim() === '').length;
                      return n > 0
                        ? `${n} albaranes sin socio detectados. Asigna "Arume" por defecto.`
                        : 'Todos los albaranes tienen socio ✓';
                    })()}
                  </p>
                </button>
                <button onClick={handleHardReset}
                  className="flex flex-col items-start p-4 bg-rose-50 border border-rose-200 hover:border-rose-400 hover:shadow-md transition-all rounded-2xl text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <Trash2 className="w-4 h-4 text-rose-500" />
                    <span className="font-black text-sm text-rose-900">Limpiar Caché Web</span>
                  </div>
                  <p className="text-[10px] text-rose-700/80 font-bold leading-tight">Usa esto si la app va lenta o no se actualiza. NO borra tus datos de Supabase.</p>
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <div className="p-6 bg-slate-50 border-t border-slate-200 shrink-0 flex items-center justify-between gap-4">
          <div className="hidden sm:flex flex-wrap gap-2">
            <StatusPill active={hasGemini}   label="Gemini" />
            <StatusPill active={hasGroq}     label="Groq" />
            <StatusPill active={hasCerebras} label="Cerebras" />
            <StatusPill active={hasDeepseek} label="DeepSeek" />
            <StatusPill active={hasMistral}  label="Mistral" />
            <StatusPill active={hasTelegram} label="Telegram" />
            <StatusPill active={hasPSD2}     label="PSD2" />
            <StatusPill active={hasIG}       label="Instagram" />
          </div>
          <button
            onClick={handleSaveAll}
            className={cn(
              'flex-1 sm:flex-none sm:min-w-[200px] py-4 px-8 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex justify-center items-center gap-2 shadow-xl',
              isSaved ? 'bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95'
            )}
          >
            {isSaved ? <CheckCircle2 className="w-5 h-5" /> : <Save className="w-5 h-5" />}
            {isSaved ? '¡GUARDADO!' : 'APLICAR CAMBIOS'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
