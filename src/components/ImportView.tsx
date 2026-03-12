import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileSpreadsheet, CheckCircle2, Database,
  ArrowRight, Sparkles, Loader2, Camera, Receipt, Mic, Square, AlertTriangle, FileDown, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { AppData } from '../types';
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
  
  // VOSK Mic Logic
  const [recording, setRecording] = useState(false);
  const mediaRecRef = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const runId = useRef(0);
  
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
        alert("⚠️ El archivo era complejo y se ha usado un lector de emergencia básico.");
      } catch (fallbackErr) { alert(`❌ Error crítico: Archivo completamente ilegible.`); }
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
        setIsScanning(true); setProcessedData(null);
        try {
          const formData = new FormData(); formData.append("file", blob, "audio.webm");
          const voskRes = await fetch("http://localhost:2700/transcribe", { method: "POST", body: formData });
          if (!voskRes.ok) throw new Error("Vosk no responde");
          const voskData = await voskRes.json();
          
          const apiKey = sessionStorage.getItem('gemini_api_key');
          if (apiKey) {
            const genAI = new GoogleGenAI({ apiKey });
            const prompt = `${PROMPT_ALBARAN_VOICE}\n\nTexto Dictado:\n${voskData.text}`;
            const response = await genAI.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }] }], config: { responseMimeType: "application/json" } });
            const alData = safeJSON(response.text || "");
            const rec = reconcileAlbaran(alData);
            setProcessedData({
              albaranIa: { id: `alb-voz-${Date.now()}`, prov: rec.proveedor || 'Dictado por voz', date: rec.fecha || DateUtil.today(), num: rec.num || 'S/N', socio: "Arume", notes: "Transcrito con voz", items: rec.lineas.map(l => ({ q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax, unitPrice: l.total })), total: rec.sum_total, base: rec.sum_base, taxes: rec.sum_tax, invoiced: false, paid: false, reconciled: false, status: 'ok', unitId: 'REST' }
            });
          }
        } catch { alert("Error conectando con el motor de voz."); } finally { setIsScanning(false); }
      };
      mr.start(); setRecording(true); setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, 60000);
    } catch { alert("No se pudo acceder al micrófono."); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    if ('files' in e.target && e.target.files) file = e.target.files[0];
    else if ('dataTransfer' in e && e.dataTransfer.files) file = e.dataTransfer.files[0];
    if (!file) return;

    if (importMode.startsWith('ia_')) { 
       if (!file.type.includes('pdf') && !file.type.startsWith('image/')) {
         return alert("⚠️ La IA solo admite PDF o Imágenes (JPG/PNG).");
       }
       await procesarDocumentoIA(file, importMode); 
       return; 
    } else {
       if (!['.xls', '.xlsx', '.csv'].some(ext => file!.name.toLowerCase().endsWith(ext))) {
         return alert("⚠️ Este modo es para archivos Excel (.xlsx) o CSV.");
       }
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];

        if (importMode === 'tpv') {
          const dateInput = prompt(`📅 ¿Fecha de ventas TPV? (YYYY-MM-DD):`, DateUtil.today());
          if (!dateInput) return;
          const analysis = analyzeColumns(rows);
          setProcessedData({ tpvPreview: { rows, mapping: analysis.mapping, confidence: analysis.confidence, isKnown: analysis.isKnown, date: dateInput } });
        } else {
          // EXCEL ALBARANES
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
      } catch (err) { alert("Error al leer el archivo Excel."); }
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
      newData.cierres.push({ id: `cierre-imp-${Date.now()}`, date, totalVenta: totalVentaDelDia, origen: 'Importación TPV', efectivo: 0, tarjeta: totalVentaDelDia, apps: 0, notas: "Importado desde TPV", descuadre: 0, unitId: 'REST' });
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
    setProcessedData(null);
  };

  /* =======================================================
   * 🛡️ GESTIÓN SIMPLE DRAG & DROP
   * ======================================================= */
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDropLocal = (e: React.DragEvent) => { 
    e.preventDefault(); e.stopPropagation(); setIsDragging(false); 
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFileUpload(e);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-24 animate-fade-in relative">
      
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
        
        {/* SELECTOR TIPO iOS */}
        <div className="bg-slate-50 p-2 flex border-b border-slate-100">
          <div className="flex bg-white rounded-2xl p-1 shadow-sm w-full border border-slate-200">
            <button onClick={() => { setImportMode('ia_factura'); setProcessedData(null); }} className={cn("flex-1 py-2.5 rounded-xl font-bold text-[11px] uppercase tracking-widest transition-all", importMode === 'ia_factura' ? "bg-indigo-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50")}>Facturas</button>
            <button onClick={() => { setImportMode('ia_albaran'); setProcessedData(null); }} className={cn("flex-1 py-2.5 rounded-xl font-bold text-[11px] uppercase tracking-widest transition-all", importMode === 'ia_albaran' ? "bg-indigo-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50")}>Albaranes</button>
            <button onClick={() => { setImportMode('tpv'); setProcessedData(null); }} className={cn("flex-1 py-2.5 rounded-xl font-bold text-[11px] uppercase tracking-widest transition-all", importMode === 'tpv' ? "bg-indigo-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50")}>TPV / Excel</button>
          </div>
        </div>

        <div className="p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">
              {importMode === 'tpv' ? 'Sincronizar Ventas' : 'Subir Documento'}
            </h2>
            <p className="text-xs font-bold text-slate-400 mt-1">
              {importMode === 'tpv' ? 'Sube el Excel de tu caja registradora.' : 'La IA extraerá todos los datos contables por ti.'}
            </p>
          </div>

          {/* DROPZONE LIMPIA */}
          <div 
            className={cn(
              "border-2 border-dashed rounded-[2rem] p-10 flex flex-col items-center justify-center transition-all cursor-pointer relative",
              isDragging ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-slate-50 hover:bg-slate-100",
              (isScanning || recording) && "opacity-50 pointer-events-none"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDropLocal}
            onClick={() => fileInputRef.current?.click()}
          >
            <input type="file" ref={fileInputRef} disabled={isScanning || recording} onChange={handleFileUpload} accept={importMode.startsWith('ia_') ? ".pdf, image/jpeg, image/png" : ".xlsx, .csv"} className="hidden" />
            
            <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center shadow-sm mb-4">
              {isScanning ? <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /> : importMode.startsWith('ia_') ? <Receipt className="w-6 h-6 text-indigo-500" /> : <FileSpreadsheet className="w-6 h-6 text-slate-400" />}
            </div>
            
            <p className="text-sm font-black text-slate-700">{isScanning ? "Extrayendo datos..." : "Haz clic o arrastra un archivo"}</p>
            <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">{importMode.startsWith('ia_') ? "PDF o Imágenes (JPG/PNG)" : "Archivos .XLSX o .CSV"}</p>
          </div>

          {/* BOTÓN VOZ ALTERNATIVO (Solo para Albaranes) */}
          {importMode === 'ia_albaran' && (
            <button onClick={startVoiceForAlbaran} disabled={isScanning && !recording} className={cn("w-full mt-4 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition flex justify-center items-center gap-2", recording ? "bg-rose-50 border border-rose-200 text-rose-600 animate-pulse" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {recording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
              {recording ? 'DETENER Y ESCANEAR' : 'AÑADIR POR VOZ'}
            </button>
          )}

          {/* TARJETA DE CONFIRMACIÓN (Menos Intrusiva) */}
          <AnimatePresence>
            {processedData && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mt-6">
                <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-lg">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Listo para Guardar</span>
                    <button onClick={() => setProcessedData(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4"/></button>
                  </div>

                  <div className="space-y-3 mb-6 bg-slate-50 p-4 rounded-2xl">
                    {importMode === 'ia_factura' && processedData.facturaIa && (
                      <><DataRow label="Proveedor" val={processedData.facturaIa.proveedor} /><DataRow label="Nº Factura" val={processedData.facturaIa.num_factura} /><div className="h-px bg-slate-200 my-2"/><DataRow label="TOTAL" val={Num.fmt(processedData.facturaIa.total_pdf)} highlight /></>
                    )}
                    {importMode === 'ia_albaran' && processedData.albaranIa && (
                      <><DataRow label="Proveedor" val={processedData.albaranIa.prov} /><DataRow label="Líneas" val={`${processedData.albaranIa.items.length} detectadas`} /><div className="h-px bg-slate-200 my-2"/><DataRow label="TOTAL" val={Num.fmt(processedData.albaranIa.total)} highlight /></>
                    )}
                    {importMode === 'tpv' && processedData.tpvPreview && (
                      <><DataRow label="Fecha" val={processedData.tpvPreview.date} /><DataRow label="Platos leídos" val={`${processedData.tpvPreview.rows.length - 1} filas`} highlight/></>
                    )}
                  </div>

                  <button onClick={handleConfirm} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm py-4 rounded-xl transition flex justify-center items-center gap-2">
                    <Database className="w-4 h-4" /> GUARDAR EN EL SISTEMA
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </div>
  );
};

const DataRow = ({ label, val, highlight = false }: { label: string, val: string, highlight?: boolean }) => (
  <div className="flex justify-between items-center">
    <span className="text-[11px] font-bold text-slate-500 uppercase">{label}</span>
    <span className={cn("text-sm", highlight ? "font-black text-indigo-600 text-xl" : "font-bold text-slate-800")}>{val}</span>
  </div>
);
