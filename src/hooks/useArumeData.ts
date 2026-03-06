import { useState, useEffect, useCallback } from 'react';
import { AppData } from '../types';
import { fetchArumeData, saveArumeData } from '../services/supabase';

export function useArumeData() {
  const [data, setData] = useState<AppData | null>(null);
  const [meta, setMeta] = useState<{ updated_at?: string; version?: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await fetchArumeData();
    if (result && result.data) {
      setData(result.data);
      setMeta(result.meta || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveData = useCallback(async (newData: AppData) => {
    setData(newData);
    const res = await saveArumeData(newData, {
      lastKnownUpdatedAt: meta?.updated_at,
      lastKnownVersion: meta?.version,
    });

    if (res.ok && res.newMeta) {
      setMeta(res.newMeta);
      return true;
    } else if (res.conflict) {
      await loadData();
      return false;
    }
    return false;
  }, [meta, loadData]);

  return { data, loading, saveData, reloadData: loadData, setData };
}
