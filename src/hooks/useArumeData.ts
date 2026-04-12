import { useState, useEffect, useCallback, useRef } from 'react';
import { AppData } from '../types';
import { fetchArumeData, saveArumeData } from '../services/supabase';

// ─── Claves localStorage ──────────────────────────────────────────────────────
const CACHE_KEY       = 'arume_data_cache';
const CACHE_META_KEY  = 'arume_meta_cache';
const SAVE_QUEUE_KEY  = 'arume_save_queue'; // cola de saves offline persistida

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface CacheMeta {
  updated_at?: string;
  version?:    number;
}

interface SaveResult {
  ok:        boolean;
  conflict?: boolean;
  offline?:  boolean;
  error?:    string;
}

// ─── Helpers de caché ─────────────────────────────────────────────────────────
function readCache(): { data: AppData; meta: CacheMeta } | null {
  try {
    const raw  = localStorage.getItem(CACHE_KEY);
    const meta = localStorage.getItem(CACHE_META_KEY);
    if (!raw) return null;
    return { data: JSON.parse(raw), meta: meta ? JSON.parse(meta) : {} };
  } catch {
    return null;
  }
}

function writeCache(data: AppData, meta: CacheMeta) {
  try {
    localStorage.setItem(CACHE_KEY,      JSON.stringify(data));
    localStorage.setItem(CACHE_META_KEY, JSON.stringify(meta));
  } catch {
    // localStorage lleno — no es crítico, la app sigue funcionando
  }
}

function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_META_KEY);
    localStorage.removeItem(SAVE_QUEUE_KEY);
    localStorage.removeItem('arume_shadow_backup');
  } catch {/* noop */}
}

