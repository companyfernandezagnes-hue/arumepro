import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileSpreadsheet, CheckCircle2, Database,
  ArrowRight, FileText, Sparkles, Loader2, Camera, Layers, Receipt, Mic, Square, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { AppData, Albaran } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';

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

type LineaIA = {
  qty: number;
  name: string;
  unit: string;
  unit_price: number;
  tax_rate: 4 | 10 | 21;
  total: number; // TOTAL CON IVA
};

type AlbaranIA = {
  proveedor: string;
  fecha: string;
  num: string;
  unidad?: 'REST' | 'SHOP';
  lineas: LineaIA[];
  sum_base?: number;
  sum_tax?: number;
  sum_total?: number;
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

  return {
    ...ai,
    lineas: lines,
    sum_base,
    sum_tax,
    sum_total: sum_total_calc,
    by_rate: {
      4:  { base: base4,  tax: tax4 },
      10: { base: base10, tax: tax10 },
      21: { base: base21, tax: tax21 },
    },
    diff,
    cuadra,
  };
}

const extractJSON = (rawText: string) => {
  try {
    if (!rawText) return {};
    const clean = rawText.replace(/(?:json)?/gi, '').replace(/\uFEFF/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
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
  const MAX_BYTES = 4 * 1024 * 1024; 
  const MAX_W = 1600, MAX_H = 1600;
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const ratio = Math.min(MAX_W / width, MAX_H / height, 1);
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx?.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/jpeg', 0.8));
  const finalBlob = blob.size > MAX_BYTES ? await new Promise<Blob>(res => canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.6)) : blob;
  const b64 = await new Promise<string>((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve((fr.result as string).split(',')[1]);
    fr.readAsDataURL(finalBlob);
  });
  return `data:image/jpeg;base64,${b64}`;
};

// Llamada Unificada a Gemini para forzar JSON Nativo
const callGemini = async (apiKey: string, mimeType: string, base64Data: string, prompt: string) => {
  const genAI = new GoogleGenAI({ apiKey });
  const response = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType } }] }],
    config: { responseMimeType: "application/json", temperature: 0.1 }
  });
  const raw = response.text || "";
  return raw.includes('{') ? JSON.parse(raw) : extractJSON(raw);
};

/* =======================================================
 * PROMPTS MAESTROS
 * ======================================================= */
const PROMPT_FACTURA = `Extrae de esta factura y devuelve SOLO JSON (application/json) con:
{
  "proveedor": "string", "fecha": "YYYY-MM-DD", "num_factura": "string",
  "base": 0, "iva": 0, "total": 0
}
REGLAS: Números como number (decimal con punto). Fecha en YYYY-MM-DD.`;

const PROMPT_ALBARAN = `Analiza este albarán y devuelve SOLO JSON con EXACTAMENTE:
{
  "proveedor": "string", "fecha": "YYYY-MM-DD", "num": "string", "unidad": "REST" | "SHOP",
  "lineas": [ {"qty": 1, "name": "string", "unit": "ud|kg|l", "unit_price": 0, "tax_rate": 4|10|21, "total": 0} ],
  "sum_total": 0
}
REGLAS:
- "lineas[].total" es el total de la línea CON IVA.
- "tax_rate" solo 4, 10 o 21. Si dudas, 10. Alcohol 21.
- "sum_total" = suma de todas las líneas (con IVA).
- Si la dirección es Catalunya="SHOP", Av. Argentina="REST".`;

const PROMPT_ALBARAN_VOICE = `Transcribe las LÍNEAS del albarán dictadas y devuelve SOLO JSON con:
{
  "proveedor": "string", "fecha": "YYYY-MM-DD", "num": "string", "unidad": "REST" | "SHOP",
  "lineas": [ {"qty": 1, "name": "string", "unit": "ud", "unit_price": 0, "tax_rate": 4|10|21, "total": 0} ],
  "sum_total": 0
}
REGLAS: tax_rate sólo 4, 10 o 21. Número como number con punto.`;


/* =======================================================
 * COMPONENTE PRINCIPAL
 * ======================================================= */
