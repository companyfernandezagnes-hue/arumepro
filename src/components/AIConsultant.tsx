import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Bot, User, Sparkles, Loader2, TrendingUp, AlertTriangle,
  Key, Lock, Trash2, Hotel, Users, Eraser, Calculator, Copy, Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';
import { askAI, getActiveChatProvider, getProvidersStatus, type ChatMessage } from '../services/aiProviders';

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

export const BUSINESS_UNITS: { id: BusinessUnit; name: string; desc: string }[] = [
  { id: 'REST', name: 'Restaurante Arume',    desc: 'Ingresos vía TPV/Caja' },
  { id: 'DLV',  name: 'Catering Hoteles B2B', desc: 'Ingresos SOLO vía Facturas Emitidas' },
  { id: 'SHOP', name: 'Tienda & Sakes',        desc: 'Ingresos vía TPV/Caja' },
  { id: 'CORP', name: 'Socios / Corporativo',  desc: 'Gastos de estructura y gerencia' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AIConsultantProps {
  data: AppData;
}

// ─── Constante del mensaje inicial ────────────────────────────────────────────
const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content: `¡Hola, Agnès! Soy el Director de Operaciones IA.\n\nEstoy calibrado para el **modelo multi-unidad B2B**:\n- 🏨 **Hoteles:** Facturación a fin de mes, sin TPV.\n- 👨‍🍳 **Reparto DLV:** Cocinero 20% · Administrador 10% del beneficio neto.\n- 🍶 **Tienda y Restaurante:** Ingresos propios de caja.\n\n¿Quieres que calcule la liquidación de este mes o analizamos otra cosa?`,
  timestamp: new Date(),
};

// ─── Helper: construir system prompt con datos reales ─────────────────────────
function buildSystemPrompt(data: AppData): string {
  const now          = new Date();
  const currentMonth = now.getMonth();
  const currentYear  = now.getFullYear();

  const breakdown: Record<string, { income: number; expenses: number; profit: number }> = {
    REST: { income: 0, expenses: 0, profit: 0 },
    DLV:  { income: 0, expenses: 0, profit: 0 },
    SHOP: { income: 0, expenses: 0, profit: 0 },
    CORP: { income: 0, expenses: 0, profit: 0 },
  };

  // Ingresos Cajas (REST y SHOP)
  (data.cierres || []).forEach((c: any) => {
    if (new Date(c.date).getMonth() !== currentMonth) return;
    const unit = c.unidad_negocio || 'REST';
    if (unit !== 'DLV' && breakdown[unit]) {
      breakdown[unit].income += Num.parse(
        c.totalVenta ?? c.totalVentas ?? c.total_calculado ?? c.total_real ?? c.total ?? 0
      );
    }
  });

  // Ingresos Facturas (DLV - Hoteles)
  (data.facturas || []).forEach((f: any) => {
    if (new Date(f.date).getMonth() !== currentMonth) return;
    if (f.unidad_negocio === 'DLV' && Num.parse(f.total) > 0 && f.cliente !== 'Z DIARIO') {
      breakdown['DLV'].income += Num.parse(f.total);
    }
  });

  // Gastos Variables (Albaranes)
  (data.albaranes || []).forEach((a: any) => {
    if (new Date(a.date).getMonth() !== currentMonth) return;
    const unit = a.unidad_negocio || a.unitId || 'REST';
    if (breakdown[unit]) breakdown[unit].expenses += Num.parse(a.total);
  });

  // Gastos Fijos (solo los marcados como pagados este mes)
  const monthKey = `pagos_${currentYear}_${currentMonth + 1}`;
  const pagados  = (data.control_pagos || {})[monthKey] || [];
  (data.gastos_fijos || []).forEach((g: any) => {
    if (g.active === false || !pagados.includes(g.id)) return;
    const unit   = g.unitId || 'REST';
    let mensual  = parseFloat(g.amount) || 0;
    if (g.freq === 'anual')      mensual /= 12;
    if (g.freq === 'semestral')  mensual /= 6;
    if (g.freq === 'trimestral') mensual /= 3;
    if (g.freq === 'bimensual')  mensual /= 2;
    if (breakdown[unit]) breakdown[unit].expenses += mensual;
  });

  // Beneficio neto por bloque
  Object.keys(breakdown).forEach(k => {
    breakdown[k].profit = Num.round2(breakdown[k].income - breakdown[k].expenses);
  });

  // Liquidación DLV
  const dlvProfit   = breakdown['DLV'].profit;
  const dlvCocinero = Num.round2(dlvProfit * 0.20);
  const dlvAdmin    = Num.round2(dlvProfit * 0.10);
  const dlvEmpresa  = Num.round2(dlvProfit * 0.70);

  const liveContext = {
    mes_actual:               `${currentMonth + 1}/${currentYear}`,
    rentabilidad_por_bloques: breakdown,
    liquidacion_DLV: {
      beneficio_neto: dlvProfit,
      cocinero_20pct: dlvCocinero,
      admin_10pct:    dlvAdmin,
      empresa_70pct:  dlvEmpresa,
    },
    stock_critico: (data.ingredientes || [])
      .filter(i => (i.stock ?? 0) <= (i.min ?? 0))
      .map(i => ({ nombre: i.n ?? i.nombre, stock: i.stock, min: i.min, unidad: i.unidad_negocio || 'SHOP' })),
    facturas_pendientes_cobro: (data.facturas || []).filter((f: any) => !f.paid && Num.parse(f.total) > 0).length,
    albaranes_no_facturados:   (data.albaranes || []).filter((a: any) => !a.invoiced).length,
  };

  return `Eres el Director Financiero y de Operaciones del grupo hostelero "Arume", con sede en Palma de Mallorca.

El negocio está dividido en 4 bloques estancos:
1. REST (Restaurante) — ingresos por caja/TPV
2. DLV (Catering B2B Hoteles) — ingresos SOLO por facturas emitidas, NUNCA por caja
3. SHOP (Tienda de Sakes) — ingresos por caja/TPV
4. CORP (Gastos corporativos) — solo gastos de estructura

REGLA CRÍTICA — Liquidación DLV:
Del beneficio neto mensual de DLV (Ingresos DLV - Gastos DLV):
  · 20% → Cocinero
  · 10% → Administrador de ventas
  · 70% → Beneficio empresa

DATOS REALES DEL MES ACTUAL (precalculados, no los inventes):
${JSON.stringify(liveContext, null, 2)}

Instrucciones de respuesta:
- Responde a Agnès de forma profesional, clara y estructurada.
- Usa tablas Markdown para desgloses numéricos.
- Si te piden la liquidación, usa exactamente los datos de liquidacion_DLV proporcionados.
- Si los datos son 0, explica que quizás no se han registrado ingresos o gastos ese mes todavía.
- Nunca inventes cifras. Si no tienes datos suficientes, dilo claramente.`;
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function AIConsultant({ data }: AIConsultantProps) {
  const [messages,  setMessages]  = useState<Message[]>([INITIAL_MESSAGE]);
  const [input,     setInput]     = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Proveedor activo — se recalcula en cada render para reflejar cambios en Settings
  const activeProvider = getActiveChatProvider();
  const hasAnyKey      = activeProvider !== null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // ── Scroll automático al nuevo mensaje ────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Limpiar chat ──────────────────────────────────────────────────────────
  const handleClearChat = async () => {
    const ok = await confirm({
      title:        '¿Borrar la conversación?',
      message:      'El historial de este chat se perderá.',
      danger:        true,
      confirmLabel: 'Borrar',
    });
    if (!ok) return;
    setMessages([INITIAL_MESSAGE]);
  };

  // ── Copiar respuesta ──────────────────────────────────────────────────────
  const handleCopy = useCallback((content: string, idx: number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }, []);

  // ── Enviar mensaje ────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text: string = input) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading || !hasAnyKey) return;

    const userMsg: Message = { role: 'user', content: trimmed, timestamp: new Date() };

    setMessages(prev => {
      const updated = [...prev, userMsg];

      (async () => {
        setIsLoading(true);
        setInput('');

        try {
          const systemPrompt = buildSystemPrompt(data);

          const chatHistory: ChatMessage[] = updated
            .slice(0, -1)
            .filter(m => m.content !== INITIAL_MESSAGE.content)
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

          chatHistory.push({ role: 'user', content: trimmed });

          // askAI prueba automáticamente: Cerebras → DeepSeek → Groq → Mistral → Gemini
          const result = await askAI(chatHistory, systemPrompt);

          const providerLabel: Record<string, string> = {
            cerebras: '🟣 Cerebras', deepseek: '🔷 DeepSeek',
            groq: '🟢 Groq', mistral: '🇪🇺 Mistral', gemini: '🔵 Gemini',
          };
          const footer = `\n\n_IA: ${providerLabel[result.provider] ?? result.provider}_`;
          const reply  = (result.text || 'Lo siento, no he podido procesar el análisis.') + footer;

          setMessages(prev2 => [...prev2, { role: 'assistant', content: reply, timestamp: new Date() }]);

        } catch (error: any) {
          console.error('[AIConsultant] Error:', error);
          let msg = '⚠️ Error al conectar con la IA.';
          if (error?.message?.includes('API_KEY_INVALID'))    msg = '⚠️ Alguna clave API no es válida. Revísala en Ajustes.';
          if (error?.message?.includes('quota'))              msg = '⚠️ Límite de cuota alcanzado. Espera unos minutos.';
          if (error?.message?.includes('Todos los proveedores')) msg = '⚠️ No hay ningún proveedor configurado. Ve a Ajustes → Cerebros IA.';
          setMessages(prev2 => [...prev2, { role: 'assistant', content: msg, timestamp: new Date() }]);
          toast.error('Error al contactar con la IA');
        } finally {
          setIsLoading(false);
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      })();

      return updated;
    });
  }, [input, isLoading, hasAnyKey, data]);

  // ── Acciones rápidas ──────────────────────────────────────────────────────
  const quickActions = [
    { label: 'Liquidación DLV',    icon: Calculator,    query: 'Calcula la liquidación exacta de este mes para el bloque Catering Hoteles. Desglosa ingresos, gastos, y di cuánto le toca al Cocinero (20%) y al Administrador (10%).' },
    { label: 'Rentabilidad Global', icon: TrendingUp,    query: 'Muéstrame una tabla con ingresos, gastos y beneficio neto de todos los bloques este mes.' },
    { label: 'Stock Crítico',       icon: AlertTriangle, query: 'Revisa el stock crítico y dime qué urgencias tenemos, separando Tienda y Restaurante.' },
    { label: 'Gastos Corp.',        icon: Users,         query: 'Resume los gastos del bloque corporativo y los compromisos fijos pendientes.' },
    { label: 'Facturas Pendientes', icon: Hotel,         query: 'Lista las facturas pendientes de cobro del bloque Hoteles y el total acumulado.' },
  ];

  // ─── UI: pantalla sin proveedores ─────────────────────────────────────────
  if (!hasAnyKey) {
    const status = getProvidersStatus();
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-180px)] max-w-md mx-auto p-6 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full space-y-6">
          <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <Lock className="w-10 h-10 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-800 tracking-tight">Conecta un Cerebro IA</h2>
            <p className="text-slate-500 mt-3 text-sm leading-relaxed">
              Añade al menos una clave en <strong>Ajustes → Cerebros IA</strong> para activar el Director Financiero.
            </p>
          </div>
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-2 text-left">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Proveedores disponibles</p>
            {[
              { key: 'gemini'   as const, label: '🔵 Gemini',   desc: 'Gratis · AI Studio'           },
              { key: 'groq'     as const, label: '🟢 Groq',     desc: 'Gratis · Groq Console'        },
              { key: 'cerebras' as const, label: '🟣 Cerebras', desc: '~0.10$/M · cloud.cerebras.ai' },
              { key: 'deepseek' as const, label: '🔷 DeepSeek', desc: '5M tokens gratis'             },
              { key: 'mistral'  as const, label: '🇪🇺 Mistral',  desc: '1B tokens/mes gratis'        },
            ].map(p => (
              <div key={p.key} className="flex items-center justify-between py-1.5">
                <div>
                  <span className="text-xs font-black text-slate-700">{p.label}</span>
                  <span className="text-[10px] text-slate-400 font-medium ml-2">{p.desc}</span>
                </div>
                <span className={cn(
                  'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border',
                  status[p.key]
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-slate-100 border-slate-200 text-slate-400'
                )}>
                  {status[p.key] ? '● Activo' : '○ Sin key'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 font-bold">
            Las claves se guardan solo en tu navegador, nunca en el servidor.
          </p>
        </motion.div>
      </div>
    );
  }

  // ─── UI: chat principal ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-180px)] max-w-4xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">

      {/* Header */}
      <div className="bg-slate-900 px-5 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-white font-black text-sm uppercase tracking-wider">Director Financiero IA</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Modelo B2B Hoteles</span>
              {activeProvider && (
                <span className="text-[9px] font-black uppercase tracking-widest bg-indigo-50 border border-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">
                  {{
                    gemini: '🔵 Gemini', groq: '🟢 Groq', cerebras: '🟣 Cerebras',
                    deepseek: '🔷 DeepSeek', mistral: '🇪🇺 Mistral'
                  }[activeProvider]}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearChat}
            title="Limpiar chat"
            className="p-2 bg-slate-800 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-400 rounded-lg transition-colors"
          >
            <Eraser className="w-4 h-4" />
          </button>
          <button
            onClick={() => toast.warning('Para cambiar las claves ve a Ajustes → Cerebros IA')}
            title="Gestionar claves en Ajustes"
            className="p-2 bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
          >
            <Key className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50/50 custom-scrollbar">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn('flex gap-3 group', msg.role === 'user' ? 'ml-auto flex-row-reverse max-w-[80%]' : 'max-w-[85%]')}
            >
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1', msg.role === 'user' ? 'bg-indigo-600' : 'bg-indigo-100')}>
                {msg.role === 'user'
                  ? <User className="w-4 h-4 text-white" />
                  : <Bot  className="w-4 h-4 text-indigo-600" />
                }
              </div>
              <div className="relative">
                <div className={cn(
                  'p-4 rounded-2xl text-sm leading-relaxed shadow-sm',
                  msg.role === 'user'
                    ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] rounded-tr-none font-medium'
                    : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none',
                )}>
                  <div className={cn('prose prose-sm max-w-none', msg.role === 'user' ? 'prose-invert' : 'prose-slate')}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
                {msg.role === 'assistant' && (
                  <button
                    onClick={() => handleCopy(msg.content, i)}
                    title="Copiar respuesta"
                    className="absolute -bottom-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50"
                  >
                    {copiedIdx === i
                      ? <Check className="w-3 h-3 text-emerald-500" />
                      : <Copy  className="w-3 h-3 text-slate-400"  />
                    }
                  </button>
                )}
                <p className={cn('text-[9px] text-slate-400 mt-1 font-medium', msg.role === 'user' ? 'text-right' : 'text-left')}>
                  {msg.timestamp.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 max-w-[85%]">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
              <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
            </div>
            <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.15s]" />
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.3s]" />
            </div>
          </motion.div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-5 py-3 bg-white border-t border-slate-100 flex gap-2 overflow-x-auto no-scrollbar shrink-0">
        {quickActions.map((action, i) => (
          <button
            key={i}
            onClick={() => handleSend(action.query)}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-indigo-50 border border-slate-200 rounded-full text-[11px] font-bold text-slate-600 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 shadow-sm"
          >
            <action.icon className="w-3.5 h-3.5" />
            {action.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 bg-white border-t border-slate-100 shrink-0">
        <div className="relative flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Pregúntale al Director Financiero (ej: ¿Cuánto cobra el cocinero este mes?)"
            disabled={isLoading}
            className="flex-1 pl-5 pr-14 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-60 transition-all font-medium"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-3 bg-indigo-600 hover:bg-[color:var(--arume-gray-700)] disabled:bg-slate-300 text-white rounded-xl transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            {isLoading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Send    className="w-5 h-5" />
            }
          </button>
        </div>
        <p className="text-center text-[10px] text-slate-300 font-medium mt-2">
          Enter para enviar · El historial de la conversación se incluye en cada consulta
        </p>
      </div>
    </div>
  );
}
