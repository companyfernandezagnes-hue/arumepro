import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileText, CheckCircle2, Database, Building2,
  Sparkles, Loader2, Receipt, Mic, Square, AlertTriangle, X, Edit3, Grid, ListPlus, Trash2, ClipboardPaste, CalendarClock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { AppData, BankMovement, FacturaExtended } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { useColumnDetector } from '../hooks/useColumnDetector';

interface ImportViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  onNavigate: (tab: string) => void;
}

export type ImportMode = 'tpv' | 'albaranes_excel' | 'ia_auto' | 'banco_excel' | 'voz_albaran';

/* =======================================================
 * 🛡️ MOTOR DE RECONCILIACIÓN MATEMÁTICA
 * ======================================================= */
type LineaIA = { qty: number; name: string; unit: string; unit_price: number; tax_rate: 4 | 10 | 21; total: number; };
type AlbaranIA = { proveedor: string; fecha: string; num: string; unidad?: 'REST' | 'SHOP'; lineas: LineaIA[]; sum_base?: number; sum_tax?: number; sum_total?: number; };
type DocumentoIA = { 
  tipo_documento: 'factura' | 'albaran';
  proveedor: string; nif?: string; fecha: string; num: string; 
  total: number; base: number; iva: number;
  referencias_albaranes?: string[];
  lineas?: LineaIA[]; 
};

const TOL = 0.01;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const asNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const normalizeDate = (s?: string) => {
  const v = String(s ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : new Date().toLocaleDateString('sv-SE');
};

function reconcileAlbaran(ai: DocumentoIA) {
  const lines = (ai.lineas || []).map(l => {
    const rate = (l.tax_rate ?? 10) as 4|10|21;
    const total = round2(Number(l.total) || 0);
    const base  = round2(total / (1 + rate / 100));
    const tax   = round2(total - base);
    return { ...l, tax_rate: rate, total, base, tax };
  });

  const base4  = round2(lines.filter(l => l.tax_rate === 4).reduce((a, l) => a + l.base, 0));
  const base10 = round2(lines.filter(l => l.tax_rate === 10).reduce((a, l) => a + l.base, 0));
  const base21 = round2(lines.filter(l => l.tax_rate === 21).reduce((a, l) => a + l.base, 0));
  const tax4   = round2(lines.filter(l => l.tax_rate === 4).reduce((a, l) => a + l.tax, 0));
  const tax10  = round2(lines.filter(l => l.tax_rate === 10).reduce((a, l) => a + l.tax, 0));
  const tax21  = round2(lines.filter(l => l.tax_rate === 21).reduce((a, l) => a + l.tax, 0));

  const sum_base = round2(base4 + base10 + base21);
  const sum_tax  = round2(tax4 + tax10 + tax21);
  const sum_total_calc = round2(lines.reduce((a, l) => a + l.total, 0));

  const declared_total = Number(ai.total ?? sum_total_calc);
  const diff = round2(sum_total_calc - declared_total);
  const cuadra = Math.abs(diff) <= TOL;

  return { ...ai, lineas: lines, sum_base, sum_tax, sum_total: sum_total_calc, by_rate: { 4: { base: base4, tax: tax4 }, 10: { base: base10, tax: tax10 }, 21: { base: base21, tax: tax21 } }, diff, cuadra };
}

const extractJSON = (rawText: string) => {
  try {
    if (!rawText) return {};
    const clean = rawText.replace(/(?:json)?/gi, '').replace(/\uFEFF/g, '').trim();
    const start = clean.indexOf('{'); const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) return {};
    return JSON.parse(clean.substring(start, end + 1));
  } catch { return {}; }
};

const compressImage = async (file: File | Blob): Promise<string> => {
  const MAX_BYTES = 4 * 1024 * 1024; const MAX_W = 1600, MAX_H = 1600;
  const bitmap = await createImageBitmap(file); let { width, height } = bitmap;
  const ratio = Math.min(MAX_W / width, MAX_H / height, 1);
  const w = Math.max(1, Math.round(width * ratio)); const h = Math.max(1, Math.round(height * ratio));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.8));
  const finalBlob = blob.size > MAX_BYTES ? await new Promise<Blob>(res => canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.6)) : blob;
  const b64 = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res((fr.result as string).split(',')[1]); fr.readAsDataURL(finalBlob); });
  return `data:image/jpeg;base64,${b64}`;
};

