import { useState, useEffect, useCallback, useRef } from 'react';
import { AppData, EmpresaId } from '../types';
import { fetchArumeData, saveArumeData } from '../services/supabase';

// ─── Claves localStorage (scoped por empresa) ───────────────────────────────
const cacheKey      = (eid: EmpresaId) => `arume_data_cache_${eid}`;
const cacheMetaKey  = (eid: EmpresaId) => `arume_meta_cache_${eid}`;
const saveQueueKey  = (eid: EmpresaId) => `arume_save_queue_${eid}`;

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
function readCache(eid: EmpresaId): { data: AppData; meta: CacheMeta } | null {
  try {
    const raw  = localStorage.getItem(cacheKey(eid));
    const meta = localStorage.getItem(cacheMetaKey(eid));
    if (!raw) return null;
    return { data: JSON.parse(raw), meta: meta ? JSON.parse(meta) : {} };
  } catch {
    return null;
  }
}

function writeCache(eid: EmpresaId, data: AppData, meta: CacheMeta) {
  try {
    localStorage.setItem(cacheKey(eid),     JSON.stringify(data));
    localStorage.setItem(cacheMetaKey(eid), JSON.stringify(meta));
  } catch {
    // localStorage lleno — no es crítico, la app sigue funcionando
  }
}

function clearCache(eid: EmpresaId) {
  try {
    localStorage.removeItem(cacheKey(eid));
    localStorage.removeItem(cacheMetaKey(eid));
    localStorage.removeItem(saveQueueKey(eid));
    localStorage.removeItem(`arume_shadow_backup_${eid}`);
  } catch {/* noop */}
}