// ─── Cola offline (persistida en localStorage) ────────────────────────────────
// Si el usuario guarda offline, la cola se intenta vaciar al reconectar.
function readOfflineQueue(): AppData | null {
  try {
    const raw = localStorage.getItem(SAVE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeOfflineQueue(data: AppData) {
  try { localStorage.setItem(SAVE_QUEUE_KEY, JSON.stringify(data)); } catch {/* noop */}
}

function clearOfflineQueue() {
  try { localStorage.removeItem(SAVE_QUEUE_KEY); } catch {/* noop */}
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook principal
// ─────────────────────────────────────────────────────────────────────────────
export function useArumeData() {
  const cached       = useRef(readCache());

  const [data,     setData]     = useState<AppData | null>(cached.current?.data ?? null);
  const [meta,     setMeta]     = useState<CacheMeta | null>(cached.current?.meta ?? null);
  // Si hay caché, la UI aparece al instante sin spinner
  const [loading,  setLoading]  = useState(!cached.current);
  // Sincronización silenciosa en background
  const [syncing,  setSyncing]  = useState(false);
  // true si el último save no llegó a Supabase (offline o error de red)
  const [isDirty,  setIsDirty]  = useState(() => readOfflineQueue() !== null);
  // Cuándo fue el último save exitoso
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Refs internos
  const dataRef      = useRef<AppData | null>(cached.current?.data ?? null);
  const metaRef      = useRef<CacheMeta | null>(cached.current?.meta ?? null);
  const isSavingRef  = useRef(false);
  const pendingRef   = useRef<AppData | null>(null);

  // ── loadData ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const hasCache = dataRef.current !== null;
    if (hasCache) setSyncing(true);
    else          setLoading(true);

    try {
      const result = await fetchArumeData();
      if (result?.data) {
        // ✅ FIX: comparación estricta con > en lugar de >= para no sobreescribir
        // cambios locales más nuevos que aún no llegaron al servidor.
        const remoteVersion = result.meta?.version ?? 0;
        const localVersion  = metaRef.current?.version ?? 0;

        if (!hasCache || remoteVersion > localVersion) {
          setData(result.data);
          dataRef.current = result.data;
          setMeta(result.meta ?? null);
          metaRef.current = result.meta ?? null;
          writeCache(result.data, result.meta ?? {});
        }

        // Si teníamos datos sucios offline, intentamos flushear ahora
        const offlineQueue = readOfflineQueue();
        if (offlineQueue) {
          console.info('[useArumeData] Reconexión detectada — flusheando cola offline...');
          // No esperamos para no bloquear la UI
          saveData(offlineQueue).then(res => {
            if (res.ok) {
              clearOfflineQueue();
              setIsDirty(false);
            }
          });
        }
      }
    } catch {
      console.warn('[useArumeData] Sin conexión a Supabase — usando caché local.');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ↑ Deps vacías intencionadas: loadData es estable y no necesita meta en deps
  //   porque accedemos a metaRef (mutable) en lugar de la closure.

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Flush automático al reconectar ────────────────────────────────────────
  useEffect(() => {
    const onOnline = () => {
      console.info('[useArumeData] Conexión recuperada — recargando...');
      loadData();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [loadData]);

  // ── saveData ───────────────────────────────────────────────────────────────
  const saveData = useCallback(async (newData: AppData): Promise<SaveResult> => {
    // Semáforo: encola si ya hay un save en curso
    if (isSavingRef.current) {
      pendingRef.current = newData;
      return { ok: false };
    }
    pendingRef.current = null;
    isSavingRef.current = true;

    // Deep clone para que React detecte siempre el cambio
    const cloned   = JSON.parse(JSON.stringify(newData)) as AppData;
    const prevData = dataRef.current;
    const prevMeta = metaRef.current;

    // Actualización optimista — la UI responde al instante
    setData(cloned);
    dataRef.current = cloned;

    // Guardamos en caché local inmediatamente (funciona offline)
    writeCache(cloned, metaRef.current ?? {});

    try {
      const res = await saveArumeData(cloned, {
        lastKnownUpdatedAt: metaRef.current?.updated_at,
        lastKnownVersion:   metaRef.current?.version,
      });

      if (res.ok && res.newMeta) {
        setMeta(res.newMeta);
        metaRef.current = res.newMeta;
        writeCache(cloned, res.newMeta);
        clearOfflineQueue();
        setIsDirty(false);
        setLastSaved(new Date());
        return { ok: true };
      }

      if (res.conflict) {
        // Otro dispositivo guardó primero — recargamos del servidor
        console.warn('[useArumeData] Conflicto de versiones — recargando del servidor...');
        await loadData();
        return { ok: false, conflict: true };
      }

      // Fallo de red / Supabase caído — guardamos en cola offline
      writeOfflineQueue(cloned);
      setIsDirty(true);
      return { ok: false, offline: true };

    } catch {
      // Rollback visual + cola offline
      setData(prevData);
      dataRef.current = prevData;
      writeCache(prevData ?? ({} as AppData), prevMeta ?? {});
      writeOfflineQueue(cloned);
      setIsDirty(true);
      return { ok: false, offline: true };

    } finally {
      isSavingRef.current = false;
      // Flush del pending encola si llegó mientras guardábamos
      const pending = pendingRef.current;
      if (pending) { pendingRef.current = null; saveData(pending); }
    }
  }, [loadData]);

  // ── patchData — helper para actualizaciones parciales ─────────────────────
  // Uso: await patchData({ facturas: [...nuevasFacturas] })
  // Hace deep-merge con los datos actuales sin tener que leer data manualmente.
  const patchData = useCallback(async (
    partial: Partial<AppData>
  ): Promise<SaveResult> => {
    const current = dataRef.current;
    if (!current) return { ok: false, error: 'Sin datos base' };
    const merged = JSON.parse(JSON.stringify({ ...current, ...partial })) as AppData;
    return saveData(merged);
  }, [saveData]);

  // ── resetCache — limpia caché local y recarga del servidor ─────────────────
  // Útil cuando la app va lenta o tiene datos corruptos.
  const resetCache = useCallback(async () => {
    clearCache();
    setData(null);
    dataRef.current  = null;
    metaRef.current  = null;
    setMeta(null);
    setIsDirty(false);
    await loadData();
  }, [loadData]);

  // ── exportBackup — descarga el JSON completo como fichero ─────────────────
  const exportBackup = useCallback(() => {
    const current = dataRef.current;
    if (!current) return;
    const payload  = JSON.stringify({ version: 2, data: current, exportedAt: new Date().toISOString() }, null, 2);
    const blob     = new Blob([payload], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href         = url;
    a.download     = `Arume_Backup_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── getCacheSize — tamaño aproximado de la caché en KB ────────────────────
  const getCacheSize = useCallback((): string => {
    try {
      const raw = localStorage.getItem(CACHE_KEY) || '';
      const kb  = (new Blob([raw]).size / 1024).toFixed(1);
      return `${kb} KB`;
    } catch { return '—'; }
  }, []);

  return {
    // Estado principal
    data,
    loading,
    syncing,
    isDirty,       // true si hay cambios pendientes de sincronizar con Supabase
    lastSaved,     // Date | null — cuándo fue el último save exitoso

    // Acciones
    saveData,      // saveData(fullData) → SaveResult
    patchData,     // patchData({ facturas: [...] }) → SaveResult — merge parcial
    reloadData: loadData,
    resetCache,    // limpia localStorage y recarga del servidor
    exportBackup,  // descarga el JSON completo como fichero
    setData,       // escape hatch para updates locales sin guardar
    getCacheSize,  // "124.3 KB" — útil en SettingsModal
  };
}
