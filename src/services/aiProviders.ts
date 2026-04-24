/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  src/services/aiProviders.ts                                     ║
 * ║  CEREBRO CENTRAL DE IA — Arume Pro                               ║
 * ║                                                                  ║
 * ║  Todos los componentes importan de aquí. Nunca llaman a          ║
 * ║  proveedores de IA directamente.                                 ║
 * ║                                                                  ║
 * ║  Proveedores soportados:                                         ║
 * ║   🔵 Gemini   — imágenes + PDFs (principal)                      ║
 * ║   🟢 Groq     — velocidad + Whisper (voz)                        ║
 * ║   🟣 Cerebras — texto ultrarrápido (~0.10$/M tokens)             ║
 * ║   🔷 DeepSeek — análisis largo (5M tokens gratis al registrarse) ║
 * ║   🇪🇺 Mistral  — backup europeo visión (1B tokens/mes gratis)    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AIProvider = 'gemini' | 'groq' | 'cerebras' | 'deepseek' | 'mistral';

export type VoiceProvider = 'browser' | 'groq';

export interface ScanResult {
  raw: Record<string, unknown>;
  provider: AIProvider;
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResult {
  text: string;
  provider: AIProvider;
  model: string;
}

// ─── Leer keys del localStorage ───────────────────────────────────────────────

const getKey = (name: string): string =>
  (sessionStorage.getItem(name) || localStorage.getItem(name) || '').trim();

export const keys = {
  gemini:   () => getKey('gemini_api_key'),
  groq:     () => getKey('groq_api_key'),
  cerebras: () => getKey('cerebras_api_key'),
  deepseek: () => getKey('deepseek_api_key'),
  mistral:  () => getKey('mistral_api_key'),
};

export const voiceProvider = (): VoiceProvider =>
  (localStorage.getItem('voice_provider') as VoiceProvider) || 'browser';

// ─── Modelos preferidos por proveedor ─────────────────────────────────────────

const MODELS: Record<AIProvider, string> = {
  gemini:   'gemini-2.5-flash',
  groq:     'llama-3.3-70b-versatile',
  cerebras: 'llama3.1-8b',
  deepseek: 'deepseek-chat',
  mistral:  'mistral-small-latest',
};

const VISION_MODELS: Partial<Record<AIProvider, string>> = {
  gemini:  'gemini-2.5-flash',
  mistral: 'pixtral-12b-2409',
  groq:    'llama-3.2-11b-vision-preview',
};

// ─── Helper: fetch con timeout ────────────────────────────────────────────────

const fetchWithTimeout = async (url: string, opts: RequestInit, ms = 30000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

// ─── Helper: convertir File a base64 ─────────────────────────────────────────

const fileToBase64 = (file: File | Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// ─── Helper: comprimir imagen antes de enviar ────────────────────────────────

const compressImage = async (file: File | Blob): Promise<{ base64: string; mimeType: string }> => {
  const QUALITY_LEVELS = [0.85, 0.65, 0.45];
  const MAX_BYTES = 3 * 1024 * 1024;
  const MAX_W = 1600, MAX_H = 1600;

  const bitmap = await createImageBitmap(file);
  const ratio  = Math.min(MAX_W / bitmap.width, MAX_H / bitmap.height, 1);
  const w = Math.max(1, Math.round(bitmap.width  * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, w, h);

  let blob: Blob | null = null;
  for (const quality of QUALITY_LEVELS) {
    const b: Blob = await new Promise(res => canvas.toBlob(b => res(b as Blob), 'image/jpeg', quality));
    blob = b;
    if (b.size <= MAX_BYTES) break;
  }
  if (!blob) throw new Error('No se pudo comprimir la imagen.');
  return { base64: await fileToBase64(blob), mimeType: 'image/jpeg' };
};

// ─── Helper: parsear JSON de respuesta ───────────────────────────────────────

export const parseJSON = (text: string): Record<string, unknown> => {
  try {
    const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    if (start === -1 || end === -1) return {};
    return JSON.parse(clean.substring(start, end + 1));
  } catch { return {}; }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 📄 scanDocument — Escaneo de imágenes y PDFs
// ═══════════════════════════════════════════════════════════════════════════════

export const scanDocument = async (
  file: File,
  prompt: string,
): Promise<ScanResult> => {

  const isImage = file.type.startsWith('image/');
  const isPDF   = file.type === 'application/pdf';

  if (!isImage && !isPDF) throw new Error('Solo se admiten imágenes y PDFs.');

  const gemKey = keys.gemini();
  if (gemKey) {
    try {
      return await _scanWithGemini(file, prompt, gemKey, isImage);
    } catch (e) {
      console.warn('[aiProviders] Gemini falló, probando Mistral…', e);
    }
  }

  const misKey = keys.mistral();
  if (misKey && isImage) {
    try {
      return await _scanWithMistral(file, prompt, misKey);
    } catch (e) {
      console.warn('[aiProviders] Mistral falló, probando Groq Vision…', e);
    }
  }

  const groqKey = keys.groq();
  if (groqKey && isImage) {
    try {
      return await _scanWithGroqVision(file, prompt, groqKey);
    } catch (e) {
      console.warn('[aiProviders] Groq Vision falló.', e);
    }
  }

  throw new Error('No hay ningún proveedor de visión configurado o todos fallaron. Añade una API Key en Ajustes.');
};

/**
 * scanBase64 — Escaneo cuando ya tenemos datos en base64 (sin File).
 * Útil para imágenes de cámara, adjuntos de email, etc.
 */
export const scanBase64 = async (
  base64: string,
  mimeType: string,
  prompt: string,
): Promise<ScanResult> => {
  // Limpiar prefijo data:... si existe
  const cleanB64 = base64.includes(',') ? base64.split(',')[1] : base64;
  const isImage = mimeType.startsWith('image/');

  const gemKey = keys.gemini();
  if (gemKey) {
    try {
      return await _scanBase64WithGemini(cleanB64, mimeType, prompt, gemKey);
    } catch (e) {
      console.warn('[aiProviders] Gemini falló en scanBase64, probando fallbacks…', e);
    }
  }

  const misKey = keys.mistral();
  if (misKey && isImage) {
    try {
      return await _scanBase64WithMistral(cleanB64, mimeType, prompt, misKey);
    } catch (e) {
      console.warn('[aiProviders] Mistral falló en scanBase64…', e);
    }
  }

  const groqKey = keys.groq();
  if (groqKey && isImage) {
    try {
      return await _scanBase64WithGroqVision(cleanB64, mimeType, prompt, groqKey);
    } catch (e) {
      console.warn('[aiProviders] Groq Vision falló en scanBase64.', e);
    }
  }

  throw new Error('No hay ningún proveedor de visión configurado o todos fallaron. Añade una API Key en Ajustes.');
};

const _scanWithGemini = async (
  file: File, prompt: string, apiKey: string, isImage: boolean
): Promise<ScanResult> => {
  const model = VISION_MODELS.gemini!;
  const base64 = isImage
    ? (await compressImage(file)).base64
    : await fileToBase64(file);
  const mimeType = isImage ? 'image/jpeg' : 'application/pdf';

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  };

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { raw: parseJSON(text), provider: 'gemini', model };
};

const _scanWithMistral = async (
  file: File, prompt: string, apiKey: string
): Promise<ScanResult> => {
  const model = VISION_MODELS.mistral!;
  const { base64, mimeType } = await compressImage(file);

  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text',      text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    }],
    temperature: 0.1,
  };

  const res = await fetchWithTimeout(
    'https://api.mistral.ai/v1/chat/completions',
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { raw: parseJSON(text), provider: 'mistral', model };
};

const _scanWithGroqVision = async (
  file: File, prompt: string, apiKey: string
): Promise<ScanResult> => {
  const model = VISION_MODELS.groq!;
  const { base64, mimeType } = await compressImage(file);

  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text',      text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    }],
    temperature: 0.1,
  };

  const res = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`Groq Vision HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { raw: parseJSON(text), provider: 'groq', model };
};

// ─── scanBase64 internals (sin File, con base64 directo) ─────────────────────

const _scanBase64WithGemini = async (
  base64: string, mimeType: string, prompt: string, apiKey: string
): Promise<ScanResult> => {
  const model = VISION_MODELS.gemini!;
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  };
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    // Intentamos extraer el mensaje de error específico de Gemini para debug
    const errJson = await res.json().catch(() => ({} as any));
    const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini Vision: ${errMsg}`);
  }
  const data = await res.json();

  // 🩺 Diagnóstico detallado — muchas veces Gemini responde 200 pero sin texto
  // por motivos como SAFETY/RECITATION/MAX_TOKENS o promptFeedback.blockReason.
  const candidate = data.candidates?.[0];
  const promptFeedback = data.promptFeedback;

  if (promptFeedback?.blockReason) {
    console.error('[Gemini Vision] Prompt bloqueado:', promptFeedback);
    throw new Error(`Gemini bloqueó la petición: ${promptFeedback.blockReason}. Prueba con otra imagen.`);
  }

  if (!candidate) {
    console.error('[Gemini Vision] Sin candidates en la respuesta:', data);
    throw new Error('Gemini no devolvió ningún resultado (posible cuota agotada o imagen corrupta).');
  }

  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    // Razones típicas: SAFETY (contenido bloqueado), MAX_TOKENS (corto), RECITATION (plagio),
    // OTHER (formato inválido). Sin texto útil.
    console.warn('[Gemini Vision] finishReason inusual:', candidate.finishReason, data);
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error('Gemini se cortó (MAX_TOKENS). La imagen/PDF es demasiado grande o compleja.');
    }
    if (candidate.finishReason === 'SAFETY') {
      throw new Error('Gemini bloqueó por seguridad (filtro de contenido). Prueba con otra imagen.');
    }
    // Sigue intentando leer el texto aunque finishReason sea raro
  }

  const text = candidate.content?.parts?.[0]?.text || '';
  if (!text.trim()) {
    console.error('[Gemini Vision] Respuesta vacía. Datos brutos:', data);
    throw new Error('Gemini devolvió una respuesta vacía. La imagen puede ser ilegible.');
  }

  const parsed = parseJSON(text);
  if (Object.keys(parsed).length === 0) {
    console.warn('[Gemini Vision] JSON vacío tras parseJSON. Respuesta raw:', text);
  }
  return { raw: parsed, provider: 'gemini', model };
};

