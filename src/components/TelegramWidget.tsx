import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Bot, Sparkles, Loader2, BarChart3, Mail, Building2, WifiOff } from 'lucide-react';
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
  isQueue?: boolean;
};

export const TelegramWidget = ({ currentModule, telegramToken, chatId }: TelegramWidgetProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPingRef = useRef<{module?: string; ts?: number}>({});
  const pingAbortRef = useRef<AbortController | null>(null);

  // 1. Auto-scroll hacia abajo
  useEffect(() => {
    if (messagesEndRef.current && isOpen) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history, isOpen]);

  // 2. Foco automático y cierre con Escape
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen]);

  // 3. RASTREADOR SILENCIOSO DE PESTAÑAS (Con Debounce, deduplicación y comprobación de visibilidad)
  useEffect(() => {
    if (!telegramToken || !chatId || !currentModule) return;
    if (document.visibilityState !== 'visible') return;

    // Dedupe si es el mismo módulo en menos de 60 segundos
    const now = Date.now();
    if (lastPingRef.current.module === currentModule && now - (lastPingRef.current.ts || 0) < 60_000) {
      return;
    }

    const controller = new AbortController();
    if (pingAbortRef.current) pingAbortRef.current.abort();
    pingAbortRef.current = controller;

    const t = setTimeout(async () => {
      try {
        await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🔄 *Navegación*\nEl usuario está ahora en el módulo: *${currentModule}*`,
            parse_mode: 'Markdown',
            disable_notification: true 
          }),
          signal: controller.signal
        });
        lastPingRef.current = { module: currentModule, ts: Date.now() };
      } catch (error) {
        // Silencioso. El ping no debe romper la UX.
      }
    }, 2500); // 2.5s debounce para no spamear si navega rápido

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [currentModule, telegramToken, chatId]);

  // 4. COLA OFFLINE (Reconecta y envía)
  useEffect(() => {
    const onOnline = async () => {
      if (pendingQueue.length > 0) {
        addSystemMessage('🌐 Conexión restaurada. Enviando mensajes pendientes...');
        for (const txt of pendingQueue) {
          await handleSendMessage(txt);
          await new Promise(r => setTimeout(r, 500)); // Pequeño respiro entre mensajes
        }
        setPendingQueue([]);
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [pendingQueue]);

  // 5. ENVÍO SEGURO DE MENSAJES (Manejando Rate Limits de Telegram)
  const addSystemMessage = (text: string) => {
    setHistory(prev => [...prev, { id: Date.now().toString() + Math.random(), text, sender: 'system', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
  };

  const safeSend = async (texto: string) => {
    if (!texto.trim() || isSending) return;

    if (!navigator.onLine) {
      setPendingQueue(q => [...q, texto]);
      setHistory(prev => [...prev, { id: Date.now().toString(), text, sender: 'user', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), isQueue: true }]);
      addSystemMessage('📥 Sin conexión. Mensaje puesto en cola.');
      setMessage('');
      return;
    }
    await handleSendMessage(texto);
  };

  const handleSendMessage = async (texto: string) => {
    if (!telegramToken || !chatId) return;
    
    setIsSending(true);
    setHistory(prev => [...prev, { id: Date.now().toString() + Math.random(), text, sender: 'user', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
    setMessage(''); 
    
    try {
      const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          // CUIDADO CON EL MARKDOWN: Si el usuario escribe caracteres raros, Telegram falla.
          // Mandamos el mensaje "en crudo" dentro de comillas para evitar errores de parseo.
          text: `🤖 *Comando desde la App (Módulo: ${currentModule})*\n\n💬 "${texto}"`,
          parse_mode: 'Markdown'
        })
      });
      
      if (response.status === 429) {
        throw new Error("429"); // Rate Limit de Telegram
      }
      
      if (!response.ok) throw new Error("Fallo en la API de Telegram");

      setTimeout(() => addSystemMessage("✅ Comando entregado a n8n."), 400);

    } catch (error: any) {
      console.error("Error enviando a Telegram", error);
      if (error.message === "429") {
        addSystemMessage("⏳ Telegram está limitando los mensajes. Espera un momento.");
      } else {
        addSystemMessage("❌ Error de red. No se pudo contactar con n8n.");
      }
    } finally {
      setIsSending(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // Comandos rápidos predefinidos
  const quickActions = [
    { label: "Saldo Banco", icon: Building2, text: "Dime el saldo del banco" },
    { label: "Sync Correos", icon: Mail, text: "Sincroniza las facturas IMAP" },
    { label: "Ventas Hoy", icon: BarChart3, text: "Dame un resumen de ventas de hoy" }
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
                    {navigator.onLine ? (
                      <><span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]"></span> n8n Online</>
                    ) : (
                      <><WifiOff className="w-3 h-3 text-rose-300" /> Fuera de línea</>
                    )}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)} 
                aria-label="Cerrar chat del asistente"
                className="hover:rotate-90 transition-transform bg-white/10 hover:bg-white/20 p-2.5 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
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
                      msg.sender === 'user' ? "bg-indigo-600 text-white self-end rounded-tr-sm" : "bg-white border border-slate-100 text-slate-700 self-start rounded-tl-sm",
                      msg.isQueue ? "opacity-70 border-dashed border border-white" : ""
                    )}
                  >
                    <p className="font-medium text-[13px] leading-snug">{msg.text}</p>
                    <span className={cn("text-[9px] font-bold block mt-2 text-right", msg.sender === 'user' ? "text-indigo-200" : "text-slate-400")}>
                      {msg.isQueue ? '⏳ En cola' : msg.time}
                    </span>
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
                  onClick={() => safeSend(action.text)}
                  disabled={isSending}
                  className="whitespace-nowrap px-4 py-2 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 text-[10px] font-black rounded-xl transition-colors border border-slate-200 hover:border-indigo-200 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <action.icon className="w-3 h-3" />
                  {action.label}
                </button>
              ))}
            </div>

            {/* INPUT DE MENSAJE */}
            <div className="p-3.5 bg-white border-t border-slate-100 flex gap-2 shrink-0">
              <input 
                ref={inputRef}
                type="text" 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    safeSend(message);
                  }
                }}
                aria-label="Escribir mensaje a Asistente Arume"
                placeholder={navigator.onLine ? "Escribe a n8n..." : "Sin red (se enviará luego)..."} 
                className="flex-1 bg-slate-50 text-sm font-bold rounded-2xl px-4 py-3.5 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 text-slate-700 border border-transparent focus:border-indigo-100 transition-all"
              />
              <button 
                onClick={() => safeSend(message)}
                disabled={!message.trim() || isSending}
                aria-label="Enviar mensaje"
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
        aria-label={isOpen ? "Cerrar chat del asistente" : "Abrir chat del asistente"}
        aria-expanded={isOpen}
        className={cn(
          "w-16 h-16 text-white rounded-[2rem] flex items-center justify-center shadow-[0_10px_40px_-10px_rgba(79,70,229,0.5)] hover:scale-105 transition-all duration-300 relative",
          isOpen ? "bg-slate-800 rotate-90 rounded-full" : "bg-gradient-to-tr from-indigo-600 to-blue-600"
        )}
      >
        {pendingQueue.length > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-rose-500 text-[8px] font-black items-center justify-center">{pendingQueue.length}</span>
          </span>
        )}
        {isOpen ? <X className="w-6 h-6 -rotate-90" /> : <MessageCircle className="w-7 h-7" />}
      </button>
    </div>
  );
};
