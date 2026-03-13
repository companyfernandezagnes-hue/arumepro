import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Save, Key, Eye, EyeOff, Bot, Link as LinkIcon, 
  Building2, Users, Sparkles, CheckCircle2, X, RefreshCw,
  Mail, MessageCircle, Send, ShieldAlert
} from 'lucide-react';
import { AppData } from '../types';
import { cn } from '../lib/utils';
import { NotificationService } from '../services/notifications';
import { ExportTools } from './ExportTools'; 

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: AppData | null;
  setDb: (db: AppData) => void;
  onSave: (db: AppData) => void;
}

export const SettingsModal = ({ isOpen, onClose, db, setDb, onSave }: SettingsModalProps) => {
  const [config, setConfig] = useState(db?.config || {});
  
  // APIs Locales
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(db?.config || {});
      setGeminiKey(localStorage.getItem('gemini_api_key') || '');
      setGroqKey(localStorage.getItem('groq_api_key') || '');
    }
  }, [isOpen, db]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value
    }));
  };

  const handleSaveAll = () => {
    if (!db) return;

    // 1. Claves de IA al navegador (Seguridad local)
    if (geminiKey.trim()) localStorage.setItem('gemini_api_key', geminiKey.trim());
    else localStorage.removeItem('gemini_api_key');

    if (groqKey.trim()) localStorage.setItem('groq_api_key', groqKey.trim());
    else localStorage.removeItem('groq_api_key');

    // 2. Guardamos en BD (Asegurando que existe la rama config)
    const newData = { ...db, config: { ...(db.config || {}), ...config } };
    setDb(newData); 
    onSave(newData); 

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1500);
  };

  const probarTelegram = async () => {
    if (!db || !config.telegramToken || !config.telegramChatId) {
      return alert("Falta el Token o el Chat ID para probar Telegram.");
    }
    const tempDb = { ...db, config: { ...db.config, telegramToken: config.telegramToken, telegramChatId: config.telegramChatId } };
    await NotificationService.sendAlert(tempDb, "🚀 *TEST DE CONEXIÓN EXITOSO*\n\nSi recibes esto, el ERP Arume está correctamente vinculado con tu Telegram. ¡Listo para recibir comandos!", "INFO");
    alert("Mensaje de prueba enviado. Revisa tu Telegram.");
  };

  return (
    <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4 sm:p-6 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm"
      />

      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="bg-slate-100 w-full max-w-5xl rounded-[3rem] shadow-2xl relative z-10 flex flex-col my-auto overflow-hidden border border-slate-200"
      >
        <button onClick={onClose} className="absolute top-6 right-6 text-white/70 hover:text-white z-20 bg-slate-900/50 p-2.5 rounded-full backdrop-blur-md transition hover:rotate-90">
          <X className="w-5 h-5" />
        </button>

        {/* HEADER */}
        <header className="bg-slate-900 p-8 text-white relative overflow-hidden shrink-0">
          <div className="absolute -right-10 -top-10 opacity-5"><Bot className="w-64 h-64" /></div>
          <div className="relative z-10">
            <h2 className="text-3xl font-black tracking-tighter flex items-center gap-3">
              Panel de Control <Sparkles className="w-6 h-6 text-indigo-400" />
            </h2>
            <p className="text-xs text-indigo-300 font-bold uppercase tracking-widest mt-1">Configuración Core del ERP Multi-Local</p>
          </div>
        </header>

        {/* CUERPO DEL PANEL (GRID 2 COLUMNAS) */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* 1. CEREBROS IA (Doble Motor) */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200 relative flex flex-col space-y-4">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
              
              <div className="bg-indigo-50 p-3 rounded-2xl border border-indigo-100">
                <h3 className="text-xs font-black text-indigo-800 uppercase tracking-widest flex items-center gap-2 mb-2"><Key className="w-4 h-4 text-indigo-500" /> API Gemini (Principal)</h3>
                <div className="relative">
                  <input type={showKey ? "text" : "password"} value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="AIzaSy..." className="w-full p-3 pr-12 bg-white rounded-xl text-xs font-mono font-bold text-indigo-900 border border-indigo-200 focus:border-indigo-400 outline-none transition-all" />
                  <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition">
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-xs font-black text-emerald-800 uppercase tracking-widest flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-emerald-500" /> API Groq (Respaldo)</h3>
                  <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-[9px] font-bold text-emerald-600 hover:underline">Obtener Gratis →</a>
                </div>
                <div className="relative">
                  <input type={showGroqKey ? "text" : "password"} value={groqKey} onChange={(e) => setGroqKey(e.target.value)} placeholder="gsk_..." className="w-full p-3 pr-12 bg-white rounded-xl text-xs font-mono font-bold text-emerald-900 border border-emerald-200 focus:border-emerald-400 outline-none transition-all" />
                  <button onClick={() => setShowGroqKey(!showGroqKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600 transition">
                    {showGroqKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* 2. TELEGRAM BOT */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200 relative overflow-hidden">
              <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2"><MessageCircle className="w-5 h-5 text-blue-500" /> Conexión Telegram</h3>
              <div className="space-y-3 relative z-10">
                <div className="grid grid-cols-2 gap-3">
                  <input type="password" name="telegramToken" value={config.telegramToken || ''} onChange={handleChange} placeholder="Bot Token (@BotFather)" className="w-full p-3 bg-slate-50 rounded-xl text-xs font-mono outline-none border border-slate-200 focus:border-blue-400" />
                  <input type="text" name="telegramChatId" value={config.telegramChatId || ''} onChange={handleChange} placeholder="Chat ID (Tu usuario)" className="w-full p-3 bg-slate-50 rounded-xl text-xs font-mono outline-none border border-slate-200 focus:border-blue-400" />
                </div>
                <button onClick={probarTelegram} className="w-full py-2.5 bg-blue-50 text-blue-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-100 transition shadow-sm flex items-center justify-center gap-2">
                  <Send className="w-3 h-3" /> PROBAR CONEXIÓN TELEGRAM
                </button>
              </div>
            </div>

            {/* 3. CORREOS IMAP (NUEVO) */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-black text-slate-800 flex items-center gap-2"><Mail className="w-5 h-5 text-rose-500" /> Correos IMAP</h3>
                <span className="text-[9px] bg-rose-50 text-rose-600 px-2 py-1 rounded-full font-black uppercase">Seguridad Google</span>
              </div>
              <div className="space-y-3">
                <input type="email" name="imapUser" value={config.imapUser || ''} onChange={handleChange} placeholder="Tu correo (ej: facturas@gmail.com)" className="w-full p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none border border-slate-200 focus:border-rose-400 text-slate-700" />
                <input type="password" name="imapPass" value={config.imapPass || ''} onChange={handleChange} placeholder="Contraseña de Aplicación (16 letras)" className="w-full p-3 bg-slate-50 rounded-xl text-xs font-mono outline-none border border-slate-200 focus:border-rose-400 text-slate-700" />
                <p className="text-[9px] text-slate-400 font-bold leading-tight px-1">
                  Usa una "Contraseña de aplicación" generada en tu cuenta de Google. No uses tu contraseña habitual.
                </p>
              </div>
            </div>

            {/* 4. WEBHOOKS N8N */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200">
              <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2"><LinkIcon className="w-5 h-5 text-emerald-500" /> Webhooks n8n</h3>
              <div className="space-y-3">
                <input type="text" name="n8nUrlBanco" value={config.n8nUrlBanco || ''} onChange={handleChange} placeholder="Webhook Sincronización Banco PSD2" className="w-full p-3 bg-slate-50 rounded-xl text-[11px] font-mono outline-none border border-slate-200 focus:border-emerald-400 text-slate-500" />
                <input type="text" name="n8nUrlIA" value={config.n8nUrlIA || ''} onChange={handleChange} placeholder="Webhook IA Externo (Opcional)" className="w-full p-3 bg-slate-50 rounded-xl text-[11px] font-mono outline-none border border-slate-200 focus:border-emerald-400 text-slate-500" />
              </div>
            </div>

            {/* 5. EMPRESA Y REPARTOS (Combinado) */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200 lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-slate-400" /> Datos Comerciales</h3>
                <div className="space-y-3">
                  <input type="text" name="empresa" placeholder="Nombre Comercial" value={config.empresa || ''} onChange={handleChange} className="w-full p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none border border-slate-200" />
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" name="nif" placeholder="NIF / CIF" value={config.nif || ''} onChange={handleChange} className="w-full p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none border border-slate-200" />
                    <input type="number" name="objetivoMensual" placeholder="Objetivo €" value={config.objetivoMensual || 0} onChange={handleChange} className="w-full p-3 bg-emerald-50 rounded-xl text-xs font-black outline-none border border-emerald-100 text-emerald-700" />
                  </div>
                  <input type="number" name="saldoInicial" placeholder="Saldo Banco Inicial €" value={config.saldoInicial || 0} onChange={handleChange} className="w-full p-3 bg-blue-50 rounded-xl text-xs font-black outline-none border border-blue-100 text-blue-700" title="Saldo en Banco el día 1 de uso de Arume" />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-amber-500" /> Repartos B2B</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-black text-slate-400 uppercase ml-1">Cocinero</span>
                    <div className="relative w-24">
                      <input type="number" name="repartoDeliveryCocinero" value={config.repartoDeliveryCocinero || 20} onChange={handleChange} className="w-full bg-white rounded-lg p-2 text-right font-black text-slate-800 outline-none border border-slate-200" />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs pointer-events-none">%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-black text-slate-400 uppercase ml-1">Admin Ventas</span>
                    <div className="relative w-24">
                      <input type="number" name="repartoDeliveryAdmin" value={config.repartoDeliveryAdmin || 10} onChange={handleChange} className="w-full bg-white rounded-lg p-2 text-right font-black text-slate-800 outline-none border border-slate-200" />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs pointer-events-none">%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 6. STATUS Y BACKUPS */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200 lg:col-span-2 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex flex-wrap justify-center md:justify-start gap-3 w-full md:w-auto">
                <div className={cn("px-3 py-2 rounded-xl border flex items-center gap-2", config.n8nUrlBanco ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700')}>
                  <div className={cn("w-2 h-2 rounded-full", config.n8nUrlBanco ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500')}></div>
                  <span className="text-[9px] font-black uppercase tracking-widest">n8n Banco</span>
                </div>
                <div className={cn("px-3 py-2 rounded-xl border flex items-center gap-2", config.telegramToken && config.telegramChatId ? 'bg-blue-50 border-blue-100 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-400')}>
                  <div className={cn("w-2 h-2 rounded-full", config.telegramToken && config.telegramChatId ? 'bg-blue-500 animate-pulse' : 'bg-slate-300')}></div>
                  <span className="text-[9px] font-black uppercase tracking-widest">Telegram</span>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto">
                <ExportTools db={db} onSave={setDb} />
                <button onClick={() => window.location.reload()} className="p-3 bg-slate-100 rounded-xl hover:bg-slate-200 transition group border border-slate-200" title="Recargar App">
                  <RefreshCw className="w-4 h-4 text-slate-600 group-hover:rotate-180 transition-transform duration-500" />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* FOOTER - GUARDAR */}
        <div className="p-6 bg-slate-50 border-t border-slate-200 shrink-0">
          <button onClick={handleSaveAll} className={cn("w-full py-5 rounded-[2rem] font-black text-sm uppercase tracking-widest transition-all flex justify-center items-center gap-2 shadow-xl", isSaved ? "bg-emerald-500 text-white" : "bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95")}>
            {isSaved ? <CheckCircle2 className="w-5 h-5" /> : <Save className="w-5 h-5" />}
            {isSaved ? "¡CONFIGURACIÓN GUARDADA!" : "GUARDAR Y APLICAR CAMBIOS"}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