const _scanBase64WithMistral = async (
  base64: string, mimeType: string, prompt: string, apiKey: string
): Promise<ScanResult> => {
  const model = VISION_MODELS.mistral!;
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text',      text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    }],
    temperature: 0.1,
  };
  const res = await fetchWithTimeout(
    'https://api.mistral.ai/v1/chat/completions',
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { raw: parseJSON(text), provider: 'mistral', model };
};

const _scanBase64WithGroqVision = async (
  base64: string, mimeType: string, prompt: string, apiKey: string
): Promise<ScanResult> => {
  const model = VISION_MODELS.groq!;
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text',      text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    }],
    temperature: 0.1,
  };
  const res = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`Groq Vision HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { raw: parseJSON(text), provider: 'groq', model };
};


// ═══════════════════════════════════════════════════════════════════════════════
// 🎙️ transcribeAudio — Dictado de voz
// ═══════════════════════════════════════════════════════════════════════════════

export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  const provider = voiceProvider();
  const groqKey  = keys.groq();

  if (provider === 'groq' && groqKey) {
    return _transcribeWithGroqWhisper(audioBlob, groqKey);
  }

  throw new Error('USE_BROWSER_FALLBACK');
};

const _transcribeWithGroqWhisper = async (
  audioBlob: Blob, apiKey: string
): Promise<string> => {
  // Detectar el tipo de audio real — iOS graba en mp4, no webm
  const mimeType = audioBlob.type || 'audio/webm';
  const extension = mimeType.includes('mp4') ? 'audio.mp4'
                  : mimeType.includes('ogg') ? 'audio.ogg'
                  : 'audio.webm';

  const formData = new FormData();
  formData.append('file',            audioBlob, extension);
  formData.append('model',           'whisper-large-v3-turbo');
  formData.append('language',        'es');
  formData.append('response_format', 'text');
  // Vocabulario de referencia — Whisper prioriza estas palabras al transcribir.
  // Evita que "Glovo" se transcriba como "gastos", "ApperStreet" como "Apple Street", etc.
  formData.append('prompt',
    'Efectivo, TPV1, TPV2, AMEX, Glovo, Uber, Madisa, ApperStreet, Tienda, arqueo, euros, caja física'
  );

  const res = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: formData },
    20000
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq Whisper HTTP ${res.status}: ${errText}`);
  }
  return (await res.text()).trim();
};