/* =======================================================
 * 🤖 MOTOR IA REDUNDANTE (GEMINI + GROQ FALLBACK)
 * ======================================================= */
const analyzeDocumentWithAI = async (mimeType: string, base64Data: string, prompt: string): Promise<DocumentoIA> => {
  const geminiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
  const groqKey = sessionStorage.getItem('groq_api_key') || localStorage.getItem('groq_api_key'); 

  let lastError;

  // 1️⃣ INTENTO 1: GOOGLE GEMINI (Prioridad por precisión multimodal)
  if (geminiKey) {
    try {
      const genAI = new GoogleGenAI({ apiKey: geminiKey });
      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash", 
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType } }] }],
        config: { responseMimeType: "application/json", temperature: 0.1 }
      });
      const raw = response.text || "";
      return raw.includes('{') ? JSON.parse(raw) : extractJSON(raw);
    } catch (e: any) {
      console.warn("⚠️ Gemini falló o se agotaron los tokens:", e.message);
      lastError = e;
      if (!groqKey || mimeType === 'application/pdf') throw e; 
    }
  }

  // 2️⃣ INTENTO 2: GROQ (Llama-3.2-Vision) SALVAVIDAS
  if (groqKey && mimeType.startsWith('image/')) {
    console.log("🔄 Activando Fallback a GROQ...");
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "llama-3.2-90b-vision-preview",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt + "\nRESPONDE SOLO CON UN JSON VÁLIDO. NADA MÁS." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }
            ]
          }],
          temperature: 0.1
        })
      });
      if (!res.ok) throw new Error(`Groq API Error: ${res.status}`);
      const data = await res.json();
      const raw = data.choices[0].message.content;
      return extractJSON(raw);
    } catch (e: any) {
      console.error("❌ Groq también falló.");
      throw e;
    }
  }

  if (lastError) throw lastError;
  throw new Error("No hay APIs de IA configuradas. Añade una clave en Ajustes.");
};

/* =======================================================
 * 🧠 PROMPT OMNIVERSAL (Detecta todo solo)
 * ======================================================= */
const PROMPT_OMNI_IA = `Eres un Auditor Contable de IA para Hostelería.
Analiza la imagen adjunta y determina automáticamente si es una FACTURA (incluye tickets con NIF/IVA) o un ALBARÁN (nota de entrega).
Devuelve SOLO un JSON estricto sin comentarios usando esta estructura exacta:
{
  "tipo_documento": "factura",
  "proveedor": "Nombre de la empresa",
  "nif": "NIF o CIF",
  "num": "Número de factura o albaran (S/N si no hay)",
  "fecha": "YYYY-MM-DD",
  "total": 0,
  "base": 0,
  "iva": 0,
  "referencias_albaranes": [],
  "lineas": [
    {"qty": 1, "name": "Producto", "unit": "ud", "unit_price": 0, "tax_rate": 10, "total": 0}
  ]
}
Importante: "tipo_documento" debe ser "factura" o "albaran". "total" es un número con punto decimal.`;

/* =======================================================
 * COMPONENTE PRINCIPAL
 * ======================================================= */
