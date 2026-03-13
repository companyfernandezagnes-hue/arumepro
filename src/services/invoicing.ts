import { AppData, Albaran, FacturaExtended } from '../types';
import { Num, DateUtil } from './engine';

/* =======================================================
 * 🧠 1. EL DICCIONARIO DE ALIAS (Normalización Inteligente)
 * ======================================================= */
const ALIAS_KEY = 'arume_prov_aliases';
export const TOLERANCIA = 0.50; // Centralizamos la regla de tolerancia aquí

// Recupera el diccionario de la memoria local
export const getProvAliases = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}'); } 
  catch { return {}; }
};

// Enseña a la app que un nombre raro equivale a un nombre oficial
export const saveProvAlias = (rawScannedName: string, officialName: string) => {
  if (!rawScannedName || !officialName) return;
  const aliases = getProvAliases();
  const cleanRaw = basicNorm(rawScannedName);
  
  aliases[cleanRaw] = officialName.trim().toUpperCase();
  localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases));
};

// La Escoba: Limpia mayúsculas, tildes y morralla societaria para poder comparar
export const basicNorm = (s?: string | null): string => {
  if (!s) return 'desconocido';
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    // Añadimos palabras comunes a ignorar para que el match sea más agresivo
    .replace(/\b(s\.?l\.?|s\.?a\.?|s\.?l\.?u\.?|s\.?c\.?p\.?|hijos de|hnos|hermanos|distribuciones|comercial|logistica)\b/gi, '')
    .replace(/[^a-z0-9]/g, '') 
    .trim();
};

// Traduce el nombre escaneado al nombre oficial usando el diccionario
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
  
  // 1. Si la IA extrajo explícitamente los números de albarán en la factura
  if (factura.albaranIdsArr && factura.albaranIdsArr.length > 0) {
     candidatos = albaranes.filter(a => !a.invoiced && a.num && factura.albaranIdsArr!.includes(a.num));
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
 * 🔗 3. VINCULACIÓN SEGURA DE FACTURAS Y ALBARANES
 * ======================================================= */

// Esta función se llama cuando la IA o tú confirmáis un 3-Way Match.
export const linkAlbaranesToFactura = (data: AppData, facturaId: string, albaranIds: string[]) => {
  if (!data.facturas || !data.albaranes) return;
  const fIdx = data.facturas.findIndex(f => f.id === facturaId);
  if (fIdx === -1) return;
  
  const F = data.facturas[fIdx] as FacturaExtended;
  let addedTotal = 0;
  let addedBase = 0;
  let addedTax = 0;

  const currentIds = new Set(F.albaranIdsArr || []);

  data.albaranes.forEach(a => {
    // Si el albarán está en la lista y aún no estaba vinculado a esta factura
    if (albaranIds.includes(a.id) && !currentIds.has(a.id)) {
      a.invoiced = true; // Lo bloqueamos
      currentIds.add(a.id);
      
      const t = Num.parse(a.total) || 0;
      const b = Num.parse((a as any).base) || Num.round2(t / 1.10);
      addedTotal += t;
      addedBase += b;
      addedTax += (t - b);
    }
  });

  // Actualizamos los totales de la factura
  F.total = Num.round2((Num.parse(F.total) || 0) + addedTotal);
  F.base = Num.round2((Num.parse(F.base) || 0) + addedBase);
  F.tax = Num.round2((Num.parse(F.tax) || 0) + addedTax);
  F.albaranIdsArr = Array.from(currentIds);
};

// Esta función se llama si te equivocas y quieres quitar un albarán de una factura
export const unlinkAlbaranFromFactura = (data: AppData, facturaId: string, albaranId: string) => {
  if (!data.facturas || !data.albaranes) return;
  const fIdx = data.facturas.findIndex(f => f.id === facturaId);
  if (fIdx === -1) return;
  
  const F = data.facturas[fIdx] as FacturaExtended;
  const currentIds = new Set(F.albaranIdsArr || []);

  if (currentIds.has(albaranId)) {
    const aIdx = data.albaranes.findIndex(a => a.id === albaranId);
    if (aIdx !== -1) {
      const A = data.albaranes[aIdx];
      A.invoiced = false; // Lo liberamos
      
      const t = Num.parse(A.total) || 0;
      const b = Num.parse((A as any).base) || Num.round2(t / 1.10);
      
      // Restamos del total de la factura
      F.total = Num.round2((Num.parse(F.total) || 0) - t);
      F.base = Num.round2((Num.parse(F.base) || 0) - b);
      F.tax = Num.round2((Num.parse(F.tax) || 0) - (t - b));
    }
    
    currentIds.delete(albaranId);
    F.albaranIdsArr = Array.from(currentIds);

    // Si la factura se queda vacía de albaranes y era un "Borrador/Automática", podemos destruirla
    if (F.albaranIdsArr.length === 0 && !F.reconciled && F.source?.includes('auto')) {
      data.facturas.splice(fIdx, 1);
    }
  }
};
