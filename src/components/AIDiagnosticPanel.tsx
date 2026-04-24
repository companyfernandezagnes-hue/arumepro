// ============================================================================
// 🩺 AIDiagnosticPanel — panel de diagnóstico de proveedores IA
// Testea cada API (Gemini, Groq, Mistral, Cerebras, DeepSeek) y muestra el
// estado exacto: OK, key vacía, cuota agotada, key inválida, etc.
// ============================================================================
import React, { useState, useRef } from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  Eye, EyeOff, Key, Zap, Image as ImageIcon, MessageSquare, Upload,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { scanBase64 } from '../services/aiProviders';

type ProviderId = 'gemini' | 'groq' | 'mistral' | 'cerebras' | 'deepseek';
type Status = 'idle' | 'testing' | 'ok' | 'no_key' | 'quota' | 'invalid_key' | 'network' | 'unknown';

interface TestResult {
  status: Status;
  message: string;
  detail?: string;
  httpStatus?: number;
  latency?: number;
}

interface ProviderInfo {
  id: ProviderId;
  name: string;
  emoji: string;
  modelChat: string;
  capabilities: { chat: boolean; vision: boolean; imageGen: boolean };
  quotaFree: string;
  keyLabel: string;
  getKey: () => string;
  setup: string;
  testChat: (key: string) => Promise<TestResult>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmtError = async (res: Response): Promise<string> => {
  try {
    const j = await res.json();
    return j?.error?.message || j?.error || j?.message || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
};

const classify = (status: number, msg: string): Status => {
  if (status === 429) return 'quota';
  if (status === 403 || status === 401) return 'invalid_key';
  if (status === 400 && /quota|limit|exceeded/i.test(msg)) return 'quota';
  if (status === 404) return 'invalid_key';
  return 'unknown';
};

// ─── Tests reales ─────────────────────────────────────────────────────────

const testGemini = async (key: string): Promise<TestResult> => {
  if (!key) return { status: 'no_key', message: 'API key no configurada' };
  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with only: OK' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      }
    );
    const latency = Date.now() - t0;
    if (res.ok) {
      return { status: 'ok', message: 'Gemini responde', latency };
    }
    const detail = await fmtError(res);
    return { status: classify(res.status, detail), message: `HTTP ${res.status}`, detail, httpStatus: res.status, latency };
  } catch (e: any) {
    return { status: 'network', message: 'Error de red', detail: e?.message || String(e) };
  }
};

const testGroq = async (key: string): Promise<TestResult> => {
  if (!key) return { status: 'no_key', message: 'API key no configurada' };
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Reply with only: OK' }],
        max_tokens: 10,
      }),
    });
    const latency = Date.now() - t0;
    if (res.ok) return { status: 'ok', message: 'Groq responde', latency };
    const detail = await fmtError(res);
    return { status: classify(res.status, detail), message: `HTTP ${res.status}`, detail, httpStatus: res.status, latency };
  } catch (e: any) {
    return { status: 'network', message: 'Error de red', detail: e?.message || String(e) };
  }
};

const testMistral = async (key: string): Promise<TestResult> => {
  if (!key) return { status: 'no_key', message: 'API key no configurada' };
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: 'Reply with only: OK' }],
        max_tokens: 10,
      }),
    });
    const latency = Date.now() - t0;
    if (res.ok) return { status: 'ok', message: 'Mistral responde', latency };
    const detail = await fmtError(res);
    return { status: classify(res.status, detail), message: `HTTP ${res.status}`, detail, httpStatus: res.status, latency };
  } catch (e: any) {
    return { status: 'network', message: 'Error de red', detail: e?.message || String(e) };
  }
};

const testCerebras = async (key: string): Promise<TestResult> => {
  if (!key) return { status: 'no_key', message: 'API key no configurada' };
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'llama3.1-70b',
        messages: [{ role: 'user', content: 'Reply with only: OK' }],
        max_tokens: 10,
      }),
    });
    const latency = Date.now() - t0;
    if (res.ok) return { status: 'ok', message: 'Cerebras responde', latency };
    const detail = await fmtError(res);
    return { status: classify(res.status, detail), message: `HTTP ${res.status}`, detail, httpStatus: res.status, latency };
  } catch (e: any) {
    return { status: 'network', message: 'Error de red', detail: e?.message || String(e) };
  }
};

