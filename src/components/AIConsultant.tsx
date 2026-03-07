import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Loader2, TrendingUp, AlertTriangle, Key, Lock, Trash2, Hotel, Users, Eraser, Calculator } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI } from "@google/genai";
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';

// 🚀 BASE DE DATOS ESTRUCTURAL (Actualizada a modelo B2B)
export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

export const BUSINESS_UNITS: { id: BusinessUnit; name: string; desc: string }[] = [
  { id: 'REST', name: 'Restaurante Arume', desc: 'Servicio en sala principal (Ingresos vía TPV/Caja)' },
  { id: 'DLV', name: 'Catering Hoteles B2B', desc: 'Provisión a hoteles (Ingresos SOLO vía Facturas Emitidas)' },
  { id: 'SHOP', name: 'Tienda & Sakes', desc: 'Boutique de venta de botellas (Ingresos vía TPV/Caja)' },
  { id: 'CORP', name: 'Bloque Socios / Corporativo', desc: 'Gastos de estructura, gestoría y gerencia' },
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

  const initialMessage: Message = {
    role: 'assistant',
    content: `¡Hola, Agnès! Soy el Director de Operaciones IA.\n\nHe sido calibrado para el **modelo multi-unidad B2B**. Entiendo perfectamente que:\n- 🏨 **Hoteles:** No usa cajas, se factura a final de mes.\n- 👨‍🍳 **Reparto:** El cocinero tiene un 20% y el administrador un 10% del beneficio neto de Hoteles.\n- 🍶 **Tienda y Restaurante:** Tienen sus propios gastos e ingresos.\n\n¿Quieres que calcule la liquidación de este mes o analizamos otra cosa?`,
    timestamp: new Date()
  };

  const [messages, setMessages] = useState<Message[]>([initialMessage]);
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

  const handleClearChat = () => {
    if (confirm("¿Borrar la conversación actual?")) {
      setMessages([initialMessage]);
    }
  };

  // 🧠 FUNCIÓN MAESTRA: Pre-calcula los datos exactos para que la IA no alucine
  const generateLiveContext = () => {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    const breakdown: Record<string, { income: number; expenses: number; profit: number }> = {
      REST: { income: 0, expenses: 0, profit: 0 },
      DLV: { income: 0, expenses: 0, profit: 0 },
      SHOP: { income: 0, expenses: 0, profit: 0 },
      CORP: { income: 0, expenses: 0, profit: 0 },
    };

    // Ingresos Cajas (Solo REST y SHOP)
    (data.cierres || []).forEach((c: any) => {
      if (new Date(c.date).getMonth() === currentMonth) {
        const unit = c.unidad_negocio || 'REST';
        if (unit !== 'DLV' && breakdown[unit]) breakdown[unit].income += Num.parse(c.totalVenta);
      }
    });

    // Ingresos Facturas (Solo DLV - Hoteles)
    (data.facturas || []).forEach((f: any) => {
      if (new Date(f.date).getMonth() === currentMonth) {
        if (f.unidad_negocio === 'DLV' && Num.parse(f.total) > 0 && f.cliente !== 'Z DIARIO') {
          breakdown['DLV'].income += Num.parse(f.total);
        }
      }
    });

    // Gastos Variables (Albaranes)
    (data.albaranes || []).forEach((a: any) => {
      if (new Date(a.date).getMonth() === currentMonth) {
        const unit = a.unidad_negocio || 'REST';
        if (breakdown[unit]) breakdown[unit].expenses += Num.parse(a.total);
      }
    });

    // Gastos Fijos
    const monthKey = `pagos_${currentYear}_${currentMonth + 1}`;
    const pagados = (data.control_pagos || {})[monthKey] || [];
    (data.gastos_fijos || []).forEach((g: any) => {
      if (g.active !== false && pagados.includes(g.id)) {
        const unit = g.unitId || 'REST';
        let mensual = parseFloat(g.amount) || 0;
        if (g.freq === 'anual') mensual = mensual / 12;
        if (g.freq === 'trimestral') mensual = mensual / 3;
        if (breakdown[unit]) breakdown[unit].expenses += mensual;
      }
    });

    // Beneficio Neto Final
    Object.keys(breakdown).forEach(k => {
      breakdown[k].profit = breakdown[k].income - breakdown[k].expenses;
    });

    return {
      mes_actual: `${currentMonth + 1}/${currentYear}`,
      rentabilidad_por_bloques: breakdown,
      stock_critico: data.ingredientes.filter(i => i.stock <= i.min).map(i => ({ nombre: i.n, stock: i.stock, unidad: i.unidad_negocio || 'SHOP' })),
      facturas_pendientes: data.facturas.filter(f => !f.paid).length
    };
  };

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isLoading || !apiKey) return;

    const userMessage: Message = { role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const liveContext = generateLiveContext();

      const systemPrompt = `Eres un Director Financiero y de Operaciones del grupo hostelero "Arume".
      El negocio está dividido en 4 bloques estancos:
      1. REST (Restaurante)
      2. DLV (Catering B2B para Hoteles) -> OJO: Sus ingresos vienen 100% de facturas emitidas, no usan TPV.
      3. SHOP (Tienda de Sakes)
      4. CORP (Gastos corporativos de socios)
      
      REGLA DE NEGOCIO CRÍTICA (Liquidación DLV):
      Del beneficio neto mensual del bloque DLV (Ingresos DLV - Gastos DLV), el 20% es para el Cocinero y el 10% es para el Administrador de ventas. El 70% restante es beneficio para la empresa.
      
      DATOS REALES DEL MES ACTUAL:
      ${JSON.stringify(liveContext, null, 2)}
      
      Instrucciones:
      - Responde a Agnès de forma profesional, clara y estructurada.
      - Usa tablas Markdown si tienes que mostrar desgloses numéricos.
      - Si te piden calcular la liquidación de socios, usa los datos exactos del bloque DLV que te he proporcionado. No inventes números.`;

      // 🚀 Enviamos el historial de chat para que tenga memoria contextual
      const chatHistory = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      // Creamos la sesión de chat
      const chat = ai.chats.create({
        model: "gemini-2.5-flash",
        config: { systemInstruction: systemPrompt }
      });

      // Añadimos el historial previo
      if (chatHistory.length > 1) { // Saltamos el mensaje de bienvenida
          // La API nativa a veces es quisquillosa con el historial, mandamos la última query limpia + contexto
      }

      const response = await ai.models.generateContent({
         model: "gemini-2.5-flash",
         contents: [
            { role: "user", parts: [{ text: `CONTEXTO DE SISTEMA:\n${systemPrompt}\n\nPREGUNTA DEL USUARIO:\n${text}` }] }
         ]
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
    { label: 'Calcular Liquidación', icon: Calculator, query: 'Calcula la liquidación exacta de este mes para el bloque de Catering a Hoteles. Desglosa los ingresos, gastos y di cuánto le toca al Cocinero (20%) y al Administrador (10%).' },
    { label: 'Rentabilidad Global', icon: TrendingUp, query: 'Muéstrame una tabla con los ingresos, gastos y beneficio neto de todos los bloques de la empresa este mes.' },
    { label: 'Alerta Almacén', icon: AlertTriangle, query: 'Revisa el stock crítico y dime qué urgencias tenemos, separando por Tienda y Restaurante.' },
    { label: 'Gastos Socios', icon: Users, query: 'Resume los gastos del bloque corporativo.' },
  ];

  if (!apiKey) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-180px)] max-w-2xl mx-auto p-6 text-center animate-fade-in">
        <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
          <Lock className="w-10 h-10 text-indigo-600" />
        </div>
        <h2 className="text-3xl font-black text-slate-800 mb-4 tracking-tight">Conecta el Cerebro Analítico</h2>
        <p className="text-slate-500 mb-8 max-w-md">
          Para que el consultor pueda separar la rentabilidad del Restaurante, Hoteles y Tienda, pega tu clave privada de Google Gemini. 
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
            <Key className="w-5 h-5" /> DESBLOQUEAR IA DIRECTIVA
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
          <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-white font-black text-sm uppercase tracking-wider">Director Financiero IA</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Modelo B2B Hoteles Activo</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleClearChat} className="p-2 bg-slate-800 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-400 rounded-lg transition-colors" title="Limpiar Chat">
            <Eraser className="w-4 h-4" />
          </button>
          <button onClick={handleRemoveKey} className="p-2 bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors" title="Desconectar IA">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 custom-scrollbar">
        {messages.map((msg, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-4 max-w-[85%]", msg.role === 'user' ? "ml-auto flex-row-reverse" : "")}>
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", msg.role === 'user' ? "bg-slate-200" : "bg-indigo-100")}>
              {msg.role === 'user' ? <User className="w-5 h-5 text-slate-600" /> : <Bot className="w-5 h-5 text-indigo-600" />}
            </div>
            <div className={cn("p-5 rounded-2xl text-sm leading-relaxed shadow-sm", msg.role === 'user' ? "bg-indigo-600 text-white rounded-tr-none font-medium" : "bg-white text-slate-700 border border-slate-100 rounded-tl-none")}>
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
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
            </div>
          </div>
        )}
      </div>

      {/* Quick Actions (Botones rápidos) */}
      <div className="px-6 py-3 bg-white border-t border-slate-100 flex gap-2 overflow-x-auto no-scrollbar">
        {quickActions.map((action, i) => (
          <button key={i} onClick={() => handleSend(action.query)} className="flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-indigo-50 border border-slate-200 rounded-full text-[11px] font-bold text-slate-600 hover:text-indigo-600 transition-all shrink-0 shadow-sm">
            <action.icon className="w-3.5 h-3.5" /> {action.label}
          </button>
        ))}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-slate-100">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="relative flex items-center">
          <input 
            type="text" 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            placeholder="Pregúntale al Director Financiero (Ej: ¿Cuánto cobra el cocinero este mes?)" 
            className="w-full pl-5 pr-14 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium" 
          />
          <button type="submit" disabled={!input.trim() || isLoading} className="absolute right-2 p-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl transition-all shadow-lg shadow-indigo-500/20">
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
