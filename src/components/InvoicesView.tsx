import React, { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react';
import { 
  Search, Plus, Download, Package, AlertTriangle, Check, Clock, Trash2, 
  Building2, ShoppingBag, ListPlus, Users, Hotel, Layers, X, 
  LineChart as LineChartIcon, FileText, Mic, Square, 
  UploadCloud, FileDown, Smartphone, Camera, Loader2, Mail, 
  CheckCircle2, Link as LinkIcon, Inbox, ArrowRight, CheckSquare, 
  Sparkles, ChevronLeft, ChevronRight, Zap, FileArchive, AlertCircle, ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";

// 🛡️ TIPOS CENTRALIZADOS
import { AppData, FacturaExtended, Albaran, EmailDraft, BusinessUnit } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';

// 🚀 SERVICIOS CORE
import { 
  getOfficialProvName, 
  basicNorm, 
  linkAlbaranesToFactura, 
  matchAlbaranesToFactura 
} from '../services/invoicing'; 
import { fetchNewEmails, markEmailAsParsed } from '../services/supabase';

// 🧩 COMPONENTES HIJOS
import { InvoicesList } from './InvoicesList';
import { InvoiceDetailModal } from './InvoiceDetailModal';

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

// Utilidad para extraer JSON de respuestas de IA
const safeJSON = (str: string) => { 
  try { const match = str.match(/\{[\s\S]*\}/); return match ? JSON.parse(match[0]) : {}; } 
  catch { return {}; } 
};

// Comprobación de arrastre de archivos reales
const hasRealFiles = (e: React.DragEvent | DragEvent) => {
  const items = e.dataTransfer?.items;
  if (!items || items.length === 0) return false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') return true;
  }
  return false;
};

// Generador de SHA-256 para evitar duplicados
async function sha256File(file: File) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* =======================================================
 * 🎨 COMPONENTE: Flechas de Conexión Inteligentes
 * ======================================================= */
const ConnectionLine = ({ sourceId, targetId, status = 'default' }: { sourceId: string; targetId: string; status?: 'perfect' | 'warning' | 'default' }) => {
  const [coords, setCoords] = useState<{x1: number, y1: number, x2: number, y2: number} | null>(null);

  const colors = {
    perfect: { line: '#10b981', dot: '#059669', glow: '#34d399' }, 
    warning: { line: '#f59e0b', dot: '#d97706', glow: '#fbbf24' }, 
    default: { line: '#6366f1', dot: '#4f46e5', glow: '#818cf8' }  
  };
  const theme = colors[status as keyof typeof colors];

  useEffect(() => {
    const updateCoords = () => {
      const sourceEl = document.getElementById(sourceId);
      const targetEl = document.getElementById(targetId);
      
      if (sourceEl && targetEl) {
        const sRect = sourceEl.getBoundingClientRect();
        const tRect = targetEl.getBoundingClientRect();
        
        setCoords({
          x1: sRect.right,
          y1: sRect.top + (sRect.height / 2),
          x2: tRect.left,
          y2: tRect.top + (tRect.height / 2)
        });
      }
    };

    const timer = setTimeout(updateCoords, 150);
    window.addEventListener('resize', updateCoords);
    window.addEventListener('scroll', updateCoords, true);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [sourceId, targetId]);

  if (!coords) return null;

  const path = `M ${coords.x1} ${coords.y1} C ${coords.x1 + 60} ${coords.y1}, ${coords.x2 - 60} ${coords.y2}, ${coords.x2} ${coords.y2}`;

  return (
    <svg className="fixed inset-0 pointer-events-none z-[60] w-full h-full" style={{ left: 0, top: 0 }}>
      <motion.path
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.5 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        d={path}
        stroke={theme.line}
        strokeWidth="2.5"
        fill="none"
        strokeDasharray="5 5"
      />
      <circle r="4" fill={theme.glow} style={{ filter: `drop-shadow(0 0 6px ${theme.glow})` }}>
        <animateMotion dur="2.5s" repeatCount="indefinite" path={path} />
      </circle>
      <circle cx={coords.x1} cy={coords.y1} r="3" fill={theme.dot} />
      <circle cx={coords.x2} cy={coords.y2} r="4" fill={theme.dot} />
    </svg>
  );
};

/* =======================================================
 * 🏦 COMPONENTE PRINCIPAL
 * ======================================================= */
export const InvoicesView = ({ data, onSave }: InvoicesViewProps) => {
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
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); 

  const [selectedGroup, setSelectedGroup] = useState<{ label: string; ids: string[], unitId: BusinessUnit } | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<FacturaExtended | null>(null);
  const [modalForm, setModalForm] = useState({ num: '', date: DateUtil.today(), selectedAlbs: [] as string[], unitId: 'REST' as BusinessUnit });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [emailInbox, setEmailInbox] = useState<EmailDraft[]>([]);

  // DRAG & DROP
  useEffect(() => {
    let dragCounter = 0;
    const handleDragEnter = (e: DragEvent) => { if (!hasRealFiles(e)) return; e.preventDefault(); dragCounter++; if (dragCounter === 1) setIsDragging(true); };
    const handleDragLeave = (e: DragEvent) => { if (!hasRealFiles(e)) return; e.preventDefault(); dragCounter--; if (dragCounter === 0) setIsDragging(false); };
    const handleDragOver = (e: DragEvent) => { if (!hasRealFiles(e)) return; e.preventDefault(); };
    const handleDropGlobal = async (e: DragEvent) => {
      e.preventDefault(); dragCounter = 0; setIsDragging(false);
      const dt = e.dataTransfer; if (!dt?.files?.length) return;
      if (dt.files.length > 1) return alert("⚠️ Sube 1 solo documento para evitar errores.");
      const file = dt.files[0]; 
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) { await processLocalFile(file); } 
      else { alert("⚠️ Solo se permiten archivos PDF o imágenes."); }
    };
    document.body.addEventListener('dragenter', handleDragEnter); document.body.addEventListener('dragleave', handleDragLeave);
    document.body.addEventListener('dragover', handleDragOver); document.body.addEventListener('drop', handleDropGlobal);
    return () => { document.body.removeEventListener('dragenter', handleDragEnter); document.body.removeEventListener('dragleave', handleDragLeave); document.body.removeEventListener('dragover', handleDragOver); document.body.removeEventListener('drop', handleDropGlobal); };
  }, [facturasSeguras]);

  // ATAJOS
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement; const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!isTyping && e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder^="Buscar"]')?.focus(); }
      if (!isTyping && e.key.toLowerCase() === 'g') { e.preventDefault(); setActiveTab(t => t === 'pend' ? 'hist' : 'pend'); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  const draftsIA = useMemo(() => {
    try {
      return facturasSeguras.filter(f => f?.status === 'draft').map(draft => {
        const oficialName = getOfficialProvName(draft.prov);
        const matchResult = matchAlbaranesToFactura(draft, albaranesSeguros, basicNorm(oficialName));
        return { ...draft, ...matchResult, prov: oficialName }; 
      });
    } catch (error) {
      console.error("Error en draftsIA:", error); return [];
    }
  }, [facturasSeguras, albaranesSeguros]);

  // MOTOR OCR (Local)
  const processLocalFile = async (file: File) => {
    setIsSyncing(true); 
    try {
      const sha = await sha256File(file);
      const isDuplicate = facturasSeguras.some(f => f.attachmentSha === sha);
      if (isDuplicate) { setIsSyncing(false); return alert("⚠️ Este documento ya ha sido subido anteriormente."); }

      const apiKey = localStorage.getItem('gemini_api_key');
      if (!apiKey) throw new Error("NO_API_KEY");

      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(file);
      });
      const soloBase64 = fileBase64.split(',')[1];

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Actúa como un Auditor Contable. Lee esta factura y extrae TODO lo posible. Devuelve SOLO un JSON estricto: 
      { 
        "proveedor": "Nombre de la empresa", 
        "nif": "NIF o CIF si aparece",
        "num": "Número de factura oficial", 
        "fecha": "YYYY-MM-DD", 
        "total": 0, 
        "base": 0, 
        "iva": 0,
        "referencias_albaranes": ["Array de strings con números de albarán o pedido que vengan escritos en la factura"]
      }`;
      
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
        albaranIdsArr: rawJson.referencias_albaranes || [], 
        paid: false, reconciled: false, source: 'dropzone', status: 'draft', unidad_negocio: 'REST', file_base64: fileBase64, attachmentSha: sha 
      };

      await onSave({ ...safeData, facturas: [nuevaFacturaIA, ...facturasSeguras] });
      alert("✅ Factura extraída correctamente. Revisa la bandeja superior.");

    } catch (e) {
      alert("⚠️ Error en IA. Quizás la clave API es incorrecta o la imagen no es legible.");
    } finally { setIsSyncing(false); }
  };

  // LECTOR GMAIL
  const handleFetchEmails = async () => {
    setIsSyncing(true);
    try {
      const nuevosCorreos = await fetchNewEmails();
      if (nuevosCorreos && nuevosCorreos.length > 0) {
        setEmailInbox(prev => {
          const idsExistentes = new Set(prev.map(p => p.id));
          const unicos = nuevosCorreos.filter(m => !idsExistentes.has(m.id));
          return [...unicos, ...prev];
        });
        alert(`✅ Encontradas ${nuevosCorreos.length} facturas nuevas en el buzón IMAP.`);
      } else {
        alert("📭 No hay correos nuevos con PDF pendientes.");
      }
    } catch (e: any) { alert(`⚠️ Error de red: ${e.message || 'Desconocido'}`); } 
    finally { setIsSyncing(false); }
  };

  const handleParseEmail = async (emailId: string) => {
    const correo = emailInbox.find(e => e.id === emailId);
    if (!correo || !correo.fileBase64) return;

    setIsSyncing(true);
    try {
      const apiKey = localStorage.getItem('gemini_api_key');
      if (!apiKey) throw new Error("NO_API_KEY");

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Actúa como un Auditor Contable. Lee esta factura y extrae TODO lo posible. Devuelve SOLO un JSON estricto: 
      { "proveedor": "Nombre de la empresa", "nif": "NIF/CIF", "num": "Número de factura", "fecha": "YYYY-MM-DD", "total": 0, "base": 0, "iva": 0, "referencias_albaranes": ["Array de números de albarán referenciados"] }`;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: correo.fileBase64, mimeType: "application/pdf" } }] }],
        config: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const cleanText = (response.text || "").replace(/(?:json)?/gi, '').replace(/```/g, '').trim();
      const rawJson = safeJSON(cleanText);

      const nuevaFacturaIA: FacturaExtended = {
        id: 'draft-email-' + Date.now(), tipo: 'compra', num: rawJson.num || 'S/N', 
        date: rawJson.fecha || correo.date, prov: rawJson.proveedor || correo.from,
        total: String(rawJson.total || 0), base: String(rawJson.base || 0), tax: String(rawJson.iva || 0),
        albaranIdsArr: rawJson.referencias_albaranes || [],
        paid: false, reconciled: false, source: 'gmail-sync', status: 'draft', unidad_negocio: 'REST', 
        file_base64: `data:application/pdf;base64,${correo.fileBase64}`, attachmentSha: correo.id 
      };

      await onSave({ ...safeData, facturas: [nuevaFacturaIA, ...facturasSeguras] });
      await markEmailAsParsed(emailId);
      setEmailInbox(prev => prev.filter(e => e.id !== emailId));
      
    } catch (e: any) { alert("⚠️ Error al procesar el PDF del correo. Inténtalo de nuevo."); } 
    finally { setIsSyncing(false); }
  };

  const handleConfirmAuditoriaIA = async (draftId: string) => {
    setIsProcessing(true);
    try {
      const newData = JSON.parse(JSON.stringify(safeData)); 
      const draftIdx = newData.facturas.findIndex((f: any) => f.id === draftId);
      const audit = draftsIA.find(d => d.id === draftId);
      if (draftIdx === -1 || !audit) return;

      newData.facturas[draftIdx].total = "0";
      newData.facturas[draftIdx].base = "0";
      newData.facturas[draftIdx].tax = "0";
      newData.facturas[draftIdx].albaranIdsArr = []; 

      if (audit.candidatos && audit.candidatos.length > 0) {
        const idsVincular = audit.candidatos.map((a: any) => a.id);
        linkAlbaranesToFactura(newData, draftId, idsVincular);
        newData.facturas[draftIdx].unidad_negocio = audit.candidatos[0].unitId || 'REST';
      } else {
        newData.facturas[draftIdx].total = String(audit.total);
        newData.facturas[draftIdx].base = String(audit.base);
        newData.facturas[draftIdx].tax = String(audit.tax);
      }

      newData.facturas[draftIdx].status = 'approved'; 
      await onSave(newData);
    } catch (error) { 
      console.error("Error al confirmar IA:", error); 
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDiscardDraftIA = async (id: string) => {
    if (!window.confirm("¿Estás seguro de eliminar este borrador permanentemente?")) return;
    await onSave({ ...safeData, facturas: facturasSeguras.filter(f => f.id !== id) });
  };

  const pendingGroups = useMemo(() => {
    try {
      const byMonth: Record<string, { name: string; groups: Record<string, any> }> = {};
      const q = deferredSearch ? basicNorm(deferredSearch) : ''; 

      albaranesSeguros.forEach(a => {
        const aDate = a?.date || '';
        if (a?.invoiced || typeof aDate !== 'string' || !aDate.startsWith(year.toString())) return;
        
        const itemUnit = (a as any).unitId || 'REST';
        if (selectedUnit !== 'ALL' && itemUnit !== selectedUnit) return;
        
        const owner = (mode === 'proveedor' ? a?.prov : a?.socio) || 'Arume';
        
        if (q) {
            const matchOwner = basicNorm(owner).includes(q); 
            const matchNum = basicNorm(a?.num || '').includes(q); 
            if (!matchOwner && !matchNum) return;
        }

        const mk = aDate.length >= 7 ? aDate.substring(0, 7) : null; 
        if (!mk) return;

        if (!byMonth[mk]) {
          const parts = mk.split('-'); 
          const y = parts[0] || '0000';
          const m = parts[1] ? parseInt(parts[1]) : 1;
          const names = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
          byMonth[mk] = { name: `${names[m] || 'Mes'} ${y}`, groups: {} };
        }

        const groupKey = `${basicNorm(owner)}_${itemUnit}`; 
        if (!byMonth[mk].groups[groupKey]) {
            byMonth[mk].groups[groupKey] = { label: owner, unitId: itemUnit, t: 0, ids: [], count: 0 };
        }
        
        byMonth[mk].groups[groupKey].t += (Num.parse(a?.total) || 0); 
        byMonth[mk].groups[groupKey].count += 1; 
        byMonth[mk].groups[groupKey].ids.push(a?.id);
      });

      return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
    } catch (error) { return []; }
  }, [albaranesSeguros, year, mode, deferredSearch, selectedUnit]);

  const handleConfirmManualInvoice = async () => {
    if (!modalForm.num.trim() || modalForm.selectedAlbs.length === 0) return;
    setIsProcessing(true);
    try {
      const newData = JSON.parse(JSON.stringify(safeData));
      const newFacId = 'fac-manual-' + Date.now();
      
      const newFactura: FacturaExtended = {
        id: newFacId, 
        tipo: mode === 'proveedor' ? 'compra' : 'venta', 
        num: modalForm.num, 
        date: modalForm.date,
        prov: mode === 'proveedor' ? (selectedGroup?.label || '') : 'Varios', 
        cliente: mode === 'socio' ? (selectedGroup?.label || '') : 'Arume',
        total: "0", base: "0", tax: "0", albaranIdsArr: [],
        paid: false, reconciled: false, source: 'manual-group', status: 'approved', 
        unidad_negocio: modalForm.unitId || 'REST' 
      };

      newData.facturas.unshift(newFactura);
      linkAlbaranesToFactura(newData, newFacId, modalForm.selectedAlbs);
      await onSave(newData); 
      setSelectedGroup(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTogglePago = async (id: string) => {
    const newData = { ...safeData, facturas: [...facturasSeguras] };
    const idx = newData.facturas.findIndex(f => f.id === id);
    if (idx !== -1) {
      if (newData.facturas[idx].reconciled) return alert("🔒 Factura conciliada por el banco.");
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
    
    const newData = JSON.parse(JSON.stringify(safeData));
    const idsToFree = fac.albaranIdsArr || [];
    newData.albaranes.forEach((a: any) => { if (idsToFree.includes(a.id)) a.invoiced = false; });
    newData.facturas = newData.facturas.filter((f: any) => f.id !== id);
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
    
    if (filtered.length === 0) return alert("No hay facturas en este periodo.");

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
        a.href = f.file_base64.startsWith('data:') ? f.file_base64 : `data:application/pdf;base64,${f.file_base64}`; 
        a.download = `${basicNorm(f.prov||'factura')}_${f.num||'SN'}.pdf`; 
        a.click();
    } catch(e) { alert("Error al descargar el archivo"); }
  };

  const renderPendingGroups = () => {
    if (!pendingGroups || pendingGroups.length === 0) {
      return (
        <div className="py-12 flex flex-col items-center justify-center bg-white rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3"><Package className="w-6 h-6 text-slate-300" /></div>
          <p className="text-slate-500 font-bold text-xs uppercase">Todo al día</p>
          <p className="text-[10px] text-slate-400 mt-1">No hay albaranes sueltos en este periodo.</p>
        </div>
      );
    }
    
    return pendingGroups.map(([mk, dataGroup]) => (
      <div key={mk} className="mb-4 animate-fade-in bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase mb-3 flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-indigo-400" /> {dataGroup.name}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.values(dataGroup.groups || {}).map((g: any) => {
            const unitConfig = BUSINESS_UNITS.find(u => u.id === g.unitId);
            const groupId = `source-group-${basicNorm(g.label)}-${g.unitId}`; 
            
            return (
              <div 
                key={g.label + g.unitId} 
                id={groupId} 
                onClick={() => { setSelectedGroup({ label: g.label, ids: g.ids, unitId: g.unitId }); setModalForm({ num: '', date: DateUtil.today(), selectedAlbs: [...g.ids], unitId: g.unitId }); }} 
                className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-indigo-400 hover:bg-white hover:shadow-md transition-all cursor-pointer group relative z-10"
              >
                <div className="min-w-0 pr-3">
                  <p className="font-bold text-slate-800 text-xs group-hover:text-indigo-600 transition truncate">{g.label}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {unitConfig && <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold uppercase", unitConfig.bg, unitConfig.color)}>{unitConfig.name.split(' ')[0]}</span>}
                    <span className="text-[9px] font-medium text-slate-500">{g.count} albs</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-900 text-sm">{Num.fmt(g.t)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ));
  };

  return (
    <div className="animate-fade-in space-y-4 pb-24 relative max-w-[1600px] mx-auto text-xs">
      
      {/* OVERLAY DRAG & DROP */}
      <AnimatePresence>
        {isDragging && (
          <motion.div data-test-id="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[999] pointer-events-none flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
            <div className="relative z-10 w-full max-w-sm mx-4 border-2 border-dashed border-white/50 rounded-2xl flex flex-col items-center justify-center bg-indigo-600 p-8 shadow-2xl">
              <FileDown className="w-12 h-12 text-white mb-4 animate-bounce" />
              <h2 className="text-xl font-bold text-white tracking-tight">Suelta la Factura</h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* CABECERA COMPACTA */}
      <header className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col xl:flex-row justify-between gap-3 relative z-10 items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center border border-indigo-100">
            <FileText className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800 tracking-tight">Facturación</h2>
            <p className="text-[10px] text-slate-500 uppercase">Reconciliación 3-Way</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleFetchEmails} disabled={isSyncing} className="px-3 py-2 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 transition flex items-center gap-1.5 border border-blue-200">
            {isSyncing ? <Loader2 className="w-3 h-3 animate-spin"/> : <Inbox className="w-3 h-3" />} IMAP
          </button>
          
          <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf, image/*" onChange={(e) => { if (e.target.files && e.target.files[0]) { processLocalFile(e.target.files[0]); e.target.value = ''; } }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={isSyncing} className="px-3 py-2 rounded-lg text-[10px] font-bold bg-slate-900 text-white hover:bg-slate-800 transition flex items-center gap-1.5">
            {isSyncing ? <Loader2 className="w-3 h-3 animate-spin"/> : <UploadCloud className="w-3 h-3" />} PDF
          </button>
          
          <button onClick={() => setIsExportModalOpen(true)} className="px-3 py-2 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition flex items-center gap-1.5">
            <Download className="w-3 h-3" /> Exportar
          </button>
        </div>
      </header>

      {/* CONTROLES STICKY COMPACTOS */}
      <div className="sticky top-2 z-40">
        <div className="bg-white/95 backdrop-blur-md px-3 py-2 rounded-xl shadow-sm border border-slate-200 flex flex-col xl:flex-row items-center justify-between gap-2">
          
          <div className="flex items-center bg-slate-100 p-1 rounded-lg w-full xl:w-auto">
            <button onClick={() => setActiveTab('pend')} className={cn("px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition", activeTab === 'pend' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>📦 Albaranes Sueltos</button>
            <button onClick={() => setActiveTab('hist')} className={cn("px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition", activeTab === 'hist' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>💰 Histórico Facturas</button>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button onClick={() => setMode('proveedor')} className={cn("px-2 py-1 rounded text-[9px] font-bold uppercase", mode === 'proveedor' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}>Prov</button>
              <button onClick={() => setMode('socio')} className={cn("px-2 py-1 rounded text-[9px] font-bold uppercase", mode === 'socio' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}>Socio</button>
            </div>

            <select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value as any)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold uppercase outline-none text-slate-600">
              <option value="ALL">Todas</option>
              <option value="REST">REST</option>
              <option value="DLV">DLV</option>
              <option value="SHOP">SHOP</option>
              <option value="CORP">CORP</option>
            </select>

            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg">
              <button className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-l-lg" onClick={() => setYear(y => y - 1)}><ChevronLeft className="w-3 h-3"/></button>
              <span className="px-2 text-[10px] font-bold text-slate-700">{year}</span>
              <button className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-r-lg" onClick={() => setYear(y => y + 1)}><ChevronRight className="w-3 h-3"/></button>
            </div>

            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar..." className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] outline-none focus:bg-white focus:border-indigo-400" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 relative z-10">
        
        {/* COLUMNA IZQUIERDA: LISTADO */}
        <section className="xl:col-span-8 space-y-3">
          {activeTab === 'hist' && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {[{ id: 'all', label: 'Todas', c: 'text-slate-500' }, { id: 'pending', label: '⏳ Ptes', c: 'text-amber-600' }, { id: 'paid', label: '✔️ Pagadas', c: 'text-emerald-600' }, { id: 'reconciled', label: '🔗 Banco', c: 'text-blue-600' }].map(chip => (
                <button type="button" key={chip.id} onClick={() => setFilterStatus(chip.id as any)} className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase border", filterStatus === chip.id ? "bg-indigo-600 text-white border-indigo-600" : cn("bg-white border-slate-200 hover:bg-slate-50", chip.c))}>{chip.label}</button>
              ))}
            </div>
          )}

          {activeTab === 'pend' ? renderPendingGroups() : (
            <InvoicesList 
              facturas={facturasSeguras} 
              searchQ={deferredSearch} 
              selectedUnit={selectedUnit} 
              mode={mode} 
              filterStatus={filterStatus} 
              year={year} 
              businessUnits={BUSINESS_UNITS} 
              sociosReales={SOCIOS_REALES_NAMES} 
              superNorm={basicNorm} // 💡 CORRECCIÓN
              onOpenDetail={setSelectedInvoice as any} 
              onTogglePago={handleTogglePago} 
              onDelete={handleDeleteFactura} 
              albaranesSeguros={albaranesSeguros} 
            />
          )}
        </section>

        {/* COLUMNA DERECHA: BANDEJAS */}
        <aside className="xl:col-span-4">
          <div className="sticky top-20 space-y-4">
            
            {/* IMAP */}
            {emailInbox.length > 0 && (
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <h4 className="text-xs font-bold text-slate-800 mb-3 flex items-center gap-1.5"><Inbox className="w-4 h-4 text-blue-500"/> Correos ({emailInbox.length})</h4>
                <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                  {emailInbox.map(mail => (
                    <div key={mail.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:border-blue-300 transition">
                      <div className="flex justify-between items-start mb-1.5">
                        <p className="text-[11px] font-bold text-slate-800 truncate pr-2">{mail.from}</p>
                        <span className="text-[8px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{mail.date}</span>
                      </div>
                      <p className="text-[9px] text-slate-500 truncate mb-2">{mail.subject}</p>
                      <button onClick={() => handleParseEmail(mail.id)} disabled={isSyncing} className="w-full bg-white border border-blue-200 text-blue-600 font-bold text-[9px] uppercase py-1.5 rounded hover:bg-blue-50 flex justify-center gap-1">
                        {isSyncing ? <Loader2 className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3"/>} Extraer PDF
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* IA DRAFTS */}
            <div className={cn("p-4 rounded-xl border shadow-sm transition-all", draftsIA.length > 0 ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
              <div className="flex justify-between items-center mb-3">
                <h4 className={cn("text-xs font-bold flex items-center gap-1.5", draftsIA.length > 0 ? "text-white" : "text-slate-600")}><Sparkles className={cn("w-4 h-4", draftsIA.length > 0 ? "text-purple-400" : "text-slate-400")}/> Bandeja IA</h4>
                {draftsIA.length > 0 && <span className="bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded text-[9px] font-bold">{draftsIA.length}</span>}
              </div>

              {draftsIA.length > 0 ? (
                <div className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-1">
                  {draftsIA.map(d => {
                    const destId = `dest-draft-${d.id}`; 
                    
                    const activeConnections = d.candidatos && d.candidatos.length > 0 
                      ? Array.from(new Set(d.candidatos.map((c: any) => `source-group-${basicNorm(d.prov)}-${c.unitId || 'REST'}`))) 
                      : [];

                    const connectionStatus = d.cuadraPerfecto ? 'perfect' : 'warning';

                    return (
                      <div key={d.id} id={destId} className="bg-slate-800 p-3 rounded-lg border border-slate-700 hover:border-indigo-500 hover:scale-[1.02] transition-all duration-300 relative z-10 cursor-default">
                        
                        {activeConnections.map(sourceId => (
                          <ConnectionLine 
                            key={`${sourceId}-${destId}`} 
                            sourceId={sourceId as string} 
                            targetId={destId} 
                            status={connectionStatus}
                          />
                        ))}

                        <div className="flex justify-between items-start mb-2">
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-white text-[11px] truncate block">{d.prov || 'Desconocido'}</span>
                            <span className="text-[9px] text-slate-400 mt-0.5 block">{d.date} · {d.num}</span>
                          </div>
                          <button onClick={() => handleDiscardDraftIA(d.id)} className="text-slate-500 hover:text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                        </div>
                        
                        <div className="flex justify-between items-end bg-slate-900 p-2 rounded border border-slate-700">
                          <div>
                            <p className="text-[8px] text-slate-500 uppercase">Total</p>
                            <span className="text-sm font-bold text-white">{Num.fmt(d.total)}</span>
                          </div>
                          {d.cuadraPerfecto ? (
                             <span className="text-[8px] font-bold uppercase text-emerald-400 flex items-center gap-0.5"><Check className="w-3 h-3"/> Cuadra</span>
                          ) : (
                             <span className="text-[8px] font-bold uppercase text-amber-400">Diff: {Num.fmt(d.diferencia)}</span>
                          )}
                        </div>
                        
                        <button onClick={() => handleConfirmAuditoriaIA(d.id)} disabled={isProcessing} className="w-full mt-2 py-2 bg-indigo-500 text-white rounded text-[9px] font-bold uppercase hover:bg-indigo-400 transition-colors flex justify-center gap-1.5">
                          {isProcessing ? <Loader2 className="w-3 h-3 animate-spin"/> : <CheckCircle2 className="w-3 h-3"/>} Confirmar
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center opacity-50 py-4"><FileText className="w-6 h-6 mx-auto text-slate-400 mb-2" /><p className="text-[10px] font-bold text-slate-500">Vacío</p></div>
              )}
            </div>

          </div>
        </aside>
      </div>

      {/* MODALES */}
      <AnimatePresence>
        {isExportModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex justify-center items-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} className="bg-white w-full max-w-sm rounded-xl p-5 shadow-xl border border-slate-200">
              <h3 className="text-sm font-bold text-slate-800 mb-4">Exportar a Excel</h3>
              <div className="space-y-4">
                <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Año</label><input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-xs outline-none" /></div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Trimestre</label>
                  <div className="grid grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map(q => (<button key={q} onClick={() => setExportQuarter(q)} className={cn("py-1.5 rounded text-[10px] font-bold", exportQuarter === q ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600")}>Q{q}</button>))}
                  </div>
                </div>
                <div className="pt-2 flex gap-2">
                  <button onClick={() => setIsExportModalOpen(false)} className="flex-1 text-slate-500 text-[10px] font-bold py-2 hover:bg-slate-100 rounded">Cancelar</button>
                  <button onClick={handleExportGestoria} className="flex-1 bg-emerald-600 text-white py-2 rounded font-bold text-[10px] flex justify-center items-center gap-1"><Download className="w-3 h-3" /> Descargar</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedGroup && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex justify-center items-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white w-full max-w-2xl rounded-2xl p-5 shadow-2xl relative flex flex-col max-h-[85vh]">
              <button onClick={() => setSelectedGroup(null)} className="absolute top-4 right-4 p-1.5 bg-slate-100 rounded text-slate-500 hover:bg-slate-200"><X className="w-4 h-4"/></button>
              
              <div className="border-b border-slate-100 pb-3 mb-3">
                <p className="text-[9px] font-bold text-indigo-500 uppercase mb-1">Agrupación Manual</p>
                <h3 className="text-lg font-bold text-slate-800 truncate pr-8">{selectedGroup.label}</h3>
              </div>
              
              <div className="flex justify-between items-center mb-2 px-1">
                <span className="text-[10px] font-bold text-slate-500">{modalForm.selectedAlbs.length} seleccionados</span>
                <button onClick={() => { const allIds = selectedGroup.ids; setModalForm(p => ({...p, selectedAlbs: p.selectedAlbs.length === allIds.length ? [] : allIds })) }} className="text-[9px] font-bold uppercase text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                  {modalForm.selectedAlbs.length === selectedGroup.ids.length ? 'Desmarcar' : 'Marcar Todos'}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50 rounded-lg p-2 border border-slate-200 space-y-1">
                {(albaranesSeguros).filter(a => selectedGroup.ids.includes(a.id)).map(a => (
                  <label key={a.id} className={cn("flex justify-between items-center p-2 rounded cursor-pointer border", modalForm.selectedAlbs.includes(a.id) ? "bg-white border-indigo-300 shadow-sm" : "border-transparent hover:bg-white hover:border-slate-200")}>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={modalForm.selectedAlbs.includes(a.id)} onChange={(e) => { const newSelected = e.target.checked ? [...modalForm.selectedAlbs, a.id] : modalForm.selectedAlbs.filter(id => id !== a.id); setModalForm({ ...modalForm, selectedAlbs: newSelected }); }} className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded" />
                      <div>
                        <p className="font-bold text-slate-800 text-[11px]">{a.date}</p>
                        <p className="text-[9px] text-slate-400">Ref: {a.num || 'S/N'}</p>
                      </div>
                    </div>
                    <p className="font-bold text-slate-900 text-xs">{Num.fmt(a.total)}</p>
                  </label>
                ))}
              </div>
              
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between bg-slate-900 p-3 rounded-lg text-white">
                  <span className="text-[9px] font-bold uppercase text-slate-400">Total Factura</span>
                  <span className="text-lg font-bold text-emerald-400">{Num.fmt(modalForm.selectedAlbs.reduce((acc, id) => { const alb = albaranesSeguros.find(a => a.id === id); return acc + (Num.parse(alb?.total) || 0); }, 0))}</span>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  {mode === 'socio' ? (
                    <div><label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Responsable</label><select value={modalForm.num.startsWith('SOCIO-') ? modalForm.num.split('-')[1] : ''} onChange={(e) => { const socio = e.target.value; setModalForm({ ...modalForm, num: `LIQ-${socio}-${modalForm.date.replace(/-/g,'')}` }); setSelectedGroup(prev => prev ? { ...prev, label: socio } : null); }} className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-xs outline-none focus:border-indigo-400"><option value="">Selecciona</option>{SOCIOS_REALES_NAMES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                  ) : (
                    <div><label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Nº Oficial</label><input type="text" value={modalForm.num} onChange={(e) => setModalForm({ ...modalForm, num: e.target.value })} placeholder="F-2026/012" className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-xs outline-none focus:border-indigo-400" /></div>
                  )}
                  <div><label className="text-[9px] font-bold text-slate-500 uppercase block mb-1">Fecha</label><input type="date" value={modalForm.date} onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })} className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-xs outline-none focus:border-indigo-400" /></div>
                </div>
                
                <button onClick={handleConfirmManualInvoice} disabled={modalForm.selectedAlbs.length === 0 || isProcessing} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-[10px] font-bold uppercase hover:bg-indigo-700 disabled:opacity-50 flex justify-center items-center gap-1.5">
                  {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3"/>} Facturar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
