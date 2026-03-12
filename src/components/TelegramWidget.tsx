import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Bot, Sparkles, Loader2, BarChart3, Mail, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';

interface TelegramWidgetProps {
  currentModule: string;
  telegramToken?: string;
  chatId?: string;
}

type ChatMessage = {
  id: string;
  text: string;
  sender: 'user' | 'system';
  time: string;
};

export const TelegramWidget = ({ currentModule, telegramToken, chatId }: TelegramWidgetProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Auto-scroll hacia abajo
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history, isOpen]);

  // 2. Cerrar con la tecla ESCAPE
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // 3. RASTREADOR SILENCIOSO DE PESTAÑAS (Carril separado para no bloquear la UI)
  useEffect(() => {
    if (!currentModule || !telegramToken || !chatId) return;
    
    const sendSilentPing = async () => {
      try {
        await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🔄 *Navegación*\nEl usuario está ahora en el módulo: *${currentModule}*`,
            parse_mode: 'Markdown',
            disable_notification: true 
          })
        });
      } catch (error) {
        // Ignoramos silenciosamente si falla la red al rastrear
      }
    };
    
    sendSilentPing();
  }, [currentModule, telegramToken, chatId]);

  // 4. ENVÍO DE MENSAJES DEL USUARIO
  const addSystemMessage = (text: string) => {
    setHistory(prev => [...prev, { id: Date.now().toString(), text, sender: 'system', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
  };

  const handleSendMessage = async (texto: string) => {
    if (!telegramToken || !chatId || !texto.trim() || isSending) return;
    
    setIsSending(true);
    setHistory(prev => [...prev, { id: Date.now().toString(), text, sender: 'user', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
    setMessage(''); // Vaciamos el input inmediatamente para dar sensación de rapidez
    
    try {
      const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🤖 *Comando desde la App (Módulo: ${currentModule})*\n\n💬 "${texto}"`,
          parse_mode: 'Markdown'
        })
      });
      
      if (!response.ok) throw new Error("Fallo en la API de Telegram");

      setTimeout(() => addSystemMessage("✅ Comando entregado a n8n."), 400);
    } catch (error) {
      console.error("Error enviando a Telegram", error);
      addSystemMessage("❌ Error de red. No se pudo contactar con n8n.");
    } finally {
      setIsSending(false);
    }
  };

  // Comandos rápidos predefinidos con iconos
  const quickActions = [
    { label: "Saldo Banco", icon: Building2, text: "Dime el saldo del banco" },
    { label: "Sincronizar Correos", icon: Mail, text: "Sincroniza las facturas IMAP" },
    { label: "Resumen Ventas", icon: BarChart3, text: "Dame un resumen de ventas de hoy" }
  ];

  if (!telegramToken || !chatId) return null;

  return (
    <div className="fixed bottom-24 right-6 z-[9999] flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.9, transformOrigin: 'bottom right' }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="mb-4 w-[350px] bg-white rounded-[2.5rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] border border-slate-100 overflow-hidden flex flex-col h-[500px]"
          >
            {/* HEADER DEL CHAT */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white flex justify-between items-center shrink-0 shadow-md relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm shadow-inner">
                  <Bot className="w-6 h-6 text-white" />
                </div>
                <div>
                  <span className="font-black text-base block leading-none">Asistente Arume</span>
                  <span className="text-[10px] text-blue-200 font-bold uppercase tracking-widest flex items-center gap-1.5 mt-1.5">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]"></span> n8n Online
                  </span>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="hover:rotate-90 transition-transform bg-white/10 hover:bg-white/20 p-2.5 rounded-full"><X className="w-4 h-4" /></button>
            </div>
            
            {/* CUERPO DEL CHAT (HISTORIAL) */}
            <div className="flex-1 bg-slate-50 p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
              <div className="flex justify-center mb-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-200/50 px-3 py-1 rounded-full">Módulo: {currentModule}</span>
              </div>
              
              {history.length === 0 ? (
                <div className="m-auto text-center opacity-60 px-4">
                  <Sparkles className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                  <p className="text-sm font-black text-slate-500 uppercase tracking-widest">¿Qué necesitas?</p>
                  <p className="text-[11px] font-medium text-slate-400 mt-2 leading-relaxed">Escribe un comando y la IA de n8n lo ejecutará en tiempo real.</p>
                </div>
              ) : (
                history.map((msg) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    key={msg.id} 
                    className={cn("max-w-[85%] rounded-2xl p-3.5 text-sm shadow-sm relative", 
                      msg.sender === 'user' ? "bg-indigo-600 text-white self-end rounded-tr-sm" : "bg-white border border-slate-100 text-slate-700 self-start rounded-tl-sm"
                    )}
                  >
                    <p className="font-medium text-[13px] leading-snug">{msg.text}</p>
                    <span className={cn("text-[9px] font-bold block mt-2 text-right", msg.sender === 'user' ? "text-indigo-200" : "text-slate-400")}>{msg.time}</span>
                  </motion.div>
                ))
              )}
              {isSending && (
                <div className="self-end bg-indigo-600/50 text-white rounded-2xl rounded-tr-sm px-4 py-2 flex gap-1">
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce"></span>
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* CHIPS RÁPIDOS */}
            <div className="bg-white px-3 py-3 border-t border-slate-100 flex gap-2 overflow-x-auto no-scrollbar shrink-0 shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.05)]">
              {quickActions.map((action, idx) => (
                <button 
                  key={idx} 
                  onClick={() => handleSendMessage(action.text)}
                  className="whitespace-nowrap px-4 py-2 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 text-[10px] font-black rounded-xl transition-colors border border-slate-200 hover:border-indigo-200 flex items-center gap-1.5"
                >
                  <action.icon className="w-3 h-3" />
                  {action.label}
                </button>
              ))}
            </div>

            {/* INPUT DE MENSAJE */}
            <div className="p-3.5 bg-white border-t border-slate-100 flex gap-2 shrink-0">
              <input 
                type="text" 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(message)}
                placeholder="Escribe a n8n..." 
                className="flex-1 bg-slate-50 text-sm font-bold rounded-2xl px-4 py-3.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 text-slate-700 border border-transparent focus:border-indigo-100 transition-all"
              />
              <button 
                onClick={() => handleSendMessage(message)}
                disabled={!message.trim() || isSending}
                className="bg-indigo-600 text-white w-12 h-12 rounded-2xl flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:opacity-50 active:scale-95 shrink-0 shadow-md"
              >
                {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 ml-1" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BOTÓN FLOTANTE */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-16 h-16 text-white rounded-[2rem] flex items-center justify-center shadow-[0_10px_40px_-10px_rgba(79,70,229,0.5)] hover:scale-110 transition-all duration-300",
          isOpen ? "bg-slate-800 rotate-90 rounded-full" : "bg-gradient-to-tr from-indigo-600 to-blue-600"
        )}
      >
        {isOpen ? <X className="w-6 h-6 -rotate-90" /> : <MessageCircle className="w-7 h-7" />}
      </button>
    </div>
  );
};