export const ImportView = ({ data, onSave, onNavigate }: ImportViewProps) => {
  const safeData = data || {};
  const safeFacturas = Array.isArray(safeData.facturas) ? safeData.facturas : [];
  const safeAlbaranes = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  const safePlatos = Array.isArray(safeData.platos) ? safeData.platos : [];
  const safeVentas = Array.isArray(safeData.ventas_menu) ? safeData.ventas_menu : [];

  const [importMode, setImportMode] = useState<ImportMode>('ia_auto');
  const [isScanning, setIsScanning] = useState(false);
  
  const [batchProgress, setBatchProgress] = useState<{ 
    current: number, total: number, success: number, fails: number, 
    currentThumb: string | null, isCoolingDown?: boolean, failedNames: string[] 
  } | null>(null);
  
  const [processedData, setProcessedData] = useState<{
    cierre?: any; ventasMenu?: any; albaranesExcel?: any[]; facturaIa?: any; albaranIa?: any; tpvPreview?: any; bancoExcel?: BankMovement[];
  } | null>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { analyzeColumns, saveProfile } = useColumnDetector();

  // 💣 PANEL DE RESETEO QUIRÚRGICO (Meses Específicos)
  const [deleteMonth, setDeleteMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [deleteYear, setDeleteYear] = useState(String(new Date().getFullYear()));

  const handleNukeQuirurgico = async (type: 'docs' | 'bank') => {
    const mesNombre = new Date(Number(deleteYear), Number(deleteMonth) - 1).toLocaleString('es', { month: 'long', year: 'numeric' });
    const tipoStr = type === 'docs' ? 'FACTURAS y ALBARANES' : 'MOVIMIENTOS BANCARIOS';
    
    const confirmation = window.prompt(`⚠️ BORRADO LÁSER ACTIVADO ⚠️\n\nVas a borrar TODOS los ${tipoStr} del mes de:\n👉 ${mesNombre.toUpperCase()}\n\nEl resto de la base de datos estará a salvo.\n\nEscribe "${mesNombre.split(' ')[0].toUpperCase()}" para confirmar:`);
    
    if (confirmation === mesNombre.split(' ')[0].toUpperCase()) {
      setIsScanning(true);
      const newData = JSON.parse(JSON.stringify(safeData));
      
      const isTargetMonth = (dateStr: string) => {
        if (!dateStr) return false;
        try {
          // Extraemos YYYY-MM seguro
          const d = new Date(dateStr);
          if (Number.isNaN(d.getTime())) return false;
          return d.getFullYear() === Number(deleteYear) && (d.getMonth() + 1) === Number(deleteMonth);
        } catch { return false; }
      };

      if (type === 'docs') {
        newData.facturas = safeFacturas.filter(f => !isTargetMonth(f.date));
        newData.albaranes = safeAlbaranes.filter(a => !isTargetMonth(a.date));
      } else if (type === 'bank') {
        const safeBanco = Array.isArray(newData.banco) ? newData.banco : [];
        newData.banco = safeBanco.filter((b:any) => !isTargetMonth(b.date));
      }

      await onSave(newData);
      setIsScanning(false);
      alert(`✅ Limpieza de ${mesNombre.toUpperCase()} completada con éxito.`);
    } else if (confirmation !== null) {
      alert("❌ Código de seguridad incorrecto. Operación cancelada.");
    }
  };

  const handleNukeDataOps = async () => {
    const confirmation = window.prompt(`⚠️ PELIGRO ⚠️\n\nVas a borrar TODOS los Platos de la carta. \nTUS CIERRES DE CAJA Y VENTAS ESTÁN A SALVO.\n\nEscribe "BORRAR" en mayúsculas para confirmar:`);
    if (confirmation === 'BORRAR') {
      setIsScanning(true);
      const newData = JSON.parse(JSON.stringify(safeData));
      newData.platos = [];
      await onSave(newData);
      setIsScanning(false);
      alert(`✅ Diccionario de platos purgado.`);
    }
  };


  const categorizeItem = (name: string) => {
    const n = (name || '').toLowerCase();
    if (n.match(/vino|agua|cerveza|copa|refresco|zumo|coca|fanta|mahou/)) return 'Bebidas';
    if (n.match(/postre|tarta|helado|cafe|carajillo|chupito/)) return 'Postres';
    if (n.match(/pan|ensalada|croqueta|patata|nacho|tabla|queso/)) return 'Entrantes';
    if (n.match(/carne|pescado|merluza|entrecot|chuleta|menu|menú|combo/)) return 'Principal';
    return 'General';
  };

  // 🚀 LÓGICA OMNI-IA (MOTOR BLINDADO ANTI-BAN)
  const procesarLoteIA = async (files: File[]) => {
    setIsScanning(true);
    setBatchProgress({ current: 0, total: files.length, success: 0, fails: 0, currentThumb: null, failedNames: [] });
    
    let nuevosAlbaranes: any[] = [];
    let nuevasFacturas: FacturaExtended[] = [];
    let successCount = 0;
    let failCount = 0;
    let failedNamesArr: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = file.name || `Imagen_${i+1}`;
      
      let thumbUrl = null;
      if (file.type.startsWith('image/')) thumbUrl = URL.createObjectURL(file);
      
      setBatchProgress(p => p ? { ...p, current: i + 1, currentThumb: thumbUrl } : null);

      try {
        let base64Data = ""; let mimeType = file.type;

        if (file.type.startsWith('image/')) {
          const compressed = await compressImage(file);
          base64Data = compressed.split(',')[1]; mimeType = "image/jpeg";
        } else {
          const buffer = await file.arrayBuffer();
          base64Data = btoa(new Uint8Array(buffer).reduce((d, byte) => d + String.fromCharCode(byte), ''));
        }

        const datosIA = await analyzeDocumentWithAI(mimeType, base64Data, PROMPT_OMNI_IA);

        if (datosIA.tipo_documento === 'factura') {
          const prov = datosIA.proveedor || "Desconocido"; 
          const numF = datosIA.num || `S/N-${Date.now()}`; 
          const fecha = normalizeDate(datosIA.fecha);
          const totalPdf = asNum(datosIA.total) || 0; 
          const baseNum = asNum(datosIA.base) || Number((totalPdf / 1.10).toFixed(2)); 
          const ivaNum = asNum(datosIA.iva) || Number((totalPdf - baseNum).toFixed(2));

          nuevasFacturas.push({
            id: `fac-ia-${Date.now()}-${i}`, 
            tipo: 'compra',
            proveedor: prov, prov: prov, num: numF, num_factura: numF, date: fecha, 
            base: String(baseNum), tax: String(ivaNum), total: String(totalPdf),
            albaranIdsArr: datosIA.referencias_albaranes || [],
            paid: false, reconciled: false, source: 'ia-auto', status: 'draft', unidad_negocio: 'REST'
          });
        } else {
          const al: AlbaranIA = {
            proveedor: datosIA.proveedor || "Desconocido", fecha: normalizeDate(datosIA.fecha), num: datosIA.num || "S/N",
            unidad: 'REST', lineas: Array.isArray(datosIA.lineas) ? datosIA.lineas : [], sum_total: asNum(datosIA.total),
          };
          const rec = reconcileAlbaran(al);
          nuevosAlbaranes.push({
            id: `alb-ia-${Date.now()}-${i}`, prov: rec.proveedor, date: rec.fecha, num: rec.num, socio: "Arume",
            notes: rec.cuadra ? "IA OK" : `IA WARNING (diff=${rec.diff})`,
            items: rec.lineas.map(l => ({ q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax, unitPrice: l.unit_price ?? (l.qty ? round2(l.total / l.qty) : l.total) })),
            total: String(rec.sum_total), base: String(rec.sum_base), taxes: String(rec.sum_tax), invoiced: false, paid: false, reconciled: false,
            status: rec.cuadra ? 'ok' : 'warning', unitId: rec.unidad || 'REST', by_rate: rec.by_rate,
          });
        }
        
        successCount++;
        setBatchProgress(p => p ? { ...p, success: successCount } : null);

      } catch (e: any) {
        console.warn(`Fallo procesando ${fileName}`, e);
        failCount++;
        failedNamesArr.push(fileName);
        setBatchProgress(p => p ? { ...p, fails: failCount, failedNames: failedNamesArr } : null);
      }

      // 🛡️ SISTEMA DE ENFRIAMIENTO ANTI-BAN (Batch Extremo de 3 Meses)
      if (i < files.length - 1) {
        if ((i + 1) % 10 === 0) {
          // Cada 10 imágenes, paramos 15 segundos para no saturar a Google
          setBatchProgress(p => p ? { ...p, isCoolingDown: true } : null);
          await new Promise(r => setTimeout(r, 15000)); 
          setBatchProgress(p => p ? { ...p, isCoolingDown: false } : null);
        } else {
          // Pausa normal entre fotos para que respire
          await new Promise(r => setTimeout(r, 2000)); 
        }
      }
      
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    }

    // 💾 GUARDADO MASIVO DE GOLPE (Mucho más rápido que de uno en uno)
    if (successCount > 0) {
      const newData = JSON.parse(JSON.stringify(safeData));
      newData.facturas = [...nuevasFacturas, ...safeFacturas];
      newData.albaranes = [...nuevosAlbaranes, ...safeAlbaranes];
      await onSave(newData);
      
      if (nuevasFacturas.length >= nuevosAlbaranes.length) onNavigate('facturas');
      else onNavigate('albaranes');
    } 

    if (failCount > 0) {
      alert(`⚠️ Lote terminado.\n\n✅ Éxitos: ${successCount}\n❌ Fallos: ${failCount}\n\nArchivos que NO se han podido procesar:\n- ${failedNamesArr.join('\n- ')}\n\nPor favor, súbelos en otro lote o revisa la calidad de la foto.`);
    } else if (successCount > 0) {
      alert(`✅ Lote Extremo Importado: ${successCount} documentos procesados y clasificados.`);
    } else {
      alert("❌ No se pudo procesar ningún documento. La API puede estar bloqueada, inténtalo en unos minutos.");
    }
    
    setIsScanning(false);
    setBatchProgress(null);
  };

  const processFilesArray = async (files: File[]) => {
    if (files.length === 0) return;

    if (importMode === 'ia_auto') { 
       const invalidFiles = files.filter(f => !f.type.includes('pdf') && !f.type.startsWith('image/'));
       if (invalidFiles.length > 0) return alert("⚠️ La IA solo admite PDF o Imágenes (JPG/PNG).");
       
       await procesarLoteIA(files);
       return; 
    } 

    const file = files[0];
    if (!['.xls', '.xlsx', '.csv'].some(ext => file.name.toLowerCase().endsWith(ext))) {
      return alert("⚠️ Este modo es para archivos Excel (.xlsx) o CSV.");
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];

        if (importMode === 'tpv') {
          const dateInput = prompt(`📅 ¿Fecha de ventas TPV Madis? (YYYY-MM-DD):`, DateUtil.today());
          if (!dateInput) return;
          const analysis = analyzeColumns(rows);
          setProcessedData({ tpvPreview: { rows, mapping: analysis.mapping, confidence: analysis.confidence, isKnown: analysis.isKnown, date: dateInput } });
        } 
        else if (importMode === 'banco_excel') {
          const movimientosBancarios: BankMovement[] = [];
          let dateCol = -1, descCol = -1, amountCol = -1;
          const headers = rows[0].map(h => String(h).toLowerCase());
          
          headers.forEach((h, i) => {
            if (h.includes('fecha') || h.includes('date')) dateCol = i;
            if (h.includes('concepto') || h.includes('desc') || h.includes('detalle')) descCol = i;
            if (h.includes('importe') || h.includes('cantidad') || h.includes('amount') || h.includes('valor')) amountCol = i;
          });

          if (dateCol === -1) dateCol = 0; if (descCol === -1) descCol = 1; if (amountCol === -1) amountCol = 2;

          rows.slice(1).forEach((row, i) => {
            const rawAmount = row[amountCol];
            const parsedAmount = typeof rawAmount === 'number' ? rawAmount : Num.parse(String(rawAmount || 0));
            if (row[dateCol] && row[descCol] && parsedAmount !== 0) {
              movimientosBancarios.push({
                id: `bnk-${Date.now()}-${i}`, date: normalizeDate(row[dateCol]), desc: String(row[descCol]).trim(), amount: parsedAmount, status: 'pending'
              });
            }
          });

          if (movimientosBancarios.length === 0) return alert("⚠️ No se han podido extraer movimientos. Revisa el formato del Excel.");
          setProcessedData({ bancoExcel: movimientosBancarios });
        }
      } catch (err) { alert("Error al leer el archivo Excel."); }
    };
    reader.readAsBinaryString(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFilesArray(Array.from(e.target.files));
    e.target.value = ''; 
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDropLocal = (e: React.DragEvent) => { 
    e.preventDefault(); e.stopPropagation(); setIsDragging(false); 
    if (e.dataTransfer.files) processFilesArray(Array.from(e.dataTransfer.files));
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (isScanning) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      
      const filesToPaste: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) filesToPaste.push(file);
        }
      }
      if (filesToPaste.length > 0 && importMode === 'ia_auto') {
        processFilesArray(filesToPaste);
      }
    };

    window.addEventListener('paste', handlePaste as any);
    return () => window.removeEventListener('paste', handlePaste as any);
  }, [importMode, isScanning]);


  const handleConfirm = async () => {
    if (!processedData) return;
    const newData = JSON.parse(JSON.stringify(safeData));
    
    if (importMode === 'tpv' && processedData.tpvPreview) {
      const { rows, mapping, date } = processedData.tpvPreview;
      const newPlatos = [...safePlatos]; 
      const newVentas = [...safeVentas];
      let totalVentaDelDia = 0;
      
      rows.slice(1).forEach((row: any[]) => {
        const name = String(row[mapping.name] || '').trim(); const sold = Num.parse(row[mapping.qty]); const price = mapping.price > -1 ? Num.parse(row[mapping.price]) : 0;
        if (name.length > 1 && sold > 0 && sold < 5000) {
          totalVentaDelDia += (price * sold);
          let plato = newPlatos.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim());
          if (!plato) { plato = { id: 'p-' + Date.now() + Math.random(), name, category: categorizeItem(name), price, cost: 0 }; newPlatos.push(plato); }
          else if (price > 0 && plato.price !== price) plato.price = price;
          const existing = newVentas.find(v => v.date === date && v.id === plato!.id);
          if (existing) existing.qty += sold; else newVentas.push({ date, id: plato!.id, qty: sold });
        }
      });
      
      if (!newData.cierres) newData.cierres = [];
      newData.cierres.push({ id: `cierre-imp-${Date.now()}`, date, totalVenta: totalVentaDelDia, origen: 'Importación TPV Madis', efectivo: 0, tarjeta: totalVentaDelDia, apps: 0, notas: "Importado desde Excel", descuadre: 0, unitId: 'REST' });
      saveProfile(rows, mapping);
      await onSave({ ...newData, platos: newPlatos, ventas_menu: newVentas });
      onNavigate('menus');
    } 
    else if (importMode === 'banco_excel' && processedData.bancoExcel) {
      if (!newData.banco) newData.banco = [];
      newData.banco = [...processedData.bancoExcel, ...newData.banco];
      await onSave(newData); onNavigate('banco');
    }
    setProcessedData(null);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-24 animate-fade-in relative px-2 sm:px-0">
      
      <div className="flex items-center gap-4 mb-4 px-2">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
          <Database className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Data Input 2.0</h2>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">Sube 50 albaranes de golpe sin miedo</p>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden p-6 md:p-8">
        
        {/* SELECTOR GRID TIPO DASHBOARD */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          <ModuleButton 
            active={importMode === 'ia_auto'} onClick={() => { setImportMode('ia_auto'); setProcessedData(null); }}
            icon={Sparkles} title="IA Batch (Lotes)" subtitle="Facturas y Albaranes" color="indigo"
          />
          <ModuleButton 
            active={importMode === 'banco_excel'} onClick={() => { setImportMode('banco_excel'); setProcessedData(null); }}
            icon={Building2} title="Banco CSV" subtitle="Extracto" color="blue"
          />
          <ModuleButton 
            active={importMode === 'tpv'} onClick={() => { setImportMode('tpv'); setProcessedData(null); }}
            icon={Grid} title="TPV Madis" subtitle="Excel Cajas" color="amber"
          />
        </div>

        <div>
          {/* DROPZONE BLINDADA */}
          <div 
            className={cn(
              "border-2 border-dashed rounded-[2rem] p-12 flex flex-col items-center justify-center transition-all cursor-pointer relative overflow-hidden",
              isDragging ? "border-indigo-500 bg-indigo-50/50 scale-[1.02]" : "border-slate-200 bg-slate-50 hover:bg-slate-100",
              isScanning && "opacity-50 pointer-events-none"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDropLocal}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              multiple={importMode === 'ia_auto'} 
              ref={fileInputRef} 
              disabled={isScanning} 
              onChange={handleFileUpload} 
              accept={importMode === 'ia_auto' ? ".pdf, image/jpeg, image/png" : ".xlsx, .csv"} 
              className="hidden" 
            />
            
            {/* PROGRESO DEL LOTE IA CON VISOR BLINDADO */}
            {batchProgress ? (
              <div className="flex flex-col items-center w-full max-w-sm z-10 text-center">
                {batchProgress.currentThumb ? (
                  <div className="w-24 h-24 rounded-xl overflow-hidden shadow-lg border-4 border-white mb-4 relative">
                     <img src={batchProgress.currentThumb} className="w-full h-full object-cover" alt="Procesando" />
                     {batchProgress.isCoolingDown && (
                       <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center backdrop-blur-sm">
                         <span className="text-[9px] font-black text-white uppercase text-center leading-tight">Enfriando<br/>Google AI...</span>
                       </div>
                     )}
                  </div>
                ) : (
                  <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                )}
                <h3 className="text-xl font-black text-slate-800">
                  {batchProgress.isCoolingDown ? 'Pausa Anti-Saturación...' : 'Extrayendo Datos...'}
                </h3>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1 mb-4">
                  Documento {batchProgress.current} de {batchProgress.total}
                </p>
                <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden mb-2 shadow-inner">
                  <div className={cn("h-full transition-all duration-500", batchProgress.isCoolingDown ? "bg-amber-400" : "bg-indigo-500")} style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}></div>
                </div>
                <div className="flex justify-between w-full text-[11px] font-black px-1 uppercase tracking-widest">
                   <span className="text-emerald-600">{batchProgress.success} Éxitos</span>
                   {batchProgress.fails > 0 && <span className="text-rose-500">{batchProgress.fails} Fallos</span>}
                </div>
              </div>
            ) : (
              <>
                <div className={cn("w-20 h-20 rounded-full flex items-center justify-center shadow-sm mb-4 transition-all", isScanning ? "bg-indigo-100 scale-110" : "bg-white")}>
                  {isScanning ? <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /> : 
                   importMode === 'banco_excel' ? <Building2 className="w-8 h-8 text-blue-500" /> :
                   importMode === 'tpv' ? <Grid className="w-8 h-8 text-amber-500" /> :
                   <Sparkles className="w-8 h-8 text-indigo-500" />}
                </div>
                
                <h3 className="text-xl font-black text-slate-700 text-center">
                  {isScanning ? "Procesando..." : importMode === 'ia_auto' ? "Sube hasta 100 fotos/PDFs de golpe" : "Sube el Excel de Madis o Banco"}
                </h3>
                
                {importMode === 'ia_auto' && (
                  <div className="flex flex-col items-center gap-2 mt-4">
                    <div className="bg-emerald-50 px-4 py-2 rounded-full border border-emerald-200 shadow-sm text-emerald-700 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4"/> IA Blindada Anti-Bloqueos
                    </div>
                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                      <ClipboardPaste className="w-3 h-3 text-slate-400" /> Compatible con Ctrl+V (Pegar de WhatsApp)
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* TARJETA DE CONFIRMACIÓN PARA EXCEL (Madis / Banco) */}
          <AnimatePresence>
            {processedData && !batchProgress && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="mt-8">
                <div className="bg-white border-2 border-indigo-100 rounded-[2rem] p-6 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 bg-indigo-50 py-2 px-6 border-b border-indigo-100 flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-1.5"><Edit3 className="w-3 h-3"/> Resumen de Importación</span>
                    <button onClick={() => setProcessedData(null)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4"/></button>
                  </div>

                  <div className="mt-10 space-y-4 mb-6">
                    {/* CONFIRMACIÓN BANCO */}
                    {importMode === 'banco_excel' && processedData.bancoExcel && (
                      <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-200">
                        <ListPlus className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                        <h3 className="font-black text-slate-800 text-lg">{processedData.bancoExcel.length} movimientos detectados</h3>
                        <p className="text-xs text-slate-500 font-bold mt-1">Listos para enviar a la bóveda de conciliación.</p>
                      </div>
                    )}
                    
                    {/* CONFIRMACIÓN TPV MADIS */}
                    {importMode === 'tpv' && processedData.tpvPreview && (
                      <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-100">
                        <Grid className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                        <h3 className="font-black text-slate-800 text-lg">{processedData.tpvPreview.rows.length - 1} ventas el {processedData.tpvPreview.date}</h3>
                        <p className="text-xs text-slate-500 font-bold mt-1">Se generará un nuevo cierre de caja automático.</p>
                      </div>
                    )}
                  </div>

                  <button onClick={handleConfirm} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm py-4 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/30 flex justify-center items-center gap-2">
                    <Database className="w-4 h-4" /> GUARDAR EN ARUME
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* 💣 PANEL DE RESETEO QUIRÚRGICO (Máquina del Tiempo) */}
      <div className="mt-8 border border-slate-200 bg-white rounded-[2.5rem] p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center border border-rose-100">
              <CalendarClock className="w-6 h-6 text-rose-500" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800 tracking-tight">Borrador Quirúrgico por Meses</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                Ideal para limpiar errores de importación masiva de un mes concreto.
              </p>
            </div>
          </div>

          <div className="flex gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200">
            <select 
              value={deleteMonth} 
              onChange={(e) => setDeleteMonth(e.target.value)}
              className="bg-white border border-slate-200 text-slate-800 text-sm font-bold rounded-xl focus:ring-rose-500 focus:border-rose-500 p-2 outline-none"
            >
              {MONTHS_FULL.map((m, i) => (
                <option key={i} value={String(i + 1).padStart(2, '0')}>{m.toUpperCase()}</option>
              ))}
            </select>
            <input 
              type="number" 
              value={deleteYear} 
              onChange={(e) => setDeleteYear(e.target.value)}
              className="bg-white border border-slate-200 text-slate-800 text-sm font-bold rounded-xl focus:ring-rose-500 focus:border-rose-500 p-2 w-24 outline-none text-center"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-slate-100">
          <button 
            onClick={() => handleNukeQuirurgico('docs')}
            disabled={isScanning}
            className="flex items-center justify-between p-4 bg-white border border-rose-200 hover:bg-rose-50 hover:border-rose-400 transition-all rounded-2xl text-left group disabled:opacity-50"
          >
            <div>
              <span className="font-black text-sm text-slate-800 flex items-center gap-2"><Receipt className="w-4 h-4 text-rose-500" /> Facturas y Albaranes</span>
              <p className="text-[10px] text-slate-400 font-medium mt-1">Borra todo lo de {MONTHS_FULL[Number(deleteMonth)-1]} {deleteYear}</p>
            </div>
            <Trash2 className="w-5 h-5 text-rose-300 group-hover:text-rose-600 transition-colors" />
          </button>

          <button 
            onClick={() => handleNukeQuirurgico('bank')}
            disabled={isScanning}
            className="flex items-center justify-between p-4 bg-white border border-blue-200 hover:bg-blue-50 hover:border-blue-400 transition-all rounded-2xl text-left group disabled:opacity-50"
          >
            <div>
              <span className="font-black text-sm text-slate-800 flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-500" /> Banco y Conciliación</span>
              <p className="text-[10px] text-slate-400 font-medium mt-1">Borra todo lo de {MONTHS_FULL[Number(deleteMonth)-1]} {deleteYear}</p>
            </div>
            <Trash2 className="w-5 h-5 text-blue-300 group-hover:text-blue-600 transition-colors" />
          </button>

          <button 
            onClick={handleNukeDataOps}
            disabled={isScanning}
            className="flex items-center justify-between p-4 bg-white border border-amber-200 hover:bg-amber-50 hover:border-amber-400 transition-all rounded-2xl text-left group disabled:opacity-50"
          >
            <div>
              <span className="font-black text-sm text-slate-800 flex items-center gap-2"><Grid className="w-4 h-4 text-amber-500" /> Purgar Platos Carta</span>
              <p className="text-[10px] text-slate-400 font-medium mt-1">Resetea el menú (No afecta a las ventas)</p>
            </div>
            <Trash2 className="w-5 h-5 text-amber-300 group-hover:text-amber-600 transition-colors" />
          </button>
        </div>
      </div>

    </div>
  );
};

const ModuleButton = ({ active, onClick, icon: Icon, title, subtitle, color }: any) => {
  const colors = {
    indigo: active ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50',
    emerald: active ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50',
    blue: active ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50',
    amber: active ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200' : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:bg-amber-50',
  };

  return (
    <button onClick={onClick} className={cn("p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-2 text-center", colors[color as keyof typeof colors])}>
      <Icon className={cn("w-6 h-6", active ? "text-white" : `text-${color}-500`)} />
      <div>
        <h4 className="text-xs font-black tracking-tight">{title}</h4>
        <p className={cn("text-[9px] font-bold uppercase tracking-widest mt-0.5", active ? "text-white/80" : "text-slate-400")}>{subtitle}</p>
      </div>
    </button>
  );
};
