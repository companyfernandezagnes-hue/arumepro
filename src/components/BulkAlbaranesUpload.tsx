// ==========================================
// 📦 BulkAlbaranesUpload — subida masiva de imágenes de albaranes
// Flujo:
//  1. Hash SHA-256 de cada imagen → descartar las que ya existan en la bóveda
//     (mismo file_hash en un albarán anterior).
//  2. Las que pasan el filtro se mandan a Gemini en paralelo (con retry, gracias
//     a scanBase64) y obtenemos {proveedor, num, fecha, total, lineas}.
//  3. Dedupe por metadata (proveedor + num + fecha) contra los albaranes
//     existentes — captura el caso "misma factura reenviada con otro nombre".
//  4. Pantalla de revisión: Nuevos / Repetidos por hash / Repetidos por metadata.
//  5. Botón único "Guardar X nuevos" → crea los albaranes nuevos, persistiendo
//     el file_hash para deduplicar futuras subidas.
// ==========================================

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Loader2, X, CheckCircle2, AlertTriangle, Copy, FileImage, FolderOpen, Clipboard } from 'lucide-react';
import { AppData, Albaran, BusinessUnit } from '../types';
import { sha256OfFile } from '../services/hashFile';
import { scanBase64, preprocessImageForOCR } from '../services/aiProviders';
import { Num } from '../services/engine';
import { basicNorm } from '../services/invoicing';
import { advancedProvSimilarity } from '../services/invoiceMatcher';
import { toast } from '../hooks/useToast';
import { cn } from '../lib/utils';

type FileStatus =
  | { kind: 'pending' }
  | { kind: 'duplicate-hash'; existing: Albaran }
  | { kind: 'scanning' }
  | { kind: 'failed'; reason: string }
  | { kind: 'duplicate-meta'; existing: Albaran; parsed: ParsedAlbaran }
  | { kind: 'new'; parsed: ParsedAlbaran };

interface ParsedAlbaran {
  proveedor: string;
  num: string;
  fecha: string;
  total: number;
  lineas: Array<{ q?: number; n?: string; t?: number; rate?: number; u?: string }>;
  // Confianza autoreportada por la IA. Si es 'low', el albarán se guarda con
  // needs_review:true y no entra al P&L hasta que la usuaria lo revise.
  confidence?: 'high' | 'medium' | 'low';
  // Razones de revisión detectadas en validación post-IA (fecha rara, año fuera
  // de rango, proveedor que parece "Arume" / receptor, etc.).
  reviewReasons?: string[];
  // Qué proveedor de IA leyó esto realmente (claude/gemini/mistral/groq).
  // Visible en la tarjeta de revisión para que la usuaria sepa si su API de
  // Claude está funcionando o si la app cae al fallback de Gemini.
  aiProvider?: string;
  aiModel?: string;
}

// Validación post-IA: detecta señales de que algo se leyó mal y devuelve
// razones para marcar needs_review.
const validateParsed = (p: ParsedAlbaran): string[] => {
  const reasons: string[] = [];
  // Fecha
  if (!p.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)) {
    reasons.push('Fecha no leída');
  } else {
    const year = parseInt(p.fecha.slice(0, 4), 10);
    if (year < 2023 || year > 2027) reasons.push(`Año fuera de rango (${year})`);
    const t = Date.parse(p.fecha);
    if (Number.isNaN(t)) reasons.push('Fecha mal formada');
  }
  // Proveedor — si la IA devolvió Arume/Agnès es porque confundió emisor con receptor
  const provLower = (p.proveedor || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!p.proveedor || p.proveedor.length < 3) {
    reasons.push('Proveedor no leído');
  } else if (/\b(arume|agnes|agnès|sake bar|company fernandez)\b/i.test(provLower)) {
    reasons.push('Proveedor parece ser el receptor (Arume), no el emisor');
  }
  // Total
  if (!p.total || p.total <= 0) {
    reasons.push('Total no leído o cero');
  } else if (p.total > 100000) {
    reasons.push('Total sospechosamente alto');
  }
  // Confianza autoreportada
  if (p.confidence === 'low') reasons.push('IA reportó baja confianza');
  return reasons;
};

interface FileEntry {
  id: string;
  // ¿Está seleccionado para guardar? Por defecto los fiables van marcados,
  // los dudosos no — la usuaria decide cuáles entrar al P&L. Los duplicados
  // no se pueden seleccionar (ignorados implícitamente).
  selected?: boolean;
  // Si la usuaria edita los datos de la IA antes de guardar, aquí va el
  // override. El guardado prioriza editedParsed sobre status.parsed.
  editedParsed?: ParsedAlbaran;
  file: File;
  hash: string;
  base64: string;
  status: FileStatus;
}

