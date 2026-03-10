import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  FileText, Search, ChevronLeft, ChevronRight, Zap, Users, Building2, Package, CheckCircle2, Clock, Trash2, AlertCircle, Link as LinkIcon, Mail, ArrowRight, X, RefreshCw, Download, Bell, CheckSquare, Hotel, ShoppingBag, Layers, UploadCloud, FileDown, FileArchive, Mic, Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { AppData, Factura, Albaran, Socio } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { NotificationService } from '../services/notifications';
import { GoogleGenAI } from "@google/genai";

// 🚀 IMPORTAMOS LOS COMPONENTES AISLADOS
import { InvoicesList } from './InvoicesList';
import { InvoiceDetailModal } from './InvoiceDetailModal';

export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

// 🛡️ TIPADO EXTENDIDO
export type FacturaExtended = Factura & {
  status?: 'draft' | 'approved' | 'paid';
  file_base64?: string;
  albaranIdsArr?: string[];
  fecha_pago?: string;
  source?: string;
  dueDate?: string;
  candidatos?: any[];
  sumaAlbaranes?: number;
  diferencia?: number;
  cuadraPerfecto?: boolean;
};

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'DLV', name: 'Catering Hoteles', icon: Hotel, color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'CORP', name: 'Socios / Corp', icon: Users, color: 'text-slate-600', bg: 'bg-slate-100' },
];

interface InvoicesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

// 🛡️ UTILIDADES SEGURAS (Recomendación Copilot)
export const superNorm = (s: string | undefined | null) => {
  if (!s || typeof s !== 'string') return 'desconocido';
  try {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(s\.?l\.?|s\.?a\.?|s\.?l\.?u\.?|s\.?c\.?p\.?)\b/gi, '').replace(/[^a-z0-9]/g, '').trim();
  } catch (e) { return 'desconocido'; }
};

