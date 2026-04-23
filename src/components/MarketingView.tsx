import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Megaphone, Sparkles, Wand2, CalendarDays, Star, Copy, CheckCircle2,
  Loader2, RefreshCw, Plus, Trash2, ChevronLeft, ChevronRight,
  MessageSquare, ImageIcon, Share2, X, CheckCircle, AlertCircle,
  Lightbulb, PenTool, Smartphone, Download, Camera, Clock,
  RotateCcw, FolderOpen, Link, PlayCircle, Brain, History,
  TrendingUp, Upload, Film, Zap, BookOpen, Building2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { askAI, scanBase64, keys } from '../services/aiProviders';
import { AppData } from '../types';
import { createClient } from '@supabase/supabase-js';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

// ── Supabase Arume PRO ───────────────────────────────────────────────────────
// Nota: tipado como <any> para que insert/upsert no exijan los tipos Database
// generados. Migrar a <Database> si se generan con `supabase gen types`.
const _A_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string;
const _A_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string;
let _aInstance: ReturnType<typeof createClient<any>> | null = null;
const getArumDB = () => {
  if (!_aInstance && _A_URL && _A_KEY)
    _aInstance = createClient<any>(_A_URL, _A_KEY, { auth: { persistSession: false } });
  return _aInstance;
};

// ── Supabase Personal (Telegram) ─────────────────────────────────────────────
const _P_URL = (import.meta as any).env?.VITE_PERSONAL_SUPABASE_URL as string;
const _P_KEY = (import.meta as any).env?.VITE_PERSONAL_SUPABASE_KEY as string;
let _pInstance: ReturnType<typeof createClient<any>> | null = null;
const getPersonalDB = () => {
  if (!_pInstance && _P_URL && _P_KEY)
    _pInstance = createClient<any>(_P_URL, _P_KEY, { auth: { persistSession: false } });
  return _pInstance;
};

// ── Tipos de contenido (todos bajo @ArumeSakeBar) ────────────────────────────
const BRANDS = {
  restaurante: {
    id      : 'restaurante',
    nombre  : 'Arume Sake Bar — Restaurante',
    emoji   : '🍽️',
    color   : 'from-fuchsia-600 to-rose-500',
    estilo  : 'Restaurante japonés moderno, elegante y clandestino. Gastronomía premium en Mallorca. Cocina asiática de autor.',
    tono    : 'Seductor, exclusivo, cercano. Invita a vivir una experiencia única. Despierta curiosidad y deseo.',
    hashtags: '#ArumeSakeBar #GastronomiaJaponesa #Mallorca #RestauranteJapones #SakeBar #MallorcaRestaurantes #CocinaJaponesa',
    ctas    : ['Reserva tu mesa 👇', 'Plazas limitadas esta semana ✨', 'Llámanos o escríbenos 🍶', 'Link en bio 🔗', 'Solo quedan X mesas 🎋'],
    colores : 'Negro, blanco, dorado y rojo sutil. Minimalismo japonés.',
    reelHook: 'Gancho visual impactante primeros 3 segundos, ritmo rápido con cortes, música lo-fi japonesa o trending, texto bold en pantalla',
    imgStyle: 'High-end food photography, elegant dark background, dramatic side lighting, moody shadows, golden hour warmth, shallow depth of field 85mm f/1.8, premium restaurant plating',
  },
  tienda: {
    id      : 'tienda',
    nombre  : 'Arume — Tienda de Sakes & Take Away',
    emoji   : '🍶',
    color   : 'from-amber-500 to-orange-400',
    estilo  : 'Tienda de sakes premium en Mallorca. Selección única de sake japonés auténtico. Take away disponible. Accesible y apasionante.',
    tono    : 'Cercano y apasionado. Democratiza el sake sin perder la exclusividad. Habla a quien quiere descubrir algo nuevo.',
    hashtags: '#ArumeSakeBar #Sake #SakePremium #TiendaSake #Mallorca #SakeEspaña #NihonShu #TakeAway',
    ctas    : ['Disponible en tienda 🛒', 'Pásate a probarlo 👇', 'También para llevar 📦', 'Nueva llegada ⚡', 'Edición limitada 🍶'],
    colores : 'Dorado, negro y blanco. Packaging japonés auténtico.',
    reelHook: 'Educativo y sorprendente, cuenta algo que nadie sabe del sake en 3 segundos, ritmo tranquilo pero con dato inesperado',
    imgStyle: 'Clean product shot, warm wooden or marble surface, Japanese bottle label in focus, lifestyle context, premium sake display',
  },
  academy: {
    id      : 'academy',
    nombre  : 'Arume Sake Academy',
    emoji   : '🎓',
    color   : 'from-violet-600 to-indigo-500',
    estilo  : 'Contenido educativo sobre cultura sake y japonesa. Posiciona a Arume como la referencia en España. Didáctico, sorprendente.',
    tono    : 'Experto pero accesible. Enseña sin pedantería. Cada post revela algo que el lector no sabía y quiere compartir.',
    hashtags: '#ArumeSakeBar #CulturaSake #SakeJapones #Mallorca #AprendeSake #NihonShu #SakeLovers #JaponesGastronomia',
    ctas    : ['¿Lo sabías? Cuéntanos 👇', 'Guarda este post 🔖', 'Compártelo con un amigo 🍶', 'Síguenos para más 📚'],
    colores : 'Negro, blanco y violeta sutil. Estética editorial japonesa.',
    reelHook: 'Dato sorprendente en los primeros 2 segundos ("El sake más caro del mundo cuesta..."), formato pregunta-respuesta, subtítulos grandes',
    imgStyle: 'Editorial flat lay, Japanese cultural elements, sake vessel or traditional cup, clean minimalist composition, educational infographic feel',
  },
  b2b: {
    id      : 'b2b',
    nombre  : 'Arume — Distribución B2B',
    emoji   : '📦',
    color   : 'from-slate-600 to-slate-500',
    estilo  : 'Distribución premium de sake a hoteles, restaurantes y comercios de Mallorca. Profesional, fiable, exclusivo.',
    tono    : 'Profesional y directo. Habla a compradores y directores de F&B. Transmite confianza, exclusividad y servicio personalizado.',
    hashtags: '#ArumeSakeBar #SakeDistribucion #Mallorca #HotelesYRestaurantes #SakePremium #FoodAndBeverage #B2BMallorca',
    ctas    : ['Contacta con nuestro equipo 📩', 'Solicita tu catálogo 📋', 'Distribución exclusiva en Mallorca 🏝️', 'Hablemos 👇'],
    colores : 'Negro, blanco y gris slate. Elegante y corporativo.',
    reelHook: 'Muestra el proceso de selección y cata, detrás de escenas del almacén o entrega, credibilidad y expertise',
    imgStyle: 'Corporate lifestyle photography, sake bottles arranged professionally, hotel or restaurant setting, B2B meeting context, clean and professional',
  },
} as const;

type BrandId = keyof typeof BRANDS;

// ── Redes ────────────────────────────────────────────────────────────────────
const REDES = [
  { id: 'instagram', label: 'Instagram', emoji: '📸', color: 'from-fuchsia-500 to-rose-500',  hint: 'Hasta 2.200 chars · emojis · hashtags al final · gancho en 1ª línea', maxChars: 2200, bestHours: '19:00' },
  { id: 'facebook',  label: 'Facebook',  emoji: '👥', color: 'from-blue-600 to-blue-400',      hint: 'Tono informativo · CTA claro · puede ser más largo',                  maxChars: 63206, bestHours: '13:00' },
  { id: 'tiktok',    label: 'TikTok',    emoji: '🎵', color: 'from-slate-800 to-slate-600',    hint: 'Texto muy breve · gancho visual en 1ª línea · trendy y directo',       maxChars: 2200, bestHours: '19:00' },
  { id: 'gmb',       label: 'Google',    emoji: '🌐', color: 'from-emerald-500 to-teal-500',   hint: 'Local SEO · palabras clave · máx 1.500 chars',                         maxChars: 1500, bestHours: '10:00' },
] as const;
type RedId = 'instagram' | 'facebook' | 'tiktok' | 'gmb';
type TabKey = 'auto' | 'studio' | 'calendar' | 'reviews' | 'drive' | 'telegram' | 'historia';

interface Post {
  id           : string;
  date         : string;
  time        ?: string;
  red          : RedId;
  brand        : BrandId;
  copy         : string;
  imageUrl    ?: string;
  driveFileUrl?: string;
  published    : boolean;
  recycled    ?: boolean;
  formato     ?: string;
}

interface DriveMedia {
  id      : string;
  name    : string;
  url     : string;
  thumb  ?: string;
  type    : 'image' | 'video';
  mimeType: string;
}

interface TgMsg {
  id           : string;
  texto       ?: string;
  negocio     ?: string;
  categoria   ?: string;
  created_at   : string;
  procesado_n8n: boolean;
}

interface CopyRecord {
  id         : string;
  brand      : BrandId;
  red        : RedId;
  formato    : string;
  copy       : string;
  idea       : string;
  rating    ?: number;
  created_at : string;
}

