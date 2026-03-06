import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, RefreshCw } from 'lucide-react';
import { AppData } from '../types';
import { NotificationService } from '../services/notifications';
import { ExportTools } from './ExportTools'; // 🚀 La nueva herramienta del código 1

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: AppData | null;
  setDb: (db: AppData) => void;
  onSave: (db: AppData) => void;
}

export const SettingsModal = ({ isOpen, onClose, db, setDb, onSave }: SettingsModalProps) => {
  const [objetivo, setObjetivo] = useState(db?.config?.objetivoMensual || 40000);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        // 🚀 FIX: Añadido overflow para que no se corte en pantallas pequeñas de móvil
        className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl relative z-10 max-h-[90vh] overflow-y-auto custom-scrollbar"
      >
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500 text-2xl transition">✕</button>
        
        <header className="text-center mb-8">
          <div className="w-14 h-14 bg-slate-900 text-white rounded-full flex items-center justify-center text-2xl mx-auto mb-3 shadow-lg">⚙️</div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Ajustes</h2>
          <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Panel de Control</p>
        </header>

        <div className="space-y-6">
          {/* --- BLOQUE 1: DATOS Y CREDENCIALES --- */}
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-2">Objetivo Mensual (€)</label>
            <div className="flex gap-2 mb-4">
              <input 
                type="number" 
                value={objetivo}
                onChange={(e) => setObjetivo(Number(e.target.value))}
                placeholder="Ej. 30000" 
                className="w-full p-3 bg-white rounded-xl font-black text-lg outline-none border border-slate-200 focus:border-indigo-500 transition-colors"
              />
              <button 
                onClick={() => {
                  if(db) onSave({ ...db, config: { ...db.config, objetivoMensual: objetivo } });
                  onClose();
                }} 
                className="bg-indigo-600 text-white px-6 rounded-xl font-black text-xs shadow-lg hover:bg-indigo-700 transition-colors"
              >
                GUARDAR
              </button>
            </div>

            <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-2">Webhook IA Analista (n8n)</label>
            <input 
              type="text" 
              value={db?.config?.n8nUrlIA || ''}
              onChange={(e) => {
                if(db) setDb({ ...db, config: { ...db.config, n8nUrlIA: e.target.value } });
              }}
              placeholder="https://n8n.tu-servidor.com/..." 
              className="w-full p-3 bg-white rounded-xl font-bold text-[10px] outline-none border border-slate-200 focus:border-indigo-500 transition-colors mb-4"
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-2">Telegram Token</label>
                <input 
                  type="password" 
                  value={db?.config?.telegramToken || ''}
                  onChange={(e) => {
                    if(db) setDb({ ...db, config: { ...db.config, telegramToken: e.target.value } });
                  }}
                  placeholder="Token del Bot" 
                  className="w-full p-3 bg-white rounded-xl font-bold text-[10px] outline-none border border-slate-200 focus:border-indigo-500 transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-2">Telegram Chat ID</label>
                <input 
                  type="text" 
                  value={db?.config?.telegramChatId || ''}
                  onChange={(e) => {
                    if(db) setDb({ ...db, config: { ...db.config, telegramChatId: e.target.value } });
                  }}
                  placeholder="ID del Chat" 
                  className="w-full p-3 bg-white rounded-xl font-bold text-[10px] outline-none border border-slate-200 focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
            
            <button 
              onClick={async () => {
                if(db) {
                  await NotificationService.sendAlert(db, "🚀 *TEST DE CONEXIÓN*\n\nSi recibes esto, el ERP Arume está correctamente vinculado con tu Telegram via n8n.", "INFO");
                  alert("Test enviado. Revisa tu Telegram.");
                }
              }}
              className="w-full mt-4 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-100 transition shadow-sm"
            >
              PROBAR TELEGRAM
            </button>
          </div>

          {/* --- BLOQUE 2: INDICADORES VISUALES (Mantenemos tu diseño de GitHub) --- */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className={`p-3 rounded-2xl border flex items-center gap-2 ${db?.config?.n8nUrlIA ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'}`}>
              <div className={`w-2 h-2 rounded-full ${db?.config?.n8nUrlIA ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
              <span className="text-[9px] font-black uppercase tracking-tighter">IA / n8n Link</span>
            </div>
            <div className={`p-3 rounded-2xl border flex items-center gap-2 ${db?.config?.telegramToken && db?.config?.telegramChatId ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'}`}>
              <div className={`w-2 h-2 rounded-full ${db?.config?.telegramToken && db?.config?.telegramChatId ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
              <span className="text-[9px] font-black uppercase tracking-tighter">Telegram Bot</span>
            </div>
          </div>

          {/* --- BLOQUE 3: HERRAMIENTAS DE EXPORTACIÓN Y BACKUP --- */}
          {/* Aquí inyectamos el nuevo componente que maneja Excel, PDF y Backups */}
          <ExportTools db={db} onSave={onSave} />

          {/* --- BLOQUE 4: RECARGAR APP --- */}
          <div className="flex justify-center mt-2">
            <button onClick={() => window.location.reload()} className="w-full p-4 bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-200 transition group">
              <RefreshCw className="w-5 h-5 text-slate-600 group-hover:rotate-180 transition-transform duration-500" />
              <span className="text-[10px] font-black text-slate-600 uppercase">Recargar App</span>
            </button>
          </div>

        </div>
      </motion.div>
    </div>
  );
};
