import { AppData, Albaran, FacturaExtended } from '../types';
import { Num, DateUtil } from './engine';

/* =======================================================
 * 🧠 1. EL DICCIONARIO DE ALIAS (Normalización Inteligente)
 * ======================================================= */
const ALIAS_KEY = 'arume_prov_aliases';
export const TOLERANCIA = 0.50; // Centralizamos la regla de tolerancia aquí

export const getProvAliases = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}'); } 
  catch { return {}; }
};

export const saveProvAlias = (rawScannedName: string, officialName: string) => {
  if (!rawScannedName || !officialName) return;
  const aliases = getProvAliases();
  const cleanRaw = basicNorm(rawScannedName);
  
  aliases[cleanRaw] = officialName.trim().toUpperCase();
  localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases));
};

export const basicNorm = (s?: string | null): string => {
  if (!s) return 'desconocido';
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(s\.?l\.?|s\.?a\.?|s\.?l\.?u\.?|s\.?c\.?p\.?|hijos de|hnos|hermanos|distribuciones|comercial|logistica)\b/gi, '')
    .replace(/[^a-z0-9]/g, '') 
    .trim();
};

export const getOfficialProvName = (rawName?: string) => {
  if (!rawName) return 'DESCONOCIDO';
  const cleanRaw = basicNorm(rawName);
  const aliases = getProvAliases();
  
  if (aliases[cleanRaw]) return aliases[cleanRaw];
  return rawName.trim().toUpperCase();
};

/* =======================================================
 * 🎯 2. CEREBRO 3-WAY MATCH (Detección Inteligente)
 * ======================================================= */
export const matchAlbaranesToFactura = (
  factura: FacturaExtended, 
  albaranes: Albaran[], 
  provNormalizado: string
) => {
  const fDate = factura?.date || DateUtil.today();
  const fTotal = Num.parse(factura?.total) || 0;
  
  let candidatos: Albaran[] = [];
  
  // 1. Si la IA extrajo explícitamente los IDs/números en la factura
  if (Array.isArray(factura.albaranIdsArr) && factura.albaranIdsArr.length > 0) {
      const setIds = new Set(factura.albaranIdsArr);
      candidatos = albaranes.filter(a => a && !a.invoiced && setIds.has(a.id));
  }
  
  // Fallback por si en versiones anteriores se guardaban los números de ticket y no los IDs
  if (candidatos.length === 0 && Array.isArray((factura as any).albaranRefs) && (factura as any).albaranRefs.length > 0) {
      const setRefs = new Set((factura as any).albaranRefs.map((x: any) => String(x).trim().toUpperCase()));
      candidatos = albaranes.filter(a => !a.invoiced && a.num && setRefs.has(String(a.num).trim().toUpperCase()));
  }
  
  // 2. Búsqueda semántica: Albaranes del mismo mes y proveedor
  if (candidatos.length === 0) {
    const mesDraft = typeof fDate === 'string' ? fDate.substring(0, 7) : '0000-00';
    candidatos = albaranes.filter(a => {
      const aDate = a?.date || '';
      return !a?.invoiced && basicNorm(a?.prov) === provNormalizado && (typeof aDate === 'string' && aDate.startsWith(mesDraft));
    });
  }

  const sumaAlbaranes = candidatos.reduce((acc, a) => acc + (Num.parse(a?.total) || 0), 0);
  const diff = Math.abs(sumaAlbaranes - Math.abs(fTotal));
  
  // Tolerancia dinámica: El mayor entre 0.50€ o el 0.5% del total de la factura
  const toleranciaPermitida = Math.max(TOLERANCIA, Math.abs(fTotal) * 0.005);
  const cuadraPerfecto = diff <= toleranciaPermitida && candidatos.length > 0;

  return { candidatos, sumaAlbaranes, diferencia: diff, cuadraPerfecto };
};

/* =======================================================
 * 🧠 3. MOTOR CENTRAL DE RECÁLCULO (LA MAGIA CONTABLE)
 * ======================================================= */
