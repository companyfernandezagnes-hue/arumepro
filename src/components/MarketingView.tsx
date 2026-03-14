import React, { useState, useEffect } from 'react';
import { 
  Megaphone, Users, Target, TrendingUp, Plus, Mail, Instagram, Facebook, 
  CalendarDays, BarChart3, Sparkles, ArrowUpRight, PenTool, Image as ImageIcon, 
  Wand2, CalendarCheck, Loader2, Copy, CheckCircle2, MessageSquare, Camera, RefreshCw,
  Smartphone, Download, Trash2, CheckCircle, ListTodo
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { GoogleGenAI } from "@google/genai";
import { AppData } from '../types';
import { Num } from '../services/engine';
import { createClient } from '@supabase/supabase-js';

// 🔑 CLIENTE DUAL: CONEXIÓN A TU SUPABASE PERSONAL (Telegram Bot)
const PERSONAL_SUPABASE_URL = "https://torgtlggdnvvdarsogqu.supabase.co"; 
// 👇 REEMPLAZA ESTO CON LA CLAVE DE TU PROYECTO PERSONAL 👇
const PERSONAL_SUPABASE_KEY = "sb_publishable_--fEqifAJPW5EFeWdD5jUg_eyRbOD2l"; 
const personalSupabase = createClient(PERSONAL_SUPABASE_URL, PERSONAL_SUPABASE_KEY);

// 🧠 BRAND KIT: El ADN de Arume Sake Bar
const BRAND_KIT = {
  nombre: "Arume Sake Bar",
  estilo: "Elegante, clandestino, japonés moderno, gastronomía premium.",
  tono: "Profesional pero cercano, seductor, experto en sake y sabores asiáticos.",
  hashtags: "#ArumeSakeBar #SakeLovers #GastronomiaJaponesa #Mallorca"
};

interface MarketingViewProps {
  data?: AppData;
}

export const MarketingView = ({ data }: MarketingViewProps) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'studio' | 'calendar'>('studio');
  const platosCarta = Array.isArray(data?.platos) ? data.platos : [];
  
  // ESTADOS: ESTUDIO IA
  const [promptIdea, setPromptIdea] = useState(() => sessionStorage.getItem('mk_prompt') || '');
  const [selectedPlato, setSelectedPlato] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCopy, setGeneratedCopy] = useState(() => sessionStorage.getItem('mk_copy') || '');
  const [copyCopied, setCopyCopied] = useState(false);
  
  // ESTADOS: VISUAL Y RESEÑAS
  const [visualPrompt, setVisualPrompt] = useState('');
  const [isVisualGen, setIsVisualGen] = useState(false);
  const [reviewText, setReviewText] = useState('');
  const [reviewReply, setReviewReply] = useState('');
  const [isReviewGen, setIsReviewGen] = useState(false);

  // ESTADOS: TELEGRAM BOT (Personal DB)
  const [telegramInbox, setTelegramInbox] = useState<any[]>([]);
  const [isSyncingTelegram, setIsSyncingTelegram] = useState(false);

  useEffect(() => {
    sessionStorage.setItem('mk_prompt', promptIdea);
    sessionStorage.setItem('mk_copy', generatedCopy);
  }, [promptIdea, generatedCopy]);

  /* =======================================================
   * 📱 CONEXIÓN CON TELEGRAM (Supabase Personal)
   * ======================================================= */
  const fetchTelegramIdeas = async () => {
    if (PERSONAL_SUPABASE_KEY === "TU_CLAVE_ANONIMA_PERSONAL_AQUI") {
      return alert("⚠️ Faltan las credenciales de tu Supabase Personal en el código (Línea 22).");
    }

    setIsSyncingTelegram(true);
    try {
      // 🚀 MEJORA 2: Filtrado exacto usando tu esquema
      const { data: correos, error } = await personalSupabase
        .from('bottelegram')
        .select('*')
        .eq('procesado_n8n', false) // Solo lo que no has tocado aún
        .or('negocio.ilike.%arume%,negocio.ilike.%sake%,categoria.ilike.%marketing%')
        .order('created_at', { ascending: false })
        .limit(15);

      if (error) throw error;
      
      if (correos && correos.length > 0) {
        setTelegramInbox(correos);
      } else {
        alert("📭 Estás al día. No hay nuevas ideas de Arume en tu bot de Telegram.");
      }
    } catch (e: any) {
      console.error(e);
      alert(`⚠️ Error al conectar con tu DB personal: ${e.message}`);
    } finally {
      setIsSyncingTelegram(false);
    }
  };

  // 🚀 MEJORA 3: Soft Delete (Actualiza procesado_n8n a true)
  const markAsProcessed = async (id: number) => {
    try {
      await personalSupabase.from('bottelegram').update({ procesado_n8n: true }).eq('id', id);
      setTelegramInbox(prev => prev.filter(item => item.id !== id));
    } catch (e) {
      console.error("Error al actualizar la DB personal", e);
    }
  };

  /* =======================================================
   * ✍️ MOTOR DE COPYWRITING
   * ======================================================= */
  const generateCopy = async (modifier?: string) => {
    const baseIdea = selectedPlato ? `Plato: ${selectedPlato}. ${promptIdea}` : promptIdea;
    if (!baseIdea.trim()) return alert("Escribe una idea o selecciona un plato.");
    
    setIsGenerating(true);
    try {
      const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
      if (!apiKey) throw new Error("Falta la API Key de Gemini.");

      const ai = new GoogleGenAI({ apiKey });
      
      let modifierText = "";
      if (modifier === 'divertido') modifierText = "Hazlo más divertido e ingenioso.";
      if (modifier === 'urgencia') modifierText = "Crea urgencia, menciona plazas limitadas.";
      if (modifier === 'elegante') modifierText = "Usa un tono poético y sofisticado.";

      // 🚀 INNOVACIÓN 5: Adaptador si viene de voz
      const origenInfo = "Si notas lenguaje coloquial o titubeos de un mensaje dictado por voz, límpialo y hazlo profesional.";

      const prompt = `
        Actúa como el Social Media Manager de ${BRAND_KIT.nombre}.
        Nuestra marca es: ${BRAND_KIT.estilo}. Tono: ${BRAND_KIT.tono}.
        ${origenInfo}
        
        Escribe un post de Instagram para esta idea: "${baseIdea}".
        ${modifierText}
        
        Reglas:
        1. Título gancho.
        2. Cuerpo persuasivo.
        3. Llamada a la acción.
        4. Emojis con elegancia.
        5. Hashtags: ${BRAND_KIT.hashtags}.
        NO uses markdown como ** o *.
      `;

      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }] }], config: { temperature: 0.7 } });
      setGeneratedCopy(response.text?.replace(/\*\*/g, '') || "No se pudo generar.");
    } catch (error: any) { alert(`⚠️ Error: ${error.message}`); } finally { setIsGenerating(false); }
  };

  /* =======================================================
   * 📸 PROMPTS VISUALES Y RESEÑAS
   * ======================================================= */
  const generateVisualPrompt = async () => {
    if (!promptIdea.trim() && !selectedPlato) return;
    setIsVisualGen(true);
    try {
      const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
      const ai = new GoogleGenAI({ apiKey: apiKey! });
      const idea = selectedPlato ? selectedPlato : promptIdea;
      const prompt = `Escribe un 'Prompt' en INGLÉS avanzado para generar una imagen fotorrealista en Midjourney V6 basado en: "${idea}". Incluye: Iluminación cinematic, food photography, 85mm f1.8, --ar 4:5. Solo devuelve el prompt.`;
      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }] }]});
      setVisualPrompt(response.text || "");
    } catch (e) {} finally { setIsVisualGen(false); }
  };

  const generateReviewReply = async () => {
    if (!reviewText.trim()) return;
    setIsReviewGen(true);
    try {
      const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
      const ai = new GoogleGenAI({ apiKey: apiKey! });
      const prompt = `Eres el gerente de ${BRAND_KIT.nombre}. Responde a esta reseña educada y empáticamente: "${reviewText}". Solo la respuesta.`;
      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }] }]});
      setReviewReply(response.text || "");
    } catch (e) {} finally { setIsReviewGen(false); }
  };

  const copyToClipboard = (text: string, setter: any) => {
    navigator.clipboard.writeText(text); setter(true); setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="max-w-[1600px] mx-auto pb-24 animate-fade-in relative px-2 sm:px-4">
      
      {/* 🚀 CABECERA Y NAVEGACIÓN */}
      <header className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-200 mb-6 flex flex-col xl:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-4 w-full xl:w-auto">
          <div className="w-14 h-14 bg-gradient-to-tr from-fuchsia-600 to-rose-500 rounded-2xl flex items-center justify-center shadow-lg shadow-rose-200 shrink-0">
            <Megaphone className="w-7 h-7 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">Estudio de Marketing</h1>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-0.5">CMO Virtual & Sincronización Bot</p>
          </div>
          
          <button onClick={fetchTelegramIdeas} disabled={isSyncingTelegram} className="xl:hidden bg-[#229ED9] text-white p-3 rounded-xl shadow-md hover:bg-[#1E8CC0] transition">
            {isSyncingTelegram ? <Loader2 className="w-5 h-5 animate-spin"/> : <Smartphone className="w-5 h-5"/>}
          </button>
        </div>

        <div className="flex items-center gap-3 w-full xl:w-auto overflow-x-auto no-scrollbar bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
          <TabButton active={activeTab === 'studio'} onClick={() => setActiveTab('studio')} icon={Wand2} label="Estudio IA" />
          <TabButton active={activeTab === 'calendar'} onClick={() => setActiveTab('calendar')} icon={CalendarDays} label="Planificador" />
          <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={BarChart3} label="Métricas" />
          
          <button onClick={fetchTelegramIdeas} disabled={isSyncingTelegram} className="hidden xl:flex items-center gap-2 bg-[#229ED9] text-white px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest shadow-md hover:bg-[#1E8CC0] transition disabled:opacity-50">
            {isSyncingTelegram ? <Loader2 className="w-4 h-4 animate-spin"/> : <Smartphone className="w-4 h-4"/>}
            Sync Bot {telegramInbox.length > 0 && `(${telegramInbox.length})`}
          </button>
        </div>
      </header>

      <main className="relative min-h-[60vh]">
        <AnimatePresence mode="wait">

          {/* =========================================
            * 🎨 PESTAÑA 1: ESTUDIO CREATIVO IA
            * ========================================= */}
          {activeTab === 'studio' && (
            <motion.div key="studio" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              
              {/* COLUMNA IZQUIERDA: TELEGRAM & COPYWRITER */}
              <div className="xl:col-span-7 flex flex-col gap-6">
                
                {/* 📨 BANDEJA DE ENTRADA PERSONAL (bottelegram) */}
                {telegramInbox.length > 0 && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-blue-50 border border-[#229ED9]/30 rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-black text-[#229ED9] flex items-center gap-2"><Smartphone className="w-4 h-4" /> Ideas desde Telegram</h3>
                      <span className="bg-[#229ED9] text-white text-[9px] px-2 py-0.5 rounded-full font-bold">{telegramInbox.length} Pendientes</span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto custom-scrollbar pb-2">
                      {telegramInbox.map((item) => (
                        <div key={item.id} className="min-w-[240px] max-w-[280px] bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col relative group">
                          
                          {/* Innovación 4: Chips Dinámicos */}
                          <div className="flex gap-1 mb-2">
                            {item.categoria && <span className="text-[8px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-black uppercase">{item.categoria}</span>}
                            {item.origen === 'voz' && <span className="text-[8px] bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded font-black uppercase flex items-center gap-0.5"><Mic className="w-2 h-2"/> Nota de Voz</span>}
                          </div>

                          {/* La Idea */}
                          <p className="text-xs font-bold text-slate-800 mb-2 leading-relaxed line-clamp-4">"{item.descripcion}"</p>
                          
                          {/* Innovación 1: Extractor de Tareas */}
                          {item.tareas && (
                            <div className="mb-3 bg-amber-50 border border-amber-100 p-2 rounded text-[10px] text-amber-700 font-medium flex gap-1.5">
                              <ListTodo className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>{item.tareas}</span>
                            </div>
                          )}

                          <div className="mt-auto pt-3 flex justify-between items-center border-t border-slate-100">
                            <button onClick={() => { setPromptIdea(item.descripcion); }} className="text-fuchsia-600 hover:text-fuchsia-800 text-[10px] font-black uppercase flex items-center gap-1 transition-colors">
                              <PenTool className="w-3 h-3"/> Escribir Post
                            </button>
                            <button onClick={() => markAsProcessed(item.id)} className="text-emerald-500 hover:text-emerald-700 text-[10px] font-black uppercase flex items-center gap-1 transition-colors" title="Marcar como hecho en DB">
                              <CheckCircle className="w-3 h-3"/> Listo
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col flex-1">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center"><PenTool size={20} /></div>
                    <div>
                      <h3 className="text-lg font-black text-slate-800">Copywriter de Arume</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Entrenado con tu voz de marca</p>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col gap-4">
                    {platosCarta.length > 0 && (
                      <div className="bg-amber-50 border border-amber-100 p-3 rounded-xl flex flex-col sm:flex-row sm:items-center gap-3">
                        <span className="text-[10px] font-black uppercase text-amber-600 tracking-widest shrink-0">💡 Vender Plato:</span>
                        <select 
                          value={selectedPlato} onChange={(e) => setSelectedPlato(e.target.value)}
                          className="flex-1 bg-white border border-amber-200 rounded-lg p-2 text-xs font-bold text-slate-700 outline-none"
                        >
                          <option value="">Selecciona un plato de tu carta...</option>
                          {platosCarta.map((p:any) => <option key={p.id} value={p.name}>{p.name} ({Num.fmt(p.price)})</option>)}
                        </select>
                      </div>
                    )}

                    <textarea 
                      value={promptIdea} onChange={(e) => setPromptIdea(e.target.value)}
                      placeholder={selectedPlato ? `Añade detalles extra sobre el ${selectedPlato}...` : "Escribe una idea o transfiérela desde tu buzón de Telegram arriba 👆"}
                      className="w-full h-24 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none resize-none transition-all"
                    />
                    
                    <button 
                      onClick={() => generateCopy()} disabled={(!promptIdea.trim() && !selectedPlato) || isGenerating}
                      className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md"
                    >
                      {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5 text-indigo-400" />}
                      {isGenerating ? "Redactando Post..." : "Generar Post Original"}
                    </button>

                    {/* RESULTADO Y MODIFICADORES */}
                    <div className="flex-1 flex flex-col mt-2 h-48">
                      <div className="flex-1 bg-slate-50 border border-slate-200 rounded-t-2xl p-5 overflow-y-auto custom-scrollbar relative">
                        {generatedCopy ? (
                          <div className="whitespace-pre-wrap text-sm text-slate-700 font-medium">{generatedCopy}</div>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center opacity-40">
                            <PenTool className="w-8 h-8 mb-2" />
                            <p className="text-xs font-bold uppercase tracking-widest text-center">Aquí aparecerá tu texto</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="bg-slate-100 border-x border-b border-slate-200 rounded-b-2xl p-2 flex flex-wrap items-center justify-between gap-2">
                         <div className="flex gap-1">
                           <button onClick={() => generateCopy('divertido')} disabled={!generatedCopy || isGenerating} className="px-3 py-1.5 bg-white rounded-lg text-[9px] font-bold text-slate-600 hover:text-indigo-600 shadow-sm border border-slate-200 transition">🤪 + Divertido</button>
                           <button onClick={() => generateCopy('urgencia')} disabled={!generatedCopy || isGenerating} className="px-3 py-1.5 bg-white rounded-lg text-[9px] font-bold text-slate-600 hover:text-rose-600 shadow-sm border border-slate-200 transition">🔥 + Urgencia</button>
                           <button onClick={() => generateCopy('elegante')} disabled={!generatedCopy || isGenerating} className="px-3 py-1.5 bg-white rounded-lg text-[9px] font-bold text-slate-600 hover:text-emerald-600 shadow-sm border border-slate-200 transition">🍷 + Elegante</button>
                         </div>
                         <button onClick={() => copyToClipboard(generatedCopy, setCopyCopied)} disabled={!generatedCopy} className="p-2 bg-indigo-600 text-white rounded-lg shadow-sm hover:bg-indigo-700 transition">
                           {copyCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                         </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* COLUMNA DERECHA: IMÁGENES Y RESEÑAS */}
              <div className="xl:col-span-5 flex flex-col gap-6">
                
                {/* PROMPTS FOTOGRÁFICOS */}
                <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex-1 flex flex-col">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4"><Camera className="w-4 h-4 text-fuchsia-500" /> Prompts Visuales IA</h3>
                  <p className="text-xs text-slate-500 mb-4 leading-relaxed">Genera instrucciones perfectas para DALL-E / Midjourney basadas en tu idea.</p>
                  
                  {visualPrompt ? (
                    <div className="relative flex-1">
                      <textarea readOnly value={visualPrompt} className="w-full h-full min-h-[100px] bg-slate-900 text-emerald-400 font-mono text-xs p-4 rounded-xl border-none outline-none resize-none" />
                      <button onClick={() => navigator.clipboard.writeText(visualPrompt)} className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition"><Copy className="w-3.5 h-3.5"/></button>
                    </div>
                  ) : (
                    <div className="flex-1 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center p-4">
                      <span className="text-[10px] font-bold text-slate-400 uppercase text-center">Esperando idea...</span>
                    </div>
                  )}
                  
                  <button onClick={generateVisualPrompt} disabled={isVisualGen || (!promptIdea && !selectedPlato)} className="mt-4 w-full bg-fuchsia-50 text-fuchsia-600 py-3 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-fuchsia-100 transition flex justify-center items-center gap-2 disabled:opacity-50">
                    {isVisualGen ? <Loader2 className="w-4 h-4 animate-spin"/> : <ImageIcon className="w-4 h-4"/>} Generar Prompt Foto
                  </button>
                </div>

                {/* GESTOR DE RESEÑAS */}
                <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex-1 flex flex-col">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4"><MessageSquare className="w-4 h-4 text-emerald-500" /> Respondedor de Reseñas</h3>
                  <textarea 
                    value={reviewText} onChange={(e) => setReviewText(e.target.value)}
                    placeholder="Pega aquí la queja o reseña de Google Maps..."
                    className="w-full h-20 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs mb-3 outline-none focus:border-emerald-400 resize-none"
                  />
                  <button onClick={generateReviewReply} disabled={!reviewText.trim() || isReviewGen} className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-[10px] font-black uppercase hover:bg-slate-800 transition disabled:opacity-50 flex justify-center items-center gap-2 mb-3">
                     {isReviewGen ? <Loader2 className="w-3 h-3 animate-spin"/> : <RefreshCw className="w-3 h-3"/>} Crear Respuesta
                  </button>
                  {reviewReply && (
                    <div className="relative">
                      <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-xl text-xs text-slate-700 font-medium leading-relaxed pr-8">{reviewReply}</div>
                      <button onClick={() => navigator.clipboard.writeText(reviewReply)} className="absolute top-2 right-2 text-emerald-600 hover:text-emerald-800 p-1 bg-white rounded shadow-sm"><Copy className="w-3 h-3"/></button>
                    </div>
                  )}
                </div>

              </div>
            </motion.div>
          )}

          {/* DEMÁS PESTAÑAS (Estáticas por ahora) */}
          {activeTab === 'calendar' && (
            <motion.div key="calendar" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div className="bg-white p-6 md:p-10 rounded-[3rem] border border-slate-200 shadow-sm text-center opacity-60">
                <CalendarDays className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                <h3 className="text-xl font-black text-slate-700">Calendario Estratégico</h3>
                <p className="text-sm font-medium text-slate-500 mt-2">Aquí conectaremos la vista para arrastrar los posts generados al calendario.</p>
              </div>
            </motion.div>
          )}

          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div className="bg-white p-6 md:p-10 rounded-[3rem] border border-slate-200 shadow-sm text-center opacity-60">
                <BarChart3 className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                <h3 className="text-xl font-black text-slate-700">Métricas de Crecimiento</h3>
                <p className="text-sm font-medium text-slate-500 mt-2">Integraremos estadísticas de redes y CRM para medir el ROI.</p>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

    </div>
  );
};

const TabButton = ({ active, onClick, icon: Icon, label }: any) => (
  <button 
    onClick={onClick}
    className={cn(
      "flex-1 flex items-center justify-center gap-2 p-3 rounded-xl transition-all font-black text-[11px] md:text-xs uppercase tracking-widest whitespace-nowrap",
      active ? "bg-white shadow-sm border border-slate-200 text-indigo-600" : "text-slate-500 hover:bg-slate-200/50 border border-transparent"
    )}
  >
    <Icon className="w-4 h-4 shrink-0" /> <span>{label}</span>
  </button>
);
