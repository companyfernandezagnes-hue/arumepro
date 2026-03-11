import { AppData, Albaran } from '../types';
import { Num, DateUtil } from './engine';

// 1. Normalización SENCILLA: Solo quita mayúsculas, tildes, símbolos y el "S.L."
export const normProv = (s?: string) => {
  if (!s) return 'desconocido';
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(s\.?l\.?|s\.?a\.?|s\.?l\.?u\.?|s\.?c\.?p\.?)\b/gi, '')
    .replace(/[^a-z0-9]/g, '') 
    .trim();
};

// 2. Busca la factura del mismo proveedor y mes
const findFacturaIdx = (data: AppData, prov: string, dateISO?: string) => {
  const key = normProv(prov);
  const yymm = (dateISO || DateUtil.today()).slice(0, 7); // Saca el "YYYY-MM"
  
  return (data.facturas || []).findIndex((f: any) =>
    f?.tipo === 'compra' &&
    normProv(f?.prov) === key &&
    (f?.date || '').startsWith(yymm) &&
    !f?.reconciled
  );
};

// Evita duplicar el mismo albarán en la factura
const facturaHasAlb = (f: any, albId: string) =>
  Array.isArray(f?.albaranIdsArr) && f.albaranIdsArr.includes(albId);

// 3. Función principal: Agrupa el albarán en una factura o crea una nueva
export function upsertFacturaFromAlbaran(data: AppData, alb: Albaran) {
  if (!Array.isArray(data.facturas)) data.facturas = [];

  const idx = findFacturaIdx(data, alb.prov, alb.date);

  const t = Num.parse(alb.total) || 0;
  const b = Num.parse(alb.base)  || Num.round2(t / 1.10);
  const i = Num.parse(alb.taxes) || Num.round2(t - b);

  if (idx >= 0) {
    // A) Ya existe factura para este mes/proveedor -> SUMAMOS
    const F = data.facturas[idx];
    if (!facturaHasAlb(F, alb.id)) {
      F.total = Num.round2((Num.parse(F.total) || 0) + t);
      F.base  = Num.round2((Num.parse(F.base)  || 0) + b);
      F.tax   = Num.round2((Num.parse(F.tax)   || 0) + i);
      F.albaranIdsArr = Array.from(new Set([...(F.albaranIdsArr || []), alb.id]));
    }
  } else {
    // B) No existe factura -> CREAMOS UNA NUEVA
    const newF = {
      id: `fac-auto-${Date.now()}`,
      tipo: 'compra',
      num: `AUTO-${alb.num || 'SN'}`,
      date: alb.date || DateUtil.today(),
      prov: alb.prov, // Guardamos el nombre tal cual lo escribió el usuario
      total: t, 
      base: b, 
      tax: i,
      paid: false,
      reconciled: false,
      status: 'approved',
      unidad_negocio: alb.unitId || 'REST',
      albaranIdsArr: [alb.id],
      source: 'auto-from-albaran',
    } as any;
    data.facturas.unshift(newF);
  }

  // Marcamos el albarán original como facturado
  const ai = (data.albaranes || []).findIndex(a => a.id === alb.id);
  if (ai >= 0) {
    data.albaranes[ai] = { ...data.albaranes[ai], invoiced: true };
  }
}

// 4. Función para cuando EDITAS un albarán (le cambias la fecha o proveedor)
export function detachFromPreviousFacturaIfMoved(data: AppData, before: Albaran, after: Albaran) {
  const sameProv = normProv(before.prov) === normProv(after.prov);
  const sameMonth = (before.date || '').slice(0, 7) === (after.date || '').slice(0, 7);
  
  if (sameProv && sameMonth) return; // Si no cambió ni mes ni proveedor, no hacemos nada

  const idx = (data.facturas || []).findIndex((f: any) =>
    Array.isArray(f.albaranIdsArr) && f.albaranIdsArr.includes(before.id)
  );
  if (idx < 0) return;

  const F = data.facturas[idx];
  const tb = Num.parse(before.total) || 0;
  const bb = Num.parse(before.base)  || Num.round2(tb / 1.10);
  const ib = Num.parse(before.taxes) || Num.round2(tb - bb);

  // Restamos los importes de la factura antigua
  F.total = Num.round2((Num.parse(F.total) || 0) - tb);
  F.base  = Num.round2((Num.parse(F.base)  || 0) - bb);
  F.tax   = Num.round2((Num.parse(F.tax)   || 0) - ib);
  F.albaranIdsArr = F.albaranIdsArr.filter((id: string) => id !== before.id);

  // Si la factura vieja se quedó vacía al quitar este albarán, la borramos
  if ((F.albaranIdsArr || []).length === 0 && !F.reconciled) {
    data.facturas.splice(idx, 1);
  }
}
