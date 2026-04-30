// ==========================================
// 📄 pdfToImage.ts — Convertir PDF a imagen JPEG (base64)
// Permite usar cualquier proveedor de visión con PDFs.
// ==========================================
import * as pdfjs from 'pdfjs-dist';

// Worker desde CDN (compatible con Vite + GitHub Pages)
pdfjs.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

/**
 * Convierte la primera página de un PDF en una imagen JPEG.
 * Devuelve un objeto con `base64` (sin prefijo data:) y `mimeType`.
 */
export const pdfFirstPageToImage = async (
  file: File,
  scale: number = 2.0,
): Promise<{ base64: string; mimeType: 'image/jpeg' }> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear contexto canvas');

  await page.render({ canvasContext: ctx, viewport }).promise;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const base64 = dataUrl.split(',')[1] || '';
  return { base64, mimeType: 'image/jpeg' };
};
