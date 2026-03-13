import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileText, CheckCircle2, Database, Building2,
  ArrowRight, Sparkles, Loader2, Camera, Receipt, Mic, Square, AlertTriangle, FileDown, X, Edit3, Grid, ListPlus, Trash2, ClipboardPaste
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { AppData, BankMovement, FacturaExtended } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { useColumnDetector } from '../hooks/useColumnDetector';

const n8nWebhookURL = "https://n8n.permatunnelopen.org/webhook/albaranes-ai";

interface ImportViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  onNavigate: (tab: string) => void;
}

export type ImportMode = 'tpv' | 'albaranes_excel' | 'ia_factura' | 'ia_albaran' | 'banco_excel';

/* =======================================================
 * 🛡️ MOTOR DE RECONCILIACIÓN MATEMÁTICA
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
{ "proveedor": "string", "fecha": "YYYY-MM-DD", "num_factura": "string", "base": 0, "iva": 0, "total": 0, "referencias_albaranes": ["strings"] }
REGLAS: Números como number (decimal con punto). Fecha en YYYY-MM-DD.`;

const PROMPT_ALBARAN = `Analiza este albarán y devuelve SOLO JSON con EXACTAMENTE:
{ "proveedor": "string", "fecha": "YYYY-MM-DD", "num": "string", "unidad": "REST" | "SHOP",
  "lineas": [ {"qty": 1, "name": "string", "unit": "ud|kg|l", "unit_price": 0, "tax_rate": 4|10|21, "total": 0} ], "sum_total": 0 }
REGLAS: "lineas[].total" es el total de la línea CON IVA. tax_rate solo 4, 10 o 21. sum_total = suma de líneas.`;

/* =======================================================
 * COMPONENTE PRINCIPAL
 * ======================================================= */
