import React, { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { 
  Search, Plus, Download, Package, AlertTriangle, Check, Clock, Trash2, 
  Building2, ShoppingBag, ListPlus, Users, Hotel, Layers, X, 
  LineChart as LineChartIcon, FileSpreadsheet, Mic, Square, 
  UploadCloud, FileDown, Smartphone, Camera, Loader2, Mail, 
  CheckCircle2, Link as LinkIcon, Inbox, ArrowRight, CheckSquare, 
  Sparkles, ChevronLeft, ChevronRight, Zap, FileText, FileArchive, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { AppData, Factura, Albaran, Socio } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';

// 🚀 COMPONENTES HIJOS
import { InvoicesList } from './InvoicesList';
import { InvoiceDetailModal } from './InvoiceDetailModal';

export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

export type FacturaExtended = Factura & {
  status?: 'ingested' | 'parsed' | 'draft' | 'approved' | 'paid' | 'reconciled' | 'mismatch';
  file_base64?: string;
  attachmentSha?: string; 
  albaranIdsArr?: string[];
  fecha_pago?: string;
  source?: string;
  dueDate?: string;
  candidatos?: any[];
  sumaAlbaranes?: number;
  diferencia?: number;
  cuadraPerfecto?: boolean;
  emailMeta?: any; 
};

type EmailDraft = {
  id: string;
  from: string;
  subject: string;
  date: string;
  hasAttachment: boolean;
  status: 'new' | 'parsed';
};

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'DLV', name: 'Catering Hoteles', icon: Hotel, color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'CORP', name: 'Socios / Corp', icon: Users, color: 'text-slate-600', bg: 'bg-slate-100' },
];

export interface InvoicesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

/* =======================================================
 * 🛡️ 1. UTILIDADES Y SEGURIDAD (Anti-Crash)
 * ======================================================= */
const TOLERANCIA = 0.50; 

export const superNorm = (s: string | undefined | null) => {
  if (!s || typeof s !== 'string') return 'desconocido';
  try { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(s\.?l\.?|s\.?a\.?|s\.?l\.?u\.?|s\.?c\.?p\.?)\b/gi, '').replace(/[^a-z0-9]/g, '').trim(); } catch (e) { return 'desconocido'; }
};

const safeJSON = (str: string) => { try { const match = str.match(/\{[\s\S]*\}/); return match ? JSON.parse(match[0]) : {}; } catch { return {}; } };

const hasRealFiles = (e: React.DragEvent | DragEvent) => {
  const items = e.dataTransfer?.items;
  if (!items || items.length === 0) return false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') return true;
  }
  return false;
};

async function sha256File(file: File) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

const matchAlbaranesToFactura = (factura: FacturaExtended, albaranes: Albaran[], provNormalizado: string) => {
  const fDate = factura?.date || DateUtil.today();
  const mesDraft = typeof fDate === 'string' ? fDate.substring(0, 7) : '0000-00';
  
  const candidatos = albaranes.filter(a => {
    const aDate = a?.date || '';
    return !a?.invoiced && superNorm(a?.prov) === provNormalizado && (typeof aDate === 'string' && aDate.startsWith(mesDraft));
  });

  const sumaAlbaranes = candidatos.reduce((acc, a) => acc + (Num.parse(a?.total) || 0), 0);
  const totalFactura = Num.parse(factura?.total) || 0;
  
  const diff = Math.abs(sumaAlbaranes - Math.abs(totalFactura));
  const toleranciaPermitida = Math.max(TOLERANCIA, Math.abs(totalFactura) * 0.005);
  const cuadraPerfecto = diff <= toleranciaPermitida && candidatos.length > 0;

  return { candidatos, sumaAlbaranes, diferencia: diff, cuadraPerfecto };
};

/* =======================================================
 * 🏦 COMPONENTE PRINCIPAL
 * ======================================================= */
