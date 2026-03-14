import { useState, useEffect, useCallback, useRef } from 'react';
import { AppData } from '../types';
import { fetchArumeData, saveArumeData } from '../services/supabase';

export function useArumeData() {
  const [data, setData] = useState<AppData | null>(null);
  const [meta, setMeta] = useState<{ updated_at?: string; version?: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // 🚀 INNOVACIÓN: Semáforo para evitar colisiones si haces muchos swipes rápido
  const isSavingRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchArumeData();
      if (result && result.data) {
        setData(result.data);
        setMeta(result.meta || null);
      }
    } catch (error) {
      console.error("Error al cargar los datos desde Supabase:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveData = useCallback(async (newData: AppData) => {
    // Si ya estamos guardando, esperamos o rechazamos para no corromper la BD
    if (isSavingRef.current) {
      console.warn("⏳ Guardado en curso, por favor espera un instante...");
      return false; 
    }
    
    isSavingRef.current = true;

    // 1. CLON PROFUNDO: Fix crítico para que React detecte SIEMPRE el cambio y redibuje las tablas
    const clonedData = JSON.parse(JSON.stringify(newData));
    
    // 2. PARACAÍDAS: Guardamos el estado anterior por si falla la conexión
    const previousData = data; 

    // 3. ACTUALIZACIÓN OPTIMISTA: Reflejamos el cambio visual al instante
    setData(clonedData);

    try {
      const res = await saveArumeData(clonedData, {
        lastKnownUpdatedAt: meta?.updated_at,
        lastKnownVersion: meta?.version,
      });

      if (res.ok && res.newMeta) {
        setMeta(res.newMeta); // Actualizamos la versión correctamente
        return true;
      } else if (res.conflict) {
        console.warn("⚠️ Conflicto de versiones detectado. Recargando datos del servidor...");
        await loadData(); // Alguien más editó desde otro PC, recargamos
        return false;
      }
      
      // Si falla por un error genérico (ej. caída de red)
      setData(previousData); // Rollback silencioso
      return false;
      
    } catch (error) {
      console.error("Error crítico al intentar guardar:", error);
      setData(previousData); // Rollback para no corromper la vista
      return false;
    } finally {
      isSavingRef.current = false; // Levantamos el semáforo
    }
  }, [meta, data, loadData]);

  return { data, loading, saveData, reloadData: loadData, setData };
}