const testDeepseek = async (key: string): Promise<TestResult> => {
  if (!key) return { status: 'no_key', message: 'API key no configurada' };
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Reply with only: OK' }],
        max_tokens: 10,
      }),
    });
    const latency = Date.now() - t0;
    if (res.ok) return { status: 'ok', message: 'DeepSeek responde', latency };
    const detail = await fmtError(res);
    return { status: classify(res.status, detail), message: `HTTP ${res.status}`, detail, httpStatus: res.status, latency };
  } catch (e: any) {
    return { status: 'network', message: 'Error de red', detail: e?.message || String(e) };
  }
};

// ─── Configuración de proveedores ─────────────────────────────────────────
const PROVIDERS: ProviderInfo[] = [
  {
    id: 'gemini',
    name: 'Gemini',
    emoji: '🔷',
    modelChat: 'gemini-2.5-flash',
    capabilities: { chat: true, vision: true, imageGen: true },
    quotaFree: '15 req/min · 250 req/día · 250k tokens/día',
    keyLabel: 'gemini_api_key',
    getKey: () => localStorage.getItem('gemini_api_key') || '',
    setup: 'aistudio.google.com/apikey',
    testChat: testGemini,
  },
  {
    id: 'groq',
    name: 'Groq',
    emoji: '⚡',
    modelChat: 'llama-3.3-70b-versatile',
    capabilities: { chat: true, vision: true, imageGen: false },
    quotaFree: '30 req/min · ilimitado al día',
    keyLabel: 'groq_api_key',
    getKey: () => localStorage.getItem('groq_api_key') || '',
    setup: 'console.groq.com/keys',
    testChat: testGroq,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    emoji: '🌬️',
    modelChat: 'mistral-small-latest',
    capabilities: { chat: true, vision: true, imageGen: false },
    quotaFree: '1 req/sec · 500k tokens/mes',
    keyLabel: 'mistral_api_key',
    getKey: () => localStorage.getItem('mistral_api_key') || '',
    setup: 'console.mistral.ai',
    testChat: testMistral,
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    emoji: '🧠',
    modelChat: 'llama3.1-70b',
    capabilities: { chat: true, vision: false, imageGen: false },
    quotaFree: '30 req/min',
    keyLabel: 'cerebras_api_key',
    getKey: () => localStorage.getItem('cerebras_api_key') || '',
    setup: 'cloud.cerebras.ai',
    testChat: testCerebras,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    emoji: '🔍',
    modelChat: 'deepseek-chat',
    capabilities: { chat: true, vision: false, imageGen: false },
    quotaFree: 'De pago (muy barato ~0.14$/1M tokens)',
    keyLabel: 'deepseek_api_key',
    getKey: () => localStorage.getItem('deepseek_api_key') || '',
    setup: 'platform.deepseek.com',
    testChat: testDeepseek,
  },
];

// ─── Descripción humana de cada status ────────────────────────────────────
const describeStatus = (r: TestResult): { label: string; emoji: string; cls: string; tip?: string } => {
  switch (r.status) {
    case 'ok':
      return { label: 'Funciona', emoji: '✅', cls: 'text-[color:var(--arume-ok)] bg-[color:var(--arume-ok)]/10 border-[color:var(--arume-ok)]/20' };
    case 'no_key':
      return { label: 'Sin key', emoji: '⚪', cls: 'text-[color:var(--arume-gray-500)] bg-[color:var(--arume-gray-50)] border-[color:var(--arume-gray-200)]',
        tip: 'No has metido la API key en Ajustes → Llaves IA.' };
    case 'quota':
      return { label: 'Cuota agotada', emoji: '⏳', cls: 'text-[color:var(--arume-warn)] bg-[color:var(--arume-warn)]/10 border-[color:var(--arume-warn)]/20',
        tip: 'Has gastado tu cuota del día. Se resetea a las 00:00 hora Pacífico (9h España). Si es urgente: saca 2ª key o activa billing.' };
    case 'invalid_key':
      return { label: 'Key inválida', emoji: '🔑', cls: 'text-[color:var(--arume-danger)] bg-[color:var(--arume-danger)]/10 border-[color:var(--arume-danger)]/20',
        tip: 'La clave que introdujiste no funciona. Regenera una nueva en la web del proveedor y pégala otra vez.' };
    case 'network':
      return { label: 'Red caída', emoji: '📡', cls: 'text-[color:var(--arume-danger)] bg-[color:var(--arume-danger)]/10 border-[color:var(--arume-danger)]/20',
        tip: 'No se pudo contactar con el servidor. ¿Estás con internet? ¿El proveedor está caído?' };
    case 'unknown':
      return { label: 'Error desconocido', emoji: '❓', cls: 'text-[color:var(--arume-danger)] bg-[color:var(--arume-danger)]/10 border-[color:var(--arume-danger)]/20' };
    case 'testing':
      return { label: 'Comprobando…', emoji: '⏳', cls: 'text-[color:var(--arume-gray-500)] bg-[color:var(--arume-gray-50)] border-[color:var(--arume-gray-200)]' };
    default:
      return { label: 'Sin probar', emoji: '⚪', cls: 'text-[color:var(--arume-gray-400)] bg-[color:var(--arume-gray-50)] border-[color:var(--arume-gray-200)]' };
  }
};

