import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Save, Key, Eye, EyeOff, Bot, Link as LinkIcon, 
  Building2, Users, Smartphone, Sparkles, CheckCircle2, X, RefreshCw
} from 'lucide-react';
import { AppData } from '../types';
import { cn } from '../lib/utils';
import { NotificationService } from '../services/notifications';
import { ExportTools } from './ExportTools'; // 🚀 Herramienta de exportación recuperada

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: AppData | null;
  setDb: (db: AppData) => void;
  onSave: (db: AppData) => void;
}

export const SettingsModal = ({ isOpen, onClose, db, setDb, onSave }: SettingsModalProps) => {
  // Estado local para no tocar la BD hasta que no se pulse "Guardar"
  const [config, setConfig] = useState(db?.config || {});
  
  // Estado para la clave IA (Memoria del navegador)
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(db?.config || {});
      const savedKey = localStorage.getItem('gemini_api_key');
      if (savedKey) setApiKey(savedKey);
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

    // 1. Clave de IA al navegador
    if (apiKey.trim()) {
      localStorage.setItem('gemini_api_key', apiKey.trim());
    } else {
      localStorage.removeItem('gemini_api_key');
    }

    // 2. Guardamos en BD
    const newData = { ...db, config: { ...db.config, ...config } };
    setDb(newData); // Actualiza estado en vivo
    onSave(newData); // Escribe en archivo/nube

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4 sm:p-6">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
      />

      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }} 
        animate={{ scale: 1, opacity: 1, y: 0 }} 
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="bg-slate-50 w-full max-w-4xl rounded-[3rem] shadow-2xl relative z-10 flex flex-col max-h-[95vh] overflow-hidden"
      >
        <button 
          onClick={onClose} 
          className="absolute top-6 right-6 text-white/70 hover:text-white z-20 bg-slate-900/50 p-2 rounded-full backdrop-blur-md transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <header className="bg-slate-900 p-8 text-white relative overflow-hidden shrink-0">
          <div className="absolute -right-10 -top-10 opacity-10">
            <Bot className="w-48 h-48" />
          </div>
          <div className="relative z-10">
            <h2 className="text-3xl font-black tracking-tighter flex items-center gap-3">
              Panel de Control <Sparkles className="w-6 h-6 text-indigo-400" />
            </h2>
            <p className="text-xs text-indigo-300 font-bold uppercase tracking-widest mt-1">
              Configuración Core del ERP Multi-Local
            </p>
          </div>
        </header>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* BLOQUE 1: CEREBRO IA */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border-2 border-indigo-50 relative flex flex-col">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
              <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                <Key className="w-5 h-5 text-indigo-500" /> Cerebro IA (Gemini)
              </h3>
              <p className="text-xs text-slate-500 font-bold mb-4">
                Pega aquí tu API Key de Google Gemini para habilitar el escáner de tickets y la IA del ERP.
              </p>
              <div className="relative mb-4 mt-auto">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full p-4 pr-12 bg-slate-50 rounded-2xl text-sm font-mono font-bold text-indigo-900 border border-slate-200 focus:border-indigo-400 outline-none transition-all"
                />
                <button 
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition"
                >
                  {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* BLOQUE 2: REGLAS B2B Y SOCIOS */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
              <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-500" /> Repartos B2B (Catering)
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-1 block">Cocinero (% Beneficio)</label>
                  <div className="relative">
                    <input
                      type="number"
                      name="repartoDeliveryCocinero"
                      value={config.repartoDeliveryCocinero || 20}
                      onChange={handleChange}
                      className="w-full p-3 bg-slate-50 rounded-xl text-lg font-black text-slate-800 outline-none"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">%</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-1 block">Administrador Ventas (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      name="repartoDeliveryAdmin"
                      value={config.repartoDeliveryAdmin || 10}
                      onChange={handleChange}
                      className="w-full p-3 bg-slate-50 rounded-xl text-lg font-black text-slate-800 outline-none"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* BLOQUE 3: INFO EMPRESA */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
              <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-slate-400" /> Datos de Empresa
              </h3>
              <div className="space-y-3">
                <input
                  type="text"
                  name="empresa"
                  placeholder="Nombre Comercial"
                  value={config.empresa || ''}
                  onChange={handleChange}
                  className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold outline-none"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    name="nif"
                    placeholder="NIF / CIF"
                    value={config.nif || ''}
                    onChange={handleChange}
                    className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold outline-none"
                  />
                  <input
                    type="number"
                    name="objetivoMensual"
                    placeholder="Objetivo €"
                    value={config.objetivoMensual || 0}
                    onChange={handleChange}
                    className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold outline-none text-emerald-600"
                  />
                </div>
              </div>
            </div>

            {/* BLOQUE 4: AUTOMATIZACIONES Y WEBHOOKS */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
              <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                <LinkIcon className="w-5 h-5 text-emerald-500" /> Enlaces & Webhooks
              </h3>
              <div className="space-y-3">
                <input
                  type="text"
                  name="n8nUrlIA"
                  placeholder="Webhook n8n (Alertas)"
                  value={config.n8nUrlIA || ''}
                  onChange={handleChange}
                  className="w-full p-3 bg-slate-50 rounded-xl text-[10px] font-mono outline-none text-slate-500"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="password"
                    name="telegramToken"
                    placeholder="Telegram Token"
                    value={config.telegramToken || ''}
                    onChange={handleChange}
                    className="w-full p-3 bg-slate-50 rounded-xl text-[10px] font-mono outline-none text-slate-500"
                  />
                  <input
                    type="text"
                    name="telegramChatId"
                    placeholder="Telegram Chat ID"
                    value={config.telegramChatId || ''}
                    onChange={handleChange}
                    className="w-full p-3 bg-slate-50 rounded-xl text-[10px] font-mono outline-none text-slate-500"
                  />
                </div>
                <button 
                  onClick={async () => {
                    if(db) {
                      await NotificationService.sendAlert(db, "🚀 *TEST DE CONEXIÓN*\n\nSi recibes esto, el ERP Arume está correctamente vinculado con tu Telegram.", "INFO");
                      alert("Test enviado. Revisa tu Telegram.");
                    }
                  }}
                  className="w-full py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-100 transition shadow-sm"
                >
                  PROBAR TELEGRAM
                </button>
              </div>
            </div>

            {/* BLOQUE 5: INDICADORES Y EXPORTACIÓN */}
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Indicadores de Salud (Los de Github) */}
              <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col justify-center">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className={cn("p-3 rounded-2xl border flex items-center gap-2", config.n8nUrlIA ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700')}>
                    <div className={cn("w-2 h-2 rounded-full", config.n8nUrlIA ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500')}></div>
                    <span className="text-[9px] font-black uppercase tracking-tighter">IA / n8n Link</span>
                  </div>
                  <div className={cn("p-3 rounded-2xl border flex items-center gap-2", config.telegramToken && config.telegramChatId ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700')}>
                    <div className={cn("w-2 h-2 rounded-full", config.telegramToken && config.telegramChatId ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500')}></div>
                    <span className="text-[9px] font-black uppercase tracking-tighter">Telegram Bot</span>
                  </div>
                </div>

                <button onClick={() => window.location.reload()} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-100 transition group">
                  <RefreshCw className="w-4 h-4 text-slate-500 group-hover:rotate-180 transition-transform duration-500" />
                  <span className="text-[10px] font-black text-slate-500 uppercase">Recargar App Completa</span>
                </button>
              </div>

              {/* Herramientas de Backup Originales */}
              <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex items-center justify-center">
                 {/* 🚀 Recuperado el componente ExportTools */}
                 <ExportTools db={db} onSave={onSave} />
              </div>

            </div>
          </div>
        </div>

        {/* Footer del Modal (Botón Guardar) */}
        <div className="p-6 bg-white border-t border-slate-100 shrink-0">
          <button 
            onClick={handleSaveAll}
            className={cn(
              "w-full py-5 rounded-[2rem] font-black text-sm uppercase tracking-widest transition-all flex justify-center items-center gap-2 shadow-xl",
              isSaved ? "bg-emerald-500 text-white" : "bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95"
            )}
          >
            {isSaved ? <CheckCircle2 className="w-5 h-5" /> : <Save className="w-5 h-5" />}
            {isSaved ? "¡CONFIGURACIÓN GUARDADA!" : "GUARDAR Y APLICAR CAMBIOS"}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