export const InvoicesView = ({ data, onSave }: InvoicesViewProps) => {
  // 🔥 FIX 1: Protección extrema de los arrays base
  const safeData = data || {};
  const facturasSeguras = Array.isArray(safeData.facturas) ? safeData.facturas as FacturaExtended[] : [];
  const albaranesSeguros = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  const sociosSeguros = Array.isArray(safeData.socios) ? safeData.socios : [];

  const fallbackSocios = [{ id: "s1", n: "ARUME" }, { id: "s2", n: "PAU" }];
  const sociosRealesObj = sociosSeguros.length > 0 ? sociosSeguros.filter(s => s?.active) : fallbackSocios;
  const SOCIOS_REALES_NAMES = sociosRealesObj.map(s => s.n);

  const [activeTab, setActiveTab] = useState<'pend' | 'hist'>('pend');
  const [mode, setMode] = useState<'proveedor' | 'socio'>('proveedor');
  const [year, setYear] = useState(new Date().getFullYear());
  const [searchQ, setSearchQ] = useState('');
  const deferredSearch = useDeferredValue(searchQ);
  
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid' | 'reconciled'>('all');
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL');
  
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportQuarter, setExportQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  
  // 🛡️ D&D States
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const [selectedGroup, setSelectedGroup] = useState<{ label: string; ids: string[], unitId: BusinessUnit } | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<FacturaExtended | null>(null);
  const [modalForm, setModalForm] = useState({ num: '', date: DateUtil.today(), selectedAlbs: [] as string[], unitId: 'REST' as BusinessUnit });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const [emailInbox, setEmailInbox] = useState<EmailDraft[]>([
    { id: 'm1', from: 'ventas@makro.es', subject: 'Factura F-2026/012 (Demo)', date: DateUtil.today(), hasAttachment: true, status: 'new' }
  ]);

  /* =======================================================
   * 🛡️ DRAG & DROP WATCHDOG SUPREMO (Cero Pantallas Azules)
   * ======================================================= */
  useEffect(() => {
    // Si el overlay se queda pillado, un click o teclear cualquier cosa lo apagará
    const forceReset = () => {
      if (isDragging) {
        dragCounter.current = 0;
        setIsDragging(false);
      }
    };

    window.addEventListener("click", forceReset);
    window.addEventListener("keydown", forceReset);
    window.addEventListener('dragend', forceReset);
    window.addEventListener('mouseleave', forceReset); 

    return () => {
      window.removeEventListener("click", forceReset);
      window.removeEventListener("keydown", forceReset);
      window.removeEventListener('dragend', forceReset);
      window.removeEventListener('mouseleave', forceReset); 
    };
  }, [isDragging]);

  const handleDragEnter = useCallback((e: React.DragEvent) => { 
    if (!hasRealFiles(e)) return; 
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++; 
    if (!isDragging) setIsDragging(true); 
  }, [isDragging]);

  const handleDragOver = useCallback((e: React.DragEvent) => { 
    if (!hasRealFiles(e)) return; 
    e.preventDefault(); 
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => { 
    if (!hasRealFiles(e)) return; 
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--; 
    if (dragCounter.current <= 0) { setIsDragging(false); dragCounter.current = 0; } 
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => { 
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false); dragCounter.current = 0; 
    
    const dt = e.dataTransfer;
    if (!dt?.files?.length) return;
    if (dt.files.length > 1) return alert("Sube 1 solo documento para evitar errores.");
    
    const file = dt.files[0]; 
    if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
      await processLocalFile(file); 
    } else {
      alert("⚠️ Solo se permiten archivos PDF o imágenes.");
    }
  }, []); 

  /* =======================================================
   * ⌨️ ATAJOS DE TECLADO RÁPIDOS
   * ======================================================= */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!isTyping && e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder^="Buscar"]')?.focus(); }
      if (!isTyping && e.key.toLowerCase() === 'g') { e.preventDefault(); setActiveTab(t => t === 'pend' ? 'hist' : 'pend'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* =======================================================
   * 🧠 AUDITORÍA DE IA MEMOIZADA (3-WAY MATCHING)
   * ======================================================= */
  const draftsIA = useMemo(() => {
    try {
      return facturasSeguras.filter(f => f?.status === 'draft').map(draft => {
        const matchResult = matchAlbaranesToFactura(draft, albaranesSeguros, superNorm(draft?.prov));
        return { ...draft, ...matchResult };
      });
    } catch (error) {
      console.error("Error en draftsIA:", error);
      return [];
    }
  }, [facturasSeguras, albaranesSeguros]);

  /* =======================================================
   * 🤖 MOTOR OCR (Google Gemini + Fallback Seguro)
   * ======================================================= */
  const processLocalFile = async (file: File) => {
    setIsSyncing(true); 
    try {
      const sha = await sha256File(file);
      const isDuplicate = facturasSeguras.some(f => f.attachmentSha === sha);
      if (isDuplicate) { setIsSyncing(false); return alert("⚠️ Documento duplicado (misma huella digital)."); }

      const apiKey = localStorage.getItem('gemini_api_key');
      if (!apiKey) throw new Error("NO_API_KEY");

      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(file);
      });
      const soloBase64 = fileBase64.split(',')[1];

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Actúa como un OCR contable. Extrae de esta factura y devuelve SOLO un JSON estricto: { "proveedor": "Nombre de la empresa", "num": "Número de factura", "fecha": "YYYY-MM-DD", "total": 0, "base": 0, "iva": 0 }`;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: soloBase64, mimeType: file.type } }] }],
        config: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const cleanText = (response.text || "").replace(/(?:json)?/gi, '').replace(/```/g, '').trim();
      const rawJson = safeJSON(cleanText);

      const nuevaFacturaIA: FacturaExtended = {
        id: 'draft-local-' + Date.now(), tipo: 'compra', num: rawJson.num || 'S/N', 
        date: rawJson.fecha || DateUtil.today(), prov: rawJson.proveedor || 'Proveedor Desconocido',
        total: String(rawJson.total || 0), base: String(rawJson.base || 0), tax: String(rawJson.iva || 0),
        paid: false, reconciled: false, source: 'dropzone', status: 'draft', unidad_negocio: 'REST', file_base64: fileBase64, attachmentSha: sha 
      };

      await onSave({ ...safeData, facturas: [nuevaFacturaIA, ...facturasSeguras] });
      alert("✅ Factura extraída correctamente. Revisa la bandeja de conciliación IA.");

    } catch (e) {
      console.warn("⚠️ Gemini falló. Activando Rescate Local...");
      try {
        let extractedText = ""; let possibleTotal = 0;
        const fileBase64 = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file); });

        if (file.type.includes('image')) {
           const tesseractModule = await import('tesseract.js'); const Tesseract = tesseractModule.default || tesseractModule;
           const { data: { text } } = await Tesseract.recognize(file, 'spa'); extractedText = text;
        } else if (file.type === 'application/pdf') {
           const pdfjsLib = await import('pdfjs-dist');
           // @ts-ignore
           const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min?url')).default;
           pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

           const arrayBuffer = await file.arrayBuffer(); const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
           for (let i = 1; i <= pdfDoc.numPages; i++) { const page = await pdfDoc.getPage(i); const textContent = await page.getTextContent(); extractedText += textContent.items.map((item: any) => item.str).join(' ') + '\n'; }
        }
        
        const matches = extractedText.match(/(\d+([.,]\d{2}))/g);
        if (matches) { const nums = matches.map(m => parseFloat(m.replace(',', '.'))); const validNums = nums.filter(n => n < 50000); possibleTotal = validNums.length > 0 ? Math.max(...validNums) : 0; }
        
        const fallbackFactura: FacturaExtended = {
          id: 'draft-fallback-' + Date.now(), tipo: 'compra', num: 'REVISAR MANUAL', date: DateUtil.today(),
          prov: file.type.includes('image') ? '📷 OCR Emergencia' : `📄 PDF Rescatado`,
          total: String(possibleTotal || 0), base: String(possibleTotal ? (possibleTotal / 1.10).toFixed(2) : 0), tax: String(possibleTotal ? (possibleTotal - (possibleTotal / 1.10)).toFixed(2) : 0),
          paid: false, reconciled: false, source: 'local-rescue', status: 'draft', unidad_negocio: 'REST', file_base64: fileBase64, attachmentSha: Date.now().toString() 
        };

        await onSave({ ...safeData, facturas: [fallbackFactura, ...facturasSeguras] });
        alert(`⚠️ Rescate offline completado. Revisa los totales manualmente.`);
      } catch (fallbackErr) { alert("⚠️ Archivo corrupto o ilegible."); }
    } finally { setIsSyncing(false); }
  };

  /* =======================================================
   * 📧 SIMULADOR EMAIL PARSER
   * ======================================================= */
  const handleFetchEmails = async () => {
    setIsSyncing(true);
    try {
      const webhookURL = localStorage.getItem('gmail_webhook_url');
      if (!webhookURL) {
        alert("⚠️ Configura la URL del Webhook de n8n en ajustes para descargar correos reales.");
        setTimeout(() => setIsSyncing(false), 1500);
        return;
      }
      const res = await proxyFetch(webhookURL, { method: "POST" });
      const newMails = await res.json();
      if (newMails && newMails.length > 0) {
        setEmailInbox(prev => [...newMails, ...prev]);
      }
      alert("✅ Correos sincronizados.");
    } catch (e) {
      alert("⚠️ Error conectando con el servidor de correo.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleParseEmail = (emailId: string) => {
    setEmailInbox(prev => prev.filter(e => e.id !== emailId));
    alert("📥 Correo procesado. El PDF adjunto ha pasado a la bandeja de Conciliación.");
  };

  /* =======================================================
   * ⚙️ LÓGICA DE NEGOCIO Y GUARDADO
   * ======================================================= */
  const handleConfirmAuditoriaIA = async (draftId: string) => {
    try {
      const newData = { ...safeData, facturas: [...facturasSeguras], albaranes: [...albaranesSeguros] };
      const draftIdx = newData.facturas.findIndex(f => f.id === draftId);
      const audit = draftsIA.find(d => d.id === draftId);
      if (draftIdx === -1 || !audit) return;

      let unitToAssign: BusinessUnit = 'REST'; 
      if (audit.candidatos && audit.candidatos.length > 0) {
        const idsVincular = audit.candidatos.map((a: any) => a.id);
        newData.albaranes = newData.albaranes.map(a => idsVincular.includes(a.id) ? { ...a, invoiced: true } : a);
        (newData.facturas[draftIdx] as FacturaExtended).albaranIdsArr = idsVincular;
        unitToAssign = (audit.candidatos[0] as any).unitId || 'REST';
      }

      (newData.facturas[draftIdx] as FacturaExtended).status = 'approved'; 
      newData.facturas[draftIdx].unidad_negocio = unitToAssign; 
      await onSave(newData);
    } catch (error) {
      console.error("Error al confirmar IA:", error);
    }
  };

  const handleDiscardDraftIA = async (id: string) => {
    if (!window.confirm("¿Eliminar este borrador permanentemente?")) return;
    await onSave({ ...safeData, facturas: facturasSeguras.filter(f => f.id !== id) });
  };

  // 📦 Agrupación manual de albaranes optimizada (Protegido contra strings vacíos)
  const pendingGroups = useMemo(() => {
    try {
      const byMonth: Record<string, { name: string; groups: Record<string, any> }> = {};
      const q = superNorm(deferredSearch);

      albaranesSeguros.forEach(a => {
        const aDate = a?.date || '';
        if (a?.invoiced || typeof aDate !== 'string' || !aDate.startsWith(year.toString())) return;
        
        const itemUnit = (a as any).unitId || 'REST';
        if (selectedUnit !== 'ALL' && itemUnit !== selectedUnit) return;
        
        const owner = (mode === 'proveedor' ? a?.prov : a?.socio) || 'Arume';
        if (q && !superNorm(owner).includes(q) && !superNorm(a?.num || '').includes(q)) return;

        const mk = typeof aDate === 'string' && aDate.length >= 7 ? aDate.substring(0, 7) : null; 
        if (!mk) return;

        if (!byMonth[mk]) {
          const parts = mk.split('-'); 
          const y = parts[0] || '0000';
          const m = parts[1] ? parseInt(parts[1]) : 1;
          const names = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
          byMonth[mk] = { name: `${names[m] || 'Mes'} ${y}`, groups: {} };
        }
        const groupKey = `${superNorm(owner)}_${itemUnit}`;
        if (!byMonth[mk].groups[groupKey]) byMonth[mk].groups[groupKey] = { label: owner, unitId: itemUnit, t: 0, ids: [], count: 0 };
        byMonth[mk].groups[groupKey].t += (Num.parse(a?.total) || 0); 
        byMonth[mk].groups[groupKey].count += 1; 
        byMonth[mk].groups[groupKey].ids.push(a?.id);
      });
      return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
    } catch (error) {
      console.error("Error agrupando albaranes:", error);
      return [];
    }
  }, [albaranesSeguros, year, mode, deferredSearch, selectedUnit]);

  const handleConfirmManualInvoice = async () => {
    if (!modalForm.num.trim() || modalForm.selectedAlbs.length === 0) return;
    const newData = { ...safeData, albaranes: [...albaranesSeguros], facturas: [...facturasSeguras] };
    let totalFactura = 0;
    
    newData.albaranes = newData.albaranes.map(a => {
      if (modalForm.selectedAlbs.includes(a.id)) { totalFactura += Num.parse(a.total) || 0; return { ...a, invoiced: true }; } return a;
    });

    const taxRate = 0.10; 
    const baseObj = totalFactura / (1 + taxRate);
    const taxObj = totalFactura - baseObj;

    newData.facturas.unshift({
      id: 'fac-' + Date.now(), tipo: mode === 'proveedor' ? 'compra' : 'venta', num: modalForm.num, date: modalForm.date,
      prov: mode === 'proveedor' ? (selectedGroup?.label || '') : 'Varios', cliente: mode === 'socio' ? (selectedGroup?.label || '') : 'Arume',
      total: String(Num.round2(totalFactura)), base: String(Num.round2(baseObj)), tax: String(Num.round2(taxObj)), albaranIdsArr: modalForm.selectedAlbs,
      paid: false, reconciled: false, source: 'manual-group', status: 'approved', unidad_negocio: modalForm.unitId || 'REST' 
    } as any);

    await onSave(newData); setSelectedGroup(null);
  };

  const handleTogglePago = async (id: string) => {
    const newData = { ...safeData, facturas: [...facturasSeguras] };
    const idx = newData.facturas.findIndex(f => f.id === id);
    if (idx !== -1) {
      if (newData.facturas[idx].reconciled) return alert("🔒 ACCIÓN DENEGADA: Factura conciliada por el banco.");
      newData.facturas[idx].paid = !newData.facturas[idx].paid;
      newData.facturas[idx].status = newData.facturas[idx].paid ? 'paid' : 'approved';
      await onSave(newData);
    }
  };

  const handleDeleteFactura = async (id: string) => {
    const fac = facturasSeguras.find(f => f.id === id); 
    if (!fac) return;
    if (fac.reconciled) return alert("⚠️ No puedes borrar una factura validada por el Banco.");
    if (!window.confirm(`🛑 ¿Eliminar DEFINITIVAMENTE la factura ${fac.num || 'sin número'}?`)) return;
    
    const newData = { ...safeData, facturas: facturasSeguras.filter(f => f.id !== id), albaranes: [...albaranesSeguros] };
    const ids = fac.albaranIdsArr || [];
    newData.albaranes = newData.albaranes.map(a => ids.includes(a.id) ? { ...a, invoiced: false } : a);
    await onSave(newData);
  };

  const handleExportGestoria = () => {
    const q = exportQuarter; const y = year; const startMonth = (q - 1) * 3 + 1; const endMonth = q * 3;
    const filtered = facturasSeguras.filter(f => {
      const fDate = f?.date || '';
      return f.status !== 'draft' && f.tipo !== 'caja' && (f as any).tipo !== 'banco' && 
             (selectedUnit === 'ALL' || f.unidad_negocio === selectedUnit) && 
             (typeof fDate === 'string' && fDate.startsWith(y.toString())) && 
             Number(fDate.split('-')[1]) >= startMonth && 
             Number(fDate.split('-')[1]) <= endMonth;
    });
    
    if (filtered.length === 0) return alert("No hay facturas en este periodo para la unidad seleccionada.");

    const rows = filtered.map(f => {
      const total = Math.abs(Num.parse(f.total) || 0); 
      const base = Num.parse(f.base) || Num.round2(total / 1.10); 
      const tax = Num.parse(f.tax) || Num.round2(total - base);
      return { 'FECHA': f.date || '', 'Nº FACTURA': f.num || '', 'PROVEEDOR/CLIENTE': f.prov || f.cliente || '—', 'UNIDAD NEGOCIO': BUSINESS_UNITS.find(u => u.id === f.unidad_negocio)?.name || 'Restaurante', 'BASE IMPONIBLE': Num.fmt(base), 'IVA': Num.fmt(tax), 'TOTAL': Num.fmt(total), 'ESTADO': f.paid ? 'PAGADA' : 'PENDIENTE', 'CONCILIADA': f.reconciled ? 'SÍ' : 'NO' };
    });
    const ws = XLSX.utils.json_to_sheet(rows); 
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Facturas"); 
    XLSX.writeFile(wb, `Gestoria_Arume_${y}_Q${q}_${selectedUnit}.xlsx`); setIsExportModalOpen(false);
  };

  const handleDownloadFile = (f: FacturaExtended) => {
    if (!f || !f.file_base64) return alert('El PDF original no está disponible.');
    try {
        const a = document.createElement('a');
        a.href = f.file_base64;
        a.download = `${superNorm(f.prov||'factura')}_${f.num||'SN'}.pdf`;
        a.click();
    } catch(e) {
        alert("Error al descargar el archivo");
    }
  };

  /* =======================================================
   * 🎨 RENDERIZADO AISLADO
   * ======================================================= */
  const renderPendingGroups = () => {
    if (!pendingGroups || pendingGroups.length === 0) {
      return (
        <div className="py-20 flex flex-col items-center justify-center opacity-60 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4"><Package className="w-8 h-8 text-slate-300" /></div>
          <p className="text-slate-500 font-black text-sm uppercase tracking-widest">No hay albaranes sueltos</p>
        </div>
      );
    }
    
    return pendingGroups.map(([mk, dataGroup]) => (
      <div key={mk} className="mb-6 animate-fade-in">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 px-2 border-b border-slate-100 pb-2">{dataGroup.name}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.values(dataGroup.groups || {}).map((g: any) => {
            const unitConfig = BUSINESS_UNITS.find(u => u.id === g.unitId);
            return (
              <div key={g.label + g.unitId} onClick={() => { setSelectedGroup({ label: g.label, ids: g.ids, unitId: g.unitId }); setModalForm({ num: '', date: DateUtil.today(), selectedAlbs: [...g.ids], unitId: g.unitId }); }} className="flex justify-between items-center p-5 bg-white rounded-2xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition cursor-pointer group">
                <div className="min-w-0">
                  <p className="font-black text-slate-800 group-hover:text-indigo-600 transition flex items-center gap-2 truncate">{g.label}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {unitConfig && <span className={cn("text-[8px] px-2 py-0.5 rounded-md uppercase tracking-wider font-black", unitConfig.bg, unitConfig.color)}>{unitConfig.name.split(' ')[0]}</span>}
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-[9px] font-bold">{g.count} Albaranes</span>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <p className="font-black text-slate-900 text-xl">{Num.fmt(g.t)}</p>
                  <p className="text-[9px] font-black text-indigo-400 group-hover:underline mt-1 flex items-center justify-end gap-1">CERRAR MANUAL <ArrowRight className="w-3 h-3" /></p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ));
  };

  /* =======================================================
   * 🎨 RENDER PRINCIPAL
   * ======================================================= */
  return (
    <div 
      className="dropzone-area animate-fade-in space-y-6 pb-24 min-h-screen relative max-w-[1600px] mx-auto"
      onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
    >
      {/* OVERLAY DE DROP PROTEGIDO Y NO BLOQUEANTE */}
      <AnimatePresence>
        {isDragging && (
          <motion.div data-test-id="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] pointer-events-none">
            <div className="absolute inset-0 bg-indigo-600/10 backdrop-blur-sm" />
            <div className="absolute inset-4 md:inset-8 border-4 border-dashed border-indigo-400 rounded-[3rem] flex items-center justify-center bg-indigo-50/50 pointer-events-none">
              <div className="text-center bg-white p-8 rounded-3xl shadow-xl pointer-events-none">
                <FileDown className="w-16 h-16 text-indigo-500 mx-auto mb-4 animate-bounce" />
                <p className="text-3xl font-black text-indigo-900">Suelta tu Factura aquí</p>
                <p className="text-sm text-indigo-500 font-bold mt-2 uppercase tracking-widest">Solo PDF o Imágenes</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* 🚀 HEADER COMPACTO Y MODERNO */}
      <header className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 md:p-8 flex flex-col lg:flex-row justify-between gap-4 relative z-10">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tighter">Facturas · INVØYS PRO</h2>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Inbox · Conciliación 3-Way Match</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleFetchEmails} disabled={isSyncing} className="px-5 py-2.5 rounded-xl text-xs font-black bg-blue-50 text-blue-600 hover:bg-blue-100 transition flex items-center gap-2 shadow-sm border border-blue-200">
            {isSyncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Mail className="w-4 h-4" />} SYNC GMAIL
          </button>
          
          <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf, image/*" onChange={(e) => { if (e.target.files && e.target.files[0]) { processLocalFile(e.target.files[0]); e.target.value = ''; } }} />
          <button onClick={() => fileInputRef.current?.click()} className="px-5 py-2.5 rounded-xl text-xs font-black bg-indigo-600 text-white hover:bg-indigo-700 transition flex items-center gap-2 shadow-md">
            <UploadCloud className="w-4 h-4" /> SUBIR PDF
          </button>
          
          <button onClick={() => setIsExportModalOpen(true)} className="px-4 py-2.5 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 transition flex items-center gap-2 shadow-md">
            <Download className="w-4 h-4" /> EXPORT
          </button>
        </div>
      </header>

      {/* 🚀 TOOLBAR STICKY (Filtros e Inputs) */}
      <div className="sticky top-2 z-40">
        <div className={cn("bg-white/95 backdrop-blur-md px-4 py-3 rounded-[2rem] shadow-md border border-slate-200")}>
          <div className="flex flex-col xl:flex-row items-center justify-between gap-3">
            
            {/* TABS DE VISTA */}
            <div className="flex items-center bg-slate-100 p-1.5 rounded-2xl w-full xl:w-auto overflow-x-auto no-scrollbar">
              <button onClick={() => setActiveTab('pend')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition whitespace-nowrap", activeTab === 'pend' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                📦 Agrupar Albaranes
              </button>
              <button onClick={() => setActiveTab('hist')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition whitespace-nowrap", activeTab === 'hist' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                💰 Facturas Oficiales
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                <button onClick={() => setMode('proveedor')} className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition", mode === 'proveedor' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Prov</button>
                <button onClick={() => setMode('socio')} className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition", mode === 'socio' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700")}>Socio</button>
              </div>

              <select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value as any)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-black outline-none text-slate-700 shadow-sm">
                <option value="ALL">Todas las unidades</option>
                <option value="REST">Restaurante</option>
                <option value="DLV">Catering</option>
                <option value="SHOP">Tienda</option>
                <option value="CORP">Socios/Corp</option>
              </select>

              <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-sm">
                <button className="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded-l-xl transition" onClick={() => setYear(y => y - 1)}><ChevronLeft className="w-4 h-4"/></button>
                <span className="px-2 text-xs font-black">{year}</span>
                <button className="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded-r-xl transition" onClick={() => setYear(y => y + 1)}><ChevronRight className="w-4 h-4"/></button>
              </div>

              <div className="relative flex-1 md:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar proveedor, nº o ref OCR..." className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold outline-none focus:ring-2 ring-indigo-500/20 shadow-sm transition" />
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* 🚀 LAYOUT GRID (Inbox IA Derecha / Contenido Izquierda) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 relative z-10">
        
        {/* ZONA IZQUIERDA: Listas Principales */}
        <section className="xl:col-span-8 space-y-4">
          {activeTab === 'pend' ? renderPendingGroups() : (
            <InvoicesList facturas={facturasSeguras} searchQ={deferredSearch} selectedUnit={selectedUnit} mode={mode} filterStatus={filterStatus} year={year} businessUnits={BUSINESS_UNITS} sociosReales={SOCIOS_REALES_NAMES} superNorm={superNorm} onOpenDetail={setSelectedInvoice as any} onTogglePago={handleTogglePago} onDelete={handleDeleteFactura} />
          )}
        </section>

        {/* ZONA DERECHA: Inbox Múltiple (Email + IA) */}
        <aside className="xl:col-span-4 space-y-6">
          <div className="sticky top-24 space-y-6">
            
            {/* INBOX CORREO */}
            {emailInbox.length > 0 && (
              <div className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm">
                <h4 className="text-sm font-black text-slate-800 mb-1 flex items-center gap-2"><Inbox className="w-4 h-4 text-blue-500"/> Correos Recibidos</h4>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pendientes de escanear OCR</p>
                <div className="mt-4 space-y-2">
                  {emailInbox.map(mail => (
                    <div key={mail.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl hover:border-blue-300 transition group">
                      <div className="flex justify-between items-start">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">{mail.from}</p>
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">{mail.subject}</p>
                        </div>
                        <span className="text-[9px] font-black text-slate-400">{mail.date}</span>
                      </div>
                      <button onClick={() => handleParseEmail(mail.id)} className="w-full mt-3 bg-blue-50 text-blue-600 font-black text-[10px] uppercase py-2 rounded-lg hover:bg-blue-600 hover:text-white transition flex items-center justify-center gap-2">
                        <Zap className="w-3 h-3"/> Extraer PDF con IA
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* INBOX IA (Conciliador 3-Way Matching) */}
            {draftsIA.length > 0 ? (
              <div className="bg-indigo-50/50 p-5 rounded-[2rem] border border-indigo-100 shadow-inner">
                <h4 className="text-sm font-black text-slate-800 mb-1 flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-500"/> Borradores 3-WAY MATCH ({draftsIA.length})</h4>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Facturas vs Albaranes</p>
                <div className="mt-4 space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-1">
                  {draftsIA.map(d => (
                    <div key={d.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-300 transition group">
                      <div className="flex justify-between items-start mb-2">
                        <div className="min-w-0">
                          <span className="font-black text-slate-800 block truncate text-sm">{d.prov || 'Desconocido'}</span>
                          <span className="text-[10px] text-slate-400 font-bold">{d.date} · Ref: {d.num}</span>
                        </div>
                        <button onClick={() => handleDiscardDraftIA(d.id)} className="text-slate-300 hover:text-rose-500 transition p-1"><Trash2 className="w-4 h-4"/></button>
                      </div>
                      <div className="flex justify-between items-end mt-2">
                        <span className="text-xl font-black text-slate-900">{Num.fmt(d.total)}</span>
                        {d.cuadraPerfecto ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border border-emerald-100">Cuadra Exacto</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest bg-amber-50 text-amber-600 border border-amber-100">Descuadre {Num.fmt(d.diferencia)}</span>
                        )}
                      </div>
                      <button onClick={() => handleConfirmAuditoriaIA(d.id)} className="w-full mt-3 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-indigo-700 transition">
                        Confirmar y Vincular
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-8 text-center opacity-60">
                <FileText className="w-8 h-8 mx-auto text-slate-300 mb-3" />
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Sin Borradores</p>
                <p className="text-[10px] text-slate-400 mt-2 font-medium">Sube una factura al Dropzone para que la IA la procese.</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* MODALES MANUALES */}
      <AnimatePresence>
        {isExportModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex justify-center items-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative z-10">
              <h3 className="text-xl font-black text-slate-800 mb-2">Exportar Trimestre</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">Generar Excel para Gestoría</p>
              <div className="space-y-4">
                <div><label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Año Fiscal</label><input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-black border-0 outline-none" /></div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Trimestre</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map(q => (<button key={q} onClick={() => setExportQuarter(q)} className={cn("py-3 rounded-xl text-xs font-black transition", exportQuarter === q ? "bg-indigo-600 text-white shadow-lg" : "bg-slate-100 text-slate-400 hover:bg-slate-200")}>Q{q}</button>))}
                  </div>
                </div>
                <div className="pt-4"><button onClick={handleExportGestoria} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-emerald-700 active:scale-95 transition flex justify-center items-center gap-2"><Download className="w-4 h-4" /> DESCARGAR EXCEL</button><button onClick={() => setIsExportModalOpen(false)} className="w-full text-slate-400 text-xs font-bold py-3 hover:text-slate-600 mt-2">Cancelar</button></div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedGroup && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex justify-center items-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white w-full max-w-2xl rounded-[3rem] p-6 md:p-8 shadow-2xl relative z-10 flex flex-col max-h-[90vh]">
              <button onClick={() => setSelectedGroup(null)} className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-rose-100 hover:text-rose-500 transition"><X className="w-5 h-5"/></button>
              <div className="border-b border-slate-100 pb-6 mb-6 flex flex-col md:flex-row justify-between md:items-end gap-4 pr-12">
                <div>
                  <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1">Cierre Manual de Mes</p>
                  <h3 className="text-2xl md:text-3xl font-black text-slate-800 leading-none">{selectedGroup.label}</h3>
                </div>
                <button onClick={() => { const allIds = selectedGroup.ids; setModalForm(p => ({...p, selectedAlbs: p.selectedAlbs.length === allIds.length ? [] : allIds })) }} className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-600 bg-slate-100 px-4 py-2 rounded-xl hover:bg-slate-200 transition shrink-0"><CheckSquare className="w-4 h-4" />{modalForm.selectedAlbs.length === selectedGroup.ids.length ? 'Desmarcar Todos' : 'Marcar Todos'}</button>
              </div>
              <div className="space-y-2 flex-1 overflow-y-auto pr-2 custom-scrollbar bg-slate-50/50 rounded-3xl p-4 border border-slate-100">
                {(albaranesSeguros).filter(a => selectedGroup.ids.includes(a.id)).map(a => (
                  <label key={a.id} className={cn("flex justify-between items-center p-4 rounded-2xl cursor-pointer transition-all border", modalForm.selectedAlbs.includes(a.id) ? "bg-white border-indigo-200 shadow-md" : "bg-transparent border-transparent hover:bg-white")}>
                    <div className="flex items-center gap-4">
                      <div className="relative flex items-center justify-center"><input type="checkbox" checked={modalForm.selectedAlbs.includes(a.id)} onChange={(e) => { const newSelected = e.target.checked ? [...modalForm.selectedAlbs, a.id] : modalForm.selectedAlbs.filter(id => id !== a.id); setModalForm({ ...modalForm, selectedAlbs: newSelected }); }} className="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer accent-indigo-600" /></div>
                      <div><p className="font-bold text-slate-800 text-sm">{a.date}</p><p className="text-[10px] font-mono text-slate-400 mt-0.5">Ref: {a.num || 'S/N'}</p></div>
                    </div>
                    <p className="font-black text-slate-900 text-lg">{Num.fmt(a.total)}</p>
                  </label>
                ))}
              </div>
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl">
                  <div><span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Total de la Factura</span><span className="text-xs text-indigo-400 font-bold bg-indigo-500/20 px-2 py-1 rounded-lg">{modalForm.selectedAlbs.length} albaranes</span></div>
                  <span className="text-4xl md:text-5xl font-black text-emerald-400 tracking-tighter">{Num.fmt(modalForm.selectedAlbs.reduce((acc, id) => { const alb = albaranesSeguros.find(a => a.id === id); return acc + (Num.parse(alb?.total) || 0); }, 0))}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mode === 'socio' ? (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Responsable del Pago (Socio)</label>
                      <select value={modalForm.num.startsWith('SOCIO-') ? modalForm.num.split('-')[1] : ''} onChange={(e) => { const socio = e.target.value; setModalForm({ ...modalForm, num: `LIQ-${socio}-${modalForm.date.replace(/-/g,'')}` }); setSelectedGroup(prev => prev ? { ...prev, label: socio } : null); }} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 ring-indigo-500/20 transition cursor-pointer">
                        <option value="">-- Selecciona Socio --</option>{SOCIOS_REALES_NAMES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Nº Factura Oficial del Proveedor</label>
                      <input type="text" value={modalForm.num} onChange={(e) => setModalForm({ ...modalForm, num: e.target.value })} placeholder="Ej: F-2026/012" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 ring-indigo-500/20 transition" />
                    </div>
                  )}
                  <div><label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Fecha de Emisión</label><input type="date" value={modalForm.date} onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 ring-indigo-500/20 transition cursor-pointer" /></div>
                </div>
                <button onClick={handleConfirmManualInvoice} disabled={modalForm.selectedAlbs.length === 0} className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-sm shadow-xl shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition flex justify-center items-center gap-2">GUARDAR Y CERRAR ALBARANES <CheckCircle2 className="w-5 h-5"/></button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🚀 MODAL DE DETALLE DE FACTURA PROTEGIDO */}
      {selectedInvoice && typeof selectedInvoice === 'object' && selectedInvoice.id && (
        <InvoiceDetailModal 
          factura={selectedInvoice as any} 
          albaranes={albaranesSeguros} 
          businessUnits={BUSINESS_UNITS} 
          mode={mode} 
          onClose={() => setSelectedInvoice(null)} 
          onDownloadFile={handleDownloadFile} 
        />
      )}
    </div>
  );
};
