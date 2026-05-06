/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  src/services/aiProviders.ts                                     ║
 * ║  CEREBRO CENTRAL DE IA — Arume Pro                               ║
 * ║                                                                  ║
 * ║  Todos los componentes importan de aquí. Nunca llaman a          ║
 * ║  proveedores de IA directamente.                                 ║
 * ║                                                                  ║
 * ║  Proveedores soportados:                                         ║
 * ║   🟣 Claude   — imágenes + PDFs (PRINCIPAL — Anthropic)          ║
 * ║   🔵 Gemini   — imágenes + PDFs (fallback)                       ║
 * ║   🟢 Groq     — velocidad + Whisper (voz)                        ║
 * ║   🟪 Cerebras — texto ultrarrápido (~0.10$/M tokens)             ║
 * ║   🔷 DeepSeek — análisis largo (5M tokens gratis al registrarse) ║
 * ║   🇪🇺 Mistral  — backup europeo visión (1B tokens/mes gratis)    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AIProvider = 'claude' | 'gemini' | 'groq' | 'cerebras' | 'deepseek' | 'mistral';

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
  claude:   () => getKey('claude_api_key'),
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
  claude:   'claude-sonnet-4-5',
  gemini:   'gemini-2.5-flash',
  groq:     'llama-3.3-70b-versatile',
  cerebras: 'llama3.1-8b',
  deepseek: 'deepseek-chat',
  mistral:  'mistral-small-latest',
};

const VISION_MODELS: Partial<Record<AIProvider, string>> = {
  // Claude Sonnet 4.5 — visión + PDFs nativos. Preferido como primer proveedor
  // por precisión OCR superior en facturas/tickets.
  claude:  'claude-sonnet-4-5',
  gemini:  'gemini-2.5-flash',
  mistral: 'pixtral-12b-2409',
  // llama-3.2-11b-vision-preview fue deprecado en dic 2025. Reemplazado por
  // el modelo de producción de Meta con visión.
  groq:    'meta-llama/llama-4-scout-17b-16e-instruct',
};

// ─── Helper: fetch con timeout ────────────────────────────────────────────────
// 90s para visión: imágenes grandes o Gemini saturado necesitan más margen.

const fetchWithTimeout = async (url: string, opts: RequestInit, ms = 90000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e: any) {
    // Mensaje claro cuando el timeout interno aborta
    if (e?.name === 'AbortError' || /aborted|signal is aborted/i.test(e?.message || '')) {
      throw new Error(`Timeout: el servidor tardó más de ${ms / 1000}s en responder. Prueba con una imagen más pequeña.`);
    }
    throw e;
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

// Realza el contraste de la imagen para OCR de tickets/albaranes.
// Usa estiramiento de histograma adaptativo (auto-levels) en escala de grises
// suavizada con la imagen original — recupera detalle de texto en fotos
// subexpuestas o sobreexpuestas sin destruir colores. Aplicado SOLO si la
// imagen tiene baja varianza (foto plana, ticket pálido).
const enhanceForOCR = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
  try {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const N = d.length / 4;

    // 1. Calcular percentiles 1% y 99% del canal de luminancia
    //    (descarta píxeles extremos que sesgan el rango).
    const lumHist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const Y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      lumHist[Y]++;
    }
    const lowTarget  = Math.floor(N * 0.01);
    const highTarget = Math.floor(N * 0.99);
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += lumHist[v];
      if (acc >= lowTarget) { lo = v; break; }
    }
    acc = 0;
    for (let v = 255; v >= 0; v--) {
      acc += lumHist[v];
      if (acc >= N - highTarget) { hi = v; break; }
    }
    const range = Math.max(1, hi - lo);
    // Si el contraste ya es bueno (range > 200) no tocamos.
    if (range > 200) return;

    // 2. Estiramos cada canal por separado al rango [0,255] usando lo/hi.
    //    Aplicamos también un toque de gamma 0.95 que oscurece ligeramente
    //    grises medios → texto sobre fondo blanco gana.
    const scale = 255 / range;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = (d[i + c] - lo) * scale;
        if (v < 0) v = 0; else if (v > 255) v = 255;
        // gamma 0.95 (≈ x^1.05)
        v = Math.pow(v / 255, 1.05) * 255;
        d[i + c] = v | 0;
      }
    }
    ctx.putImageData(img, 0, 0);
  } catch {
    // Si falla por CORS/seguridad, dejamos la imagen tal cual.
  }
};