// ═══════════════════════════════════════════════════════════════════════════════
// 🤖 askAI — Chat / AIConsultant
// ═══════════════════════════════════════════════════════════════════════════════

export const askAI = async (
  messages: ChatMessage[],
  systemPrompt?: string,
  forceProvider?: AIProvider,
): Promise<ChatResult> => {

  const order: AIProvider[] = forceProvider
    ? [forceProvider]
    : ['cerebras', 'deepseek', 'groq', 'mistral', 'gemini'];

  const errors: string[] = [];

  for (const provider of order) {
    const key = keys[provider]();
    if (!key) continue;

    try {
      switch (provider) {
        case 'cerebras': return await _chatCerebras(messages, systemPrompt, key);
        case 'deepseek': return await _chatOpenAICompat(messages, systemPrompt, key, 'deepseek', 'https://api.deepseek.com/v1/chat/completions');
        case 'groq':     return await _chatOpenAICompat(messages, systemPrompt, key, 'groq',     'https://api.groq.com/openai/v1/chat/completions');
        case 'mistral':  return await _chatMistral(messages, systemPrompt, key);
        case 'gemini':   return await _chatGemini(messages, systemPrompt, key);
      }
    } catch (e) {
      errors.push(`${provider}: ${(e as Error).message}`);
      console.warn(`[aiProviders] ${provider} falló para chat, probando siguiente…`, e);
    }
  }

  throw new Error(`Todos los proveedores de chat fallaron:\n${errors.join('\n')}\n\nAñade al menos una API Key en Ajustes.`);
};

