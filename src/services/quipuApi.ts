// ═══════════════════════════════════════════════════════════════════════════
// 🔗 quipuApi.ts — Servicio de integración con Quipu API v1
// ═══════════════════════════════════════════════════════════════════════════
//
// OAuth2 client_credentials → Bearer token → JSON:API
// Rate limit: 5 req / 5 seg (gestionado con throttle interno)
// Docs: https://quipuapp.github.io/api-v1-docs/
// ═══════════════════════════════════════════════════════════════════════════

const BASE_URL = 'https://getquipu.com';
const TOKEN_URL = `${BASE_URL}/oauth/token`;
const ACCEPT_HEADER = 'application/vnd.quipu.v1+json';

// ── Token cache ────────────────────────────────────────────────────────────

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(appId: string, appSecret: string): Promise<string> {
  // Reusar token si aún es válido (con 60s de margen)
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: appId,
      client_secret: appSecret,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Quipu auth failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  };
  return _tokenCache.token;
}

/** Fuerza renovación del token (útil tras un 401) */
export function clearTokenCache() {
  _tokenCache = null;
}

// ── Throttle (5 req / 5 seg) ───────────────────────────────────────────────

const _queue: number[] = [];
const MAX_REQ = 5;
const WINDOW_MS = 5_000;

async function throttle(): Promise<void> {
  const now = Date.now();
  // Limpiar timestamps antiguos
  while (_queue.length > 0 && _queue[0] < now - WINDOW_MS) _queue.shift();

  if (_queue.length >= MAX_REQ) {
    const waitUntil = _queue[0] + WINDOW_MS;
    const delay = waitUntil - now;
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    return throttle(); // Re-check after wait
  }
  _queue.push(Date.now());
}

// ── Fetch genérico ─────────────────────────────────────────────────────────

interface QuipuConfig {
  appId: string;
  appSecret: string;
  ownerSlug: string;
}

