import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, FileText, CheckCircle2, Database, Building2,
  Sparkles, Loader2, Receipt, AlertTriangle, X, Edit3, Grid, ListPlus, Trash2, ClipboardPaste, CalendarClock,
  ShieldCheck, Zap, Copy, RefreshCw, Play, Pause, SkipForward, AlertCircle, Clock, ChevronDown, ChevronUp,
  KeyRound, Eye, EyeOff, PlusCircle, Check, Plus, Minus, ChevronLeft, ChevronRight, Truck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { AppData, BankMovement, FacturaExtended } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { useColumnDetector } from '../hooks/useColumnDetector';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';
import { scanDocument, getActiveVisionProvider } from '../services/aiProviders';

const MONTHS_FULL = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

interface ImportViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  onNavigate: (tab: string) => void;
}
export type ImportMode = 'tpv' | 'albaranes_excel' | 'ia_auto' | 'banco_excel';

/**
 * Detecta el socio actual a partir de la sesión Google guardada por AuthScreen.
 * Igual que en AlbaranesView — mantiene trazabilidad en el librito familiar.
 */
const getCurrentSocioFromSession = (): string => {
  try {
    const raw = sessionStorage.getItem('arume_google_session');
    if (!raw) return 'Agnès';
    const session = JSON.parse(raw) as { email?: string; name?: string };
    const email = (session.email || '').toLowerCase();
    if (email.includes('agnes') || email.includes('arumesakebar') || email.includes('companyfernandez')) return 'Agnès';
    if (email.includes('pau') || email.includes('onlyone')) return 'Pau';
    if (email.includes('jeroni')) return 'Jerónimo';
    if (email.includes('pedro')) return 'Pedro';
    return session.name || 'Agnès';
  } catch {
    return 'Agnès';
  }
};

// ─── Tipos de la cola ─────────────────────────────────────────────────────────
type FileStatus = 'pending' | 'processing' | 'success' | 'error' | 'skipped' | 'pending_review';

interface QueueItem {
  id: string; file: File; name: string; status: FileStatus;
  thumb: string | null; attempts: number; maxAttempts: number;
  error?: string; result?: any;
}

// ─── Tipo para previsualización de albaranes Excel ────────────────────────────
interface AlbaranPreviewRow {
  _rowIdx:   number;
  fecha:     string;
  proveedor: string;
  num:       string;
  total:     number;
  base?:     number;
  iva?:      number;
  unitId:    'REST' | 'SHOP' | 'DLV' | 'CORP';
  selected:  boolean;
}

/* =======================================================
 * MOTOR DE RECONCILIACIÓN MATEMÁTICA
 * ======================================================= */
type LineaIA = { qty: any; name: string; unit: string; unit_price: any; tax_rate: any; total: any; };
type DocumentoIA = {
  tipo_documento: 'factura' | 'albaran' | 'ticket_simplificado';
  proveedor: string; nif?: string; fecha: string; num: string;
  total: any; base: any; iva: any;
  metodo_pago: 'efectivo' | 'tarjeta' | 'pendiente' | 'banco';
  referencias_albaranes?: string[]; lineas?: LineaIA[];
};

const TOL = 0.05;
const round2 = (n: number) => Num.round2(n);

const MONTHS_ES: Record<string, string> = {
  enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06',
  julio:'07', agosto:'08', septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12',
  january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
  july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
};

