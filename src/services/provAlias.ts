// ==========================================
// 🏷️ provAlias.ts — Memoria de alias de proveedores
//
// Cuando la factura del email dice "Cerdà Obrador SL" pero en tus albaranes
// está como "Llorenç Cerdà", el matcher acepta la equivalencia y guarda el
// alias para que la próxima vez se cruce automáticamente.
//
// Persistido en localStorage (no necesita backend) — se sincroniza entre
// dispositivos sólo si exportas/importas, pero para uso típico de un negocio
// pequeño es suficiente.
// ==========================================

const ALIAS_KEY = 'arume_prov_alias';

export interface ProvAlias {
  canonical: string;     // El nombre "bueno" tal como aparece en tus albaranes
  aliases: string[];     // Variantes detectadas (p.ej. desde emails)
}

type AliasStore = Record<string, ProvAlias>; // key = canonical normalizado

const norm = (s?: string | null): string =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const readStore = (): AliasStore => {
  try {
    const raw = localStorage.getItem(ALIAS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed as AliasStore : {};
  } catch { return {}; }
};

const writeStore = (store: AliasStore): void => {
  try {
    localStorage.setItem(ALIAS_KEY, JSON.stringify(store));
  } catch { /* cuota llena u otro fallo — no bloqueamos */ }
};

/**
 * Devuelve el nombre canónico de un proveedor.
 * - Si el nombre ya está registrado como canonical, lo devuelve tal cual.
 * - Si está registrado como alias de otro, devuelve el canonical asociado.
 * - Si no hay registro, devuelve el rawName sin tocar.
 */
export const getProvCanonical = (rawName?: string | null): string => {
  if (!rawName || rawName.length < 2) return rawName || '';
  const n = norm(rawName);
  const store = readStore();
  for (const [key, data] of Object.entries(store)) {
    if (key === n) return data.canonical;
    if (data.aliases.some(a => norm(a) === n)) return data.canonical;
  }
  return rawName;
};

/**
 * Guarda un alias: "newAlias" pasa a referirse a "canonical".
 * Idempotente — si el alias ya existe no añade duplicados.
 */
export const saveProvAlias = (canonical: string, newAlias: string): void => {
  if (!canonical || !newAlias) return;
  if (norm(canonical) === norm(newAlias)) return; // mismo nombre, nada que guardar
  const key = norm(canonical);
  const store = readStore();
  if (!store[key]) store[key] = { canonical, aliases: [] };
  const aliasNorm = norm(newAlias);
  if (!store[key].aliases.some(a => norm(a) === aliasNorm)) {
    store[key].aliases.push(newAlias);
    writeStore(store);
  }
};

export const getAllAliases = (): AliasStore => readStore();

export const deleteAlias = (canonical: string, aliasToRemove: string): void => {
  const key = norm(canonical);
  const aliasNorm = norm(aliasToRemove);
  const store = readStore();
  if (!store[key]) return;
  store[key].aliases = store[key].aliases.filter(a => norm(a) !== aliasNorm);
  if (store[key].aliases.length === 0) delete store[key];
  writeStore(store);
};
