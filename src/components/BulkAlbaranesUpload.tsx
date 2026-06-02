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
import { Upload, Loader2, X, CheckCircle2, AlertTriangle, Copy, FileImage, FolderOpen, Clipboard, ChevronDown } from 'lucide-react';
import { AppData, Albaran, BusinessUnit, PriceHistoryItem } from '../types';
import { sha256OfFile } from '../services/hashFile';
import { scanBase64, preprocessImageForOCR } from '../services/aiProviders';
import { TrendingUp } from 'lucide-react';
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

interface ParsedLinea {
  q?: number;
  n?: string;
  u?: string;
  unitPrice?: number;   // base unitaria sin IVA
  base?: number;        // q × unitPrice
  rate?: number;        // 4 / 10 / 21
  iva?: number;         // base × rate/100
  t?: number;           // base + iva (total con IVA)
  descuento?: number;   // descuento de la línea, 0 si no hay
  total?: number;       // alias legacy de t (algunas IAs lo devuelven así)
}

interface ParsedTotales {
  base?: number;        // suma de bases imponibles - descuento global
  iva?: number;         // suma del IVA
  total?: number;       // base + iva (o base sólo si recargoEquivalencia)
  descuento?: number;   // descuento global del documento
  // Régimen especial: si el TOTAL ALBARÁN del documento no incluye el IVA
  // (tipo Frutas Daniel donde IMPORTE = TOTAL = suma de bases). En este caso
  // el motor sabe que para reconciliar con la factura mensual hay que
  // sumar el IVA aparte.
  recargoEquivalencia?: boolean;
  by_rate?: Record<string, { base: number; iva: number; total: number }>;
}

interface ParsedAlbaran {
  proveedor: string;
  num: string;
  fecha: string;
  total: number;        // total con IVA (alias de totales.total para compatibilidad)
  totales?: ParsedTotales;
  lineas: ParsedLinea[];
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
// razones para marcar needs_review. Además detecta automáticamente el
// régimen especial (recargo equivalencia) cuando el total del documento
// = suma de bases sin IVA.
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
  } else if (/\b(arume|agnes|agnès|sake bar|company fernandez|celoso de palma)\b/i.test(provLower)) {
    reasons.push('Proveedor parece ser el receptor (Arume), no el emisor');
  }
  // Total
  if (!p.total || p.total <= 0) {
    reasons.push('Total no leído o cero');
  } else if (p.total > 100000) {
    reasons.push('Total sospechosamente alto');
  }

  // Cuadre matemático: la suma de líneas debe coincidir con el total ±0.50€
  // (margen para redondeos del proveedor). Si difiere mucho, la IA leyó mal
  // alguna cifra. Detectamos también el régimen especial sin IVA aplicado
  // (caso Frutas Daniel donde TOTAL = base sin sumar IVA).
  if (Array.isArray(p.lineas) && p.lineas.length > 0 && p.total > 0) {
    const sumBase = p.lineas.reduce((s, l) => s + (Number(l.base) || 0), 0);
    const sumIva  = p.lineas.reduce((s, l) => s + (Number(l.iva)  || 0), 0);
    const sumT    = p.lineas.reduce((s, l) => s + (Number(l.t)    || 0), 0);

    const diffConIva = Math.abs(sumT - p.total);
    const diffSinIva = Math.abs(sumBase - p.total);

    if (diffSinIva < 0.5 && diffConIva > 1) {
      // El total del documento coincide con la suma de BASES — no se sumó el IVA.
      // Es el régimen especial (recargo equivalencia) — marcamos en totales y
      // NO añadimos esto como razón de revisión, es legítimo en hostelería.
      if (p.totales) {
        p.totales.recargoEquivalencia = true;
        // En este caso el IVA real es la suma de IVAs por línea, aunque no
        // esté incluido en el total facturado. La factura mensual ya lo
        // sumará por separado.
        if (!p.totales.iva || p.totales.iva === 0) p.totales.iva = Num.round2(sumIva);
      }
    } else if (diffConIva > 1.0 && diffSinIva > 1.0) {
      reasons.push(`Total no cuadra con líneas: doc=${p.total.toFixed(2)} vs líneas c/IVA=${sumT.toFixed(2)} (diff ${diffConIva.toFixed(2)}€)`);
    }
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
  retryCount?: number;
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

// Rota un base64 JPEG 90/180/270 grados en sentido horario y devuelve el
// nuevo base64. Útil cuando la primera lectura sale mal porque la foto
// estaba físicamente girada (no EXIF). Lo usamos solo como auto-retry.
const rotateBase64Image = async (base64: string, degrees: 90 | 180 | 270): Promise<string> => {
  const blob = await fetch(`data:image/jpeg;base64,${base64}`).then(r => r.blob());
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement('canvas');
  if (degrees === 180) { canvas.width = w; canvas.height = h; }
  else                  { canvas.width = h; canvas.height = w; }
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return base64;
  ctx.imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(bitmap, -w / 2, -h / 2);
  const rotatedBlob: Blob = await new Promise(res => canvas.toBlob(b => res(b as Blob), 'image/jpeg', 0.9));
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('No se pudo rotar imagen'));
    reader.readAsDataURL(rotatedBlob);
  });
};

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

