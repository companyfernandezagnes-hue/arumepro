import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppData, EmailDraft } from '../types';

// 1. CONEXIÓN (Variables de entorno)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://bgtelulbiaugawyrhvwt.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_jagYegyG8gGMijzpLEY9BQ_iWfL1MU4";

// 🛡️ SINGLETON PARA EVITAR MÚLTIPLES INSTANCIAS
let supabaseInstance: SupabaseClient | null = null;

export const supabase = (() => {
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storageKey: 'arume-auth-token-v3', 
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    });
  }
  return supabaseInstance;
})();

if (typeof window !== 'undefined') {
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
      console.warn(`🔄 Reintento Supabase ${attempt}/${retries} en ${Math.round(wait)}ms...`);
      await sleep(wait);
    }
  }
}

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

// 🚀 INNOVACIÓN 1: Saneamiento estricto del esquema de datos
const enforceSchema = (d: any): AppData => {
  const safeData = d || {};
  return {
    ...safeData,
    config: safeData.config || {},
    socios: Array.isArray(safeData.socios) ? safeData.socios : [],
    facturas: Array.isArray(safeData.facturas) ? safeData.facturas : [],
    albaranes: Array.isArray(safeData.albaranes) ? safeData.albaranes : [],
    banco: Array.isArray(safeData.banco) ? safeData.banco : [],
    cierres: Array.isArray(safeData.cierres) ? safeData.cierres : [],
    gastos_fijos: Array.isArray(safeData.gastos_fijos) ? safeData.gastos_fijos : [],
    ventas_menu: Array.isArray(safeData.ventas_menu) ? safeData.ventas_menu : [],
    platos: Array.isArray(safeData.platos) ? safeData.platos : [],
    recetas: Array.isArray(safeData.recetas) ? safeData.recetas : [],
    ingredientes: Array.isArray(safeData.ingredientes) ? safeData.ingredientes : [],
    priceHistory: Array.isArray(safeData.priceHistory) ? safeData.priceHistory : [],
  };
};

// 🚀 INNOVACIÓN 2: Desenvolvedor Recursivo Anti-Stringification
const unwrapData = (rawData: any) => {
  let cleanData = rawData;

  // 🚨 EL FIX VITAL: Si Supabase nos devuelve un texto con un JSON dentro, lo convertimos a Objeto
  if (typeof cleanData === 'string') {
    try {
      cleanData = JSON.parse(cleanData);
    } catch (e) {
      console.error("⚠️ Error crítico: El texto de la base de datos no es un JSON válido", e);
      return enforceSchema({}); // Si está corrupto, devolvemos un esquema en blanco para no crashear
    }
  }

  let iterations = 0;
  // Mientras esté envuelto en "data" (Efecto Matrioska), lo desenvolvemos
  while (cleanData && typeof cleanData === 'object' && 'data' in cleanData && !cleanData.banco && iterations < 5) {
    cleanData = cleanData.data;
    iterations++;
  }
  
  return enforceSchema(cleanData);
};

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
      
      // Aplicamos las herramientas de limpieza y saneamiento
      const sanitizedData = unwrapData(data?.data);
      
      // 💾 SHADOW BACKUP: Guardamos una copia local al descargar por si perdemos internet
      try { localStorage.setItem('arume_shadow_backup', JSON.stringify(sanitizedData)); } catch (e) {}

      return { 
        data: sanitizedData, 
        meta: { updated_at: data?.updated_at, version: data?.version } 
      };
    };

    return await withRetries(() => withTimeout(exec()), { retries });

  } catch (error: any) {
    console.error("❌ Error conectando a Supabase (fetch):", error?.message || error);
    
    // Si falla Supabase, intentamos rescatar el Shadow Backup
    try {
      const shadow = localStorage.getItem('arume_shadow_backup');
      if (shadow) {
        console.warn("🛡️ Rescatando datos desde el Shadow Backup local...");
        return { data: unwrapData(JSON.parse(shadow)) };
      }
    } catch (e) {}

    return { data: null };
  }
}

export async function saveArumeData(
  data: AppData,
  opts?: { lastKnownUpdatedAt?: string; lastKnownVersion?: number; silent?: boolean; retries?: number }
): Promise<{ ok: boolean; conflict?: boolean; error?: string; newMeta?: { updated_at?: string; version?: number } }> {
  const { lastKnownUpdatedAt, silent = false, retries = 3 } = (opts || {});

  try {
    // Limpiamos la matrioska y aplicamos el esquema estricto antes de subir a la nube
    const cleanData = unwrapData(data);
    const payload: AppData = { ...cleanData, lastSync: Date.now() };

    // 💾 SHADOW BACKUP: Guardamos en local justo antes de subir
    try { localStorage.setItem('arume_shadow_backup', JSON.stringify(payload)); } catch (e) {}

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
        // Supabase guarda el payload. Si la columna data es de texto, se stringificará automáticamente por la librería de Supabase
        .upsert({ id: 1, data: payload }, { onConflict: 'id' })
        .select('updated_at, version')
        .single();
      if (error) throw error;
      return up;
    };

    const up = await withRetries(() => withTimeout(execUpsert()), { retries });

    return { ok: true, newMeta: { updated_at: up?.updated_at, version: up?.version } };

  } catch (error: any) {
    if (!silent) alert("⚠️ Problema de conexión. No se ha podido guardar en la nube (pero tienes copia local).");
    return { ok: false, error: error.message };
  }
}

// ================== Funciones Secundarias: IMAP / Gmail =====================

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
