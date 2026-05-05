// ==========================================
// 🧮 invoiceMatcher.ts — Cruce factura ↔ albaranes por TOTAL (subset-sum)
//
// Idea: la factura mensual de un proveedor suele cubrir N albaranes. Para
// detectar el match no usamos el texto de las líneas (proveedores como Makro
// no detallan productos en la factura), sólo TOTALES.
//
// El cruce es matemática pura: ¿existe un subconjunto de tus albaranes de ese
// proveedor cuyo total sume el total de la factura? Si sí → match seguro.
//
// El algoritmo es subset-sum con programación dinámica en céntimos. Para los
// volúmenes típicos de un negocio (10-30 albaranes / proveedor / mes) es
// instantáneo. Para volúmenes mayores hace falta poda — pero no es el caso aquí.
// ==========================================

import { Albaran } from '../types';
import { Num } from './engine';
import { getProvCanonical } from './provAlias';

// ── Normalización y similitud de proveedor ─────────────────────────────────

const CORPORACIONES_ES = ['sl', 'sa', 'slu', 'sll', 'sc', 'scp', 'cb', 'srl', 'sociedad', 'limitada'];
const STOP_WORDS_PROV = new Set([
  'la', 'el', 'los', 'las', 'del', 'de', 'en', 'y', 'con', 'por', 'para',
  'al', 'a', 'un', 'una',
  'distribuciones', 'distribuidora', 'comercial', 'comercializadora',
  'logistica', 'express', 'iberica', 'iberia', 'espana', 'global',
  'hnos', 'hermanos',
]);

const stripDiacritics = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Tokeniza un nombre de proveedor: minúsculas, sin tildes, sin sufijos legales,
 * sin stop-words, sólo palabras de >2 letras alfanuméricas.
 */