export const ImportView = ({ data, onSave, onNavigate }: ImportViewProps) => {
  const [importMode, setImportMode] = useState<ImportMode>('ia_factura');
  const [isScanning, setIsScanning] = useState(false);
  const [processedData, setProcessedData] = useState<{
    cierre?: any;
    ventasMenu?: any;
    albaranesExcel?: any[];
    facturaIa?: any;
    albaranIa?: any;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Estados de Voz
  const [recording, setRecording] = useState(false);
  const mediaRecRef = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const generarHash = async (prov: string, num: string, date: string, total: number) => {
    const text = `${prov.toLowerCase().trim()}|${num.toLowerCase().trim()}|${date}|${total.toFixed(2)}`;
    const encoder = new TextEncoder();
    const dataHash = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataHash);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // 🚀 LECTOR UNIVERSAL (PDF/IMG)
  const procesarDocumentoIA = async (file: File | Blob, mode: ImportMode) => {
    const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("⚠️ Conecta tu IA en la pestaña Configuración primero.");

    setIsScanning(true);
    setProcessedData(null);

    try {
      let base64Data = "";
      let mimeType = file.type;

      if (file.type.startsWith('image/')) {
        const compressed = await compressImage(file);
        base64Data = compressed.split(',')[1];
        mimeType = "image/jpeg";
      } else {
        const buffer = await file.arrayBuffer();
        base64Data = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
      }

      const prompt = mode === 'ia_factura' ? PROMPT_FACTURA : PROMPT_ALBARAN;
      const datosIA = await callGemini(apiKey, mimeType, base64Data, prompt);

      if (mode === 'ia_factura') {
        const prov = datosIA.proveedor || "Desconocido";
        const numF = datosIA.num_factura || `S/N-${Date.now()}`;
        const fecha = normalizeDate(datosIA.fecha);
        const totalPdf = asNum(datosIA.total);

        setProcessedData({
          facturaIa: {
            id: `fac-ia-${Date.now()}`,
            hash: await generarHash(prov, numF, fecha, totalPdf),
            proveedor: prov, num_factura: numF, fecha: fecha,
            base: asNum(datosIA.base), iva: asNum(datosIA.iva), total_pdf: totalPdf,
            pagada: false, cuadra: false, status: 'pendiente', notas: "IA Scanner"
          }
        });
      } else {
        const al: AlbaranIA = {
          proveedor: datosIA.proveedor || "Desconocido",
          fecha: normalizeDate(datosIA.fecha),
          num: datosIA.num || "S/N",
          unidad: (datosIA.unidad === 'SHOP' ? 'SHOP' : 'REST'),
          lineas: Array.isArray(datosIA.lineas) ? datosIA.lineas : [],
          sum_total: asNum(datosIA.sum_total),
        };

        const rec = reconcileAlbaran(al);

        setProcessedData({
          albaranIa: {
            id: `alb-ia-${Date.now()}`,
            prov: rec.proveedor, date: rec.fecha, num: rec.num, socio: "Arume",
            notes: rec.cuadra ? "IA OK" : `IA WARNING (diff=${rec.diff})`,
            items: rec.lineas.map(l => ({
              q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax,
              unitPrice: l.unit_price ?? (l.qty ? round2(l.total / l.qty) : l.total),
            })),
            total: rec.sum_total, base: rec.sum_base, taxes: rec.sum_tax,
            invoiced: false, paid: false, reconciled: false,
            status: rec.cuadra ? 'ok' : 'warning', unitId: rec.unidad || 'REST',
            by_rate: rec.by_rate,
          }
        });
      }
    } catch (error: any) {
      console.error("Error AI Scan:", error);
      alert(`⚠️ Error leyendo documento. Revisa que el ticket esté claro.`);
    } finally {
      setIsScanning(false);
    }
  };

  // 🎙️ MAGIA DE VOZ
  const startVoiceForAlbaran = async () => {
    if (recording) {
      mediaRecRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const mime = cleanMime(mr.mimeType);
        const blob = new Blob(chunksRef.current, { type: mime });
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        await processVoiceAlbaran(blob, mime);
      };

      mr.start();
      setRecording(true);
      setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, 60000);
    } catch {
      alert("No se pudo acceder al micrófono");
    }
  };

  const processVoiceAlbaran = async (audioBlob: Blob, mimeType: string) => {
    const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("Conecta tu IA primero.");

    setIsScanning(true);
    setProcessedData(null);

    try {
      const base64 = await new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve((fr.result as string).split(',')[1]);
        fr.readAsDataURL(audioBlob);
      });

      const datosIA = await callGemini(apiKey, mimeType, base64, PROMPT_ALBARAN_VOICE);

      const al: AlbaranIA = {
        proveedor: datosIA.proveedor || "Desconocido",
        fecha: normalizeDate(datosIA.fecha),
        num: datosIA.num || "S/N",
        unidad: (datosIA.unidad === 'SHOP' ? 'SHOP' : 'REST'),
        lineas: Array.isArray(datosIA.lineas) ? datosIA.lineas : [],
        sum_total: asNum(datosIA.sum_total),
      };
      
      const rec = reconcileAlbaran(al);

      setProcessedData({
        albaranIa: {
          id: `alb-voz-${Date.now()}`,
          prov: rec.proveedor, date: rec.fecha, num: rec.num, socio: "Arume",
          notes: rec.cuadra ? "VOZ OK" : `VOZ WARNING (diff=${rec.diff})`,
          items: rec.lineas.map(l => ({
            q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax,
            unitPrice: l.unit_price ?? (l.qty ? round2(l.total / l.qty) : l.total),
          })),
          total: rec.sum_total, base: rec.sum_base, taxes: rec.sum_tax,
          invoiced: false, paid: false, reconciled: false,
          status: rec.cuadra ? 'ok' : 'warning', unitId: rec.unidad || 'REST',
          by_rate: rec.by_rate,
        }
      });
    } catch (e: any) {
      alert("La IA no entendió el dictado.");
    } finally {
      setIsScanning(false);
    }
  };

  // EXCEL Y TPV CLÁSICOS
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    if ('files' in e.target && e.target.files) file = e.target.files[0];
    else if ('dataTransfer' in e && e.dataTransfer.files) file = e.dataTransfer.files[0];

    if (!file) return;

    if (importMode.startsWith('ia_')) {
      await procesarDocumentoIA(file, importMode);
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws) as any[];

        if (importMode === 'tpv') procesarDatosDelTPV(rows);
        else procesarAlbaranesExcel(rows);
      } catch (err) {
        alert("Error al leer Excel. Asegúrate de que el formato sea correcto.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const procesarAlbaranesExcel = (filas: any[]) => {
    if (filas.length === 0) return alert("Archivo vacío");
    const agrupados: Record<string, AlbaranIA> = {};
    
    filas.forEach(fila => {
      const prov = fila['Proveedor'] || fila['PROVEEDOR'] || 'Desconocido';
      const fecha = normalizeDate(fila['Fecha'] || fila['FECHA']);
      const producto = fila['Producto'] || fila['Articulo'] || 'Varios';
      const cantidad = Num.parse(fila['Cantidad'] || fila['Uds'] || 1);
      const total = Num.parse(fila['Total'] || fila['Importe'] || 0);
      
      const ivaCol = fila['IVA'] ?? fila['iva'] ?? fila['Iva'];
      const rate = [4,10,21].includes(Number(ivaCol)) ? Number(ivaCol) as 4|10|21 : (
        String(producto).toUpperCase().match(/\b(VINO|ALCOHOL|CERVEZA|SAKE)\b/) ? 21 : 10
      );

      const key = `${prov}-${fecha}`;
      if (!agrupados[key]) {
        agrupados[key] = { proveedor: prov, fecha, num: 'S/N', lineas: [], unidad: 'REST' };
      }
      
      agrupados[key].lineas.push({
        qty: cantidad, name: producto, unit: 'ud', unit_price: cantidad > 0 ? round2(total / cantidad) : total,
        tax_rate: rate, total: total
      });
    });

    // Reconciliamos todos los excel para evitar descuadres de IVA
    const albaranesReconciliados = Object.values(agrupados).map(al => {
      const rec = reconcileAlbaran(al);
      return {
        id: `alb-xls-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        prov: rec.proveedor, date: rec.fecha, num: rec.num, socio: 'Arume',
        items: rec.lineas.map(l => ({
          q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax,
          unitPrice: l.unit_price
        })),
        total: rec.sum_total, base: rec.sum_base, taxes: rec.sum_tax,
        invoiced: false, paid: false, status: 'ok', unitId: 'REST'
      };
    });

    setProcessedData({ albaranesExcel: albaranesReconciliados });
  };

  const procesarDatosDelTPV = (filas: any[]) => {
    if (filas.length === 0) return alert("Archivo vacío");
    let totalVentaDelDia = 0;
    let desglosePlatos: any[] = [];
    filas.forEach(fila => {
      const nombreProducto = fila['Producto'] || fila['Articulo'];
      const cantidadVendida = Num.parse(fila['Cantidad'] || fila['Uds']);
      const totalLinea = Num.parse(fila['Total'] || fila['Importe']);
      if (nombreProducto && cantidadVendida > 0) {
        totalVentaDelDia += totalLinea;
        desglosePlatos.push({ nombre: nombreProducto, cantidad: cantidadVendida, total: totalLinea });
      }
    });
    setProcessedData({
      cierre: { id: `cierre-imp-${Date.now()}`, date: DateUtil.today(), totalVenta: totalVentaDelDia, origen: 'Importación TPV', efectivo: 0, tarjeta: 0, apps: 0, notas: "Importado desde TPV", descuadre: 0, unitId: 'REST' },
      ventasMenu: { fecha: DateUtil.today(), platos: desglosePlatos }
    });
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (isScanning || !importMode.startsWith('ia_')) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1 || items[i].type === 'application/pdf') {
          const blob = items[i].getAsFile();
          if (blob) { procesarDocumentoIA(blob, importMode); break; }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [importMode, isScanning]);

  const handleConfirm = async () => {
    if (!processedData) return;
    const newData = { ...data };
    
    if (importMode === 'tpv' && processedData.cierre) {
      if (!newData.cierres) newData.cierres = [];
      newData.cierres.push(processedData.cierre);
      if (!newData.ventas_menu) newData.ventas_menu = [];
      newData.ventas_menu.push(processedData.ventasMenu);
      await onSave(newData);
      onNavigate('dashboard');
    } 
    else if (importMode === 'albaranes_excel' && processedData.albaranesExcel) {
      if (!newData.albaranes) newData.albaranes = [];
      newData.albaranes = [...newData.albaranes, ...processedData.albaranesExcel];
      await onSave(newData);
      onNavigate('albaranes');
    } 
    else if (importMode === 'ia_factura' && processedData.facturaIa) {
      if (!newData.facturas) newData.facturas = [];
      newData.facturas.push(processedData.facturaIa);
      
      // Enviar a la automatización de Arume n8n
      fetch(n8nWebhookURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(processedData.facturaIa) }).catch(e => console.warn("Error n8n", e));
      
      await onSave(newData);
      onNavigate('facturas'); 
    }
    else if (importMode === 'ia_albaran' && processedData.albaranIa) {
      if (!newData.albaranes) newData.albaranes = [];
      newData.albaranes.push(processedData.albaranIa);
      await onSave(newData);
      onNavigate('albaranes');
    }
    alert("¡Datos integrados en el ERP con éxito!");
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in pb-24">
      <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100">
        <header className="text-center mb-8 flex flex-col items-center">
          <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-[2rem] flex items-center justify-center text-3xl mb-4 transform rotate-3">
            <Upload className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tighter">Bandeja de Entrada</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Sube archivos, tickets y facturas (PDF o Imagen)</p>
          
          {/* BOTÓN MÁGICO DE VOZ */}
          {importMode === 'ia_albaran' && (
            <button 
              onClick={startVoiceForAlbaran}
              disabled={isScanning && !recording}
              className={cn(
                "mt-4 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all shadow-md flex items-center justify-center gap-2",
                recording ? "bg-rose-500 text-white animate-pulse" : "bg-slate-900 text-white hover:bg-slate-800"
              )}
            >
              {recording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
              {recording ? 'DETENER Y ANALIZAR...' : '🎙️ AÑADIR POR VOZ'}
            </button>
          )}
        </header>

        {/* SELECTOR MULTI-MODO */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-100 p-1.5 rounded-3xl mb-8">
          <button onClick={() => { setImportMode('ia_factura'); setProcessedData(null); }} className={cn("py-3 px-2 rounded-2xl font-black text-[9px] uppercase transition flex items-center justify-center gap-1.5", importMode === 'ia_factura' ? "bg-indigo-600 shadow-md text-white" : "text-slate-500 hover:bg-slate-200")}>
            <Sparkles className="w-3.5 h-3.5" /> IA Facturas
          </button>
          <button onClick={() => { setImportMode('ia_albaran'); setProcessedData(null); }} className={cn("py-3 px-2 rounded-2xl font-black text-[9px] uppercase transition flex items-center justify-center gap-1.5", importMode === 'ia_albaran' ? "bg-emerald-500 shadow-md text-white" : "text-slate-500 hover:bg-slate-200")}>
            <Camera className="w-3.5 h-3.5" /> IA Albaranes
          </button>
          <button onClick={() => { setImportMode('tpv'); setProcessedData(null); }} className={cn("py-3 px-2 rounded-2xl font-black text-[9px] uppercase transition flex items-center justify-center gap-1.5", importMode === 'tpv' ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:bg-slate-200")}>
            <Database className="w-3.5 h-3.5" /> Excel TPV
          </button>
          <button onClick={() => { setImportMode('albaranes_excel'); setProcessedData(null); }} className={cn("py-3 px-2 rounded-2xl font-black text-[9px] uppercase transition flex items-center justify-center gap-1.5", importMode === 'albaranes_excel' ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:bg-slate-200")}>
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel Alb.
          </button>
        </div>

        {/* DROPZONE */}
        <div 
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e); }}
          className={cn(
            "border-2 border-dashed rounded-[2.5rem] p-12 text-center transition-all cursor-pointer relative group",
            isDragging ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50",
            (isScanning || recording) && "opacity-50 pointer-events-none"
          )}
        >
          <input 
            type="file" disabled={isScanning || recording} onChange={handleFileUpload}
            accept={importMode.startsWith('ia_') ? ".pdf, image/jpeg, image/png, image/webp" : ".xlsx, .xls, .csv"} 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
          />
          <div className="space-y-4">
            <div className="w-16 h-16 bg-white rounded-[2rem] shadow-sm border border-slate-100 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
              {isScanning ? <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /> : 
               importMode.startsWith('ia_') ? <Receipt className="w-8 h-8 text-indigo-500" /> : <FileSpreadsheet className="w-8 h-8 text-slate-400" />}
            </div>
            <div>
              <p className="text-sm font-black text-slate-600">
                {isScanning ? "El Cerebro IA está procesando..." : "Pulsa aquí, arrastra o pega (Ctrl+V)"}
              </p>
              <p className="text-[10px] text-slate-400 mt-1 font-bold uppercase tracking-widest">
                {importMode.startsWith('ia_') ? "Soporta PDFs y Fotografías (JPG, PNG)" : "Formatos: .xlsx, .csv"}
              </p>
            </div>
          </div>
        </div>

        {/* PREVIEW */}
        <AnimatePresence>
          {processedData && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="mt-8 bg-slate-900 p-6 rounded-[2.5rem] space-y-4 shadow-xl">
              <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-white text-sm uppercase tracking-widest">Extracción Completada</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Revisa los datos antes de guardar</p>
                </div>
              </div>

              {/* AVISO DE DESCUADRE (La magia de Copilot) */}
              {importMode === 'ia_albaran' && processedData.albaranIa && processedData.albaranIa.status === 'warning' && (
                <div className="px-4 py-3 rounded-2xl text-[10px] font-black bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  ⚠️ LA IA DETECTÓ UN DESCUADRE ENTRE LAS LÍNEAS Y EL TOTAL. REVISAR.
                </div>
              )}

              <div className="bg-slate-800/50 rounded-2xl p-5 space-y-3">
                {importMode === 'ia_factura' && processedData.facturaIa && (
                  <>
                    <DataRow label="Proveedor" val={processedData.facturaIa.proveedor} />
                    <DataRow label="Nº Factura" val={processedData.facturaIa.num_factura} />
                    <DataRow label="Fecha" val={processedData.facturaIa.fecha} />
                    <div className="border-t border-slate-700/50 my-2 pt-2"></div>
                    <DataRow label="Base" val={Num.fmt(processedData.facturaIa.base)} />
                    <DataRow label="IVA" val={Num.fmt(processedData.facturaIa.iva)} />
                    <DataRow label="TOTAL FACTURA" val={Num.fmt(processedData.facturaIa.total_pdf)} highlight />
                  </>
                )}
                {importMode === 'ia_albaran' && processedData.albaranIa && (
                  <>
                    <DataRow label="Proveedor" val={processedData.albaranIa.prov} />
                    <DataRow label="Fecha" val={processedData.albaranIa.date} />
                    <DataRow label="Productos leídos" val={`${processedData.albaranIa.items.length} líneas`} />
                    <div className="border-t border-slate-700/50 my-2 pt-2"></div>
                    <DataRow label="Base Calculada" val={Num.fmt(processedData.albaranIa.base)} />
                    <DataRow label="TOTAL ALBARÁN" val={Num.fmt(processedData.albaranIa.total)} highlight />
                  </>
                )}
                {importMode === 'tpv' && (
                  <DataRow label="Total Ventas TPV" val={Num.fmt(processedData.cierre?.totalVenta)} highlight />
                )}
                {importMode === 'albaranes_excel' && (
                  <DataRow label="Albaranes Extraídos" val={`${processedData.albaranesExcel?.length} documentos`} highlight />
                )}
              </div>

              <button onClick={handleConfirm} className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-black py-4 rounded-2xl transition shadow-lg flex items-center justify-center gap-2 group mt-2">
                <Database className="w-4 h-4" />
                <span>CONFIRMAR Y GUARDAR</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
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
    <span className={cn("text-[10px] font-black uppercase tracking-widest", highlight ? "text-emerald-400" : "text-slate-400")}>
      {label}
    </span>
    <span className={cn("text-xs", highlight ? "font-black text-emerald-400 text-lg" : "font-bold text-white")}>
      {val}
    </span>
  </div>
);