const compressImage = async (file: File | Blob): Promise<{ base64: string; mimeType: string }> => {
  // Compresión calibrada para OCR: el texto de tickets/albaranes ES PEQUEÑO,
  // si se comprime demasiado la IA lee mal "8,50€" como "8,90€" o pierde
  // dígitos. Subimos el techo a 1800px + calidad alta. Si el resultado pasa
  // de 4MB (límite cómodo para subir a Claude/Gemini), bajamos calidad
  // progresivamente pero mantenemos resolución alta.
  const QUALITY_LEVELS = [0.92, 0.85, 0.75, 0.6, 0.45];
  const MAX_BYTES = 4 * 1024 * 1024;     // 4MB
  const MAX_W = 1800, MAX_H = 1800;      // antes 1200 — pequeño para OCR fino

  const bitmap = await createImageBitmap(file);
  const ratio  = Math.min(MAX_W / bitmap.width, MAX_H / bitmap.height, 1);
  const w = Math.max(1, Math.round(bitmap.width  * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx) {
    // Suavizado de alta calidad — preserva mejor el contraste del texto
    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    // 🆕 Realce de contraste para fotos planas / tickets pálidos
    enhanceForOCR(ctx, w, h);
  }

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
  forceProvider?: AIProvider,
): Promise<ScanResult> => {

  const isImage = file.type.startsWith('image/');
  const isPDF   = file.type === 'application/pdf';

  if (!isImage && !isPDF) throw new Error('Solo se admiten imágenes y PDFs.');

  // 🩺 Recopilamos el error específico de cada proveedor para surfacearlos al
  // final en vez de un mensaje genérico inútil (como hace scanBase64).
  const errors: string[] = [];

  // Si se fuerza un proveedor concreto (p.ej. 'gemini' para tickets de caja),
  // NO hacemos fallback a otros modelos: si el más capaz no lo lee, mejor que
  // la usuaria meta los números a mano que confiar en un modelo más débil.
  const onlyClaude  = forceProvider === 'claude';
  const onlyGemini  = forceProvider === 'gemini';
  const onlyMistral = forceProvider === 'mistral';
  const onlyGroq    = forceProvider === 'groq';
  const tryAll      = !forceProvider;

  // 🟣 Claude PRIMERO — preferido por la usuaria (suscripción Anthropic propia).
  // Soporta imágenes + PDFs nativos. Mismo retry contra 429/529/overloaded.
  const claudeKey = keys.claude();
  if (claudeKey && (onlyClaude || tryAll)) {
    const isTransient = (m: string) =>
      /overloaded|temporarily|529|503|429|rate.?limit/i.test(m);
    const delays = [0, 2000, 5000];
    let lastErr = '';
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
      try {
        return await _scanWithClaude(file, prompt, claudeKey, isImage);
      } catch (e: any) {
        lastErr = e?.message || String(e);
        console.warn(`[aiProviders] Claude scanDocument intento ${i + 1}/${delays.length}:`, lastErr);
        if (!isTransient(lastErr)) break;
      }
    }
    errors.push(`Claude: ${lastErr}`);
  } else if (!claudeKey && (onlyClaude || tryAll)) {
    errors.push('Claude: sin API key configurada');
  }

  const gemKey = keys.gemini();
  if (gemKey && (onlyGemini || tryAll)) {
    // Reintentar con backoff cuando Gemini devuelve "high demand"/503/429.
    // Sin esto, un ticket de caja (forzado a gemini, sin fallback) falla
    // inmediatamente con un pico transitorio del lado de Google.
    const isTransient = (m: string) =>
      /high demand|overloaded|temporarily|UNAVAILABLE|503|429|rate.?limit/i.test(m);
    const delays = [0, 2000, 5000];
    let lastErr = '';
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
      try {
        return await _scanWithGemini(file, prompt, gemKey, isImage);
      } catch (e: any) {
        lastErr = e?.message || String(e);
        console.warn(`[aiProviders] Gemini scanDocument intento ${i + 1}/${delays.length}:`, lastErr);
        if (!isTransient(lastErr)) break;
      }
    }
    errors.push(`Gemini: ${lastErr}`);
  } else if (!gemKey && (onlyGemini || tryAll)) {
    errors.push('Gemini: sin API key configurada');
  }

  const misKey = keys.mistral();
  if (misKey && isImage && (onlyMistral || tryAll)) {
    try {
      return await _scanWithMistral(file, prompt, misKey);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn('[aiProviders] Mistral falló en scanDocument:', msg);
      errors.push(`Mistral: ${msg}`);
    }
  } else if (!misKey && (onlyMistral || tryAll)) {
    errors.push('Mistral: sin API key configurada');
  } else if (!isImage && (onlyMistral || tryAll)) {
    errors.push('Mistral: solo soporta imágenes, no PDFs');
  }

  const groqKey = keys.groq();
  if (groqKey && isImage && (onlyGroq || tryAll)) {
    try {
      return await _scanWithGroqVision(file, prompt, groqKey);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn('[aiProviders] Groq Vision falló en scanDocument:', msg);
      errors.push(`Groq: ${msg}`);
    }
  } else if (!groqKey && (onlyGroq || tryAll)) {
    errors.push('Groq: sin API key configurada');
  } else if (!isImage && (onlyGroq || tryAll)) {
    errors.push('Groq: solo soporta imágenes, no PDFs');
  }

  throw new Error(
    (forceProvider
      ? `No se pudo escanear con ${forceProvider} (forzado, sin fallback). Mete los números a mano.\n\n`
      : `No se pudo escanear con ningún proveedor de visión.\n\n`) +
    errors.map(e => `• ${e}`).join('\n') +
    (isPDF
      ? '\n\n⚠️ Para PDFs sólo sirven Claude y Gemini. Mistral y Groq NO los soportan.'
      : '')
  );
};