const PROMPT = `Eres un OCR contable EXPERTO en albaranes y facturas comerciales españoles para un restaurante japonés (Arume Sake Bar). Lee el documento DOS VECES antes de responder: una para entender la estructura, otra para extraer cifras exactas.

En hostelería conviven en la MISMA factura productos con IVA distinto:
  - 4%  → pan, leche, huevos, frutas/verduras frescas, harinas, cereales
  - 10% → la mayoría de alimentos (carne, pescado, conservas, aceite, pasta), bebidas no alcohólicas, agua
  - 21% → bebidas alcohólicas (vino, cerveza, sake, licores, destilados), refrescos azucarados, productos no alimentarios, material de limpieza, menaje

Lee cada línea con su IVA correcto. NO asumas que toda la factura tiene un único tipo de IVA.

Analiza este documento y devuelve SOLO JSON sin markdown ni texto antes/después.

ESQUEMA EXACTO:
{
  "proveedor": "string|null",
  "nif": "string|null",
  "num": "string|null",
  "fecha": "YYYY-MM-DD|null",
  "lineas": [
    {
      "q": number,                  // cantidad
      "n": "string",                // descripción tal cual
      "u": "string",                // unidad (kg/l/ud/caja/botella…)
      "unitPrice": number,          // precio unitario SIN IVA (base imponible / cantidad)
      "base": number,               // base imponible de la línea = q × unitPrice
      "rate": 4|10|21,              // tipo IVA aplicado a esta línea
      "iva": number,                // importe IVA de la línea = base × rate/100
      "t": number,                  // total línea con IVA = base + iva
      "descuento": number,          // 0 si no hay; si lo hay, importe en €
      "incidencia": "string|null"   // null si OK. Si hay problema → texto breve (ver INCIDENCIAS)
    }
  ],
  "totales": {
    "base":            number,       // suma de bases imponibles
    "iva":             number,       // suma de IVA
    "total":           number,       // base + iva = total con IVA del documento
    "descuento":       number,       // descuento global aplicado al pie (0 si no hay)
    "irpf":            number,       // retención IRPF si aparece (negativo, p.ej. -15.00), 0 si no hay
    "by_rate": {                     // desglose por tipo de IVA
      "4":  { "base": number, "iva": number, "total": number },
      "10": { "base": number, "iva": number, "total": number },
      "21": { "base": number, "iva": number, "total": number }
    }
  },
  "alertas": [],                     // array de strings con incidencias detectadas (ver INCIDENCIAS)
  "tipo_documento": "albaran"|"factura"|"abono"|"nota_entrega",
  "confidence": "high"|"medium"|"low"
}

REGLAS — léelas TODAS antes de responder:

═══ PROVEEDOR + NIF ═══
El EMISOR (quien VENDE y emite el documento). El receptor SIEMPRE es "Arume Sake Bar" / "Arume" / "Agnès Company" / "AGNES COMPANY FERNANDEZ" / "CELOSO DE PALMA SL" / un CIF tipo X4XXXXXXXX — NUNCA es el proveedor, es la receptora.

✅ Cómo encontrarlo: busca en la CABECERA (parte superior izquierda normalmente) el nombre + CIF del emisor. En tickets/albaranes térmicos el emisor suele estar arriba con dirección. Devuelve el nombre legal completo, incluyendo "SL", "SA", "SLU", "CB" si los pone.
✅ NIF/CIF: extrae el CIF/NIF del EMISOR (formato: B12345678, A12345678, etc.). Si no es visible → null.

✅ Ejemplos: "MAKRO IBÉRICA SAU", "Llorenç Cerdà Obrador SL", "Pescaderías Chiringuito SL", "TOKYO-YA, S.A.", "PESCADOS MAR ESTE SL".
❌ NUNCA devuelvas "Arume", "Agnès", "Sake Bar", "Celoso de Palma" como proveedor.

═══ FECHA ═══
Fecha de EMISIÓN del documento (NO pago, NI vencimiento, NI entrega).
✅ Formato OBLIGATORIO: YYYY-MM-DD con año de 4 dígitos. "06/05/2026" → "2026-05-06". Año esperado: 2024-2026.
❌ Si dos fechas, prefiere la de emisión. Si no es clara → null. NUNCA inventes.

═══ NUM ═══
Referencia única ("Nº Albarán", "Factura nº", "Doc.", "Ref.", "F-", "A-"…). Tal cual aparece con guiones y letras. Si no hay → "S/N".

═══ LINEAS — DESGLOSE OBLIGATORIO POR LÍNEA ═══
Para CADA producto:
- q = cantidad numérica (no string).
- n = descripción tal como aparece.
- u = unidad ("kg", "l", "ud", "uds", "caja", "botella", "pack"...). "uds" por defecto.
- unitPrice = precio unitario SIN IVA (la base imponible por unidad). En hostelería el albarán suele dar precio sin IVA en la columna principal y aplica IVA al pie.
- base = q × unitPrice (siempre sin IVA)
- rate = tipo IVA correcto para ESA línea: 4 (pan, leche, fruta…), 10 (carne, pescado, refrescos sin alcohol…), 21 (alcohol, refrescos azucarados, productos no alimentarios).
- iva = base × rate / 100
- t = base + iva (total línea con IVA)
- descuento = importe en € si la línea trae descuento individual, 0 si no.

ATENCIÓN: si la columna "Precio" del albarán es CON IVA en vez de sin IVA, debes:
  unitPrice = precioConIva / (1 + rate/100)   y luego base = q × unitPrice.
Decide qué columna mira según las cabeceras del albarán ("Precio neto", "Precio s/IVA", "PVP", "Importe sin IVA"…).

═══ TOTALES — IMPORTANTE ═══
- "base"  = suma de todas las líneas.base − descuentos globales si los hay
- "iva"   = suma de todas las líneas.iva
- "total" = base + iva
- "descuento" = importe del DESCUENTO GLOBAL al pie (0 si no hay)
- "by_rate" = desglose por tipo de IVA. Ejemplo:
    - 5 productos al 10% → by_rate.10 = { base: 50, iva: 5, total: 55 }
    - 2 botellas vino al 21% → by_rate.21 = { base: 20, iva: 4.20, total: 24.20 }
    - by_rate.4 = { base: 0, iva: 0, total: 0 } si no hay nada al 4%
- VERIFICA: la suma de las claves de by_rate debe igualar (base, iva, total). Si no cuadra al céntimo, ajusta los valores que peor leíste.

═══ CONFIDENCE ═══
- "high" = todo legible, IVAs claros, totales cuadran al céntimo
- "medium" = falta algún detalle o totales no cuadran exactamente
- "low" = foto borrosa o tienes dudas → la app marca el albarán para revisión

═══ POLÍTICA ANTI-INVENCIÓN ═══
PREFERIBLE devolver null/0 que inventar. Si no ves la columna de IVA por línea, intenta deducirlo del producto (alcohol→21, alimentación→10) pero marca confidence="medium". Si dudas con varios IVAs en una factura mixta, marca "low".

═══ PROVEEDORES HABITUALES — APRENDE SUS FORMATOS ═══

PROVEEDOR 1 — HIJOS DE RAMÓN OLIVER SL (CIF B-07020134) — Distribuciones HR Oliver
- Marca: "HR OLIVER DISTRIBUCIONES" con logo. También distribuye IL GROTTO, Natura Dolç, DISTNURA, La Casa Italiana.
- Tipo: FACTURA (no albarán). Nº Factura tipo "YF-0003302".
- Columnas: KG/Und, Mercancías, Formato-Und, Cajas, Artículo, Precio, %Dto %Dto, Neto %IVA, Importe.
- Categorías: "02 - REFRIGERADO", "05 - ASIATICO SECO", "07 - ASIATICO CONGELADO".
- "Neto" = unitPrice sin IVA. "%IVA" = tipo IVA (4.00, 10.00, 21.00). "Importe" = base línea.
- Pie: "Total Bases → Base Imp. / IVA % / Imp. IVA → TOTAL €".
- IVA mixto: ARROZ SUSHI 4%, PURE MARACUYA 10%, SUSHI YOKI 21%, YAKINORI 10%.
- Forma pago: "30 DIAS FECHA FACTURA(TRANS)". Vencimiento separado de fecha emisión.
- Ejemplo real: Base 10%=97.20 IVA=9.72 / Base 4%=82.89 IVA=3.32 / Base 21%=7.52 IVA=1.58 → TOTAL 202.23

PROVEEDOR 2 — CERDÀ OBRADOR ALIMENTACIÓ SL (CIF B57836157) — Llorenç Cerdà
- Tipo: ALBARÁN. Nº tipo "26118/64/3".
- Columnas: Concepto (+ código), Cant., IVA (4 o 10), Precio, Dto, Importe.
- Pie: Importe bruto, Descuentos, Importe neto, Base Imponible, %IVA, Cuota IVA, Recargo Equiv., Total Albarán.
- Productos típicos: CAVIAROLI YUZU, EF. MOSTAZA DIJON, PATO MUSLO CONFITADO, FOIE MI-CUIT TARRINA, FOIE PATO ESCALOPADO, MEMBRILLO CODONYAT, COLORANTE LACA VERDE.
- IVA mixto: alimentación=10%, colorantes/aditivos=10%.
- Ejemplo real: Base 300.31 / IVA 10%=30.03 / Recargo Equiv.=0 → Total 330.34.

PROVEEDOR 3 — CARMEN PEIX I MARISC SL (CIF B57941379) — Pescadería
- Tipo: ALBARÁN. Nº tipo "CC-0056864".
- Columnas: Ref., Cant., Unid. (KG/UND), Detalle, Precio, (IVA%), Importe.
- ⚠️ El % IVA aparece EN la tabla de líneas (columna entre Precio e Importe).
- Pie: Base Imp. / IVA % / Imp. IVA → TOTAL €.
- Productos típicos: GAMBA PEQUEÑA, HUEVAS TRUCHA, SEPIA SUSHI, LECHE COCO, EDAMAME PREMIUM, PALILLOS BAMBU, ANGUILA KABAYAKI, KAISO SALAT.
- IVA mixto: pescado/marisco=10%, edamame=4%, palillos bambú=21%.
- Ejemplo real: Base 10%=111.00 IVA=11.10 / Base 4%=11.20 IVA=0.45 / Base 21%=11.40 IVA=2.39 → TOTAL 147.54.

PROVEEDOR 4 — FRUTAS DANIEL PALMA SL (CIF B09857624) — Frutas y verduras
- Tipo: ALBARÁN con marca de agua "COPIA" (es normal, es la versión del cliente).
- Nº tipo "32139/1" ó "35638/1".
- Columnas: Código, Trazabilidad, Descripción, Cantidad, Precio, IVA (4 o 10), Total.
- ⚠️ RÉGIMEN ESPECIAL: TOTAL ALBARÁN = Suma de IMPORTE (= suma de bases). IVA NO sumado al total.
- Pie: IMPORTE / BASE IMPONIBLE (desglosada por rate 4% y 10%) / TOTAL ALBARÁN = IMPORTE.
- Productos típicos: PEPINO HOLANDES, GERMINADO ALFALFA, RABANITO, TOMATE CHERRY, COLIFLOR, TOMATE SECO, MANGO EXTRA, CEBOLLINO, LECHUGA FRANCESA, HUEVOS L, MICROBROTES LEMON BALM, GERMINADO RABANITO, CILANTRO, HIERBABUENA, ALBAHACA, PATATA AGRIA.
- IVA: frutas/verduras=4%, hierbas aromáticas (cebollino, hierbabuena, albahaca)=10%.
- Ejemplo real: Importe=54.65 / Base 4%=52.49 / Base 10%=2.16 → TOTAL ALBARÁN=54.65 (sin IVA).

PROVEEDOR 5 — VOLDISTRIBUCION BALEARES SAU (CIF A07104524) — Voldis, bebidas
- Tipo: ALBARÁN. Nº tipo "AP26-040935".
- Columnas: Código, Descripción, Cant., Precio unitario, % Descuento, Identif. ic. IVA, Eco tasa, Importe.
- ⚠️ DESCUENTOS EN % por línea: "40.7%", "59%", "100%". El Importe YA tiene descuento aplicado.
- Pie: Base / RE% IVA / Imp. IVA / % RE / Imp. RE → TOTAL.
- Sección "ABONOS / CARGOS" al final (puede tener notas manuscritas).
- Línea "Servicio" = cargo de servicio (IVA 21%).
- Productos típicos: AGUA SOLAN DE CABRAS, AGUA SIERRA NATURA, ALHAMBRA RESERVA 1925 BARRIL 30L, SAN MIGUEL 0.0 TOSTADA.
- IVA: agua=10%, cerveza/alcohol=21%, servicio=21%.
- Forma pago: "Crédito cliente mensual".
- Ejemplo real: Base 10%=40.46 IVA=4.05 / Base 21%=100.76 IVA=21.16 → TOTAL 166.43.

PROVEEDOR 6 — GOURMET Delicatessen y Complementos (CIF B02779494) — Productos gourmet
- ⚠️ ALBARÁN MANUSCRITO en papel rosa/carbonado.
- Escrito a mano: nombre cliente, producto, cantidad. Sin precios ni totales.
- Ejemplo: "1 caja de ostras Gillardeau Nº3/480 Lot: 26/05"
- En estos casos: proveedor="GOURMET DELICATESSEN Y COMPLEMENTOS", nif="B02779494", total=0 (no visible), confidence="low".
- La usuaria completará el precio manualmente.

═══ FOTOS ROTADAS — CUALQUIER PROVEEDOR ═══
Cualquier albarán puede llegar rotado 90°, 180° o 270° (fotos de móvil). Si el texto aparece de lado o al revés, gira mentalmente y lee igualmente. La app intentará auto-rotar si la primera lectura falla.

═══ RECEPTORES CONOCIDOS (NUNCA son el proveedor) ═══
Todos pertenecen a la misma sociedad CELOSO DE PALMA SL (CIF B16554230), pero son DOS restaurantes distintos:
- "ARUME SAKE BAR" / "ARUME" → Avda Argentina 6, 07013 Palma (restaurante japonés)
- "SAKE BAR SHOP" / "OBRADOR" → C/ Cataluña 5, 07011 Palma (tienda de sakes y obrador)
- "CELOSO DE PALMA SL" / "CELOSO DE PALMA S.L." (CIF B16554230) → sociedad titular de Arume y Sake Bar Shop
- "RACOBLANQUERNA SL" / "RACO BLANQUERNA" / "RACO" / "RESTAURANTE RACO" (CIF B27538149) → C/ Blanquerna 12, 07003 Palma (segundo restaurante, otra SL)
- "BURC HAMBURGUESERIA SL" / "BURC" (CIF B67807479) → Arenal 29, Palma (marca asociada, misma propiedad)
- "AGNES COMPANY FERNANDEZ" / "AGNÈS COMPANY" → la propietaria de ambas sociedades
- Otra dirección posible: "Jeroni Pl Weyler 2" (dirección alternativa de entrega)
- Si ves CUALQUIERA de estos nombres, CIFs o direcciones → es el CLIENTE/RECEPTOR, busca el proveedor en otra parte del documento.

═══ FORMATO DE PRECIO POR PROVEEDOR — CÓMO INTERPRETARLO ═══

Mira las cabeceras de columnas SIEMPRE. Patrones habituales:
- HR Oliver: "Neto %IVA + Importe" → Neto=unitPrice, %IVA=tipo, Importe=base línea.
- Carmen Peix: "Precio + (IVA%) + Importe" → Precio=unitPrice, Importe=Cant×Precio (sin IVA). IVA en pie.
- Llorenç Cerdà: "Precio + Dto + Importe" → Precio=unitPrice, Importe=base.
- Frutas Daniel: "Precio + IVA + Total" → Precio=unitPrice, Total=Cant×Precio. RÉGIMEN ESPECIAL: total albarán = bases.
- Voldis: "Precio unitario + %Descuento + Importe" → Importe ya con descuento aplicado. Descuentos en %.
- Gourmet: MANUSCRITO → extraer lo que se pueda, confidence="low".
- Consignaciones del Mar: "Bultos + Kilos + Descripción + Precio + DTO (manuscrito!) + Importe". DTO es descuento ESCRITO A MANO sobre el precio impreso.
- García (Fernando y Tomas): "Origen + Descripción + Cantidad + Precio + Bultos + Importe + %IVA". Pie con B. Imponible desglosada + Imp.IVA + % REC (recargo equiv.).
- Nota de entrega manuscrita (hielo, etc.): papel rosa/carbonado, todo a mano. Extraer lo visible, confidence="low".
- Alvarez Equipment: cubertería/menaje — "Nota de entrega" SIN PRECIOS. Solo cantidades. No es factura, es albarán de entrega. total=0, confidence="low".
- Coca-Cola: BILINGÜE catalán/español. "NOTA ENTR." con "Dto. Fijo" + "Punto Verde" + "SUBUNIDADES/NETO". Refrescos=21%. Pie: "BASE IMPOSABLE/BASE IMPONIBLE + % IMPOST + IMPORT → TOTAL".

═══ DOCUMENTOS MANCHADOS / DAÑADOS ═══
Los albaranes llegan de la cocina: pueden tener manchas de agua, grasa, salpicaduras. Las marcas de agua "COPIA" son normales (es la copia del cliente). Ignora manchas y lee el texto que sea legible. Si un número es ilegible por mancha → marca confidence="medium" y pon tu mejor estimación.

═══ PROVEEDORES ADICIONALES DE RACO BLANQUERNA ═══

PROVEEDOR 7 — CONSIGNACIONES DEL MAR SA (CIF A08120149) — Pescado Mercabarna
- Tipo: ALBARÁN DE ENTREGA. Nº tipo "00/26/9468".
- Columnas: Bultos, Kilos, Código, Ref. Cliente, Descripción, Precio EUR, DTO, Importe EUR.
- ⚠️ DESCUENTO MANUSCRITO: la columna DTO tiene valores ESCRITOS A MANO con bolígrafo sobre el papel impreso. Puede ser difícil de leer.
- Pie: Base Imp. / IVA / Imp. IVA → Total. Luego "Total Albarán EUR".
- Productos: BACALAO LOMOS 5KG, TARTAR GAMBA BCA 20X80G, ANILLA ENHARINADA 1.5KG.
- IVA: todo pescado/marisco = 10%.
- Ejemplo real: Base 157.50 / IVA 10% / Imp. IVA 15.75 → Total 173.25.

PROVEEDOR 8 — FERNANDO Y TOMAS SL (CIF B97686364) — García Frutas & Verduras
- Marca: "GARCÍA FRUTAS & VERDURAS" con logo. Razón social "FERNANDO Y TOMAS, S.L."
- Tipo: ALBARÁN. Nº tipo "B/264298".
- Columnas: Origen, Descripción, Cantidad, Precio, Bultos, Importe, %IVA.
- Pie: Importe Neto / B. Imponible desglosada (% IVA + Imp.IVA + % REC + Imp.REC) → Total Albarán.
- ⚠️ Cantidades con peso real: "0,990k" = 0.99 kg, "0,440k" = 0.44 kg.
- Productos: JENGIBRE, FRUTA DE LA PASION.
- IVA: jengibre=10%, fruta de la pasión=4%.
- Ejemplo real: Base 10%=3.94 IVA=0.39 / Base 4%=6.38 IVA=0.26 → Total 10.97.

PROVEEDOR 9 — ALVAREZ EQUIPMENT & SOLUTIONS SA (CIF A07145881) — Menaje/cubertería
- Tipo: NOTA DE ENTREGA (no albarán contable). Nº tipo "67511".
- ⚠️ SIN PRECIOS: solo lista de productos con cantidades. No hay columna de precio ni total.
- Columnas: Pos., Referencia, Producto, Cantidad, Peso, Volumen, Notas.
- Productos: cubertería BCN COLORS (cuchillo, cuchara, tenedor mesa/postre/pescado/café/moka) NEGRO INOX.
- En estos casos: total=0, confidence="low". La factura llegará por separado.

PROVEEDOR 10 — HIELO / NOTA MANUSCRITA (sin razón social)
- Tipo: NOTA DE ENTREGA manuscrita en papel rosa/carbonado.
- Fecha escrita a mano: "30 de 5 de 26" = 2026-05-30.
- Cliente escrito: "RACO".
- Líneas ejemplo: "5 SACOS HIELO → 22.00", "1 SACO PICADO → 5.50", "IVA", total "27.50".
- ⚠️ Sin proveedor formal (no hay nombre empresa ni CIF). proveedor="HIELO" o null.
- IVA: hielo=10%. El "IVA" escrito a mano indica que el total INCLUYE IVA.
- confidence="low" obligatorio.

PROVEEDOR 11 — COCA-COLA EUROPACIFIC PARTNERS (Esplugues de Llobregat, Barcelona)
- Tipo: NOTA ENTR. (Nota de Entrega). Nº tipo "4529975289".
- BILINGÜE CATALÁN/ESPAÑOL: cabeceras en ambos idiomas ("DOCUMENT/DOCUMENTO", "QUANTITAT/CANTIDAD", "PREU/PRECIO", "IMPORT/IMPORTE").
- Columnas: Código EAN, Art., Descripción, Cantidad, Preu/Precio, Base Dto., Import/Importe.
- DESCUENTOS COMPLEJOS: "Dto. Fijo" (descuento fijo en €) + "Punto Verde" (ecotasa 0.02€/ud) + "SUBUNIDADES/NETO" (precio neto por subunidad).
- Pie: "BASE IMPOSABLE/BASE IMPONIBLE" + "% IMPOST/% IMPUESTOS" + "IMPORT/IMPORTE" → "TOTAL: XX,XX Euros".
- Productos: COCACOLA VR237 C24, COCACOLA ZERO, FANTA, AQUARIUS, etc.
- IVA: TODOS los refrescos Coca-Cola = 21% (bebidas azucaradas/edulcoradas).
- Ejemplo real: Base 35.94 / IVA 21%=7.55 → TOTAL 43.49.

PROVEEDOR 12 — LICORS MOYÀ 1890 SL (CIF B07126550) — Licorería Artà, Mallorca
- Tipo: FACTURA. Nº tipo "012600010632".
- Cabeceras en CATALÁN: "CD/AR", "ARTICLE", "UNIT.", "PVP", "IVA", "R.EQV", "IMPORT".
- Productos: vinos (ÀNIMA NEGRA AN/2, TERRAS GAUDA), ginebra (HENDRICKS, SEAGRAMS), ron (BARCELÓ, AMAZONA), grappa, whisky.
- ARTÍCULOS EN PROMOCIÓN: líneas con importe NEGATIVO (descuento).
- IVA: TODO alcohol = 21%. Columna R.EQV = recargo equivalencia.
- Cliente: RACOBLANQUERA SL / NOM COMERCIAL: RTE. ES RACO.

PROVEEDOR 13 — CAN XISCO ORDINAS DISTRIBUCIONS SA (CIF A82725853) — Distribución bebidas
- Tipo: FACTURA. Formato puede llegar ROTADO 180° (al revés).
- Productos: whisky (Japanese Harmony, Monkey Shoulder), gin (Hendrix), vodka (Absolut), ron (Matusalem), Cointreau, Amaretto.
- Descuentos en % por línea + RE (recargo equivalencia).
- IVA: TODO 21% (alcohol).
- Pie: "Total EUR excl." + IVA + RE → "Total EUR IVA incl."

PROVEEDOR 14 — ECOMÓN HIGIENE PROFESSIONAL / GRUPO GENA (Polígon Son Rossinyol, Palma)
- Tipo: FACTURA. En CATALÁN: "COD", "CAIXES", "DESCRIPCIÓ", "FORMAT", "PREU UD", "UNITATS", "Preu €", "P. TOTAL €".
- Productos: limpieza/higiene — fregona, palo titanio, recogedor, cepillo, cubo fregona, roll omap, limpiacristales, bolsa basura, contenedor basura, estropajo, bayeta, dosificador.
- IVA: TODO 21% (productos no alimentarios/limpieza).
- Puede tener sello "NUEVA RAZÓN SOCIAL".
- Cliente: RACO BLANQUERNA SL / TOLO.

PROVEEDOR 15 — TOKYO-YA SA — Alimentación japonesa al por mayor
- Tipo: ALBARÁN. Nº tipo "E2026P/21000989".
- Columnas: REF, Descripción, CANT., UM, PRECIO, % DTO, IMPORTE.
- ⚠️ "TOTAL(s/IVA)" = total SIN IVA. El IVA se factura aparte.
- Productos: Kimuchi Congelado, Sushi Su De Uk Mizkan, sake Daishichi Junmai Kimoto, Gekkeikan.
- IVA: kimuchi/vinagre=10%, sake=21%.
- Peso Bruto indicado. Transporte = 0,00 si incluido.
- Forma de pago: TRANSFERENCIA CLIENTES.

PROVEEDOR 16 — AGROMART BALEAR SL (CIF B57853419) — Huevos km0, Porreres
- Tipo: FACTURA rotada 90°. Nº tipo "2600038/191F".
- Producto típico: OUS FRESCS M KM0 (huevos frescos).
- IVA: huevos = 4%. Descuento 5%.
- Forma de pago: "EFECTIU C/CATALUNYA" (pago efectivo en Sake Bar Shop).

═══ INCIDENCIAS — DETECCIÓN CRÍTICA ═══
BUSCA en el documento CUALQUIERA de estas señales y repórtalas en "alertas" y en lineas[].incidencia:

1. DEVOLUCIONES / ABONOS:
   - Cantidad NEGATIVA (ej: Cant. = -1.00) → es una devolución/retorno. Pon q negativo.
   - Importe NEGATIVO → es un abono. El total del albarán se reduce.
   - Documento tipo "ABONO" o "NOTA DE CRÉDITO" → tipo_documento="abono".
   - Ejemplo real (Voldis): "SCHWEPPES NARANJA ZERO -1.00 → -15.29€"

2. PRODUCTOS NO ENTREGADOS:
   - "PEDIDO PENDIENTE SERVICIO" (HR Oliver) → producto pedido pero NO llegó.
   - "NO TRAÍDO", "FALTA", "PENDIENTE", "NO SERVIDO", "AGOTADO", "SIN STOCK"
   - Líneas tachadas con bolígrafo.
   - Si detectas esto → incidencia="NO ENTREGADO" en la línea + alerta global.

3. PESO INCORRECTO:
   - Anotación manuscrita tipo "PESO REAL: 1.2kg" junto a un peso impreso diferente.
   - Tachón sobre la cantidad impresa con otro número escrito a mano.
   - "DIFERENCIA PESO", "PESO MAL", "RECTIFICADO"
   - Si detectas → incidencia="PESO RECTIFICADO: [valor manuscrito]" + alerta.

4. PRECIO EQUIVOCADO:
   - Precio impreso tachado con otro precio escrito a mano.
   - "PRECIO INCORRECTO", "PRECIO MAL", "RECTIFICAR PRECIO"
   - Si un precio manuscrito sobreescribe uno impreso → USA EL MANUSCRITO y marca incidencia="PRECIO RECTIFICADO: impreso [X] → manuscrito [Y]".

5. DESCUENTOS MANUSCRITOS:
   - "DTO" escrito a boli (Consignaciones del Mar escribe descuentos a mano).
   - Porcentajes o importes escritos a mano en la columna DTO.
   - Si detectas → aplica el descuento y marca incidencia="DTO MANUSCRITO: [valor]".

6. NOTAS Y OBSERVACIONES:
   - "DEBE" escrito a mano → pendiente de pago. Alerta: "PENDIENTE DE PAGO".
   - "PAGADO", "COBRADO" → ya pagado. Alerta: "PAGADO EN EFECTIVO" o similar.
   - "URGENTE", "RECLAMAR", "LLAMAR" → alerta con el texto.
   - Cualquier nota a boli que no sea una firma → transcríbela en alertas.

7. TOTAL SIN IVA (s/IVA):
   - "TOTAL(s/IVA)" o "Total sin IVA" → el total NO incluye IVA. Alerta: "TOTAL SIN IVA - factura pendiente".
   - Esto pasa con Tokyo-Ya y algunos distribuidores.

REGLA DE ORO: Si ves CUALQUIER anotación manuscrita que no sea la firma de "Conforme Cliente", REPÓRTALA en alertas. Es mejor avisar de más que perder una incidencia. La dueña revisa estas alertas para reclamar a proveedores.

DOCUMENTOS MANCHADOS / DAÑADOS:
Los albaranes llegan de la cocina: pueden tener manchas de agua, grasa, salpicaduras. Las marcas de agua "COPIA" son normales (es la copia del cliente). Ignora manchas y lee el texto legible. Si un número es ilegible → marca confidence="medium".

VERIFICA SIEMPRE: la suma de líneas debe igualar lo que muestra el pie. Si no cuadra al céntimo, mira si confundiste qué columna era unitPrice vs total. Si tras intentar sigue sin cuadrar, marca confidence="medium" o "low".

═══ IRPF / RETENCIONES ═══
Algunas facturas de profesionales (asesores, freelancers) incluyen retención IRPF:
- "IRPF -15%", "Retención 15%", "Ret. IRPF"
- El importe es NEGATIVO y se resta del total a pagar.
- Ejemplo: Base 500 + IVA 105 - IRPF 75 = Total a pagar 530
- Extrae el valor como número negativo en totales.irpf (ej: -75.00)
- Si NO hay retención IRPF → irpf = 0

═══ ERRORES FRECUENTES A EVITAR ═══
1. NO confundir "cantidad servida" con "cantidad pedida" — usa la SERVIDA.
2. NO confundir decimales: "1.234,56" es mil doscientos treinta y cuatro con 56 céntimos (formato español). "1,234.56" es formato inglés — muy raro en España.
3. Los precios en albaranes españoles SIEMPRE usan coma decimal: 12,50€ = doce euros con cincuenta.
4. Si ves "dto" o "desc" en una línea, es descuento — calcula la base DESPUÉS del descuento.
5. Si una factura tiene "Portes" o "Transporte" como línea, es un servicio al 21%.
6. "Embalajes" o "Envases retornables" al 21%.
7. Hielo, cubitos: 10% (alimentación).

═══ VALIDACIÓN FINAL ═══
Antes de responder, verifica:
✅ Σ(lineas.base) ≈ totales.base (±0.02€ por redondeo)
✅ Σ(lineas.iva) ≈ totales.iva (±0.02€)
✅ totales.total ≈ totales.base + totales.iva - |totales.irpf| (±0.05€)
✅ by_rate totales cuadran con la suma de líneas de cada rate
✅ Cada linea.t ≈ linea.base + linea.iva (±0.01€)
Si algo no cuadra, RE-LEE el documento y ajusta. Si sigue sin cuadrar → confidence="medium".`;

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

    // Concurrencia 3: Z.AI (gratis) absorbe la primera oleada. Si falla CORS,
    // el circuit breaker lo desactiva 30min y el resto va por Claude/Gemini.
    // Con 3 en paralelo + circuit breaker no se satura.
    await runWithLimit(pendientes, 3, async (entry) => {
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'scanning' } } : e));
      try {
        // mimeType siempre image/jpeg porque preprocessImageForOCR lo convierte
        // (el original puede ser HEIC/PNG/WebP — la IA recibe siempre JPEG normalizado).
        const result = await scanBase64(entry.base64, 'image/jpeg', PROMPT);
        const raw = result.raw as any;

        // Normalizar líneas — el prompt pide unitPrice/base/rate/iva/t pero la
        // IA puede devolverlas con nombres alternativos (precio_unitario, etc.)
        // o sólo con t y rate. Reconstruimos lo que falte.
        const normLineas: ParsedLinea[] = Array.isArray(raw.lineas) ? raw.lineas.map((l: any): ParsedLinea => {
          const q   = Number(l?.q ?? l?.cantidad ?? 1) || 1;
          const r   = Number(l?.rate ?? l?.iva_rate ?? l?.tipoIva ?? 10);
          const rate = (r === 4 || r === 10 || r === 21) ? r : 10;
          const desc = Number(l?.descuento ?? l?.dto ?? 0) || 0;
          // Posibles nombres de la IA para el unitario sin IVA
          let unitPrice = Number(l?.unitPrice ?? l?.precio_unitario ?? l?.precioUnitario ?? l?.precio ?? 0);
          let base      = Number(l?.base ?? l?.importeBase ?? l?.subtotal ?? 0);
          let iva       = Number(l?.iva ?? l?.cuotaIva ?? l?.importe_iva ?? 0);
          let t         = Number(l?.t ?? l?.total ?? l?.importe ?? 0);

          // Reconstrucción si faltan campos:
          if (!base && unitPrice) base = Num.round2(q * unitPrice);
          if (!iva && base)       iva  = Num.round2(base * rate / 100);
          if (!t && (base || iva)) t   = Num.round2((base || 0) + (iva || 0));
          if (!base && t)         base = Num.round2(t / (1 + rate / 100));
          if (!iva && t && base)  iva  = Num.round2(t - base);
          if (!unitPrice && q && base) unitPrice = Num.round2(base / q);

          return {
            q, n: String(l?.n ?? l?.descripcion ?? l?.producto ?? '').trim(),
            u: String(l?.u ?? l?.unidad ?? 'uds'),
            unitPrice: unitPrice || 0,
            base: base || 0,
            rate,
            iva: iva || 0,
            t: t || 0,
            descuento: desc,
          };
        }) : [];

        // Reconstruir totales si la IA no los dio o son inconsistentes
        const rawTot = raw.totales || raw.totals || {};
        const sumBase = normLineas.reduce((s, l) => s + (l.base || 0), 0);
        const sumIva  = normLineas.reduce((s, l) => s + (l.iva  || 0), 0);
        const sumT    = normLineas.reduce((s, l) => s + (l.t    || 0), 0);
        const totales: ParsedTotales = {
          base:      Num.round2(Number(rawTot.base) || sumBase),
          iva:       Num.round2(Number(rawTot.iva)  || sumIva),
          total:     Num.round2(Number(rawTot.total) || Number(raw.total) || sumT),
          descuento: Num.round2(Number(rawTot.descuento) || 0),
          by_rate:   typeof rawTot.by_rate === 'object' && rawTot.by_rate ? rawTot.by_rate : (() => {
            // Calculamos by_rate desde las líneas si la IA no lo dio.
            const acc: Record<string, { base: number; iva: number; total: number }> = {};
            for (const l of normLineas) {
              const k = String(l.rate || 10);
              if (!acc[k]) acc[k] = { base: 0, iva: 0, total: 0 };
              acc[k].base  += l.base  || 0;
              acc[k].iva   += l.iva   || 0;
              acc[k].total += l.t     || 0;
            }
            // Redondear cada bloque
            for (const k of Object.keys(acc)) {
              acc[k] = { base: Num.round2(acc[k].base), iva: Num.round2(acc[k].iva), total: Num.round2(acc[k].total) };
            }
            return acc;
          })(),
        };

        const parsed: ParsedAlbaran = {
          proveedor: String(raw.proveedor || '').trim(),
          num: String(raw.num || '').trim() || 'S/N',
          fecha: String(raw.fecha || '').trim(),
          // Total canónico = totales.total. Si la IA no lo dio, suma de líneas.
          total: totales.total || 0,
          totales,
          lineas: normLineas,
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

        // 🔄 Auto-rotación: si tras el primer scan la lectura es muy mala
        // (sin proveedor + sin fecha + total cero), probablemente la foto
        // está girada físicamente (sin flag EXIF). Probamos rotar 90° y 180°
        // y elegimos la mejor lectura. Solo se usan recursos extra cuando la
        // primera lectura es claramente fallida.
        const isClearlyBad = (pp: ParsedAlbaran): boolean =>
          (!pp.proveedor || pp.proveedor.length < 3) &&
          (!pp.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(pp.fecha)) &&
          (!pp.total || pp.total <= 0);

        if (isClearlyBad(parsed)) {
          for (const deg of [90, 180, 270] as const) {
            try {
              const rotatedB64 = await rotateBase64Image(entry.base64, deg);
              const rotResult = await scanBase64(rotatedB64, 'image/jpeg', PROMPT);
              const rotRaw = rotResult.raw as any;
              const rotParsed: any = {
                proveedor: String(rotRaw.proveedor || '').trim(),
                fecha: String(rotRaw.fecha || '').trim(),
                total: Num.parse(rotRaw.total || (rotRaw.totales?.total)),
              };
              if (!isClearlyBad(rotParsed)) {
                // Rotación corrigió la lectura — usamos esta versión completa.
                console.log(`[BulkAlbaranes] Rotación ${deg}° rescata albarán: ${entry.file.name}`);
                // Re-procesar todo con la rotación buena
                const rotLineas = Array.isArray(rotRaw.lineas) ? rotRaw.lineas : [];
                parsed.proveedor = rotParsed.proveedor || parsed.proveedor;
                parsed.fecha     = rotParsed.fecha     || parsed.fecha;
                parsed.num       = String(rotRaw.num || '').trim() || parsed.num;
                parsed.total     = rotParsed.total     || parsed.total;
                parsed.lineas    = rotLineas;
                parsed.totales   = rotRaw.totales || parsed.totales;
                parsed.confidence = rotRaw.confidence || parsed.confidence;
                // Guardar la base64 rotada en la entry para que el thumbnail
                // y modal de detalle muestren la versión legible.
                entry.base64 = rotatedB64;
                break;
              }
            } catch (e) {
              console.warn(`[BulkAlbaranes] Rotación ${deg}° falló:`, e);
            }
          }
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
        // Si es rate limit, esperar y reintentar UNA vez
        const isRateLimit = /rate.?limit|429|en pausa|ningún proveedor/i.test(msg);
        if (isRateLimit && entry.retryCount === undefined) {
          entry.retryCount = 1;
          setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'scanning' } } : e));
          // Esperar 30s para que el circuit breaker se resetee
          await new Promise(r => setTimeout(r, 30_000));
          try {
            const retryResult = await scanBase64(entry.base64, 'image/jpeg', PROMPT);
            const retryRaw = retryResult.raw as any;
            // Procesamiento mínimo del retry
            const normL: ParsedLinea[] = Array.isArray(retryRaw.lineas) ? retryRaw.lineas.map((l: any) => ({
              q: Number(l?.q ?? 1), n: String(l?.n ?? ''), u: String(l?.u ?? 'uds'),
              unitPrice: Number(l?.unitPrice ?? 0), base: Number(l?.base ?? 0),
              rate: [4,10,21].includes(Number(l?.rate)) ? Number(l?.rate) : 10,
              iva: Number(l?.iva ?? 0), t: Number(l?.t ?? 0), descuento: Number(l?.descuento ?? 0),
            })) : [];
            const sumT = normL.reduce((s,l) => s + l.t, 0);
            const parsed: ParsedAlbaran = {
              proveedor: String(retryRaw.proveedor || '').trim(), num: String(retryRaw.num || 'S/N'),
              fecha: String(retryRaw.fecha || ''), total: Number(retryRaw.totales?.total ?? retryRaw.total ?? sumT),
              totales: retryRaw.totales || { base: 0, iva: 0, total: sumT, descuento: 0 },
              lineas: normL, confidence: retryRaw.confidence, aiProvider: retryResult.provider, aiModel: retryResult.model,
            };
            parsed.reviewReasons = validateParsed(parsed);
            const isReliable = (parsed.reviewReasons || []).length === 0 && parsed.confidence !== 'low';
            setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'new', parsed }, selected: isReliable } : e));
            toast.info(`🔄 ${entry.file.name} procesado tras espera de rate limit.`);
          } catch {
            setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'failed', reason: `${msg} (reintento también falló)` } } : e));
          }
        } else {
          setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: { kind: 'failed', reason: msg } } : e));
        }
      } finally {
        done += 1;
        setProgress({ done, total: initial.length });
      }
    });

    setPhase('review');

    // Resumen rápido al terminar el escaneo: cuántos nuevos vs cuántos
    // duplicados omitidos. Útil para que la usuaria vea de un vistazo si la
    // dedupe está cazando lo que tenía que cazar.
    setEntries(prev => {
      const all = prev;
      const nuevos = all.filter(x => x.status.kind === 'new').length;
      const dupHashCount = all.filter(x => x.status.kind === 'duplicate-hash').length;
      const dupMetaCount = all.filter(x => x.status.kind === 'duplicate-meta').length;
      const fails = all.filter(x => x.status.kind === 'failed').length;
      const totalDups = dupHashCount + dupMetaCount;
      if (totalDups > 0 || fails > 0) {
        const partes: string[] = [];
        if (nuevos > 0)  partes.push(`✅ ${nuevos} nuevos`);
        if (totalDups > 0) partes.push(`🚫 ${totalDups} duplicados omitidos`);
        if (fails > 0)   partes.push(`⚠️ ${fails} fallaron`);
        toast.success(partes.join(' · '));
      }
      return all;
    });
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
      if (!newData.priceHistory) newData.priceHistory = [];

      // ── Detección de subida de precios ─────────────────────────────
      const getDynThreshold = (itemName: string) => {
        const n = basicNorm(itemName || '');
        if (n.match(/tomate|lechuga|cebolla|patata|pimiento|verdura|fruta|limon|naranja|pepino|mango|aguacate/)) return 25;
        if (n.match(/pescado|salmon|lubina|pulpo|calamar|gamba|langostino|sepia|anguila|bacalao|trucha/)) return 15;
        if (n.match(/carne|ternera|pollo|cerdo|pato|foie|muslo/)) return 8;
        if (n.match(/vino|cerveza|agua|refresco|cafe|azucar|harina|sake|gin|ron|whisky|vodka/)) return 5;
        return 10;
      };
      const singularize = (s: string) => basicNorm(s).replace(/s$/, '');
      const detectPriceInc = (prov: string, item: string, price: number) => {
        const pN = basicNorm(prov);
        const iN = singularize(item);
        const prev = [...(newData.priceHistory || [])].filter(h =>
          basicNorm(h.prov || '') === pN && singularize(h.item || '').includes(iN)
        ).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
        if (!prev || (prev as any).unitPrice <= 0) return null;
        const prevPrice = (prev as any).unitPrice;
        const pct = Num.round2(((price - prevPrice) / prevPrice) * 100);
        const threshold = getDynThreshold(item);
        if (pct >= threshold) return { pct, prevPrice, threshold };
        return null;
      };
      const priceAlerts: string[] = [];

      for (const e of seleccionados) {
        if (e.status.kind !== 'new') continue;
        // Si la usuaria editó los campos en la pantalla de revisión, esos
        // valores tienen prioridad sobre los originales de la IA.
        const p = (e.editedParsed || e.status.parsed) as ParsedAlbaran;

        // Líneas con desglose contable completo. Cada item lleva su rate
        // (4/10/21), su base sin IVA, su iva, su total con IVA, y opcional
        // descuento. Esto permite reconciliar la factura del proveedor más
        // adelante línea por línea con su IVA correcto.
        const items = (p.lineas || []).map(l => {
          const q   = Number(l.q) || 1;
          const r   = Number(l.rate) || 10;
          const up  = Number(l.unitPrice) || 0;
          const base = Number(l.base) || Num.round2(q * up);
          const iva  = Number(l.iva)  || Num.round2(base * r / 100);
          const tot  = Number(l.t)    || Num.round2(base + iva);
          return {
            q,
            n: String(l.n || '').trim(),
            u: String(l.u || 'uds'),
            unitPrice: up,
            base,
            rate: r,
            iva,
            tax: iva,                       // alias para compatibilidad con motor existente
            t: tot,
            total: tot,
            descuento: Number(l.descuento) || 0,
          };
        });

        const totales = p.totales || {} as ParsedTotales;
        const totalDoc = Number(totales.total ?? p.total) || items.reduce((s, it) => s + (Number(it.t) || 0), 0);
        const baseDoc  = Number(totales.base) || items.reduce((s, it) => s + (Number(it.base) || 0), 0);
        const ivaDoc   = Number(totales.iva)  || items.reduce((s, it) => s + (Number(it.iva) || 0), 0);
        const descDoc  = Number(totales.descuento) || 0;
        const byRate   = totales.by_rate || (() => {
          const acc: Record<string, { base: number; tax: number; total: number }> = {};
          for (const it of items) {
            const k = String(it.rate || 10);
            if (!acc[k]) acc[k] = { base: 0, tax: 0, total: 0 };
            acc[k].base  += Number(it.base) || 0;
            acc[k].tax   += Number(it.iva)  || 0;
            acc[k].total += Number(it.t)    || 0;
          }
          for (const k of Object.keys(acc)) {
            acc[k] = { base: Num.round2(acc[k].base), tax: Num.round2(acc[k].tax), total: Num.round2(acc[k].total) };
          }
          return acc;
        })();

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
          total: String(Num.round2(totalDoc)),
          // Desglose contable canónico — el motor de la app (informes, P&L,
          // cuadre con factura) puede usar estos campos directamente sin
          // recalcular desde las líneas.
          base:  String(Num.round2(baseDoc)) as any,
          taxes: String(Num.round2(ivaDoc)) as any,
          iva:   String(Num.round2(ivaDoc)) as any,
          // Desglose por tipo de IVA (4 / 10 / 21). Imprescindible cuando una
          // misma factura mezcla productos de distintos rate, lo cual es lo
          // habitual en hostelería.
          by_rate: byRate as any,
          items: items as any,
          unitId: defaultUnitId,
          status: needsReview ? 'mismatch' : 'ok',
          invoiced: false,
          paid: false,
          reconciled: false,
          file_hash: e.hash,
          source: 'bulk-images',
          // Descuento global del documento si lo hay (no por línea)
          ...(descDoc > 0 ? { descuento: descDoc } as any : {}),
          // Régimen especial: el total facturado = suma de bases sin IVA
          // (caso Frutas Daniel con recargo de equivalencia). El motor de
          // reconciliación con la factura mensual lo tiene en cuenta.
          ...(totales.recargoEquivalencia ? { recargo_equivalencia: true } as any : {}),
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
        // ── Registrar precios y detectar subidas ──────────────────────
        for (const it of items) {
          const provN = (p.proveedor || '').trim().toUpperCase();
          const itemN = (it.n || '').trim().toUpperCase();
          const up = Number(it.unitPrice) || 0;
          if (up > 0 && itemN) {
            // Normalizar unidades pequeñas a kg/l
            let normalizedPrice = up;
            const uLow = (it.u || '').toLowerCase();
            if (uLow === 'g' || uLow === 'gr' || uLow === 'grs') normalizedPrice = Num.round2(up * 1000);
            if (uLow === 'ml') normalizedPrice = Num.round2(up * 1000);

            const inc = detectPriceInc(provN, itemN, normalizedPrice);
            if (inc) {
              priceAlerts.push(`📈 ${provN} → ${itemN}: +${inc.pct}% (${inc.prevPrice}€ → ${normalizedPrice}€)`);
            }
            newData.priceHistory!.push({
              id: `price-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              prov: provN, item: itemN, unitPrice: normalizedPrice,
              date: fecha, albaranId: robustId,
            } as any);
          }
        }

        newData.albaranes.unshift(newAlbaran);
      }

      // ── Mostrar alertas de precio ──────────────────────────────────
      if (priceAlerts.length > 0) {
        const msg = `⚠️ SUBIDAS DE PRECIO DETECTADAS:\n\n${priceAlerts.join('\n')}`;
        toast.warning(msg);
        // Disparar evento para el asistente IA
      }

      await onSave(newData);
      toast.success(`✅ ${seleccionados.length} albaranes guardados.${priceAlerts.length > 0 ? ` ⚠️ ${priceAlerts.length} subida(s) de precio.` : ''}`);
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

                {/* Resumen compacto de duplicados detectados — NO se guardan,
                    solo se enseñan colapsados por si la usuaria quiere
                    auditarlos. Por defecto la pantalla solo muestra lo
                    accionable (nuevos fiables + nuevos a revisar). */}
                {(dupHash.length > 0 || dupMeta.length > 0) && (
                  <details className="rounded-2xl border border-slate-200 bg-slate-50 group">
                    <summary className="cursor-pointer px-4 py-3 flex items-center gap-2 text-slate-600 hover:bg-slate-100 rounded-2xl transition list-none">
                      <Copy className="w-4 h-4" />
                      <span className="text-[11px] font-black uppercase tracking-widest">
                        {dupHash.length + dupMeta.length} duplicado(s) detectado(s) — no se guardarán
                      </span>
                      <ChevronDown className="w-4 h-4 ml-auto text-slate-400 group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="border-t border-slate-200 p-4 space-y-3">
                      {dupHash.length > 0 && (
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
                      )}
                      {dupMeta.length > 0 && (
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
                      )}
                    </div>
                  </details>
                )}

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
  // 🆕 Para edición de líneas individuales en el modal
  const editLinea = (lineIdx: number, field: keyof ParsedLinea, val: any) => {
    const base = (entry.editedParsed || (entry.status as any).parsed) as ParsedAlbaran;
    const newLineas = [...(base.lineas || [])];
    newLineas[lineIdx] = { ...newLineas[lineIdx], [field]: val };
    // Recalcular total de la línea si cambian q, unitPrice o rate
    const l = newLineas[lineIdx];
    const q = Number(l.q) || 1;
    const up = Number(l.unitPrice) || 0;
    const rate = Number(l.rate) || 10;
    const lineBase = Num.round2(q * up);
    const lineIva = Num.round2(lineBase * rate / 100);
    newLineas[lineIdx] = { ...newLineas[lineIdx], base: lineBase, iva: lineIva, t: Num.round2(lineBase + lineIva), total: Num.round2(lineBase + lineIva) };
    // Recalcular totales del documento
    const sumBase = Num.round2(newLineas.reduce((s, x) => s + (x.base || 0), 0));
    const sumIva = Num.round2(newLineas.reduce((s, x) => s + (x.iva || 0), 0));
    const sumTotal = Num.round2(newLineas.reduce((s, x) => s + (x.t || x.total || 0), 0));
    onEdit('lineas', newLineas);
    // Actualizar totales también
    setTimeout(() => {
      onEdit('total', sumTotal);
      onEdit('totales', { ...(base.totales || {}), base: sumBase, iva: sumIva, total: sumTotal });
    }, 0);
  };
  const addLinea = () => {
    const base = (entry.editedParsed || (entry.status as any).parsed) as ParsedAlbaran;
    const newLineas = [...(base.lineas || []), { q: 1, n: '', u: 'uds', unitPrice: 0, base: 0, rate: 10, iva: 0, t: 0, total: 0 }];
    onEdit('lineas', newLineas);
  };
  const removeLinea = (idx: number) => {
    const base = (entry.editedParsed || (entry.status as any).parsed) as ParsedAlbaran;
    const newLineas = (base.lineas || []).filter((_, i) => i !== idx);
    onEdit('lineas', newLineas);
    const sumTotal = Num.round2(newLineas.reduce((s, x) => s + (x.t || x.total || 0), 0));
    setTimeout(() => onEdit('total', sumTotal), 0);
  };

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

          {/* Botón "✏️ Editar todo" — visible en cada tarjeta para que la
              usuaria sepa que puede abrir el modal y editar líneas, IVA, etc. */}
          <div className="flex items-center gap-2 mt-1.5">
            <button
              type="button"
              onClick={() => setShowDetail(true)}
              className={cn(
                'text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg transition flex items-center gap-1',
                isDudoso
                  ? 'bg-amber-500 hover:bg-amber-600 text-white'
                  : 'bg-indigo-500 hover:bg-indigo-600 text-white',
              )}
              title="Abre el editor completo: líneas, IVA, totales, todo editable"
            >
              ✏️ Editar todo
            </button>
            <span className="text-[9px] font-bold text-slate-400">
              {parsed.lineas?.length || 0} líneas · {Num.fmt(parsed.total || 0)}
            </span>
          </div>
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
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-violet-50">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">✏️ Editor del albarán</p>
                  <p className="text-sm font-black text-slate-800 truncate">{entry.file.name}</p>
                  <p className="text-[10px] font-bold text-slate-500 mt-0.5">Todos los campos son editables. Los cambios se guardan al cerrar.</p>
                </div>
                <button
                  onClick={() => setShowDetail(false)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl shadow flex items-center gap-1.5 shrink-0"
                >
                  ✅ Listo
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {/* 🆕 Campos de cabecera EDITABLES en el modal */}
                <div className="grid grid-cols-2 gap-3">
                  <EditableField label="Proveedor" value={parsed.proveedor || ''} highlight={!parsed.proveedor}
                    onChange={v => onEdit('proveedor', v)} />
                  <EditableField label="Nº documento" value={parsed.num || ''}
                    onChange={v => onEdit('num', v)} />
                  <EditableField label="Fecha" value={parsed.fecha || ''} highlight={!parsed.fecha} type="date"
                    onChange={v => onEdit('fecha', v)} />
                  <EditableField label="Total c/IVA" value={String(parsed.totales?.total || parsed.total || 0)} highlight={!parsed.total} type="number"
                    onChange={v => onEdit('total', parseFloat(v) || 0)} />
                  <EditableField label="Base s/IVA" value={String(parsed.totales?.base || 0)} highlight={!parsed.totales?.base} type="number"
                    onChange={v => onEdit('totales', { ...(parsed.totales || {}), base: parseFloat(v) || 0 })} />
                  <EditableField label="Total IVA" value={String(parsed.totales?.iva || 0)} highlight={!parsed.totales?.iva} type="number"
                    onChange={v => onEdit('totales', { ...(parsed.totales || {}), iva: parseFloat(v) || 0 })} />
                </div>

                {/* Desglose por tipo de IVA — clave en hostelería donde una
                    factura puede mezclar 4% (alimentación), 10% (mayoría),
                    21% (alcohol). */}
                {parsed.totales?.by_rate && Object.keys(parsed.totales.by_rate).length > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Desglose por tipo de IVA</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(['4', '10', '21'] as const).map(rate => {
                        const block = parsed.totales!.by_rate![rate];
                        const hasContent = block && (block.base > 0 || block.iva > 0 || block.total > 0);
                        return (
                          <div key={rate} className={cn(
                            'p-2 rounded-lg border',
                            hasContent
                              ? rate === '4'  ? 'bg-emerald-50 border-emerald-200' :
                                rate === '10' ? 'bg-indigo-50 border-indigo-200'   :
                                                'bg-rose-50 border-rose-200'
                              : 'bg-white border-slate-100 opacity-50'
                          )}>
                            <p className={cn(
                              'text-[8px] font-black uppercase tracking-widest',
                              rate === '4' ? 'text-emerald-700' : rate === '10' ? 'text-indigo-700' : 'text-rose-700'
                            )}>IVA {rate}%</p>
                            <p className="text-[10px] font-bold text-slate-700 mt-1">Base: <span className="font-mono">{Num.fmt(block?.base || 0)}</span></p>
                            <p className="text-[10px] font-bold text-slate-700">IVA: <span className="font-mono">{Num.fmt(block?.iva || 0)}</span></p>
                            <p className="text-[10px] font-black text-slate-900">Total: <span className="font-mono">{Num.fmt(block?.total || 0)}</span></p>
                          </div>
                        );
                      })}
                    </div>
                    {parsed.totales.descuento && parsed.totales.descuento > 0 && (
                      <p className="text-[10px] font-bold text-amber-700 mt-2">📉 Descuento global: −{Num.fmt(parsed.totales.descuento)}</p>
                    )}
                    {parsed.totales.recargoEquivalencia && (
                      <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded-lg p-2">
                        <p className="text-[10px] font-black text-indigo-800 uppercase tracking-widest">📋 Régimen especial detectado</p>
                        <p className="text-[10px] font-bold text-indigo-700">El total del albarán es la SUMA DE BASES (sin IVA aplicado). Habitual en mayoristas de hortofrutícolas con recargo de equivalencia. La factura mensual del proveedor sumará el IVA aparte.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 🆕 Líneas EDITABLES — la usuaria puede corregir lo que la IA leyó mal */}
                {parsed.lineas && parsed.lineas.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Líneas extraídas ({parsed.lineas.length})</p>
                      <button type="button" onClick={addLinea} className="text-[9px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-800 transition">+ Añadir línea</button>
                    </div>
                    <div className="space-y-1.5 max-h-72 overflow-y-auto">
                      {parsed.lineas.map((l, i) => (
                        <div key={i} className="text-[10px] bg-slate-50 rounded-lg px-2 py-2 border border-slate-200 space-y-1 relative group">
                          {/* Botón eliminar línea */}
                          <button type="button" onClick={() => removeLinea(i)}
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-[8px] font-black"
                            title="Eliminar línea">×</button>
                          {/* Fila 1: cantidad, nombre, unidad */}
                          <div className="flex items-center gap-1">
                            <input type="number" step="0.01" value={l.q ?? 1}
                              onChange={e => editLinea(i, 'q', parseFloat(e.target.value) || 0)}
                              className="w-12 text-[10px] font-bold text-center bg-white border border-slate-200 rounded px-1 py-0.5 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 outline-none"
                              title="Cantidad" />
                            <span className="text-slate-400 text-[10px]">×</span>
                            <input value={l.n || ''}
                              onChange={e => editLinea(i, 'n', e.target.value)}
                              placeholder="Producto"
                              className="flex-1 text-[10px] font-bold bg-white border border-slate-200 rounded px-1.5 py-0.5 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 outline-none truncate" />
                            <input value={l.u || 'uds'}
                              onChange={e => editLinea(i, 'u', e.target.value)}
                              className="w-10 text-[10px] text-slate-500 bg-white border border-slate-200 rounded px-1 py-0.5 focus:border-indigo-400 outline-none text-center"
                              title="Unidad" />
                          </div>
                          {/* Fila 2: precio unitario, IVA%, total */}
                          <div className="flex items-center gap-1">
                            <input type="number" step="0.01" value={l.unitPrice ?? 0}
                              onChange={e => editLinea(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                              className="w-16 text-[10px] font-mono font-bold bg-white border border-slate-200 rounded px-1 py-0.5 text-right focus:border-indigo-400 outline-none"
                              title="Precio unitario s/IVA" />
                            <span className="text-[9px] text-slate-400">€/u</span>
                            <select value={l.rate ?? 10}
                              onChange={e => editLinea(i, 'rate', parseInt(e.target.value))}
                              className={cn(
                                'text-[10px] font-black rounded px-1.5 py-0.5 border outline-none cursor-pointer',
                                (l.rate ?? 10) === 4  ? 'bg-emerald-50 border-emerald-300 text-emerald-700' :
                                (l.rate ?? 10) === 21 ? 'bg-rose-50 border-rose-300 text-rose-700'         :
                                                        'bg-indigo-50 border-indigo-300 text-indigo-700'
                              )}>
                              <option value={4}>4%</option>
                              <option value={10}>10%</option>
                              <option value={21}>21%</option>
                            </select>
                            <span className="text-slate-300 mx-0.5">=</span>
                            <span className="text-[10px] font-mono font-black text-slate-900">{Num.fmt(l.t || l.total || 0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Botón añadir primera línea si no hay */}
                {(!parsed.lineas || parsed.lineas.length === 0) && (
                  <button type="button" onClick={addLinea}
                    className="w-full py-2 text-[10px] font-black uppercase tracking-widest text-indigo-600 border-2 border-dashed border-indigo-200 rounded-xl hover:bg-indigo-50 transition">
                    + Añadir línea manualmente
                  </button>
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

// 🆕 Campo editable para el modal de detalle
const EditableField: React.FC<{ label: string; value: string; highlight?: boolean; type?: string; onChange: (v: string) => void }> = ({ label, value, highlight, type, onChange }) => (
  <div className={cn('rounded-lg p-2 border', highlight ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-100')}>
    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">{label}</p>
    <input
      type={type || 'text'}
      step={type === 'number' ? '0.01' : undefined}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn(
        'w-full text-xs font-black bg-transparent outline-none border-b border-transparent focus:border-indigo-400 focus:bg-indigo-50/50 px-0.5 py-0.5 rounded transition',
        highlight ? 'text-rose-700 placeholder-rose-400' : 'text-slate-800',
      )}
    />
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