interface BulkAlbaranesUploadProps {
  isOpen: boolean;
  onClose: () => void;
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  defaultUnitId: BusinessUnit;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Quitar prefijo "data:image/...;base64,"
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

// Normaliza un nº de albarán/factura: quita espacios, guiones, barras y
// ceros a la izquierda. "F-2024-0123" y "F20240123" deben deduplicarse igual.
const normalizeNum = (num: string): string =>
  String(num || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^0+(?=\d)/, '')
    .trim();

// Clave para detectar duplicados intra-lote y contra registros previos
// guardados con metadata (legacy). NO depende de fecha exacta — sólo del mes,
// porque la IA puede leer fecha de emisión un día y vencimiento al día siguiente.
const dedupeKey = (prov: string, num: string, fecha: string): string => {
  const provNorm = basicNorm(prov || '');
  const numNorm  = normalizeNum(num);
  const ymNorm   = (fecha || '').slice(0, 7); // YYYY-MM
  return `${provNorm}::${numNorm}::${ymNorm}`;
};

// Detector flexible para "este albarán YA está en la bóveda". Usa similitud
// fuzzy del proveedor (acepta "MAKRO" vs "MAKRO IBÉRICA SAU"), normalización
// del número, y tolerancia de mes en la fecha. Captura los 3 escenarios:
//  - misma imagen subida 2 veces (lo pilla el hash, pero por si acaso)
//  - misma factura con otra foto (proveedor fuzzy + num + mes coinciden)
//  - misma factura con otra fecha exacta (off-by-one por vencimiento)
const findExistingMatch = (parsed: ParsedAlbaran, albaranes: Albaran[]): Albaran | undefined => {
  if (!parsed.proveedor) return undefined;
  const numNorm = normalizeNum(parsed.num);
  const ym = (parsed.fecha || '').slice(0, 7);
  return albaranes.find(a => {
    if (!a) return false;
    const provSim = advancedProvSimilarity(a.prov || '', parsed.proveedor);
    if (provSim < 60) return false;
    const aNum = normalizeNum(a.num || '');
    if (numNorm && aNum && (numNorm === aNum || numNorm.includes(aNum) || aNum.includes(numNorm))) {
      return true;
    }
    // Si los números no coinciden, exige mismo mes + total parecido (±2€)
    if (ym && a.date && a.date.startsWith(ym)) {
      const aTotal = Math.abs((a as any).total ? parseFloat(String(a.total).replace(',', '.')) : 0);
      if (parsed.total > 0 && aTotal > 0 && Math.abs(aTotal - parsed.total) <= 2) {
        return true;
      }
    }
    return false;
  });
};

// Limita la concurrencia de promesas (evita saturar la API de Gemini)
const runWithLimit = async <T,>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>) => {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
};

const PROMPT = `Eres un OCR contable especializado en albaranes y facturas comerciales españoles para un restaurante japonés (Arume Sake Bar). Analiza este documento y devuelve SOLO JSON sin markdown ni texto antes/después.

ESQUEMA EXACTO:
{
  "proveedor": "string|null",
  "num": "string|null",
  "fecha": "YYYY-MM-DD|null",
  "total": number,
  "lineas": [{"q": number, "n": "string", "t": number, "rate": 4|10|21, "u": "string"}],
  "confidence": "high"|"medium"|"low"
}

REGLAS — léelas TODAS antes de responder:

═══ PROVEEDOR ═══
El EMISOR (quien VENDE y emite el documento). El receptor SIEMPRE es "Arume Sake Bar" / "Arume" / "Agnès Company" / "AGNES COMPANY FERNANDEZ" / un CIF tipo X4XXXXXXXX que termina en letra de Agnès — NUNCA es el proveedor, es la receptora.

✅ Cómo encontrarlo: busca en la CABECERA (parte superior izquierda normalmente) el nombre + CIF del emisor. En tickets/albaranes térmicos el emisor suele estar arriba con dirección. Devuelve el nombre legal completo, incluyendo "SL", "SA", "SLU", "CB" si los pone.

✅ Ejemplos:
- Ticket de "MAKRO IBÉRICA SAU" enviado a Arume → proveedor: "MAKRO IBÉRICA SAU"
- Factura de "Llorenç Cerdà Obrador SL" → proveedor: "Llorenç Cerdà Obrador SL"
- Si en la cabecera ves "Pescaderías Chiringuito SL" y abajo "Cliente: Arume Sake Bar" → proveedor: "Pescaderías Chiringuito SL"

❌ NUNCA devuelvas "Arume", "Agnès", "Sake Bar" como proveedor.

═══ FECHA ═══
Fecha de EMISIÓN del documento (NO fecha de pago, NI fecha de vencimiento, NI fecha de entrega).

✅ Formato OBLIGATORIO: YYYY-MM-DD con año de 4 dígitos. Conversiones:
- "06/05/2026" → "2026-05-06"
- "06-05-26"   → "2026-05-06"  (asume 20XX si solo ves XX)
- "6 de mayo de 2026" → "2026-05-06"

✅ Año esperado: 2024, 2025 o 2026. Si ves "23" interpretalo como 2023 (no 1923).

❌ Si ves DOS fechas (emisión + vencimiento), prefiere SIEMPRE la de emisión.
❌ Si la fecha no es clara, está borrosa, o no aparece → devuelve null. NUNCA inventes una fecha.

═══ NUM ═══
Referencia única (etiquetas: "Nº Albarán", "Albarán Nº", "Factura nº", "Doc. nº", "Ref.", "F-", "A-"…). Tal cual aparece, con guiones/barras/letras.
Si no hay → "S/N".

═══ TOTAL ═══
Importe TOTAL FINAL del documento con IVA incluido. Etiquetas habituales: "TOTAL", "Total Factura", "Importe Total", "Total a pagar".
- Punto decimal: 1234.56
- NO confundir con "Base imponible", "Subtotal" ni "IVA".
- Si no se ve el total, suma t de todas las líneas.

═══ LINEAS ═══
Una entrada por cada producto facturado:
- q = cantidad numérica (no string)
- n = descripción del producto tal como aparece
- t = importe TOTAL de la línea con IVA (= q × precio_unitario × (1 + rate/100))
- rate = % IVA aplicado: 4, 10 o 21 (en España). 10 por defecto si no es claro.
- u = unidad: "kg", "l", "ud", "uds", "caja", "botella"... "uds" por defecto.

═══ CONFIDENCE ═══
- "high"   = todos los campos legibles sin esfuerzo, foto nítida y limpia
- "medium" = falta algún detalle o hay borrosidad parcial
- "low"    = foto borrosa, texto parcial, o tienes dudas sobre algún número/fecha → la app marcará el albarán para revisión manual

═══ POLÍTICA ANTI-INVENCIÓN ═══
Es PREFERIBLE devolver null/0 que inventar. Si dudas, marca confidence="low" y deja vacío lo que no veas. Nunca digas que algo es "MAKRO" si no lo lees claramente.`;