export const ImportView = ({ data, onSave, onNavigate }: ImportViewProps) => {
  const [importMode, setImportMode] = useState<ImportMode>('ia_factura');
  const [isScanning, setIsScanning] = useState(false);
  
  // 💡 ESTADO DE PROGRESO AVANZADO (Con chivato de errores)
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

  // 💣 PANEL DE RESETEO SEGURO (Protegiendo Cajas)
  const handleNukeData = async (type: 'docs' | 'ops' | 'bank') => {
    let msg = "";
    if (type === 'docs') msg = "Vas a borrar TODAS las facturas y albaranes.";
    if (type === 'ops') msg = "Vas a borrar TODOS los Platos de la carta. 🛡️ TUS CIERRES DE CAJA Y VENTAS DIARIAS ESTÁN A SALVO Y NO SE BORRARÁN.";
    if (type === 'bank') msg = "Vas a borrar TODOS los movimientos bancarios.";
    
    const confirmation = window.prompt(`⚠️ PELIGRO CRÍTICO ⚠️\n\n${msg}\n\nEscribe "BORRAR" en mayúsculas para confirmar:`);
    
    if (confirmation === 'BORRAR') {
      setIsScanning(true);
      const newData = JSON.parse(JSON.stringify(data));
      
      if (type === 'docs') {
        newData.facturas = [];
        newData.albaranes = [];
      } else if (type === 'ops') {
        newData.platos = [];
        // NO TOCAMOS newData.cierres NI newData.ventas_menu
      } else if (type === 'bank') {
        newData.banco = [];
      }

      await onSave(newData);
      setIsScanning(false);
      alert(`✅ Limpieza completada con éxito.`);
    }
  };

  const categorizeItem = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('vino') || n.includes('agua') || n.includes('cerveza') || n.includes('copa') || n.includes('refresco')) return 'Bebidas';
    if (n.includes('postre') || n.includes('tarta') || n.includes('helado') || n.includes('cafe')) return 'Postre';
    if (n.includes('pan') || n.includes('ensalada') || n.includes('croqueta')) return 'Entrantes';
    return 'General';
  };

  // 🚀 LÓGICA ANTI-COLAPSO Y REINTENTOS PARA WHATSAPP
  const procesarLoteIA = async (files: File[], mode: ImportMode) => {
    const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("⚠️ Por favor, configura tu clave de Gemini API en los ajustes primero.");

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

      let attempts = 0;
      let success = false;

      while (attempts < 2 && !success) {
        try {
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

          if (mode === 'ia_factura') {
            const prov = datosIA.proveedor || "Desconocido"; const numF = datosIA.num_factura || `S/N-${Date.now()}`; const fecha = normalizeDate(datosIA.fecha);
            const totalPdf = asNum(datosIA.total) || 0; const baseNum = asNum(datosIA.base) || Number((totalPdf / 1.10).toFixed(2)); const ivaNum = asNum(datosIA.iva) || Number((totalPdf - baseNum).toFixed(2));

            nuevasFacturas.push({
              id: `fac-ia-${Date.now()}-${i}`, 
              tipo: 'compra',
              proveedor: prov, prov: prov, num: numF, num_factura: numF, date: fecha, base: String(baseNum), tax: String(ivaNum), total: String(totalPdf),
              albaranIdsArr: datosIA.referencias_albaranes || [],
              paid: false, reconciled: false, source: 'dropzone', status: 'draft', unidad_negocio: 'REST'
            });
          } else {
            const al: AlbaranIA = {
              proveedor: datosIA.proveedor || "Desconocido", fecha: normalizeDate(datosIA.fecha), num: datosIA.num || "S/N",
              unidad: (datosIA.unidad === 'SHOP' ? 'SHOP' : 'REST'), lineas: Array.isArray(datosIA.lineas) ? datosIA.lineas : [], sum_total: asNum(datosIA.sum_total),
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
          
          success = true;
          successCount++;
          setBatchProgress(p => p ? { ...p, success: successCount } : null);

        } catch (e: any) {
          attempts++;
          console.warn(`Fallo procesando ${fileName} (Intento ${attempts}/2)`, e);
          
          if (attempts < 2) {
            // Si falló (ej. error 429 Too Many Requests), esperamos 15 segundos antes de reintentar la misma foto
            setBatchProgress(p => p ? { ...p, isCoolingDown: true } : null);
            await new Promise(r => setTimeout(r, 15000));
            setBatchProgress(p => p ? { ...p, isCoolingDown: false } : null);
          } else {
            // Si falla 2 veces, lo anotamos en el chivato
            failCount++;
            failedNamesArr.push(fileName);
            setBatchProgress(p => p ? { ...p, fails: failCount, failedNames: failedNamesArr } : null);
          }
        }
      }

      // 🛡️ LÓGICA ANTI-COLAPSO: Descanso cada 8 fotos
      if (i < files.length - 1 && success) {
        if ((i + 1) % 8 === 0) {
          setBatchProgress(p => p ? { ...p, isCoolingDown: true } : null);
          await new Promise(r => setTimeout(r, 10000)); // 10s de respiro para Google
          setBatchProgress(p => p ? { ...p, isCoolingDown: false } : null);
        } else {
          await new Promise(r => setTimeout(r, 1500)); // 1.5s entre fotos normales
        }
      }
      
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    }

    // Guardado Masivo Final
    if (successCount > 0) {
      const newData = JSON.parse(JSON.stringify(data));
      if (mode === 'ia_factura') {
        newData.facturas = [...nuevasFacturas, ...(newData.facturas || [])];
        await onSave(newData);
        if (failCount === 0) onNavigate('facturas');
      } else {
        newData.albaranes = [...nuevosAlbaranes, ...(newData.albaranes || [])];
        await onSave(newData);
        if (failCount === 0) onNavigate('albaranes');
      }
    } 

    if (failCount > 0) {
      alert(`⚠️ Lote terminado.\n\n✅ Éxitos: ${successCount}\n❌ Fallos: ${failCount}\n\nArchivos que NO se han podido procesar:\n- ${failedNamesArr.join('\n- ')}\n\nPor favor, sube estos manualmente más tarde.`);
    } else if (successCount > 0) {
      alert(`✅ Lote importado a la perfección: ${successCount} documentos enviados a la bandeja Borrador.`);
    } else {
      alert("❌ No se pudo procesar ningún documento.");
    }
    
    setIsScanning(false);
    setBatchProgress(null);
  };

  // 📝 PROCESADOR UNIVERSAL DE ARCHIVOS (Botón, Drag o Pegar)
  const processFilesArray = async (files: File[]) => {
    if (files.length === 0) return;

    if (importMode.startsWith('ia_')) { 
       const invalidFiles = files.filter(f => !f.type.includes('pdf') && !f.type.startsWith('image/'));
       if (invalidFiles.length > 0) return alert("⚠️ La IA solo admite PDF o Imágenes (JPG/PNG).");
       
       await procesarLoteIA(files, importMode);
       return; 
    } 

    // MODO EXCEL (Solo coge el primer archivo)
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
            return { id: `alb-xls-${Date.now()}-${Math.random().toString(36).substring(2,5)}`, prov: rec.proveedor, date: rec.fecha, num: rec.num, socio: 'Arume', items: rec.lineas.map(l => ({ q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax, unitPrice: l.unit_price })), total: String(rec.sum_total), base: String(rec.sum_base), taxes: String(rec.sum_tax), invoiced: false, paid: false, status: 'ok', unitId: 'REST' };
          });
          setProcessedData({ albaranesExcel: albsExcel });
        }
      } catch (err) { alert("Error al leer el archivo Excel."); }
    };
    reader.readAsBinaryString(file);
  };

  /* =======================================================
   * 🖱️ GESTIÓN DE EVENTOS (Input, Drop, Paste)
   * ======================================================= */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFilesArray(Array.from(e.target.files));
    e.target.value = ''; // Reset
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDropLocal = (e: React.DragEvent) => { 
    e.preventDefault(); e.stopPropagation(); setIsDragging(false); 
    if (e.dataTransfer.files) processFilesArray(Array.from(e.dataTransfer.files));
  };

  // Escuchar Pegado (Ctrl+V) de WhatsApp
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (isScanning || recording) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      
      const filesToPaste: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) filesToPaste.push(file);
        }
      }
      if (filesToPaste.length > 0 && importMode.startsWith('ia_')) {
        processFilesArray(filesToPaste);
      }
    };

    window.addEventListener('paste', handlePaste as any);
    return () => window.removeEventListener('paste', handlePaste as any);
  }, [importMode, isScanning, recording]);


  const handleConfirm = async () => {
    if (!processedData) return;
    const newData = { ...data };
    
    if (importMode === 'tpv' && processedData.tpvPreview) {
      const { rows, mapping, date } = processedData.tpvPreview;
      const newPlatos = [...(data.platos || [])]; const newVentas = [...(data.ventas_menu || [])];
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
      await onSave({ ...data, platos: newPlatos, ventas_menu: newVentas, cierres: newData.cierres });
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
    <div className="max-w-4xl mx-auto space-y-6 pb-24 animate-fade-in relative">
      
      <div className="flex items-center gap-4 mb-4 px-2">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
          <Database className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Data Hub Universal</h2>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">Arrastra, sube o pulsa Ctrl+V (Pegar imagen)</p>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden p-6 md:p-8">
        
        {/* SELECTOR GRID TIPO DASHBOARD */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <ModuleButton 
            active={importMode === 'ia_factura'} onClick={() => { setImportMode('ia_factura'); setProcessedData(null); }}
            icon={Receipt} title="Facturas IA" subtitle="PDF / Ctrl+V" color="indigo"
          />
          <ModuleButton 
            active={importMode === 'ia_albaran'} onClick={() => { setImportMode('ia_albaran'); setProcessedData(null); }}
            icon={FileText} title="Albaranes IA" subtitle="Foto / Ctrl+V" color="emerald"
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
          {/* DROPZONE */}
          <div 
            className={cn(
              "border-2 border-dashed rounded-[2rem] p-12 flex flex-col items-center justify-center transition-all cursor-pointer relative overflow-hidden",
              isDragging ? "border-indigo-500 bg-indigo-50/50 scale-[1.02]" : "border-slate-200 bg-slate-50 hover:bg-slate-100",
              (isScanning || recording) && "opacity-50 pointer-events-none"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDropLocal}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              multiple={importMode.startsWith('ia_')} 
              ref={fileInputRef} 
              disabled={isScanning || recording} 
              onChange={handleFileUpload} 
              accept={importMode.startsWith('ia_') ? ".pdf, image/jpeg, image/png" : ".xlsx, .csv"} 
              className="hidden" 
            />
            
            {/* PROGRESO DEL LOTE IA CON VISOR */}
            {batchProgress ? (
              <div className="flex flex-col items-center w-full max-w-sm z-10 text-center">
                {batchProgress.currentThumb ? (
                  <div className="w-24 h-24 rounded-xl overflow-hidden shadow-lg border-4 border-white mb-4 relative">
                     <img src={batchProgress.currentThumb} className="w-full h-full object-cover" alt="Procesando" />
                     {batchProgress.isCoolingDown && (
                       <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center backdrop-blur-sm">
                         <span className="text-[8px] font-black text-white uppercase text-center leading-tight">Enfriando<br/>API</span>
                       </div>
                     )}
                  </div>
                ) : (
                  <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                )}
                <h3 className="text-xl font-black text-slate-800">
                  {batchProgress.isCoolingDown ? 'Pausa de Seguridad...' : 'Leyendo con IA'}
                </h3>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1 mb-4">
                  Documento {batchProgress.current} de {batchProgress.total}
                </p>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden mb-2">
                  <div className={cn("h-full transition-all duration-500", batchProgress.isCoolingDown ? "bg-amber-400" : "bg-indigo-500")} style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}></div>
                </div>
                <div className="flex justify-between w-full text-[10px] font-bold px-1">
                   <span className="text-emerald-600">{batchProgress.success} OK</span>
                   {batchProgress.fails > 0 && <span className="text-rose-500">{batchProgress.fails} Error</span>}
                </div>
              </div>
            ) : (
              <>
                <div className={cn("w-20 h-20 rounded-full flex items-center justify-center shadow-sm mb-4 transition-all", isScanning ? "bg-indigo-100 scale-110" : "bg-white")}>
                  {isScanning ? <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /> : 
                   importMode === 'banco_excel' ? <Building2 className="w-8 h-8 text-blue-500" /> :
                   importMode === 'tpv' ? <Grid className="w-8 h-8 text-amber-500" /> :
                   <Upload className="w-8 h-8 text-slate-400" />}
                </div>
                
                <h3 className="text-xl font-black text-slate-700 text-center">
                  {isScanning ? "Procesando..." : importMode.startsWith('ia_') ? "Selecciona fotos o pulsa Ctrl+V para pegar" : "Sube el Excel de Madis o Banco"}
                </h3>
                
                {importMode.startsWith('ia_') && (
                  <div className="flex items-center gap-2 mt-4 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm text-slate-500 text-xs font-bold uppercase tracking-widest">
                    <ClipboardPaste className="w-4 h-4 text-indigo-500" /> Compatible con Ctrl+V (WhatsApp)
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
                        <p className="text-xs text-slate-500 font-bold mt-1">Generará un nuevo cierre de caja automático.</p>
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

      {/* 💣 PANEL DE RESETEO QUIRÚRGICO: ZONA DE PELIGRO */}
      <div className="mt-8 border-2 border-rose-100 bg-rose-50/30 rounded-[2rem] p-6 md:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h3 className="text-lg font-black text-rose-900 tracking-tight">Panel de Limpieza (Danger Zone)</h3>
            <p className="text-[10px] text-rose-600/80 font-bold uppercase tracking-widest mt-0.5">
              Borra secciones de la base de datos sin afectar al resto.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button 
            onClick={() => handleNukeData('docs')}
            className="flex flex-col items-start p-4 bg-white border border-rose-200 hover:border-rose-400 hover:shadow-md transition-all rounded-xl text-left group"
          >
            <div className="flex items-center gap-2 mb-2">
              <Receipt className="w-4 h-4 text-rose-500" />
              <span className="font-black text-sm text-slate-800">1. Purgar Documentos</span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium">Borra TODAS las Facturas y Albaranes. Usa esto para volver a importar tus fotos.</p>
          </button>

          <button 
            onClick={() => handleNukeData('ops')}
            className="flex flex-col items-start p-4 bg-white border border-amber-200 hover:border-amber-400 hover:shadow-md transition-all rounded-xl text-left group"
          >
            <div className="flex items-center gap-2 mb-2">
              <Grid className="w-4 h-4 text-amber-500" />
              <span className="font-black text-sm text-slate-800">2. Purgar Platos/Carta</span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium font-bold text-amber-700">¡Seguro! NO borra tus cierres ni ventas. Solo limpia el diccionario de platos.</p>
          </button>

          <button 
            onClick={() => handleNukeData('bank')}
            className="flex flex-col items-start p-4 bg-white border border-blue-200 hover:border-blue-400 hover:shadow-md transition-all rounded-xl text-left group"
          >
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-4 h-4 text-blue-500" />
              <span className="font-black text-sm text-slate-800">3. Purgar Banco</span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium">Borra todo el extracto bancario si te has equivocado al importar el Excel.</p>
          </button>
        </div>
      </div>

    </div>
  );
};

// Componentes secundarios (sin cambios)
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

const EditableRow = ({ label, val, onChange, highlight = false, type = "text" }: { label: string, val: string|number, onChange: (v:any)=>void, highlight?: boolean, type?: string }) => (
  <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100 hover:border-indigo-200 transition-colors group">
    <span className="text-[11px] font-bold text-slate-500 uppercase">{label}</span>
    <input 
      type={type}
      value={val}
      onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      className={cn(
        "text-right bg-transparent outline-none border-b border-transparent focus:border-indigo-300 transition-colors px-1 w-1/2", 
        highlight ? "font-black text-indigo-600 text-xl" : "font-bold text-slate-800 text-sm"
      )}
    />
  </div>
);
