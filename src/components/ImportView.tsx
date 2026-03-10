import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileSpreadsheet, CheckCircle2, Database,
  ArrowRight, Sparkles, Loader2, Camera, Layers, Receipt, Mic, Square, AlertTriangle, FileDown, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { AppData, Albaran } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { useColumnDetector } from '../hooks/useColumnDetector';

const n8nWebhookURL = "https://n8n.permatunnelopen.org/webhook/albaranes-ai";

interface ImportViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  onNavigate: (tab: string) => void;
}

export type ImportMode = 'tpv' | 'albaranes_excel' | 'ia_factura' | 'ia_albaran';

/* =======================================================
 * 🛡️ MOTOR DE RECONCILIACIÓN Y VALIDACIÓN (Cero Descuadres)
 * ======================================================= */
type LineaIA = { qty: number; name: string; unit: string; unit_price: number; tax_rate: 4 | 10 | 21; total: number; };
type AlbaranIA = { proveedor: string; fecha: string; num: string; unidad?: 'REST' | 'SHOP'; lineas: LineaIA[]; sum_base?: number; sum_tax?: number; sum_total?: number; };

const TOL = 0.01;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const asNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const normalizeDate = (s?: string) => {
  const v = String(s ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : new Date().toLocaleDateString('sv-SE');
};

function reconcileAlbaran(ai: AlbaranIA) {
  const lines = ai.lineas.map(l => {
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

  const declared_total = Number(ai.sum_total ?? sum_total_calc);
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

const cleanMime = (t: string) => {
  const base = (t || '').split(';')[0].trim().toLowerCase();
  const ok = ['audio/webm','audio/ogg','audio/mpeg','audio/mp3','audio/wav','audio/mp4'];
  return ok.includes(base) ? base : 'audio/webm';
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

const callGemini = async (apiKey: string, mimeType: string, base64Data: string, prompt: string) => {
  const genAI = new GoogleGenAI({ apiKey });
  const response = await genAI.models.generateContent({
    model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType } }] }],
    config: { responseMimeType: "application/json", temperature: 0.1 }
  });
  const raw = response.text || "";
  return raw.includes('{') ? JSON.parse(raw) : extractJSON(raw);
};

/* =======================================================
 * PROMPTS MAESTROS
 * ======================================================= */
const PROMPT_FACTURA = `Extrae de esta factura y devuelve SOLO JSON (application/json) con:
{ "proveedor": "string", "fecha": "YYYY-MM-DD", "num_factura": "string", "base": 0, "iva": 0, "total": 0 }
REGLAS: Números como number (decimal con punto). Fecha en YYYY-MM-DD.`;

const PROMPT_ALBARAN = `Analiza este albarán y devuelve SOLO JSON con EXACTAMENTE:
{ "proveedor": "string", "fecha": "YYYY-MM-DD", "num": "string", "unidad": "REST" | "SHOP",
  "lineas": [ {"qty": 1, "name": "string", "unit": "ud|kg|l", "unit_price": 0, "tax_rate": 4|10|21, "total": 0} ], "sum_total": 0 }
REGLAS: "lineas[].total" es el total de la línea CON IVA. tax_rate solo 4, 10 o 21. sum_total = suma de líneas.`;

const PROMPT_ALBARAN_VOICE = `Transcribe las LÍNEAS del albarán dictadas y devuelve SOLO JSON con:
{ "proveedor": "string", "fecha": "YYYY-MM-DD", "num": "string", "unidad": "REST" | "SHOP",
  "lineas": [ {"qty": 1, "name": "string", "unit": "ud", "unit_price": 0, "tax_rate": 4|10|21, "total": 0} ], "sum_total": 0 }`;

/* =======================================================
 * COMPONENTE PRINCIPAL
 * ======================================================= */
