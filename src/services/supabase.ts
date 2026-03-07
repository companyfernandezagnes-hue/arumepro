import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://awbgboucnbsuzojocbuy.supabase.co";
const SUPABASE_KEY = "sb_secret_NkfohnwdWUybssY1sBFZEg_h-CVLF7c";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// SOLO para desarrollo
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // @ts-ignore
  window.supabase = supabase;
}

// ================ Utilidades Robustas ==================
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

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

async function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
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

// ================== Lectura ============================

export async function fetchArumeData(retries = 3): Promise<{ data: AppData | null; meta?: { updated_at?: string; version?: number } }> {
  try {
    const exec = async () => {
      const { data, error } = await supabase
        .from('arume_data')
        .select('id, data, updated_at, version')
        .eq('id', 1)
        .single();
        
      if (error) throw error;
      
      // 🚀 EL FIX DE LA MATRIOSKA (Desenvolver los datos si están doblemente anidados)
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

// ================ Escritura con Concurrencia ===========

export async function saveArumeData(
  data: AppData,
  opts?: { lastKnownUpdatedAt?: string; lastKnownVersion?: number; silent?: boolean; retries?: number }
): Promise<{ ok: boolean; conflict?: boolean; error?: string; newMeta?: { updated_at?: string; version?: number } }> {
  const { lastKnownUpdatedAt, lastKnownVersion, silent = false, retries = 3 } = (opts || {});

  try {
    // 🚀 EL FIX DE LA MATRIOSKA (Evitar que se guarde doblemente anidado al subir un Backup)
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

    if (lastKnownUpdatedAt && meta?.updated_at && meta.updated_at !== lastKnownUpdatedAt) {
      if (!silent) alert('⚠️ Se detectaron cambios de otro usuario. Recarga la página.');
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
    if (!silent) alert("⚠️ Problema de conexión. No se ha guardado.");
    return { ok: false, error: error.message };
  }
}
