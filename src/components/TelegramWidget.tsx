import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Bot, Sparkles, Loader2, BarChart3, Mail, Building2, WifiOff, Zap, Mic, Square, TerminalSquare } from 'lucide-react';
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
  sender: 'user' | 'system' | 'ai';
  time: string;
  isQueue?: boolean;
};

// 🛡️ FIX CRÍTICO: Formateador a prueba de balas (Evita el pantallazo azul)
const formatMarkdown = (text?: string) => {
  if (!text) return null;
  try {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-black text-indigo-900">{part.slice(2, -2)}</strong>;
      if (part.startsWith('*') && part.endsWith('*')) return <em key={i} className="font-bold text-indigo-800">{part.slice(1, -1)}</em>;
      return <span key={i}>{part}</span>;
    });
  } catch (e) {
    return <span>{text}</span>;
  }
};

// 🛡️ Helper para llamadas con límite de tiempo (Evita bloqueos infinitos)
const fetchWithTimeout = async (resource: string, options: RequestInit & { timeout?: number } = {}) => {
  const { timeout = 10000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, { ...options, signal: controller.signal });
  clearTimeout(id);
  return response;
};

export const TelegramWidget = ({ currentModule, telegramToken, chatId }: TelegramWidgetProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (messagesEndRef.current && isOpen) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history, isOpen]);

  // Foco y Escape
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen]);

  const addSystemMessage = (text: string, type: 'system' | 'ai' = 'system') => {
    if (!text) return;
    setHistory(prev => [...prev, { id: Date.now().toString() + Math.random(), text, sender: type, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
  };

  /* =======================================================
   * 📡 INNOVACIÓN: ESCUCHA DE ALERTAS GLOBALES DE LA APP
   * ======================================================= */
  useEffect(() => {
    // Esto permite que otras pantallas (como Albaranes) envíen alertas a Telegram
    const handleAppAlert = async (e: any) => {
      const alerta = e.detail;
      if (alerta && telegramToken && chatId) {
        try {
          addSystemMessage(`🔔 Alerta detectada: ${alerta}`, 'system');
          await fetchWithTimeout(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: `🚨 *ALERTA ARUME*\n\n${alerta}`, parse_mode: 'Markdown' })
          }, { timeout: 5000 });
        } catch (err) {
          console.warn("No se pudo enviar la alerta automática a Telegram.");
        }
      }
    };

    window.addEventListener('arume-bot-alert', handleAppAlert);
    return () => window.removeEventListener('arume-bot-alert', handleAppAlert);
  }, [telegramToken, chatId]);

  // Reconexión y cola offline
  useEffect(() => {
    const onOnline = async () => {
      if (pendingQueue.length > 0) {
        addSystemMessage('🌐 Red restaurada. Sincronizando comandos pendientes...');
        const queueCopy = [...pendingQueue];
        setPendingQueue([]);
        for (const txt of queueCopy) {
          await processInteraction(txt);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [pendingQueue]);

  /* =======================================================
   * 🎤 RECONOCIMIENTO DE VOZ WEB
   * ======================================================= */
  const toggleVoiceRecord = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      return alert("Tu navegador no soporta dictado por voz.");
    }
    
    if (isRecording) {
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.interimResults = false;
    
    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setMessage(transcript);
      setIsRecording(false);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    
    recognition.start();
  };

  /* =======================================================
   * 🧠 DOBLE CEREBRO BLINDADO (GROQ + TELEGRAM)
   * ======================================================= */
  const processInteraction = async (texto: string) => {
    setIsSending(true);
    setHistory(prev => [...prev, { id: Date.now().toString(), text, sender: 'user', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
    setMessage(''); 
    
    if (texto.toLowerCase().startsWith('/')) {
      addSystemMessage(`🔧 Ejecutando comando local interno: ${texto}`, 'system');
      setIsSending(false);
      return; 
    }

    // 1. ENVÍO A TELEGRAM (CON TIMEOUT PARA EVITAR BLOQUEOS)
    let telegramSuccess = false;
    if (telegramToken && chatId) {
      try {
        const safeText = texto.replace(/["\\]/g, ''); 
        const invisibleContext = `\n\n\`[Contexto App: Módulo ${currentModule}]\``;
        
        await fetchWithTimeout(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `⚡ *Orden de Arume Pro*\n💬 "${safeText}"${invisibleContext}`,
            parse_mode: 'Markdown'
          }),
          timeout: 8000 // Si en 8 segundos no responde, aborta
        });
        telegramSuccess = true;
      } catch (error) {
        console.warn("Aviso: Fallo de conexión con Telegram API.");
      }
    }

    // 2. CEREBRO GROQ (Llama 3 70B) BLINDADO
    try {
      const groqKey = sessionStorage.getItem('groq_api_key') || localStorage.getItem('groq_api_key');
      
      if (!groqKey) {
        addSystemMessage(telegramSuccess 
          ? "✅ Orden enviada a tu móvil. (Añade tu API Key de GROQ en Ajustes para chatear aquí mismo)." 
          : "❌ Error de conexión. Configura las APIs en Ajustes.", 'system');
      } else {
        const prompt = `Eres ArumeBot, el asistente ERP del restaurante. 
        El usuario está en el módulo "${currentModule}".
        Acaba de ordenar: "${texto}".
        Responde en 1 o 2 líneas máximo. Sé profesional, directo y al grano.`;

        const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "llama3-70b-8192",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3
          }),
          timeout: 10000 // 10 segundos máximo para la IA
        });

        if (!res.ok) throw new Error("Fallo en la respuesta de Groq");
        const data = await res.json();
        
        const aiResponse = data?.choices?.[0]?.message?.content;
        if (aiResponse) {
          addSystemMessage(aiResponse, 'ai');
        } else {
          throw new Error("Respuesta vacía de la IA");
        }
      }
    } catch (error) {
      addSystemMessage(telegramSuccess ? "✅ Mensaje enviado a tu móvil (La IA local no pudo contestar)." : "⚠️ Error general de conexión.", 'system');
    } finally {
      setIsSending(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const safeSend = async (texto: string) => {
    if (!texto.trim() || isSending) return;
    if (!navigator.onLine) {
      setPendingQueue(q => [...q, texto]);
      setHistory(prev => [...prev, { id: Date.now().toString(), text, sender: 'user', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), isQueue: true }]);
      addSystemMessage('📥 Sin conexión a internet. Comando encolado.', 'system');
      setMessage('');
      return;
    }
    await processInteraction(texto);
  };

  const quickActions = [
    { label: "Sincronizar Correos", icon: Mail, text: "Sincroniza los correos de facturas IMAP hacia Supabase" },
    { label: "Diagnóstico DB", icon: TerminalSquare, text: "Verifica el estado de las bases de datos Personal y Arume" },
    { label: "Ayuda Módulo", icon: Zap, text: `¿Qué puedo hacer en la pantalla de ${currentModule}?` }
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
            className="mb-4 w-[360px] bg-white rounded-[2.5rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] border border-slate-100 overflow-hidden flex flex-col h-[550px]"
          >
            {/* HEADER DEL CHAT */}
            <div className="bg-slate-900 p-5 text-white flex justify-between items-center shrink-0 shadow-md relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-500 rounded-full flex items-center justify-center shadow-inner relative overflow-hidden">
                  <Sparkles className="w-5 h-5 text-white absolute opacity-50 -top-1 -right-1" />
                  <Bot className="w-6 h-6 text-white" />
                </div>
                <div>
                  <span className="font-black text-base block leading-none">Arume AI</span>
                  <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest flex items-center gap-1.5 mt-1.5">
                    {navigator.onLine ? (
                      <><span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span> Conectado</>
                    ) : (
                      <><WifiOff className="w-3 h-3 text-rose-400" /> Offline</>
                    )}
                  </span>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="hover:bg-slate-800 p-2.5 rounded-full transition-colors text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* HISTORIAL DE CHAT */}
            <div className="flex-1 bg-slate-50/50 p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
              <div className="flex justify-center mb-2">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest bg-white border border-slate-200 px-4 py-1.5 rounded-full shadow-sm">
                  Ubicación: {currentModule}
                </span>
              </div>
              
              {history.length === 0 ? (
                <div className="m-auto text-center px-4">
                  <div className="w-16 h-16 bg-white border border-slate-200 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                    <Bot className="w-8 h-8 text-indigo-500" />
                  </div>
                  <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Bot Asistente Activo</p>
                  <p className="text-[11px] font-medium text-slate-500 mt-2 leading-relaxed">
                    Pídeme lo que necesites o envíame comandos. Tus órdenes viajarán directamente a tu móvil.
                  </p>
                </div>
              ) : (
                history.map((msg) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    key={msg.id} 
                    className={cn("max-w-[85%] rounded-2xl p-3.5 text-sm shadow-sm relative", 
                      msg.sender === 'user' ? "bg-indigo-600 text-white self-end rounded-tr-sm" : 
                      msg.sender === 'ai' ? "bg-white border border-slate-200 text-slate-800 self-start rounded-tl-sm" :
                      "bg-slate-200 text-slate-600 self-center text-center text-xs font-medium px-4 py-2 rounded-full",
                      msg.isQueue ? "opacity-70 border-dashed border border-white" : ""
                    )}
                  >
                    <p className={cn("leading-relaxed", msg.sender === 'system' ? "text-[10px] uppercase tracking-wider font-bold" : "text-[13px] font-medium")}>
                      {msg.sender === 'ai' ? formatMarkdown(msg.text) : msg.text}
                    </p>
                    {msg.sender !== 'system' && (
                      <span className={cn("text-[9px] font-bold block mt-1", msg.sender === 'user' ? "text-indigo-200 text-right" : "text-slate-400 text-left")}>
                        {msg.isQueue ? '⏳ En cola' : msg.time}
                      </span>
                    )}
                  </motion.div>
                ))
              )}
              {isSending && (
                <div className="self-start bg-white border border-slate-200 text-slate-500 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 shadow-sm">
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* CHIPS RÁPIDOS */}
            <div className="bg-white px-3 py-3 border-t border-slate-100 flex gap-2 overflow-x-auto no-scrollbar shrink-0 shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.02)]">
              {quickActions.map((action, idx) => (
                <button 
                  key={idx} onClick={() => safeSend(action.text)} disabled={isSending}
                  className="whitespace-nowrap px-4 py-2 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 text-[10px] font-black rounded-xl transition-colors border border-slate-200 hover:border-indigo-200 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <action.icon className="w-3 h-3" /> {action.label}
                </button>
              ))}
            </div>

            {/* INPUT DE MENSAJE Y MICRÓFONO */}
            <div className="p-3 bg-white border-t border-slate-100 flex gap-2 shrink-0 items-center">
              <button 
                onClick={toggleVoiceRecord} 
                className={cn("p-3 rounded-xl transition-colors shrink-0", isRecording ? "bg-rose-100 text-rose-600 animate-pulse" : "bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600")}
              >
                {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* 🛡️ FIX WARNING: Añadidos id y name para que Chrome no se queje */}
              <input 
                id="telegram-chat-input"
                name="telegram-chat-input"
                ref={inputRef} type="text" value={message} onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); safeSend(message); } }}
                placeholder={isRecording ? "Escuchando..." : navigator.onLine ? "Comando o consulta..." : "Sin red..."} 
                className="flex-1 bg-slate-50 text-sm font-bold rounded-xl px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 text-slate-800 border border-slate-200 transition-all w-full"
              />

              <button 
                onClick={() => safeSend(message)} disabled={!message.trim() || isSending}
                className="bg-indigo-600 text-white w-12 h-12 rounded-xl flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:opacity-50 active:scale-95 shrink-0 shadow-md"
              >
                {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 ml-1" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BOTÓN FLOTANTE ESTILO INTERCOM */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-16 h-16 text-white rounded-full flex items-center justify-center shadow-[0_10px_40px_-10px_rgba(79,70,229,0.6)] hover:scale-105 transition-all duration-300 relative border-4 border-white z-50",
          isOpen ? "bg-slate-800 rotate-90" : "bg-indigo-600"
        )}
      >
        {pendingQueue.length > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-5 w-5 bg-rose-500 border-2 border-white text-[9px] font-black items-center justify-center">{pendingQueue.length}</span>
          </span>
        )}
        {isOpen ? <X className="w-6 h-6 -rotate-90" /> : <Bot className="w-6 h-6" />}
      </button>
    </div>
  );
};
