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
 * 🏦 COMPONENTE PRINCIPAL (Orquestador Intacto)
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

  // DRAG & DROP SEGURO
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
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="py-20 flex flex-col items-center justify-center bg-white rounded-[2rem] border border-slate-200 shadow-sm text-center">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4"><Package className="w-8 h-8 text-slate-300" /></div>
          <p className="text-slate-800 font-black text-sm uppercase tracking-widest">Todo al día</p>
          <p className="text-xs font-bold text-slate-400 mt-2 max-w-sm">No hay albaranes sueltos pendientes de facturar en este periodo.</p>
        </motion.div>
      );
    }
    
    return pendingGroups.map(([mk, dataGroup]) => (
      <div key={mk} className="mb-6 animate-fade-in bg-white p-5 rounded-[2rem] shadow-sm border border-slate-200">
        <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-500" /> {dataGroup.name}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Object.values(dataGroup.groups || {}).map((g: any) => {
            const unitConfig = BUSINESS_UNITS.find(u => u.id === g.unitId);
            const groupId = `source-group-${basicNorm(g.label)}-${g.unitId}`; 
            
            return (
              <div 
                key={g.label + g.unitId} 
                id={groupId} 
                onClick={() => { setSelectedGroup({ label: g.label, ids: g.ids, unitId: g.unitId }); setModalForm({ num: '', date: DateUtil.today(), selectedAlbs: [...g.ids], unitId: g.unitId }); }} 
                className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:bg-white hover:shadow-md transition-all cursor-pointer group relative z-10"
              >
                <div className="min-w-0 pr-3">
                  <p className="font-black text-slate-800 text-sm group-hover:text-indigo-600 transition truncate">{g.label}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {unitConfig && <span className={cn("text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-wider", unitConfig.bg, unitConfig.color)}>{unitConfig.name.split(' ')[0]}</span>}
                    <span className="text-[10px] font-bold text-slate-400">{g.count} albaranes</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-black text-slate-900 text-base">{Num.fmt(g.t)}</p>
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
            <div className="relative z-10 w-full max-w-sm mx-4 border-2 border-dashed border-white/50 rounded-3xl flex flex-col items-center justify-center bg-indigo-600 p-10 shadow-2xl">
              <FileDown className="w-16 h-16 text-white mb-4 animate-bounce" />
              <h2 className="text-2xl font-black text-white tracking-tight uppercase">Suelta la Factura</h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* 💡 INNOVACIÓN: Píldoras de Resumen Financiero */}
      {activeTab === 'hist' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
           <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Facturado</p>
             <p className="text-xl font-black text-slate-800">{Num.fmt(facturasSeguras.filter(f => f.status !== 'draft' && f.tipo === 'compra').reduce((acc, f) => acc + (Num.parse(f.total)||0), 0))}</p>
           </div>
           <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
             <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-1">Pendiente Pago</p>
             <p className="text-xl font-black text-rose-600">{Num.fmt(facturasSeguras.filter(f => f.status !== 'draft' && f.tipo === 'compra' && !f.paid).reduce((acc, f) => acc + (Num.parse(f.total)||0), 0))}</p>
           </div>
           <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
             <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-1">Total Pagado</p>
             <p className="text-xl font-black text-emerald-600">{Num.fmt(facturasSeguras.filter(f => f.status !== 'draft' && f.tipo === 'compra' && f.paid).reduce((acc, f) => acc + (Num.parse(f.total)||0), 0))}</p>
           </div>
           <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center bg-gradient-to-br from-indigo-50 to-white">
             <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1">Docs. en IA</p>
             <p className="text-xl font-black text-indigo-700">{draftsIA.length} Borradores</p>
           </div>
        </div>
      )}

      {/* CABECERA COMPACTA Y BOTONES RÁPIDOS */}
      <header className="bg-white/90 backdrop-blur-md rounded-[2rem] border border-slate-200 shadow-sm p-4 md:p-5 flex flex-col xl:flex-row justify-between gap-4 relative z-40 items-center sticky top-4">
        <div className="flex items-center gap-4 w-full xl:w-auto justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight leading-none">Auditoría 3-Way</h2>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Facturas & Pagos</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          {/* BOTONES DE NAVEGACIÓN PRINCIPAL */}
          <div className="flex items-center bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-full md:w-auto">
            <button onClick={() => setActiveTab('pend')} className={cn("flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all", activeTab === 'pend' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}>📦 Albaranes Sueltos</button>
            <button onClick={() => setActiveTab('hist')} className={cn("flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all", activeTab === 'hist' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}>💰 Bóveda Facturas</button>
          </div>

          <div className="w-px h-8 bg-slate-200 hidden md:block mx-1"></div>

          {/* BOTONES DE ACCIÓN RÁPIDA */}
          <button onClick={handleFetchEmails} disabled={isSyncing} className={cn("px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 border shadow-sm", draftsIA.length === 0 ? "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")}>
            {isSyncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Inbox className="w-4 h-4" />} IMAP
          </button>
          
          <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf, image/*" onChange={(e) => { if (e.target.files && e.target.files[0]) { processLocalFile(e.target.files[0]); e.target.value = ''; } }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={isSyncing} className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white hover:bg-slate-800 transition-all flex items-center gap-2 shadow-md">
            {isSyncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <UploadCloud className="w-4 h-4" />} PDF
          </button>
          
          <button onClick={() => setIsExportModalOpen(true)} className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-all flex items-center gap-2 shadow-sm">
            <Download className="w-4 h-4" /> Gestoría
          </button>
        </div>
      </header>

      {/* FILTROS SECUNDARIOS (Aparecen bajo el header) */}
      <div className="bg-white px-5 py-3 rounded-2xl shadow-sm border border-slate-200 flex flex-col lg:flex-row items-center justify-between gap-3 relative z-30">
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200">
              <button onClick={() => setMode('proveedor')} className={cn("px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all", mode === 'proveedor' ? "bg-white text-slate-800 shadow-sm border border-slate-200" : "text-slate-500 hover:bg-slate-100")}>Proveedor</button>
              <button onClick={() => setMode('socio')} className={cn("px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all", mode === 'socio' ? "bg-white text-slate-800 shadow-sm border border-slate-200" : "text-slate-500 hover:bg-slate-100")}>Socio</button>
            </div>

            <select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value as any)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest outline-none text-slate-700 focus:border-indigo-400">
              <option value="ALL">Todas las Unidades</option>
              <option value="REST">Restaurante</option>
              <option value="DLV">Catering</option>
              <option value="SHOP">Tienda Sake</option>
              <option value="CORP">Corporativo</option>
            </select>

            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl p-0.5">
              <button className="p-1.5 text-indigo-600 hover:bg-white rounded-lg transition-colors" onClick={() => setYear(y => y - 1)}><ChevronLeft className="w-4 h-4"/></button>
              <span className="px-3 text-xs font-black text-slate-700">{year}</span>
              <button className="p-1.5 text-indigo-600 hover:bg-white rounded-lg transition-colors" onClick={() => setYear(y => y + 1)}><ChevronRight className="w-4 h-4"/></button>
            </div>
          </div>

          <div className="relative w-full lg:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar factura, proveedor..." className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
          </div>
      </div>

      {/* CUERPO PRINCIPAL */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 relative z-10">
        
        {/* COLUMNA IZQUIERDA: LISTADOS */}
        <section className="xl:col-span-8 space-y-4">
          <AnimatePresence mode="wait">
            {activeTab === 'pend' ? (
              <motion.div key="pend" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                {renderPendingGroups()}
              </motion.div>
            ) : (
              <motion.div key="hist" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                {/* 🧩 AQUI LLAMAMOS A TU TABLA DE FACTURAS (InvoicesList) */}
                <InvoicesList 
                  facturas={facturasSeguras} 
                  searchQ={deferredSearch} 
                  selectedUnit={selectedUnit} 
                  mode={mode} 
                  filterStatus={filterStatus} 
                  year={year} 
                  businessUnits={BUSINESS_UNITS} 
                  sociosReales={SOCIOS_REALES_NAMES} 
                  superNorm={basicNorm} 
                  onOpenDetail={setSelectedInvoice as any} 
                  onTogglePago={handleTogglePago} 
                  onDelete={handleDeleteFactura} 
                  albaranesSeguros={albaranesSeguros} 
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* COLUMNA DERECHA: BANDEJAS (IMAP E IA) */}
        <aside className="xl:col-span-4">
          <div className="sticky top-28 space-y-6">
            
            {/* IMAP */}
            <AnimatePresence>
              {emailInbox.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2"><Inbox className="w-5 h-5 text-blue-500"/> Correos ({emailInbox.length})</h4>
                  <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                    {emailInbox.map(mail => (
                      <div key={mail.id} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl hover:border-blue-300 hover:shadow-md transition-all group">
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-xs font-black text-slate-800 truncate pr-2 group-hover:text-blue-600 transition-colors">{mail.from}</p>
                          <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100">{mail.date}</span>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 truncate mb-3">{mail.subject}</p>
                        <button onClick={() => handleParseEmail(mail.id)} disabled={isSyncing} className="w-full bg-white border-2 border-dashed border-blue-200 text-blue-600 font-black text-[10px] uppercase py-2.5 rounded-xl hover:bg-blue-50 hover:border-blue-400 transition-all flex justify-center items-center gap-1.5">
                          {isSyncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>} Extraer PDF con IA
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* IA DRAFTS */}
            <div className={cn("p-5 md:p-6 rounded-[2rem] border shadow-xl transition-all duration-500", draftsIA.length > 0 ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
              <div className="flex justify-between items-center mb-5">
                <h4 className={cn("text-xs font-black uppercase tracking-widest flex items-center gap-2", draftsIA.length > 0 ? "text-white" : "text-slate-600")}>
                  <Bot className={cn("w-5 h-5", draftsIA.length > 0 ? "text-purple-400" : "text-slate-400")}/> Bandeja Auditoría IA
                </h4>
                {draftsIA.length > 0 && <span className="bg-purple-500 text-white px-2.5 py-1 rounded-lg text-[10px] font-black">{draftsIA.length} Pendientes</span>}
              </div>

              {draftsIA.length > 0 ? (
                <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                  {draftsIA.map(d => {
                    const destId = `dest-draft-${d.id}`; 
                    
                    const activeConnections = d.candidatos && d.candidatos.length > 0 
                      ? Array.from(new Set(d.candidatos.map((c: any) => `source-group-${basicNorm(d.prov)}-${c.unitId || 'REST'}`))) 
                      : [];

                    const connectionStatus = d.cuadraPerfecto ? 'perfect' : 'warning';

                    return (
                      <div key={d.id} id={destId} className={cn("bg-slate-800 p-4 rounded-2xl border transition-all duration-300 relative z-10 cursor-default", d.cuadraPerfecto ? "border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)]" : "border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.15)]")}>
                        
                        {activeConnections.map(sourceId => (
                          <ConnectionLine 
                            key={`${sourceId}-${destId}`} 
                            sourceId={sourceId as string} 
                            targetId={destId} 
                            status={connectionStatus}
                          />
                        ))}

                        <div className="flex justify-between items-start mb-3">
                          <div className="min-w-0 pr-2">
                            <span className="font-black text-white text-sm truncate block">{d.prov || 'Desconocido'}</span>
                            <span className="text-[10px] font-bold text-slate-400 mt-1 block flex items-center gap-1.5"><Calendar className="w-3 h-3"/> {d.date} <span className="text-slate-600">|</span> {d.num}</span>
                          </div>
                          <button onClick={() => handleDiscardDraftIA(d.id)} className="p-1.5 bg-slate-700/50 rounded-lg text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"><Trash2 className="w-4 h-4"/></button>
                        </div>
                        
                        <div className="flex justify-between items-end bg-slate-900 p-3 rounded-xl border border-slate-700/50">
                          <div>
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Total Fra.</p>
                            <span className="text-xl font-black text-white leading-none">{Num.fmt(d.total)}</span>
                          </div>
                          {d.cuadraPerfecto ? (
                             <span className="text-[10px] font-black uppercase text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-lg flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5"/> Cuadra</span>
                          ) : (
                             <span className="text-[10px] font-black uppercase text-amber-400 bg-amber-400/10 px-2 py-1 rounded-lg flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5"/> Diff: {Num.fmt(d.diferencia)}</span>
                          )}
                        </div>
                        
                        <button onClick={() => handleConfirmAuditoriaIA(d.id)} disabled={isProcessing} className={cn("w-full mt-3 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex justify-center items-center gap-2", d.cuadraPerfecto ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-indigo-600 hover:bg-indigo-500 text-white")}>
                          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>} Confirmar y Guardar
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center opacity-40 py-10">
                  <Bot className="w-12 h-12 mx-auto text-slate-400 mb-3" />
                  <p className="text-xs font-black uppercase tracking-widest text-slate-300">Sin Tareas</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* MODALES FLOTANTES */}
      <AnimatePresence>
        {isExportModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[500] flex justify-center items-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsExportModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-md rounded-[2rem] p-8 shadow-2xl border border-slate-200">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black text-slate-800">Exportar a Excel</h3>
                <button onClick={() => setIsExportModalOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-700 transition"><X className="w-5 h-5"/></button>
              </div>
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Año Fiscal</label>
                  <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-sm outline-none focus:border-indigo-500 focus:bg-white transition" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Trimestre</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map(q => (
                      <button key={q} onClick={() => setExportQuarter(q)} className={cn("py-3 rounded-xl text-xs font-black transition-all border", exportQuarter === q ? "bg-indigo-600 text-white border-indigo-600 shadow-md" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")}>Q{q}</button>
                    ))}
                  </div>
                </div>
                <button onClick={handleExportGestoria} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 transition-all flex justify-center items-center gap-2">
                  <Download className="w-5 h-5" /> Descargar Archivo Excel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedGroup && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[500] flex justify-center items-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedGroup(null)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-2xl rounded-[2.5rem] p-6 md:p-8 shadow-2xl relative flex flex-col max-h-[85vh]">
              <button onClick={() => setSelectedGroup(null)} className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"><X className="w-5 h-5"/></button>
              
              <div className="border-b border-slate-100 pb-4 mb-4 pr-10">
                <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Layers className="w-4 h-4"/> Agrupación Manual</p>
                <h3 className="text-2xl font-black text-slate-800 truncate">{selectedGroup.label}</h3>
              </div>
              
              <div className="flex justify-between items-center mb-3 px-1">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{modalForm.selectedAlbs.length} seleccionados</span>
                <button onClick={() => { const allIds = selectedGroup.ids; setModalForm(p => ({...p, selectedAlbs: p.selectedAlbs.length === allIds.length ? [] : allIds })) }} className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition">
                  {modalForm.selectedAlbs.length === selectedGroup.ids.length ? 'Desmarcar' : 'Marcar Todos'}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50 rounded-2xl p-3 border border-slate-200 space-y-2">
                {(albaranesSeguros).filter(a => selectedGroup.ids.includes(a.id)).map(a => (
                  <label key={a.id} className={cn("flex justify-between items-center p-3 rounded-xl cursor-pointer border transition-all", modalForm.selectedAlbs.includes(a.id) ? "bg-white border-indigo-400 shadow-sm" : "border-transparent hover:bg-white hover:border-slate-300")}>
                    <div className="flex items-center gap-3">
                      <div className={cn("w-5 h-5 rounded flex items-center justify-center border", modalForm.selectedAlbs.includes(a.id) ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-300")}>
                        {modalForm.selectedAlbs.includes(a.id) && <Check className="w-3.5 h-3.5"/>}
                      </div>
                      <div>
                        <p className="font-black text-slate-800 text-xs">{a.date}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">Ref: {a.num || 'S/N'}</p>
                      </div>
                    </div>
                    <p className="font-black text-slate-900 text-sm">{Num.fmt(a.total)}</p>
                  </label>
                ))}
              </div>
              
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between bg-slate-900 p-4 rounded-2xl text-white shadow-inner">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Factura</span>
                  <span className="text-2xl font-black text-emerald-400 tracking-tighter">{Num.fmt(modalForm.selectedAlbs.reduce((acc, id) => { const alb = albaranesSeguros.find(a => a.id === id); return acc + (Num.parse(alb?.total) || 0); }, 0))}</span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  {mode === 'socio' ? (
                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Responsable</label><select value={modalForm.num.startsWith('SOCIO-') ? modalForm.num.split('-')[1] : ''} onChange={(e) => { const socio = e.target.value; setModalForm({ ...modalForm, num: `LIQ-${socio}-${modalForm.date.replace(/-/g,'')}` }); setSelectedGroup(prev => prev ? { ...prev, label: socio } : null); }} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition cursor-pointer"><option value="">Selecciona</option>{SOCIOS_REALES_NAMES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                  ) : (
                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Nº Oficial Factura</label><input type="text" value={modalForm.num} onChange={(e) => setModalForm({ ...modalForm, num: e.target.value })} placeholder="F-2026/012" className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition" /></div>
                  )}
                  <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Fecha Emisión</label><input type="date" value={modalForm.date} onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition" /></div>
                </div>
                
                <button onClick={handleConfirmManualInvoice} disabled={modalForm.selectedAlbs.length === 0 || isProcessing} className="w-full bg-indigo-600 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg shadow-indigo-600/20 active:scale-95 transition-all">
                  {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5"/>} Emitir Factura
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🧩 MODAL DE DETALLE (FACTURA COMPLETA) */}
      {selectedInvoice && typeof selectedInvoice === 'object' && selectedInvoice.id && (
        <InvoiceDetailModal 
          factura={selectedInvoice as any} 
          albaranes={albaranesSeguros} 
          businessUnits={BUSINESS_UNITS} 
          mode={mode} 
          onClose={() => setSelectedInvoice(null)} 
          onDownloadFile={handleDownloadFile}
          onTogglePago={handleTogglePago} // 💡 INNOVACIÓN: Le pasamos la función para pagar desde dentro
        />
      )}
    </div>
  );
};
