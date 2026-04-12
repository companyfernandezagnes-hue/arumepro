import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppData, EmailDraft } from '../types';

// SEGURO: Las credenciales vienen de variables de entorno, nunca del codigo fuente.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('CRITICO: Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el .env.');
}

// SINGLETON PARA EVITAR MULTIPLES INSTANCIAS
// NOTA: usamos <any> para que insert/upsert no exija los tipos Database generados.
// Si en el futuro se generan con `supabase gen types typescript`, cambiar a <Database>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseInstance: SupabaseClient<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient<any> = (() => {
  if (!supabaseInstance) {
    supabaseInstance = createClient<any>(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storageKey: 'arume-auth-token-v3',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return supabaseInstance;
})();

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
                                    await sleep(wait);
                    }
        }
}

async function withTimeout<T>(p: Promise<T>, ms = 12000): Promise<T> {
        return Promise.race([
                    p,
                    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Timeout Supabase')), ms)),
                ]) as T;
}

// Helper para mostrar errores sin bloquear el hilo con alert()
function notifyError(msg: string) {
        // Usa el sistema de toasts de la app si está disponible, sino console.warn
    const event = new CustomEvent('arume:toast', { detail: { message: msg, type: 'error' } });
        window.dispatchEvent(event);
        console.warn('[Arume]', msg);
}

const toNum = (v: any): number => {
        const n = parseFloat(String(v));
        return isNaN(n) ? 0 : n;
};

const normalizeAlbaran = (a: any) => ({
        ...a,
        total: toNum(a?.total),
        base: a?.base !== undefined ? toNum(a.base) : undefined,
        taxes: a?.taxes !== undefined ? toNum(a.taxes) : undefined,
});

const normalizeFactura = (f: any) => ({
        ...f,
        total: toNum(f?.total),
        base: f?.base !== undefined ? toNum(f.base) : undefined,
        tax: f?.tax !== undefined ? toNum(f.tax) : undefined,
});

const normalizeBankMovement = (b: any) => ({
        ...b,
        amount: toNum(b?.amount),
});

// BLINDAJE COMPLETO: Todos los campos de AppData inicializados correctamente
const enforceSchema = (d: any): AppData => {
        const safeData = d || {};
        return {
                    ...safeData,
                    config: safeData.config || {},
                    socios: Array.isArray(safeData.socios) ? safeData.socios : [],
                    facturas: Array.isArray(safeData.facturas) ? safeData.facturas.map(normalizeFactura) : [],
                    albaranes: Array.isArray(safeData.albaranes) ? safeData.albaranes.map(normalizeAlbaran) : [],
                                      banco: Array.isArray(safeData.banco) ? safeData.banco.map(normalizeBankMovement) : [],
            cierres: Array.isArray(safeData.cierres) ? safeData.cierres : [],
                    cierres_mensuales: Array.isArray(safeData.cierres_mensuales) ? safeData.cierres_mensuales : [],
                    gastos_fijos: Array.isArray(safeData.gastos_fijos) ? safeData.gastos_fijos : [],
                    activos: Array.isArray(safeData.activos) ? safeData.activos : [],
                    ventas_menu: Array.isArray(safeData.ventas_menu) ? safeData.ventas_menu : [],
                    platos: Array.isArray(safeData.platos) ? safeData.platos : [],
                    recetas: Array.isArray(safeData.recetas) ? safeData.recetas : [],
                    ingredientes: Array.isArray(safeData.ingredientes) ? safeData.ingredientes : [],
                    priceHistory: Array.isArray(safeData.priceHistory) ? safeData.priceHistory : [],
                    diario: Array.isArray(safeData.diario) ? safeData.diario : [],
                    kardex: Array.isArray(safeData.kardex) ? safeData.kardex : [],
                    proveedores: Array.isArray(safeData.proveedores) ? safeData.proveedores : [],
                    presupuestos: Array.isArray(safeData.presupuestos) ? safeData.presupuestos : [],
                    control_pagos: safeData.control_pagos && typeof safeData.control_pagos === 'object'
                        ? safeData.control_pagos
                                    : {},
        };
};

