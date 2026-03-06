import { createClient } from '@supabase/supabase-js';
import { AppData } from '../types';

// ================= Credenciales =================
// (Fase 1: Mantenemos las tuyas directas para no romper la app hoy. En el futuro las ocultaremos en un .env)
const SUPABASE_URL = "https://awbgboucnbsuzojocbuy.supabase.co";
const SUPABASE_KEY = "sb_publishable_drOQ5PsFA8eox_aRTXNATQ_5kibM6ST";

// ================ Cliente ==============================
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ================ Utilidades Robustas (Motor Copilot) ==================
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// Reintentos inteligentes (Exponential backoff)
async function withRetries<T>(
  fn: () => Promise<T>,
  { retries = 3, baseMs = 700, maxMs = 3000 }: { retries?: number; baseMs?: number; maxMs?: number } = {}
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt > retries) throw err;
      const jitter = Math.random() * 200;
      const wait = Math.min(baseMs * Math.pow(2, attempt - 1) + jitter, maxMs);
      console.warn(`🔄 Reintento ${attempt}/${retries} en ${Math.round(wait)}ms...`, err?.message || err);
      await sleep(wait);
    }
  }
}

// Límite de tiempo para que la app no se congele
async function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms);
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Timeout: Supabase tardó demasiado')), ms)),
    ]) as T;
  } finally {
    clearTimeout(to);
  }
}

// ================== Lectura ============================

/**
 * 📥 OBTENER DATOS (con reintentos y timeout)
 */
export async function fetchArumeData(retries = 3): Promise<{ data: AppData | null; meta?: { updated_at?: string; version?: number } }> {
  try {
    const exec = async () => {
      const { data, error } = await supabase
        .from('arume_data')
        .select('id, data, updated_at, version')
        .eq('id', 1)
        .single();
        
      if (error) throw error;
      
      // Devolvemos los datos y la "marca de tiempo" (meta) para evitar pisadas luego
      return { 
        data: data?.data as AppData, 
        meta: { updated_at: data?.updated_at, version: data?.version } 
      };
    };

    return await withRetries(() => withTimeout(exec()), { retries });

  } catch (error: any) {
    console.error("❌ Error conectando a Supabase (fetch):", error?.message || error);
    return { data: null };
  }
}

// ================ Escritura con Concurrencia ===========

/**
 * 📤 GUARDAR DATOS (optimistic concurrency + reintentos)
 */
export async function saveArumeData(
  data: AppData,
  opts?: { lastKnownUpdatedAt?: string; lastKnownVersion?: number; silent?: boolean; retries?: number }
): Promise<{ ok: boolean; conflict?: boolean; error?: string; newMeta?: { updated_at?: string; version?: number } }> {
  const { lastKnownUpdatedAt, lastKnownVersion, silent = false, retries = 3 } = (opts || {});

  try {
    // Marca de tiempo local
    const payload: AppData = { ...data, lastSync: Date.now() };

    // 1) Estrategia optimista: Leemos si alguien ha guardado algo mientras nosotros editábamos
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

    // ¿Hubo pisada de datos?
    if (lastKnownUpdatedAt && meta?.updated_at && meta.updated_at !== lastKnownUpdatedAt) {
      const msg = '⚠️ Se detectaron cambios de otro usuario (o abriste la app en otra pestaña). Recarga la página para no sobrescribir datos.';
      if (!silent) alert(msg);
      return { ok: false, conflict: true, error: msg };
    }

    // 2) Guardado seguro atómico
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
    const msg = error?.message || 'Error guardando datos en la nube';
    console.error("❌ Error guardando datos en Supabase:", msg);
    if (!silent && typeof window !== 'undefined') {
      alert("⚠️ Problema de conexión. Tus últimos cambios no se han guardado. Revisa tu internet.");
    }
    return { ok: false, error: msg };
  }
}