// ─── Cola offline (persistida en localStorage) ────────────────────────────────
function readOfflineQueue(eid: EmpresaId): AppData | null {
  try {
    const raw = localStorage.getItem(saveQueueKey(eid));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeOfflineQueue(eid: EmpresaId, data: AppData) {
  try { localStorage.setItem(saveQueueKey(eid), JSON.stringify(data)); } catch {/* noop */}
}

function clearOfflineQueue(eid: EmpresaId) {
  try { localStorage.removeItem(saveQueueKey(eid)); } catch {/* noop */}
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook principal
// ─────────────────────────────────────────────────────────────────────────────
export function useArumeData(empresaId: EmpresaId = 'arume') {
  const empresaRef = useRef(empresaId);
  const cached     = useRef(readCache(empresaId));

  const [data,     setData]     = useState<AppData | null>(cached.current?.data ?? null);
  const [meta,     setMeta]     = useState<CacheMeta | null>(cached.current?.meta ?? null);
  const [loading,  setLoading]  = useState(!cached.current);
  const [syncing,  setSyncing]  = useState(false);
  const [isDirty,  setIsDirty]  = useState(() => readOfflineQueue(empresaId) !== null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const dataRef      = useRef<AppData | null>(cached.current?.data ?? null);
  const metaRef      = useRef<CacheMeta | null>(cached.current?.meta ?? null);
  const isSavingRef  = useRef(false);
  const pendingRef   = useRef<AppData | null>(null);

  // ── Cambio de empresa: resetear estado y recargar ─────────────────────────
  useEffect(() => {
    if (empresaRef.current === empresaId) return;
    empresaRef.current = empresaId;

    const newCache = readCache(empresaId);
    setData(newCache?.data ?? null);
    setMeta(newCache?.meta ?? null);
    dataRef.current = newCache?.data ?? null;
    metaRef.current = newCache?.meta ?? null;
    cached.current  = newCache;
    setIsDirty(readOfflineQueue(empresaId) !== null);
    setLastSaved(null);

    if (!newCache) setLoading(true);
  }, [empresaId]);

  // ── loadData ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const eid = empresaRef.current;
    const hasCache = dataRef.current !== null;
    if (hasCache) setSyncing(true);
    else          setLoading(true);

    try {
      const result = await fetchArumeData(eid);
      if (result?.data) {
        const remoteVersion = result.meta?.version ?? 0;
        const localVersion  = metaRef.current?.version ?? 0;

        if (!hasCache || remoteVersion > localVersion) {
          setData(result.data);
          dataRef.current = result.data;
          setMeta(result.meta ?? null);
          metaRef.current = result.meta ?? null;
          writeCache(eid, result.data, result.meta ?? {});
        }

        const offlineQueue = readOfflineQueue(eid);
        if (offlineQueue) {
          console.info(`[useArumeData:${eid}] Reconexión detectada — flusheando cola offline...`);
          saveData(offlineQueue).then(res => {
            if (res.ok) {
              clearOfflineQueue(eid);
              setIsDirty(false);
            }
          });
        }
      }
    } catch {
      console.warn(`[useArumeData:${eid}] Sin conexión a Supabase — usando caché local.`);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadData();
  }, [loadData, empresaId]);

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
    const eid = empresaRef.current;
    if (isSavingRef.current) {
      pendingRef.current = newData;
      return { ok: false };
    }
    pendingRef.current = null;
    isSavingRef.current = true;

    const cloned   = JSON.parse(JSON.stringify(newData)) as AppData;
    const prevData = dataRef.current;
    const prevMeta = metaRef.current;

    setData(cloned);
    dataRef.current = cloned;
    writeCache(eid, cloned, metaRef.current ?? {});

    try {
      const res = await saveArumeData(cloned, {
        empresaId: eid,
        lastKnownUpdatedAt: metaRef.current?.updated_at,
        lastKnownVersion:   metaRef.current?.version,
      });

      if (res.ok && res.newMeta) {
        setMeta(res.newMeta);
        metaRef.current = res.newMeta;
        writeCache(eid, cloned, res.newMeta);
        clearOfflineQueue(eid);
        setIsDirty(false);
        setLastSaved(new Date());
        return { ok: true };
      }

      if (res.conflict) {
        console.warn(`[useArumeData:${eid}] Conflicto de versiones — recargando del servidor...`);
        await loadData();
        return { ok: false, conflict: true };
      }

      writeOfflineQueue(eid, cloned);
      setIsDirty(true);
      return { ok: false, offline: true };

    } catch {
      setData(prevData);
      dataRef.current = prevData;
      writeCache(eid, prevData ?? ({} as AppData), prevMeta ?? {});
      writeOfflineQueue(eid, cloned);
      setIsDirty(true);
      return { ok: false, offline: true };

    } finally {
      isSavingRef.current = false;
      const pending = pendingRef.current;
      if (pending) { pendingRef.current = null; saveData(pending); }
    }
  }, [loadData]);

  // ── patchData ─────────────────────────────────────────────────────────────
  const patchData = useCallback(async (
    partial: Partial<AppData>
  ): Promise<SaveResult> => {
    const current = dataRef.current;
    if (!current) return { ok: false, error: 'Sin datos base' };
    const merged = JSON.parse(JSON.stringify({ ...current, ...partial })) as AppData;
    return saveData(merged);
  }, [saveData]);

  // ── resetCache ────────────────────────────────────────────────────────────
  const resetCache = useCallback(async () => {
    clearCache(empresaRef.current);
    setData(null);
    dataRef.current  = null;
    metaRef.current  = null;
    setMeta(null);
    setIsDirty(false);
    await loadData();
  }, [loadData]);

  // ── exportBackup ──────────────────────────────────────────────────────────
  const exportBackup = useCallback(() => {
    const current = dataRef.current;
    if (!current) return;
    const eid = empresaRef.current;
    const payload  = JSON.stringify({ version: 2, empresa: eid, data: current, exportedAt: new Date().toISOString() }, null, 2);
    const blob     = new Blob([payload], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href         = url;
    a.download     = `${eid}_Backup_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── getCacheSize ──────────────────────────────────────────────────────────
  const getCacheSize = useCallback((): string => {
    try {
      const raw = localStorage.getItem(cacheKey(empresaRef.current)) || '';
      const kb  = (new Blob([raw]).size / 1024).toFixed(1);
      return `${kb} KB`;
    } catch { return '—'; }
  }, []);

  return {
    data,
    loading,
    syncing,
    isDirty,
    lastSaved,
    saveData,
    patchData,
    reloadData: loadData,
    resetCache,
    exportBackup,
    setData,
    getCacheSize,
  };
}