const unwrapData = (rawData: any) => {
        let cleanData = rawData;
        if (typeof cleanData === 'string') {
                    try { cleanData = JSON.parse(cleanData); } catch (e) { return enforceSchema({}); }
        }
        let iterations = 0;
        while (cleanData !== null && typeof cleanData === 'object' && 'data' in cleanData && !cleanData.banco && iterations < 5) {
                    cleanData = cleanData.data;
                    if (typeof cleanData === 'string') {
                                    try { cleanData = JSON.parse(cleanData); } catch (e) {}
                    }
                    iterations++;
        }
        return enforceSchema(cleanData);
};

export async function fetchArumeData(retries = 3): Promise<{ data: AppData | null; meta?: { updated_at?: string; version?: number } }> {
        try {
                    const exec = async () => {
                                    const { data, error } = await supabase
                                        .from('arume_data')
                                        .select('id, data, updated_at, version')
                                        .eq('id', 1)
                                        .single();
                                    if (error) throw error;
                                    const sanitizedData = unwrapData(data?.data);
                                    try { localStorage.setItem('arume_shadow_backup', JSON.stringify(sanitizedData)); } catch (e) {}
                                    return { data: sanitizedData, meta: { updated_at: data?.updated_at, version: data?.version } };
                    };
                    return await withRetries(() => withTimeout(exec()), { retries });
        } catch (error: any) {
                    try {
                                    const shadow = localStorage.getItem('arume_shadow_backup');
                                    if (shadow) return { data: unwrapData(JSON.parse(shadow)) };
                    } catch (e) {}
                    return { data: null };
        }
}

                                        export async function saveArumeData(
                                                data: AppData,
                                                opts?: { lastKnownUpdatedAt?: string; lastKnownVersion?: number; silent?: boolean; retries?: number }
                                            ): Promise<{ ok: boolean; conflict?: boolean; error?: string; newMeta?: { updated_at?: string; version?: number } }> {
                                                const { lastKnownUpdatedAt, lastKnownVersion, silent = false, retries = 3 } = (opts || {});
                                                try {
                                                            const cleanData = unwrapData(data);
                                                            const payload: AppData = { ...cleanData, lastSync: Date.now() };

                                                    try { localStorage.setItem('arume_shadow_backup', JSON.stringify(payload)); } catch (e) {}

                                                    // Deteccion de conflictos via version (evita un fetch extra si tenemos version)
                                                    if (lastKnownVersion !== undefined) {
                                                                    const { data: curr, error: e } = await supabase
                                                                        .from('arume_data')
                                                                        .select('updated_at, version')
                                                                        .eq('id', 1)
                                                                        .single();
                                                                    if (!e && curr) {
                                                                                        const remoteVersion = curr.version ?? 0;
                                                                                        if (remoteVersion > lastKnownVersion) {
                                                                                                                if (!silent) notifyError('Se detectaron cambios de otro usuario. Recargando datos...');
                                                                                                                return { ok: false, conflict: true };
                                                                                            }
                                                                    }
                                                    } else if (lastKnownUpdatedAt) {
                                                                    // Fallback: comparar por updated_at
                                                                const readMeta = async () => {
                                                                                    const { data: curr, error: e } = await supabase.from('arume_data').select('updated_at, version').eq('id', 1).single();
                                                                                    if (e) throw e;
                                                                                    return curr;
                                                                };
                                                                    const meta = await withRetries(() => withTimeout(readMeta()), { retries });
                                                                    if (meta?.updated_at && meta.updated_at !== lastKnownUpdatedAt) {
                                                                                        if (!silent) notifyError('Se detectaron cambios de otro usuario. Recargando datos...');
                                                                                        return { ok: false, conflict: true };
                                                                    }
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
                                                            if (!silent) notifyError('Problema de conexion al guardar. Los cambios estan en cache local.');
                                                            return { ok: false, error: error.message };
                                                }
                                        }

export async function fetchNewEmails(): Promise<EmailDraft[]> {
        try {
                    const exec = async () => {
                                    const { data, error } = await supabase.from('inbox_gmail').select('*').eq('status', 'new');
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
                    throw error;
        }
}

export async function markEmailAsParsed(emailId: string): Promise<boolean> {
        try {
                    const exec = async () => {
                                    const { error } = await supabase.from('inbox_gmail').update({ status: 'parsed' }).eq('id', emailId);
                                    if (error) throw error;
                                    return true;
                    };
                    return await withRetries(() => withTimeout(exec(), 5000));
        } catch (error: any) {
                    return false;
        }
}
