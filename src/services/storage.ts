// ==========================================
// 📦 storage.ts — Subir/leer/borrar archivos en Supabase Storage
//
// Bucket: arume-files (privado, ver dashboard de Supabase para policies).
// Estructura de carpetas:
//   invoices/<YYYY-MM>/<id>.<ext>   ← PDFs/imágenes de facturas
//   payrolls/<YYYY-MM>/<id>.<ext>   ← nóminas / recibos SS
//   cierres/<YYYY-MM>/<id>.<ext>    ← fotos de tickets de caja
//   fixed/<YYYY-MM>/<id>.<ext>      ← justificantes de gastos fijos
//
// Por qué privado: las facturas son datos contables sensibles. Aunque las URLs
// fueran no-guessables (UUID), el bucket privado garantiza que no se filtren ni
// por error en logs/screenshots. Para mostrar/descargar usamos signed URLs de
// 1 hora.
//
// Ahorro en DB: cada PDF en base64 inline ocupa ~1.3MB en la columna JSON. Con
// 200 facturas se zampa la cuota de 500MB del Free tier. Moviéndolo a Storage,
// la DB pasa a guardar sólo el path (~50 bytes por registro).
// ==========================================

import { supabase } from './supabase';

const BUCKET = 'arume-files';

export type StorageFolder = 'invoices' | 'payrolls' | 'cierres' | 'fixed' | 'albaranes';

// ── Helpers internos ──────────────────────────────────────────────────────

const extFromMime = (mime: string): string => {
  const m = mime.toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/heic') return 'heic';
  if (m === 'image/heif') return 'heif';
  return 'bin';
};

const yyyymm = (dateStr?: string): string => {
  // Si recibimos una fecha ISO YYYY-MM-DD usamos su mes; si no, el mes actual.
  if (dateStr && /^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0, 7);
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const randomId = (): string =>
  (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
    ? (crypto as any).randomUUID().replace(/-/g, '').slice(0, 16)
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// Convierte un base64 (con o sin prefijo data:) a Uint8Array para subirlo
// como binario real, no como string. Sube ~33% menos peso que el base64.
export const base64ToBytes = (base64: string): Uint8Array => {
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// ── API pública ───────────────────────────────────────────────────────────

export interface UploadResult {
  path: string;       // ruta dentro del bucket: invoices/2026-05/abc123.pdf
  size: number;       // bytes
}

/**
 * Sube un base64 al bucket arume-files.
 * - folder: categoría ('invoices', 'payrolls', 'cierres', 'fixed', 'albaranes')
 * - mime: tipo MIME para elegir extensión
 * - documentDate: fecha del documento (YYYY-MM-DD) para organizar por mes
 * - explicitId: opcional, si ya tienes un id (ej. id de la factura) y quieres
 *   que el path lo refleje. Si no, se genera uno aleatorio.
 *
 * Devuelve el path para guardarlo en la DB (NO la URL — las URLs se generan
 * bajo demanda con getSignedUrl).
 */
export const uploadBase64ToStorage = async (
  base64: string,
  mime: string,
  folder: StorageFolder,
  documentDate?: string,
  explicitId?: string,
): Promise<UploadResult> => {
  const ext = extFromMime(mime);
  const id = explicitId ? explicitId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) : randomId();
  const path = `${folder}/${yyyymm(documentDate)}/${id}.${ext}`;
  const bytes = base64ToBytes(base64);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: mime,
      // upsert: si ya existe un fichero con ese path lo sobrescribimos. Útil
      // si el id viene del registro y se reemplaza la imagen.
      upsert: true,
    });

  if (error) throw new Error(`Storage upload: ${error.message}`);
  return { path, size: bytes.byteLength };
};

/**
 * Devuelve una URL temporal (1h) para mostrar/descargar un archivo del bucket.
 * Privadas: requieren la URL fresca cada vez que se quiera mostrar.
 */
export const getSignedUrl = async (path: string, expiresInSeconds = 3600): Promise<string | null> => {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) {
    console.warn('[storage] createSignedUrl error:', error.message);
    return null;
  }
  return data?.signedUrl || null;
};

/**
 * Descarga el archivo completo como Blob (útil para "Descargar" del usuario o
 * para re-procesar con IA un PDF que ya está en Storage).
 */
export const downloadFromStorage = async (path: string): Promise<Blob | null> => {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) {
    console.warn('[storage] download error:', error.message);
    return null;
  }
  return data;
};

/**
 * Borra un archivo del bucket. Usar cuando se elimina la factura/albarán para
 * no acumular huérfanos en Storage.
 */
export const deleteFromStorage = async (path: string): Promise<boolean> => {
  if (!path) return false;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    console.warn('[storage] delete error:', error.message);
    return false;
  }
  return true;
};

/**
 * Detecta si un valor del campo file_base64 es realmente un base64 (legacy)
 * o ya es un path de Storage.
 */
export const isLegacyBase64 = (value?: string | null): boolean => {
  if (!value) return false;
  return value.startsWith('data:') || value.length > 200; // base64 PDFs son enormes
};
