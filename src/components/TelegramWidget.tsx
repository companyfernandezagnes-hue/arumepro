import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Bot, Sparkles, Zap, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
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

  // Auto-scroll hacia abajo cuando hay un mensaje nuevo
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history, isOpen]);

  // Si cambia el módulo, añadimos un log interno
  useEffect(() => {
    if (currentModule && telegramToken && chatId) {
      enviarMensajeATelegram(`🔄 Usuario navegando en el módulo: *${currentModule}*`, true);
    }
  }, [currentModule]);

  const addSystemMessage = (text: string) => {
    setHistory(prev => [...prev, { id: Date.now().toString(), text, sender: 'system', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
  };

  const enviarMensajeATelegram = async (texto: string, silencioso = false) => {
    if (!telegramToken || !chatId || !texto.trim()) return;
    
    if (!silencioso) {
      setIsSending(true);
      // Añadimos el mensaje del usuario al historial local
      setHistory(prev => [...prev, { id: Date.now().toString(), text, sender: 'user', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
    }
    
    try {
      const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: silencioso ? texto : `🤖 *Comando desde la App (Módulo: ${currentModule})*\n\n💬 "${texto}"`,
          parse_mode: 'Markdown',
          disable_notification: silencioso 
        })
      });
      
      if (!response.ok) throw new Error("Fallo en la API de Telegram");

      if (!silencioso) {
        setMessage('');
        setTimeout(() => addSystemMessage("✅ Comando enviado a n8n con éxito."), 600);
      }
    } catch (error) {
      console.error("Error enviando a Telegram", error);
      if (!silencioso) addSystemMessage("❌ Error al enviar el mensaje. Revisa tu conexión.");
    } finally {
      setIsSending(false);
    }
  };

  // Comandos rápidos predefinidos para n8n
  const quickActions = [
    "🏦 Dime el saldo del banco",
    "📧 Sincroniza las facturas",
    "📊 Resumen de ventas de hoy"
  ];

  // Si no hay token, no mostramos el botón flotante para no estorbar
  if (!telegramToken || !chatId) {
    return null; 
  }

  return (
    <div className="fixed bottom-24 right-6 z-[9999] flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.9, transformOrigin: 'bottom right' }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="mb-4 w-[340px] bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col h-[450px]"
          >
            {/* HEADER DEL CHAT */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white flex justify-between items-center shrink-0 shadow-md relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
                  <Bot className="w-6 h-6 text-white" />
                </div>
                <div>
                  <span className="font-black text-base block leading-none">Asistente Arume</span>
                  <span className="text-[10px] text-blue-200 font-bold uppercase tracking-widest flex items-center gap-1 mt-1">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span> n8n Conectado
                  </span>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="hover:rotate-90 transition-transform bg-white/10 hover:bg-white/20 p-2 rounded-full"><X className="w-4 h-4" /></button>
            </div>
            
            {/* CUERPO DEL CHAT (HISTORIAL) */}
            <div className="flex-1 bg-slate-50 p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center my-2">Módulo: {currentModule}</p>
              
              {history.length === 0 ? (
                <div className="m-auto text-center opacity-60">
                  <Sparkles className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest">¿En qué te ayudo?</p>
                  <p className="text-[10px] font-medium text-slate-400 mt-1">Escribe un comando para n8n.</p>
                </div>
              ) : (
                history.map((msg) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    key={msg.id} 
                    className={cn("max-w-[85%] rounded-2xl p-3 text-sm shadow-sm relative", 
                      msg.sender === 'user' ? "bg-indigo-600 text-white self-end rounded-tr-sm" : "bg-white border border-slate-100 text-slate-700 self-start rounded-tl-sm"
                    )}
                  >
                    <p className="font-medium">{msg.text}</p>
                    <span className={cn("text-[8px] font-bold block mt-1 text-right", msg.sender === 'user' ? "text-indigo-200" : "text-slate-400")}>{msg.time}</span>
                  </motion.div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* CHIPS RÁPIDOS */}
            <div className="bg-white px-3 py-2 border-t border-slate-100 flex gap-2 overflow-x-auto no-scrollbar shrink-0">
              {quickActions.map((action, idx) => (
                <button 
                  key={idx} 
                  onClick={() => enviarMensajeATelegram(action)}
                  className="whitespace-nowrap px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 text-[10px] font-black rounded-full transition-colors border border-slate-200 hover:border-indigo-200"
                >
                  {action}
                </button>
              ))}
            </div>

            {/* INPUT DE MENSAJE */}
            <div className="p-3 bg-white border-t border-slate-100 flex gap-2 shrink-0">
              <input 
                type="text" 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && enviarMensajeATelegram(message)}
                placeholder="Mensaje para n8n..." 
                className="flex-1 bg-slate-100 text-xs font-bold rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
              />
              <button 
                onClick={() => enviarMensajeATelegram(message)}
                disabled={!message || isSending}
                className="bg-blue-600 text-white w-10 h-10 rounded-2xl flex items-center justify-center hover:bg-blue-700 transition-colors disabled:opacity-50 active:scale-95 shrink-0 shadow-md"
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BOTÓN FLOTANTE */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-16 h-16 text-white rounded-[2rem] flex items-center justify-center shadow-[0_10px_40px_-10px_rgba(59,130,246,0.6)] hover:scale-105 transition-all duration-300",
          isOpen ? "bg-slate-800 rotate-90 rounded-full" : "bg-gradient-to-tr from-blue-600 to-indigo-600"
        )}
      >
        {isOpen ? <X className="w-6 h-6 -rotate-90" /> : <MessageCircle className="w-7 h-7" />}
      </button>
    </div>
  );
};
