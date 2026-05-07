/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  src/hooks/useVoiceInput.ts                                      ║
 * ║                                                                  ║
 * ║  Hook centralizado de voz para toda la app.                      ║
 * ║  Lee voice_provider del localStorage y decide automáticamente:   ║
 * ║    - 'groq'    → graba audio y usa Groq Whisper (pro)            ║
 * ║    - 'browser' → usa webkitSpeechRecognition (nativo, gratis)    ║
 * ║                                                                  ║
 * ║  Uso simple:                                                     ║
 * ║    const { isRecording, liveTranscript, toggleRecording }        ║
 * ║      = useVoiceInput({ onResult: (text) => handleText(text) });  ║
 * ║                                                                  ║
 * ║  Modo numérico (cajas): convierte "ochocientos cuarenta y dos"   ║
 * ║   → "842" antes de llamar onResult.                              ║
 * ║    useVoiceInput({ onResult, numericMode: true })                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { useState, useRef, useCallback } from 'react';
import { transcribeAudio, voiceProvider } from '../services/aiProviders';
import { toast } from './useToast';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface UseVoiceInputOptions {
  /** Callback que recibe el texto final transcrito (ya post-procesado si numericMode) */
  onResult: (text: string) => void;
  /** Idioma para el reconocimiento del navegador (default: 'es-ES') */
  lang?: string;
  /** Tiempo máximo de grabación en ms para Groq Whisper (default: 30000) */
  maxDurationMs?: number;
  /**
   * Si true, post-procesa el resultado para extraer un número o cadena numérica.
   * "ochocientos cuarenta y dos euros con cincuenta" → "842.50"
   * Útil en CashView donde el campo final es siempre un importe.
   */
  numericMode?: boolean;
  /**
   * Si true, reconocimiento continuo: el navegador no termina al primer silencio.
   * Útil para dictar frases largas (notas). En modo numérico se mantiene en false.
   */
  continuous?: boolean;
}

interface UseVoiceInputReturn {
  isRecording: boolean;
  liveTranscript: string;       // Solo se rellena en modo navegador (interimResults)
  activeProvider: 'browser' | 'groq';
  toggleRecording: () => void;
}

// ─── Conversión de palabras a número (es-ES) ──────────────────────────────────
//
// El reconocimiento de voz suele transcribir números como palabras
// ("ciento veinticinco con cincuenta"), y luego al pegarlo en un input
// numérico no se interpreta. Esto convierte la frase a "125.50" antes de
// devolverlo. Soporta:
//   - "doscientos cuarenta y tres" → 243
//   - "1.245,50"                   → 1245.50
//   - "mil doscientos con setenta y cinco euros" → 1200.75
//
const UNIDADES: Record<string, number> = {
  cero: 0, uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, dieciséis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veintiuno: 21, veintidos: 22, veintidós: 22, veintitres: 23, veintitrés: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintiséis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100,
  doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
  mil: 1000,
};