const _chatCerebras = async (
  messages: ChatMessage[], systemPrompt: string | undefined, apiKey: string
): Promise<ChatResult> => {
  const model = MODELS.cerebras;
  const allMessages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...messages,
  ];

  const res = await fetchWithTimeout(
    'https://api.cerebras.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: allMessages, temperature: 0.3, max_tokens: 2048 }),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || '', provider: 'cerebras', model };
};

const _chatOpenAICompat = async (
  messages: ChatMessage[], systemPrompt: string | undefined,
  apiKey: string, provider: AIProvider, endpoint: string
): Promise<ChatResult> => {
  const model = MODELS[provider];
  const allMessages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...messages,
  ];

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: allMessages, temperature: 0.3, max_tokens: 2048 }),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || '', provider, model };
};

const _chatMistral = async (
  messages: ChatMessage[], systemPrompt: string | undefined, apiKey: string
): Promise<ChatResult> => {
  const model = MODELS.mistral;
  const allMessages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...messages,
  ];

  const res = await fetchWithTimeout(
    'https://api.mistral.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: allMessages, temperature: 0.3, max_tokens: 2048 }),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || '', provider: 'mistral', model };
};

const _chatGemini = async (
  messages: ChatMessage[], systemPrompt: string | undefined, apiKey: string
): Promise<ChatResult> => {
  const model = MODELS.gemini;

  const body: Record<string, unknown> = {
    contents: messages.map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  };
  if (systemPrompt) {
    body.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text, provider: 'gemini', model };
};


// ═══════════════════════════════════════════════════════════════════════════════
// 🔑 Utilidades de diagnóstico
// ═══════════════════════════════════════════════════════════════════════════════

export const getProvidersStatus = (): Record<AIProvider, boolean> => ({
  gemini:   !!keys.gemini(),
  groq:     !!keys.groq(),
  cerebras: !!keys.cerebras(),
  deepseek: !!keys.deepseek(),
  mistral:  !!keys.mistral(),
});

export const getActiveChatProvider = (): AIProvider | null => {
  const order: AIProvider[] = ['cerebras', 'deepseek', 'groq', 'mistral', 'gemini'];
  return order.find(p => !!keys[p]()) ?? null;
};

export const getActiveVisionProvider = (): AIProvider | null => {
  const order: AIProvider[] = ['gemini', 'mistral', 'groq'];
  return order.find(p => !!keys[p]()) ?? null;
};
