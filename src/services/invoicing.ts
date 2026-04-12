import { AppData, Albaran, FacturaExtended } from '../types';
import { Num, DateUtil } from './engine';

// ────────────────────────────────────────────────────────────
// ⚙️ CONFIGURACIÓN
// ────────────────────────────────────────────────────────────
export const TOLERANCIA = 0.50;

const ALIAS_KEY = 'arume_prov_aliases';

// ────────────────────────────────────────────────────────────
// 📖 DICCIONARIO DE ALIAS
// ────────────────────────────────────────────────────────────
export const getProvAliases = (): Record<string, string> => {
  try {
    const raw    = localStorage.getItem(ALIAS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch { return {}; }
};

export const saveProvAlias = (rawName: string, officialName: string): void => {
  if (!rawName || !officialName) return;
  const aliases = getProvAliases();
  aliases[basicNorm(rawName)] = String(officialName).trim().toUpperCase();
  try { localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases)); } catch {}
};

export const basicNorm = (s?: string | null): string => {
  if (!s || typeof s !== 'string') return 'desconocido';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(s\.?l\.?u?\.?|s\.?a\.?|s\.?c\.?p\.?|hijos\s+de|hnos?\.?|hermanos|distribuciones|distribuidora|comercial|logistica|logística)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim() || 'desconocido';
};

export const getOfficialProvName = (rawName?: string | null): string => {
  if (!rawName) return 'DESCONOCIDO';
  const key     = basicNorm(rawName);
  const aliases = getProvAliases();
  return aliases[key] ? aliases[key] : String(rawName).trim().toUpperCase();
};

// ────────────────────────────────────────────────────────────
// 🎯 3-WAY MATCH
// ────────────────────────────────────────────────────────────
export interface MatchResult {
  candidatos    : Albaran[];
  sumaAlbaranes : number;
  diferencia    : number;
  cuadraPerfecto: boolean;
}

export const matchAlbaranesToFactura = (
  factura        : FacturaExtended,
  albaranes      : Albaran[],
  provNormalizado: string,
): MatchResult => {
  if (!factura || !Array.isArray(albaranes)) {
    return { candidatos:[], sumaAlbaranes:0, diferencia:0, cuadraPerfecto:false };
  }

  const fDate  = factura.date || DateUtil.today();
  const fTotal = Math.abs(Num.parse(factura.total));
  let candidatos: Albaran[] = [];

  // Prioridad 1: IDs explícitos
  if (Array.isArray(factura.albaranIdsArr) && factura.albaranIdsArr.length > 0) {
    const setIds = new Set(factura.albaranIdsArr.map(String));
    candidatos = albaranes.filter(a => a && setIds.has(String(a.id)));
  }

  // Prioridad 2: Números legacy
  if (candidatos.length === 0) {
    const refs = (factura as any).albaranRefs;
    if (Array.isArray(refs) && refs.length > 0) {
      const setRefs = new Set(refs.map((x: unknown) => String(x).trim().toUpperCase()));
      candidatos = albaranes.filter(a =>
        !a?.invoiced && a?.num && setRefs.has(String(a.num).trim().toUpperCase())
      );
    }
  }

  // Prioridad 3: Búsqueda semántica
  if (candidatos.length === 0) {
    const mesDraft = typeof fDate === 'string' ? fDate.substring(0, 7) : '0000-00';
    candidatos = albaranes.filter(a => {
      if (!a || a.invoiced) return false;
      const aDate = String(a.date || '');
      return basicNorm(a.prov) === provNormalizado && aDate.startsWith(mesDraft);
    });
  }

  const sumaAlbaranes     = Num.round2(candidatos.reduce((acc, a) => acc + (Num.parse(a?.total) || 0), 0));
  const diferencia        = Math.abs(sumaAlbaranes - fTotal);
  const toleranciaPermitida = Math.max(TOLERANCIA, fTotal * 0.005);
  const cuadraPerfecto    = diferencia <= toleranciaPermitida && candidatos.length > 0;

  return { candidatos, sumaAlbaranes, diferencia, cuadraPerfecto };
};