const extractProvTokens = (text?: string | null): string[] => {
  if (!text) return [];
  const clean = stripDiacritics(String(text).toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.split(' ')
    .filter(w => w.length > 2)
    .filter(w => !CORPORACIONES_ES.includes(w))
    .filter(w => !STOP_WORDS_PROV.has(w));
};

/**
 * Similitud entre 0 y 100 entre dos nombres de proveedor.
 * Usa Jaccard sobre tokens normalizados, con bonificación si comparten 2+
 * tokens (caso típico "Cerdà Obrador SL" vs "Llorenç Cerdà Obrador").
 */
export const advancedProvSimilarity = (a?: string | null, b?: string | null): number => {
  const ta = extractProvTokens(a);
  const tb = extractProvTokens(b);
  if (!ta.length || !tb.length) return 0;

  const setA = new Set(ta);
  const setB = new Set(tb);
  const intersect = ta.filter(x => setB.has(x));
  const union = new Set([...ta, ...tb]);

  // Bonus: 2+ tokens significativos compartidos → match seguro
  if (intersect.length >= 2) return 100;

  if (union.size === 0) return 0;
  return Math.round((intersect.length / union.size) * 100);
};

// ── Subset-sum por programación dinámica en céntimos ──────────────────────

/**
 * Total seguro de un albarán (en €). Si .total no está, suma las líneas.
 */
const albaranSafeTotal = (a: Albaran): number => {
  const t = Num.parse((a as any).total);
  if (t > 0) return t;
  if (Array.isArray(a.items)) {
    return a.items.reduce((s, it: any) => s + Num.parse(it?.t ?? it?.total ?? 0), 0);
  }
  return 0;
};

/**
 * Encuentra un subconjunto de albaranes cuyo total sume `target` ± `tolerance`.
 *
 * Devuelve los IDs del subconjunto encontrado, o null si no hay coincidencia.
 *
 * - Trabaja en céntimos para evitar errores de coma flotante.
 * - DP "subset-sum" clásico O(N × T) donde N = nº albaranes, T = total en céntimos.
 * - Recortado a 30 albaranes max y target hasta 200.000€ (suficiente para un
 *   restaurante; si excedes, devuelve null y caemos al match aproximado).
 */
export const findSubsetSum = (
  albaranes: Albaran[],
  target: number,
  tolerance = 1.00,
): string[] | null => {
  const N = albaranes.length;
  if (N === 0 || target <= 0) return null;
  if (N > 30) {
    // Demasiados albaranes para subset-sum exacto. Limitamos a los 30 más
    // recientes (los que más probablemente cubre la factura).
    const recientes = [...albaranes].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 30);
    return findSubsetSum(recientes, target, tolerance);
  }

  const targetCents = Math.round(target * 100);
  const tolCents = Math.round(tolerance * 100);
  if (targetCents > 200_000_00) return null; // 200k€ — sanity guard

  const valuesCents: number[] = albaranes.map(a => Math.round(Math.abs(albaranSafeTotal(a)) * 100));

  // dp[s] = índice del último albarán usado, o -1 si todavía no alcanzable
  // Usamos una Map para que sea sparse y no malgastemos memoria.
  // dp.get(s) = { from: dp[s previo], idx: índice del último albarán añadido }
  const dp = new Map<number, { from: number; idx: number }>();
  dp.set(0, { from: -1, idx: -1 });

  let bestSum = -1;
  let bestDiff = Infinity;

  for (let i = 0; i < N; i++) {
    const v = valuesCents[i];
    if (v <= 0) continue;
    // Snapshot para no usar el mismo albarán dos veces en la misma iteración
    const snapshot = Array.from(dp.entries());
    for (const [s, _] of snapshot) {
      const ns = s + v;
      if (ns > targetCents + tolCents) continue;
      if (!dp.has(ns)) {
        dp.set(ns, { from: s, idx: i });
        const diff = Math.abs(ns - targetCents);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestSum = ns;
          if (diff === 0) break; // exact hit
        }
      }
    }
    if (bestDiff === 0) break;
  }

  if (bestSum < 0 || bestDiff > tolCents) return null;

  // Reconstruir la combinación recorriendo dp hacia atrás
  const usedIdx: number[] = [];
  let cur = bestSum;
  while (cur > 0) {
    const node = dp.get(cur);
    if (!node) break;
    usedIdx.push(node.idx);
    cur = node.from;
  }
  return usedIdx.map(i => albaranes[i].id);
};

// ── API pública: smartMatchInvoiceToAlbaranes ─────────────────────────────

export interface SmartMatchInput {
  proveedor: string;
  total: number;
  fecha: string;
  num_factura?: string;
}

export interface SmartMatchResult {
  emailProveedor: string;
  emailTotal: number;
  emailDate: string;
  emailNum: string;
  matchedAlbaranIds: string[];
  matchedTotal: number;          // suma de los albaranes vinculados
  albaranesConsiderados: number; // cuántos albaranes del proveedor se evaluaron
  diferencia: number;            // emailTotal - matchedTotal (puede ser positivo o negativo)
  confidence: 'alta' | 'media' | 'baja' | 'nula' | 'sin_proveedor';
  errorMsg: string;
  matchType: 'num_factura' | 'subset_sum' | 'todos_albaranes' | 'aproximado' | 'sin_match';
}

/**
 * Cruce inteligente: factura del email ↔ albaranes pendientes del mismo proveedor.
 *
 * Fases:
 *   1. Match por número de factura (si la factura referencia el albarán).
 *   2. Filtro por proveedor (similitud >= 60% + memoria de alias).
 *   3. Subset-sum exacto: ¿hay combinación de albaranes que cuadre con el total?
 *   4. Si toda la suma del proveedor cuadra → todos los albaranes.
 *   5. Match aproximado (diferencia < 5%) → confianza media, requiere revisión humana.
 */
