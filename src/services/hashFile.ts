// ==========================================
// 🔐 hashFile.ts — SHA-256 de ficheros locales
// Usado por la subida masiva de albaranes para deduplicar imágenes idénticas
// antes de gastar llamadas a IA.
// ==========================================

export const sha256OfFile = async (file: File): Promise<string> => {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
};