/**
 * scanDocumentMultiPage — Escaneo de UN documento repartido en varias páginas.
 * Todas las páginas se envían JUNTAS a Gemini para que fusione la información
 * en un solo JSON (líneas de la primera hoja + líneas y total de la segunda).
 *
 * Útil para facturas grandes donde los productos están en la hoja 1 y el
 * total está en la hoja 2 (con o sin productos adicionales).
 */
export const scanDocumentMultiPage = async (
  files: File[],
  prompt: string,
): Promise<ScanResult> => {
  if (files.length === 0) throw new Error('No hay archivos que escanear.');
  if (files.length === 1) return scanDocument(files[0], prompt);

  // Gemini soporta múltiples imágenes/PDFs en UNA sola petición.
  // Solo implementamos para Gemini — Mistral/Groq requieren N llamadas.
  const gemKey = keys.gemini();
  if (!gemKey) throw new Error('Gemini: sin API key configurada. Para multi-página se necesita Gemini.');

  const model = VISION_MODELS.gemini!;
  const allImages = await Promise.all(
    files.map(async (f) => {
      const isImage = f.type.startsWith('image/');
      if (isImage) {
        const { base64, mimeType } = await compressImage(f);
        return { inline_data: { mime_type: mimeType, data: base64 } };
      }
      return { inline_data: { mime_type: 'application/pdf', data: await fileToBase64(f) } };
    })
  );

  // Prompt enriquecido para fusionar
  const mergePrompt = `${prompt}

⚠️ IMPORTANTE: Este documento tiene ${files.length} páginas/imágenes. FUSIONA toda la información de TODAS las páginas en un solo JSON:
- Agrupa TODAS las líneas de productos de todas las páginas en el array "lineas".
- Usa el TOTAL final que aparezca (normalmente en la última página).
- Si hay descuentos globales, aplícalos al total.
- Número de factura, fecha, proveedor: usa los de la primera página (o la que los tenga).`;

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: mergePrompt },
        ...allImages,
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  };

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    120_000, // 2 minutos para multi-página
  );
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({} as any));
    throw new Error(`Gemini Vision multi-página: ${errJson?.error?.message || `HTTP ${res.status}`}`);
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('Gemini no devolvió resultado para multi-página.');
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(`Gemini multi-página ${candidate.finishReason}. Prueba con menos páginas o más ligeras.`);
  }
  const text = candidate.content?.parts?.[0]?.text || '';
  if (!text.trim()) throw new Error('Gemini respondió vacío en multi-página.');
  return { raw: parseJSON(text), provider: 'gemini', model };
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

  // 🩺 Recopilamos errores específicos de cada proveedor para surfacearlos al
  // final. Antes se perdían en console.warn y el usuario veía un mensaje
  // genérico inútil.
  const errors: string[] = [];

  // 🟣 Claude PRIMERO — preferido por la usuaria. Visión + PDFs nativos.
  const claudeKey = keys.claude();
  if (claudeKey) {
    const isTransientClaude = (msg: string) =>
      /overloaded|temporarily|529|503|429|rate.?limit/i.test(msg);
    const delays = [0, 2000, 5000];
    let lastErr = '';
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
      try {
        return await _scanBase64WithClaude(cleanB64, mimeType, prompt, claudeKey);
      } catch (e: any) {
        lastErr = e?.message || String(e);
        console.warn(`[aiProviders] Claude intento ${i + 1}/${delays.length}:`, lastErr);
        if (!isTransientClaude(lastErr)) break;
      }
    }
    errors.push(`Claude: ${lastErr}`);
  } else {
    errors.push('Claude: sin API key configurada');
  }

  const gemKey = keys.gemini();
  if (gemKey) {
    // Reintentar con backoff cuando Gemini devuelve "high demand" / 503 / 429.
    // Son fallos transitorios del lado de Google, no de la app.
    const isTransient = (msg: string) =>
      /high demand|overloaded|temporarily|UNAVAILABLE|503|429|rate.?limit/i.test(msg);
    const delays = [0, 2000, 5000]; // 3 intentos: inmediato, +2s, +5s
    let lastErr = '';
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
      try {
        return await _scanBase64WithGemini(cleanB64, mimeType, prompt, gemKey);
      } catch (e: any) {
        lastErr = e?.message || String(e);
        console.warn(`[aiProviders] Gemini intento ${i + 1}/${delays.length}:`, lastErr);
        if (!isTransient(lastErr)) break; // error no transitorio → no reintentar
      }
    }
    errors.push(`Gemini: ${lastErr}`);
  } else {
    errors.push('Gemini: sin API key configurada');
  }

  const misKey = keys.mistral();
  if (misKey && isImage) {
    try {
      return await _scanBase64WithMistral(cleanB64, mimeType, prompt, misKey);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn('[aiProviders] Mistral falló en scanBase64:', msg);
      errors.push(`Mistral: ${msg}`);
    }
  } else if (!misKey) {
    errors.push('Mistral: sin API key configurada');
  } else if (!isImage) {
    errors.push('Mistral: solo soporta imágenes, no PDFs');
  }

  const groqKey = keys.groq();
  if (groqKey && isImage) {
    try {
      return await _scanBase64WithGroqVision(cleanB64, mimeType, prompt, groqKey);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn('[aiProviders] Groq Vision falló en scanBase64:', msg);
      errors.push(`Groq: ${msg}`);
    }
  } else if (!groqKey) {
    errors.push('Groq: sin API key configurada');
  } else if (!isImage) {
    errors.push('Groq: solo soporta imágenes, no PDFs');
  }

  // Todos fallaron — construir mensaje de error rico con los motivos concretos
  throw new Error(
    `No se pudo escanear con ningún proveedor de visión.\n\n` +
    errors.map(e => `• ${e}`).join('\n') +
    (mimeType === 'application/pdf'
      ? '\n\n⚠️ Para PDFs sólo sirven Claude y Gemini. Mistral y Groq NO los soportan.'
      : '')
  );
};