interface BrandMemory {
  brand        : BrandId;
  best_copies  : string[];
  learned_style: string;
  total_posts  : number;
  updated_at   : string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const uid     = () => `mk-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
const todayS  = () => new Date().toISOString().slice(0,10);
const fmtDate = (d: string) => new Date(d).toLocaleDateString('es-ES',{day:'2-digit',month:'short'});
const MONTHS  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const WDAYS   = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

function extractDriveFolderId(url: string): string | null {
  const m = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════════════════════
export const MarketingView = ({ data }: { data?: AppData }) => {
  const platos = useMemo(() => Array.isArray(data?.platos) ? (data!.platos as any[]) : [], [data]);

  // ── Brand selector ────────────────────────────────────────────────────────
  const [brand, setBrand] = useState<BrandId>('restaurante');
  const BRAND = BRANDS[brand] ?? BRANDS['restaurante'];

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabKey>('auto');

  // ── Studio ────────────────────────────────────────────────────────────────
  const [red,        setRed]        = useState<RedId>('instagram');
  const [formato,    setFormato]    = useState('Post');
  const [platoSel,   setPlatoSel]   = useState('');
  const [idea,       setIdea]       = useState('');
  const [postTime,   setPostTime]   = useState('19:00');
  const [genCopy,    setGenCopy]    = useState(false);
  const [genImg,     setGenImg]     = useState(false);
  const [copy,       setCopy]       = useState('');
  const [imgB64,     setImgB64]     = useState('');
  const [imgError,   setImgError]   = useState('');
  const [copied,     setCopied]     = useState<string|null>(null);
  const [savingPost, setSavingPost] = useState(false);
  const [brandMemory,setBrandMemory]= useState<BrandMemory|null>(null);
  const [copyHistory,setCopyHistory]= useState<CopyRecord[]>([]);
  const [uploadedImg,setUploadedImg]= useState<{b64:string;mime:string;name:string}|null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Calendar ──────────────────────────────────────────────────────────────
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);
  const [calM, setCalM] = useState(new Date().getMonth());
  const [calY, setCalY] = useState(new Date().getFullYear());

  // ── Reviews ───────────────────────────────────────────────────────────────
  const [reviewerName, setReviewerName] = useState('');
  const [rating,       setRating]       = useState(4);
  const [reviewText,   setReviewText]   = useState('');
  const [reply,        setReply]        = useState('');
  const [genReply,     setGenReply]     = useState(false);

  // ── Telegram ──────────────────────────────────────────────────────────────
  const [tgMsgs, setTgMsgs] = useState<TgMsg[]>([]);
  const [tgLoad, setTgLoad] = useState(false);
  const [tgErr,  setTgErr]  = useState('');

  // ── Drive ─────────────────────────────────────────────────────────────────
  const [driveInput, setDriveInput] = useState('');
  const [driveMedia, setDriveMedia] = useState<DriveMedia[]>([]);
  const [driveLoad,  setDriveLoad]  = useState(false);
  const [driveErr,   setDriveErr]   = useState('');
  const [weekPlan,   setWeekPlan]   = useState<{day:string;media:DriveMedia;copy:string;red:RedId;time:string;isReel:boolean}[]>([]);
  const [genWeek,    setGenWeek]    = useState(false);
  const [selMedia,   setSelMedia]   = useState<Set<string>>(new Set());
  const [driveUrl,   setDriveUrl]   = useState(() => localStorage.getItem('arume_drive_url') || '');

  // ── AI helper (centralizado en aiProviders) ────────────────────────────────

  const doCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // ── Cargar posts desde Supabase ───────────────────────────────────────────
  const loadPosts = useCallback(async () => {
    const db = getArumDB();
    if (!db) { setPostsLoaded(true); return; }
    try {
      const { data: rows } = await db
        .from('marketing_posts')
        .select('*')
        .order('date', { ascending: true });
      if (rows) setPosts(rows as Post[]);
    } catch { /* silent */ }
    setPostsLoaded(true);
  }, []);

  // ── Cargar memoria de marca ───────────────────────────────────────────────
  const loadBrandMemory = useCallback(async (b: BrandId) => {
    const db = getArumDB();
    if (!db) return;
    try {
      const { data } = await db
        .from('marketing_brand_memory')
        .select('*')
        .eq('brand', b)
        .single();
      if (data) setBrandMemory(data as BrandMemory);
      else setBrandMemory(null);
    } catch { setBrandMemory(null); }
  }, []);

  // ── Cargar historial de copies ────────────────────────────────────────────
  const loadCopyHistory = useCallback(async (b: BrandId) => {
    const db = getArumDB();
    if (!db) return;
    try {
      const { data } = await db
        .from('marketing_copies')
        .select('*')
        .eq('brand', b)
        .order('created_at', { ascending: false })
        .limit(30);
      if (data) setCopyHistory(data as CopyRecord[]);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadPosts(); }, [loadPosts]);
  useEffect(() => { loadBrandMemory(brand); loadCopyHistory(brand); }, [brand, loadBrandMemory, loadCopyHistory]);
  useEffect(() => { if (driveUrl) localStorage.setItem('arume_drive_url', driveUrl); }, [driveUrl]);

  // ── Guardar post en Supabase ──────────────────────────────────────────────
  const savePostToDB = async (post: Post) => {
    const db = getArumDB();
    if (!db) { setPosts(prev => [...prev, post]); return; }
    const { error } = await db.from('marketing_posts').insert(post);
    if (!error) setPosts(prev => [...prev, post]);
  };

  const updatePost = async (id: string, changes: Partial<Post>) => {
    setPosts(prev => prev.map(p => p.id === id ? { ...p, ...changes } : p));
    const db = getArumDB();
    if (db) await db.from('marketing_posts').update(changes).eq('id', id);
  };

  const deletePost = async (id: string) => {
    setPosts(prev => prev.filter(p => p.id !== id));
    const db = getArumDB();
    if (db) await db.from('marketing_posts').delete().eq('id', id);
  };

  // ── Actualizar memoria de marca ───────────────────────────────────────────
  const updateBrandMemory = async (b: BrandId, newCopy: string) => {
    const db = getArumDB();
    if (!db) return;
    try {
      const existing = brandMemory?.best_copies || [];
      const allCopies = [...existing.slice(-4), newCopy];
      const learnPrompt = `Analiza estos ${allCopies.length} copies de "${BRANDS[b].nombre}" y extrae en 3 frases cortas:
1. Qué estilo de redacción funciona mejor
2. Qué elementos visuales o palabras resuenan más
3. Qué tono específico tiene esta marca en redes

Copies: ${allCopies.map((c,i) => `[${i+1}] ${c.slice(0,200)}`).join('\n')}

Responde SOLO con las 3 frases, sin numeración ni markdown.`;
      const res = await askAI([{ role: 'user', content: learnPrompt }]);
      const learned = (res.text || '').trim();

      const mem: BrandMemory = {
        brand: b,
        best_copies: allCopies.slice(-10),
        learned_style: learned,
        total_posts: (brandMemory?.total_posts || 0) + 1,
        updated_at: new Date().toISOString(),
      };
      await db.from('marketing_brand_memory').upsert(mem, { onConflict: 'brand' });
      setBrandMemory(mem);
    } catch { /* silent */ }
  };

  // ── Guardar copy en historial ─────────────────────────────────────────────
  const saveCopyToHistory = async (copyText: string) => {
    const db = getArumDB();
    const record: CopyRecord = {
      id: uid(), brand, red, formato, copy: copyText, idea,
      created_at: new Date().toISOString(),
    };
    if (db) {
      await db.from('marketing_copies').insert(record);
    }
    setCopyHistory(prev => [record, ...prev.slice(0, 29)]);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. GENERAR COPY (con memoria de marca + análisis de imagen si hay)
  // ═══════════════════════════════════════════════════════════════════════════
  const generateCopy = async () => {
    if (!idea.trim() && !platoSel && !uploadedImg) return void toast.info('Describe una idea, selecciona un plato o sube una imagen.');
    setGenCopy(true); setCopy(''); setImgError('');
    try {
      const redInfo = REDES.find(r => r.id === red)!;
      const cta     = BRAND.ctas[Math.floor(Math.random() * BRAND.ctas.length)];
      const memCtx  = brandMemory?.learned_style
        ? `\nAPRENDIZAJE PREVIO DE LA MARCA (úsalo para mejorar): ${brandMemory.learned_style}`
        : '';
      const reelCtx = formato === 'Reel'
        ? `\nFORMATO REEL: Estructura: [GANCHO 3 seg] → [DESARROLLO 15 seg] → [CTA final]. Hook visual: ${BRAND.reelHook}. Incluye sugerencias de texto en pantalla entre corchetes [ASÍ].`
        : '';

      const isReel = formato === 'Reel';

      if (uploadedImg) {
        // Análisis de imagen real con visión centralizada
        const visionPrompt = `Eres el Social Media Manager de "${BRAND.nombre}".
Estilo: ${BRAND.estilo}
Tono: ${BRAND.tono}${memCtx}${reelCtx}
Analiza esta imagen/vídeo y crea el copy perfecto para ${redInfo.label} (${isReel ? 'REEL' : 'POST'}).
${idea ? `Contexto adicional: "${idea}".` : ''}
Reglas: ${redInfo.hint}
Hashtags obligatorios: ${BRAND.hashtags}
CTA: ${cta}
Responde con un JSON: {"copy": "el texto completo del post aquí"}`;
        const scanRes = await scanBase64(uploadedImg.b64, uploadedImg.mime, visionPrompt);
        const text = ((scanRes.raw?.copy as string) || JSON.stringify(scanRes.raw)).replace(/^"|"$/g, '').trim();
        setCopy(text);
        await saveCopyToHistory(text);
        await updateBrandMemory(brand, text);
      } else {
        const prompt = `Eres el Social Media Manager de "${BRAND.nombre}".
Estilo: ${BRAND.estilo}
Tono: ${BRAND.tono}${memCtx}${reelCtx}
Tipo: ${formato} para ${redInfo.label}.
${platoSel ? `Protagonista: "${platoSel}".` : ''}
${idea      ? `Idea base: "${idea}".`         : ''}
Reglas: ${redInfo.hint}
Hashtags: ${BRAND.hashtags}
CTA: ${cta}
Devuelve ÚNICAMENTE el texto del post. Sin comillas ni markdown.`;
        const res = await askAI([{ role: 'user', content: prompt }]);
        const text = (res.text || '').replace(/^"|"$/g, '').trim();
        setCopy(text);
        await saveCopyToHistory(text);
        await updateBrandMemory(brand, text);
      }
    } catch (e: any) { toast.info('Error generando copy: ' + e.message); }
    finally { setGenCopy(false); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. GENERAR IMAGEN
  // ═══════════════════════════════════════════════════════════════════════════
  const generateImage = async () => {
    const gemKey = keys.gemini();
    if (!gemKey) { toast.info('⚠️ Añade tu Gemini API Key en Configuración para generar imágenes.'); return; }
    if (!idea.trim() && !platoSel && !copy) return void toast.info('Escribe una idea o genera el copy primero.');
    setGenImg(true); setImgB64(''); setImgError('');
    try {
      const subject   = platoSel || idea || 'contenido premium de Arume Sake Bar';
      const imgPrompt = `${BRAND.imgStyle} of ${subject} for ${BRAND.nombre} in Mallorca.
Color palette: ${BRAND.colores}.
Photorealistic, ultra detailed, no text, no watermark, commercial photography for Instagram.`;

      const body = {
        contents: [{ role: 'user', parts: [{ text: imgPrompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${gemKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      let found = false;
      for (const part of parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          setImgB64(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
          found = true; break;
        }
      }
      if (!found) {
        setImgError('Generación no disponible en tu plan. Prueba en aistudio.google.com.');
      }
    } catch (e: any) {
      setImgError('Error: ' + (e.message || String(e)));
    } finally { setGenImg(false); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. SUBIR IMAGEN / VÍDEO PARA ANÁLISIS
  // ═══════════════════════════════════════════════════════════════════════════
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const b64  = await toBase64(file);
    setUploadedImg({ b64, mime: file.type, name: file.name });
    setImgB64(''); setImgError('');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. GUARDAR EN CALENDARIO
  // ═══════════════════════════════════════════════════════════════════════════
  const saveToCalendar = async () => {
    if (!copy) return;
    setSavingPost(true);
    const post: Post = {
      id: uid(), date: todayS(), time: postTime,
      red, brand, copy, formato,
      imageUrl: imgB64 || undefined,
      published: false, recycled: false,
    };
    await savePostToDB(post);
    setTimeout(() => setSavingPost(false), 600);
  };

  const downloadImage = () => {
    if (!imgB64) return;
    const a = document.createElement('a');
    a.href = imgB64; a.download = `${brand}_post_${Date.now()}.png`; a.click();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. RESPONDER RESEÑA
  // ═══════════════════════════════════════════════════════════════════════════
  const generateReviewReply = async () => {
    if (!reviewText.trim()) return void toast.info('Pega el texto de la reseña primero.');
    setGenReply(true); setReply('');
    try {
      const stars  = '⭐'.repeat(rating);
      const prompt = `Eres el responsable de RR.PP. de "${BRAND.nombre}".
Tono: ${BRAND.tono}
Reseña de ${reviewerName || 'un cliente'} (${stars} ${rating}/5): "${reviewText}"
Respuesta profesional y empática en español:
- 4-5★: Agradece con calidez, invita a volver.
- 3★: Agradece, reconoce mejora, ofrece solución.
- 1-2★: Disculpa sincera, empatía real, invita a contacto privado.
Máximo 130 palabras. Sin comillas externas. Solo la respuesta.`;
      const res = await askAI([{ role: 'user', content: prompt }]);
      setReply((res.text || '').trim());
    } catch (e: any) { toast.info('Error: ' + e.message); }
    finally { setGenReply(false); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. TELEGRAM SYNC
  // ═══════════════════════════════════════════════════════════════════════════
  const fetchTelegram = async () => {
    const db = getPersonalDB();
    if (!db) return setTgErr('Faltan VITE_PERSONAL_SUPABASE_URL y VITE_PERSONAL_SUPABASE_KEY en .env');
    setTgLoad(true); setTgErr('');
    try {
      const negFilter = brand === 'restaurante' ? 'arume,restaurante' : brand === 'tienda' ? 'tienda,sake' : brand === 'academy' ? 'academy,sake' : 'b2b,distribucion';
      const { data: rows, error } = await db
        .from('bottelegram').select('*').eq('procesado_n8n', false)
        .or(`negocio.ilike.%${negFilter.split(',')[0]}%,negocio.ilike.%${negFilter.split(',')[1]}%,categoria.ilike.%marketing%`)
        .order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      setTgMsgs(rows || []);
    } catch (e: any) { setTgErr(e.message); }
    finally { setTgLoad(false); }
  };

  const markProcessed = async (id: string) => {
    const db = getPersonalDB(); if (!db) return;
    await db.from('bottelegram').update({ procesado_n8n: true }).eq('id', id);
    setTgMsgs(prev => prev.filter(m => m.id !== id));
  };

  const useAsIdea = (msg: TgMsg) => { setIdea(msg.texto || ''); setTab('studio'); };

  // ── Reciclar post ──────────────────────────────────────────────────────────
  const recyclePost = async (p: Post) => {
    const np: Post = { ...p, id: uid(), date: todayS(), published: false, recycled: true };
    await savePostToDB(np);
  };

  // ── Cargar Drive (vía proxy thumbnail, sin CORS) ───────────────────────────
  const loadDriveFolder = async () => {
    if (!driveInput.trim()) return;
    const folderId = extractDriveFolderId(driveInput.trim()) || driveInput.trim();
    setDriveLoad(true); setDriveErr(''); setDriveMedia([]);
    try {
      // Intentar cargar via embeddedfolderview
      const proxyUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;
      const res = await fetch(proxyUrl, { mode: 'no-cors' }).catch(() => null);

      // Generar media items directamente desde el folder ID con thumbnails conocidos
      // Nota: sin API key solo podemos inferir archivos — usar Google Picker en producción
      const mockMedia: DriveMedia[] = Array.from({ length: 12 }, (_, i) => ({
        id      : `file_${folderId}_${i}`,
        name    : `contenido_${i + 1}`,
        url     : `https://drive.google.com/drive/folders/${folderId}`,
        thumb   : `https://drive.google.com/thumbnail?id=${folderId}&sz=w400`,
        type    : i % 4 === 0 ? 'video' : 'image',
        mimeType: i % 4 === 0 ? 'video/mp4' : 'image/jpeg',
      }));

      // Intentar parsear HTML si CORS lo permite
      try {
        const r2 = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`);
        if (r2.ok) {
          const html = await r2.text();
          const idMatches = [...html.matchAll(/\/file\/d\/([a-zA-Z0-9_-]+)/g)];
          const seen = new Set<string>();
          const media: DriveMedia[] = [];
          for (const m of idMatches) {
            const fileId = m[1];
            if (seen.has(fileId)) continue;
            seen.add(fileId);
            const ctx   = html.substring(Math.max(0, html.indexOf(fileId)-200), html.indexOf(fileId)+200);
            const isVid = /video|mp4|mov|avi/i.test(ctx);
            media.push({
              id: fileId, name: `archivo_${media.length+1}`,
              url  : `https://drive.google.com/file/d/${fileId}/view`,
              thumb: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
              type : isVid ? 'video' : 'image',
              mimeType: isVid ? 'video/mp4' : 'image/jpeg',
            });
            if (media.length >= 50) break;
          }
          if (media.length > 0) { setDriveMedia(media); setDriveUrl(driveInput.trim()); setDriveInput(''); setDriveLoad(false); return; }
        }
      } catch { /* CORS bloqueado, usar alternativa */ }

      // Si CORS falla, ofrecer subida manual
      setDriveErr('Google Drive bloquea el acceso directo por CORS. Usa la opción "Subir archivos" abajo para analizarlos con IA directamente.');
    } catch (e: any) { setDriveErr(e.message); }
    finally { setDriveLoad(false); }
  };

  // ── Generar parrilla semanal ───────────────────────────────────────────────
  const generateWeekPlan = async () => {
    const mediaToUse = driveMedia.filter(m => selMedia.size === 0 || selMedia.has(m.id));
    if (mediaToUse.length === 0) return void toast.info('Carga la carpeta de Drive primero o sube archivos.');
    setGenWeek(true); setWeekPlan([]);
    try {
      const memCtx = brandMemory?.learned_style
        ? `\nESTILO APRENDIDO: ${brandMemory.learned_style}` : '';
      const today = new Date();
      const schedule = [
        { red: 'instagram' as RedId, time: '19:00', isReel: false },
        { red: 'facebook'  as RedId, time: '13:00', isReel: false },
        { red: 'instagram' as RedId, time: '20:00', isReel: true  },
        { red: 'tiktok'    as RedId, time: '18:00', isReel: true  },
        { red: 'instagram' as RedId, time: '19:30', isReel: false },
        { red: 'facebook'  as RedId, time: '13:00', isReel: false },
        { red: 'gmb'       as RedId, time: '10:00', isReel: false },
      ];
      const plan: typeof weekPlan = [];
      for (let i = 0; i < Math.min(7, mediaToUse.length); i++) {
        const m       = mediaToUse[i % mediaToUse.length];
        const s       = schedule[i];
        const redInfo = REDES.find(x => x.id === s.red)!;
        const dayDate = new Date(today);
        dayDate.setDate(today.getDate() + i);
        const reelCtx = s.isReel
          ? `FORMATO REEL: Estructura [GANCHO 3s] → [DESARROLLO 15s] → [CTA]. Hook: ${BRAND.reelHook}. Incluye texto en pantalla entre [corchetes].`
          : '';
        const prompt = `Eres el CMO de "${BRAND.nombre}".${memCtx}
Crea un ${s.isReel ? 'REEL' : 'post'} para ${redInfo.label}.
Archivo: "${m.name}" (${m.type === 'video' ? 'vídeo' : 'imagen'}).
Tono: ${BRAND.tono}. ${reelCtx}
Reglas: ${redInfo.hint}.
Hashtags: ${BRAND.hashtags}. CTA: ${BRAND.ctas[i % BRAND.ctas.length]}.
Solo el texto del post, sin comillas.`;
        const res = await askAI([{ role: 'user', content: prompt }]);
        plan.push({
          day: dayDate.toISOString().slice(0,10),
          media: m, copy: (res.text||'').trim(),
          red: s.red, time: s.time, isReel: s.isReel,
        });
      }
      setWeekPlan(plan);
    } catch (e: any) { toast.info('Error: ' + e.message); }
    finally { setGenWeek(false); }
  };

  const saveWeekPlan = async () => {
    for (const p of weekPlan) {
      const post: Post = {
        id: uid(), date: p.day, time: p.time, red: p.red, brand,
        copy: p.copy, formato: p.isReel ? 'Reel' : 'Post',
        driveFileUrl: p.media.url, imageUrl: p.media.thumb,
        published: false, recycled: false,
      };
      await savePostToDB(post);
    }
    toast.info(`✅ ${weekPlan.length} posts añadidos al calendario.`);
  };

  const toggleSelMedia = (id: string) => setSelMedia(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // ── Calendario helpers ─────────────────────────────────────────────────────
  const calDays = useMemo(() => {
    const first = new Date(calY, calM, 1).getDay();
    return { offset: first === 0 ? 6 : first - 1, total: new Date(calY, calM+1, 0).getDate() };
  }, [calM, calY]);

  const postsByDate = useMemo(() => {
    const m: Record<string, Post[]> = {};
    posts.forEach(p => { if (!m[p.date]) m[p.date]=[]; m[p.date].push(p); });
    return m;
  }, [posts]);

  const metricsThisMonth = useMemo(() => {
    const monthKey = `${calY}-${String(calM+1).padStart(2,'0')}`;
    const mp       = posts.filter(p => p.date.startsWith(monthKey));
    const byRed    = REDES.map(r => ({
      ...r,
      count    : mp.filter(p => p.red === r.id).length,
      published: mp.filter(p => p.red === r.id && p.published).length,
    }));
    return { total: mp.length, publishedTotal: mp.filter(p=>p.published).length, byRed };
  }, [posts, calM, calY]);

  const togglePublished = (id: string) => {
    const p = posts.find(x => x.id === id);
    if (p) updatePost(id, { published: !p.published });
  };

  // ── Canva Design Integration ─────────────────────────────────────────────
  // URLs de landing pages de Canva por formato (crean un diseño nuevo con el tamaño correcto)
  const CANVA_URLS: Record<string, { url: string; label: string; size: string }> = {
    'Post-instagram'   : { url: 'https://www.canva.com/create/instagram-posts/',         label: 'Instagram Post',    size: '1080×1080' },
    'Stories-instagram': { url: 'https://www.canva.com/create/instagram-stories/',       label: 'Instagram Stories', size: '1080×1920' },
    'Reel-instagram'   : { url: 'https://www.canva.com/create/instagram-reels/',         label: 'Instagram Reel',    size: '1080×1920' },
    'Post-facebook'    : { url: 'https://www.canva.com/create/facebook-posts/',          label: 'Facebook Post',     size: '1200×630'  },
    'Stories-facebook' : { url: 'https://www.canva.com/create/facebook-stories/',        label: 'Facebook Stories',  size: '1080×1920' },
    'Post-tiktok'      : { url: 'https://www.canva.com/create/tiktok-videos/',           label: 'TikTok Video',      size: '1080×1920' },
    'Reel-tiktok'      : { url: 'https://www.canva.com/create/tiktok-videos/',           label: 'TikTok Reel',       size: '1080×1920' },
    'Post-gmb'         : { url: 'https://www.canva.com/create/google-my-business-posts/', label: 'Google Business', size: '1200×900'  },
    'default'          : { url: 'https://www.canva.com/create/instagram-posts/',         label: 'Post Instagram',    size: '1080×1080' },
  };

  const openInCanva = (copyText?: string) => {
    const key = `${formato}-${red}`;
    const canvaInfo = CANVA_URLS[key] || CANVA_URLS['default'];
    const textToCopy = copyText || copy;
    if (textToCopy) navigator.clipboard.writeText(textToCopy).catch(() => {});
    window.open(canvaInfo.url, '_blank');
  };

  // ── Exportar posts a Google Calendar (.ICS) ────────────────────────────────
  const exportToICS = () => {
    const monthKey = `${calY}-${String(calM+1).padStart(2,'0')}`;
    const monthPosts = posts.filter(p => p.date.startsWith(monthKey));
    if (monthPosts.length === 0) return void toast.info('No hay posts en este mes para exportar.');
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Arume Marketing//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    monthPosts.forEach(p => {
      const r = REDES.find(r2 => r2.id === p.red);
      const bk = BRANDS[p.brand as BrandId] ?? BRANDS['restaurante'];
      const [hh, mm] = (p.time || '12:00').split(':').map(Number);
      const dt = new Date(p.date + 'T' + (p.time || '12:00') + ':00');
      const fmt = (d: Date) => d.toISOString().replace(/[-:]/g,'').replace(/.d{3}/,'');
      const dtStart = `${p.date.replace(/-/g,'')}T${String(hh).padStart(2,'0')}${String(mm).padStart(2,'0')}00`;
      const dtEnd = new Date(dt.getTime() + 60*60*1000);
      const dtEndStr = `${dtEnd.toISOString().slice(0,10).replace(/-/g,'')}T${String(dtEnd.getHours()).padStart(2,'0')}${String(dtEnd.getMinutes()).padStart(2,'0')}00`;
      const summary = `[${r?.label || p.red.toUpperCase()}] ${bk.emoji} ${p.formato || 'Post'} — ${p.copy.slice(0,60).replace(/[\r\n]/g,' ')}`;
      const desc = p.copy.replace(/[\r\n]+/g,' ').replace(/,/g,'\,').replace(/;/g,'\;');
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${p.id}@arumepro`);
      lines.push(`DTSTART:${dtStart}`);
      lines.push(`DTEND:${dtEndStr}`);
      lines.push(`SUMMARY:${summary}`);
      lines.push(`DESCRIPTION:${desc.slice(0,500)}`);
      lines.push(`STATUS:${p.published ? 'CONFIRMED' : 'TENTATIVE'}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arume_marketing_${MONTHS[calM]}_${calY}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openInGoogleCalendar = (p: Post) => {
    const r = REDES.find(r2 => r2.id === p.red);
    const bk = BRANDS[p.brand as BrandId] ?? BRANDS['restaurante'];
    const [hh, mm] = (p.time || '12:00').split(':').map(Number);
    const dt = new Date(p.date + 'T' + (p.time || '12:00') + ':00');
    const dtEnd = new Date(dt.getTime() + 60*60*1000);
    const pad = (n: number) => String(n).padStart(2,'0');
    const fmtGCal = (d: Date) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const title = encodeURIComponent(`[${r?.label || p.red.toUpperCase()}] ${bk.emoji} ${p.formato || 'Post'}`);
    const details = encodeURIComponent(p.copy.slice(0,500));
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmtGCal(dt)}/${fmtGCal(dtEnd)}&details=${details}`;
    window.open(url, '_blank');
  };

  // Chars counter
  const redInfo = REDES.find(r => r.id === red)!;
  const charsLeft = redInfo.maxChars - copy.length;

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="max-w-[1600px] mx-auto pb-24 space-y-4 px-2 sm:px-0 animate-fade-in">

      {/* HEADER */}
      <header className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 space-y-3 relative overflow-hidden">
        <div className={cn('absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r', BRAND.color)}/>

        {/* Brand selector + título */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn('p-2 bg-gradient-to-br rounded-lg shadow-sm', BRAND.color)}>
              <Megaphone className="w-5 h-5 text-white"/>
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">Marketing Studio</h2>
              <p className={cn('text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r bg-clip-text text-transparent', BRAND.color)}>
                @ArumeSakeBar · {brand === 'restaurante' ? 'Restaurante' : brand === 'tienda' ? 'Tienda & Take Away' : brand === 'academy' ? 'Sake Academy' : 'Distribución B2B'}
              </p>
            </div>
          </div>

          {/* Selector tipo de contenido */}
          <div className="flex flex-wrap gap-1.5">
            {(Object.values(BRANDS) as typeof BRANDS[BrandId][]).map(b => (
              <button key={b.id} onClick={() => setBrand(b.id as BrandId)}
                className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 text-[10px] font-black transition-all',
                  brand === b.id
                    ? cn('bg-gradient-to-r text-white border-transparent shadow-md', b.color)
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300')}>
                <span>{b.emoji}</span>
                <span className="hidden sm:inline">{b.id === 'restaurante' ? 'Restaurante' : b.id === 'tienda' ? 'Tienda' : b.id === 'academy' ? 'Academy' : 'B2B'}</span>
                {brandMemory?.brand === b.id && brandMemory.total_posts > 0 && (
                  <span className="bg-white/30 text-white text-[8px] px-1 rounded">{brandMemory.total_posts}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <nav className="flex gap-1 bg-slate-100 p-1 rounded-lg w-full overflow-x-auto">
          {([
            { key:'auto',     icon:Sparkles,    label:'Agente Auto'},
            { key:'studio',   icon:Wand2,       label:'Studio IA'  },
            { key:'calendar', icon:CalendarDays, label:'Calendario' },
            { key:'reviews',  icon:Star,         label:'Reseñas'    },
            { key:'drive',    icon:FolderOpen,   label:'Drive'      },
            { key:'historia', icon:History,      label:'Historial'  },
            { key:'telegram', icon:Smartphone,   label:'Telegram'   },
          ] as {key:TabKey;icon:any;label:string}[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap',
                tab === t.key ? 'bg-white shadow-sm text-fuchsia-600 border border-fuchsia-100' : 'text-slate-500 hover:text-slate-700')}>
              <t.icon className="w-3.5 h-3.5"/>
              {t.label}
              {t.key === 'telegram' && tgMsgs.length > 0 && (
                <span className="bg-rose-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black">{tgMsgs.length}</span>
              )}
              {t.key === 'historia' && copyHistory.length > 0 && (
                <span className="bg-slate-400 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black">{copyHistory.length}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Memoria de marca */}
        {brandMemory && (
          <div className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
            <Brain className="w-3.5 h-3.5 text-violet-500 shrink-0 mt-0.5"/>
            <p className="text-[10px] font-medium text-violet-700 leading-relaxed">
              <span className="font-black">Memoria activa ({brandMemory.total_posts} posts):</span> {brandMemory.learned_style}
            </p>
          </div>
        )}
      </header>

      <AnimatePresence mode="wait">

        {/* ═══════════ TAB AGENTE AUTO ═══════════ */}
        {tab === 'auto' && (
          <motion.div key="auto" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}>
            <AutoAgentPanel
              brand={brand}
              BRAND={BRAND}
              platos={platos}
              posts={posts}
              savePostToDB={savePostToDB}
            />
          </motion.div>
        )}

        {/* ═══════════ TAB STUDIO IA ═══════════ */}
        {tab === 'studio' && (
          <motion.div key="studio" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* LEFT */}
            <div className="space-y-4">

              {/* Red social */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                  <Share2 className="w-3.5 h-3.5 text-fuchsia-500"/> Red Social
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {REDES.map(r => (
                    <button key={r.id} onClick={() => setRed(r.id)}
                      className={cn('flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-[10px] font-black uppercase tracking-widest',
                        red === r.id
                          ? cn('bg-gradient-to-br text-white border-transparent shadow-md', r.color)
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300')}>
                      <span className="text-lg">{r.emoji}</span>{r.label}
                      <span className="text-[8px] opacity-70">mejor: {r.bestHours}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[9px] font-bold text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
                  💡 {REDES.find(r => r.id === red)?.hint}
                </p>
              </div>

              {/* Tipo de contenido */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                  <PenTool className="w-3.5 h-3.5 text-fuchsia-500"/> Formato
                </h3>
                <div className="flex flex-wrap gap-2">
                  {['Post','Stories','Reel','Evento','Promo','Apertura semana','Menú del día','Novedad'].map(f => (
                    <button key={f} onClick={() => setFormato(f)}
                      className={cn('px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-1',
                        formato === f
                          ? 'bg-fuchsia-600 text-white border-fuchsia-600 shadow-sm'
                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-fuchsia-300')}>
                      {f === 'Reel' && <Film className="w-3 h-3"/>}
                      {f}
                    </button>
                  ))}
                </div>
                {formato === 'Reel' && (
                  <div className="bg-fuchsia-50 border border-fuchsia-100 rounded-lg px-3 py-2 flex items-start gap-2">
                    <Film className="w-3.5 h-3.5 text-fuchsia-500 shrink-0 mt-0.5"/>
                    <p className="text-[10px] font-bold text-fuchsia-700">
                      Modo Reel: el copy incluirá estructura de guión con texto en pantalla [entre corchetes] y gancho visual para los primeros 3 segundos.
                    </p>
                  </div>
                )}
              </div>

              {/* Briefing + subida de archivo */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                  <Lightbulb className="w-3.5 h-3.5 text-fuchsia-500"/> Briefing
                </h3>
                {platos.length > 0 && (
                  <select value={platoSel} onChange={e => setPlatoSel(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-200 rounded-lg bg-slate-50 text-slate-700 outline-none focus:ring-2 ring-fuchsia-200">
                    <option value="">— Plato (opcional) —</option>
                    {platos.map((p: any) => <option key={p.id} value={p.n||p.nombre||p.name}>{p.n||p.nombre||p.name}</option>)}
                  </select>
                )}
                <textarea value={idea} onChange={e => setIdea(e.target.value)} rows={3}
                  placeholder="Describe la idea, evento, promo..."
                  className="w-full px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50 text-slate-700 outline-none focus:ring-2 ring-fuchsia-200 resize-none"/>

                {/* Subida de imagen/vídeo */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-4 flex flex-col items-center gap-2 cursor-pointer transition-all text-center',
                    uploadedImg ? 'border-fuchsia-300 bg-fuchsia-50' : 'border-slate-200 hover:border-fuchsia-300 bg-slate-50'
                  )}>
                  <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileUpload}/>
                  {uploadedImg ? (
                    <>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-fuchsia-500"/>
                        <p className="text-[11px] font-black text-fuchsia-700">{uploadedImg.name}</p>
                        <button onClick={e => { e.stopPropagation(); setUploadedImg(null); }}
                          className="text-slate-400 hover:text-rose-500"><X className="w-3.5 h-3.5"/></button>
                      </div>
                      <p className="text-[10px] font-bold text-fuchsia-500">✨ Gemini analizará esta imagen para generar el copy perfecto</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-slate-300"/>
                      <p className="text-[11px] font-black text-slate-500">Sube tu foto o vídeo</p>
                      <p className="text-[10px] font-bold text-slate-400">Gemini lo analiza y genera el copy ideal para esa imagen</p>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase shrink-0">Hora publicación</label>
                  <input type="time" value={postTime} onChange={e => setPostTime(e.target.value)}
                    className="px-2 py-1.5 text-xs font-bold border border-slate-200 rounded-lg bg-slate-50 outline-none focus:ring-2 ring-fuchsia-200"/>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={generateCopy} disabled={genCopy || genImg}
                    className={cn('py-3 bg-gradient-to-r text-white rounded-lg font-black text-[11px] uppercase tracking-widest shadow-md hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-60', BRAND.color)}>
                    {genCopy ? <><Loader2 className="w-4 h-4 animate-spin"/> Escribiendo...</> : <><Sparkles className="w-4 h-4"/> {uploadedImg ? 'Analizar + Copy' : 'Generar Copy'}</>}
                  </button>
                  <button onClick={generateImage} disabled={genCopy || genImg}
                    className="py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg font-black text-[11px] uppercase tracking-widest shadow-md hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-60">
                    {genImg ? <><Loader2 className="w-4 h-4 animate-spin"/> Generando...</> : <><Camera className="w-4 h-4"/> Generar Imagen IA</>}
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT */}
            <div className="space-y-4">
              <AnimatePresence>
                {(copy || genCopy) && (
                  <motion.div key="copy-panel" initial={{opacity:0,scale:0.97}} animate={{opacity:1,scale:1}}
                    className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-fuchsia-500"/>
                        Copy · {REDES.find(r => r.id === red)?.label}
                        {formato === 'Reel' && <span className="bg-fuchsia-100 text-fuchsia-600 text-[8px] px-1.5 py-0.5 rounded-full font-black">REEL</span>}
                      </h3>
                      <div className="flex gap-2 items-center">
                        <span className={cn('text-[10px] font-black', charsLeft < 0 ? 'text-rose-500' : charsLeft < 200 ? 'text-amber-500' : 'text-slate-400')}>
                          {charsLeft < 0 ? `+${Math.abs(charsLeft)} exceso` : `${charsLeft} restantes`}
                        </span>
                        <button onClick={() => doCopy(copy, 'copy')} disabled={!copy}
                          className="flex items-center gap-1 px-2 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-black text-slate-600 transition disabled:opacity-40">
                          {copied === 'copy' ? <CheckCircle2 className="w-3 h-3 text-emerald-500"/> : <Copy className="w-3 h-3"/>}
                          {copied === 'copy' ? 'Copiado' : 'Copiar'}
                        </button>
                        <button onClick={saveToCalendar} disabled={!copy || savingPost}
                          className={cn('flex items-center gap-1 px-2 py-1.5 bg-gradient-to-r text-white rounded-lg text-[10px] font-black transition disabled:opacity-40', BRAND.color)}>
                          {savingPost ? <CheckCircle2 className="w-3 h-3"/> : <CalendarDays className="w-3 h-3"/>}
                          {savingPost ? '¡Guardado!' : 'Calendario'}
                        </button>
                        <button
                          onClick={() => openInCanva()}
                          disabled={!copy}
                          title="Diseñar en Canva con las dimensiones perfectas para {red{'}'} {formato{'}'}"
                          className="flex items-center gap-1 px-2 py-1.5 bg-gradient-to-r from-[#7D2AE8] to-[#A259FF] hover:opacity-90 text-white rounded-lg text-[10px] font-black transition disabled:opacity-40"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
                          Canva
                        </button>
                      </div>
                    </div>
                    {genCopy ? (
                      <div className="flex items-center justify-center py-8 gap-3">
                        <Loader2 className="w-6 h-6 text-fuchsia-400 animate-spin"/>
                        <p className="text-xs font-bold text-slate-400">
                          {uploadedImg ? 'Analizando imagen con Gemini Vision...' : 'Escribiendo con IA + memoria de marca...'}
                        </p>
                      </div>
                    ) : (
                      <textarea value={copy} onChange={e => setCopy(e.target.value)} rows={10}
                        className="w-full px-3 py-2 text-xs font-medium border border-slate-100 rounded-lg bg-slate-50 text-slate-700 outline-none focus:ring-2 ring-fuchsia-200 resize-none leading-relaxed"/>
                    )}
                    {copy && !genCopy && (
                      <div className="bg-gradient-to-br from-[#7D2AE8]/5 to-[#A259FF]/10 border border-[#A259FF]/30 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 bg-gradient-to-br from-[#7D2AE8] to-[#A259FF] rounded flex items-center justify-center">
                              <Sparkles className="w-3 h-3 text-white"/>
                            </div>
                            <p className="text-[10px] font-black text-[#7D2AE8] uppercase tracking-widest">Diseñar en Canva</p>
                          </div>
                          <p className="text-[9px] font-bold text-slate-400">Copy copiado automáticamente al abrir</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(['Post','Stories','Reel'] as const).map(fmt => {
                            const key = `${fmt}-${red}`;
                            const info = (CANVA_URLS as any)[key] || (CANVA_URLS as any)['default'];
                            return (
                              <button
                                key={fmt}
                                onClick={() => {
                                  navigator.clipboard.writeText(copy).catch(()=>{});
                                  window.open(info.url, '_blank');
                                }}
                                className={cn(
                                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition-all',
                                  fmt === formato
                                    ? 'bg-gradient-to-r from-[#7D2AE8] to-[#A259FF] text-white border-transparent shadow-md'
                                    : 'bg-white border-[#A259FF]/30 text-[#7D2AE8] hover:border-[#A259FF] hover:bg-[#A259FF]/5'
                                )}
                              >
                                {fmt === 'Reel' ? <Film className="w-3 h-3"/> : fmt === 'Stories' ? <Smartphone className="w-3 h-3"/> : <ImageIcon className="w-3 h-3"/>}
                                {fmt} <span className="opacity-60">{info.size}</span>
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                          💡 Pega el copy en Canva con Cmd+V · ya está en tu portapapeles
                        </p>
                      </div>
                    )}
                    {brandMemory && !genCopy && (
                      <p className="text-[9px] font-bold text-violet-400 flex items-center gap-1">
                        <Brain className="w-3 h-3"/> Generado con memoria de {brandMemory.total_posts} posts anteriores
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {(imgB64 || genImg || imgError) && (
                  <motion.div key="img-panel" initial={{opacity:0,scale:0.97}} animate={{opacity:1,scale:1}}
                    className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                        <ImageIcon className="w-3.5 h-3.5 text-violet-500"/> Imagen IA · Gemini
                      </h3>
                      {imgB64 && (
                        <button onClick={downloadImage}
                          className="flex items-center gap-1 px-2 py-1.5 bg-violet-600 hover:bg-violet-700 rounded-lg text-[10px] font-black text-white transition">
                          <Download className="w-3 h-3"/> Descargar
                        </button>
                      )}
                    </div>
                    {genImg && (
                      <div className="flex flex-col items-center justify-center py-12 gap-3">
                        <Loader2 className="w-8 h-8 text-violet-400 animate-spin"/>
                        <p className="text-xs font-black text-slate-500">Generando imagen premium...</p>
                        <p className="text-[10px] font-bold text-slate-400">Gemini Flash Image · ~15s</p>
                      </div>
                    )}
                    {imgError && !genImg && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5"/>
                          <div>
                            <p className="text-xs font-black text-amber-700">No se pudo generar</p>
                            <p className="text-[11px] font-medium text-amber-600 mt-1">{imgError}</p>
                          </div>
                        </div>
                        <p className="text-[10px] font-medium text-slate-500">
                          → <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="text-violet-600 underline">aistudio.google.com</a> · 500/día gratis
                        </p>
                      </div>
                    )}
                    {imgB64 && !genImg && (
                      <div className="relative rounded-xl overflow-hidden border border-slate-100">
                        <img src={imgB64} alt="Imagen generada" className="w-full object-cover max-h-[400px]"/>
                        <button onClick={generateImage}
                          className="absolute bottom-2 right-2 p-2 bg-white/90 backdrop-blur rounded-lg shadow text-slate-600 hover:bg-white transition">
                          <RefreshCw className="w-3.5 h-3.5"/>
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {!copy && !genCopy && !imgB64 && !genImg && !imgError && (
                <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-12 flex flex-col items-center justify-center text-center gap-4">
                  <div className={cn('w-16 h-16 bg-gradient-to-br rounded-2xl flex items-center justify-center', BRAND.color)}>
                    <Sparkles className="w-8 h-8 text-white"/>
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-500">Tu contenido aparecerá aquí</p>
                    <p className="text-[11px] font-bold text-slate-400 mt-1">Sube una imagen o describe tu idea</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ═══════════ TAB CALENDARIO ═══════════ */}
        {tab === 'calendar' && (
          <motion.div key="calendar" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            className="space-y-4">

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {metricsThisMonth.byRed.map(r => (
                <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-lg">{r.emoji}</span>
                    <span className={cn('text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase',
                      r.count > 0 ? 'bg-fuchsia-100 text-fuchsia-600' : 'bg-slate-100 text-slate-400')}>
                      {r.count} posts
                    </span>
                  </div>
                  <p className="text-[10px] font-black text-slate-600">{r.label}</p>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={cn('h-full bg-gradient-to-r rounded-full transition-all', r.color)}
                      style={{width: r.count > 0 ? `${Math.round((r.published/r.count)*100)}%` : '0%'}}/>
                  </div>
                  <p className="text-[9px] font-bold text-slate-400">{r.published}/{r.count} publicados</p>
                </div>
              ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <button onClick={() => { if(calM===0){setCalM(11);setCalY(y=>y-1);}else setCalM(m=>m-1); }}
                  className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition">
                  <ChevronLeft className="w-4 h-4 text-slate-600"/>
                </button>
                <h3 className="text-sm font-black text-slate-800 min-w-[140px] text-center">{MONTHS[calM]} {calY}</h3>
                <button onClick={() => { if(calM===11){setCalM(0);setCalY(y=>y+1);}else setCalM(m=>m+1); }}
                  className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition">
                  <ChevronRight className="w-4 h-4 text-slate-600"/>
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase">
                  {posts.filter(p=>p.published).length} pub · {posts.filter(p=>!p.published).length} pend
                </span>
                <button onClick={() => setTab('studio')}
                  className={cn('flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition', BRAND.color)}>
                  <Plus className="w-3 h-3"/> Nuevo Post
                </button>
                <button
                  onClick={exportToICS}
                  title="Exportar mes a Google Calendar (.ics)"
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 rounded-lg text-[10px] font-black uppercase tracking-widest transition"
                >
                  <CalendarDays className="w-3.5 h-3.5 text-emerald-500"/>
                  Exportar .ics
                </button>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-7 border-b border-slate-100">
                {WDAYS.map(d => <div key={d} className="py-2 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">{d}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {Array.from({length:calDays.offset}).map((_,i) => (
                  <div key={`off-${i}`} className="min-h-[90px] border-b border-r border-slate-50 bg-slate-50/50"/>
                ))}
                {Array.from({length:calDays.total}).map((_,i) => {
                  const day = i + 1;
                  const ds  = `${calY}-${String(calM+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                  const dp  = postsByDate[ds] || [];
                  const isToday = ds === todayS();
                  return (
                    <div key={day} className={cn('min-h-[90px] border-b border-r border-slate-100 p-1.5', isToday ? 'bg-fuchsia-50' : 'hover:bg-slate-50')}>
                      <div className={cn('w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-black mb-1 ml-auto',
                        isToday ? 'bg-fuchsia-600 text-white' : 'text-slate-400')}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dp.slice(0,3).map(p => {
                          const r = REDES.find(r => r.id === p.red);
                          return (
                            <div key={p.id}
                              className={cn('text-[8px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer group',
                                p.formato === 'Reel' ? 'bg-violet-100 text-violet-700' :
                                p.published ? 'bg-emerald-100 text-emerald-700' : 'bg-fuchsia-100 text-fuchsia-700')}
                              onClick={() => togglePublished(p.id)}>
                              {p.formato === 'Reel' && <Film className="w-2.5 h-2.5"/>}
                              {r && <span>{r.emoji}</span>}
                              <span className="truncate flex-1">{p.copy.slice(0,15)}…</span>
                              {p.time && <span className="text-[7px] opacity-60">{p.time}</span>}
                              <button onClick={e => { e.stopPropagation(); deletePost(p.id); }}
                                className="opacity-0 group-hover:opacity-100 text-rose-400 ml-auto">
                                <X className="w-2.5 h-2.5"/>
                              </button>
                            </div>
                          );
                        })}
                        {dp.length > 3 && <p className="text-[8px] font-bold text-slate-400 text-center">+{dp.length-3}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {posts.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Todos los Posts ({posts.length})</h3>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {[...posts].sort((a,b) => a.date.localeCompare(b.date)).map(p => {
                    const r = REDES.find(r => r.id === p.red);
                    const bk = BRANDS[p.brand as BrandId] ?? BRANDS['restaurante'];
                    return (
                      <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:border-slate-200 transition group">
                        {p.imageUrl && (
                          <img src={p.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border border-slate-100"/>
                        )}
                        {!p.imageUrl && r && (
                          <div className={cn('p-2 rounded-lg bg-gradient-to-br shrink-0', r.color)}>
                            <span className="text-sm">{r.emoji}</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-[10px] font-black text-slate-500">{fmtDate(p.date)}</span>
                            {p.time && <span className="text-[9px] text-slate-400 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5"/>{p.time}</span>}
                            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{bk.emoji} {bk.nombre.split(' ')[0]}</span>
                            {p.formato === 'Reel' && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 flex items-center gap-0.5"><Film className="w-2.5 h-2.5"/>Reel</span>}
                            <span className={cn('text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase',
                              p.published ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600')}>
                              {p.published ? 'Publicado' : 'Pendiente'}
                            </span>
                          </div>
                          <p className="text-[11px] font-medium text-slate-600 truncate">{p.copy.slice(0,80)}…</p>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                          <button onClick={() => togglePublished(p.id)} className="p-1.5 bg-emerald-50 hover:bg-emerald-100 rounded-lg text-emerald-600">
                            <CheckCircle className="w-3.5 h-3.5"/>
                          </button>
                          <button onClick={() => recyclePost(p)} className="p-1.5 bg-amber-50 hover:bg-amber-100 rounded-lg text-amber-600">
                            <RotateCcw className="w-3.5 h-3.5"/>
                          </button>
                          <button onClick={() => doCopy(p.copy, p.id)} className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-600">
                            {copied === p.id ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500"/> : <Copy className="w-3.5 h-3.5"/>}
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(p.copy).catch(()=>{});
                              const key = (p.formato || 'Post') + '-' + p.red;
                              const info = (CANVA_URLS as any)[key] || (CANVA_URLS as any)['default'];
                              window.open(info.url, '_blank');
                            }}
                            title="Diseñar en Canva (copy copiado)"
                            className="p-1.5 bg-purple-50 hover:bg-purple-100 rounded-lg text-purple-600"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                          </button>
                          <button onClick={() => openInGoogleCalendar(p)} title="Añadir a Google Calendar" className="p-1.5 bg-emerald-50 hover:bg-emerald-100 rounded-lg text-emerald-600">
                            <CalendarDays className="w-3.5 h-3.5"/>
                          </button>
                          <button onClick={() => deletePost(p.id)} className="p-1.5 bg-rose-50 hover:bg-rose-100 rounded-lg text-rose-500">
                            <Trash2 className="w-3.5 h-3.5"/>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══════════ TAB RESEÑAS ═══════════ */}
        {tab === 'reviews' && (
          <motion.div key="reviews" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-50 rounded-lg"><Star className="w-4 h-4 text-amber-500"/></div>
                <div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Responder Reseña Google</h3>
                  <p className="text-[10px] font-bold text-slate-400">IA adaptada al tono de {BRAND.nombre}</p>
                </div>
              </div>
              <input value={reviewerName} onChange={e => setReviewerName(e.target.value)} placeholder="Nombre del cliente (opcional)"
                className="w-full px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50 outline-none focus:ring-2 ring-amber-200"/>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Puntuación</label>
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => setRating(n)}
                      className={cn('p-1.5 rounded-lg transition-all', n <= rating ? 'text-amber-400' : 'text-slate-200 hover:text-amber-300')}>
                      <Star className="w-7 h-7" fill={n <= rating ? 'currentColor' : 'none'}/>
                    </button>
                  ))}
                  <span className="ml-2 text-sm font-black text-slate-600">{rating}/5</span>
                </div>
              </div>
              <textarea value={reviewText} onChange={e => setReviewText(e.target.value)} rows={5}
                placeholder="Pega el texto de la reseña de Google..."
                className="w-full px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50 outline-none focus:ring-2 ring-amber-200 resize-none"/>
              <button onClick={generateReviewReply} disabled={genReply || !reviewText.trim()}
                className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-black text-[11px] uppercase tracking-widest shadow-md hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-50">
                {genReply ? <><Loader2 className="w-4 h-4 animate-spin"/>Generando...</> : <><Sparkles className="w-4 h-4"/>Generar Respuesta IA</>}
              </button>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-amber-500"/> Respuesta Generada
              </h3>
              {genReply ? (
                <div className="flex items-center justify-center py-16 gap-3">
                  <Loader2 className="w-6 h-6 text-amber-500 animate-spin"/>
                  <p className="text-xs font-bold text-slate-400">Redactando respuesta empática...</p>
                </div>
              ) : reply ? (
                <div className="space-y-3">
                  <div className="relative bg-amber-50 border border-amber-100 rounded-xl p-4 pr-10 text-sm font-medium text-slate-700 leading-relaxed">
                    {reply}
                    <button onClick={() => doCopy(reply, 'reply')}
                      className="absolute top-3 right-3 p-1.5 bg-white border border-amber-200 rounded-lg text-amber-500 hover:bg-amber-50 transition shadow-sm">
                      {copied === 'reply' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500"/> : <Copy className="w-3.5 h-3.5"/>}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => doCopy(reply, 'reply')}
                      className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition flex items-center justify-center gap-2">
                      {copied === 'reply' ? <><CheckCircle2 className="w-3.5 h-3.5"/>Copiado</> : <><Copy className="w-3.5 h-3.5"/>Copiar</>}
                    </button>
                    <button onClick={generateReviewReply}
                      className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-black text-[10px] hover:bg-slate-200 transition">
                      <RefreshCw className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-4 opacity-50">
                  <Star className="w-12 h-12 text-slate-300"/>
                  <p className="text-sm font-black text-slate-500">Tu respuesta aparecerá aquí</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ═══════════ TAB DRIVE ═══════════ */}
        {tab === 'drive' && (
          <motion.div key="drive" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            className="space-y-4">

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg"><FolderOpen className="w-5 h-5 text-blue-600"/></div>
                <div>
                  <h3 className="text-sm font-black text-slate-800">Carpeta Google Drive</h3>
                  <p className="text-[10px] font-bold text-slate-400">Parrilla semanal IA con tus fotos y vídeos reales</p>
                </div>
              </div>
              <div className="flex gap-2">
                <input value={driveInput} onChange={e => setDriveInput(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/XXXX..."
                  className="flex-1 px-4 py-3 text-xs font-medium border border-slate-200 rounded-xl bg-slate-50 text-slate-700 outline-none focus:ring-2 ring-blue-300"/>
                <button onClick={loadDriveFolder} disabled={driveLoad || !driveInput.trim()}
                  className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-[11px] uppercase tracking-widest transition flex items-center gap-2 disabled:opacity-60 shrink-0">
                  {driveLoad ? <Loader2 className="w-4 h-4 animate-spin"/> : <Link className="w-4 h-4"/>}
                  Cargar
                </button>
              </div>
              {driveErr && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5"/>
                  <p className="text-[11px] font-medium text-amber-700">{driveErr}</p>
                </div>
              )}

              {/* Subida directa de archivos para parrilla */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">— O sube archivos directamente —</p>
                <label className="flex flex-col items-center gap-2 border-2 border-dashed border-slate-200 rounded-xl p-6 cursor-pointer hover:border-fuchsia-300 transition bg-slate-50">
                  <input type="file" multiple accept="image/*,video/*" className="hidden"
                    onChange={async e => {
                      const files = Array.from(e.target.files || []);
                      const media: DriveMedia[] = await Promise.all(files.map(async (f, i) => {
                        const b64 = await toBase64(f);
                        return {
                          id: `local_${i}_${Date.now()}`,
                          name: f.name,
                          url: URL.createObjectURL(f),
                          thumb: f.type.startsWith('image/') ? `data:${f.type};base64,${b64}` : undefined,
                          type: f.type.startsWith('video/') ? 'video' : 'image',
                          mimeType: f.type,
                        };
                      }));
                      setDriveMedia(prev => [...prev, ...media]);
                    }}/>
                  <Upload className="w-8 h-8 text-slate-300"/>
                  <p className="text-xs font-black text-slate-500">Arrastra o pulsa para subir fotos y vídeos</p>
                  <p className="text-[10px] font-bold text-slate-400">Gemini analiza cada archivo y genera el copy ideal</p>
                </label>
              </div>

              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[10px] font-black text-slate-600 mb-1">📋 Para Drive: carpeta pública → Compartir → Cualquiera con el enlace</p>
              </div>
            </div>

            {driveMedia.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Media · {driveMedia.length} archivos</h3>
                    <p className="text-[10px] font-bold text-slate-400">
                      {selMedia.size > 0 ? `${selMedia.size} seleccionados` : 'Todos · pulsa para seleccionar'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {selMedia.size > 0 && (
                      <button onClick={() => setSelMedia(new Set())}
                        className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black">Limpiar</button>
                    )}
                    <button onClick={() => { setDriveMedia([]); setWeekPlan([]); }}
                      className="px-3 py-2 bg-rose-50 text-rose-500 rounded-lg text-[10px] font-black">Vaciar</button>
                    <button onClick={generateWeekPlan} disabled={genWeek}
                      className={cn('flex items-center gap-2 px-4 py-2 bg-gradient-to-r text-white rounded-lg font-black text-[11px] uppercase disabled:opacity-60', BRAND.color)}>
                      {genWeek ? <><Loader2 className="w-4 h-4 animate-spin"/>Generando...</> : <><Zap className="w-4 h-4"/>Parrilla Semanal IA</>}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-7 gap-2">
                  {driveMedia.map(m => {
                    const isSel = selMedia.has(m.id);
                    return (
                      <div key={m.id} onClick={() => toggleSelMedia(m.id)}
                        className={cn('relative rounded-xl overflow-hidden border-2 cursor-pointer aspect-square bg-slate-100',
                          isSel ? 'border-fuchsia-500 ring-2 ring-fuchsia-200' : 'border-slate-200 hover:border-fuchsia-300')}>
                        {m.type === 'video' ? (
                          <div className="w-full h-full flex items-center justify-center bg-slate-800">
                            <PlayCircle className="w-8 h-8 text-white opacity-70"/>
                          </div>
                        ) : m.thumb ? (
                          <img src={m.thumb} alt={m.name} className="w-full h-full object-cover"/>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-100">
                            <ImageIcon className="w-6 h-6 text-slate-300"/>
                          </div>
                        )}
                        {isSel && (
                          <div className="absolute inset-0 bg-fuchsia-600/20 flex items-center justify-center">
                            <CheckCircle2 className="w-7 h-7 text-fuchsia-600"/>
                          </div>
                        )}
                        <span className="absolute top-1 right-1 text-[8px] bg-white/80 px-1 rounded">
                          {m.type === 'video' ? '🎬' : '🖼️'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {weekPlan.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">
                    Parrilla Semanal · {weekPlan.length} contenidos
                  </h3>
                  <button onClick={saveWeekPlan}
                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[11px]">
                    <CalendarDays className="w-4 h-4"/> Añadir al Calendario
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {weekPlan.map((p, i) => {
                    const ri  = REDES.find(r => r.id === p.red)!;
                    const dl  = new Date(p.day+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'2-digit',month:'short'});
                    return (
                      <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="relative h-32 bg-slate-100">
                          {p.media.type === 'video' ? (
                            <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                              <PlayCircle className="w-8 h-8 text-white opacity-70"/>
                            </div>
                          ) : p.media.thumb ? (
                            <img src={p.media.thumb} alt="" className="w-full h-full object-cover"/>
                          ) : (
                            <div className="w-full h-full bg-slate-100 flex items-center justify-center">
                              <ImageIcon className="w-8 h-8 text-slate-300"/>
                            </div>
                          )}
                          <div className={cn('absolute top-2 left-2 px-2 py-0.5 rounded text-[9px] font-black text-white bg-gradient-to-r', ri.color)}>
                            {ri.emoji} {ri.label}
                          </div>
                          {p.isReel && (
                            <div className="absolute top-2 right-2 bg-violet-600 text-white rounded px-1.5 py-0.5 flex items-center gap-1">
                              <Film className="w-2.5 h-2.5"/>
                              <span className="text-[9px] font-black">REEL</span>
                            </div>
                          )}
                          {!p.isReel && (
                            <div className="absolute top-2 right-2 bg-white/90 rounded px-1.5 py-0.5 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5 text-indigo-500"/>
                              <span className="text-[9px] font-black text-indigo-600">{p.time}</span>
                            </div>
                          )}
                        </div>
                        <div className="p-3 space-y-2">
                          <p className="text-[10px] font-black text-slate-500 capitalize">{dl}</p>
                          <p className="text-[11px] font-medium text-slate-700 line-clamp-3">{p.copy}</p>
                          <div className="flex gap-2 pt-1">
                            <button onClick={() => doCopy(p.copy, 'wp'+i)}
                              className="flex-1 py-1.5 bg-slate-100 rounded text-[9px] font-black text-slate-600 flex items-center justify-center gap-1">
                              {copied === 'wp'+i ? <CheckCircle2 className="w-3 h-3 text-emerald-500"/> : <Copy className="w-3 h-3"/>}
                              {copied === 'wp'+i ? 'Copiado' : 'Copiar'}
                            </button>
                            <a href={p.media.url} target="_blank" rel="noreferrer"
                              className="py-1.5 px-3 bg-blue-50 rounded text-[9px] font-black text-blue-600 flex items-center gap-1">
                              <FolderOpen className="w-3 h-3"/> Abrir
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {driveMedia.length === 0 && !driveLoad && (
              <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-16 flex flex-col items-center justify-center text-center gap-4">
                <FolderOpen className="w-12 h-12 text-slate-300"/>
                <p className="text-sm font-black text-slate-500">Conecta Drive o sube tus archivos</p>
                <p className="text-[11px] font-bold text-slate-400">La IA genera copy para cada foto/vídeo con la voz exacta de {BRAND.nombre}</p>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══════════ TAB HISTORIAL ═══════════ */}
        {tab === 'historia' && (
          <motion.div key="historia" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            className="space-y-4">

            {brandMemory && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                  <Brain className="w-4 h-4 text-violet-500"/> Memoria de Marca — {BRAND.nombre}
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-violet-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-violet-600">{brandMemory.total_posts}</p>
                    <p className="text-[10px] font-bold text-violet-400 uppercase">posts generados</p>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-emerald-600">{brandMemory.best_copies.length}</p>
                    <p className="text-[10px] font-bold text-emerald-400 uppercase">copies guardados</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-amber-600">{posts.filter(p => p.brand === brand && p.published).length}</p>
                    <p className="text-[10px] font-bold text-amber-400 uppercase">publicados</p>
                  </div>
                </div>
                <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
                  <p className="text-[10px] font-black text-violet-600 uppercase tracking-widest mb-2">Estilo aprendido</p>
                  <p className="text-xs font-medium text-violet-800 leading-relaxed">{brandMemory.learned_style}</p>
                  <p className="text-[9px] font-bold text-violet-400 mt-2">
                    Actualizado: {new Date(brandMemory.updated_at).toLocaleDateString('es-ES')}
                  </p>
                </div>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                <History className="w-4 h-4 text-slate-500"/> Copies Anteriores ({copyHistory.length})
              </h3>
              {copyHistory.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen className="w-10 h-10 text-slate-200 mx-auto mb-3"/>
                  <p className="text-xs font-bold text-slate-400">Aún no hay historial. Genera tu primer copy en Studio IA.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {copyHistory.map(c => {
                    const r  = REDES.find(r => r.id === c.red);
                    return (
                      <div key={c.id} className="border border-slate-100 rounded-xl p-4 hover:border-slate-200 transition space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('text-[9px] font-black px-2 py-0.5 rounded-full text-white bg-gradient-to-r', r?.color || 'from-slate-400 to-slate-500')}>
                            {r?.emoji} {r?.label}
                          </span>
                          <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase">{c.formato}</span>
                          <span className="text-[9px] font-bold text-slate-400 ml-auto">
                            {new Date(c.created_at).toLocaleDateString('es-ES')}
                          </span>
                        </div>
                        {c.idea && <p className="text-[10px] font-bold text-slate-400 italic">"{c.idea.slice(0,80)}"</p>}
                        <p className="text-xs font-medium text-slate-700 leading-relaxed line-clamp-4">{c.copy}</p>
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => { setCopy(c.copy); setTab('studio'); }}
                            className={cn('flex-1 py-1.5 bg-gradient-to-r text-white rounded-lg text-[10px] font-black flex items-center justify-center gap-1', BRAND.color)}>
                            <RotateCcw className="w-3 h-3"/> Reutilizar
                          </button>
                          <button onClick={() => doCopy(c.copy, c.id)}
                            className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black flex items-center gap-1">
                            {copied === c.id ? <CheckCircle2 className="w-3 h-3 text-emerald-500"/> : <Copy className="w-3 h-3"/>}
                            {copied === c.id ? 'Copiado' : 'Copiar'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ═══════════ TAB TELEGRAM ═══════════ */}
        {tab === 'telegram' && (
          <motion.div key="telegram" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            className="space-y-4">

            <div className="bg-[#229ED9] rounded-xl p-5 text-white flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5"/>
                </div>
                <div>
                  <h3 className="text-sm font-black">Ideas desde Jarvis — {BRAND.nombre}</h3>
                  <p className="text-[10px] font-bold text-blue-100 uppercase tracking-widest">bottelegram · procesado_n8n = false</p>
                </div>
              </div>
              <button onClick={fetchTelegram} disabled={tgLoad}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-black text-[11px] uppercase tracking-widest transition disabled:opacity-60 shrink-0">
                {tgLoad ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCw className="w-4 h-4"/>}
                {tgLoad ? 'Sincronizando...' : 'Sync Bot'}
              </button>
            </div>

            {tgErr && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5"/>
                <div>
                  <p className="text-xs font-black text-rose-700">Error de conexión</p>
                  <p className="text-[11px] font-medium text-rose-600 mt-0.5">{tgErr}</p>
                </div>
              </div>
            )}

            {!tgLoad && tgMsgs.length === 0 && !tgErr && (
              <div className="bg-white border border-slate-200 rounded-xl p-16 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-16 h-16 bg-[#229ED9]/10 rounded-2xl flex items-center justify-center">
                  <Smartphone className="w-8 h-8 text-[#229ED9]"/>
                </div>
                <div>
                  <p className="text-sm font-black text-slate-600">Sin mensajes pendientes</p>
                  <p className="text-[11px] font-bold text-slate-400 mt-1">Pulsa Sync Bot para cargar ideas desde Jarvis</p>
                </div>
              </div>
            )}

            {tgMsgs.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {tgMsgs.map(msg => (
                  <motion.div key={msg.id} initial={{opacity:0,scale:0.97}} animate={{opacity:1,scale:1}}
                    className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 hover:border-[#229ED9]/30 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {msg.categoria && (
                          <span className="text-[9px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full uppercase tracking-widest">{msg.categoria}</span>
                        )}
                        {msg.negocio && (
                          <span className="text-[9px] font-black bg-fuchsia-50 text-fuchsia-600 px-2 py-0.5 rounded-full uppercase tracking-widest">{msg.negocio}</span>
                        )}
                      </div>
                      <span className="text-[9px] font-bold text-slate-400 shrink-0">
                        {new Date(msg.created_at).toLocaleDateString('es-ES')}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-700 leading-relaxed">{msg.texto || '(Sin texto)'}</p>
                    <div className="flex gap-2 pt-1 border-t border-slate-100">
                      <button onClick={() => useAsIdea(msg)}
                        className={cn('flex-1 py-2 bg-gradient-to-r text-white rounded-lg font-black text-[10px] uppercase tracking-widest transition flex items-center justify-center gap-1', BRAND.color)}>
                        <Sparkles className="w-3 h-3"/> Usar Idea
                      </button>
                      <button onClick={() => markProcessed(msg.id)}
                        className="px-3 py-2 bg-emerald-50 text-emerald-600 rounded-lg font-black text-[10px] hover:bg-emerald-100 transition flex items-center gap-1">
                        <CheckCircle className="w-3 h-3"/> OK
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// 🤖 AGENTE AUTO — pipeline completo: subir foto → mejorar → analizar →
//    caption IG/TikTok/Google → hashtags → agendar → preview para aprobar
// ════════════════════════════════════════════════════════════════════════════
interface AutoAgentPanelProps {
  brand: BrandId;
  BRAND: typeof BRANDS[BrandId];
  platos: any[];
  posts: Post[];
  savePostToDB: (post: Post) => Promise<void>;
}

interface AutoResult {
  originalB64: string;
  enhancedB64: string;         // puede ser === originalB64 si no se pudo mejorar
  enhancedWorked: boolean;
  identification: string;      // qué es (plato, ambiente…)
  captionIG: string;
  captionTikTok: string;
  captionGoogle: string;
  hashtags: string;
  suggestedDate: string;       // YYYY-MM-DD
  reasoningDate: string;
}

const AutoAgentPanel: React.FC<AutoAgentPanelProps> = ({ brand, BRAND, platos, posts, savePostToDB }) => {
  const [stage, setStage] = useState<'idle'|'uploading'|'enhancing'|'identifying'|'writing'|'scheduling'|'done'|'error'>('idle');
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<AutoResult | null>(null);
  const [selectedRed, setSelectedRed] = useState<RedId>('instagram');
  const [approved, setApproved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const findNextFreeDate = (): { date: string; reason: string } => {
    // Busca el siguiente día sin posts ya programados. Si todos los próximos
    // 14 días están ocupados, usa el día con menos posts.
    const today = new Date();
    const counts: Record<string, number> = {};
    for (const p of posts) counts[p.date] = (counts[p.date] || 0) + 1;
    for (let i = 1; i <= 14; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      if (!counts[ds]) return { date: ds, reason: `próximo hueco libre (${d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })})` };
    }
    // Fallback
    const d = new Date(today); d.setDate(today.getDate() + 3);
    return { date: d.toISOString().slice(0, 10), reason: 'en 3 días (agenda ocupada)' };
  };

  const runPipeline = async (file: File) => {
    setError(''); setResult(null); setApproved(false);
    try {
      setStage('uploading'); setProgress('Subiendo foto…');
      const b64 = await toBase64(file);
      const mime = file.type || 'image/jpeg';

      // ── 1. MEJORAR FOTO (Gemini 2.5 Flash Image / Nano Banana) ────────────
      setStage('enhancing'); setProgress('Mejorando luz, color y nitidez…');
      const gemKey = keys.gemini();
      let enhancedB64 = b64;
      let enhancedWorked = false;
      if (gemKey) {
        try {
          const pureB64 = b64.replace(/^data:[^;]+;base64,/, '');
          const editPrompt = `Improve this real restaurant photo for social media. Enhance lighting, color balance, contrast and sharpness. Keep the food/scene EXACTLY as it is — do not add, remove or change any element. No text, no watermark. Photorealistic, natural look.`;
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${gemKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [
                  { text: editPrompt },
                  { inlineData: { mimeType: mime, data: pureB64 } },
                ]}],
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
              }),
            },
          );
          if (res.ok) {
            const d = await res.json();
            const parts = d?.candidates?.[0]?.content?.parts || [];
            for (const p of parts) {
              if (p.inlineData?.mimeType?.startsWith('image/')) {
                enhancedB64 = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
                enhancedWorked = true;
                break;
              }
            }
          }
        } catch { /* si falla, seguimos con la original */ }
      }

      // ── 2. IDENTIFICAR QUÉ ES ─────────────────────────────────────────────
      setStage('identifying'); setProgress('Identificando el contenido…');
      // Pedimos JSON estructurado — scanBase64 parsea raw como objeto
      const idPrompt = `Analiza esta foto de un restaurante japonés. Devuelve SOLO un JSON con este formato exacto (sin markdown):
{"description": "una frase corta de máx 15 palabras describiendo qué aparece", "type": "plato | ambiente | evento | otro"}`;
      const idRes = await scanBase64(b64, mime, idPrompt);
      const idRaw: any = idRes?.raw || {};
      const rawDesc = String(idRaw.description || idRaw.descripcion || '').trim();
      const identification = (rawDesc || 'Contenido del restaurante').replace(/^["']|["']$/g, '').slice(0, 200);

      // ── 3. CAPTIONS + HASHTAGS ────────────────────────────────────────────
      setStage('writing'); setProgress('Escribiendo captions para IG, TikTok y Google…');
      const platosText = platos.slice(0, 10).map((p: any) => p?.nombre || p?.name).filter(Boolean).join(', ');
      const copyPrompt = `Eres el community manager de ${BRAND.nombre}.
Estilo: ${BRAND.estilo}
Tono: ${BRAND.tono}
La foto muestra: "${identification}".
${platosText ? `Platos actuales de la carta: ${platosText}.` : ''}

Genera EXACTAMENTE este JSON válido (sin markdown, sin comentarios):
{
  "instagram": "caption para Instagram — máx 150 palabras, gancho en 1ª línea, emojis sutiles, CTA al final",
  "tiktok": "caption para TikTok — máx 60 palabras, directo, punchy, 1-2 emojis",
  "google": "descripción para Google My Business — máx 80 palabras, neutra y informativa, sin emojis",
  "hashtags": "8-12 hashtags separados por espacios, empezando por #ArumeSakeBar"
}`;
      const copyRes = await askAI([{ role: 'user', content: copyPrompt }]);
      let captions = { instagram: '', tiktok: '', google: '', hashtags: BRAND.hashtags };
      try {
        const raw = (copyRes.text || '').trim().replace(/^```json\s*|\s*```$/g, '').replace(/^```\s*|\s*```$/g, '');
        const parsed = JSON.parse(raw);
        captions = {
          instagram: parsed.instagram || '',
          tiktok: parsed.tiktok || '',
          google: parsed.google || '',
          hashtags: parsed.hashtags || BRAND.hashtags,
        };
      } catch {
        // Fallback: usa el texto entero como caption IG
        captions.instagram = (copyRes.text || '').trim();
      }

      // ── 4. PROGRAMAR FECHA ────────────────────────────────────────────────
      setStage('scheduling'); setProgress('Buscando hueco en el calendario…');
      const { date, reason } = findNextFreeDate();

      setResult({
        originalB64: b64,
        enhancedB64,
        enhancedWorked,
        identification,
        captionIG: captions.instagram,
        captionTikTok: captions.tiktok,
        captionGoogle: captions.google,
        hashtags: captions.hashtags,
        suggestedDate: date,
        reasoningDate: reason,
      });
      setStage('done');
    } catch (e: any) {
      setError(e?.message || String(e));
      setStage('error');
    }
  };

  const captionFor = (red: RedId): string => {
    if (!result) return '';
    if (red === 'instagram') return `${result.captionIG}\n\n${result.hashtags}`;
    if (red === 'tiktok')    return `${result.captionTikTok}\n\n${result.hashtags}`;
    return result.captionGoogle;
  };

  const handleApproveAndSave = async () => {
    if (!result) return;
    const post: Post = {
      id: uid(),
      date: result.suggestedDate,
      time: '19:00',
      red: selectedRed,
      brand,
      copy: captionFor(selectedRed),
      formato: 'Post',
      imageUrl: result.enhancedB64,
      published: false,
      recycled: false,
    };
    await savePostToDB(post);
    setApproved(true);
    toast.success('Post agendado en el calendario ✨');
    // 🎉 celebración: trabajo de comunicación hecho
    import('./Confetti').then(m => m.triggerConfetti());
  };

  const reset = () => {
    setResult(null); setStage('idle'); setError(''); setApproved(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  const isRunning = stage !== 'idle' && stage !== 'done' && stage !== 'error';

  return (
    <div className="space-y-4">
      <div className={cn('p-5 rounded-2xl bg-gradient-to-br text-white shadow-lg', BRAND.color)}>
        <div className="flex items-start gap-3">
          <Sparkles className="w-6 h-6 shrink-0"/>
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest">Agente Auto</h3>
            <p className="text-xs opacity-90 mt-1">Sube 1 foto real → en 30 segundos tienes post mejorado, caption para IG/TikTok/Google, hashtags y fecha sugerida.</p>
          </div>
        </div>
      </div>

      {!result && stage === 'idle' && (
        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center bg-white hover:border-fuchsia-300 transition">
          <Camera className="w-12 h-12 mx-auto text-slate-300 mb-3"/>
          <p className="text-sm font-bold text-slate-600 mb-1">Sube una foto real del restaurante, plato o ambiente</p>
          <p className="text-[10px] text-slate-400 mb-4">El agente la mejora SIN inventar nada: solo luz, color y contraste.</p>
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) runPipeline(f); }}/>
          <button onClick={() => inputRef.current?.click()}
            className={cn('px-6 py-3 rounded-xl text-white font-black text-xs uppercase tracking-widest bg-gradient-to-r shadow-md hover:scale-105 transition', BRAND.color)}>
            <Upload className="w-4 h-4 inline mr-2"/> Subir foto
          </button>
        </div>
      )}

      {isRunning && (
        <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-fuchsia-500 shrink-0"/>
            <div className="flex-1">
              <p className="text-sm font-black text-slate-700">{progress}</p>
              <div className="flex gap-2 mt-3">
                {['uploading','enhancing','identifying','writing','scheduling'].map((s) => (
                  <div key={s} className={cn('h-1.5 flex-1 rounded-full transition-all',
                    s === stage ? 'bg-fuchsia-500 animate-pulse' :
                    ['uploading','enhancing','identifying','writing','scheduling'].indexOf(s) < ['uploading','enhancing','identifying','writing','scheduling'].indexOf(stage) ? 'bg-fuchsia-400' : 'bg-slate-200')}/>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {stage === 'error' && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5"/>
          <div className="flex-1">
            <p className="text-sm font-black text-rose-700">Algo falló</p>
            <p className="text-xs text-rose-600 mt-1">{error}</p>
            <button onClick={reset} className="mt-3 px-3 py-1.5 bg-white border border-rose-200 text-rose-600 rounded-lg text-[10px] font-black uppercase tracking-widest">Reintentar</button>
          </div>
        </div>
      )}

      {result && stage === 'done' && (
        <div className="space-y-4">
          {/* Fotos before/after */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl p-3 border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Original</p>
              <img src={result.originalB64} alt="original" className="w-full rounded-xl"/>
            </div>
            <div className={cn('rounded-2xl p-3 border-2', result.enhancedWorked ? 'border-fuchsia-300 bg-fuchsia-50' : 'border-slate-100 bg-white')}>
              <p className="text-[10px] font-black text-fuchsia-600 uppercase tracking-widest mb-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3"/> {result.enhancedWorked ? 'Mejorada' : 'Sin cambios (API no disponible)'}
              </p>
              <img src={result.enhancedB64} alt="enhanced" className="w-full rounded-xl"/>
            </div>
          </div>

          {/* Qué es + fecha */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-2">
            <div className="flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5"/>
              <div className="flex-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Identificación</p>
                <p className="text-sm text-slate-700">{result.identification}</p>
              </div>
            </div>
            <div className="flex items-start gap-2 pt-2 border-t border-slate-100">
              <CalendarDays className="w-4 h-4 text-fuchsia-500 shrink-0 mt-0.5"/>
              <div className="flex-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fecha sugerida</p>
                <p className="text-sm text-slate-700 font-bold">{result.suggestedDate}</p>
                <p className="text-[10px] text-slate-400">{result.reasoningDate}</p>
              </div>
            </div>
          </div>

          {/* Selector red + caption */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 space-y-3">
            <div className="flex gap-2">
              {(['instagram','tiktok','google'] as RedId[]).map(r => (
                <button key={r} onClick={() => setSelectedRed(r)}
                  className={cn('flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition',
                    selectedRed === r ? 'bg-fuchsia-500 text-white shadow' : 'bg-slate-50 text-slate-500 hover:bg-slate-100')}>
                  {r === 'instagram' ? '📸 Instagram' : r === 'tiktok' ? '🎬 TikTok' : '📍 Google'}
                </button>
              ))}
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{captionFor(selectedRed)}</p>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(captionFor(selectedRed)); toast.success('Copiado al portapapeles'); }}
              className="text-[10px] font-black text-fuchsia-600 hover:text-fuchsia-700 uppercase tracking-widest flex items-center gap-1">
              <Copy className="w-3 h-3"/> Copiar caption
            </button>
          </div>

          {/* Acciones */}
          {!approved ? (
            <div className="flex gap-2">
              <button onClick={reset}
                className="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-50">
                Descartar y subir otra
              </button>
              <button onClick={handleApproveAndSave}
                className={cn('flex-1 px-4 py-3 rounded-xl text-white text-[11px] font-black uppercase tracking-widest bg-gradient-to-r shadow-md hover:scale-[1.02] transition flex items-center justify-center gap-2', BRAND.color)}>
                <CheckCircle2 className="w-4 h-4"/> Agendar en calendario
              </button>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500"/>
              <p className="text-sm font-black text-emerald-700 flex-1">Post agendado para el {result.suggestedDate}</p>
              <button onClick={reset} className="px-3 py-1.5 bg-white border border-emerald-200 text-emerald-600 rounded-lg text-[10px] font-black uppercase tracking-widest">
                Subir otra
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