const safeJSON = (str: string) => {
  try {
    const match = str.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch { return {}; }
};

export const InvoicesView = ({ data, onSave }: InvoicesViewProps) => {
  const safeData = data || {};
  const facturasSeguras = (Array.isArray(safeData.facturas) ? safeData.facturas : []) as FacturaExtended[];
  const albaranesSeguros = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  const sociosSeguros = (Array.isArray(safeData.socios) ? safeData.socios : []) as Socio[];
  const SOCIOS_REALES = sociosSeguros.filter(s => s?.active).map(s => s.n);

  const [activeTab, setActiveTab] = useState<'pend' | 'hist'>('pend');
  const [mode, setMode] = useState<'proveedor' | 'socio'>('proveedor');
  const [year, setYear] = useState(new Date().getFullYear());
  const [searchQ, setSearchQ] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid' | 'reconciled'>('all');
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL');
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportQuarter, setExportQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0); // 🛡️ Contador para evitar parpadeos de D&D

  const [selectedGroup, setSelectedGroup] = useState<{ label: string; ids: string[], unitId: BusinessUnit } | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<FacturaExtended | null>(null);
  const [modalForm, setModalForm] = useState({ num: '', date: DateUtil.today(), selectedAlbs: [] as string[], unitId: 'REST' as BusinessUnit });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 🎙️ ESTADOS VOSK
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  /* =======================================================
   * 🛡️ DRAG & DROP BLINDADO (Solución Fuga de Memoria y Parpadeos)
   * ======================================================= */
  useEffect(() => {
    const blockDefault = (e: DragEvent) => { 
      // Solo previene el comportamiento por defecto si NO estamos arrastrando sobre nuestra zona habilitada
      if (!(e.target as HTMLElement)?.closest(".dropzone-area")) { 
        e.preventDefault(); 
        e.stopPropagation(); 
      } 
    };

    const cancelDrag = () => { 
      dragCounter.current = 0; 
      setIsDragging(false); 
    };
    
    window.addEventListener('dragover', blockDefault); 
    window.addEventListener('drop', blockDefault); 
    window.addEventListener('mouseout', (e) => { 
      // Si el ratón sale de la ventana del navegador, cancelamos el drag
      if (!e.relatedTarget && !e.toElement) cancelDrag(); 
    });
    
    return () => { 
      window.removeEventListener('dragover', blockDefault); 
      window.removeEventListener('drop', blockDefault); 
      window.removeEventListener('mouseout', cancelDrag); 
    };
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => { 
    e.preventDefault(); 
    dragCounter.current++; 
    if (!isDragging) setIsDragging(true); 
  }, [isDragging]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => { 
    e.preventDefault(); 
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => { 
    e.preventDefault(); 
    dragCounter.current--; 
    if (dragCounter.current <= 0) { 
      setIsDragging(false); 
      dragCounter.current = 0; 
    } 
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => { 
    e.preventDefault(); 
    dragCounter.current = 0; 
    setIsDragging(false); 
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { 
      const file = e.dataTransfer.files[0]; 
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        processLocalFile(file); 
      } else {
        alert("⚠️ Formato no soportado. Solo se permiten archivos PDF o imágenes (JPG, PNG)."); 
      }
    } 
  }, []);

  /* =======================================================
   * 🧠 AUDITORÍA DE IA MEMOIZADA
   * ======================================================= */
  const draftsIA = useMemo(() => {
    try {
      return facturasSeguras.filter(f => f.status === 'draft').map(draft => {
        const draftDate = draft.date || DateUtil.today();
        const mesDraft = draftDate.substring(0, 7);
        const provDraftNormalizado = superNorm(draft.prov); 
        
        const albaranesCandidatos = albaranesSeguros.filter(a => 
          !a?.invoiced && superNorm(a?.prov) === provDraftNormalizado && (a?.date || '').startsWith(mesDraft)
        );

        const sumaAlbaranes = albaranesCandidatos.reduce((acc, a) => acc + (Num.parse(a?.total) || 0), 0);
        const totalDraft = Num.parse(draft.total) || 0;
        const diferencia = Math.abs(sumaAlbaranes - Math.abs(totalDraft));
        const cuadraPerfecto = diferencia < 0.05 && albaranesCandidatos.length > 0;

        return { ...draft, candidatos: albaranesCandidatos, sumaAlbaranes, diferencia, cuadraPerfecto };
      });
    } catch (e) { return []; }
  }, [facturasSeguras, albaranesSeguros]);

  /* =======================================================
   * 🤖 MOTOR DE LECTURA (Gemini -> Tesseract -> PDF.js)
   * ======================================================= */
  const processLocalFile = async (file: File) => {
    const apiKey = localStorage.getItem('gemini_api_key');
    setIsSyncing(true); 

    try {
      if (!apiKey) throw new Error("NO_API_KEY");

      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); 
        reader.onload = () => resolve(reader.result as string); 
        reader.onerror = reject; 
        reader.readAsDataURL(file);
      });
      const soloBase64 = fileBase64.split(',')[1];

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Analiza esta factura/albarán. Devuelve SOLO un JSON estricto: { "proveedor": "Nombre de la empresa", "num": "Número", "fecha": "YYYY-MM-DD", "total": 150.50, "base": 124.38, "iva": 26.12 }`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: soloBase64, mimeType: file.type } }] }],
        config: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const rawJson = safeJSON(response.text || "");

      const nuevaFacturaIA: FacturaExtended = {
        id: 'draft-local-' + Date.now(),
        tipo: 'compra', // 🛡️ Tipado estricto
        num: rawJson.num || 'S/N',
        date: rawJson.fecha || DateUtil.today(),
        prov: rawJson.proveedor || 'Proveedor Desconocido',
        total: Num.parse(rawJson.total || 0),
        base: Num.parse(rawJson.base || 0),
        tax: Num.parse(rawJson.iva || 0),
        paid: false, reconciled: false, source: 'email-ia', status: 'draft', unidad_negocio: 'REST', file_base64: fileBase64 
      };

      await onSave({ ...safeData, facturas: [nuevaFacturaIA, ...facturasSeguras] });
      alert("✅ Factura procesada por IA. Búscala en los borradores.");

    } catch (e) {
      console.warn("⚠️ Gemini falló. Activando Fallback Local (OCR/PDF)...");
      try {
        let extractedText = ""; let possibleTotal = 0;
        const fileBase64 = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file); });

        if (file.type.includes('image')) {
           const tesseractModule = await import('tesseract.js'); const Tesseract = tesseractModule.default || tesseractModule;
           const { data: { text } } = await Tesseract.recognize(file, 'spa'); extractedText = text;
        } else if (file.type === 'application/pdf') {
           const pdfjsModule = await import('pdfjs-dist'); const pdfjsLib = pdfjsModule.default || pdfjsModule;
           pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
           const arrayBuffer = await file.arrayBuffer(); const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
           for (let i = 1; i <= pdfDoc.numPages; i++) { const page = await pdfDoc.getPage(i); const textContent = await page.getTextContent(); extractedText += textContent.items.map((item: any) => item.str).join(' ') + '\n'; }
        } 
        
        const matches = extractedText.match(/(\d+([.,]\d{2}))/g);
        if (matches) { const nums = matches.map(m => parseFloat(m.replace(',', '.'))); const validNums = nums.filter(n => n < 50000); possibleTotal = validNums.length > 0 ? Math.max(...validNums) : 0; }
        
        const fallbackFactura: FacturaExtended = {
          id: 'draft-fallback-' + Date.now(), tipo: 'compra', num: 'REVISAR MANUAL', date: DateUtil.today(),
          prov: file.type.includes('image') ? '📷 OCR Emergencia' : `📄 PDF Rescatado`,
          total: possibleTotal || 0, base: possibleTotal ? Num.round2(possibleTotal / 1.10) : 0, tax: possibleTotal ? Num.round2(possibleTotal - (possibleTotal / 1.10)) : 0,
          paid: false, reconciled: false, source: 'email-ia', status: 'draft', unidad_negocio: 'REST', file_base64: fileBase64 
        };

        await onSave({ ...safeData, facturas: [fallbackFactura, ...facturasSeguras] });
        alert(`⚠️ Rescate completado con visor manual (El límite de IA se agotó).`);
      } catch (fallbackErr) { alert("⚠️ Archivo corrupto o ilegible."); }
    } finally { setIsSyncing(false); }
  };

  /* =======================================================
   * 🎙️ INTEGRACIÓN VOSK LOCAL PARA FACTURAS
   * ======================================================= */
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mr; audioChunksRef.current = [];
      mr.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        await processAudioWithVosk(audioBlob);
      };
      mr.start(); setIsRecording(true);
      setTimeout(() => { if (mr.state === 'recording') toggleRecording(); }, 30000); // 30s max
    } catch (err) { alert("⚠️ Necesitas dar permiso al micrófono."); }
  };

  const processAudioWithVosk = async (blob: Blob) => {
    setIsSyncing(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, "factura.webm");
      const voskRes = await fetch("http://localhost:2700/transcribe", { method: "POST", body: formData });
      if (!voskRes.ok) throw new Error("Vosk no responde");
      
      const voskData = await voskRes.json();
      const txt = voskData.text || "";
      
      const matches = txt.match(/(\d+([.,]\d{2})?)/g);
      const possibleTotal = matches ? parseFloat(matches[matches.length - 1].replace(',', '.')) : 0;

      const nuevaFacturaVoz: FacturaExtended = {
        id: 'draft-voice-' + Date.now(), tipo: 'compra', num: 'S/N', date: DateUtil.today(),
        prov: `🎙️ Voz: ${txt.substring(0, 20)}...`, total: possibleTotal, base: Num.round2(possibleTotal / 1.10), tax: Num.round2(possibleTotal - (possibleTotal / 1.10)),
        paid: false, reconciled: false, source: 'email-ia', status: 'draft', unidad_negocio: 'REST'
      };

      await onSave({ ...safeData, facturas: [nuevaFacturaVoz, ...facturasSeguras] });
      alert("✅ Factura dictada por voz guardada en borradores.");
    } catch (e) { alert("⚠️ Error conectando con servidor VOSK local."); } 
    finally { setIsSyncing(false); }
  };

  /* =======================================================
   * ⚙️ LÓGICA DE NEGOCIO (Grupos, Pagos, Borrados)
   * ======================================================= */
  const handleConfirmAuditoriaIA = async (draftId: string) => {
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
  };

  const handleDiscardDraftIA = async (id: string) => {
    if (!window.confirm("¿Eliminar factura leída por IA?")) return;
    await onSave({ ...safeData, facturas: facturasSeguras.filter(f => f.id !== id) });
  };

  const handleExportGestoria = () => {
    const q = exportQuarter; const y = year; const startMonth = (q - 1) * 3 + 1; const endMonth = q * 3;
    const filtered = facturasSeguras.filter(f => f.status !== 'draft' && f.tipo !== 'caja' && (f as any).tipo !== 'banco' && (selectedUnit === 'ALL' || f.unidad_negocio === selectedUnit) && (f.date || '').startsWith(y.toString()) && Number((f.date || '').split('-')[1]) >= startMonth && Number((f.date || '').split('-')[1]) <= endMonth);
    if (filtered.length === 0) return alert("No hay facturas en este periodo.");

    const rows = filtered.map(f => {
      const total = Math.abs(Num.parse(f.total) || 0); const base = Num.parse(f.base) || Num.round2(total / 1.10); const tax = Num.parse(f.tax) || Num.round2(total - base);
      return { 'FECHA': f.date || '', 'Nº FACTURA': f.num || '', 'PROVEEDOR/CLIENTE': f.prov || f.cliente || '—', 'UNIDAD NEGOCIO': BUSINESS_UNITS.find(u => u.id === f.unidad_negocio)?.name || 'Restaurante', 'BASE IMPONIBLE': Num.fmt(base), 'IVA': Num.fmt(tax), 'TOTAL': Num.fmt(total), 'ESTADO': f.paid ? 'PAGADA' : 'PENDIENTE', 'CONCILIADA': f.reconciled ? 'SÍ' : 'NO' };
    });
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Facturas"); XLSX.writeFile(wb, `Gestoria_Arume_${y}_Q${q}_${selectedUnit}.xlsx`); setIsExportModalOpen(false);
  };

  // 📦 Agrupación manual de albaranes optimizada
  const pendingGroups = useMemo(() => {
    const byMonth: Record<string, { name: string; groups: Record<string, any> }> = {};
    albaranesSeguros.forEach(a => {
      if (a?.invoiced || !(a?.date || '').startsWith(year.toString())) return;
      const itemUnit = a.unitId || 'REST';
      if (selectedUnit !== 'ALL' && itemUnit !== selectedUnit) return;
      const owner = (mode === 'proveedor' ? a?.prov : a?.socio) || 'Arume';
      const searchNorm = superNorm(searchQ);
      if (searchQ && !superNorm(owner).includes(searchNorm) && !superNorm(a?.num || '').includes(searchNorm)) return;

      const mk = (a?.date || '').substring(0, 7); if (!mk) return;
      if (!byMonth[mk]) {
        const parts = mk.split('-'); const [y, m] = parts;
        const names = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
        byMonth[mk] = { name: `${names[parseInt(m)]} ${y}`, groups: {} };
      }
      const groupKey = `${superNorm(owner)}_${itemUnit}`;
      if (!byMonth[mk].groups[groupKey]) byMonth[mk].groups[groupKey] = { label: owner, unitId: itemUnit, t: 0, ids: [], count: 0 };
      byMonth[mk].groups[groupKey].t += (Num.parse(a?.total) || 0); byMonth[mk].groups[groupKey].count += 1; byMonth[mk].groups[groupKey].ids.push(a?.id);
    });
    return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
  }, [albaranesSeguros, year, mode, searchQ, selectedUnit]);

  const handleConfirmManualInvoice = async () => {
    if (!modalForm.num.trim() || modalForm.selectedAlbs.length === 0) return;
    const newData = { ...safeData, albaranes: [...albaranesSeguros], facturas: [...facturasSeguras] };
    let totalFactura = 0;
    
    newData.albaranes = newData.albaranes.map(a => {
      if (modalForm.selectedAlbs.includes(a.id)) { totalFactura += Num.parse(a.total) || 0; return { ...a, invoiced: true }; } return a;
    });

    newData.facturas.unshift({
      id: 'fac-' + Date.now(), tipo: mode === 'proveedor' ? 'compra' : 'venta', num: modalForm.num, date: modalForm.date,
      prov: mode === 'proveedor' ? (selectedGroup?.label || '') : 'Varios', cliente: mode === 'socio' ? (selectedGroup?.label || '') : 'Arume',
      total: Num.round2(totalFactura), base: Num.round2(totalFactura/1.10), tax: Num.round2(totalFactura - (totalFactura/1.10)), albaranIdsArr: modalForm.selectedAlbs,
      paid: false, reconciled: false, source: 'manual-group', status: 'approved', unidad_negocio: modalForm.unitId || 'REST' 
    } as any);

    await onSave(newData); setSelectedGroup(null);
  };

  const handleTogglePago = async (id: string) => {
    const newData = { ...safeData, facturas: [...facturasSeguras] };
    const f = newData.facturas.find(x => x.id === id) as FacturaExtended;
    if (f && !f.reconciled) {
      f.paid = !f.paid;
      if (f.paid) { f.status = 'paid'; f.fecha_pago = DateUtil.today(); } else { f.status = 'approved'; f.fecha_pago = undefined; }
      await onSave(newData);
    } else alert("🔒 ACCIÓN DENEGADA: Esta factura ya está conciliada por el banco.");
  };

  const handleDeleteFactura = async (id: string) => {
    const fac = facturasSeguras.find(f => f.id === id); 
    if (!fac || fac.reconciled) return alert("⚠️ No puedes borrar una factura validada por el Banco.");
    if (!window.confirm(`🛑 ¿Eliminar DEFINITIVAMENTE la factura ${fac.num || 'sin número'}?`)) return;
    const newData = { ...safeData, facturas: facturasSeguras.filter(f => f.id !== id), albaranes: [...albaranesSeguros] };
    const ids = fac.albaranIdsArr || [];
    newData.albaranes = newData.albaranes.map(a => ids.includes(a.id) ? { ...a, invoiced: false } : a);
    await onSave(newData);
  };

  return (
    <div 
      className={cn("dropzone-area animate-fade-in space-y-6 pb-24 min-h-screen relative transition-colors duration-300", isDragging && "bg-indigo-50/50")}
      onDragEnter={handleDragEnter} 
      onDragOver={handleDragOver} 
      onDragLeave={handleDragLeave} 
      onDrop={handleDrop}
    >
      {/* OVERLAY DE DROP PROTEGIDO */}
      <AnimatePresence>
        {isDragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[9999] bg-indigo-600/90 backdrop-blur-sm border-[16px] border-dashed border-white/40 flex flex-col items-center justify-center pointer-events-auto transition-opacity duration-300">
            <div className="pointer-events-none flex flex-col items-center justify-center">
              <FileDown className="w-32 h-32 text-white mb-6 animate-bounce" />
              <h2 className="text-5xl font-black text-white tracking-tighter drop-shadow-lg">¡Suelta tu Factura aquí!</h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {draftsIA.length > 0 && (
          <motion.div key="ia-audit" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="bg-slate-900 p-6 md:p-8 rounded-[2.5rem] shadow-2xl border border-slate-800 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-500"></div>
            <h3 className="text-white text-lg font-black flex items-center gap-2 mb-6">
              <Mail className="w-5 h-5 text-purple-400 animate-bounce" /> Inbox de Conciliación <span className="bg-purple-600 text-xs px-2.5 py-0.5 rounded-full">{draftsIA.length}</span>
            </h3>
            <div className="space-y-4">
              {draftsIA.map(d => (
                <div key={d.id} className={cn("bg-slate-800/50 p-5 rounded-3xl border transition-colors", d.cuadraPerfecto ? 'border-emerald-500/50' : 'border-amber-500/50')}>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex-1">
                      <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-1">Lectura OCR del Documento</p>
                      {d.prov.includes('Emergencia') || d.prov.includes('Voz') ? (
                        <h4 className="text-amber-400 font-black text-xl flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {d.prov}</h4>
                      ) : (
                        <h4 className="text-white font-black text-xl">{d.prov}</h4>
                      )}
                      <p className="text-slate-400 text-xs font-mono mt-1">Ref: {d.num} | Fecha: {d.date}</p>
                      <p className="text-3xl font-black text-white mt-3">{Num.fmt(Math.abs(Num.parse(d.total)))}</p>
                    </div>
                    
                    <div className="flex-1 bg-slate-900/80 p-5 rounded-2xl w-full border border-slate-700/50">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Tus Albaranes del Mes ({d.candidatos.length})</span>
                        <span className="text-sm font-black text-white">{Num.fmt(d.sumaAlbaranes)}</span>
                      </div>
                      {d.candidatos.length > 0 ? (
                        <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar pr-2">
                          {d.candidatos.map((c: any) => (
                            <div key={c.id} className="flex justify-between text-xs text-slate-400 border-b border-slate-800/50 pb-1.5">
                              <span>📅 {c.date} - {c.num || 'S/N'}</span><span className="text-slate-200 font-bold">{Num.fmt(c.total)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-rose-400 text-xs font-bold italic py-3 flex items-center gap-2"><AlertCircle className="w-4 h-4"/> No hay albaranes pendientes este mes para este proveedor.</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="mt-5 pt-5 border-t border-slate-700/50 flex flex-wrap gap-3 items-center justify-between">
                    <div>
                      {d.cuadraPerfecto ? <span className="bg-emerald-500/20 text-emerald-400 text-xs font-black px-4 py-1.5 rounded-lg border border-emerald-500/30">✅ CUADRA PERFECTO</span> : <span className="bg-amber-500/20 text-amber-400 text-xs font-black px-4 py-1.5 rounded-lg border border-amber-500/30">⚠️ DESCUADRE: {Num.fmt(d.diferencia)}</span>}
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                      <button type="button" onClick={() => handleConfirmAuditoriaIA(d.id)} className={cn("flex-1 md:flex-none text-white text-xs px-6 py-3 rounded-xl font-black shadow-lg transition active:scale-95", d.cuadraPerfecto ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-600 hover:bg-amber-700')}>
                        {d.cuadraPerfecto ? 'CERRAR Y VINCULAR' : 'IGNORAR DESCUADRE Y CERRAR'}
                      </button>
                      <button type="button" onClick={() => handleDiscardDraftIA(d.id)} className="bg-slate-800 hover:bg-rose-500 text-white p-3 rounded-xl transition"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="p-6 md:p-8 bg-white rounded-[3rem] shadow-sm border border-slate-100 relative z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8">
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <button type="button" onClick={() => setSelectedUnit('ALL')} className={cn("flex-1 md:flex-none px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border flex items-center justify-center gap-1.5", selectedUnit === 'ALL' ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}><Layers className="w-3.5 h-3.5" />Todas</button>
            {BUSINESS_UNITS.map(unit => (
              <button type="button" key={unit.id} onClick={() => setSelectedUnit(unit.id)} className={cn("flex-1 md:flex-none px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border flex items-center justify-center gap-1.5", selectedUnit === unit.id ? `${unit.color.replace('text-', 'bg-')} text-white border-transparent shadow-md` : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}>
                <unit.icon className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{unit.name}</span>
              </button>
            ))}
          </div>
          
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 w-full md:w-auto">
            <button onClick={toggleRecording} className={cn("px-4 py-2.5 rounded-xl text-[10px] font-black flex items-center gap-2 shadow-sm transition-colors whitespace-nowrap", isRecording ? "bg-rose-500 text-white animate-pulse" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50")} title="Dictar factura (Vosk Local)">
               {isRecording ? <Square className="w-3.5 h-3.5"/> : <Mic className="w-3.5 h-3.5"/>} {isRecording ? "DICTANDO..." : "DICTAR"}
            </button>
            <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf, image/*" onChange={(e) => { if (e.target.files && e.target.files[0]) { processLocalFile(e.target.files[0]); e.target.value = ''; } }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isSyncing} className="bg-indigo-50 border border-indigo-100 text-indigo-600 px-5 py-2.5 rounded-xl text-[10px] font-black hover:bg-indigo-100 transition flex items-center gap-2 whitespace-nowrap" title="Sube PDF o Foto"><UploadCloud className="w-4 h-4" /> SUBIR PDF</button>
            <button type="button" onClick={() => setIsExportModalOpen(true)} className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-[10px] font-black hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm"><Download className="w-4 h-4" /></button>
            <div className="flex items-center gap-1 bg-slate-50 p-1.5 rounded-2xl border border-slate-200">
              <button type="button" onClick={() => setMode('proveedor')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all", mode === 'proveedor' ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600")}>Proveedores</button>
              <button type="button" onClick={() => setMode('socio')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all", mode === 'socio' ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600")}>Liquidaciones</button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1.5 bg-slate-100 rounded-[2rem] mb-6">
          <button type="button" onClick={() => setActiveTab('pend')} className={cn("flex-1 py-3.5 rounded-2xl font-black text-xs transition", activeTab === 'pend' ? "bg-white shadow text-indigo-600" : "text-slate-400 hover:bg-slate-200")}>📦 ALBARANES SIN CERRAR</button>
          <button type="button" onClick={() => setActiveTab('hist')} className={cn("flex-1 py-3.5 rounded-2xl font-black text-xs transition", activeTab === 'hist' ? "bg-white shadow text-indigo-600" : "text-slate-400 hover:bg-slate-200")}>💰 FACTURAS CONTABILIZADAS</button>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4 bg-white border border-slate-200 px-4 py-2 rounded-2xl shadow-sm w-full md:w-auto justify-center">
            <button type="button" onClick={() => setYear(year - 1)} className="text-indigo-600 hover:bg-indigo-50 p-1.5 rounded-lg transition"><ChevronLeft className="w-5 h-5" /></button>
            <span className="text-base font-black text-slate-800 w-12 text-center">{year}</span>
            <button type="button" onClick={() => setYear(year + 1)} className="text-indigo-600 hover:bg-indigo-50 p-1.5 rounded-lg transition"><ChevronRight className="w-5 h-5" /></button>
          </div>
          <div className="relative w-full md:w-96 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Buscar nombre o referencia..." className="w-full py-3 pl-11 pr-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:bg-white transition" />
            </div>
          </div>
        </div>

        {activeTab === 'hist' && (
          <div className="flex flex-wrap gap-2 mb-6">
            {[
              { id: 'all', label: 'Todas', color: 'text-slate-500' },
              { id: 'pending', label: '⏳ Pendientes', color: 'text-slate-500' },
              { id: 'paid', label: '✔️ Pagadas Efectivo', color: 'text-emerald-600' },
              { id: 'reconciled', label: '🔗 Pagadas Banco', color: 'text-blue-600' }
            ].map(chip => (
              <button type="button" key={chip.id} onClick={() => setFilterStatus(chip.id as any)} className={cn("px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-wider border transition-all", filterStatus === chip.id ? "bg-slate-800 text-white border-slate-800 shadow-md" : cn("bg-white border-slate-200 hover:bg-slate-50", chip.color))}>{chip.label}</button>
            ))}
          </div>
        )}

        <div className="space-y-4">
          {activeTab === 'pend' ? (
            pendingGroups.length > 0 ? (
              pendingGroups.map(([mk, dataGroup]) => (
                <div key={mk} className="mb-8 animate-fade-in">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 pl-2 border-b border-slate-100 pb-2">{dataGroup.name}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.values(dataGroup.groups).map((g: any) => {
                      const unitConfig = BUSINESS_UNITS.find(u => u.id === g.unitId);
                      return (
                        <div key={g.label + g.unitId} onClick={() => { setSelectedGroup({ label: g.label, ids: g.ids, unitId: g.unitId }); setModalForm({ num: '', date: DateUtil.today(), selectedAlbs: [...g.ids], unitId: g.unitId }); }} className="flex justify-between items-center p-5 bg-white rounded-3xl border border-slate-200 hover:border-indigo-400 hover:shadow-lg transition cursor-pointer group">
                          <div className="min-w-0">
                            <p className="font-black text-slate-800 group-hover:text-indigo-600 transition flex items-center gap-2 truncate">
                              {g.label}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5">
                              {unitConfig && <span className={cn("text-[8px] px-2 py-0.5 rounded-md uppercase tracking-wider font-black", unitConfig.bg, unitConfig.color)}>{unitConfig.name.split(' ')[0]}</span>}
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-[9px] font-bold">{g.count} Albaranes</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            <p className="font-black text-slate-900 text-xl">{Num.fmt(g.t)}</p>
                            <p className="text-[9px] font-black text-indigo-400 group-hover:underline mt-1 flex items-center justify-end gap-1">AGRUPAR <ArrowRight className="w-3 h-3" /></p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-24 flex flex-col items-center justify-center opacity-60 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4"><Package className="w-8 h-8 text-slate-300" /></div>
                <p className="text-slate-500 font-black text-sm uppercase tracking-widest">No hay albaranes sueltos</p>
                <p className="text-xs text-slate-400 mt-1">Todo está cerrado y facturado para estos filtros.</p>
              </div>
            )
          ) : (
            // 🚀 COMPONENTE AISLADO DE HISTORIAL
            <InvoicesList 
              facturas={facturasSeguras} 
              searchQ={searchQ} 
              selectedUnit={selectedUnit} 
              mode={mode} 
              filterStatus={filterStatus} 
              year={year} 
              businessUnits={BUSINESS_UNITS} 
              sociosReales={SOCIOS_REALES} 
              superNorm={superNorm} 
              onOpenDetail={setSelectedInvoice as any} 
              onTogglePago={handleTogglePago} 
              onDelete={handleDeleteFactura} 
            />
          )}
        </div>
      </section>

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
                        <option value="">-- Selecciona Socio --</option>{SOCIOS_REALES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Nº Factura Oficial del Proveedor</label>
                      <input type="text" value={modalForm.num} onChange={(e) => setModalForm({ ...modalForm, num: e.target.value })} placeholder="Ej: F-2026/012" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 ring-indigo-500/20 transition" />
                    </div>
                  )}
                  <div><label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Fecha de Facturación</label><input type="date" value={modalForm.date} onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 ring-indigo-500/20 transition cursor-pointer" /></div>
                </div>
                <button onClick={handleConfirmManualInvoice} disabled={modalForm.selectedAlbs.length === 0} className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-sm shadow-xl shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition flex justify-center items-center gap-2">GUARDAR Y CERRAR ALBARANES <CheckCircle2 className="w-5 h-5"/></button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL DE DETALLE DE FACTURA */}
      {selectedInvoice && (
        <InvoiceDetailModal 
          factura={selectedInvoice} 
          albaranes={albaranesSeguros} 
          businessUnits={BUSINESS_UNITS} 
          mode={mode} 
          onClose={() => setSelectedInvoice(null)} 
          onDownloadFile={handleDownloadFile as any} 
        />
      )}
    </div>
  );
};