// ────────────────────────────────────────────────────────────
// 🧠 MOTOR DE RECÁLCULO
// ────────────────────────────────────────────────────────────
export function recomputeFacturaFromAlbaranes(
  data     : AppData,
  facturaId: string,
  opts?    : { strategy?: 'useAlbTotals' | 'sumLines' },
): void {
  if (!data || !Array.isArray(data.facturas) || !Array.isArray(data.albaranes)) return;

  const idx = data.facturas.findIndex(f => f && String(f.id) === String(facturaId));
  if (idx < 0) return;

  const fac = data.facturas[idx];
  const ids = Array.isArray(fac.albaranIdsArr) ? fac.albaranIdsArr : [];

  if (ids.length === 0) {
    fac.total = '0'; fac.base = '0'; fac.tax = '0'; return;
  }

  const strategy = opts?.strategy ?? 'useAlbTotals';
  const setIds   = new Set(ids.map(String));
  const albs     = data.albaranes.filter(a => a && setIds.has(String(a.id)));

  let T = 0, B = 0, I = 0;

  for (const a of albs) {
    if (strategy === 'sumLines') {
      const lines = Array.isArray(a.items) ? a.items : [];
      T += lines.reduce((acc, it) => acc + Num.parse((it as any).t ?? (it as any).total ?? 0), 0);
      B += lines.reduce((acc, it) => acc + Num.parse((it as any).base  ?? 0), 0);
      I += lines.reduce((acc, it) => acc + Num.parse((it as any).tax   ?? 0), 0);
    } else {
      const t       = Num.parse(a.total);
      const baseAlb = Num.parse((a as any).base);
      const taxAlb  = Num.parse((a as any).taxes ?? (a as any).iva);
      T += t;
      if (baseAlb > 0 || taxAlb > 0) { B += baseAlb; I += taxAlb; }
      else { const bEst = Num.round2(t / 1.10); B += bEst; I += Num.round2(t - bEst); }
    }
  }

  fac.total = String(Num.round2(T));
  fac.base  = String(Num.round2(B > 0 ? B : (T > 0 ? Num.round2(T / 1.10) : 0)));
  fac.tax   = String(Num.round2(I > 0 ? I : Num.round2(Num.parse(fac.total) - Num.parse(fac.base))));
}

// ────────────────────────────────────────────────────────────
// 🔗 VINCULACIÓN
// ────────────────────────────────────────────────────────────
const uniq = <T,>(arr: T[]): T[] => Array.from(new Set(arr));

export function linkAlbaranesToFactura(
  data      : AppData,
  facturaId : string,
  albaranIds: string[],
  opts?     : { strategy?: 'useAlbTotals' | 'sumLines' },
): void {
  if (!data?.facturas || !data?.albaranes) return;
  const fIdx = data.facturas.findIndex(f => f && String(f.id) === String(facturaId));
  if (fIdx === -1) return;

  const fac    = data.facturas[fIdx];
  const setNew = new Set(albaranIds.map(String));

  data.albaranes.forEach(a => {
    if (a && setNew.has(String(a.id))) a.invoiced = true;
  });

  fac.albaranIdsArr = uniq([...(fac.albaranIdsArr || []), ...Array.from(setNew)]);
  recomputeFacturaFromAlbaranes(data, facturaId, opts);
}

export function unlinkAlbaranFromFactura(
  data      : AppData,
  facturaId : string,
  albaranId : string,
  opts?     : { strategy?: 'useAlbTotals' | 'sumLines' },
): void {
  if (!data?.facturas || !data?.albaranes) return;
  const fIdx = data.facturas.findIndex(f => f && String(f.id) === String(facturaId));
  if (fIdx === -1) return;

  const fac  = data.facturas[fIdx];
  const curr = new Set((fac.albaranIdsArr || []).map(String));
  if (!curr.has(String(albaranId))) return;

  const aIdx = data.albaranes.findIndex(a => a && String(a.id) === String(albaranId));
  if (aIdx !== -1) data.albaranes[aIdx].invoiced = false;

  curr.delete(String(albaranId));
  fac.albaranIdsArr = Array.from(curr);

  const isEmpty   = fac.albaranIdsArr.length === 0;
  const isAutoFac = !fac.reconciled && (
    String(fac.source || '').includes('auto') ||
    String(fac.source || '').includes('group')
  );

  if (isEmpty && isAutoFac) { data.facturas.splice(fIdx, 1); return; }
  recomputeFacturaFromAlbaranes(data, facturaId, opts);
}

export function moveAlbaranToFactura(
  data         : AppData,
  albaranId    : string,
  destFacturaId: string,
  opts?        : { strategy?: 'useAlbTotals' | 'sumLines' },
): void {
  if (!data?.facturas || !data?.albaranes) return;
  const srcFac = data.facturas.find(f =>
    f && Array.isArray(f.albaranIdsArr) && f.albaranIdsArr.map(String).includes(String(albaranId))
  );
  if (srcFac && String(srcFac.id) !== String(destFacturaId)) {
    unlinkAlbaranFromFactura(data, srcFac.id, albaranId, opts);
  }
  linkAlbaranesToFactura(data, destFacturaId, [albaranId], opts);
}
