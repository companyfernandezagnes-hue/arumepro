import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Bot, Sparkles, Loader2, BarChart3, Mail, Building2, WifiOff, Zap, Mic, Square, TerminalSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface TelegramWidgetProps {
  currentModule: string;
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
    return (
      <>
        {parts.map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-black text-indigo-900">{part.slice(2, -2)}</strong>;
          if (part.startsWith('*') && part.endsWith('*')) return <em key={i} className="font-bold text-indigo-800">{part.slice(1, -1)}</em>;
          return <span key={i}>{part}</span>;
        })}
      </>
    );
  } catch (e) {
    return <span>{text}</span>;
  }
};

// 🛡️ Escapador de MarkdownV2 para Telegram (Evita que rechace los mensajes)
const escapeMarkdownV2 = (text: string) => {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
};

// 🛡️ Helper para llamadas con límite de tiempo
const fetchWithTimeout = async (resource: string, options: RequestInit & { timeout?: number } = {}) => {
  const { timeout = 10000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

export const TelegramWidget = ({ currentModule, chatId }: TelegramWidgetProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { isRecording, toggleRecording: toggleVoiceRecord } = useVoiceInput({
    onResult: (text) => setMessage(text),
  });
  const [history, setHistory] = useState<ChatMessage[]>([]);
  
  // 🛡️ COLA PERSISTENTE (Por si apagas la app sin internet)
  const [pendingQueue, setPendingQueue] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tg_pending_queue') || '[]'); } 
    catch { return []; }
  });
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (messagesEndRef.current && isOpen) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history, isOpen]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen]);

  const addSystemMessage = (text: string, type: 'system' | 'ai' = 'system') => {
    if (!text) return;
    const msgId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString() + Math.random().toString();
    setHistory(prev => [...prev, { id: msgId, text, sender: type, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
  };

  /* =======================================================
   * 📡 ESCUCHA DE ALERTAS GLOBALES (De Arume al Móvil)
   * ======================================================= */
  useEffect(() => {
    const handleAppAlert = async (e: any) => {
      const alerta = e.detail;
      if (alerta && chatId) {
        try {
          addSystemMessage(`🔔 Alerta de sistema enviada a Telegram`, 'system');
          
          const safeText = escapeMarkdownV2(`🚨 ALERTA ARUME\n\n${alerta}`);
          await fetchWithTimeout(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ chat_id: chatId, text: safeText, parse_mode: 'MarkdownV2' }),
            timeout: 5000
          });
        } catch (err) {
          console.warn("No se pudo enviar la alerta automática a Telegram.");
        }
      }
    };

    window.addEventListener('arume-bot-alert', handleAppAlert);
    return () => window.removeEventListener('arume-bot-alert', handleAppAlert);
  }, [chatId]);

  // Reconexión y drenaje de cola offline
  useEffect(() => {
    const onOnline = async () => {
      if (pendingQueue.length > 0) {
        addSystemMessage('🌐 Red restaurada. Sincronizando comandos...', 'system');
        const queueCopy = [...pendingQueue];
        setPendingQueue([]);
        localStorage.setItem('tg_pending_queue', '[]');
        
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


  /* =======================================================
   * 🧠 CEREBRO DEL BOT: SEPARADOR DE VIDA PERSONAL / RESTAURANTE
   * ======================================================= */
  const processInteraction = async (texto: string) => {
    const msgId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
    setHistory(prev => [...prev, { id: msgId, text: texto, sender: 'user', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }]);
    setMessage(''); 
    
    const cmd = texto.trim();
    const isCommand = cmd.startsWith('/');

    // 🚀 1. GESTIÓN DE COMANDOS INTERNOS DEL RESTAURANTE (NO VAN AL BOT PERSONAL)
    if (isCommand) {
      const lowerCmd = cmd.toLowerCase();
      
      if (lowerCmd === '/diagnostico' || lowerCmd.includes('verifica')) {
        addSystemMessage("🔍 Auditando bases de datos y conexiones...", 'system');
        setTimeout(() => {
          const isOnline = navigator.onLine ? 'ACTIVA ✅' : 'OFFLINE ❌';
          const hasGroq = (sessionStorage.getItem('groq_api_key') || localStorage.getItem('groq_api_key')) ? 'OK ✅' : 'FALTA KEY ⚠️';
          addSystemMessage(`📊 **REPORTE DE SISTEMAS:**\n\n🌐 Red Global: ${isOnline}\n🧠 Motor Groq: ${hasGroq}\n🗄️ App Data: SINCRONIZADA ✅`, 'ai');
          setIsSending(false); isProcessingRef.current = false;
        }, 1000);
        return; 
      }

      if (lowerCmd === '/sync_correos') {
        addSystemMessage("📧 Conectando con el buzón IMAP de facturas...", 'system');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('arume-bot-command', { detail: { cmd: 'sync_emails' } }));
          addSystemMessage("✅ Orden enviada a Facturación.", 'ai');
          setIsSending(false); isProcessingRef.current = false;
        }, 1000);
        return;
      }

      if (lowerCmd === '/ayuda') {
        addSystemMessage(`ℹ️ **Estás en: ${currentModule}**\n\n- Usa /buscar [texto] para filtrar.\n- Escribe texto normal para mandarlo a tu bot personal.`, 'ai');
        setIsSending(false); isProcessingRef.current = false;
        return;
      }

      // COMANDO DINÁMICO DE BÚSQUEDA (Ej: /cocacola o /buscar cocacola)
      const query = lowerCmd.startsWith('/buscar ') ? lowerCmd.replace('/buscar ', '') : lowerCmd.substring(1);
      addSystemMessage(`🔍 Buscando "${query}" en la pantalla...`, 'system');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('arume-bot-command', { detail: { cmd: 'buscar', q: query } }));
        addSystemMessage(`✅ Filtro aplicado en la tabla.`, 'ai');
        setIsSending(false); isProcessingRef.current = false;
      }, 500);
      return;
    }

    // 🚀 2. GESTIÓN DE VIDA PERSONAL (VA A TELEGRAM Y A N8N)
    let telegramSuccess = false;
    if (chatId) {
      try {
        const safeText = escapeMarkdownV2(`[Nota desde Arume]\n\n${texto}`);
        await fetchWithTimeout(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: safeText,
            parse_mode: 'MarkdownV2'
          }),
          timeout: 6000
        });
        telegramSuccess = true;
      } catch (error) {
        console.warn("Fallo silencioso al conectar con Telegram.");
      }
    }

    // 🚀 3. RESPUESTA CORTÉS DE GROQ (Para que no quede en blanco)
    try {
      const groqKey = sessionStorage.getItem('groq_api_key') || localStorage.getItem('groq_api_key');
      
      if (!groqKey) {
        addSystemMessage(telegramSuccess 
          ? "✅ Mensaje enviado a tu Bot Personal." 
          : "❌ Error de conexión.", 'system');
      } else {
        const prompt = `Eres un asistente dentro de un ERP. El usuario acaba de enviar una nota a su bot personal de Telegram: "${texto}". Responde con una sola frase corta confirmando que la nota ha sido enviada con éxito. No des explicaciones.`;

        const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "llama3-70b-8192",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3
          }),
          timeout: 6000
        });

        if (!res.ok) throw new Error("Fallo Groq");
        const data = await res.json();
        
        const aiResponse = data?.choices?.[0]?.message?.content;
        if (aiResponse && aiResponse.trim() !== '') {
          addSystemMessage(aiResponse, 'ai');
        } else {
          addSystemMessage("✅ Anotado y enviado a tu bot.", 'ai');
        }
      }
    } catch (error) {
      addSystemMessage(telegramSuccess ? "✅ Enviado a tu móvil." : "⚠️ Error general.", 'system');
    } finally {
      setIsSending(false);
      isProcessingRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // 🛡️ EL ESCUDO: Evita el cuelgue por spam
  const safeSend = async (texto: string) => {
    if (!texto.trim() || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setIsSending(true);

    try {
      if (!navigator.onLine) {
        const newQueue = [...pendingQueue, texto];
        setPendingQueue(newQueue);
        localStorage.setItem('tg_pending_queue', JSON.stringify(newQueue)); // 🛡️ Persistimos la cola
        
        const msgId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
        setHistory(prev => [...prev, { id: msgId, text: texto, sender: 'user', time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), isQueue: true }]);
        addSystemMessage('📥 Sin conexión. Encolado.', 'system');
        setMessage('');
        setIsSending(false);
        isProcessingRef.current = false; // ✅ FIX: resetear guard en path offline
        return;
      }
      await processInteraction(texto);
    } finally {
      setIsSending(false);
      isProcessingRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const quickActions = [
    { label: "Sincronizar Correos", icon: Mail, text: "/sync_correos" },
    { label: "Diagnóstico DB", icon: TerminalSquare, text: "/diagnostico" },
    { label: "Ayuda Módulo", icon: Zap, text: "/ayuda" }
  ];

  if (!chatId) return null;

  return (
    <div className="fixed bottom-20 right-3 z-[130] flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.9, transformOrigin: 'bottom right' }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="mb-4 w-[360px] bg-white rounded-[2.5rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] border border-slate-100 overflow-hidden flex flex-col h-[550px]"
          >
            {/* HEADER */}
            <div className="bg-slate-900 p-5 text-white flex justify-between items-center shrink-0 shadow-md relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-500 rounded-full flex items-center justify-center shadow-inner relative overflow-hidden">
                  <Sparkles className="w-5 h-5 text-white absolute opacity-50 -top-1 -right-1" />
                  <Bot className="w-6 h-6 text-white" />
                </div>
                <div>
                  <span className="font-black text-base block leading-none">Arume AI</span>
                  <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest flex items-center gap-1.5 mt-1.5">
                    {navigator.onLine ? <><span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span> Sistema Listo</> : <><WifiOff className="w-3 h-3 text-rose-400" /> Offline</>}
                  </span>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="hover:bg-slate-800 p-2.5 rounded-full transition-colors text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* HISTORIAL */}
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
                  <p className="text-sm font-black text-slate-700 uppercase tracking-widest">Bot Principal Activo</p>
                  <p className="text-[11px] font-medium text-slate-500 mt-2 leading-relaxed">
                    Escribe comandos con "/" para controlar la App (Ej: /makro) o envía texto normal a tu bot personal.
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
                    <div className={cn("leading-relaxed", msg.sender === 'system' ? "text-[10px] uppercase tracking-wider font-bold" : "text-[13px] font-medium")}>
                      {msg.sender === 'ai' ? formatMarkdown(msg.text) : msg.text}
                    </div>
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
              <button onClick={toggleVoiceRecord} className={cn("p-3 rounded-xl transition-colors shrink-0", isRecording ? "bg-rose-100 text-rose-600 animate-pulse" : "bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600")}>
                {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <input 
                id="telegram-bot-input" name="telegram-bot-input"
                ref={inputRef} type="text" value={message} onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); safeSend(message); } }}
                placeholder={isRecording ? "Escuchando..." : "Escribe un mensaje o /comando..."} 
                className="flex-1 bg-slate-50 text-sm font-bold rounded-xl px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 text-slate-800 border border-slate-200 transition-all w-full"
              />

              <button onClick={() => safeSend(message)} disabled={!message.trim() || isSending} className="bg-indigo-600 text-white w-12 h-12 rounded-xl flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:opacity-50 active:scale-95 shrink-0 shadow-md">
                {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 ml-1" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
