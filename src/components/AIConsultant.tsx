import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Loader2, MessageSquare, TrendingUp, AlertTriangle, Package, Key, Lock, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI } from "@google/genai";
import { AppData } from '../types';
import { cn } from '../lib/utils';

// 🚀 NUEVA BASE DE DATOS ESTRUCTURAL PARA LA IA
export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

export const BUSINESS_UNITS: { id: BusinessUnit; name: string; desc: string }[] = [
  { id: 'REST', name: 'Restaurante Arume', desc: 'Servicio en sala principal' },
  { id: 'DLV', name: 'Delivery / Take Away', desc: 'Reparto a domicilio y recogidas' },
  { id: 'SHOP', name: 'Tienda & Sakes', desc: 'Boutique de venta de botellas' },
  { id: 'CORP', name: 'Bloque Socios / Corporativo', desc: 'Gastos de estructura y gerencia' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AIConsultantProps {
  data: AppData;
}

export function AIConsultant({ data }: AIConsultantProps) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [tempKey, setTempKey] = useState('');

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `¡Hola, Agnès! Soy tu Consultor Arume IA.\n\nHe sido actualizado para entender la **nueva estructura multi-local de la empresa**. Tengo acceso a los datos separados por:\n- 🍽️ Restaurante\n- 🛵 Delivery\n- 🍶 Tienda de Sakes\n- 👔 Bloque Socios\n\n¿En qué puedo ayudarte a mejorar la rentabilidad hoy?`,
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempKey.trim()) {
      localStorage.setItem('gemini_api_key', tempKey.trim());
      setApiKey(tempKey.trim());
    }
  };

  const handleRemoveKey = () => {
    if (confirm("¿Seguro que quieres desconectar el cerebro de IA?")) {
      localStorage.removeItem('gemini_api_key');
      setApiKey('');
    }
  };

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isLoading || !apiKey) return;

    const userMessage: Message = { role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      // 🚀 PREPARACIÓN DE DATOS PARA LA IA CON CONTEXTO MULTI-UNIDAD
      const dataSummary = {
        estructura_empresa: BUSINESS_UNITS,
        configuracion: data.config,
        // Mandamos los últimos datos para que tenga contexto fresco
        resumen_cierres: data.cierres.slice(-30),
        resumen_albaranes: data.albaranes.slice(-20).map(a => ({
          ...a,
          // Ayudamos a la IA a entender de qué bloque es cada albarán (si ya están etiquetados)
          unidad_negocio: a.unidad_negocio || 'SIN ASIGNAR'
        })),
        stock_critico: data.ingredientes.filter(i => i.stock <= i.min).map(i => ({
          nombre: i.n,
          stock: i.stock,
          unidad: i.unidad_negocio || 'SHOP'
        })),
        gastos_fijos: data.gastos_fijos.filter(g => g.active),
        estadisticas_globales: {
          total_ingredientes: data.ingredientes.length,
          total_platos: data.platos.length
        }
      };

      const systemPrompt = `Actúa como un consultor financiero y director de operaciones de hostelería del más alto nivel. 
      Tienes acceso a los datos del ERP de "Arume", que acaba de dividirse en 4 Centros de Coste / Unidades de Negocio:
      1. RESTAURANTE
      2. DELIVERY
      3. TIENDA DE SAKES
      4. BLOQUE DE SOCIOS (Gastos corporativos)
      
      Es VITAL que en tus análisis, si el usuario lo pide, sepas separar los ingresos y gastos de cada bloque para poder calcular repartos de beneficios precisos a final de mes.
      
      DATOS DEL ERP (Últimos movimientos):
      ${JSON.stringify(dataSummary, null, 2)}
      
      Responde de forma profesional, analítica, concisa y directa a la gerente (Agnès). Usa markdown (negritas, listas, emojis) para estructurar la respuesta de forma visual y escaneable. No inventes datos que no estén en el JSON proporcionado.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { text: systemPrompt },
              { text: `PREGUNTA DEL USUARIO: ${text}` }
            ]
          }
        ],
      });

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.text || "Lo siento, no he podido procesar el análisis de datos.",
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: any) {
      console.error("Error AI:", error);
      let errorMsg = "⚠️ Ha ocurrido un error al conectar con el cerebro de análisis.";
      if (error?.message?.includes('API_KEY_INVALID')) errorMsg = "⚠️ La clave API no es válida. Desconecta y vuelve a pegarla.";
      
      setMessages(prev => [...prev, { role: 'assistant', content: errorMsg, timestamp: new Date() }]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickActions = [
    { label: 'Beneficio Delivery', icon: Bike, query: 'Dime cómo va la rentabilidad y los gastos exclusivos del bloque DELIVERY este mes.' },
    { label: 'Análisis Tienda', icon: Store, query: 'Analiza el stock crítico de la TIENDA DE SAKES y dime qué pedir.' },
    { label: 'Gastos Socios', icon: Users, query: 'Resume los gastos fijos del bloque corporativo/socios.' },
    { label: 'Resumen Global', icon: TrendingUp, query: 'Hazme un resumen rápido de cómo va el negocio a nivel global (todos los bloques).' },
  ];

  if (!apiKey) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-180px)] max-w-2xl mx-auto p-6 text-center animate-fade-in">
        <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
          <Lock className="w-10 h-10 text-indigo-600" />
        </div>
        <h2 className="text-3xl font-black text-slate-800 mb-4 tracking-tight">Conecta el Cerebro Analítico</h2>
        <p className="text-slate-500 mb-8 max-w-md">
          Para que el consultor pueda separar la rentabilidad del Restaurante, Delivery y Tienda, pega tu clave privada de Google Gemini. 
          <strong className="block mt-2 text-emerald-600">Por seguridad, esta clave se guardará solo en tu navegador.</strong>
        </p>
        
        <form onSubmit={handleSaveKey} className="w-full max-w-sm flex flex-col gap-4">
          <input 
            type="password" 
            placeholder="Pega aquí tu clave (AIzaSy...)" 
            value={tempKey}
            onChange={(e) => setTempKey(e.target.value)}
            className="w-full px-5 py-4 rounded-xl border-2 border-slate-200 focus:border-indigo-500 focus:outline-none text-center font-mono shadow-sm"
            required
          />
          <button type="submit" className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl shadow-lg hover:shadow-indigo-500/30 transition-all flex justify-center items-center gap-2">
            <Key className="w-5 h-5" /> DESBLOQUEAR IA MULTI-LOCAL
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] max-w-4xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="bg-slate-900 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-white font-black text-sm uppercase tracking-wider">Director de Operaciones IA</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Multi-Local Activado</span>
            </div>
          </div>
        </div>
        <button onClick={handleRemoveKey} className="p-2 bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors" title="Desconectar IA">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 custom-scrollbar">
        {messages.map((msg, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-4 max-w-[85%]", msg.role === 'user' ? "ml-auto flex-row-reverse" : "")}>
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", msg.role === 'user' ? "bg-slate-200" : "bg-indigo-100")}>
              {msg.role === 'user' ? <User className="w-5 h-5 text-slate-600" /> : <Bot className="w-5 h-5 text-indigo-600" />}
            </div>
            <div className={cn("p-4 rounded-2xl text-sm leading-relaxed shadow-sm", msg.role === 'user' ? "bg-indigo-600 text-white rounded-tr-none" : "bg-white text-slate-700 border border-slate-100 rounded-tl-none")}>
              <div className={cn("whitespace-pre-wrap prose prose-sm max-w-none", msg.role === 'user' ? "prose-invert" : "prose-slate")}>
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <div className="flex gap-4 max-w-[85%] animate-pulse">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
            </div>
            <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></span>
              <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.4s]"></span>
            </div>
          </div>
        )}
      </div>

      {/* Quick Actions adaptadas al nuevo modelo */}
      <div className="px-6 py-3 bg-white border-t border-slate-100 flex gap-2 overflow-x-auto no-scrollbar">
        {quickActions.map((action, i) => (
          <button key={i} onClick={() => handleSend(action.query)} className="flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-indigo-50 border border-slate-200 rounded-full text-[11px] font-bold text-slate-600 hover:text-indigo-600 transition-all shrink-0">
            <action.icon className="w-3.5 h-3.5" /> {action.label}
          </button>
        ))}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-slate-100">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="relative flex items-center">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pregunta sobre la rentabilidad del Delivery o Tienda..." className="w-full pl-5 pr-14 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium" />
          <button type="submit" disabled={!input.trim() || isLoading} className="absolute right-2 p-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl transition-all shadow-lg shadow-indigo-500/20">
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
