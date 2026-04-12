/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  src/hooks/useVoiceInput.ts                                      ║
 * ║                                                                  ║
 * ║  Hook centralizado de voz para toda la app.                      ║
 * ║  Lee voice_provider del localStorage y decide automáticamente:   ║
 * ║    - 'groq'    → graba audio y usa Groq Whisper (pro)            ║
 * ║    - 'browser' → usa webkitSpeechRecognition (nativo, gratis)    ║
 * ║                                                                  ║
 * ║  Uso:                                                            ║
 * ║    const { isRecording, liveTranscript, toggleRecording }        ║
 * ║      = useVoiceInput({ onResult: (text) => handleText(text) });  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { useState, useRef, useCallback } from 'react';
import { transcribeAudio, voiceProvider } from '../services/aiProviders';
import { toast } from './useToast';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface UseVoiceInputOptions {
  /** Callback que recibe el texto final transcrito */
  onResult: (text: string) => void;
  /** Idioma para el reconocimiento del navegador (default: 'es-ES') */
  lang?: string;
  /** Tiempo máximo de grabación en ms para Groq Whisper (default: 30000) */
  maxDurationMs?: number;
}

interface UseVoiceInputReturn {
  isRecording: boolean;
  liveTranscript: string;       // Solo se rellena en modo navegador (interimResults)
  activeProvider: 'browser' | 'groq';
  toggleRecording: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useVoiceInput = ({
  onResult,
  lang = 'es-ES',
  maxDurationMs = 30000,
}: UseVoiceInputOptions): UseVoiceInputReturn => {

  const [isRecording,    setIsRecording]    = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');

  // Refs para Groq Whisper (MediaRecorder)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const autoStopRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref para navegador (SpeechRecognition)
  const recognitionRef   = useRef<any>(null);

  const provider = voiceProvider();

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
        if (text.trim()) onResult(text.trim());
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

  }, [onResult, maxDurationMs]); // eslint-disable-line

  // ── RECONOCIMIENTO DEL NAVEGADOR ─────────────────────────────────────────
  const startBrowser = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error('Tu navegador no soporta dictado por voz. Prueba Chrome o Safari.');
      return;
    }

    const recognition = new SR();
    recognitionRef.current = recognition;

    recognition.lang            = lang;
    recognition.interimResults  = true;
    recognition.continuous      = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsRecording(true);

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as any[])
        .map((r: any) => r[0].transcript)
        .join('');
      setLiveTranscript(transcript);

      if (event.results[0].isFinal) {
        onResult(transcript.trim());
        setLiveTranscript('');
        setIsRecording(false);
        recognitionRef.current = null;
      }
    };

    recognition.onerror = (e: any) => {
      console.warn('[useVoiceInput] SpeechRecognition error:', e.error);
      if (e.error === 'not-allowed') toast.error('Permiso de micrófono denegado.');
      else if (e.error === 'no-speech') toast.warning('No se detectó voz, inténtalo de nuevo.');
      setIsRecording(false);
      setLiveTranscript('');
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsRecording(false);
      setLiveTranscript('');
      recognitionRef.current = null;
    };

    recognition.start();
  }, [lang, onResult]);

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
