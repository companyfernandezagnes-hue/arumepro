import { AppData, Albaran, Factura } from '../types';
import { Num, DateUtil } from './engine';

// Normaliza el proveedor para evitar duplicados por tildes o "S.L."
export const normProv = (s?: string) =>
  (s || '').toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(s\.?l\.?|s\.?a\.?|s\.?l\.?u\.?|s\.?c\.?p\.?)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

// Genera la clave de agrupación: "makro__2026-03"
const groupKey = (alb: Albaran) => `${normProv(alb.prov)}__${(alb.date || DateUtil.today()).slice(0, 7)}`;

// Busca si ya hay una factura abierta para ese proveedor y ese mes
const findFacturaIdx = (data: AppData, alb: Albaran) => {
  const key = normProv(alb.prov);
  const yymm = (alb.date || DateUtil.today()).slice(0, 7);
  return (data.facturas || []).findIndex((f: any) =>
    f?.tipo === 'compra' &&
    normProv(f?.prov) === key &&
    (f?.date || '').startsWith(yymm) &&
    !f?.reconciled
  );
};

// Evita meter el mismo albarán 2 veces en la misma factura
const facturaHasAlb = (f: any, albId: string) =>
  Array.isArray(f?.albaranIdsArr) && f.albaranIdsArr.includes(albId);

/** * Si editas un albarán y le cambias la fecha (de Marzo a Abril) o el Proveedor, 
 * esta función lo saca de la factura vieja y le resta los importes. 
 */
export function detachFromPreviousFacturaIfMoved(data: AppData, before: Albaran, after: Albaran) {
  if (groupKey(before) === groupKey(after)) return;

  const idx = (data.facturas || []).findIndex((f: any) =>
    Array.isArray(f.albaranIdsArr) && f.albaranIdsArr.includes(before.id)
  );
  if (idx < 0) return;

  const F = data.facturas[idx];
  const tb = Num.parse(before.total) || 0;
  const bb = Num.parse(before.base)  || Num.round2(tb / 1.10);
  const ib = Num.parse(before.taxes) || Num.round2(tb - bb);

  F.total = Num.round2((Num.parse(F.total) || 0) - tb);
  F.base  = Num.round2((Num.parse(F.base)  || 0) - bb);
  F.tax   = Num.round2((Num.parse(F.tax)   || 0) - ib);
  F.albaranIdsArr = F.albaranIdsArr.filter((id: string) => id !== before.id);

  // Si la factura vieja se quedó vacía, la eliminamos
  if ((F.albaranIdsArr || []).length === 0 && !F.reconciled) {
    data.facturas.splice(idx, 1);
  }
}

/** * Inserta o suma el albarán en la factura de su grupo (prov + mes).
 * Si la factura no existe, la crea.
 */
export function upsertFacturaFromAlbaran(data: AppData, alb: Albaran) {
  if (!Array.isArray(data.facturas)) data.facturas = [];
  const idx = findFacturaIdx(data, alb);

  const t = Num.parse(alb.total) || 0;
  const b = Num.parse(alb.base)  || Num.round2(t / 1.10);
  const i = Num.parse(alb.taxes) || Num.round2(t - b);

  if (idx >= 0) {
    // La factura existe -> Sumamos importes y vinculamos ID
    const F = data.facturas[idx];
    if (!facturaHasAlb(F, alb.id)) {
      F.total = Num.round2((Num.parse(F.total) || 0) + t);
      F.base  = Num.round2((Num.parse(F.base)  || 0) + b);
      F.tax   = Num.round2((Num.parse(F.tax)   || 0) + i);
      F.albaranIdsArr = Array.from(new Set([...(F.albaranIdsArr || []), alb.id]));
    }
  } else {
    // La factura NO existe -> La creamos
    const newF = {
      id: `fac-auto-${Date.now()}`,
      tipo: 'compra',
      num: `AUTO-${alb.num || 'SN'}`,
      date: alb.date || DateUtil.today(),
      prov: alb.prov,
      total: String(t), 
      base: String(b), 
      tax: String(i),
      paid: false,
      reconciled: false,
      status: 'approved',
      unidad_negocio: alb.unitId || 'REST',
      albaranIdsArr: [alb.id],
      source: 'auto-from-albaran',
    } as any;
    data.facturas.unshift(newF);
  }

  // Por último, marcamos el albarán en sí como "facturado" (invoiced = true)
  const ai = (data.albaranes || []).findIndex(a => a.id === alb.id);
  if (ai >= 0) data.albaranes[ai] = { ...data.albaranes[ai], invoiced: true };
}