const normalizeDate = (s?: string): string => {
  const today = new Date().toLocaleDateString('sv-SE');
  const v = String(s ?? '').trim().toLowerCase();
  if (!v || v === 'null' || v === 'undefined') return today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const dmy = v.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})$/);
  if (dmy) { const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]; return `${y}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`; }
  const ymd = v.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`;
  const textDate = v.match(/(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\s+(?:de\s+)?(\d{4})/);
  if (textDate) { const month = MONTHS_ES[textDate[2]]; if (month) return `${textDate[3]}-${month}-${textDate[1].padStart(2,'0')}`; }
  const monthYear = v.match(/^([a-záéíóú]+)\s+(\d{4})$/);
  if (monthYear) { const month = MONTHS_ES[monthYear[1]]; if (month) return `${monthYear[2]}-${month}-01`; }
  const parsed = Date.parse(v);
  if (!isNaN(parsed)) return new Date(parsed).toLocaleDateString('sv-SE');
  return today;
};

const normalizeDateExcel = (raw: any): string => {
  if (typeof raw === 'number') {
    return new Date(new Date(1899, 11, 30).getTime() + raw * 86400000).toLocaleDateString('sv-SE');
  }
  return normalizeDate(String(raw ?? ''));
};

function reconcileAlbaran(ai: DocumentoIA) {
  let declared_total = Num.parse(ai.total);
  const rawLines = Array.isArray(ai.lineas) ? ai.lineas : [];
  const buildLines = (isIvaIncluded: boolean) => {
    const out: any[] = [];
    let b4=0,i4=0,b10=0,i10=0,b21=0,i21=0,grandTotal=0;
    for (const l of rawLines) {
      const parsedRate = Num.parse(l.tax_rate);
      const rate = [4,10,21].includes(parsedRate) ? parsedRate : 10;
      const qty = Num.parse(l.qty)||1; const unitPrice = Num.parse(l.unit_price);
      let lineTotalField = Num.parse(l.total);
      const netFromUnit = (isFinite(unitPrice)&&unitPrice>0) ? round2(qty*unitPrice) : 0;
      if (lineTotalField<=0&&netFromUnit>0) { lineTotalField = isIvaIncluded ? round2(netFromUnit*(1+rate/100)) : netFromUnit; }
      let base=0,tax=0,total=0,unitPriceBruto=0;
      if (isIvaIncluded) { total=lineTotalField; base=total>0?round2(total/(1+rate/100)):0; tax=round2(total-base); unitPriceBruto=qty>0?round2(total/qty):total; }
      else { base=lineTotalField; tax=round2(base*(rate/100)); total=round2(base+tax); unitPriceBruto=qty>0?round2(base/qty):base; }
      grandTotal=round2(grandTotal+total);
      if(rate===4){b4=round2(b4+base);i4=round2(i4+tax);}
      else if(rate===21){b21=round2(b21+base);i21=round2(i21+tax);}
      else{b10=round2(b10+base);i10=round2(i10+tax);}
      out.push({q:qty,n:String(l.name||'Articulo'),u:String(l.unit||'uds'),rate,total:round2(total),base:round2(base),tax:round2(tax),unitPrice:round2(unitPriceBruto)});
    }
    return {lines:out,sumTotal:round2(grandTotal),base4:b4,base10:b10,base21:b21,tax4:i4,tax10:i10,tax21:i21};
  };
  const calcInc=buildLines(true); const calcExc=buildLines(false);
  let chosenCalc=calcInc;
  if(declared_total<=0&&rawLines.length>0) declared_total=calcInc.sumTotal;
  if(declared_total>0){const diffInc=Math.abs(calcInc.sumTotal-declared_total);const diffExc=Math.abs(calcExc.sumTotal-declared_total);if(diffExc<diffInc&&diffExc<=5)chosenCalc=calcExc;}
  let rounding=0;
  if(declared_total>0){const diff=round2(declared_total-chosenCalc.sumTotal);if(diff!==0&&Math.abs(diff)<=TOL){rounding=diff;chosenCalc.sumTotal=round2(chosenCalc.sumTotal+rounding);}}
  const finalDiff=declared_total>0?round2(chosenCalc.sumTotal-declared_total):0;
  const cuadra=declared_total>0?Math.abs(finalDiff)===0:true;
  const sum_base=round2(chosenCalc.base4+chosenCalc.base10+chosenCalc.base21);
  const sum_tax=round2(chosenCalc.tax4+chosenCalc.tax10+chosenCalc.tax21);
  return {...ai,lineasProcesadas:chosenCalc.lines,sum_base,sum_tax,sum_total:chosenCalc.sumTotal,
    by_rate:{4:{base:round2(chosenCalc.base4),tax:round2(chosenCalc.tax4)},10:{base:round2(chosenCalc.base10),tax:round2(chosenCalc.tax10)},21:{base:round2(chosenCalc.base21),tax:round2(chosenCalc.tax21)}},
    diff:finalDiff,cuadra,roundingAdjustment:rounding};
}

const extractJSON = (rawText: string) => {
  try {
    if (!rawText) return {};
    let clean = rawText.replace(/```json/gi,'').replace(/```/g,'').trim();
    const start=clean.indexOf('{'); const end=clean.lastIndexOf('}');
    if(start===-1||end===-1) return {};
    return JSON.parse(clean.substring(start,end+1));
  } catch { return {}; }
};

const compressImage = async (file: File | Blob): Promise<string> => {
  const QUALITY_LEVELS=[0.85,0.65,0.45]; const MAX_BYTES=3*1024*1024; const MAX_W=1600,MAX_H=1600;
  const bitmap=await createImageBitmap(file); const ratio=Math.min(MAX_W/bitmap.width,MAX_H/bitmap.height,1);
  const w=Math.max(1,Math.round(bitmap.width*ratio)); const h=Math.max(1,Math.round(bitmap.height*ratio));
  const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
  canvas.getContext('2d',{alpha:false})?.drawImage(bitmap,0,0,w,h);
  let finalBlob:Blob|null=null;
  for(const quality of QUALITY_LEVELS){const qBlob:Blob=await new Promise((res)=>canvas.toBlob((b)=>res(b as Blob),'image/jpeg',quality));finalBlob=qBlob;if(qBlob.size<=MAX_BYTES)break;}
  if(!finalBlob) throw new Error('No se pudo comprimir la imagen.');
  const b64=await new Promise<string>((res)=>{const fr=new FileReader();fr.onload=()=>res((fr.result as string).split(',')[1]);fr.readAsDataURL(finalBlob!);});
  return `data:image/jpeg;base64,${b64}`;
};

const readFileAsBase64=(file:File):Promise<string>=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve((r.result as string).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

const classifyError=(msg:string):{retryable:boolean;friendly:string;waitMs?:number}=>{
  if(msg.includes('429')||msg.includes('quota')||msg.includes('RESOURCE_EXHAUSTED'))
    return{retryable:true,friendly:'Límite alcanzado → probando proveedor alternativo…'};
  if(msg.includes('500')||msg.includes('503')||msg.includes('UNAVAILABLE'))
    return{retryable:true,friendly:'Servidor saturado → reintentando…'};
  if(msg.includes('DEADLINE_EXCEEDED')||msg.includes('timeout'))
    return{retryable:true,friendly:'Tiempo agotado → reintentando…'};
  if(msg.includes('Failed to fetch')||msg.includes('NetworkError'))
    return{retryable:true,friendly:'Sin conexión → reintentando cuando se recupere la red…'};
  if(msg.includes('No hay ningún proveedor'))
    return{retryable:false,friendly:'GEMINI_KEY_MISSING'};
  if(msg.includes('Formato de archivo'))
    return{retryable:false,friendly:'Formato no soportado (solo PDF/JPG/PNG).'};
  return{retryable:false,friendly:msg||'Error desconocido de procesado.'};
};

const PROMPT_OMNI_IA = `Eres un Auditor Contable Experto español. Analiza el documento y extrae los datos con precisión milimétrica.

REGLA FECHAS: Devuelve siempre en formato YYYY-MM-DD. Si no hay fecha visible, usa la fecha de hoy.
REGLA TIPO:
  - "factura" si tiene número de factura oficial (F-XXX, FAC-XXX, etc.)
  - "ticket_simplificado" si es un ticket de caja o recibo sin NIF del receptor
  - "albaran" si es un albarán o nota de entrega sin IVA separado o con IVA incluido en precio
REGLA PAGO: Busca "Pagado", "Efectivo", "Tarjeta", "Visa", "Mastercard", "Transferencia", "Recibí", "Cobrado".
REGLA IMPORTES: Sin símbolo €. Usa punto decimal. (Ej: 1500.50)

Devuelve SOLO un JSON estricto sin comentarios ni markdown:
{
  "tipo_documento": "factura|albaran|ticket_simplificado",
  "proveedor": "Nombre empresa emisora",
  "nif": "NIF o CIF del emisor o null",
  "num": "Número de factura/albarán o S/N",
  "fecha": "YYYY-MM-DD",
  "total": 0.00,
  "base": 0.00,
  "iva": 0.00,
  "metodo_pago": "efectivo|tarjeta|banco|pendiente",
  "referencias_albaranes": [],
  "lineas": [
    {"qty": 1, "name": "Descripción producto", "unit": "ud", "unit_price": 0.00, "tax_rate": 10, "total": 0.00}
  ]
}`;

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
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showErrorLog, setShowErrorLog] = useState(false);
  const pauseRef = useRef(false);
  const abortRef = useRef(false);

  const reviewResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const [processedData, setProcessedData] = useState<{
    tpvPreview?:     any;
    bancoExcel?:     BankMovement[];
    albaranesExcel?: AlbaranPreviewRow[];
  } | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { analyzeColumns, saveProfile } = useColumnDetector();
  const [deleteMonth, setDeleteMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [deleteYear, setDeleteYear] = useState(String(new Date().getFullYear()));
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyModalReason, setKeyModalReason] = useState<'missing' | 'exhausted'>('missing');
  const [nukeConfirm, setNukeConfirm] = useState<{
    type: 'docs' | 'bank' | 'platos';
    mesNombre: string;
    onConfirm: () => void;
  } | null>(null);
  const [selectedUnit, setSelectedUnit] = React.useState<'REST' | 'SHOP' | 'B2B'>('REST');

  const [reviewItem, setReviewItem] = useState<QueueItem | null>(null);
  const [processStartTime, setProcessStartTime] = React.useState<number | null>(null);
  const [avgTimePerDoc, setAvgTimePerDoc] = React.useState<number>(15000);

  const total = queue.length;
  const done = queue.filter(q => q.status === 'success').length;
  const errors = queue.filter(q => q.status === 'error');
  const pending = queue.filter(q => q.status === 'pending').length;
  const pendingReview = queue.filter(q => q.status === 'pending_review');
  const allFinished = total > 0 && queue.every(q => ['success', 'error', 'skipped'].includes(q.status));

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  }, []);

  // ─── Procesar UN archivo ──────────────────────────────────────────────────
  const processOne = async (item: QueueItem): Promise<{ result: any; tipo: string } | null> => {
    const file = item.file;
    if (!file.type.includes('pdf') && !file.type.startsWith('image/')) throw new Error('Formato no soportado (solo PDF/JPG/PNG).');

    const scanResult = await scanDocument(file, PROMPT_OMNI_IA);
    const datosIA = scanResult.raw as DocumentoIA & { _usedModel?: string };
    datosIA._usedModel = scanResult.provider;

    const metodoPago = String(datosIA.metodo_pago ?? 'pendiente').toLowerCase().trim();
    const estaPagado = ['efectivo', 'tarjeta', 'banco'].includes(metodoPago);
    const tipoRaw = String(datosIA.tipo_documento ?? '').toLowerCase();
    datosIA.tipo_documento =
      tipoRaw.includes('albaran') ? 'albaran' :
      tipoRaw.includes('ticket') || tipoRaw.includes('recibo') || tipoRaw.includes('simplif') || tipoRaw.includes('caja') ? 'ticket_simplificado' :
      'factura';

    if (datosIA.tipo_documento === 'factura' || datosIA.tipo_documento === 'ticket_simplificado') {
      let totalPdf = Num.parse(datosIA.total);
      if (totalPdf <= 0 && Array.isArray(datosIA.lineas)) {
        totalPdf = datosIA.lineas.reduce((acc, l) => {
          const lTotal = Num.parse(l.total); const lBase = Num.parse(l.qty) * Num.parse(l.unit_price);
          return acc + (lTotal > 0 ? lTotal : (lBase > 0 ? lBase * 1.10 : 0));
        }, 0);
      }
      const baseNum = Num.parse(datosIA.base) || Num.round2(totalPdf / 1.10);
      const ivaNum = Num.parse(datosIA.iva) || Num.round2(totalPdf - baseNum);
      return { tipo: 'factura', result: {
        id: `fac-ia-${crypto.randomUUID()}`, tipo: 'compra',
        proveedor: datosIA.proveedor || 'Desconocido', prov: datosIA.proveedor || 'Desconocido',
        nif: datosIA.nif || null,
        num: datosIA.num || `S/N-${Date.now()}`, date: normalizeDate(String(datosIA.fecha ?? '')),
        base: String(baseNum), tax: String(ivaNum), total: String(totalPdf),
        albaranIdsArr: datosIA.referencias_albaranes || [], paid: estaPagado,
        reconciled: false, source: 'ia-auto', status: 'approved', unidad_negocio: selectedUnit,
        lineas: datosIA.lineas || [],
        tipo_documento: datosIA.tipo_documento,
        metodo_pago: datosIA.metodo_pago,
      }};
    } else {
      const rec = reconcileAlbaran(datosIA);
      const finalItems = [...rec.lineasProcesadas];
      if (rec.roundingAdjustment !== 0) {
        finalItems.push({ q: 1, n: 'AJUSTE REDONDEO IA', u: 'uds', rate: 0, base: round2(rec.roundingAdjustment), tax: 0, total: round2(rec.roundingAdjustment), unitPrice: round2(rec.roundingAdjustment) });
      }
      return { tipo: 'albaran', result: {
        id: `alb-ia-${crypto.randomUUID()}`, prov: rec.proveedor || 'Desconocido',
        nif: datosIA.nif || null,
        date: rec.fecha ? normalizeDate(String(rec.fecha)) : normalizeDate(String(datosIA.fecha ?? '')),
        num: rec.num || 'S/N', socio: getCurrentSocioFromSession(),
        notes: rec.cuadra ? 'IA OK' : `IA WARNING (Dif: ${Num.fmt(rec.diff)})`,
        items: finalItems, total: String(rec.sum_total), base: String(rec.sum_base), taxes: String(rec.sum_tax),
        invoiced: false, paid: estaPagado, reconciled: false,
        status: rec.cuadra ? 'ok' : 'warning', unitId: selectedUnit, by_rate: rec.by_rate,
        tipo_documento: 'albaran',
        metodo_pago: datosIA.metodo_pago,
      }};
    }
  };

  // ─── Guardar resultados ───────────────────────────────────────────────────
  const saveResults = useCallback(async (completedQueue: QueueItem[]) => {
    const nuevasFacturas = completedQueue
      .filter(q => q.status === 'success' && q.result?.tipo === 'factura')
      .map(q => q.result.result);
    const nuevosAlbaranes = completedQueue
      .filter(q => q.status === 'success' && q.result?.tipo === 'albaran')
      .map(q => q.result.result);
    if (nuevasFacturas.length === 0 && nuevosAlbaranes.length === 0) return;
    const newData = JSON.parse(JSON.stringify(safeData));
    const existingFactIds = new Set((safeFacturas as any[]).map((f: any) => f.id));
    const existingAlbIds = new Set((safeAlbaranes as any[]).map((a: any) => a.id));
    const facturasUnicas = nuevasFacturas.filter((f: any) => !existingFactIds.has(f.id));
    const albaranesUnicos = nuevosAlbaranes.filter((a: any) => !existingAlbIds.has(a.id));
    newData.facturas = [...facturasUnicas, ...safeFacturas];
    newData.albaranes = [...albaranesUnicos, ...safeAlbaranes];
    await onSave(newData);
  }, [safeData, safeFacturas, safeAlbaranes, onSave]);

  // ─── Ejecutar cola ────────────────────────────────────────────────────────
  const runQueue = useCallback(async (currentQueue: QueueItem[]) => {
    if (isRunning) return;
    setIsRunning(true); pauseRef.current = false; abortRef.current = false;
    setProcessStartTime(Date.now());
    let updatedQueue = [...currentQueue];

    for (let i = 0; i < updatedQueue.length; i++) {
      const item = updatedQueue[i];
      if (item.status === 'success' || item.status === 'skipped') continue;
      if (abortRef.current) break;
      while (pauseRef.current && !abortRef.current) { await delay(300); }
      if (abortRef.current) break;

      updatedQueue[i] = { ...item, status: 'processing' };
      setQueue([...updatedQueue]);

      let lastError = ''; let succeeded = false;
      for (let attempt = 1; attempt <= item.maxAttempts; attempt++) {
        if (abortRef.current) break;
        try {
          const result = await processOne(updatedQueue[i]);

          updatedQueue[i] = { ...updatedQueue[i], status: 'pending_review', result, error: undefined, attempts: attempt };
          setQueue([...updatedQueue]);

          const confirmed = await new Promise<boolean>((resolve) => {
            reviewResolveRef.current = resolve;
            setReviewItem({ ...updatedQueue[i] });
          });

          if (confirmed) {
            updatedQueue[i] = { ...updatedQueue[i], status: 'success' };
            setQueue([...updatedQueue]);
            const successCount = updatedQueue.filter(q => q.status === 'success').length;
            if (processStartTime) { const elapsed = Date.now() - processStartTime; setAvgTimePerDoc(elapsed / Math.max(successCount, 1)); }
            if (successCount % 5 === 0) { await saveResults(updatedQueue); }
          } else {
            updatedQueue[i] = { ...updatedQueue[i], status: 'skipped' };
            setQueue([...updatedQueue]);
          }

          succeeded = true;
          break;
        } catch (e: any) {
          const errMsg = e.message || '';
          if (errMsg === 'GEMINI_KEY_MISSING') { setKeyModalReason('missing'); setShowKeyModal(true); abortRef.current = true; break; }
          const { retryable, friendly, waitMs: cooldownWait } = classifyError(errMsg);
          lastError = friendly;
          updatedQueue[i] = { ...updatedQueue[i], error: `Intento ${attempt}/${item.maxAttempts}: ${friendly}`, attempts: attempt };
          setQueue([...updatedQueue]);
          if (!retryable || attempt === item.maxAttempts) break;
          const waitTime = cooldownWait ?? (attempt === 1 ? 2000 : Math.pow(2, attempt) * 1500 + Math.random() * 1000);
          for (let t = 0; t < waitTime; t += 300) { if (abortRef.current) break; await delay(300); }
        }
      }
      if (!succeeded) {
        updatedQueue[i] = { ...updatedQueue[i], status: 'error', error: lastError || 'Fallo tras todos los intentos.' };
        setQueue([...updatedQueue]);
      }
      if ((i + 1) % 15 === 0 && i < updatedQueue.length - 1) { for (let t = 0; t < 12000; t += 300) { if (abortRef.current) break; await delay(300); } }
      else if (i < updatedQueue.length - 1) { await delay(300); }
    }

    await saveResults(updatedQueue);
    setIsRunning(false); setIsPaused(false);
    toast.success(`✅ Cola finalizada. ${updatedQueue.filter(q=>q.status==='success').length} documentos guardados.`);
  }, [isRunning, saveResults, processStartTime]);

  const handleReviewConfirm = useCallback((editedResult: any) => {
    if (!reviewItem) return;
    setQueue(prev => prev.map(item =>
      item.id === reviewItem.id ? { ...item, result: { ...item.result, result: editedResult } } : item
    ));
    setReviewItem(null);
    if (reviewResolveRef.current) { reviewResolveRef.current(true); reviewResolveRef.current = null; }
  }, [reviewItem]);

  const handleReviewSkip = useCallback(() => {
    setReviewItem(null);
    if (reviewResolveRef.current) { reviewResolveRef.current(false); reviewResolveRef.current = null; }
  }, []);

  const addFilesToQueue = useCallback((files: File[]) => {
    const newItems: QueueItem[] = files.map((file, i) => ({
      id: `q-${crypto.randomUUID()}`, file, name: file.name || `Doc_${i + 1}`,
      status: 'pending', thumb: file.type.startsWith('image/') ? URL.createObjectURL(file) : 'pdf',
      attempts: 0, maxAttempts: 4,
    }));
    setQueue(prev => [...prev, ...newItems]);
    return newItems;
  }, []);

  const retryFailed = useCallback(() => {
    setQueue(prev => prev.map(item => item.status === 'error' ? { ...item, status: 'pending', error: undefined, attempts: 0 } : item));
  }, []);

  const skipItem = useCallback((id: string) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'skipped' } : item));
  }, []);

  const togglePause = () => {
    if (isPaused) { pauseRef.current = false; setIsPaused(false); }
    else { pauseRef.current = true; setIsPaused(true); }
  };

  const clearQueue = () => {
    abortRef.current = true;
    queue.forEach(q => { if (q.thumb && q.thumb !== 'pdf') URL.revokeObjectURL(q.thumb); });
    setQueue([]); setIsRunning(false); setIsPaused(false); setReviewItem(null);
    if (reviewResolveRef.current) { reviewResolveRef.current(false); reviewResolveRef.current = null; }
  };

  const startProcessing = useCallback((items?: QueueItem[]) => {
    const toProcess = items ?? queue;
    if (!isRunning) runQueue(toProcess);
  }, [queue, runQueue, isRunning]);

  const processFilesArray = async (files: File[]) => {
    if (files.length === 0) return;
    if (importMode === 'ia_auto') {
      const invalid = files.filter(f => !f.type.includes('pdf') && !f.type.startsWith('image/'));
      if (invalid.length > 0) return void toast.warning(`⚠️ ${invalid.length} archivo(s) ignorados — solo PDF o Imágenes (JPG/PNG).`);
      const newItems = addFilesToQueue(files);
      if (!isRunning) { const allItems = [...queue, ...newItems]; setTimeout(() => runQueue(allItems), 50); }
      return;
    }
    const file = files[0];
    if (!['.xls', '.xlsx', '.csv'].some(ext => file.name.toLowerCase().endsWith(ext))) { return void toast.warning('⚠️ Este modo es para archivos Excel (.xlsx) o CSV.'); }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];

        if (importMode === 'tpv') {
          const dateInput = prompt('📅 ¿Fecha de ventas TPV Madis? (YYYY-MM-DD):', DateUtil.today());
          if (!dateInput) return;
          const analysis = analyzeColumns(rows);
          setProcessedData({ tpvPreview: { rows, mapping: analysis.mapping, confidence: analysis.confidence, isKnown: analysis.isKnown, date: dateInput } });

        } else if (importMode === 'banco_excel') {
          const movs: BankMovement[] = [];
          let dateCol=-1,descCol=-1,amountCol=-1;
          const headers = rows[0].map(h => String(h).toLowerCase());
          headers.forEach((h,i) => {
            if(h.includes('fecha')||h.includes('date'))dateCol=i;
            if(h.includes('concepto')||h.includes('desc')||h.includes('detalle'))descCol=i;
            if(h.includes('importe')||h.includes('cantidad')||h.includes('amount')||h.includes('valor'))amountCol=i;
          });
          if(dateCol===-1)dateCol=0;if(descCol===-1)descCol=1;if(amountCol===-1)amountCol=2;
          rows.slice(1).forEach((row) => {
            const rawAmount=row[amountCol];
            const parsedAmount=typeof rawAmount==='number'?rawAmount:Num.parse(String(rawAmount||0));
            if(row[dateCol]&&row[descCol]&&parsedAmount!==0){movs.push({id:`bnk-${crypto.randomUUID()}`,date:normalizeDate(row[dateCol]),desc:String(row[descCol]).trim(),amount:parsedAmount,status:'pending'});}
          });
          if(movs.length===0)return void toast.warning('⚠️ No se pudieron extraer movimientos.');
          setProcessedData({bancoExcel:movs});

        } else if (importMode === 'albaranes_excel') {
          const headers = (rows[0] || []).map((h: any) => String(h ?? '').trim().toLowerCase());
          const findCol = (keywords: string[]) =>
            headers.findIndex((h: string) => keywords.some(k => h.includes(k)));

          let fechaCol  = findCol(['fecha', 'date', 'día', 'dia', 'f.op', 'f. op']);
          let provCol   = findCol(['proveedor', 'prov', 'empresa', 'emisor', 'nombre', 'razón', 'razon']);
          let numCol    = findCol(['albaran', 'albarán', 'número', 'numero', 'num', 'ref', 'referencia', 'doc', 'nº']);
          let totalCol  = findCol(['total', 'importe', 'amount', 'precio', 'bruto']);
          let baseCol   = findCol(['base', 'base imp', 'base imponible']);
          let ivaCol    = findCol(['iva', 'cuota iva', 'impuesto', 'tax']);

          if (fechaCol  === -1) fechaCol  = 0;
          if (provCol   === -1) provCol   = 1;
          if (numCol    === -1) numCol    = 2;
          if (totalCol  === -1) totalCol  = 3;

          const preview: AlbaranPreviewRow[] = [];
          rows.slice(1).forEach((row: any[], idx: number) => {
            const fechaISO = normalizeDateExcel(row[fechaCol]);
            const total    = Num.parse(row[totalCol]);
            const prov     = String(row[provCol] ?? '').trim();
            if (!prov || total === 0) return;
            preview.push({
              _rowIdx:   idx + 1,
              fecha:     fechaISO,
              proveedor: prov,
              num:       String(row[numCol] ?? 'S/N').trim() || 'S/N',
              total,
              base:      baseCol >= 0 ? Num.parse(row[baseCol]) || undefined : undefined,
              iva:       ivaCol  >= 0 ? Num.parse(row[ivaCol])  || undefined : undefined,
              unitId:    selectedUnit === 'B2B' ? 'DLV' : selectedUnit as any,
              selected:  true,
            });
          });

          if (preview.length === 0)
            return void toast.warning('⚠️ No se encontraron filas válidas. Comprueba que el Excel tiene fecha, proveedor y total.');

          toast.success(`${preview.length} albaranes detectados — revísalos antes de guardar.`);
          setProcessedData({ albaranesExcel: preview });
        }
      } catch { toast.error('Error al leer el Excel.'); }
    };
    reader.readAsBinaryString(file);
  };

  const handleFileUpload=(e:React.ChangeEvent<HTMLInputElement>)=>{if(e.target.files)processFilesArray(Array.from(e.target.files));e.target.value='';};
  const handleDragOver=(e:React.DragEvent)=>{e.preventDefault();e.stopPropagation();setIsDragging(true);};
  const handleDragLeave=(e:React.DragEvent)=>{e.preventDefault();e.stopPropagation();setIsDragging(false);};
  const handleDrop=(e:React.DragEvent)=>{e.preventDefault();e.stopPropagation();setIsDragging(false);if(e.dataTransfer.files)processFilesArray(Array.from(e.dataTransfer.files));};

  useEffect(() => {
    const handlePaste=(e:ClipboardEvent)=>{
      if(isRunning&&!isPaused)return;
      const items=e.clipboardData?.items;if(!items)return;
      const filesToPaste:File[]=[];
      for(let i=0;i<items.length;i++){if(items[i].type.indexOf('image')!==-1||items[i].type==='application/pdf'){const f=items[i].getAsFile();if(f)filesToPaste.push(f);}}
      if(filesToPaste.length>0&&importMode==='ia_auto')processFilesArray(filesToPaste);
    };
    window.addEventListener('paste',handlePaste as any);
    return()=>window.removeEventListener('paste',handlePaste as any);
  },[importMode,isRunning,isPaused]);

  const handleConfirm = async () => {
    if (!processedData) return;
    const newData = JSON.parse(JSON.stringify(safeData));

    if (importMode === 'tpv' && processedData.tpvPreview) {
      const { rows, mapping, date } = processedData.tpvPreview;
      const newPlatos=[...safePlatos];const newVentas=[...safeVentas];let totalVentaDelDia=0;
      rows.slice(1).forEach((row:any[])=>{
        const name=String(row[mapping.name]||'').trim();const sold=Num.parse(row[mapping.qty]);
        const price=mapping.price>-1?Num.parse(row[mapping.price]):0;
        if(name.length>1&&sold>0&&sold<5000){
          totalVentaDelDia+=(price*sold);
          let plato=newPlatos.find(p=>p.name.toLowerCase().trim()===name.toLowerCase().trim());
          if(!plato){plato={id:'p-'+crypto.randomUUID(),name,category:'varios',price,cost:0};newPlatos.push(plato);}
          else if(price>0&&plato.price!==price)plato.price=price;
          const existing=newVentas.find(v=>v.date===date&&v.id===plato!.id);
          if(existing)existing.qty+=sold;else newVentas.push({date,id:plato!.id,qty:sold});
        }
      });
      if(!newData.cierres)newData.cierres=[];
      newData.cierres.push({id:`cierre-imp-${crypto.randomUUID()}`,date,totalVenta:totalVentaDelDia,origen:'Importación TPV Madis',efectivo:0,tarjeta:totalVentaDelDia,apps:0,notas:'Importado desde Excel',descuadre:0,unitId:'REST'});
      saveProfile(rows,mapping);
      await onSave({...newData,platos:newPlatos,ventas_menu:newVentas});
      onNavigate('menus');

    } else if (importMode === 'banco_excel' && processedData.bancoExcel) {
      if(!newData.banco)newData.banco=[];
      newData.banco=[...processedData.bancoExcel,...newData.banco];
      await onSave(newData);
      onNavigate('banco');

    } else if (importMode === 'albaranes_excel' && processedData.albaranesExcel) {
      const seleccionados = processedData.albaranesExcel.filter(r => r.selected);
      if (seleccionados.length === 0) return void toast.warning('Selecciona al menos un albarán.');

      const existing = new Set((safeAlbaranes as any[]).map((a: any) => String(a.num ?? '').trim()));
      let duplicados = 0;

      const nuevosAlbaranes = seleccionados
        .filter(r => {
          if (existing.has(r.num)) { duplicados++; return false; }
          return true;
        })
        .map(r => ({
          id:       `alb-${crypto.randomUUID()}`,
          date:     r.fecha,
          prov:     r.proveedor,
          num:      r.num,
          total:    r.total,
          base:     r.base,
          taxes:    r.iva,
          invoiced: false,
          unitId:   r.unitId,
          source:   'excel-import',
        }));

      if (nuevosAlbaranes.length === 0)
        return void toast.warning(`Todos los albaranes seleccionados ya existen (${duplicados} duplicados).`);

      newData.albaranes = [...nuevosAlbaranes, ...(newData.albaranes || [])];
      await onSave(newData);

      if (duplicados > 0)
        toast.success(`${nuevosAlbaranes.length} albaranes importados (${duplicados} duplicados ignorados).`);
      else
        toast.success(`${nuevosAlbaranes.length} albaranes importados correctamente ✅`);

      onNavigate('albaranes');
    }

    setProcessedData(null);
  };

  const isTargetMonth = useCallback((dateStr: string) => {
    if (!dateStr) return false;
    try {
      const match = dateStr.match(/^(\d{4})-(\d{2})/);
      if (match) return Number(match[1]) === Number(deleteYear) && Number(match[2]) === Number(deleteMonth);
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return false;
      return d.getFullYear() === Number(deleteYear) && (d.getMonth() + 1) === Number(deleteMonth);
    } catch { return false; }
  }, [deleteYear, deleteMonth]);

  const handleNukeQuirurgico = useCallback((type: 'docs' | 'bank') => {
    const mesNombre = new Date(Number(deleteYear), Number(deleteMonth) - 1)
      .toLocaleString('es', { month: 'long', year: 'numeric' });
    setNukeConfirm({
      type,
      mesNombre,
      onConfirm: async () => {
        const newData = JSON.parse(JSON.stringify(safeData));
        if (type === 'docs') {
          newData.facturas  = safeFacturas.filter(f => !isTargetMonth(f.date));
          newData.albaranes = safeAlbaranes.filter(a => !isTargetMonth(a.date));
        } else {
          const safeBanco = Array.isArray(newData.banco) ? newData.banco : [];
          newData.banco = safeBanco.filter((b: any) => !isTargetMonth(b.date));
        }
        await onSave(newData);
        toast.success(`✅ Limpieza de ${mesNombre.toUpperCase()} completada.`);
        setNukeConfirm(null);
      },
    });
  }, [deleteYear, deleteMonth, safeData, safeFacturas, safeAlbaranes, onSave, isTargetMonth]);

  const handleNukeDataOps = useCallback(() => {
    setNukeConfirm({
      type: 'platos',
      mesNombre: 'la carta completa',
      onConfirm: async () => {
        const newData = JSON.parse(JSON.stringify(safeData));
        newData.platos = [];
        await onSave(newData);
        toast.success('✅ Diccionario de platos purgado.');
        setNukeConfirm(null);
      },
    });
  }, [safeData, onSave]);

  const hasQueue = queue.length > 0;
  const activeVisionProvider = getActiveVisionProvider();

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-24 animate-fade-in relative px-2 sm:px-0">

      {/* Modal confirmación borrado */}
      <AnimatePresence>
        {nukeConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
            onClick={() => setNukeConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="bg-rose-50 border-b border-rose-100 px-6 py-5 flex items-center gap-3">
                <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <h3 className="font-black text-slate-800">⚠️ Borrado irreversible</h3>
                  <p className="text-xs font-bold text-slate-500 mt-0.5">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm font-bold text-slate-700 leading-relaxed">
                  {nukeConfirm.type === 'docs' && <>Vas a borrar todas las <strong>facturas y albaranes</strong> de <strong>{nukeConfirm.mesNombre}</strong>.</>}
                  {nukeConfirm.type === 'bank' && <>Vas a borrar todos los <strong>movimientos bancarios</strong> de <strong>{nukeConfirm.mesNombre}</strong>.</>}
                  {nukeConfirm.type === 'platos' && <>Vas a borrar <strong>todos los platos de la carta</strong>. Las ventas históricas no se verán afectadas.</>}
                </p>
              </div>
              <div className="px-6 pb-6 flex gap-3">
                <button onClick={() => setNukeConfirm(null)} className="flex-1 py-3 rounded-xl font-black text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition">Cancelar</button>
                <button onClick={nukeConfirm.onConfirm} className="flex-1 py-3 rounded-xl font-black text-sm text-white bg-rose-600 hover:bg-rose-700 transition shadow-lg shadow-rose-200">Sí, borrar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showKeyModal && (
          <GeminiKeyModal reason={keyModalReason} onClose={() => setShowKeyModal(false)} onSaved={() => {
            setShowKeyModal(false);
            if (abortRef.current) {
              abortRef.current = false;
              setQueue(prev => prev.map(item => item.status === 'error' && item.error?.includes('GEMINI_KEY_MISSING') ? { ...item, status: 'pending', error: undefined, attempts: 0 } : item));
            }
          }} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reviewItem && (
          <ReviewModal
            item={reviewItem}
            queuePosition={{ current: done + 1, total }}
            onConfirm={handleReviewConfirm}
            onSkip={handleReviewSkip}
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-4 px-2 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Compras · Importación</p>
          <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight mt-1">Data Input</h2>
          <p className="text-sm text-[color:var(--arume-gray-500)] mt-1">Revisión documento a documento · sin sorpresas</p>
        </div>

        {pendingReview.length > 0 && (
          <button
            onClick={() => setReviewItem(pendingReview[0])}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-warn)] text-white shadow-sm hover:brightness-95 transition"
          >
            <Eye className="w-3.5 h-3.5" />
            {pendingReview.length} pendiente{pendingReview.length > 1 ? 's' : ''} de revisar
          </button>
        )}

        <button
          onClick={() => { setKeyModalReason(!activeVisionProvider ? 'missing' : 'exhausted'); setShowKeyModal(true); }}
          className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all',
            !activeVisionProvider ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 animate-pulse' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600')}
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>{!activeVisionProvider ? 'Sin API Key' : {
            gemini: '🔵 Gemini', mistral: '🇪🇺 Mistral', groq: '🟢 Groq'
          }[activeVisionProvider] ?? activeVisionProvider}</span>
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden p-6 md:p-8">

        {/* Selector de modo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <ModuleButton active={importMode === 'ia_auto'}         onClick={() => { setImportMode('ia_auto');         setProcessedData(null); }} icon={Sparkles}  title="IA Batch (Lotes)"  subtitle="Facturas/Albaranes" color="indigo"  />
          <ModuleButton active={importMode === 'banco_excel'}     onClick={() => { setImportMode('banco_excel');     setProcessedData(null); }} icon={Building2}  title="Banco CSV"          subtitle="Extracto"           color="blue"    />
          <ModuleButton active={importMode === 'tpv'}             onClick={() => { setImportMode('tpv');             setProcessedData(null); }} icon={Grid}       title="TPV Madis"          subtitle="Excel Cajas"        color="amber"   />
          <ModuleButton active={importMode === 'albaranes_excel'} onClick={() => { setImportMode('albaranes_excel'); setProcessedData(null); }} icon={Truck}      title="Albaranes Excel"    subtitle="Madis / CSV"        color="emerald" />
        </div>

        {/* Zona IA */}
        {importMode === 'ia_auto' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Unidad:</span>
              {[{id:'REST',label:'🍽️ Restaurante'},{id:'SHOP',label:'🛍️ Shop'},{id:'B2B',label:'🏢 B2B'}].map(u=>(
                <button key={u.id} onClick={() => setSelectedUnit(u.id as any)} className={cn('px-4 py-1.5 rounded-xl text-xs font-black border transition-all', selectedUnit === u.id ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300')}>{u.label}</button>
              ))}
            </div>

            {(!hasQueue || !isRunning) && (
              <div
                className={cn('border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center transition-all cursor-pointer relative overflow-hidden',
                  isDragging ? 'border-indigo-500 bg-indigo-50/50 scale-[1.02]' : 'border-slate-200 bg-slate-50 hover:bg-slate-100',
                  isRunning && 'opacity-50 pointer-events-none')}
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}
              >
                <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} accept=".pdf, image/jpeg, image/png" className="hidden" />
                <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-sm mb-4"><Sparkles className="w-7 h-7 text-indigo-500" /></div>
                <h3 className="text-xl font-black text-slate-700 text-center">{hasQueue ? 'Añadir más archivos a la cola' : 'Arrastra hasta 100 fotos/PDFs'}</h3>
                <p className="text-xs text-slate-400 font-bold mt-2 text-center">Fotos de WhatsApp · PDFs del correo · Ctrl+V para pegar</p>
                <div className="flex flex-col items-center gap-2 mt-4">
                  <div className="bg-amber-50 px-4 py-2 rounded-full border border-amber-200 text-amber-700 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                    <Eye className="w-4 h-4 text-amber-500" /> Revisión obligatoria antes de guardar
                  </div>
                  <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-slate-200 text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                    <ShieldCheck className="w-3 h-3 text-slate-400" /> Corrige errores de la IA al momento
                  </div>
                </div>
              </div>
            )}

            {hasQueue && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {isRunning && !isPaused && <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />}
                      {isPaused && <Pause className="w-5 h-5 text-amber-500" />}
                      {!isRunning && allFinished && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                      {!isRunning && !allFinished && <Play className="w-5 h-5 text-indigo-400" />}
                      <span className="font-black text-sm text-slate-700">
                        {reviewItem ? '⏸ Esperando tu revisión…' : isRunning && !isPaused ? 'Procesando…' : isPaused ? 'En pausa' : allFinished ? 'Completado' : 'Listo para procesar'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                      <span className="text-emerald-600">{done} ✅</span>
                      {pendingReview.length > 0 && <span className="text-amber-500">{pendingReview.length} 👁</span>}
                      {errors.length > 0 && <span className="text-rose-500">{errors.length} ❌</span>}
                      <span className="text-slate-400">{pending} pendientes</span>
                    </div>
                  </div>

                  <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden mb-3">
                    <div className="h-full bg-indigo-500 transition-all duration-500 rounded-full" style={{ width: `${total > 0 ? ((done + errors.length) / total) * 100 : 0}%` }} />
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">{done + errors.length} de {total} procesados</p>

                  <div className="flex gap-2 mt-3 flex-wrap justify-center">
                    {!isRunning && !allFinished && (
                      <button onClick={() => startProcessing()} className="flex items-center gap-2 bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] text-xs font-black px-4 py-2 rounded-xl hover:bg-[color:var(--arume-gray-700)] transition">
                        <Play className="w-3.5 h-3.5" /> Iniciar
                      </button>
                    )}
                    {isRunning && !reviewItem && (
                      <button onClick={togglePause} className={cn('flex items-center gap-2 text-xs font-black px-4 py-2 rounded-xl transition', isPaused ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-amber-400 text-white hover:bg-amber-500')}>
                        {isPaused ? <><Play className="w-3.5 h-3.5" /> Continuar</> : <><Pause className="w-3.5 h-3.5" /> Pausar</>}
                      </button>
                    )}
                    {errors.length > 0 && (
                      <button onClick={retryFailed} className="flex items-center gap-2 bg-rose-500 text-white text-xs font-black px-4 py-2 rounded-xl hover:bg-rose-600 transition">
                        <RefreshCw className="w-3.5 h-3.5" /> Reintentar {errors.length} fallidos
                      </button>
                    )}
                    {allFinished && (
                      <button onClick={() => onNavigate('albaranes')} className="flex items-center gap-2 bg-emerald-600 text-white text-xs font-black px-4 py-2 rounded-xl hover:bg-emerald-700 transition">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Ver documentos
                      </button>
                    )}
                    <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold px-4 py-2 rounded-xl hover:bg-slate-50 transition">
                      <Upload className="w-3.5 h-3.5" /> Añadir más
                    </button>
                    <button onClick={clearQueue} className="flex items-center gap-2 bg-white border border-rose-200 text-rose-500 text-xs font-bold px-4 py-2 rounded-xl hover:bg-rose-50 transition">
                      <X className="w-3.5 h-3.5" /> Limpiar cola
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
                  <div className="max-h-80 overflow-y-auto custom-scrollbar divide-y divide-slate-50">
                    {queue.map((item) => (
                      <QueueRow key={item.id} item={item}
                        onSkip={() => skipItem(item.id)}
                        onReview={() => {
                          if (item.status === 'pending_review' && reviewResolveRef.current) {
                            setReviewItem(item);
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>

                {errors.length > 0 && (
                  <div className="border border-rose-100 rounded-2xl overflow-hidden">
                    <button onClick={() => setShowErrorLog(p => !p)} className="w-full flex items-center justify-between px-5 py-3 bg-rose-50 text-rose-700 text-xs font-black uppercase tracking-widest">
                      <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {errors.length} errores — ver razones</span>
                      {showErrorLog ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <AnimatePresence>
                      {showErrorLog && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="p-3 space-y-1.5 bg-white max-h-48 overflow-y-auto custom-scrollbar">
                            {errors.map(err => (
                              <div key={err.id} className="flex items-start gap-3 bg-rose-50/60 px-3 py-2.5 rounded-xl">
                                <FileText className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                                <div className="min-w-0"><p className="font-bold text-slate-700 text-xs truncate">{err.name}</p><p className="text-rose-500 text-[10px] font-medium mt-0.5">{err.error}</p></div>
                                <button onClick={() => skipItem(err.id)} className="shrink-0 text-slate-300 hover:text-rose-500 transition ml-auto"><SkipForward className="w-4 h-4" /></button>
                              </div>
                            ))}
                          </div>
                          <div className="px-4 py-2 border-t border-rose-100 flex justify-between items-center bg-rose-50/40">
                            <button onClick={() => navigator.clipboard.writeText(errors.map(e => `${e.name}: ${e.error}`).join('\n'))} className="flex items-center gap-1 text-[10px] font-bold text-rose-400 hover:text-rose-600 uppercase"><Copy className="w-3 h-3" /> Copiar log</button>
                            <button onClick={retryFailed} className="flex items-center gap-1 text-[10px] font-bold text-indigo-500 hover:text-indigo-700 uppercase"><RefreshCw className="w-3 h-3" /> Reintentar todos</button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        )}

        {/* Zona Excel */}
        {importMode !== 'ia_auto' && (
          <div>
            <div className={cn('border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center transition-all cursor-pointer relative overflow-hidden',
              isDragging ? 'border-indigo-500 bg-indigo-50/50 scale-[1.02]' : 'border-slate-200 bg-slate-50 hover:bg-slate-100')}
              onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.csv" className="hidden" />
              <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-sm mb-4">
                {importMode === 'banco_excel'     && <Building2 className="w-8 h-8 text-blue-500"    />}
                {importMode === 'tpv'             && <Grid      className="w-8 h-8 text-amber-500"   />}
                {importMode === 'albaranes_excel' && <Truck     className="w-8 h-8 text-emerald-500" />}
              </div>
              <h3 className="text-xl font-black text-slate-700 text-center">
                {importMode === 'banco_excel'     && 'Sube el Excel del Banco'}
                {importMode === 'tpv'             && 'Sube el Excel de Madis'}
                {importMode === 'albaranes_excel' && 'Sube el Excel de Albaranes'}
              </h3>
              <p className="text-xs text-slate-400 font-bold mt-2">.xlsx o .csv — columnas detectadas automáticamente</p>
            </div>

            <AnimatePresence>
              {processedData && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="mt-6">
                  <div className="bg-white border-2 border-indigo-100 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 bg-indigo-50 py-2 px-6 border-b border-indigo-100 flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-1.5"><Edit3 className="w-3 h-3" /> Resumen de Importación</span>
                      <button onClick={() => setProcessedData(null)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                    </div>

                    <div className="mt-10 space-y-4 mb-6">
                      {importMode === 'banco_excel' && processedData.bancoExcel && (
                        <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-200">
                          <ListPlus className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                          <h3 className="font-black text-slate-800 text-lg">{processedData.bancoExcel.length} movimientos detectados</h3>
                          <p className="text-xs text-slate-500 font-bold mt-1">Listos para enviar a la bóveda de conciliación.</p>
                        </div>
                      )}

                      {importMode === 'tpv' && processedData.tpvPreview && (
                        <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-100">
                          <Grid className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                          <h3 className="font-black text-slate-800 text-lg">{processedData.tpvPreview.rows.length - 1} ventas el {processedData.tpvPreview.date}</h3>
                          <p className="text-xs text-slate-500 font-bold mt-1">Se generará un nuevo cierre de caja automático.</p>
                        </div>
                      )}

                      {importMode === 'albaranes_excel' && processedData.albaranesExcel && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                              {processedData.albaranesExcel.filter(r => r.selected).length} de {processedData.albaranesExcel.length} seleccionados
                            </span>
                            <button
                              onClick={() => {
                                const allSelected = processedData.albaranesExcel!.every(r => r.selected);
                                setProcessedData(prev => prev ? {
                                  ...prev,
                                  albaranesExcel: prev.albaranesExcel?.map(r => ({ ...r, selected: !allSelected }))
                                } : null);
                              }}
                              className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 transition"
                            >
                              Marcar / desmarcar todos
                            </button>
                          </div>

                          <div className="max-h-64 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
                            {processedData.albaranesExcel.map((row, i) => (
                              <div
                                key={i}
                                onClick={() => setProcessedData(prev => prev ? {
                                  ...prev,
                                  albaranesExcel: prev.albaranesExcel?.map((r, j) => j === i ? { ...r, selected: !r.selected } : r)
                                } : null)}
                                className={cn(
                                  'flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all',
                                  row.selected ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200 opacity-50'
                                )}
                              >
                                <div className={cn('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                                  row.selected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300')}>
                                  {row.selected && <Check className="w-2.5 h-2.5 text-white" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-slate-700 truncate">{row.proveedor}</p>
                                  <p className="text-[10px] text-slate-400 font-medium">{row.fecha} · Nº {row.num}</p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-xs font-black text-slate-700">{Num.fmt(row.total)}</p>
                                  {row.base != null && <p className="text-[9px] text-slate-400">Base {Num.fmt(row.base)}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <button onClick={handleConfirm} className="w-full bg-indigo-600 hover:bg-[color:var(--arume-gray-700)] text-white font-black text-sm py-4 rounded-xl transition-all shadow-lg flex justify-center items-center gap-2">
                      <Database className="w-4 h-4" /> GUARDAR EN ARUME
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Limpieza Quirúrgica */}
      <div className="mt-8 border border-slate-200 bg-white rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center border border-rose-100"><CalendarClock className="w-6 h-6 text-rose-500" /></div>
            <div>
              <h3 className="text-lg font-black text-slate-800 tracking-tight">Limpieza Quirúrgica por Meses</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Ideal para deshacer importaciones masivas con errores de un mes concreto.</p>
            </div>
          </div>
          <div className="flex gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200">
            <select value={deleteMonth} onChange={(e) => setDeleteMonth(e.target.value)} className="bg-white border border-slate-200 text-slate-800 text-sm font-bold rounded-xl focus:ring-rose-500 focus:border-rose-500 p-2 outline-none cursor-pointer">
              {MONTHS_FULL.map((m, i) => (<option key={i} value={String(i + 1).padStart(2, '0')}>{m.toUpperCase()}</option>))}
            </select>
            <input type="number" value={deleteYear} onChange={(e) => setDeleteYear(e.target.value)} className="bg-white border border-slate-200 text-slate-800 text-sm font-bold rounded-xl p-2 w-24 outline-none text-center" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-slate-100">
          <NukeButton onClick={() => handleNukeQuirurgico('docs')} icon={Receipt} color="rose" title="Facturas y Albaranes" subtitle={`Borra todo lo de ${MONTHS_FULL[Number(deleteMonth) - 1]} ${deleteYear}`} />
          <NukeButton onClick={() => handleNukeQuirurgico('bank')} icon={Building2} color="blue" title="Banco y Conciliación" subtitle={`Borra todo lo de ${MONTHS_FULL[Number(deleteMonth) - 1]} ${deleteYear}`} />
          <NukeButton onClick={handleNukeDataOps} icon={Grid} color="amber" title="Purgar Platos Carta" subtitle="Resetea el menú (No afecta a ventas)" />
        </div>
      </div>
    </div>
  );
};

/* =======================================================
 * MODAL DE REVISIÓN OBLIGATORIA
 * ======================================================= */
interface ReviewModalProps {
  item: QueueItem;
  queuePosition: { current: number; total: number };
  onConfirm: (editedResult: any) => void;
  onSkip: () => void;
}

const ReviewModal = ({ item, queuePosition, onConfirm, onSkip }: ReviewModalProps) => {
  const rawResult = item?.result?.result ?? item?.result ?? null;
  const [edited, setEdited] = React.useState<any>(rawResult ? JSON.parse(JSON.stringify(rawResult)) : null);
  const isAlbaran = edited?.tipo_documento === 'albaran' || edited?.items !== undefined;

  React.useEffect(() => {
    const r = item?.result?.result ?? item?.result ?? null;
    setEdited(r ? JSON.parse(JSON.stringify(r)) : null);
  }, [item?.id]);

  const calculatedTotal = React.useMemo(() => {
    if (!edited) return 0;
    if (isAlbaran && Array.isArray(edited.items)) {
      return edited.items.reduce((acc: number, it: any) => acc + (Num.parse(it.total) || 0), 0);
    }
    return Num.parse(edited.total) || 0;
  }, [edited, isAlbaran]);

  const updateLine = (idx: number, field: string, value: any) => {
    setEdited((prev: any) => {
      if (!prev) return prev;
      const items = [...(prev.items || [])];
      items[idx] = { ...items[idx], [field]: value };
      if (field === 'q' || field === 'unitPrice') {
        const q  = field === 'q'         ? Num.parse(value) : Num.parse(items[idx].q);
        const up = field === 'unitPrice' ? Num.parse(value) : Num.parse(items[idx].unitPrice);
        const rate = Num.parse(items[idx].rate) || 10;
        const base = round2(q * up);
        const tax  = round2(base * rate / 100);
        items[idx] = { ...items[idx], base, tax, total: round2(base + tax) };
      }
      return { ...prev, items };
    });
  };

  const addLine = () => {
    setEdited((prev: any) => ({
      ...prev,
      items: [...(prev.items || []), { q: 1, n: '', u: 'uds', rate: 10, unitPrice: 0, base: 0, tax: 0, total: 0 }]
    }));
  };

  const removeLine = (idx: number) => {
    setEdited((prev: any) => ({ ...prev, items: prev.items.filter((_: any, i: number) => i !== idx) }));
  };

  if (!edited) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-2 sm:p-4"
    >
      <motion.div
        initial={{ scale: 0.96, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 20 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden"
        style={{ maxHeight: '95vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Eye className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-800 truncate max-w-xs">{item.name}</p>
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">
                Documento {queuePosition.current} de {queuePosition.total} · Revisa y confirma antes de guardar
              </p>
            </div>
          </div>
          <select
            value={edited.tipo_documento || (isAlbaran ? 'albaran' : 'factura')}
            onChange={e => setEdited((prev: any) => ({ ...prev, tipo_documento: e.target.value }))}
            className="text-xs font-black bg-slate-100 border-0 rounded-xl px-3 py-2 outline-none text-slate-700 cursor-pointer"
          >
            <option value="albaran">📦 Albarán</option>
            <option value="factura">🧾 Factura</option>
            <option value="ticket_simplificado">🎫 Ticket</option>
          </select>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Panel izquierdo: imagen */}
          <div className="w-2/5 bg-slate-50 border-r border-slate-100 flex items-center justify-center p-4 shrink-0">
            {item.thumb && item.thumb !== 'pdf' ? (
              <img src={item.thumb} alt="Preview" className="max-w-full max-h-full object-contain rounded-xl shadow-sm" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <FileText className="w-20 h-20 text-slate-200" />
                <p className="text-sm font-bold text-center">PDF — sin vista previa</p>
                <p className="text-xs text-slate-400 text-center">Revisa los datos extraídos en el panel derecho</p>
              </div>
            )}
          </div>

          {/* Panel derecho: campos editables */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Datos principales */}
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Datos principales</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Proveedor</label>
                  <input type="text" value={edited.prov || edited.proveedor || ''} onChange={e => setEdited((p: any) => ({ ...p, prov: e.target.value, proveedor: e.target.value }))}
                    className="w-full text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Número</label>
                  <input type="text" value={edited.num || ''} onChange={e => setEdited((p: any) => ({ ...p, num: e.target.value }))}
                    className="w-full text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Fecha</label>
                  <input type="date" value={edited.date || edited.fecha || ''} onChange={e => setEdited((p: any) => ({ ...p, date: e.target.value, fecha: e.target.value }))}
                    className="w-full text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition" />
                </div>
              </div>
            </div>

            {/* Desglose fiscal */}
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Desglose fiscal</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Base (€)</label>
                  <input type="number" step="0.01" min="0" value={edited.base ?? ''} placeholder="Auto"
                    onChange={e => {
                      const base  = parseFloat(e.target.value) || 0;
                      const total = Num.parse(edited.total || 0);
                      const iva   = Num.round2(total - base);
                      setEdited((p: any) => ({ ...p, base, iva, taxes: iva, tax: String(iva) }));
                    }}
                    className="w-full text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white transition" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">IVA (€)</label>
                  <input type="number" step="0.01" min="0" value={edited.iva ?? edited.taxes ?? edited.tax ?? ''} placeholder="Auto"
                    onChange={e => {
                      const iva   = parseFloat(e.target.value) || 0;
                      const total = Num.parse(edited.total || 0);
                      const base  = Num.round2(total - iva);
                      setEdited((p: any) => ({ ...p, iva, taxes: iva, tax: String(iva), base }));
                    }}
                    className="w-full text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white transition" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Tipo IVA</label>
                  <select
                    value={(() => {
                      const base = Num.parse(edited.base || 0);
                      const iva  = Num.parse(edited.iva ?? edited.taxes ?? edited.tax ?? 0);
                      if (base > 0 && iva > 0) {
                        const pct = Math.round((iva / base) * 100);
                        if (pct <= 5) return '4'; if (pct <= 12) return '10'; return '21';
                      }
                      return '10';
                    })()}
                    onChange={e => {
                      const rate  = parseInt(e.target.value);
                      const total = Num.parse(edited.total || 0);
                      const base  = Num.round2(total / (1 + rate / 100));
                      const iva   = Num.round2(total - base);
                      setEdited((p: any) => ({ ...p, base, iva, taxes: iva, tax: String(iva) }));
                    }}
                    className="w-full text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer"
                  >
                    <option value="4">4%</option>
                    <option value="10">10%</option>
                    <option value="21">21%</option>
                  </select>
                </div>
              </div>

              {Num.parse(edited.total || 0) > 0 && (() => {
                const total = Num.parse(edited.total || 0);
                const iva   = Num.parse(edited.iva ?? edited.taxes ?? edited.tax ?? 0);
                const base  = iva > 0 ? Num.round2(total - iva) : Num.round2(total / 1.10);
                const pct   = base > 0 ? Math.round((Math.abs(iva) / base) * 100) : 10;
                return (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="px-2.5 py-1 bg-slate-100 rounded-full text-[10px] font-black text-slate-500">Base {Num.fmt(base)}</span>
                    <span className="text-slate-300 text-xs">+</span>
                    <span className="px-2.5 py-1 bg-indigo-50 rounded-full text-[10px] font-black text-indigo-600">IVA {pct}% = {Num.fmt(Math.abs(iva))}</span>
                    <span className="text-slate-300 text-xs">=</span>
                    <span className="px-2.5 py-1 bg-emerald-50 rounded-full text-[10px] font-black text-emerald-600">Total {Num.fmt(total)}</span>
                  </div>
                );
              })()}

              <div className="mt-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Método de pago</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { val: 'pendiente', label: '⏳ Pendiente' },
                    { val: 'efectivo',  label: '💵 Efectivo'  },
                    { val: 'tarjeta',   label: '💳 Tarjeta'   },
                    { val: 'banco',     label: '🏦 Banco'     },
                  ].map(opt => (
                    <button
                      key={opt.val} type="button"
                      onClick={() => setEdited((p: any) => ({ ...p, metodo_pago: opt.val, paid: opt.val !== 'pendiente' }))}
                      className={cn('px-3 py-1.5 rounded-xl text-[11px] font-black border transition-all',
                        (edited.metodo_pago ?? 'pendiente') === opt.val
                          ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] border-indigo-600 shadow-sm'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600')}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Líneas */}
            {(isAlbaran || edited.lineas) && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {isAlbaran ? 'Líneas del albarán' : 'Líneas de la factura'}
                  </p>
                  <button onClick={addLine} className="flex items-center gap-1 text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100 hover:bg-indigo-100 transition">
                    <Plus className="w-3 h-3" /> Añadir línea
                  </button>
                </div>
                <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
                  {(edited.items || []).map((lineItem: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-12 gap-1.5 bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                      <input type="text" value={lineItem.n || ''} onChange={e => updateLine(idx, 'n', e.target.value)}
                        placeholder="Descripción" className="col-span-5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                      <input type="number" value={lineItem.q || ''} onChange={e => updateLine(idx, 'q', e.target.value)}
                        placeholder="Qty" className="col-span-1 text-xs font-bold text-center text-slate-700 bg-white border border-slate-200 rounded-lg px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                      <input type="text" value={lineItem.u || ''} onChange={e => updateLine(idx, 'u', e.target.value)}
                        placeholder="Ud." className="col-span-1 text-xs font-medium text-center text-slate-700 bg-white border border-slate-200 rounded-lg px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                      <input type="number" step="0.01" value={lineItem.unitPrice || ''} onChange={e => updateLine(idx, 'unitPrice', e.target.value)}
                        placeholder="P/u" className="col-span-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                      <div className="col-span-2 flex items-center justify-end">
                        <span className="text-xs font-black text-indigo-600">{Num.fmt(Num.parse(lineItem.total) || 0)}</span>
                      </div>
                      <button onClick={() => removeLine(idx)} className="col-span-1 flex items-center justify-center text-slate-300 hover:text-rose-500 transition">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {(edited.items || []).length === 0 && (
                    <p className="text-[10px] text-slate-400 text-center py-4">Sin líneas — pulsa "Añadir línea" para añadir productos</p>
                  )}
                </div>
              </div>
            )}

            {/* Total */}
            <div className="flex items-center justify-between bg-slate-900 px-5 py-4 rounded-2xl">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</span>
              <span className="text-2xl font-black text-emerald-400">{Num.fmt(calculatedTotal)}</span>
            </div>

            {isAlbaran && edited.items && Math.abs(calculatedTotal - Num.parse(edited.total)) > 0.05 && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs font-bold text-amber-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                El total calculado ({Num.fmt(calculatedTotal)}) difiere del original ({Num.fmt(Num.parse(edited.total))}). Se guardará el total calculado.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/50 shrink-0">
          <button onClick={onSkip} className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-200 transition">
            <SkipForward className="w-4 h-4" /> Descartar este documento
          </button>
          <button
            onClick={() => {
              const finalResult = { ...edited, total: String(calculatedTotal) };
              if (isAlbaran) finalResult.total = String(calculatedTotal);
              onConfirm(finalResult);
            }}
            className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-black bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition shadow-lg shadow-indigo-200 active:scale-95"
          >
            <Check className="w-4 h-4" /> Confirmar y guardar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

/* ─── QueueRow ───────────────────────────────────────────────────────────────── */
const STATUS_CONFIG: Record<FileStatus, { bg: string; text: string; dot: string; label: string }> = {
  pending:        { bg: 'bg-slate-100',  text: 'text-slate-500',  dot: 'bg-slate-300',                label: 'Pendiente'   },
  processing:     { bg: 'bg-indigo-50',  text: 'text-indigo-600', dot: 'bg-indigo-500 animate-pulse',  label: 'Analizando…' },
  pending_review: { bg: 'bg-amber-50',   text: 'text-amber-600',  dot: 'bg-amber-400 animate-pulse',   label: 'Revisar'     },
  success:        { bg: 'bg-emerald-50', text: 'text-emerald-600',dot: 'bg-emerald-500',               label: 'Guardado'    },
  error:          { bg: 'bg-rose-50',    text: 'text-rose-600',   dot: 'bg-rose-500',                  label: 'Error'       },
  skipped:        { bg: 'bg-slate-50',   text: 'text-slate-400',  dot: 'bg-slate-200',                 label: 'Descartado'  },
};

const QueueRow = ({ item, onSkip, onReview }: { item: QueueItem; onSkip: () => void; onReview: () => void }) => {
  const cfg = STATUS_CONFIG[item.status];
  const res = item.result?.result ?? item.result;
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 transition-colors', cfg.bg)}>
      <div className="w-9 h-9 rounded-lg overflow-hidden bg-white border border-slate-100 flex items-center justify-center shrink-0 shadow-sm">
        {item.thumb && item.thumb !== 'pdf' ? (<img src={item.thumb} alt="" className="w-full h-full object-cover" />) : (<FileText className="w-5 h-5 text-rose-400" />)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-700 truncate">{item.name}</p>
        {item.status === 'success' && res && (
          <p className="text-[10px] text-emerald-600 font-bold mt-0.5 truncate">
            {res.prov || res.proveedor || ''}{res.total ? ` · ${Num.fmt(parseFloat(res.total))}` : ''}{res.date ? ` · ${res.date}` : ''}
          </p>
        )}
        {item.status === 'pending_review' && res && (
          <p className="text-[10px] text-amber-600 font-bold mt-0.5 truncate">
            IA dice: {res.prov || res.proveedor || '?'} · {res.total ? Num.fmt(parseFloat(res.total)) : '?€'} — revisa →
          </p>
        )}
        {item.status === 'error'      && item.error && (<p className="text-[10px] text-rose-500 font-medium mt-0.5 truncate">{item.error}</p>)}
        {item.status === 'processing' && (<p className="text-[10px] text-indigo-400 font-medium mt-0.5">Intento {item.attempts + 1} de {item.maxAttempts}…</p>)}
      </div>
      <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0',
        item.status === 'processing'     ? 'bg-indigo-100'  :
        item.status === 'success'        ? 'bg-emerald-100' :
        item.status === 'pending_review' ? 'bg-amber-100'   :
        item.status === 'error'          ? 'bg-rose-100'    : 'bg-slate-100')}>
        <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
        <span className={cn('text-[9px] font-black uppercase tracking-widest', cfg.text)}>{cfg.label}</span>
      </div>
      {item.status === 'error'          && (<button onClick={onSkip}   title="Omitir"        className="text-slate-300 hover:text-rose-400 transition shrink-0"><SkipForward className="w-4 h-4" /></button>)}
      {item.status === 'processing'     && (<Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />)}
      {item.status === 'success'        && (<CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />)}
      {item.status === 'pending_review' && (
        <button onClick={onReview} title="Revisar ahora" className="p-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-all shrink-0 animate-pulse">
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

/* ─── ModuleButton ───────────────────────────────────────────────────────────── */
const ModuleButton = ({ active, onClick, icon: Icon, title, subtitle, color }: any) => {
  const colors: any = {
    indigo:  active ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] border-indigo-600 shadow-md shadow-indigo-200'    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50',
    blue:    active ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200'          : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50',
    amber:   active ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200'       : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:bg-amber-50',
    emerald: active ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50',
  };
  return (
    <button onClick={onClick} className={cn('p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-2 text-center', colors[color])}>
      <Icon className={cn('w-6 h-6', active ? 'text-white' : `text-${color}-500`)} />
      <div><h4 className="text-xs font-black tracking-tight">{title}</h4><p className={cn('text-[9px] font-bold uppercase tracking-widest mt-0.5', active ? 'text-white/80' : 'text-slate-400')}>{subtitle}</p></div>
    </button>
  );
};

/* ─── NukeButton ─────────────────────────────────────────────────────────────── */
const NukeButton = ({ onClick, icon: Icon, color, title, subtitle }: any) => {
  const border: any   = { rose: 'border-rose-200 hover:bg-rose-50 hover:border-rose-400',   blue: 'border-blue-200 hover:bg-blue-50 hover:border-blue-400',   amber: 'border-amber-200 hover:bg-amber-50 hover:border-amber-400' };
  const iconColor: any = { rose: 'text-rose-500',  blue: 'text-blue-500',  amber: 'text-amber-500'  };
  const trashColor: any= { rose: 'text-rose-300 group-hover:text-rose-600', blue: 'text-blue-300 group-hover:text-blue-600', amber: 'text-amber-300 group-hover:text-amber-600' };
  return (
    <button onClick={onClick} className={cn('flex items-center justify-between p-4 bg-white border transition-all rounded-2xl text-left group', border[color])}>
      <div><span className={cn('font-black text-sm text-slate-800 flex items-center gap-2')}><Icon className={cn('w-4 h-4', iconColor[color])} />{title}</span><p className="text-[10px] text-slate-400 font-medium mt-1">{subtitle}</p></div>
      <Trash2 className={cn('w-5 h-5 transition-colors', trashColor[color])} />
    </button>
  );
};

/* ─── GeminiKeysConfig ───────────────────────────────────────────────────────── */
export const GeminiKeysConfig = () => {
  const [keys, setKeys] = React.useState(() => ({
    k1: localStorage.getItem('gemini_api_key')   || '',
    k2: localStorage.getItem('gemini_api_key_2') || '',
    k3: localStorage.getItem('gemini_api_key_3') || '',
  }));
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    if (keys.k1.trim()) localStorage.setItem('gemini_api_key',   keys.k1.trim()); else localStorage.removeItem('gemini_api_key');
    if (keys.k2.trim()) localStorage.setItem('gemini_api_key_2', keys.k2.trim()); else localStorage.removeItem('gemini_api_key_2');
    if (keys.k3.trim()) localStorage.setItem('gemini_api_key_3', keys.k3.trim()); else localStorage.removeItem('gemini_api_key_3');
    setSaved(true); setTimeout(() => setSaved(false), 2500);
  };

  const activeCount = [keys.k1, keys.k2, keys.k3].filter(k => k.trim()).length;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-800 text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-500"/>Claves API Gemini</h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{activeCount} key{activeCount !== 1 ? 's' : ''} activa{activeCount !== 1 ? 's' : ''} — rotación automática al saturarse</p>
        </div>
        {activeCount > 1 && (
          <div className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-emerald-500"/>
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Multi-key ON</span>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {[
          { label: 'Key Principal',     field: 'k1' as const, required: true  },
          { label: 'Key Alternativa 2', field: 'k2' as const, required: false },
          { label: 'Key Alternativa 3', field: 'k3' as const, required: false },
        ].map(({ label, field, required }) => (
          <div key={field}>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">
              {label}{required && <span className="text-rose-400"> *</span>}
              {!required && <span className="text-slate-300 font-normal normal-case tracking-normal ml-1">— Crea proyecto gratis en aistudio.google.com</span>}
            </label>
            <input type="password" value={keys[field]} onChange={e => setKeys(prev => ({ ...prev, [field]: e.target.value }))}
              placeholder={required ? 'AIza...' : 'Opcional — AIza...'}
              className={cn('w-full bg-slate-50 border rounded-xl px-4 py-3 text-sm font-mono outline-none transition',
                keys[field].trim() ? 'border-emerald-300 focus:border-emerald-400' : 'border-slate-200 focus:border-indigo-300')} />
          </div>
        ))}
      </div>
      <button onClick={handleSave} className={cn('w-full py-3 rounded-xl font-black text-sm transition-all', saved ? 'bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-[color:var(--arume-gray-700)] text-white')}>
        {saved ? '✅ Guardado' : 'Guardar claves'}
      </button>
    </div>
  );
};

/* ─── GeminiKeyModal ─────────────────────────────────────────────────────────── */
interface GeminiKeyModalProps { reason: 'missing' | 'exhausted'; onClose: () => void; onSaved: () => void; }

const GeminiKeyModal = ({ reason, onClose, onSaved }: GeminiKeyModalProps) => {
  const [keys, setKeys] = React.useState({
    k1: localStorage.getItem('gemini_api_key')   || '',
    k2: localStorage.getItem('gemini_api_key_2') || '',
    k3: localStorage.getItem('gemini_api_key_3') || '',
  });
  const [show,  setShow]  = React.useState({ k1: false, k2: false, k3: false });
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    if (!keys.k1.trim()) return void toast.warning('La key principal es obligatoria.');
    if (keys.k1.trim()) localStorage.setItem('gemini_api_key',   keys.k1.trim());
    if (keys.k2.trim()) localStorage.setItem('gemini_api_key_2', keys.k2.trim()); else localStorage.removeItem('gemini_api_key_2');
    if (keys.k3.trim()) localStorage.setItem('gemini_api_key_3', keys.k3.trim()); else localStorage.removeItem('gemini_api_key_3');
    setSaved(true); setTimeout(() => { onSaved(); }, 1200);
  };

  const activeCount = [keys.k1, keys.k2, keys.k3].filter(k => k.trim()).length;
  const FIELDS = [
    { label: 'Key Principal',     field: 'k1' as const, required: true  },
    { label: 'Key Alternativa 2', field: 'k2' as const, required: false },
    { label: 'Key Alternativa 3', field: 'k3' as const, required: false },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ y: 60, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', damping: 22, stiffness: 300 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        <div className={cn('px-6 pt-6 pb-4 border-b', reason === 'missing' ? 'border-rose-100 bg-rose-50' : 'border-amber-100 bg-amber-50')}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', reason === 'missing' ? 'bg-rose-100' : 'bg-amber-100')}>
                <KeyRound className={cn('w-5 h-5', reason === 'missing' ? 'text-rose-600' : 'text-amber-600')}/>
              </div>
              <div>
                <h3 className="font-black text-slate-800 text-base">{reason === 'missing' ? 'Falta la API Key de Gemini' : 'Todas las keys saturadas'}</h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">{reason === 'missing' ? 'Añade tu clave para empezar a procesar documentos' : 'Añade más keys para no parar el proceso'}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-300 hover:text-slate-600 transition mt-0.5"><X className="w-5 h-5"/></button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {FIELDS.map(({ label, field, required }) => (
            <div key={field}>
              <label className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}{required && <span className="text-rose-400"> *</span>}</span>
                {keys[field].trim() && (<span className="text-[9px] font-bold text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3"/> Configurada</span>)}
              </label>
              <div className="relative">
                <input type={show[field] ? 'text' : 'password'} value={keys[field]}
                  onChange={e => setKeys(prev => ({ ...prev, [field]: e.target.value }))}
                  placeholder={required ? 'AIzaSy...' : 'Opcional — AIzaSy...'}
                  className={cn('w-full bg-slate-50 border rounded-xl px-4 py-3 pr-10 text-sm font-mono outline-none transition',
                    keys[field].trim() ? 'border-emerald-300 focus:border-emerald-400 bg-emerald-50/30' : 'border-slate-200 focus:border-indigo-300')} />
                <button type="button" onClick={() => setShow(prev => ({ ...prev, [field]: !prev[field] }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {show[field] ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                </button>
              </div>
              {!required && !keys[field].trim() && (
                <p className="text-[9px] text-slate-400 mt-1 font-medium">Crea un proyecto gratis en <span className="font-mono">aistudio.google.com</span> → Get API Key</p>
              )}
            </div>
          ))}
          {activeCount > 1 && (
            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
              <Zap className="w-4 h-4 text-indigo-500 shrink-0"/>
              <p className="text-xs font-bold text-indigo-700">{activeCount} keys activas — rotación automática al saturarse cada una</p>
            </div>
          )}
        </div>

        <div className="px-6 pb-6">
          <button onClick={handleSave} disabled={!keys.k1.trim() || saved}
            className={cn('w-full py-4 rounded-xl font-black text-sm transition-all shadow-lg',
              saved                ? 'bg-emerald-500 text-white shadow-emerald-200' :
              keys.k1.trim()       ? 'bg-indigo-600 hover:bg-[color:var(--arume-gray-700)] text-white shadow-indigo-200' :
                                     'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none')}>
            {saved
              ? '✅ Guardado — reanudando cola…'
              : reason === 'missing'
                ? 'Guardar y empezar a procesar'
                : 'Guardar y continuar con la cola'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