// ── Componente ─────────────────────────────────────────────────────────────

export const BulkAlbaranesUpload: React.FC<BulkAlbaranesUploadProps> = ({
  isOpen, onClose, data, onSave, defaultUnitId,
}) => {
  const [phase, setPhase] = useState<'idle' | 'processing' | 'review' | 'saving'>('idle');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const albaranes = data.albaranes || [];
  const hashIndex = useMemo(() => {
    const map = new Map<string, Albaran>();
    for (const a of albaranes) if (a.file_hash) map.set(a.file_hash, a);
    return map;
  }, [albaranes]);

  // (Antes había un metaIndex Map, pero su clave era demasiado estricta
  // — exigía coincidencia exacta de proveedor + num + fecha. Ahora usamos
  // findExistingMatch con similitud fuzzy.)

  const reset = () => {
    setEntries([]);
    setProgress({ done: 0, total: 0 });
    setPhase('idle');
  };

  const handleClose = () => {
    if (phase === 'processing' || phase === 'saving') return;
    reset();
    onClose();
  };

  // Estado UI de drag-and-drop sobre el área de subida
  const [isDragOver, setIsDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Pegar imágenes del portapapeles (Ctrl/Cmd+V) cuando el modal está abierto.
  // Un screenshot pegado es un Blob image/png — lo convertimos a File con un
  // nombre sintético para que el resto del flujo funcione igual que con un
  // <input type="file">.
  useEffect(() => {
    if (!isOpen || phase !== 'idle') return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pasted: File[] = [];
      for (const it of Array.from(items)) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const blob = it.getAsFile();
          if (blob) {
            const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
            const name = blob.name && blob.name !== 'image.png'
              ? blob.name
              : `pegado-${Date.now()}-${pasted.length}.${ext}`;
            pasted.push(new File([blob], name, { type: blob.type, lastModified: Date.now() }));
          }
        }
      }
      if (pasted.length > 0) {
        e.preventDefault();
        toast.success(`📋 ${pasted.length} imagen(es) pegada(s) del portapapeles.`);
        handleFiles(pasted);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [isOpen, phase]);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (list.length === 0) {
      toast.warning('Selecciona imágenes (JPG/PNG) de albaranes.');
      return;
    }
    setPhase('processing');
    setProgress({ done: 0, total: list.length });

    // 1. Hash en paralelo (rápido, en CPU). El hash se calcula sobre el File
    // ORIGINAL para que dos fotos idénticas se detecten aunque luego se
    // procesen distinto. La imagen que va a la IA pasa por preprocessImageForOCR
    // que: (a) respeta orientación EXIF (fotos del móvil), (b) realza
    // contraste, (c) reduce a 1800px. Sin esto, las fotos del móvil llegaban
    // rotadas 90° y la IA leía todo mal.
    const initial: FileEntry[] = await Promise.all(
      list.map(async (file, idx) => {
        const hash = await sha256OfFile(file);
        let base64: string;
        try {
          // Preprocesado: rota EXIF, mejora contraste, reduce tamaño
          const r = await preprocessImageForOCR(file);
          base64 = r.base64;
        } catch {
          // Fallback al base64 directo si el preprocesado falla
          base64 = await fileToBase64(file);
        }
        const dup = hashIndex.get(hash);
        return {
          id: `bulk-${Date.now()}-${idx}`,
          file,
          hash,
          base64,
          status: dup
            ? { kind: 'duplicate-hash', existing: dup } as FileStatus
            : { kind: 'pending' } as FileStatus,
        };
      })
    );
    setEntries(initial);

    // 2. Scan IA en paralelo limitado para los pendientes
    const pendientes = initial.filter(e => e.status.kind === 'pending');
    let done = initial.length - pendientes.length;
    setProgress({ done, total: initial.length });

    // Dedupe intra-lote: si la usuaria sube 3 fotos del mismo albarán (distintos
    // ángulos → distintos hashes pero mismos prov+num+fecha), sólo la primera
    // se marca como "new". Las siguientes se marcan duplicate-meta apuntando
    // a la primera del lote.
    const batchSeen = new Map<string, { id: string; parsed: ParsedAlbaran }>();

    // Concurrencia 5 (subido de 3): Claude/Gemini aguantan bien picos cortos
    // y la subida masiva pasa de tardar 50s a tardar 30s con 30 albaranes.
    // Si la API se satura, el retry interno de scanBase64 (3 intentos con
    // backoff) absorbe el pico.
    await runWithLimit(pendientes, 5, async (entry) => {
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'scanning' } } : e));
      try {
        // mimeType siempre image/jpeg porque preprocessImageForOCR lo convierte
        // (el original puede ser HEIC/PNG/WebP — la IA recibe siempre JPEG normalizado).
        const result = await scanBase64(entry.base64, 'image/jpeg', PROMPT);
        const raw = result.raw as any;
        const parsed: ParsedAlbaran = {
          proveedor: String(raw.proveedor || '').trim(),
          num: String(raw.num || '').trim() || 'S/N',
          fecha: String(raw.fecha || '').trim(),
          total: Num.parse(raw.total),
          lineas: Array.isArray(raw.lineas) ? raw.lineas : [],
          confidence: (raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low')
            ? raw.confidence : undefined,
          aiProvider: result.provider,
          aiModel: result.model,
        };

        // 🔄 Re-prompt automático: si la IA devolvió fecha o proveedor vacíos,
        // hacemos UN segundo intento con prompt enfocado SOLO en eso. Antes de
        // marcar el albarán "a revisar" damos esta segunda oportunidad porque
        // a veces el primer prompt es demasiado largo y la IA se "cansa" en
        // los campos finales. Prompt corto + atención específica suele resolver.
        const needsRetry = !parsed.fecha || !parsed.proveedor;
        if (needsRetry) {
          try {
            const focusPrompt = `Mira esta imagen UNA vez más y devuelve SOLO JSON:
{"proveedor":"nombre del emisor (NO Arume/receptor)","fecha":"YYYY-MM-DD"}

Ignora todo lo demás del documento. Concéntrate en:
1. PROVEEDOR: el nombre legal del emisor en la cabecera junto al CIF.
2. FECHA: la fecha de emisión, formato YYYY-MM-DD con año 4 dígitos. Si ves DD/MM/YYYY conviértelo. Año esperado 2024-2026.
Si no lo ves claramente, devuelve null. NO inventes.`;
            const retry = await scanBase64(entry.base64, 'image/jpeg', focusPrompt);
            const r2 = retry.raw as any;
            if (!parsed.proveedor && r2?.proveedor) parsed.proveedor = String(r2.proveedor).trim();
            if (!parsed.fecha && r2?.fecha && /^\d{4}-\d{2}-\d{2}$/.test(String(r2.fecha))) {
              parsed.fecha = String(r2.fecha).trim();
            }
          } catch { /* el retry es best-effort: si falla, seguimos con lo que ya teníamos */ }
        }

        // Validación post-IA — detecta señales de "se leyó mal" para marcar
        // el albarán a revisar antes de meterlo al P&L.
        parsed.reviewReasons = validateParsed(parsed);

        // 1º contra la bóveda — uso el detector flexible que tolera variaciones
        // del proveedor (fuzzy 60%+), formatos de número (con/sin guiones,
        // ceros), y diferencias de fecha (mismo mes + total ±2€). Captura
        // muchos más duplicados reales que la clave estricta del Map.
        const existingMeta = findExistingMatch(parsed, albaranes);
        if (existingMeta) {
          setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'duplicate-meta', existing: existingMeta, parsed } } : e));
          return;
        }
        // 2º contra otros del mismo lote (carpeta con repes) — uso clave
        // tolerante (mes en vez de día) para que dos fotos de la misma factura
        // con un día de diferencia leído por la IA se detecten como duplicado.
        const k = dedupeKey(parsed.proveedor, parsed.num, parsed.fecha);
        const inBatch = batchSeen.get(k);
        if (inBatch) {
          const fake: Albaran = {
            id: inBatch.id, date: inBatch.parsed.fecha, prov: inBatch.parsed.proveedor,
            num: inBatch.parsed.num, total: String(inBatch.parsed.total),
          };
          setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'duplicate-meta', existing: fake, parsed } } : e));
          return;
        }
        // 3º nuevo — registrar para que las siguientes hermanas lo detecten.
        // Auto-selección: los fiables (sin reasons + confidence != low) van
        // marcados por defecto. Los dudosos quedan deseleccionados, la usuaria
        // los marca uno a uno tras revisar.
        const reasons = parsed.reviewReasons || [];
        const isReliable = reasons.length === 0 && parsed.confidence !== 'low';
        batchSeen.set(k, { id: entry.id, parsed });
        setEntries(prev => prev.map(e =>
          e.id === entry.id
            ? { ...e, status: { kind: 'new', parsed }, selected: isReliable }
            : e
        ));
      } catch (err: any) {
        const msg = err?.message || 'IA falló';
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'failed', reason: msg } } : e));
      } finally {
        done += 1;
        setProgress({ done, total: initial.length });
      }
    });

    setPhase('review');
  };

  const newOnes = entries.filter(e => e.status.kind === 'new');
  const dupHash = entries.filter(e => e.status.kind === 'duplicate-hash');
  const dupMeta = entries.filter(e => e.status.kind === 'duplicate-meta');
  const failed = entries.filter(e => e.status.kind === 'failed');

  // Sólo guardamos los que están marcados con check (selected). La usuaria
  // controla qué entra al P&L. Los dudosos quedan deseleccionados por defecto;
  // si no los marca, no se guardan (puede volver a subirlos otro día).
  const seleccionados = newOnes.filter(e => e.selected);

  const handleSave = async () => {
    if (seleccionados.length === 0) {
      toast.warning('No hay albaranes seleccionados para guardar. Marca el check en los que quieras incluir.');
      return;
    }
    setPhase('saving');
    try {
      const newData: AppData = JSON.parse(JSON.stringify(data));
      if (!newData.albaranes) newData.albaranes = [];

      for (const e of seleccionados) {
        if (e.status.kind !== 'new') continue;
        // Si la usuaria editó los campos en la pantalla de revisión, esos
        // valores tienen prioridad sobre los originales de la IA.
        const p = (e.editedParsed || e.status.parsed) as ParsedAlbaran;
        const items = (p.lineas || []).map(l => ({
          q: Number(l.q) || 1,
          n: String(l.n || '').trim(),
          t: Num.parse(l.t),
          rate: Number(l.rate) || 0,
          u: String(l.u || 'uds'),
        }));
        const total = p.total || items.reduce((s, it) => s + (Number(it.t) || 0), 0);
        const fecha = p.fecha || new Date().toISOString().slice(0, 10);
        // Timestamp COMPLETO (13 dígitos) en vez de los últimos 6 — permite
        // detectar cuándo se creó por el id si created_at no estuviera disponible.
        const robustId = `alb-${fecha.replace(/-/g, '')}-${Date.now()}-${defaultUnitId}-${e.hash.slice(0, 6)}`;

        // Si la validación detectó problemas (fecha rara, proveedor que parece
        // el receptor, total cero…), marcamos el albarán para revisión. NO
        // bloqueamos su guardado — la usuaria decide después.
        const reasons = p.reviewReasons || [];
        const needsReview = reasons.length > 0 || p.confidence === 'low';
        const newAlbaran: Albaran = {
          id: robustId,
          prov: (p.proveedor || 'DESCONOCIDO').toUpperCase(),
          date: fecha,
          num: p.num || 'S/N',
          total: String(Num.round2(total)),
          items: items as any,
          unitId: defaultUnitId,
          status: needsReview ? 'mismatch' : 'ok',
          invoiced: false,
          paid: false,
          reconciled: false,
          file_hash: e.hash,
          source: 'bulk-images',
          // 🆕 Marca temporal de cuándo se subió a la app (NO la fecha del
          // documento). Sirve para el botón "Borrar lo subido hoy por IA":
          // si la IA leyó mal la fecha del albarán pero lo subimos hoy,
          // este campo permite identificarlo y revertirlo.
          created_at: new Date().toISOString(),
          // Marcadores de revisión: si la IA dudó o detectamos algo raro,
          // la usuaria los ve en el Dashboard "Mal procesados" y los corrige.
          ...(needsReview ? {
            needs_review: true,
            reviewed: false,
            review_reasons: reasons,
            ai_confidence: p.confidence || 'unknown',
          } : {}),
        } as any;
        newData.albaranes.unshift(newAlbaran);
      }
      await onSave(newData);
      toast.success(`✅ ${newOnes.length} albaranes guardados.`);
      reset();
      onClose();
    } catch (err: any) {
      toast.error(`❌ Error al guardar: ${err?.message || 'desconocido'}`);
      setPhase('review');
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[600] flex justify-center items-center p-4 bg-slate-900/70 backdrop-blur-sm"
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }}
          onClick={e => e.stopPropagation()}
          className="bg-white w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Upload className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Subida masiva de albaranes</h3>
                <p className="text-[10px] font-bold text-slate-500 mt-0.5">Sube las imágenes del mes — la app detecta repetidos</p>
              </div>
            </div>
            <button onClick={handleClose} disabled={phase === 'processing' || phase === 'saving'}
              className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition">
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {phase === 'idle' && (
              <div className="space-y-3">
                {/* Zona principal: drop + click para imágenes sueltas */}
                <label
                  onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setIsDragOver(false);
                    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
                  }}
                  className={cn(
                    'block border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition',
                    isDragOver
                      ? 'border-indigo-500 bg-indigo-50/60 scale-[1.01]'
                      : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/30',
                  )}
                >
                  <FileImage className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                  <p className="text-sm font-black text-slate-700">
                    {isDragOver ? 'Suelta las imágenes aquí' : 'Arrastra imágenes o haz clic para elegirlas'}
                  </p>
                  <p className="text-[11px] font-bold text-slate-500 mt-1">JPG, PNG, HEIC… (puedes elegir varias a la vez)</p>
                  <input
                    type="file" multiple accept="image/*" className="hidden"
                    onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
                  />
                </label>

                {/* Atajos: carpeta entera + paste */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="border border-slate-200 bg-white rounded-2xl p-4 text-left hover:border-indigo-400 hover:bg-indigo-50/30 transition flex items-start gap-3"
                  >
                    <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                      <FolderOpen className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800">Subir carpeta entera</p>
                      <p className="text-[10px] font-bold text-slate-500 mt-0.5">Selecciona la carpeta del mes — entran todas las imágenes que contiene</p>
                    </div>
                  </button>
                  {/* Input oculto con webkitdirectory para que el navegador permita
                      seleccionar UNA carpeta y devuelve todos los ficheros que contiene.
                      Es no-estándar pero funciona en Chrome, Edge, Firefox y Safari. */}
                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    // @ts-expect-error webkitdirectory no está en los tipos de React
                    webkitdirectory=""
                    directory=""
                    onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
                  />

                  <div className="border border-slate-200 bg-white rounded-2xl p-4 flex items-start gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                      <Clipboard className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800">Pegar imágenes</p>
                      <p className="text-[10px] font-bold text-slate-500 mt-0.5">Copia las fotos en el explorador y pulsa <kbd className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px]">Ctrl/Cmd + V</kbd> aquí</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {phase === 'processing' && (
              <div className="text-center py-10">
                <Loader2 className="w-10 h-10 text-indigo-500 mx-auto mb-3 animate-spin" />
                <p className="text-sm font-black text-slate-700">Procesando {progress.done} / {progress.total}…</p>
                <p className="text-[11px] font-bold text-slate-500 mt-1">Hash + lectura con IA en paralelo</p>
                <div className="max-w-xs mx-auto mt-4 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}

            {(phase === 'review' || phase === 'saving') && (
              <div className="space-y-5">
                {(() => {
                  const fiables  = newOnes.filter(e => {
                    const p = (e.status as any).parsed as ParsedAlbaran;
                    return (p.reviewReasons || []).length === 0 && p.confidence !== 'low';
                  });
                  const dudosos  = newOnes.filter(e => !fiables.includes(e));
                  return (
                    <>
                      {/* Nuevos FIABLES — grid con thumbnail + datos al lado */}
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex items-center gap-2 mb-3 text-emerald-700">
                          <CheckCircle2 className="w-4 h-4" />
                          <h4 className="text-[11px] font-black uppercase tracking-widest">Nuevos fiables ({fiables.length})</h4>
                        </div>
                        {fiables.length === 0 ? (
                          <p className="text-[11px] font-bold text-slate-400">{newOnes.length > 0 ? 'Ninguno fiable — revisa la lista de dudosos abajo.' : 'No hay albaranes nuevos detectados.'}</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {fiables.map(e => (
                              <ReviewCard key={e.id} entry={e} kind="fiable"
                                onToggleSelected={() => setEntries(prev => prev.map(x => x.id === e.id ? { ...x, selected: !x.selected } : x))}
                                onEdit={(field, value) => setEntries(prev => prev.map(x => {
                                  if (x.id !== e.id) return x;
                                  const base = (x.editedParsed || (x.status as any).parsed) as ParsedAlbaran;
                                  return { ...x, editedParsed: { ...base, [field]: value } };
                                }))}
                                onDiscard={() => setEntries(prev => prev.filter(x => x.id !== e.id))}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Nuevos A REVISAR — mismo grid pero ámbar */}
                      {dudosos.length > 0 && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <div className="flex items-center gap-2 mb-3 text-amber-700">
                            <AlertTriangle className="w-4 h-4" />
                            <h4 className="text-[11px] font-black uppercase tracking-widest">Nuevos a revisar ({dudosos.length})</h4>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {dudosos.map(e => (
                              <ReviewCard key={e.id} entry={e} kind="dudoso"
                                onToggleSelected={() => setEntries(prev => prev.map(x => x.id === e.id ? { ...x, selected: !x.selected } : x))}
                                onEdit={(field, value) => setEntries(prev => prev.map(x => {
                                  if (x.id !== e.id) return x;
                                  const base = (x.editedParsed || (x.status as any).parsed) as ParsedAlbaran;
                                  return { ...x, editedParsed: { ...base, [field]: value } };
                                }))}
                                onDiscard={() => setEntries(prev => prev.filter(x => x.id !== e.id))}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                <Section
                  title={`Repetidos por imagen idéntica (${dupHash.length})`}
                  color="slate"
                  icon={<Copy className="w-4 h-4" />}
                  empty="—"
                  items={dupHash.map(e => ({
                    key: e.id,
                    title: e.file.name,
                    sub: `Ya existe como ${(e.status as any).existing.num} · ${(e.status as any).existing.date}`,
                    hint: 'Misma imagen ya subida',
                  }))}
                />
                <Section
                  title={`Repetidos por nº+fecha+proveedor (${dupMeta.length})`}
                  color="amber"
                  icon={<AlertTriangle className="w-4 h-4" />}
                  empty="—"
                  items={dupMeta.map(e => ({
                    key: e.id,
                    title: (e.status as any).parsed.proveedor || 'Sin proveedor',
                    sub: `Nº ${(e.status as any).parsed.num} · ${(e.status as any).parsed.fecha}`,
                    hint: `Coincide con ${(e.status as any).existing.num} · ${(e.status as any).existing.date}`,
                  }))}
                />
                {failed.length > 0 && (
                  <Section
                    title={`No se pudieron leer (${failed.length})`}
                    color="rose"
                    icon={<AlertTriangle className="w-4 h-4" />}
                    empty="—"
                    items={failed.map(e => ({
                      key: e.id,
                      title: e.file.name,
                      sub: (e.status as any).reason,
                      hint: 'Sube esta imagen a mano',
                    }))}
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer con resumen agregado del lote seleccionado */}
          {(phase === 'review' || phase === 'saving') && (
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              {(() => {
                const totalSel = seleccionados.reduce((s, e) => {
                  const p = (e.editedParsed || (e.status as any).parsed) as ParsedAlbaran;
                  return s + (Number(p?.total) || 0);
                }, 0);
                const totalDeseleccionados = newOnes.length - seleccionados.length;
                return (
                  <div className="flex items-center gap-4 text-[10px] font-bold text-slate-500">
                    <button onClick={handleClose} disabled={phase === 'saving'}
                      className="font-black text-slate-500 hover:text-slate-700 uppercase tracking-widest disabled:opacity-50">
                      Cancelar
                    </button>
                    {seleccionados.length > 0 && (
                      <span className="text-slate-700">
                        <strong className="font-black text-slate-900">{seleccionados.length}</strong> seleccionados ·
                        <strong className="font-black text-slate-900 tabular-nums ml-1">{Num.fmt(totalSel)}</strong>
                      </span>
                    )}
                    {totalDeseleccionados > 0 && (
                      <span className="text-slate-400">
                        ({totalDeseleccionados} sin marcar)
                      </span>
                    )}
                  </div>
                );
              })()}
              <div className="flex items-center gap-2">
                {newOnes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const allSelected = seleccionados.length === newOnes.length;
                      setEntries(prev => prev.map(e =>
                        e.status.kind === 'new' ? { ...e, selected: !allSelected } : e
                      ));
                    }}
                    className="text-[10px] font-black text-slate-600 hover:text-slate-900 uppercase tracking-widest px-3 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-100 transition"
                  >
                    {seleccionados.length === newOnes.length ? 'Desmarcar todos' : 'Marcar todos'}
                  </button>
                )}
                <button onClick={handleSave} disabled={phase === 'saving' || seleccionados.length === 0}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition shadow-lg flex items-center gap-2 disabled:opacity-50">
                  {phase === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Guardar {seleccionados.length} seleccionados
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ── Sección de la pantalla de revisión ─────────────────────────────────────

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; chip: string }> = {
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', chip: 'bg-emerald-100' },
  slate:   { bg: 'bg-slate-50',   border: 'border-slate-200',   text: 'text-slate-600',   chip: 'bg-slate-100'   },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   chip: 'bg-amber-100'   },
  rose:    { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    chip: 'bg-rose-100'    },
};

// ── ReviewCard: tarjeta con thumbnail + datos IA + botón de detalle ────────
//
// La usuaria necesita VER que la IA leyó bien antes de confirmar. Esta tarjeta
// le muestra:
//   - Miniatura de la foto subida (clickable → preview grande)
//   - Datos extraídos por la IA (proveedor, num, fecha, total)
//   - Si es "dudoso", las razones concretas de revisión
//   - Botón "Ver lectura completa" → modal con la imagen GRANDE y el JSON crudo
interface ReviewCardProps {
  entry: FileEntry;
  kind: 'fiable' | 'dudoso';
  onToggleSelected: () => void;
  onEdit: (field: keyof ParsedAlbaran, value: any) => void;
  onDiscard: () => void;
}

const ReviewCard: React.FC<ReviewCardProps> = ({ entry, kind, onToggleSelected, onEdit, onDiscard }) => {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(entry.file);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [entry.file]);

  // Si la usuaria editó algún campo, esos overridean los de la IA.
  const original = (entry.status as any).parsed as ParsedAlbaran;
  const parsed = (entry.editedParsed || original) as ParsedAlbaran;
  const isDudoso = kind === 'dudoso';
  const reasons = parsed?.reviewReasons || [];
  const wasEdited = !!entry.editedParsed;
  const isSelected = !!entry.selected;

  return (
    <>
      <div className={cn(
        'flex items-stretch gap-3 p-2.5 rounded-xl border bg-white relative',
        isSelected ? (isDudoso ? 'border-amber-400 ring-2 ring-amber-100' : 'border-emerald-400 ring-2 ring-emerald-100')
                   : 'border-slate-200 opacity-60',
      )}>
        {/* Checkbox de selección */}
        <button
          type="button"
          onClick={onToggleSelected}
          className={cn(
            'absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition z-10',
            isSelected
              ? (isDudoso ? 'bg-amber-500 border-amber-500' : 'bg-emerald-500 border-emerald-500')
              : 'bg-white border-slate-300 hover:border-slate-400',
          )}
          title={isSelected ? 'Marcado para guardar' : 'Click para incluir'}
        >
          {isSelected && <CheckCircle2 className="w-4 h-4 text-white" />}
        </button>

        {/* Botón descartar (esquina superior derecha) */}
        <button
          type="button"
          onClick={onDiscard}
          className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white border border-slate-300 flex items-center justify-center hover:bg-rose-50 hover:border-rose-300 transition z-10"
          title="Descartar de este lote"
        >
          <X className="w-3 h-3 text-slate-500" />
        </button>

        {/* Thumbnail clickable */}
        <button
          type="button"
          onClick={() => setShowDetail(true)}
          className="w-24 h-24 rounded-lg overflow-hidden bg-slate-100 shrink-0 group relative ml-6 mt-1"
          title="Ver imagen completa y JSON extraído"
        >
          {thumbUrl ? (
            <img src={thumbUrl} alt={entry.file.name} className="w-full h-full object-cover transition group-hover:scale-105" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileImage className="w-6 h-6 text-slate-400" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span className="text-[8px] font-black text-white uppercase">VER</span>
          </div>
        </button>

        {/* Datos extraídos por la IA — EDITABLES inline */}
        <div className="flex-1 min-w-0 mr-6 space-y-1">
          <input
            value={parsed.proveedor || ''}
            onChange={e => onEdit('proveedor', e.target.value)}
            placeholder="— sin proveedor —"
            className={cn(
              'w-full text-xs font-black bg-transparent outline-none border-b border-transparent focus:border-indigo-300 focus:bg-indigo-50/50 px-1 py-0.5 rounded transition',
              !parsed.proveedor && 'text-rose-500 placeholder-rose-400',
            )}
          />
          <div className="flex items-center gap-1">
            <input
              value={parsed.num || ''}
              onChange={e => onEdit('num', e.target.value)}
              placeholder="S/N"
              className="w-24 text-[10px] font-bold bg-transparent outline-none border-b border-transparent focus:border-indigo-300 focus:bg-indigo-50/50 px-1 py-0.5 rounded transition truncate"
            />
            <span className="text-slate-300 text-[10px]">·</span>
            <input
              type="date"
              value={parsed.fecha || ''}
              onChange={e => onEdit('fecha', e.target.value)}
              className={cn(
                'text-[10px] font-bold bg-transparent outline-none border-b border-transparent focus:border-indigo-300 focus:bg-indigo-50/50 px-1 py-0.5 rounded transition',
                !parsed.fecha && 'text-rose-500',
              )}
            />
            <span className="text-slate-300 text-[10px]">·</span>
            <input
              type="number"
              step="0.01"
              value={parsed.total || ''}
              onChange={e => onEdit('total', parseFloat(e.target.value) || 0)}
              placeholder="0.00"
              className={cn(
                'w-20 text-[10px] font-mono font-bold text-right bg-transparent outline-none border-b border-transparent focus:border-indigo-300 focus:bg-indigo-50/50 px-1 py-0.5 rounded transition',
                !parsed.total && 'text-rose-500',
              )}
            />
            <span className="text-[10px] font-bold text-slate-400">€</span>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-bold flex-wrap">
            {parsed.lineas && parsed.lineas.length > 0 && (
              <span className="text-slate-400">{parsed.lineas.length} línea(s)</span>
            )}
            {/* Badge de proveedor IA — pink (Claude) / indigo (Gemini) / etc. */}
            {parsed.aiProvider && (
              <span className={cn(
                'text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded',
                parsed.aiProvider === 'claude' ? 'bg-pink-100 text-pink-700' :
                parsed.aiProvider === 'gemini' ? 'bg-indigo-100 text-indigo-700' :
                parsed.aiProvider === 'mistral' ? 'bg-rose-100 text-rose-700' :
                parsed.aiProvider === 'groq' ? 'bg-emerald-100 text-emerald-700' :
                'bg-slate-100 text-slate-700',
              )} title={`Lectura por ${parsed.aiProvider} (${parsed.aiModel || '?'})`}>
                {parsed.aiProvider === 'claude' ? '🟣 Claude' :
                 parsed.aiProvider === 'gemini' ? '🔵 Gemini' :
                 parsed.aiProvider}
              </span>
            )}
            {parsed.confidence && (
              <span className={cn(
                'text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded',
                parsed.confidence === 'high'   ? 'bg-emerald-100 text-emerald-700' :
                parsed.confidence === 'medium' ? 'bg-amber-100 text-amber-700'    :
                                                  'bg-rose-100 text-rose-700',
              )}>
                IA: {parsed.confidence}
              </span>
            )}
            {wasEdited && (
              <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                ✎ editado
              </span>
            )}
          </div>
          {isDudoso && reasons.length > 0 && (
            <p className="text-[9px] font-bold text-amber-700 truncate" title={reasons.join(' · ')}>⚠️ {reasons.join(' · ')}</p>
          )}
        </div>
      </div>

      {/* Modal de detalle: imagen grande + JSON */}
      {showDetail && thumbUrl && (
        <div
          className="fixed inset-0 z-[10005] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowDetail(false)}
        >
          <div
            className="bg-white max-w-5xl w-full max-h-[90vh] rounded-2xl overflow-hidden flex flex-col md:flex-row"
            onClick={e => e.stopPropagation()}
          >
            <div className="md:w-1/2 bg-slate-900 flex items-center justify-center p-3 max-h-[40vh] md:max-h-none">
              <img src={thumbUrl} alt={entry.file.name} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
            </div>
            <div className="md:w-1/2 flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Lectura de la IA</p>
                  <p className="text-sm font-black text-slate-800 truncate">{entry.file.name}</p>
                </div>
                <button onClick={() => setShowDetail(false)} className="p-2 rounded-lg hover:bg-slate-200 transition"><X className="w-4 h-4 text-slate-500" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Proveedor" value={parsed.proveedor || '—'} highlight={!parsed.proveedor} />
                  <Field label="Nº documento" value={parsed.num || 'S/N'} />
                  <Field label="Fecha" value={parsed.fecha || '—'} highlight={!parsed.fecha} />
                  <Field label="Total" value={Num.fmt(parsed.total)} highlight={!parsed.total} />
                </div>
                {parsed.lineas && parsed.lineas.length > 0 && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Líneas extraídas ({parsed.lineas.length})</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {parsed.lineas.map((l, i) => (
                        <div key={i} className="text-[10px] bg-slate-50 rounded px-2 py-1 flex justify-between gap-2">
                          <span className="font-bold text-slate-700 truncate">{l.q || 1}× {l.n || '—'} <span className="text-slate-400">({l.u || 'uds'})</span></span>
                          <span className="font-mono font-black text-slate-800 shrink-0">{Num.fmt(l.t || 0)} <span className="text-slate-400">({l.rate || 0}%)</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {reasons.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-[10px] font-black uppercase text-amber-800 mb-1">⚠️ Razones de revisión</p>
                    <ul className="text-[10px] font-bold text-amber-700 list-disc list-inside space-y-0.5">
                      {reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                <details className="bg-slate-50 rounded-xl border border-slate-200">
                  <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-slate-500 p-3 hover:bg-slate-100 transition">JSON crudo de la IA</summary>
                  <pre className="text-[9px] font-mono text-slate-700 p-3 pt-0 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(parsed, null, 2)}</pre>
                </details>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const Field: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div className={cn('rounded-lg p-2 border', highlight ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-100')}>
    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">{label}</p>
    <p className={cn('text-xs font-black truncate', highlight ? 'text-rose-700' : 'text-slate-800')} title={value}>{value}</p>
  </div>
);

interface SectionItem { key: string; title: string; sub: string; hint: string }

const Section: React.FC<{
  title: string;
  color: keyof typeof COLOR_MAP;
  icon: React.ReactNode;
  empty: string;
  items: SectionItem[];
}> = ({ title, color, icon, empty, items }) => {
  const c = COLOR_MAP[color];
  return (
    <div className={`rounded-2xl border ${c.border} ${c.bg} p-4`}>
      <div className={`flex items-center gap-2 mb-3 ${c.text}`}>
        {icon}
        <h4 className="text-[11px] font-black uppercase tracking-widest">{title}</h4>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] font-bold text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map(it => (
            <li key={it.key} className={`p-2.5 rounded-lg ${c.chip}`}>
              <p className="text-xs font-black text-slate-800 truncate">{it.title}</p>
              <p className="text-[10px] font-bold text-slate-600 truncate">{it.sub}</p>
              <p className="text-[10px] font-bold text-slate-400 truncate mt-0.5">{it.hint}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