// ─── Claude (Anthropic) ──────────────────────────────────────────────────────
//
// API directa al endpoint /v1/messages desde el navegador. Necesita el header
// `anthropic-dangerous-direct-browser-access: true` — Anthropic lo exige para
// llamadas desde el navegador (la cabecera por sí sola no expone más nada que
// la API key, que ya tenemos en localStorage).
//
// Claude soporta:
//   - imágenes (image/jpeg, image/png, image/gif, image/webp) vía base64
//   - PDFs nativos (application/pdf) vía content block "document"
// Ambos tipos en el mismo formato. Pedimos JSON crudo en el prompt y
// extraemos el primer bloque de texto de la respuesta.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_HEADERS = (apiKey: string) => ({
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

const _claudeContentBlock = (mimeType: string, base64: string) => {
  if (mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  // Normalizar tipos de imagen aceptados
  const m = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: m, data: base64 } };
};

const _scanWithClaude = async (
  file: File, prompt: string, apiKey: string, isImage: boolean
): Promise<ScanResult> => {
  const model = VISION_MODELS.claude!;
  const base64 = isImage
    ? (await compressImage(file)).base64
    : await fileToBase64(file);
  const mimeType = isImage ? 'image/jpeg' : 'application/pdf';

  const body = {
    model,
    max_tokens: 2048,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        _claudeContentBlock(mimeType, base64),
        // Reforzamos "SOLO JSON" porque Claude tiende a envolver la respuesta
        // en explicación a menos que se le diga claramente. parseJSON aguanta
        // markdown ```json``` por si acaso.
        { type: 'text', text: `${prompt}\n\nResponde ÚNICAMENTE con el JSON pedido, sin explicaciones, sin markdown, sin texto antes ni después.` },
      ],
    }],
  };

  const res = await fetchWithTimeout(CLAUDE_API_URL, {
    method: 'POST',
    headers: CLAUDE_HEADERS(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({} as any));
    const msg = errJson?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Claude Vision: ${msg}`);
  }
  const data = await res.json();
  if (data?.stop_reason && data.stop_reason !== 'end_turn' && data.stop_reason !== 'stop_sequence') {
    if (data.stop_reason === 'max_tokens') {
      throw new Error('Claude se cortó (max_tokens). Documento demasiado complejo para 2048 tokens.');
    }
    throw new Error(`Claude paró con stop_reason=${data.stop_reason}.`);
  }
  const block = (data?.content || []).find((c: any) => c?.type === 'text');
  const text = block?.text || '';
  if (!text.trim()) throw new Error('Claude devolvió respuesta vacía.');
  return { raw: parseJSON(text), provider: 'claude', model };
};

const _scanBase64WithClaude = async (
  base64: string, mimeType: string, prompt: string, apiKey: string
): Promise<ScanResult> => {
  const model = VISION_MODELS.claude!;
  const body = {
    model,
    max_tokens: 2048,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        _claudeContentBlock(mimeType, base64),
        { type: 'text', text: `${prompt}\n\nResponde ÚNICAMENTE con el JSON pedido, sin explicaciones, sin markdown, sin texto antes ni después.` },
      ],
    }],
  };
  const res = await fetchWithTimeout(CLAUDE_API_URL, {
    method: 'POST',
    headers: CLAUDE_HEADERS(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({} as any));
    const msg = errJson?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Claude Vision: ${msg}`);
  }
  const data = await res.json();
  if (data?.stop_reason === 'max_tokens') {
    throw new Error('Claude se cortó (max_tokens).');
  }
  const block = (data?.content || []).find((c: any) => c?.type === 'text');
  const text = block?.text || '';
  if (!text.trim()) throw new Error('Claude devolvió respuesta vacía.');
  return { raw: parseJSON(text), provider: 'claude', model };
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
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({} as any));
    const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini Vision: ${errMsg}`);
  }
  const data = await res.json();

  // 🩺 Mismo diagnóstico que _scanBase64WithGemini — detectar SAFETY,
  // MAX_TOKENS, promptFeedback, respuesta vacía, etc.
  const candidate = data.candidates?.[0];
  const promptFeedback = data.promptFeedback;
  if (promptFeedback?.blockReason) {
    console.error('[Gemini Vision scanDocument] Prompt bloqueado:', promptFeedback);
    throw new Error(`Gemini bloqueó la petición: ${promptFeedback.blockReason}. Prueba con otra imagen.`);
  }
  if (!candidate) {
    console.error('[Gemini Vision scanDocument] Sin candidates:', data);
    throw new Error('Gemini no devolvió resultado (posible cuota agotada o imagen corrupta).');
  }
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    console.warn('[Gemini Vision scanDocument] finishReason:', candidate.finishReason, data);
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error('Gemini se cortó (MAX_TOKENS). La imagen/PDF es demasiado grande o compleja.');
    }
    if (candidate.finishReason === 'SAFETY') {
      throw new Error('Gemini bloqueó por seguridad. Prueba con otra imagen.');
    }
  }
  const text = candidate.content?.parts?.[0]?.text || '';
  if (!text.trim()) {
    console.error('[Gemini Vision scanDocument] Respuesta vacía:', data);
    throw new Error('Gemini devolvió respuesta vacía. La imagen puede ser ilegible.');
  }
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
  claude:   !!keys.claude(),
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