async function quipuFetch(
  config: QuipuConfig,
  path: string,
  options: RequestInit = {},
): Promise<any> {
  await throttle();
  const token = await getAccessToken(config.appId, config.appSecret);

  const url = path.startsWith('http') ? path : `${BASE_URL}/${config.ownerSlug}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT_HEADER,
      ...(options.body ? { 'Content-Type': ACCEPT_HEADER } : {}),
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  // Si token expiró, renovar y reintentar 1 vez
  if (res.status === 401) {
    clearTokenCache();
    const newToken = await getAccessToken(config.appId, config.appSecret);
    const retry = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${newToken}`,
        Accept: ACCEPT_HEADER,
        ...(options.body ? { 'Content-Type': ACCEPT_HEADER } : {}),
        ...((options.headers as Record<string, string>) || {}),
      },
    });
    if (!retry.ok) throw new Error(`Quipu ${retry.status}: ${await retry.text().catch(() => '')}`);
    return retry.status === 204 ? null : retry.json();
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Quipu ${res.status}: ${errBody}`);
  }

  return res.status === 204 ? null : res.json();
}

// ── Helpers de paginación ──────────────────────────────────────────────────

interface PaginatedResponse<T> {
  data: T[];
  meta?: { pagination_info?: { total_pages: number; current_page: number; total_results: number } };
}

async function fetchAll<T>(config: QuipuConfig, path: string, params: Record<string, string> = {}): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const query = new URLSearchParams({ ...params, 'page[number]': String(page), 'page[size]': '100' });
    const res: PaginatedResponse<T> = await quipuFetch(config, `${path}?${query}`);
    if (res.data) all.push(...res.data);
    totalPages = res.meta?.pagination_info?.total_pages || 1;
    page++;
  } while (page <= totalPages);

  return all;
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

// ── Test de conexión ───────────────────────────────────────────────────────

export async function testConnection(config: QuipuConfig): Promise<{
  ok: boolean;
  message: string;
  contactCount?: number;
  invoiceCount?: number;
}> {
  try {
    const token = await getAccessToken(config.appId, config.appSecret);
    if (!token) return { ok: false, message: 'No se pudo obtener token OAuth2' };

    // Verificar que el ownerSlug funciona pidiendo 1 contacto
    const contacts = await quipuFetch(config, `/contacts?page[size]=1`);
    const contactCount = contacts?.meta?.pagination_info?.total_results ?? 0;

    const invoices = await quipuFetch(config, `/invoices?page[size]=1`);
    const invoiceCount = invoices?.meta?.pagination_info?.total_results ?? 0;

    return {
      ok: true,
      message: `Conectado ✓ — ${contactCount} contactos, ${invoiceCount} facturas en Quipu`,
      contactCount,
      invoiceCount,
    };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Error desconocido' };
  }
}

// ── Contactos (Proveedores / Clientes) ─────────────────────────────────────

export interface QuipuContact {
  id: string;
  type: 'contacts';
  attributes: {
    name: string;
    tax_id: string;
    phone?: string;
    email?: string;
    address?: string;
    town?: string;
    zip_code?: string;
    country_code?: string;
    is_client: boolean;
    is_supplier: boolean;
    bank_account_number?: string;
    total_paid_expenses?: string;
    total_unpaid_expenses?: string;
  };
}

export async function listContacts(config: QuipuConfig, kind?: 'client' | 'supplier' | 'employee'): Promise<QuipuContact[]> {
  const params: Record<string, string> = {};
  if (kind) params['filter[kind]'] = kind;
  return fetchAll<QuipuContact>(config, '/contacts', params);
}

export async function createContact(config: QuipuConfig, contact: {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  town?: string;
  zipCode?: string;
  isSupplier?: boolean;
  isClient?: boolean;
  bankAccount?: string;
}): Promise<QuipuContact> {
  const res = await quipuFetch(config, '/contacts', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'contacts',
        attributes: {
          name: contact.name,
          tax_id: contact.taxId || '',
          email: contact.email || '',
          phone: contact.phone || '',
          address: contact.address || '',
          town: contact.town || '',
          zip_code: contact.zipCode || '',
          country_code: 'ES',
          is_supplier: contact.isSupplier ?? true,
          is_client: contact.isClient ?? false,
          bank_account_number: contact.bankAccount || '',
        },
      },
    }),
  });
  return res.data;
}

export async function findContactByName(config: QuipuConfig, name: string): Promise<QuipuContact | null> {
  const res = await quipuFetch(config, `/contacts?filter[q]=${encodeURIComponent(name)}&page[size]=5`);
  return res.data?.[0] || null;
}

// ── Facturas ───────────────────────────────────────────────────────────────

export interface QuipuInvoice {
  id: string;
  type: 'invoices';
  attributes: {
    kind: 'income' | 'expenses';
    issue_date: string;
    paid_at: string | null;
    payment_method: string | null;
    payment_status: 'paid' | 'unpaid' | 'partially_paid';
    total_amount: string;
    total_amount_without_taxes: string;
    vat_amount: string;
    retention_amount: string;
    number: string | null;
    notes: string | null;
    tags: string;
    stage: 'draft' | 'final';
    download_pdf_url: string | null;
  };
  relationships?: any;
}

export interface QuipuInvoiceItem {
  concept: string;
  unitary_amount: string;
  quantity: number;
  vat_percent: number;
  retention_percent?: number;
}

export async function listInvoices(config: QuipuConfig, filters?: {
  kind?: 'income' | 'expenses';
  period?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'due' | 'pending';
  contactId?: number;
}): Promise<QuipuInvoice[]> {
  const params: Record<string, string> = {};
  if (filters?.kind) params['filter[kind]'] = filters.kind;
  if (filters?.period) params['filter[period]'] = filters.period;
  if (filters?.paymentStatus) params['filter[payment_status]'] = filters.paymentStatus;
  if (filters?.contactId) params['filter[contact_id]'] = String(filters.contactId);
  return fetchAll<QuipuInvoice>(config, '/invoices', params);
}

export async function createInvoice(config: QuipuConfig, invoice: {
  kind: 'income' | 'expenses';
  issueDate: string;
  number?: string;
  contactId: string;
  items: QuipuInvoiceItem[];
  notes?: string;
  tags?: string;
  paidAt?: string;
  paymentMethod?: string;
}): Promise<QuipuInvoice> {
  const res = await quipuFetch(config, '/invoices', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'invoices',
        attributes: {
          kind: invoice.kind,
          issue_date: invoice.issueDate,
          number: invoice.number || null,
          notes: invoice.notes || '',
          tags: invoice.tags || '',
          paid_at: invoice.paidAt || null,
          payment_method: invoice.paymentMethod || null,
        },
        relationships: {
          contact: { data: { id: invoice.contactId, type: 'contacts' } },
          items: {
            data: invoice.items.map((item, i) => ({
              type: 'items',
              id: `new-${i}`,
              attributes: {
                concept: item.concept,
                unitary_amount: item.unitary_amount,
                quantity: item.quantity,
                vat_percent: item.vat_percent,
                retention_percent: item.retention_percent ?? 0,
              },
            })),
          },
        },
      },
    }),
  });
  return res.data;
}

export async function getInvoice(config: QuipuConfig, id: string, include?: string): Promise<QuipuInvoice> {
  const query = include ? `?include=${include}` : '';
  const res = await quipuFetch(config, `/invoices/${id}${query}`);
  return res.data;
}

// ── Nóminas (Paysheets) ────────────────────────────────────────────────────

export interface QuipuPaysheet {
  id: string;
  type: 'paysheets';
  attributes: {
    issue_date: string;
    paid_at: string | null;
    payment_status: 'paid' | 'unpaid';
    net_pay: string;
    gross_pay: string;
    employee_ss_amount: string;
    employee_retention: string;
    company_ss_amount: string;
  };
}

export async function listPaysheets(config: QuipuConfig): Promise<QuipuPaysheet[]> {
  return fetchAll<QuipuPaysheet>(config, '/paysheets');
}

// ── Book Entries (lectura consolidada) ──────────────────────────────────────

export interface QuipuBookEntry {
  id: string;
  type: string;
  attributes: {
    number: string | null;
    issue_date: string;
    paid_at: string | null;
    payment_status: 'paid' | 'unpaid' | 'partially_paid';
    total_amount: string;
    tags: string;
    issuing_name: string;
    recipient_name: string;
  };
}

export async function listBookEntries(config: QuipuConfig, filters?: {
  type?: 'invoices' | 'tickets' | 'paysheets';
  kind?: 'income' | 'expenses';
  period?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'due' | 'pending';
}): Promise<QuipuBookEntry[]> {
  const params: Record<string, string> = {};
  if (filters?.type) params['filter[type]'] = filters.type;
  if (filters?.kind) params['filter[kind]'] = filters.kind;
  if (filters?.period) params['filter[period]'] = filters.period;
  if (filters?.paymentStatus) params['filter[payment_status]'] = filters.paymentStatus;
  return fetchAll<QuipuBookEntry>(config, '/book_entries', params);
}

// ── Utilidad: construir config desde datos de la app ───────────────────────

export function buildQuipuConfig(appConfig: Record<string, any>): QuipuConfig | null {
  const appId = appConfig?.quipuAppId;
  const appSecret = appConfig?.quipuAppSecret;
  const ownerSlug = appConfig?.quipuOwnerSlug;
  if (!appId || !appSecret || !ownerSlug) return null;
  return { appId, appSecret, ownerSlug };
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC: PROVEEDORES  Arume PRO → Quipu
// ═══════════════════════════════════════════════════════════════════════════

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Sincroniza proveedores de Arume PRO → Quipu Contacts.
 * - Busca cada proveedor por nombre en Quipu
 * - Si no existe, lo crea como supplier
 * - Si existe, lo salta (no sobreescribe datos de Quipu)
 * - Devuelve un mapa nombre→quipuContactId para usar después con facturas
 */
export async function syncProveedores(
  config: QuipuConfig,
  proveedores: { nombre: string; cif?: string; email?: string; telefono?: string; direccion?: string; ciudad?: string; cp?: string; iban?: string }[],
  onProgress?: (msg: string) => void,
): Promise<{ result: SyncResult; contactMap: Record<string, string> }> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const contactMap: Record<string, string> = {};

  // 1. Cargar todos los contactos existentes de Quipu
  onProgress?.('Leyendo contactos de Quipu...');
  const existing = await listContacts(config, 'supplier');
  const existingByName: Record<string, QuipuContact> = {};
  for (const c of existing) {
    const key = (c.attributes.name || '').toLowerCase().trim();
    if (key) existingByName[key] = c;
  }

  // 2. Para cada proveedor de Arume, crear o vincular
  for (let i = 0; i < proveedores.length; i++) {
    const p = proveedores[i];
    const nameKey = p.nombre.toLowerCase().trim();
    onProgress?.(`Sincronizando ${i + 1}/${proveedores.length}: ${p.nombre}`);

    try {
      if (existingByName[nameKey]) {
        // Ya existe en Quipu
        contactMap[p.nombre] = existingByName[nameKey].id;
        result.skipped++;
      } else {
        // Buscar por texto libre (match fuzzy)
        const found = await findContactByName(config, p.nombre);
        if (found) {
          contactMap[p.nombre] = found.id;
          result.skipped++;
        } else {
          // Crear nuevo
          const created = await createContact(config, {
            name: p.nombre,
            taxId: p.cif,
            email: p.email,
            phone: p.telefono,
            address: p.direccion,
            town: p.ciudad,
            zipCode: p.cp,
            isSupplier: true,
            isClient: false,
            bankAccount: p.iban,
          });
          contactMap[p.nombre] = created.id;
          result.created++;
        }
      }
    } catch (err: any) {
      result.errors.push(`${p.nombre}: ${err?.message || 'Error'}`);
    }
  }

  return { result, contactMap };
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC: FACTURAS  Arume PRO → Quipu
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sube una factura de Arume PRO a Quipu.
 * Necesita el quipuContactId del proveedor (obtenerlo de syncProveedores o contactMap).
 */
export async function syncFactura(
  config: QuipuConfig,
  factura: {
    tipo: 'compra' | 'venta';
    numero: string;
    fecha: string;
    proveedorQuipuId: string;
    base: number;
    iva: number;
    total: number;
    concepto?: string;
    ivaPct?: number;
    pagada?: boolean;
    fechaPago?: string;
    notas?: string;
  },
): Promise<{ ok: boolean; quipuId?: string; error?: string }> {
  try {
    const items: QuipuInvoiceItem[] = [{
      concept: factura.concepto || `Factura ${factura.numero}`,
      unitary_amount: String(factura.base || factura.total),
      quantity: 1,
      vat_percent: factura.ivaPct ?? (factura.base > 0 ? Math.round((factura.iva / factura.base) * 100) : 21),
    }];

    const created = await createInvoice(config, {
      kind: factura.tipo === 'compra' ? 'expenses' : 'income',
      issueDate: factura.fecha,
      number: factura.numero,
      contactId: factura.proveedorQuipuId,
      items,
      notes: factura.notas,
      tags: 'arume-pro',
      paidAt: factura.pagada ? (factura.fechaPago || factura.fecha) : undefined,
    });

    return { ok: true, quipuId: created.id };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error al subir factura' };
  }
}

/**
 * Sync masivo de facturas: sube todas las facturas de un periodo a Quipu.
 * Requiere un contactMap (nombre proveedor → quipuContactId).
 */
export async function syncFacturasBatch(
  config: QuipuConfig,
  facturas: Array<{
    id: string;
    tipo: 'compra' | 'venta';
    numero: string;
    fecha: string;
    proveedor: string;
    base: number;
    iva: number;
    total: number;
    concepto?: string;
    ivaPct?: number;
    pagada?: boolean;
    fechaPago?: string;
  }>,
  contactMap: Record<string, string>,
  onProgress?: (msg: string) => void,
): Promise<SyncResult & { syncedIds: string[] }> {
  const result: SyncResult & { syncedIds: string[] } = { created: 0, updated: 0, skipped: 0, errors: [], syncedIds: [] };

  for (let i = 0; i < facturas.length; i++) {
    const f = facturas[i];
    onProgress?.(`Subiendo factura ${i + 1}/${facturas.length}: ${f.numero || 'S/N'} — ${f.proveedor}`);

    const contactId = contactMap[f.proveedor];
    if (!contactId) {
      result.errors.push(`${f.numero}: proveedor "${f.proveedor}" no tiene contacto en Quipu`);
      result.skipped++;
      continue;
    }

    const res = await syncFactura(config, {
      tipo: f.tipo,
      numero: f.numero,
      fecha: f.fecha,
      proveedorQuipuId: contactId,
      base: f.base,
      iva: f.iva,
      total: f.total,
      concepto: f.concepto,
      ivaPct: f.ivaPct,
      pagada: f.pagada,
      fechaPago: f.fechaPago,
    });

    if (res.ok) {
      result.created++;
      result.syncedIds.push(f.id);
    } else {
      result.errors.push(`${f.numero}: ${res.error}`);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC: LEER PAGOS  Quipu → Arume PRO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lee el estado de pago de todas las facturas en Quipu y devuelve
 * las que están marcadas como pagadas para actualizar Arume PRO.
 */
export async function fetchPaidInvoices(
  config: QuipuConfig,
  period?: string,
): Promise<Array<{ quipuId: string; number: string; paidAt: string; totalAmount: string; providerName: string }>> {
  const params: Record<string, string> = { 'filter[payment_status]': 'paid', 'filter[kind]': 'expenses' };
  if (period) params['filter[period]'] = period;

  const invoices = await fetchAll<QuipuInvoice>(config, '/invoices?include=contact', params);

  return invoices
    .filter(inv => inv.attributes.paid_at)
    .map(inv => ({
      quipuId: inv.id,
      number: inv.attributes.number || '',
      paidAt: inv.attributes.paid_at || '',
      totalAmount: inv.attributes.total_amount,
      providerName: '', // Se llena desde el include si hay contact
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-DETECCIÓN: Owner Slug
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Intenta descubrir el owner_slug probando el endpoint /book_entries
 * con slugs comunes derivados del nombre de la empresa.
 * Devuelve el slug que funcione o null.
 */
export async function discoverOwnerSlug(
  appId: string,
  appSecret: string,
  empresaNombre: string,
): Promise<string | null> {
  const token = await getAccessToken(appId, appSecret);
  if (!token) return null;

  // Generar variantes del slug a partir del nombre de empresa
  const base = empresaNombre
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-');

  // Sin guiones (como lo usa Quipu web: "racoblanquerna")
  const noDash = base.replace(/-/g, '');
  const noDashNoSuffix = noDash.replace(/sl$|sa$|slu$/, '');

  const candidates = [
    noDashNoSuffix,                          // "racoblanquerna" (estilo Quipu web)
    noDash,                                  // "racoblanquernasl"
    base,                                    // "raco-blanquerna-sl"
    base.replace(/-sl$|-sa$|-slu$/, ''),     // "raco-blanquerna"
    base.split('-').slice(0, 2).join('-'),    // "raco-blanquerna"
    base.split('-')[0],                      // "raco"
  ];

  // Deduplicar
  const unique = [...new Set(candidates)].filter(Boolean);

  for (const slug of unique) {
    try {
      const res = await fetch(`${BASE_URL}/${slug}/contacts?page[size]=1`, {
        headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT_HEADER },
      });
      if (res.ok) return slug;
    } catch { /* siguiente candidato */ }
  }

  return null;
}