const stripDiacritics = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const parseSpanishWordsToNumber = (text: string): number | null => {
  // Si ya es un número con punto o coma decimal, parsear directo
  const cleanForDirect = text.replace(/[€$\s]/g, '').replace(',', '.');
  const direct = parseFloat(cleanForDirect);
  if (!Number.isNaN(direct) && cleanForDirect.match(/^-?\d+(\.\d+)?$/)) return direct;

  // Pasarlo todo a tokens
  const tokens = stripDiacritics(text)
    .replace(/[€$.]/g, ' ')
    .replace(/,/g, ' coma ')
    .replace(/\bcon\b/g, ' coma ')   // "342 con cincuenta"
    .replace(/\by\b/g, ' ')          // "treinta y cinco"
    .replace(/\beuros?\b/g, '')
    .replace(/\bcentimos?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (tokens.length === 0) return null;

  // Separamos parte entera y decimal por la "coma"
  const idxComa = tokens.indexOf('coma');
  const enteros  = idxComa < 0 ? tokens : tokens.slice(0, idxComa);
  const decimals = idxComa < 0 ? [] : tokens.slice(idxComa + 1);

  const acumular = (toks: string[]): number | null => {
    if (toks.length === 0) return null;
    let total = 0;
    let current = 0;
    for (const tok of toks) {
      // Si es ya un número escrito (ej: "120"), sumamos directamente
      if (/^\d+$/.test(tok)) { current += parseInt(tok, 10); continue; }
      const v = UNIDADES[tok];
      if (v === undefined) {
        // Token desconocido: si todavía no hay nada, no es un número
        if (current === 0 && total === 0) return null;
        // Si ya tenemos algo, ignoramos el token raro
        continue;
      }
      if (v === 1000) {
        total += (current === 0 ? 1 : current) * 1000;
        current = 0;
      } else {
        current += v;
      }
    }
    return total + current;
  };

  const e = acumular(enteros);
  if (e === null) return null;

  if (decimals.length === 0) return e;
  // Para los decimales, sumamos como número entero y dividimos por la potencia
  const d = acumular(decimals);
  if (d === null) return e;
  // Si dijo "treinta" → 30 céntimos. Si dijo "tres" → 3 céntimos. Heurística:
  // hasta 99 lo tratamos como céntimos directos.
  const decFraction = d < 100 ? d / 100 : d / Math.pow(10, String(d).length);
  return Math.round((e + decFraction) * 100) / 100;
};

const postProcessNumeric = (text: string): string => {
  if (!text) return text;
  const n = parseSpanishWordsToNumber(text);
  return n === null ? text : String(n);
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useVoiceInput = ({
  onResult,
  lang = 'es-ES',
  maxDurationMs = 30000,
  numericMode = false,
  continuous = false,
}: UseVoiceInputOptions): UseVoiceInputReturn => {

  const [isRecording,    setIsRecording]    = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');

  // Refs para Groq Whisper (MediaRecorder)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const autoStopRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref para navegador (SpeechRecognition)
  const recognitionRef   = useRef<any>(null);
  // Acumulador para modo continuo
  const finalTranscriptRef = useRef<string>('');

  const provider = voiceProvider();

  // Aplica post-procesado según las opciones (modo numérico, etc.)
  const applyPostProcessing = useCallback((raw: string): string => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return trimmed;
    if (numericMode) return postProcessNumeric(trimmed);
    return trimmed;
  }, [numericMode]);

  // ── PARAR ────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);

    // Parar Groq Whisper
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    // Parar navegador
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ya parado */ }
      recognitionRef.current = null;
    }

    setIsRecording(false);
    setLiveTranscript('');
  }, []);

  // ── GRABAR CON GROQ WHISPER ──────────────────────────────────────────────
  const startGroqWhisper = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.warning('Necesitas dar permiso al micrófono.');
      return;
    }

    // Detectar mimeType compatible con el navegador
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4';

    const mr = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = mr;
    audioChunksRef.current   = [];

    mr.ondataavailable = e => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    mr.onstop = async () => {
      // Liberar micrófono
      stream.getTracks().forEach(t => t.stop());

      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      if (blob.size < 1000) {
        toast.warning('Audio demasiado corto, inténtalo de nuevo.');
        setIsRecording(false);
        return;
      }

      try {
        const text = await transcribeAudio(blob);
        const final = applyPostProcessing(text);
        if (final) onResult(final);
        else toast.warning('No se detectó voz. Inténtalo más cerca del micrófono.');
      } catch (e: any) {
        if (e.message === 'USE_BROWSER_FALLBACK') {
          // Groq no configurado — fallback silencioso al navegador
          toast.warning('Groq Whisper no está configurado. Usando reconocimiento del navegador.');
          startBrowser();
        } else {
          toast.error('Error al transcribir el audio. Comprueba la key de Groq en Ajustes.');
          console.error('[useVoiceInput] Groq Whisper error:', e);
        }
      } finally {
        setIsRecording(false);
      }
    };

    mr.start(250); // chunk cada 250ms
    setIsRecording(true);

    // Auto-stop tras maxDurationMs
    autoStopRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    }, maxDurationMs);

  }, [onResult, maxDurationMs, applyPostProcessing]); // eslint-disable-line

  // ── RECONOCIMIENTO DEL NAVEGADOR ─────────────────────────────────────────
  const startBrowser = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error('Tu navegador no soporta dictado por voz. Prueba Chrome o Safari.');
      return;
    }

    const recognition = new SR();
    recognitionRef.current = recognition;
    finalTranscriptRef.current = '';

    recognition.lang            = lang;
    recognition.interimResults  = true;
    // Modo numérico: NO continuo (un disparo, parar al silencio).
    // Modo notas: continuo (acumula varias frases).
    recognition.continuous      = continuous && !numericMode;
    // 3 alternativas para que el navegador "vote" la más probable. Para números
    // ayuda mucho — "veintidós" se confunde con "venti dos" si solo hay 1.
    recognition.maxAlternatives = 3;

    recognition.onstart = () => setIsRecording(true);

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        // Probamos todas las alternativas y elegimos la que mejor parsea como
        // número (en modo numérico). Si no es modo numérico, usamos la 1ª.
        const transcript = result[0].transcript as string;
        if (result.isFinal) {
          if (numericMode) {
            // En cada alternativa, intentar parsear como número y quedarse
            // con la primera que dé un número válido.
            let best = transcript;
            for (let alt = 0; alt < result.length; alt++) {
              const candidate = result[alt].transcript as string;
              if (parseSpanishWordsToNumber(candidate) !== null) {
                best = candidate;
                break;
              }
            }
            finalChunk += ' ' + best;
          } else {
            finalChunk += ' ' + transcript;
          }
        } else {
          interim += transcript;
        }
      }
      if (finalChunk) finalTranscriptRef.current += finalChunk;
      setLiveTranscript(finalTranscriptRef.current + ' ' + interim);
    };

    recognition.onerror = (e: any) => {
      console.warn('[useVoiceInput] SpeechRecognition error:', e.error);
      if (e.error === 'not-allowed') toast.error('Permiso de micrófono denegado.');
      else if (e.error === 'no-speech') toast.warning('No se detectó voz, inténtalo de nuevo.');
      else if (e.error === 'audio-capture') toast.error('No se detectó micrófono.');
      setIsRecording(false);
      setLiveTranscript('');
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      const raw = finalTranscriptRef.current.trim();
      const final = applyPostProcessing(raw);
      if (final) onResult(final);
      finalTranscriptRef.current = '';
      setIsRecording(false);
      setLiveTranscript('');
      recognitionRef.current = null;
    };

    recognition.start();
  }, [lang, onResult, numericMode, continuous, applyPostProcessing]);

  // ── TOGGLE PRINCIPAL ─────────────────────────────────────────────────────
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stop();
      return;
    }

    if (provider === 'groq') {
      startGroqWhisper();
    } else {
      startBrowser();
    }
  }, [isRecording, provider, stop, startGroqWhisper, startBrowser]);

  return {
    isRecording,
    liveTranscript,
    activeProvider: provider,
    toggleRecording,
  };
};

// Exportamos la utilidad para tests / uso aislado
export { parseSpanishWordsToNumber };
