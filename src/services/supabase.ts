import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppData, EmailDraft } from '../types';

// 1. NUEVA CONEXIÓN: Apuntando a las variables de entorno (.env)
// ⚠️ Asegúrate de tener estas variables en tu archivo .env:
// VITE_SUPABASE_URL=https://bgtelulbiaugawyrhvwt.supabase.co
// VITE_SUPABASE_ANON_KEY=sb_publishable_jagYegyG8gGMijzpLEY9BQ_iWfL1MU4
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://bgtelulbiaugawyrhvwt.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_jagYegyG8gGMijzpLEY9BQ_iWfL1MU4";

// 🛡️ FIX: PATRÓN SINGLETON PARA EVITAR MÚLTIPLES INSTANCIAS (Evita pantallazos azules)
let supabaseInstance: SupabaseClient | null = null;

export const supabase = (() => {
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storageKey: 'arume-auth-token-v3', // Clave única actualizada para la nueva DB
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    });
  }
  return supabaseInstance;
})();

// 2. SOLO para desarrollo (Para poder hacer pruebas desde la consola si hace falta)
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.supabase = supabase;
}

// ================ Utilidades Robustas ==================
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// Sistema de reintentos: Si el internet falla, lo vuelve a intentar solo
async function withRetries<T>(fn: () => Promise<T>, { retries = 3, baseMs = 700, maxMs = 3000 } = {}): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt > retries) throw err;
      const wait = Math.min(baseMs * Math.pow(2, attempt - 1) + Math.random() * 200, maxMs);
      console.warn(`🔄 Reintento ${attempt}/${retries} en ${Math.round(wait)}ms...`, err?.message || err);
      await sleep(wait);
    }
  }
}

// 🛡️ Evita que la app se quede colgada esperando. Aumentado a 15 segundos para mayor seguridad.
async function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms);
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Timeout Supabase')), ms)),
    ]) as T;
  } finally {
    clearTimeout(to);
  }
}

// ================== Funciones Core: Arume Data ============================

export async function fetchArumeData(retries = 3): Promise<{ data: AppData | null; meta?: { updated_at?: string; version?: number } }> {
  try {
    const exec = async () => {
      const { data, error } = await supabase
        .from('arume_data')
        .select('id, data, updated_at, version')
        .eq('id', 1)
        .single();
        
      if (error) throw error;
      
      // 🚀 EL FIX DE LA MATRIOSKA (Desenvolver los datos si están doblemente anidados al cargar backups)
      let rawData = data?.data;
      if (rawData && typeof rawData === 'object' && 'data' in rawData && !rawData.banco) {
         console.warn("⚠️ Efecto Matrioska detectado al LEER. Desenvolviendo JSON...");
         rawData = rawData.data; 
      }
      
      return { 
        data: rawData as AppData, 
        meta: { updated_at: data?.updated_at, version: data?.version } 
      };
    };

    return await withRetries(() => withTimeout(exec()), { retries });

  } catch (error: any) {
    console.error("❌ Error conectando a Supabase (fetch):", error?.message || error);
    return { data: null };
  }
}

export async function saveArumeData(
  data: AppData,
  opts?: { lastKnownUpdatedAt?: string; lastKnownVersion?: number; silent?: boolean; retries?: number }
): Promise<{ ok: boolean; conflict?: boolean; error?: string; newMeta?: { updated_at?: string; version?: number } }> {
  const { lastKnownUpdatedAt, lastKnownVersion, silent = false, retries = 3 } = (opts || {});

  try {
    // 🚀 EL FIX DE LA MATRIOSKA AL GUARDAR
    let cleanData = data;
    if (cleanData && typeof cleanData === 'object' && 'data' in cleanData && !(cleanData as any).banco) {
       console.warn("⚠️ Efecto Matrioska detectado al GUARDAR. Limpiando JSON...");
       cleanData = (cleanData as any).data;
    }

    const payload: AppData = { ...cleanData, lastSync: Date.now() };

    const readMeta = async () => {
      const { data: curr, error: e } = await supabase
        .from('arume_data')
        .select('updated_at, version')
        .eq('id', 1)
        .single();
      if (e) throw e;
      return curr;
    };

    const meta = await withRetries(() => withTimeout(readMeta()), { retries });

    // Control de concurrencia optimista
    if (lastKnownUpdatedAt && meta?.updated_at && meta.updated_at !== lastKnownUpdatedAt) {
      if (!silent) alert('⚠️ Se detectaron cambios de otro usuario. Recarga la página para no sobreescribir datos.');
      return { ok: false, conflict: true };
    }

    const execUpsert = async () => {
      const { data: up, error } = await supabase
        .from('arume_data')
        .upsert({ id: 1, data: payload }, { onConflict: 'id' })
        .select('updated_at, version')
        .single();
      if (error) throw error;
      return up;
    };

    const up = await withRetries(() => withTimeout(execUpsert()), { retries });

    return { ok: true, newMeta: { updated_at: up?.updated_at, version: up?.version } };

  } catch (error: any) {
    if (!silent) alert("⚠️ Problema de conexión. No se ha podido guardar en la nube.");
    return { ok: false, error: error.message };
  }
}

// ================== Funciones Secundarias: IMAP / Gmail =====================

/**
 * Recupera los correos nuevos con adjuntos de la tabla inbox_gmail
 */
export async function fetchNewEmails(): Promise<EmailDraft[]> {
  try {
    const exec = async () => {
      const { data, error } = await supabase
        .from('inbox_gmail')
        .select('*')
        .eq('status', 'new');
      
      if (error) throw error;
      
      if (!data) return [];

      return data.map((fila: any) => ({
        id: fila.id, 
        from: fila.remitente, 
        subject: fila.asunto, 
        date: fila.fecha ? fila.fecha.slice(0, 10) : new Date().toISOString().split('T')[0],
        hasAttachment: true, 
        status: 'new' as const, 
        fileBase64: fila.archivo_base64, 
        fileName: fila.archivo_nombre
      }));
    };

    return await withRetries(() => withTimeout(exec(), 10000));
  } catch (error: any) {
    console.error("❌ Error leyendo correos de Supabase:", error);
    throw error;
  }
}

/**
 * Marca un correo como procesado para que no vuelva a aparecer
 */
export async function markEmailAsParsed(emailId: string): Promise<boolean> {
  try {
    const exec = async () => {
      const { error } = await supabase
        .from('inbox_gmail')
        .update({ status: 'parsed' })
        .eq('id', emailId);
      
      if (error) throw error;
      return true;
    };

    return await withRetries(() => withTimeout(exec(), 5000));
  } catch (error: any) {
    console.error(`❌ Error marcando correo ${emailId} como parsed:`, error);
    return false;
  }
}