export const ImportView = ({ data, onSave, onNavigate }: ImportViewProps) => {
  const [importMode, setImportMode] = useState<ImportMode>('ia_factura');
  const [isScanning, setIsScanning] = useState(false);
  const [processedData, setProcessedData] = useState<{
    cierre?: any; ventasMenu?: any; albaranesExcel?: any[]; facturaIa?: any; albaranIa?: any; tpvPreview?: any
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const mediaRecRef = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const runId = useRef(0);
  
  // 🛡️ Contador de Drag para evitar el parpadeo
  const dragCounter = useRef(0);

  // Hook Inteligente TPV
  const { analyzeColumns, saveProfile } = useColumnDetector();

  const generarHash = async (prov: string, num: string, date: string, total: number) => {
    const text = `${prov.toLowerCase().trim()}|${num.toLowerCase().trim()}|${date}|${total.toFixed(2)}`;
    const encoder = new TextEncoder(); const dataHash = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataHash);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const categorizeItem = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('vino') || n.includes('agua') || n.includes('cerveza') || n.includes('copa') || n.includes('refresco')) return 'Bebidas';
    if (n.includes('postre') || n.includes('tarta') || n.includes('helado') || n.includes('cafe')) return 'Postre';
    if (n.includes('pan') || n.includes('ensalada') || n.includes('croqueta')) return 'Entrantes';
    return 'General';
  };

  const procesarDocumentoIA = async (file: File | Blob, mode: ImportMode) => {
    const myRunId = ++runId.current;
    const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
    setIsScanning(true); setProcessedData(null);

    try {
      if (!apiKey) throw new Error("NO_API_KEY");
      let base64Data = ""; let mimeType = file.type;

      if (file.type.startsWith('image/')) {
        const compressed = await compressImage(file);
        base64Data = compressed.split(',')[1]; mimeType = "image/jpeg";
      } else {
        const buffer = await file.arrayBuffer();
        base64Data = btoa(new Uint8Array(buffer).reduce((d, byte) => d + String.fromCharCode(byte), ''));
      }

      const prompt = mode === 'ia_factura' ? PROMPT_FACTURA : PROMPT_ALBARAN;
      const datosIA = await callGemini(apiKey, mimeType, base64Data, prompt);
      if (myRunId !== runId.current) return;

      if (mode === 'ia_factura') {
        const prov = datosIA.proveedor || "Desconocido"; const numF = datosIA.num_factura || `S/N-${Date.now()}`; const fecha = normalizeDate(datosIA.fecha);
        const totalPdf = asNum(datosIA.total) || 0; const baseNum = asNum(datosIA.base) || Number((totalPdf / 1.10).toFixed(2)); const ivaNum = asNum(datosIA.iva) || Number((totalPdf - baseNum).toFixed(2));

        setProcessedData({
          facturaIa: {
            id: `fac-ia-${Date.now()}`, hash: await generarHash(prov, numF, fecha, totalPdf),
            proveedor: prov, num_factura: numF, fecha: fecha, base: baseNum, iva: ivaNum, total_pdf: totalPdf,
            pagada: false, cuadra: false, status: 'pendiente', notas: "IA Scanner", unidad_negocio: 'REST'
          }
        });
      } else {
        const al: AlbaranIA = {
          proveedor: datosIA.proveedor || "Desconocido", fecha: normalizeDate(datosIA.fecha), num: datosIA.num || "S/N",
          unidad: (datosIA.unidad === 'SHOP' ? 'SHOP' : 'REST'), lineas: Array.isArray(datosIA.lineas) ? datosIA.lineas : [], sum_total: asNum(datosIA.sum_total),
        };
        const rec = reconcileAlbaran(al);
        setProcessedData({
          albaranIa: {
            id: `alb-ia-${Date.now()}`, prov: rec.proveedor, date: rec.fecha, num: rec.num, socio: "Arume",
            notes: rec.cuadra ? "IA OK" : `IA WARNING (diff=${rec.diff})`,
            items: rec.lineas.map(l => ({ q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax, unitPrice: l.unit_price ?? (l.qty ? round2(l.total / l.qty) : l.total) })),
            total: rec.sum_total, base: rec.sum_base, taxes: rec.sum_tax, invoiced: false, paid: false, reconciled: false,
            status: rec.cuadra ? 'ok' : 'warning', unitId: rec.unidad || 'REST', by_rate: rec.by_rate,
          }
        });
      }
    } catch (error: any) {
      if (myRunId !== runId.current) return;
      console.warn("⚠️ Gemini falló. Activando Rescate...");
      try {
        let extractedText = ""; let possibleTotal = 0;
        if (file.type.includes('image')) {
           const tesseractModule = await import('tesseract.js'); const Tesseract = tesseractModule.default || tesseractModule;
           const { data: { text } } = await Tesseract.recognize(file as File, 'spa'); extractedText = text;
        } else if (file.type === 'application/pdf') {
           const pdfjsModule = await import('pdfjs-dist'); const pdfjsLib = pdfjsModule.default || pdfjsModule;
           pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
           const arrayBuffer = await file.arrayBuffer(); const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
           for (let i = 1; i <= pdfDoc.numPages; i++) { const page = await pdfDoc.getPage(i); const textContent = await page.getTextContent(); extractedText += textContent.items.map((item: any) => item.str).join(' ') + '\n'; }
        } 
        
        const matches = extractedText.match(/(\d+([.,]\d{2}))/g);
        if (matches) { const nums = matches.map(m => parseFloat(m.replace(',', '.'))); const validNums = nums.filter(n => n < 50000); possibleTotal = validNums.length > 0 ? Math.max(...validNums) : 0; }
        const fallbackBase = Number((possibleTotal / 1.10).toFixed(2)); const fallbackIva = Number((possibleTotal - fallbackBase).toFixed(2)); const today = DateUtil.today();

        if (mode === 'ia_factura') {
          setProcessedData({ facturaIa: { id: `fac-fall-${Date.now()}`, hash: `fall-${Date.now()}`, proveedor: file.type.includes('image') ? '📷 OCR Rescate' : '📄 PDF Rescate', num_factura: 'S/N-REVISAR', fecha: today, base: fallbackBase, iva: fallbackIva, total_pdf: possibleTotal, pagada: false, cuadra: false, status: 'pendiente', notas: "Generado por Rescate Local", unidad_negocio: 'REST' } });
        } else {
          setProcessedData({ albaranIa: { id: `alb-fall-${Date.now()}`, prov: file.type.includes('image') ? '📷 OCR Rescate' : '📄 PDF Rescate', date: today, num: 'S/N-REVISAR', socio: "Arume", notes: "Generado por Rescate Local. Revisar líneas.", items: [{ q: 1, n: "Gasto recuperado", unit: "ud", t: possibleTotal, rate: 10, base: fallbackBase, tax: fallbackIva, unitPrice: possibleTotal }], total: possibleTotal, base: fallbackBase, taxes: fallbackIva, invoiced: false, paid: false, reconciled: false, status: 'warning', unitId: 'REST' } });
        }
        alert("⚠️ Gemini no pudo procesarlo. Se ha extraído un borrador de rescate.");
      } catch (fallbackErr) { alert(`⚠️ Error crítico: Archivo ilegible.`); }
    } finally { if (myRunId === runId.current) setIsScanning(false); }
  };

  const startVoiceForAlbaran = async () => {
    if (recording) { mediaRecRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); mediaRecRef.current = mr; chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const mime = cleanMime(mr.mimeType); const blob = new Blob(chunksRef.current, { type: mime });
        stream.getTracks().forEach(t => t.stop()); setRecording(false);
        // Enviamos al VOSK Local
        setIsScanning(true); setProcessedData(null);
        try {
          const formData = new FormData(); formData.append("file", blob, "audio.webm");
          const voskRes = await fetch("http://localhost:2700/transcribe", { method: "POST", body: formData });
          if (!voskRes.ok) throw new Error("Vosk no responde");
          const voskData = await voskRes.json();
          
          // Si VOSK funciona, le pasamos el texto a Gemini para estructurarlo
          const apiKey = sessionStorage.getItem('gemini_api_key');
          if (apiKey) {
            const genAI = new GoogleGenAI({ apiKey });
            const prompt = `${PROMPT_ALBARAN_VOICE}\n\nTexto Dictado:\n${voskData.text}`;
            const response = await genAI.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }] }], config: { responseMimeType: "application/json" } });
            const alData = safeJSON(response.text || "");
            const rec = reconcileAlbaran(alData);
            setProcessedData({
              albaranIa: { id: `alb-voz-${Date.now()}`, prov: rec.proveedor || 'Dictado por voz', date: rec.fecha || DateUtil.today(), num: rec.num || 'S/N', socio: "Arume", notes: "Transcrito con VOSK", items: rec.lineas.map(l => ({ q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax, unitPrice: l.total })), total: rec.sum_total, base: rec.sum_base, taxes: rec.sum_tax, invoiced: false, paid: false, reconciled: false, status: 'ok', unitId: 'REST' }
            });
          }
        } catch { alert("Error con servidor VOSK local."); } finally { setIsScanning(false); }
      };
      mr.start(); setRecording(true); setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, 60000);
    } catch { alert("No se pudo acceder al micrófono"); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    if ('files' in e.target && e.target.files) file = e.target.files[0];
    else if ('dataTransfer' in e && e.dataTransfer.files) file = e.dataTransfer.files[0];
    if (!file) return;

    // 🛡️ Validación de Tipo de Archivo Profesional
    if (importMode.startsWith('ia_')) { 
       if (!file.type.includes('pdf') && !file.type.startsWith('image/')) {
         return alert("⚠️ La IA solo soporta PDFs o Imágenes (JPG/PNG).");
       }
       await procesarDocumentoIA(file, importMode); 
       return; 
    } else {
       if (!['.xls', '.xlsx', '.csv'].some(ext => file!.name.toLowerCase().endsWith(ext))) {
         return alert("⚠️ Este modo solo acepta archivos Excel (.xlsx) o CSV.");
       }
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];

        if (importMode === 'tpv') {
          const dateInput = prompt(`📅 ¿Fecha de estas ventas TPV? (YYYY-MM-DD):`, DateUtil.today());
          if (!dateInput) return;
          const analysis = analyzeColumns(rows);
          setProcessedData({ tpvPreview: { rows, mapping: analysis.mapping, confidence: analysis.confidence, isKnown: analysis.isKnown, date: dateInput } });
        } else {
          // EXCEL DE ALBARANES
          const agrupados: Record<string, AlbaranIA> = {};
          rows.slice(1).forEach(fila => {
            const prov = fila[0] || 'Desconocido'; const fecha = normalizeDate(fila[1]); const producto = fila[2] || 'Varios'; const cantidad = Num.parse(fila[3] || 1);
            const total = Num.parse(String(fila[4] || "0").replace(',', '.'));
            const key = `${prov}-${fecha}`;
            if (!agrupados[key]) agrupados[key] = { proveedor: prov, fecha, num: 'S/N', lineas: [], unidad: 'REST' };
            agrupados[key].lineas.push({ qty: cantidad, name: producto, unit: 'ud', unit_price: cantidad ? total/cantidad : total, tax_rate: 10, total });
          });
          const albsExcel = Object.values(agrupados).map(al => {
            const rec = reconcileAlbaran(al);
            return { id: `alb-xls-${Date.now()}-${Math.random().toString(36).substring(2,5)}`, prov: rec.proveedor, date: rec.fecha, num: rec.num, socio: 'Arume', items: rec.lineas.map(l => ({ q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax, unitPrice: l.unit_price })), total: rec.sum_total, base: rec.sum_base, taxes: rec.sum_tax, invoiced: false, paid: false, status: 'ok', unitId: 'REST' };
          });
          setProcessedData({ albaranesExcel: albsExcel });
        }
      } catch (err) { alert("Error al leer Excel."); }
    };
    reader.readAsBinaryString(file);
  };

  const handleConfirm = async () => {
    if (!processedData) return;
    const newData = { ...data };
    
    if (importMode === 'tpv' && processedData.tpvPreview) {
      const { rows, mapping, date } = processedData.tpvPreview;
      const newPlatos = [...(data.platos || [])]; const newVentas = [...(data.ventas_menu || [])];
      let totalVentaDelDia = 0;
      
      rows.slice(1).forEach(row => {
        const name = String(row[mapping.name] || '').trim(); const sold = Num.parse(row[mapping.qty]); const price = mapping.price > -1 ? Num.parse(row[mapping.price]) : 0;
        if (name.length > 1 && sold > 0 && sold < 5000) {
          totalVentaDelDia += (price * sold);
          let plato = newPlatos.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim());
          if (!plato) { plato = { id: 'p-' + Date.now() + Math.random(), name, category: categorizeItem(name), price, cost: 0 }; newPlatos.push(plato); }
          else if (price > 0 && plato.price !== price) plato.price = price;
          const existing = newVentas.find(v => v.date === date && v.id === plato!.id);
          if (existing) existing.qty += sold; else newVentas.push({ date, id: plato.id, qty: sold });
        }
      });
      
      if (!newData.cierres) newData.cierres = [];
      newData.cierres.push({ id: `cierre-imp-${Date.now()}`, date, totalVenta: totalVentaDelDia, origen: 'Importación TPV', efectivo: 0, tarjeta: totalVentaDelDia, apps: 0, notas: "Importado desde TPV (Suma de platos)", descuadre: 0, unitId: 'REST' });
      saveProfile(rows, mapping);
      await onSave({ ...data, platos: newPlatos, ventas_menu: newVentas, cierres: newData.cierres });
      onNavigate('menus');
    } 
    else if (importMode === 'albaranes_excel' && processedData.albaranesExcel) {
      if (!newData.albaranes) newData.albaranes = [];
      newData.albaranes = [...newData.albaranes, ...processedData.albaranesExcel];
      await onSave(newData); onNavigate('albaranes');
    } 
    else if (importMode === 'ia_factura' && processedData.facturaIa) {
      if (!newData.facturas) newData.facturas = [];
      newData.facturas.push(processedData.facturaIa);
      fetch(n8nWebhookURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(processedData.facturaIa) }).catch(() => {});
      await onSave(newData); onNavigate('facturas'); 
    }
    else if (importMode === 'ia_albaran' && processedData.albaranIa) {
      if (!newData.albaranes) newData.albaranes = [];
      newData.albaranes.push(processedData.albaranIa);
      await onSave(newData); onNavigate('albaranes');
    }
    alert("¡Datos guardados con éxito en la base de datos!");
    setProcessedData(null);
  };

  /* =======================================================
   * 🛡️ GESTIÓN PROFESIONAL DEL DRAG & DROP
   * ======================================================= */
  useEffect(() => {
    // 1. Bloqueo global de Drag & Drop para no abrir archivos accidentalmente en otra pestaña
    const blockDefault = (e: DragEvent) => {
      if (!(e.target as HTMLElement)?.closest(".dropzone-area")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("dragover", blockDefault);
    window.addEventListener("drop", blockDefault);

    // 2. Limpieza de Overlay si el ratón sale de la ventana del navegador
    const cancelDrag = () => {
      dragCounter.current = 0;
      setIsDragging(false);
    };
    window.addEventListener("mouseout", (e) => {
      if (!e.relatedTarget && !e.toElement) cancelDrag();
    });

    return () => { 
      window.removeEventListener("dragover", blockDefault);
      window.removeEventListener("drop", blockDefault);
      window.removeEventListener("mouseout", cancelDrag);
    };
  }, []);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      setIsDragging(false);
      dragCounter.current = 0;
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    
    if (!e.dataTransfer?.files?.length) return;
    if (e.dataTransfer.files.length > 1) {
       alert("⚠️ Sube los documentos de uno en uno para evitar errores.");
       return;
    }
    handleFileUpload(e as any);
  };

  return (
    <div className={cn("max-w-3xl mx-auto space-y-6 animate-fade-in pb-24 min-h-[80vh] relative")}>
      
      {/* 🚀 OVERLAY DE ARRASTRE SEGURO (pointer-events-auto en contenedor, none interno) */}
      <AnimatePresence>
        {isDragging && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[999] bg-indigo-600/90 backdrop-blur-sm rounded-[3rem] border-4 border-dashed border-white flex items-center justify-center pointer-events-auto dropzone-area"
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="flex flex-col items-center pointer-events-none">
              <FileDown className="w-24 h-24 text-white mb-4 animate-bounce" />
              <h2 className="text-4xl font-black text-white tracking-tighter">¡Suéltalo aquí!</h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100 relative z-10">
        <header className="text-center mb-8 flex flex-col items-center">
          <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-[2rem] flex items-center justify-center text-3xl mb-4 transform rotate-3 shadow-inner">
            <Upload className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Bandeja de Entrada</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Sube archivos, tickets y facturas</p>
          
          {importMode === 'ia_albaran' && (
            <button onClick={startVoiceForAlbaran} disabled={isScanning && !recording} className={cn("mt-4 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all shadow-md flex items-center justify-center gap-2", recording ? "bg-rose-500 text-white animate-pulse" : "bg-slate-900 text-white hover:bg-slate-800")}>
              {recording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
              {recording ? 'DETENER Y ANALIZAR...' : '🎙️ AÑADIR POR VOZ (VOSK)'}
            </button>
          )}
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-100 p-1.5 rounded-3xl mb-8">
          <button onClick={() => { setImportMode('ia_factura'); setProcessedData(null); }} className={cn("py-3 px-2 rounded-2xl font-black text-[9px] uppercase transition flex items-center justify-center gap-1.5", importMode === 'ia_factura' ? "bg-indigo-600 shadow-md text-white" : "text-slate-500 hover:bg-slate-200")}><Sparkles className="w-3.5 h-3.5" /> IA Facturas</button>
          <button onClick={() => { setImportMode('ia_albaran'); setProcessedData(null); }} className={cn("py-3 px-2 rounded-2xl font-black text-[9px] uppercase transition flex items-center justify-center gap-1.5", importMode === 'ia_albaran' ? "bg-emerald-500 shadow-md text-white" : "text-slate-500 hover:bg-slate-200")}><Camera className="w-3.5 h-3.5" /> IA Albaranes</button>
          <button onClick={() => { setImportMode('tpv'); setProcessedData(null); }} className={cn("py-3 px-2 rounded-2xl font-black text-[9px] uppercase transition flex items-center justify-center gap-1.5", importMode === 'tpv' ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:bg-slate-200")}><Database className="w-3.5 h-3.5" /> Excel TPV</button>
          <button onClick={() => { setImportMode('albaranes_excel'); setProcessedData(null); }} className={cn("py-3 px-2 rounded-2xl font-black text-[9px] uppercase transition flex items-center justify-center gap-1.5", importMode === 'albaranes_excel' ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:bg-slate-200")}><FileSpreadsheet className="w-3.5 h-3.5" /> Excel Alb.</button>
        </div>

        {/* 📦 DROPZONE DELIMITADA Y SEGURA */}
        <div 
          className={cn("dropzone-area border-2 border-dashed rounded-[2.5rem] p-12 text-center transition-all relative group overflow-hidden", isDragging ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50", (isScanning || recording) && "opacity-50 pointer-events-none")}
          onDragEnter={handleDragEnter}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <input type="file" disabled={isScanning || recording} onChange={handleFileUpload} accept={importMode.startsWith('ia_') ? ".pdf, image/jpeg, image/png, image/webp" : ".xlsx, .xls, .csv"} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" />
          <div className="space-y-4 relative z-10 pointer-events-none">
            <div className="w-16 h-16 bg-white rounded-[2rem] shadow-sm border border-slate-100 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
              {isScanning ? <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /> : importMode.startsWith('ia_') ? <Receipt className="w-8 h-8 text-indigo-500" /> : <FileSpreadsheet className="w-8 h-8 text-slate-400" />}
            </div>
            <div>
              <p className="text-sm font-black text-slate-600">{isScanning ? "El Cerebro IA está procesando..." : "Arrastra un archivo aquí o haz clic"}</p>
              <p className="text-[10px] text-slate-400 mt-1 font-bold uppercase tracking-widest">{importMode.startsWith('ia_') ? "Soporta PDFs y Fotografías (JPG, PNG)" : "Formatos: .xlsx, .csv"}</p>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {processedData && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="mt-8 bg-slate-900 p-6 rounded-[2.5rem] space-y-4 shadow-xl">
              <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center"><CheckCircle2 className="w-6 h-6" /></div>
                  <div><h3 className="font-black text-white text-sm uppercase tracking-widest">Extracción Completada</h3><p className="text-[10px] text-slate-400 font-bold uppercase">Revisa los datos antes de guardar</p></div>
                </div>
                <button onClick={() => setProcessedData(null)} className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white transition"><X className="w-4 h-4" /></button>
              </div>

              {importMode === 'ia_albaran' && processedData.albaranIa && processedData.albaranIa.status === 'warning' && (
                <div className="px-4 py-3 rounded-2xl text-[10px] font-black bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /><span>{processedData.albaranIa.notes || "DESCUADRE DETECTADO ENTRE LÍNEAS Y TOTAL."}</span></div>
              )}
              
              {importMode === 'ia_factura' && processedData.facturaIa && processedData.facturaIa.proveedor.includes('Rescate') && (
                <div className="px-4 py-3 rounded-2xl text-[10px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> SE USÓ EL RESCATE LOCAL. COMPRUEBA EL TOTAL.</div>
              )}

              {/* TPV PREVIEW (Inteligencia de Columnas) */}
              {importMode === 'tpv' && processedData.tpvPreview && (
                <>
                  <div className={cn("p-4 rounded-2xl flex items-start gap-3", processedData.tpvPreview.isKnown ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-indigo-500/10 border border-indigo-500/20 text-indigo-400")}>
                    {processedData.tpvPreview.isKnown ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <Sparkles className="w-5 h-5 shrink-0" />}
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest">{processedData.tpvPreview.isKnown ? "PERFIL TPV RECONOCIDO" : "NUEVO FORMATO DETECTADO"}</p>
                      <p className="text-[10px] opacity-80 mt-1">{processedData.tpvPreview.isKnown ? "Patrón guardado de importaciones anteriores." : `Confianza del ${processedData.tpvPreview.confidence}%. Verifica la tabla.`}</p>
                    </div>
                  </div>
                  <div className="border border-slate-700 rounded-2xl overflow-hidden mt-4">
                    <table className="w-full text-left text-[10px] text-slate-300">
                      <thead className="bg-slate-800 font-black uppercase">
                        <tr>
                          <th className="p-3">Nombre (Col {processedData.tpvPreview.mapping.name + 1})</th>
                          <th className="p-3 text-center">Cant. (Col {processedData.tpvPreview.mapping.qty + 1})</th>
                          <th className="p-3 text-right">Precio (Col {processedData.tpvPreview.mapping.price + 1})</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {processedData.tpvPreview.rows.slice(1, 4).map((row: any, i: number) => (
                          <tr key={i}>
                            <td className="p-3 text-white font-bold">{row[processedData.tpvPreview.mapping.name] || '—'}</td>
                            <td className="p-3 text-center">{row[processedData.tpvPreview.mapping.qty] || 0}</td>
                            <td className="p-3 text-right">{Num.fmt(row[processedData.tpvPreview.mapping.price] || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="bg-slate-800/50 rounded-2xl p-5 space-y-3 mt-4">
                {importMode === 'ia_factura' && processedData.facturaIa && (
                  <><DataRow label="Proveedor" val={processedData.facturaIa.proveedor} /><DataRow label="Nº Factura" val={processedData.facturaIa.num_factura} /><DataRow label="Fecha" val={processedData.facturaIa.fecha} /><div className="border-t border-slate-700/50 my-2 pt-2"></div><DataRow label="Base" val={Num.fmt(processedData.facturaIa.base)} /><DataRow label="IVA" val={Num.fmt(processedData.facturaIa.iva)} /><DataRow label="TOTAL FACTURA" val={Num.fmt(processedData.facturaIa.total_pdf)} highlight /></>
                )}
                {importMode === 'ia_albaran' && processedData.albaranIa && (
                  <><DataRow label="Proveedor" val={processedData.albaranIa.prov} /><DataRow label="Fecha" val={processedData.albaranIa.date} /><DataRow label="Líneas" val={`${processedData.albaranIa.items.length} detectadas`} /><div className="border-t border-slate-700/50 my-2 pt-2"></div><DataRow label="Base Calc" val={Num.fmt(processedData.albaranIa.base)} /><DataRow label="TOTAL ALBARÁN" val={Num.fmt(processedData.albaranIa.total)} highlight /></>
                )}
                {importMode === 'albaranes_excel' && (<DataRow label="Albaranes Extraídos" val={`${processedData.albaranesExcel?.length} documentos`} highlight />)}
              </div>

              <button onClick={handleConfirm} className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-black py-4 rounded-2xl transition shadow-lg flex items-center justify-center gap-2 group mt-2">
                <Database className="w-4 h-4" /> <span>CONFIRMAR E IMPORTAR</span> <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const DataRow = ({ label, val, highlight = false }: { label: string, val: string, highlight?: boolean }) => (
  <div className="flex justify-between items-center">
    <span className={cn("text-[10px] font-black uppercase tracking-widest", highlight ? "text-emerald-400" : "text-slate-400")}>{label}</span>
    <span className={cn("text-xs", highlight ? "font-black text-emerald-400 text-lg" : "font-bold text-white")}>{val}</span>
  </div>
);