export function recomputeFacturaFromAlbaranes(
  data: AppData,
  facturaId: string,
  opts?: { strategy?: 'useAlbTotals' | 'sumLines' }
) {
  if (!data || !Array.isArray(data.facturas) || !Array.isArray(data.albaranes)) return;
  const idx = data.facturas.findIndex(f => f && f.id === facturaId);
  if (idx < 0) return;

  const fac = data.facturas[idx];
  const ids = Array.isArray(fac.albaranIdsArr) ? fac.albaranIdsArr : [];
  
  // Si la factura se quedó vacía
  if (ids.length === 0) { 
    fac.total = "0"; 
    fac.base = "0"; 
    fac.tax = "0"; 
    return; 
  }

  const strategy = opts?.strategy || 'useAlbTotals';
  const setIds = new Set(ids);
  const albs = data.albaranes.filter(a => a && setIds.has(a.id));

  let T = 0, B = 0, I = 0;

  for (const a of albs) {
    if (strategy === 'sumLines') {
      const lines = Array.isArray(a.items) ? a.items : [];
      const sumT = lines.reduce((acc, it: any) => acc + Num.parse(it.t ?? it.total ?? 0), 0);
      const sumB = lines.reduce((acc, it: any) => acc + Num.parse(it.base ?? 0), 0);
      const sumI = lines.reduce((acc, it: any) => acc + Num.parse(it.tax  ?? 0), 0);
      T += sumT; B += sumB; I += sumI;
    } else {
      const t = Num.parse(a.total);
      const baseAlb = Num.parse((a as any).base);
      const taxAlb  = Num.parse((a as any).taxes ?? (a as any).iva);
      T += t;
      if (baseAlb > 0 || taxAlb > 0) {
        B += baseAlb; I += taxAlb;
      } else {
        const bEst = Num.round2(t / 1.10);
        B += bEst; I += Num.round2(t - bEst);
      }
    }
  }

  // 🛡️ Asignamos el total calculado como String para mantener la compatibilidad del tipo FacturaExtended
  fac.total = String(Num.round2(T));
  fac.base  = String(Num.round2(B || (T > 0 ? Num.round2(T / 1.10) : 0)));
  fac.tax   = String(Num.round2(I || Num.round2(Num.parse(fac.total) - Num.parse(fac.base))));
}

/* =======================================================
 * 🔗 4. VINCULACIÓN SEGURA DE FACTURAS Y ALBARANES
 * ======================================================= */
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

export function linkAlbaranesToFactura(
  data: AppData, 
  facturaId: string, 
  albaranIds: string[], 
  opts?: { strategy?: 'useAlbTotals' | 'sumLines' }
) {
  if (!data.facturas || !data.albaranes) return;
  const fIdx = data.facturas.findIndex(f => f.id === facturaId);
  if (fIdx === -1) return;

  const fac = data.facturas[fIdx];
  const setCurrent = new Set(fac.albaranIdsArr || []);
  const setNew = new Set(albaranIds);

  // Marca invoiced y añade IDs (idempotente)
  data.albaranes.forEach(a => {
    if (a && setNew.has(a.id)) { 
      a.invoiced = true; 
      setCurrent.add(a.id); 
    }
  });

  fac.albaranIdsArr = Array.from(setCurrent);
  
  // 🔁 Recalcular canónicamente (evita deriva y quita los 0.00€)
  recomputeFacturaFromAlbaranes(data, facturaId, opts);
}

export function unlinkAlbaranFromFactura(
  data: AppData, 
  facturaId: string, 
  albaranId: string, 
  opts?: { strategy?: 'useAlbTotals' | 'sumLines' }
) {
  if (!data.facturas || !data.albaranes) return;
  const fIdx = data.facturas.findIndex(f => f.id === facturaId);
  if (fIdx === -1) return;

  const fac = data.facturas[fIdx];
  const curr = new Set(fac.albaranIdsArr || []);

  if (curr.has(albaranId)) {
    const aIdx = data.albaranes.findIndex(a => a.id === albaranId);
    if (aIdx !== -1) { 
      data.albaranes[aIdx].invoiced = false; 
    }
    
    curr.delete(albaranId);
    fac.albaranIdsArr = Array.from(curr);

    // Si la factura se queda sin albaranes y era "auto" o "manual-group", la borramos
    if (fac.albaranIdsArr.length === 0 && !fac.reconciled && (fac.source?.includes('auto') || fac.source?.includes('manual-group'))) {
      data.facturas.splice(fIdx, 1);
      return;
    }
    
    recomputeFacturaFromAlbaranes(data, facturaId, opts);
  }
}

export function moveAlbaranToFactura(
  data: AppData, 
  albaranId: string, 
  destFacturaId: string, 
  opts?: { strategy?: 'useAlbTotals' | 'sumLines' }
) {
  if (!data || !Array.isArray(data.facturas)) return;

  // Quita de donde esté
  for (const F of data.facturas) {
    if (Array.isArray(F?.albaranIdsArr) && F.albaranIdsArr.includes(albaranId)) {
      F.albaranIdsArr = F.albaranIdsArr.filter((id: string) => id !== albaranId);
      
      const a = data.albaranes?.find(x => x.id === albaranId);
      if (a) a.invoiced = false;

      if (F.albaranIdsArr.length === 0 && !F.reconciled && (F.source?.includes('auto') || F.source?.includes('manual-group'))) {
        const idx = data.facturas.findIndex(x => x.id === F.id);
        if (idx >= 0) data.facturas.splice(idx, 1);
      } else {
        recomputeFacturaFromAlbaranes(data, F.id, opts);
      }
    }
  }

  // Añade en destino
  linkAlbaranesToFactura(data, destFacturaId, [albaranId], opts);
}