export const smartMatchInvoiceToAlbaranes = (
  input: SmartMatchInput,
  albaranesPool: Albaran[],
): SmartMatchResult => {
  const baseResult: Omit<SmartMatchResult, 'matchedAlbaranIds' | 'matchedTotal' | 'albaranesConsiderados' | 'diferencia' | 'confidence' | 'errorMsg' | 'matchType'> = {
    emailProveedor: input.proveedor || '',
    emailTotal: input.total,
    emailDate: input.fecha,
    emailNum: input.num_factura || '',
  };

  // FASE 1: match por número de factura (raro pero posible)
  if (input.num_factura && input.num_factura !== 'S/N') {
    const numNorm = String(input.num_factura).replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (numNorm.length >= 4) {
      const direct = albaranesPool.find(a => {
        const albNum = String(a.num || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        return albNum.length >= 4 && (albNum.includes(numNorm) || numNorm.includes(albNum));
      });
      if (direct) {
        const total = Math.abs(albaranSafeTotal(direct));
        return {
          ...baseResult,
          matchedAlbaranIds: [direct.id],
          matchedTotal: total,
          albaranesConsiderados: 1,
          diferencia: Num.round2(input.total - total),
          confidence: Math.abs(input.total - total) <= 1.00 ? 'alta' : 'media',
          errorMsg: '',
          matchType: 'num_factura',
        };
      }
    }
  }

  // FASE 2: filtro por proveedor (con memoria de alias)
  const canonicalEmail = getProvCanonical(input.proveedor);
  const filtered = albaranesPool.filter(a => {
    const albProv = getProvCanonical(String(a.prov || ''));
    return advancedProvSimilarity(albProv, canonicalEmail) >= 60;
  });

  if (filtered.length === 0) {
    return {
      ...baseResult,
      matchedAlbaranIds: [],
      matchedTotal: 0,
      albaranesConsiderados: 0,
      diferencia: input.total,
      confidence: 'sin_proveedor',
      errorMsg: `No tienes albaranes pendientes de "${input.proveedor}" para cruzar.`,
      matchType: 'sin_match',
    };
  }

  const sumaTotal = filtered.reduce((acc, a) => acc + Math.abs(albaranSafeTotal(a)), 0);

  // FASE 3: subset-sum exacto (tolerancia 2€ por redondeos del proveedor)
  const matchedIds = findSubsetSum(filtered, input.total, 2.00);
  if (matchedIds && matchedIds.length > 0) {
    const matchedTotal = filtered
      .filter(a => matchedIds.includes(a.id))
      .reduce((acc, a) => acc + Math.abs(albaranSafeTotal(a)), 0);
    return {
      ...baseResult,
      matchedAlbaranIds: matchedIds,
      matchedTotal: Num.round2(matchedTotal),
      albaranesConsiderados: filtered.length,
      diferencia: Num.round2(input.total - matchedTotal),
      confidence: 'alta',
      errorMsg: '',
      matchType: matchedIds.length === filtered.length ? 'todos_albaranes' : 'subset_sum',
    };
  }

  // FASE 4: match aproximado (diferencia < 5%) — requiere revisión humana
  const diff = Num.round2(input.total - sumaTotal);
  const isClose = Math.abs(diff) <= input.total * 0.05;
  return {
    ...baseResult,
    matchedAlbaranIds: filtered.map(a => a.id),
    matchedTotal: Num.round2(sumaTotal),
    albaranesConsiderados: filtered.length,
    diferencia: diff,
    confidence: isClose ? 'media' : 'baja',
    errorMsg: isClose
      ? `Tus ${filtered.length} albaranes de ${input.proveedor} suman ${Num.fmt(sumaTotal)}, la factura dice ${Num.fmt(input.total)}. Diferencia: ${Num.fmt(Math.abs(diff))}€ (${diff > 0 ? 'falta un albarán' : 'sobran albaranes'}).`
      : `No cuadra. ${filtered.length} albaranes de ${input.proveedor} suman ${Num.fmt(sumaTotal)} pero la factura dice ${Num.fmt(input.total)}.`,
    matchType: 'aproximado',
  };
};