// ═══════════════════════════════════════════════════════════════════════════
export const AIDiagnosticPanel: React.FC = () => {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

  // ── Test OCR con imagen real (sube un PDF/foto y ver qué pasa) ──
  const [ocrResult, setOcrResult] = useState<{ status: 'ok'|'error'|'empty'; text?: string; error?: string; raw?: any; provider?: string } | null>(null);
  const [ocrTesting, setOcrTesting] = useState(false);
  const ocrInputRef = useRef<HTMLInputElement>(null);

  const runOcrTest = async (file: File) => {
    setOcrTesting(true);
    setOcrResult(null);
    try {
      const b64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
      });
      // Prompt simple de test: extraer texto y devolver JSON
      const prompt = `Lee esta imagen/PDF y devuelve SOLO un JSON con este formato:
{"texto_detectado": "primer renglón de texto legible o descripción breve", "tipo": "factura|albaran|nomina|foto|otro", "legible": true}`;
      const scan = await scanBase64(b64, file.type || 'application/pdf', prompt);
      const raw: any = scan?.raw || {};
      if (Object.keys(raw).length === 0) {
        setOcrResult({ status: 'empty', error: `El proveedor ${scan?.provider || '?'} respondió pero sin datos extraíbles`, raw, provider: scan?.provider });
      } else {
        setOcrResult({
          status: 'ok',
          text: String(raw.texto_detectado || raw.description || JSON.stringify(raw).slice(0, 200)),
          raw,
          provider: scan?.provider,
        });
      }
    } catch (err: any) {
      setOcrResult({ status: 'error', error: err?.message || 'Error desconocido' });
    } finally {
      setOcrTesting(false);
    }
  };

  const runAll = async () => {
    setTesting(true);
    const newResults: Record<string, TestResult> = {};
    // Marcar todos como 'testing'
    PROVIDERS.forEach(p => { newResults[p.id] = { status: 'testing', message: 'Probando…' }; });
    setResults({ ...newResults });

    // Ejecutar tests en paralelo
    await Promise.all(
      PROVIDERS.map(async (p) => {
        const key = p.getKey();
        const r = await p.testChat(key);
        newResults[p.id] = r;
        setResults({ ...newResults });
      })
    );

    setTesting(false);
  };

  const maskKey = (key: string) => {
    if (!key) return '—';
    if (showKeys) return key;
    if (key.length < 12) return '•'.repeat(key.length);
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  };

  // Resumen general
  const totalOk = Object.values(results).filter(r => r.status === 'ok').length;
  const totalWithKey = PROVIDERS.filter(p => p.getKey()).length;
  const anyVisionOk = PROVIDERS.some(p => p.capabilities.vision && results[p.id]?.status === 'ok');

  return (
    <div className="space-y-4">
      {/* Resumen + acción */}
      <div className="bg-[color:var(--arume-paper)] border border-[color:var(--arume-gray-100)] rounded-2xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Diagnóstico IA</p>
            <h3 className="font-serif text-xl font-semibold tracking-tight mt-1">
              {Object.keys(results).length === 0
                ? 'Pulsa "Probar ahora" para diagnosticar'
                : `${totalOk}/${totalWithKey} proveedores OK`}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowKeys(s => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] border border-[color:var(--arume-gray-200)] hover:bg-[color:var(--arume-gray-50)] transition">
              {showKeys ? <><EyeOff className="w-3.5 h-3.5"/> Ocultar</> : <><Eye className="w-3.5 h-3.5"/> Ver keys</>}
            </button>
            <button onClick={runAll} disabled={testing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition active:scale-[0.98] disabled:opacity-50">
              {testing
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/> Probando…</>
                : <><RefreshCw className="w-3.5 h-3.5"/> Probar ahora</>
              }
            </button>
          </div>
        </div>

        {/* Alertas contextuales */}
        {Object.keys(results).length > 0 && !testing && (
          <div className="mt-4 space-y-2">
            {!anyVisionOk && PROVIDERS.some(p => p.capabilities.vision && p.getKey()) && (
              <div className="flex items-start gap-2 bg-[color:var(--arume-danger)]/10 border border-[color:var(--arume-danger)]/20 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-[color:var(--arume-danger)] shrink-0 mt-0.5"/>
                <p className="text-xs text-[color:var(--arume-ink)]">
                  <b>Ningún proveedor de visión funciona.</b> Subir facturas, nóminas o fotos fallará.
                  Revisa Gemini o Mistral (son los mejores para OCR).
                </p>
              </div>
            )}
            {totalOk === 0 && totalWithKey > 0 && (
              <div className="flex items-start gap-2 bg-[color:var(--arume-warn)]/10 border border-[color:var(--arume-warn)]/20 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-[color:var(--arume-warn)] shrink-0 mt-0.5"/>
                <p className="text-xs text-[color:var(--arume-ink)]">
                  <b>Tienes {totalWithKey} key{totalWithKey > 1 ? 's' : ''} configurada{totalWithKey > 1 ? 's' : ''} pero ninguna funciona.</b>
                  {' '}Probablemente has agotado la cuota gratuita del día. Se resetea a las 9h mañana (hora España).
                </p>
              </div>
            )}
            {totalOk > 0 && (
              <div className="flex items-start gap-2 bg-[color:var(--arume-ok)]/10 border border-[color:var(--arume-ok)]/20 rounded-xl p-3">
                <CheckCircle2 className="w-4 h-4 text-[color:var(--arume-ok)] shrink-0 mt-0.5"/>
                <p className="text-xs text-[color:var(--arume-ink)]">
                  <b>{totalOk} proveedor{totalOk > 1 ? 'es' : ''} funcionan correctamente.</b> La app usará el primero disponible como fallback automático.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lista de proveedores */}
      <div className="space-y-2">
        {PROVIDERS.map(p => {
          const key = p.getKey();
          const r = results[p.id];
          const desc = r ? describeStatus(r) : describeStatus({ status: 'idle' as any, message: '' });

          return (
            <div key={p.id} className={cn(
              'bg-white border rounded-2xl p-4 flex items-start gap-4 transition',
              r?.status === 'ok' ? 'border-[color:var(--arume-ok)]/30' :
              r?.status === 'invalid_key' || r?.status === 'network' ? 'border-[color:var(--arume-danger)]/30' :
              r?.status === 'quota' ? 'border-[color:var(--arume-warn)]/30' :
              'border-[color:var(--arume-gray-100)]'
            )}>
              {/* Emoji proveedor */}
              <div className="w-10 h-10 rounded-full bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)] flex items-center justify-center text-lg shrink-0">
                {p.emoji}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-serif text-lg font-semibold tracking-tight">{p.name}</p>
                  <span className={cn('text-[10px] font-semibold uppercase tracking-[0.15em] px-2 py-0.5 rounded-full border', desc.cls)}>
                    {desc.emoji} {desc.label}
                  </span>
                  {p.capabilities.chat    && <span title="Chat" className="text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)]">💬</span>}
                  {p.capabilities.vision  && <span title="Visión (OCR)" className="text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)]">👁️</span>}
                  {p.capabilities.imageGen && <span title="Generar imágenes" className="text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)]">🎨</span>}
                </div>
                <p className="text-[11px] text-[color:var(--arume-gray-500)] mt-0.5">
                  {p.modelChat} · <span className="text-[color:var(--arume-gray-400)]">{p.quotaFree}</span>
                </p>

                {/* Key enmascarada */}
                <div className="flex items-center gap-2 mt-2">
                  <Key className="w-3 h-3 text-[color:var(--arume-gray-400)]"/>
                  <code className="text-[11px] font-mono text-[color:var(--arume-gray-600)]">{maskKey(key)}</code>
                  {!key && (
                    <a href={`https://${p.setup}`} target="_blank" rel="noreferrer"
                      className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gold)] hover:underline">
                      Obtener key →
                    </a>
                  )}
                </div>

                {/* Detalle del error si hay */}
                {r?.detail && (
                  <div className="mt-2 bg-[color:var(--arume-gray-50)] rounded-lg p-2 text-[11px] font-mono text-[color:var(--arume-gray-600)] break-all">
                    {r.detail}
                  </div>
                )}

                {/* Tip humano */}
                {r && desc.tip && (
                  <p className="mt-2 text-[11px] text-[color:var(--arume-gray-600)] leading-relaxed">
                    💡 {desc.tip}
                  </p>
                )}

                {/* Latencia si ok */}
                {r?.status === 'ok' && r.latency && (
                  <p className="mt-1 text-[10px] text-[color:var(--arume-gray-400)] tabular-nums">
                    Respuesta en {r.latency}ms
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* TEST OCR CON IMAGEN REAL ─────────────────────────────────────── */}
      <div className="bg-[color:var(--arume-paper)] border border-[color:var(--arume-gray-100)] rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Test de visión (OCR)</p>
            <h3 className="font-serif text-xl font-semibold tracking-tight mt-1">¿La IA lee tus imágenes?</h3>
            <p className="text-sm text-[color:var(--arume-gray-500)] mt-1">Sube una factura, nómina o foto de prueba. Te dirá EXACTO qué pasó.</p>
          </div>
          <input ref={ocrInputRef} type="file" accept="application/pdf,image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) runOcrTest(f); e.target.value = ''; }}
          />
          <button onClick={() => ocrInputRef.current?.click()} disabled={ocrTesting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] hover:brightness-95 transition active:scale-[0.98] disabled:opacity-50">
            {ocrTesting
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/> Leyendo…</>
              : <><Upload className="w-3.5 h-3.5"/> Subir imagen de prueba</>
            }
          </button>
        </div>

        {ocrResult && (
          <div className="mt-4">
            {ocrResult.status === 'ok' && (
              <div className="bg-[color:var(--arume-ok)]/10 border border-[color:var(--arume-ok)]/20 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[color:var(--arume-ok)] shrink-0 mt-0.5"/>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[color:var(--arume-ink)]">
                      ¡OCR funciona! ({ocrResult.provider})
                    </p>
                    <p className="text-xs text-[color:var(--arume-gray-600)] mt-1">
                      <b>Texto detectado:</b> {ocrResult.text}
                    </p>
                    <details className="mt-2">
                      <summary className="text-[11px] text-[color:var(--arume-gray-500)] cursor-pointer hover:text-[color:var(--arume-ink)]">Ver respuesta completa</summary>
                      <pre className="mt-1 bg-white rounded p-2 text-[10px] font-mono text-[color:var(--arume-gray-600)] overflow-auto max-h-32">
{JSON.stringify(ocrResult.raw, null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>
              </div>
            )}
            {ocrResult.status === 'empty' && (
              <div className="bg-[color:var(--arume-warn)]/10 border border-[color:var(--arume-warn)]/20 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[color:var(--arume-warn)] shrink-0 mt-0.5"/>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[color:var(--arume-ink)]">La IA respondió vacío</p>
                    <p className="text-xs text-[color:var(--arume-gray-600)] mt-1">{ocrResult.error}</p>
                    <p className="text-[11px] text-[color:var(--arume-gray-500)] mt-2 leading-relaxed">
                      💡 Suele pasar cuando la imagen es ilegible, muy pequeña, o Gemini la bloqueó por seguridad.
                      Prueba con una foto más grande y clara.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {ocrResult.status === 'error' && (
              <div className="bg-[color:var(--arume-danger)]/10 border border-[color:var(--arume-danger)]/20 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <XCircle className="w-4 h-4 text-[color:var(--arume-danger)] shrink-0 mt-0.5"/>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[color:var(--arume-ink)]">Error al escanear</p>
                    <code className="block mt-1 text-[11px] font-mono text-[color:var(--arume-gray-700)] bg-white rounded p-2 break-all">
                      {ocrResult.error}
                    </code>
                    <p className="text-[11px] text-[color:var(--arume-gray-500)] mt-2 leading-relaxed">
                      💡 Si pone "cuota agotada" → espera a mañana 9h.<br/>
                      Si pone "MAX_TOKENS" → el PDF es demasiado grande, prueba con uno más pequeño.<br/>
                      Si pone "SAFETY" → Gemini bloqueó por seguridad, prueba con otra imagen.<br/>
                      Si pone "HTTP 404" → el modelo no está disponible desde tu cuenta.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div className="bg-[color:var(--arume-gray-50)] rounded-xl p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)] mb-2">Qué hace cada icono</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] text-[color:var(--arume-gray-600)]">
          <div>💬 <b>Chat</b>: responde preguntas, genera texto</div>
          <div>👁️ <b>Visión</b>: lee PDFs y fotos (OCR)</div>
          <div>🎨 <b>Imagen</b>: genera o edita imágenes</div>
        </div>
      </div>
    </div>
  );
};
