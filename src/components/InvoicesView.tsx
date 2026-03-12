import React, { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { 
  Search, Plus, Download, Package, AlertTriangle, Check, Clock, Trash2, 
  Building2, ShoppingBag, ListPlus, Users, Hotel, Layers, X, 
  LineChart as LineChartIcon, FileSpreadsheet, Mic, Square, 
  UploadCloud, FileDown, Smartphone, Camera, Loader2, Mail, 
  CheckCircle2, Link as LinkIcon, Inbox, ArrowRight, CheckSquare, 
  Sparkles, ChevronLeft, ChevronRight, Zap, FileText, FileArchive, AlertCircle, ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { AppData, Factura, Albaran, Socio } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';

// 🚀 IMPORTAMOS EL CEREBRO DE LA FASE 1
import { getOfficialProvName, basicNorm, linkAlbaranesToFactura } from '../services/invoicing'; 
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://awbgboucnbsuzojocbuy.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_drOQ5PsFA8eox_aRTXNATQ_5kibM6ST";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  fileBase64?: string;
  fileName?: string;
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

const TOLERANCIA = 0.50; 

export const superNorm = (s: string | undefined | null) => {
  if (!s) return ''; 
  if (typeof s !== 'string') return 'desconocido';
  try { return basicNorm(s); } catch (e) { return 'desconocido'; }
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

/* =======================================================
 * 🚀 CEREBRO 3-WAY MATCH MEJORADO
 * ======================================================= */
const matchAlbaranesToFactura = (factura: FacturaExtended, albaranes: Albaran[], provNormalizado: string) => {
  const fDate = factura?.date || DateUtil.today();
  const fTotal = Num.parse(factura?.total) || 0;
  
  let candidatos = [];
  if (factura.albaranIdsArr && factura.albaranIdsArr.length > 0) {
     candidatos = albaranes.filter(a => !a.invoiced && factura.albaranIdsArr!.includes(a.num));
  }
  
  if (candidatos.length === 0) {
    const mesDraft = typeof fDate === 'string' ? fDate.substring(0, 7) : '0000-00';
    candidatos = albaranes.filter(a => {
      const aDate = a?.date || '';
      return !a?.invoiced && superNorm(a?.prov) === provNormalizado && (typeof aDate === 'string' && aDate.startsWith(mesDraft));
    });
  }

  const sumaAlbaranes = candidatos.reduce((acc, a) => acc + (Num.parse(a?.total) || 0), 0);
  const diff = Math.abs(sumaAlbaranes - Math.abs(fTotal));
  const toleranciaPermitida = Math.max(TOLERANCIA, Math.abs(fTotal) * 0.005);
  const cuadraPerfecto = diff <= toleranciaPermitida && candidatos.length > 0;

  return { candidatos, sumaAlbaranes, diferencia: diff, cuadraPerfecto };
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

  // ==========================================
  // DRAG & DROP
  // ==========================================
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

  // ==========================================
  // ATAJOS
  // ==========================================
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
        const matchResult = matchAlbaranesToFactura(draft, albaranesSeguros, superNorm(oficialName));
        return { ...draft, ...matchResult, prov: oficialName }; 
      });
    } catch (error) {
      console.error("Error en draftsIA:", error); return [];
    }
  }, [facturasSeguras, albaranesSeguros]);

  // ==========================================
  // 🤖 MOTOR OCR (Local)
  // ==========================================
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

  // ==========================================
  // 📧 LECTOR GMAIL (Supabase Seguro)
  // ==========================================
  const handleFetchEmails = async () => {
    setIsSyncing(true);
    try {
      const { data: correosBD, error } = await supabase.from('inbox_gmail').select('*').eq('status', 'new');
      if (error) throw error;
      
      if (correosBD && correosBD.length > 0) {
        const nuevosCorreos: EmailDraft[] = correosBD.map((fila: any) => ({
          id: fila.id, from: fila.remitente, subject: fila.asunto, date: fila.fecha ? fila.fecha.slice(0, 10) : DateUtil.today(),
          hasAttachment: true, status: 'new', fileBase64: fila.archivo_base64, fileName: fila.archivo_nombre
        }));

        setEmailInbox(prev => {
          const idsExistentes = new Set(prev.map(p => p.id));
          const unicos = nuevosCorreos.filter(m => !idsExistentes.has(m.id));
          return [...unicos, ...prev];
        });
        alert(`✅ Encontradas ${correosBD.length} facturas nuevas en el buzón IMAP.`);
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
      
      // Actualizamos en Supabase para no volver a leerlo
      await supabase.from('inbox_gmail').update({ status: 'parsed' }).eq('id', emailId);
      setEmailInbox(prev => prev.filter(e => e.id !== emailId));
      
    } catch (e: any) { alert("⚠️ Error al procesar el PDF del correo. Inténtalo de nuevo."); } 
    finally { setIsSyncing(false); }
  };

  // ==========================================
  // ⚙️ LÓGICA DE NEGOCIO Y GUARDADO (FASE 1)
  // ==========================================
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
      const q = deferredSearch ? superNorm(deferredSearch) : '';

      albaranesSeguros.forEach(a => {
        const aDate = a?.date || '';
        if (a?.invoiced || typeof aDate !== 'string' || !aDate.startsWith(year.toString())) return;
        
        const itemUnit = (a as any).unitId || 'REST';
        if (selectedUnit !== 'ALL' && itemUnit !== selectedUnit) return;
        
        const owner = (mode === 'proveedor' ? a?.prov : a?.socio) || 'Arume';
        
        if (q) {
            const matchOwner = superNorm(owner).includes(q);
            const matchNum = superNorm(a?.num || '').includes(q);
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

        const groupKey = `${superNorm(owner)}_${itemUnit}`;
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

  // Cierre Manual
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
        a.download = `${superNorm(f.prov||'factura')}_${f.num||'SN'}.pdf`;
        a.click();
    } catch(e) { alert("Error al descargar el archivo"); }
  };

  const renderPendingGroups = () => {
    if (!pendingGroups || pendingGroups.length === 0) {
      return (
        <div className="py-24 flex flex-col items-center justify-center bg-white rounded-[3rem] border border-slate-100 shadow-sm text-center">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6"><Package className="w-10 h-10 text-slate-300" /></div>
          <p className="text-slate-400 font-black text-sm uppercase tracking-widest">Todo al día</p>
          <p className="text-[11px] font-bold text-slate-400 mt-2">No hay albaranes sueltos en este periodo.</p>
        </div>
      );
    }
    
    return pendingGroups.map(([mk, dataGroup]) => (
      <div key={mk} className="mb-8 animate-fade-in bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-400" /> Mes de {dataGroup.name}
        </h3>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {Object.values(dataGroup.groups || {}).map((g: any) => {
            const unitConfig = BUSINESS_UNITS.find(u => u.id === g.unitId);
            return (
              <div key={g.label + g.unitId} onClick={() => { setSelectedGroup({ label: g.label, ids: g.ids, unitId: g.unitId }); setModalForm({ num: '', date: DateUtil.today(), selectedAlbs: [...g.ids], unitId: g.unitId }); }} className="flex justify-between items-center p-5 md:p-6 bg-slate-50 rounded-[2rem] border border-slate-200 hover:border-indigo-400 hover:shadow-lg transition cursor-pointer group">
                <div className="min-w-0 pr-4">
                  <p className="font-black text-slate-800 text-lg md:text-xl group-hover:text-indigo-600 transition truncate">{g.label}</p>
                  <div className="flex items-center gap-2 mt-2">
                    {unitConfig && <span className={cn("text-[9px] px-3 py-1 rounded-lg uppercase tracking-widest font-black shadow-sm", unitConfig.bg, unitConfig.color)}>{unitConfig.name}</span>}
                    <span className="px-3 py-1 bg-white text-slate-500 rounded-lg text-[9px] font-black uppercase border border-slate-200">{g.count} Albaranes</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-black text-slate-900 text-2xl md:text-3xl tracking-tighter">{Num.fmt(g.t)}</p>
                  <p className="text-[10px] font-bold text-indigo-400 group-hover:text-indigo-600 group-hover:underline mt-2 flex items-center justify-end gap-1 uppercase tracking-widest">AGRUPAR <ArrowRight className="w-3 h-3" /></p>
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
    <div className="animate-fade-in space-y-6 pb-24 min-h-screen relative max-w-[1600px] mx-auto">
      
      {/* OVERLAY DRAG & DROP PREMIUM */}
      <AnimatePresence>
        {isDragging && (
          <motion.div data-test-id="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[999] pointer-events-none flex items-center justify-center">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
            <div className="relative z-10 w-full max-w-2xl mx-4 border-[6px] border-dashed border-white/50 rounded-[4rem] flex flex-col items-center justify-center bg-indigo-500/20 aspect-video shadow-2xl overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-t from-indigo-600/40 to-transparent"></div>
              <motion.div animate={{ y: [0, -15, 0] }} transition={{ repeat: Infinity, duration: 2 }} className="bg-white p-10 rounded-full shadow-2xl relative z-10 mb-8">
                <FileDown className="w-20 h-20 text-indigo-600" />
              </motion.div>
              <h2 className="text-5xl font-black text-white tracking-tighter drop-shadow-md relative z-10">Suelta tu Factura</h2>
              <p className="text-sm font-bold text-indigo-100 uppercase tracking-[0.3em] mt-4 relative z-10">La IA se encarga del resto</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* CABECERA */}
      <header className="bg-white rounded-[3rem] border border-slate-100 shadow-sm p-8 flex flex-col xl:flex-row justify-between gap-6 relative z-10 items-center">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-indigo-600 rounded-[1.5rem] flex items-center justify-center shadow-lg shadow-indigo-200">
            <FileSpreadsheet className="w-7 h-7 text-white" />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-800 tracking-tighter">Buzón & Facturas</h2>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Conciliación 3-Way Match</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={handleFetchEmails} disabled={isSyncing} className="px-6 py-4 rounded-2xl text-[11px] font-black bg-blue-50 text-blue-600 hover:bg-blue-100 hover:shadow-md transition flex items-center gap-2 border border-blue-200">
            {isSyncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Inbox className="w-4 h-4" />} VER CORREOS IMAP
          </button>
          
          <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf, image/*" onChange={(e) => { if (e.target.files && e.target.files[0]) { processLocalFile(e.target.files[0]); e.target.value = ''; } }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={isSyncing} className="px-6 py-4 rounded-2xl text-[11px] font-black bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg transition flex items-center gap-2">
            {isSyncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <UploadCloud className="w-4 h-4" />} SUBIR PDF
          </button>
          
          <button onClick={() => setIsExportModalOpen(true)} className="px-6 py-4 rounded-2xl text-[11px] font-black bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-lg transition flex items-center gap-2">
            <Download className="w-4 h-4" /> EXPORTAR
          </button>
        </div>
      </header>

      {/* CONTROLES STICKY */}
      <div className="sticky top-4 z-40">
        <div className="bg-white/90 backdrop-blur-xl px-5 py-4 rounded-[2.5rem] shadow-xl border border-slate-200 flex flex-col xl:flex-row items-center justify-between gap-4">
          
          <div className="flex items-center bg-slate-100 p-1.5 rounded-[1.5rem] w-full xl:w-auto overflow-x-auto no-scrollbar">
            <button onClick={() => setActiveTab('pend')} className={cn("flex-1 px-6 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition", activeTab === 'pend' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600")}>
              📦 Albaranes Sueltos
            </button>
            <button onClick={() => setActiveTab('hist')} className={cn("flex-1 px-6 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition", activeTab === 'hist' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600")}>
              💰 Histórico Facturas
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200">
              <button onClick={() => setMode('proveedor')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition", mode === 'proveedor' ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600")}>Prov</button>
              <button onClick={() => setMode('socio')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition", mode === 'socio' ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600")}>Socio</button>
            </div>

            <select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value as any)} className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-[11px] font-black uppercase tracking-widest outline-none text-slate-600 focus:ring-2 ring-indigo-200 transition">
              <option value="ALL">Todas las unidades</option>
              <option value="REST">Restaurante</option>
              <option value="DLV">Catering</option>
              <option value="SHOP">Tienda</option>
              <option value="CORP">Socios/Corp</option>
            </select>

            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-2xl">
              <button className="p-3 text-indigo-600 hover:bg-indigo-100 rounded-l-2xl transition" onClick={() => setYear(y => y - 1)}><ChevronLeft className="w-4 h-4"/></button>
              <span className="px-3 text-sm font-black text-slate-700">{year}</span>
              <button className="p-3 text-indigo-600 hover:bg-indigo-100 rounded-r-2xl transition" onClick={() => setYear(y => y + 1)}><ChevronRight className="w-4 h-4"/></button>
            </div>

            <div className="relative flex-1 md:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar proveedor o Ref..." className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs font-bold outline-none focus:bg-white focus:ring-2 ring-indigo-200 transition" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 relative z-10">
        {/* COLUMNA IZQUIERDA: CONTENIDO PRINCIPAL */}
        <section className="xl:col-span-8 space-y-6">
          {activeTab === 'hist' && (
            <div className="flex flex-wrap gap-2 px-2">
              {[
                { id: 'all', label: 'Todas las facturas', color: 'text-slate-500' },
                { id: 'pending', label: '⏳ Pendientes', color: 'text-amber-600' },
                { id: 'paid', label: '✔️ Pagadas Efectivo', color: 'text-emerald-600' },
                { id: 'reconciled', label: '🔗 Banco', color: 'text-blue-600' }
              ].map(chip => (
                <button type="button" key={chip.id} onClick={() => setFilterStatus(chip.id as any)} className={cn("px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border-2 transition-all", filterStatus === chip.id ? "bg-indigo-600 text-white border-indigo-600" : cn("bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300", chip.color))}>{chip.label}</button>
              ))}
            </div>
          )}

          {activeTab === 'pend' ? renderPendingGroups() : (
            <InvoicesList facturas={facturasSeguras} searchQ={deferredSearch} selectedUnit={selectedUnit} mode={mode} filterStatus={filterStatus} year={year} businessUnits={BUSINESS_UNITS} sociosReales={SOCIOS_REALES_NAMES} superNorm={superNorm} onOpenDetail={setSelectedInvoice as any} onTogglePago={handleTogglePago} onDelete={handleDeleteFactura} />
          )}
        </section>

        {/* COLUMNA DERECHA: SIDEBAR DE BANDEJAS */}
        <aside className="xl:col-span-4">
          <div className="sticky top-32 space-y-6">
            
            {/* BANDEJA IMAP */}
            {emailInbox.length > 0 && (
              <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-blue-500"></div>
                <h4 className="text-base font-black text-slate-800 mb-1 flex items-center gap-2"><Inbox className="w-5 h-5 text-blue-500"/> Correos Recibidos</h4>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5">PDFs pendientes de abrir</p>
                <div className="space-y-3">
                  {emailInbox.map(mail => (
                    <div key={mail.id} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl hover:border-blue-300 transition group">
                      <div className="flex justify-between items-start">
                        <div className="min-w-0 pr-2">
                          <p className="text-sm font-black text-slate-800 truncate">{mail.from}</p>
                          <p className="text-[10px] font-bold text-slate-500 truncate mt-1">{mail.subject}</p>
                        </div>
                        <span className="text-[9px] font-black text-blue-400 bg-blue-50 px-2 py-1 rounded-md">{mail.date}</span>
                      </div>
                      <button onClick={() => handleParseEmail(mail.id)} disabled={isSyncing} className="w-full mt-4 bg-white border-2 border-blue-100 text-blue-600 font-black text-[10px] uppercase tracking-widest py-3 rounded-xl hover:bg-blue-50 hover:border-blue-200 disabled:opacity-50 transition flex items-center justify-center gap-2">
                        {isSyncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>} Extraer PDF con IA
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AUDITORÍA IA (BORRADORES) */}
            <div className={cn("p-6 rounded-[2.5rem] border shadow-sm relative overflow-hidden transition-all duration-500", draftsIA.length > 0 ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
              {draftsIA.length > 0 && <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-emerald-500"></div>}
              
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h4 className={cn("text-base font-black flex items-center gap-2", draftsIA.length > 0 ? "text-white" : "text-slate-800")}>
                    <Sparkles className={cn("w-5 h-5", draftsIA.length > 0 ? "text-purple-400" : "text-slate-400")}/> Bandeja IA
                  </h4>
                  <p className={cn("text-[10px] font-black uppercase tracking-[0.2em] mt-1", draftsIA.length > 0 ? "text-slate-400" : "text-slate-400")}>
                    Factura vs Albaranes
                  </p>
                </div>
                {draftsIA.length > 0 && <span className="bg-purple-500/20 text-purple-300 px-3 py-1 rounded-lg text-xs font-black">{draftsIA.length}</span>}
              </div>

              {draftsIA.length > 0 ? (
                <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                  {draftsIA.map(d => (
                    <div key={d.id} className="bg-slate-800 p-5 rounded-2xl border border-slate-700 hover:border-purple-500/50 transition">
                      <div className="flex justify-between items-start mb-3">
                        <div className="min-w-0 pr-2">
                          <span className="font-black text-white block truncate text-base">{d.prov || 'Desconocido'}</span>
                          <span className="text-[10px] text-slate-400 font-mono mt-1 block">{d.date} · Ref: {d.num}</span>
                        </div>
                        <button onClick={() => handleDiscardDraftIA(d.id)} className="text-slate-500 hover:text-rose-400 transition bg-slate-900 p-2 rounded-xl"><Trash2 className="w-4 h-4"/></button>
                      </div>
                      
                      <div className="flex justify-between items-end mt-4 p-4 bg-slate-900 rounded-xl border border-slate-800">
                        <div>
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Factura</p>
                          <span className="text-2xl font-black text-white">{Num.fmt(d.total)}</span>
                        </div>
                        <div className="text-right">
                          {d.cuadraPerfecto ? (
                            <span className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1"><Check className="w-3 h-3"/> Cuadra</span>
                          ) : (
                            <div>
                               <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">Descuadre</p>
                               <span className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-amber-500/20 text-amber-400 border border-amber-500/30">{Num.fmt(d.diferencia)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <button onClick={() => handleConfirmAuditoriaIA(d.id)} disabled={isProcessing} className="w-full mt-4 py-3.5 bg-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-400 disabled:opacity-50 transition flex justify-center items-center gap-2">
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>} Confirmar y Crear
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center opacity-60 py-8">
                  <FileText className="w-10 h-10 mx-auto text-slate-300 mb-4" />
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Sin Borradores</p>
                  <p className="text-[10px] text-slate-400 mt-2 font-bold px-4">Sube un PDF o sincroniza el correo para que la IA trabaje por ti.</p>
                </div>
              )}
            </div>

          </div>
        </aside>
      </div>

      {/* MODALES */}
      <AnimatePresence>
        {isExportModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex justify-center items-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white w-full max-w-sm rounded-[3rem] p-8 shadow-2xl relative z-10 border border-slate-100">
              <h3 className="text-2xl font-black text-slate-800 mb-1 tracking-tighter">Exportar</h3>
              <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mb-8">Generar Excel para Gestoría</p>
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 block mb-2">Año Fiscal</label>
                  <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-base font-black outline-none focus:ring-2 ring-indigo-200" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 block mb-2">Trimestre</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map(q => (<button key={q} onClick={() => setExportQuarter(q)} className={cn("py-4 rounded-2xl text-xs font-black transition", exportQuarter === q ? "bg-indigo-600 text-white shadow-lg" : "bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100")}>Q{q}</button>))}
                  </div>
                </div>
                <div className="pt-4 border-t border-slate-100">
                  <button onClick={handleExportGestoria} className="w-full bg-emerald-600 text-white py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-200 hover:bg-emerald-500 active:scale-95 transition flex justify-center items-center gap-2"><Download className="w-4 h-4" /> DESCARGAR EXCEL</button>
                  <button onClick={() => setIsExportModalOpen(false)} className="w-full text-slate-400 text-[11px] font-black uppercase tracking-widest py-4 hover:text-slate-600 mt-2 transition">Cancelar</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedGroup && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex justify-center items-center p-4 sm:p-6 bg-slate-900/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white w-full max-w-3xl rounded-[3rem] p-6 md:p-10 shadow-2xl relative z-10 flex flex-col max-h-[90vh] border border-slate-100">
              <button onClick={() => setSelectedGroup(null)} className="absolute top-6 right-6 p-3 bg-slate-50 rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition hover:rotate-90"><X className="w-5 h-5"/></button>
              
              <div className="border-b border-slate-100 pb-6 mb-6 flex flex-col md:flex-row justify-between md:items-end gap-4 pr-12">
                <div>
                  <p className="text-[11px] font-black text-indigo-500 uppercase tracking-[0.2em] mb-2 flex items-center gap-2"><Layers className="w-4 h-4"/> Agrupación Manual</p>
                  <h3 className="text-3xl md:text-4xl font-black text-slate-800 tracking-tighter">{selectedGroup.label}</h3>
                </div>
                <button onClick={() => { const allIds = selectedGroup.ids; setModalForm(p => ({...p, selectedAlbs: p.selectedAlbs.length === allIds.length ? [] : allIds })) }} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-600 bg-slate-100 border border-slate-200 px-4 py-3 rounded-xl hover:bg-slate-200 transition shrink-0"><CheckSquare className="w-4 h-4" />{modalForm.selectedAlbs.length === selectedGroup.ids.length ? 'Desmarcar Todos' : 'Marcar Todos'}</button>
              </div>
              
              <div className="space-y-3 flex-1 overflow-y-auto pr-2 custom-scrollbar bg-slate-50/50 rounded-[2rem] p-6 border border-slate-100">
                {(albaranesSeguros).filter(a => selectedGroup.ids.includes(a.id)).map(a => (
                  <label key={a.id} className={cn("flex justify-between items-center p-5 rounded-2xl cursor-pointer transition-all border-2", modalForm.selectedAlbs.includes(a.id) ? "bg-white border-indigo-400 shadow-md" : "bg-transparent border-transparent hover:bg-white hover:border-slate-200")}>
                    <div className="flex items-center gap-5">
                      <div className="relative flex items-center justify-center"><input type="checkbox" checked={modalForm.selectedAlbs.includes(a.id)} onChange={(e) => { const newSelected = e.target.checked ? [...modalForm.selectedAlbs, a.id] : modalForm.selectedAlbs.filter(id => id !== a.id); setModalForm({ ...modalForm, selectedAlbs: newSelected }); }} className="w-6 h-6 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer accent-indigo-600" /></div>
                      <div>
                        <p className="font-black text-slate-800 text-base">{a.date}</p>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-1">Ref: <span className="font-mono text-slate-500">{a.num || 'S/N'}</span></p>
                      </div>
                    </div>
                    <p className="font-black text-slate-900 text-2xl tracking-tighter">{Num.fmt(a.total)}</p>
                  </label>
                ))}
              </div>
              
              <div className="mt-8 space-y-6">
                <div className="flex flex-col md:flex-row items-center justify-between bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
                  <div className="absolute right-0 top-0 w-32 h-32 bg-indigo-500 rounded-full blur-3xl opacity-20"></div>
                  <div className="relative z-10 w-full text-center md:text-left mb-4 md:mb-0">
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 block mb-2">Total Consolidado</span>
                    <span className="text-xs text-indigo-300 font-bold bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 rounded-xl">{modalForm.selectedAlbs.length} albaranes sumados</span>
                  </div>
                  <span className="text-5xl md:text-6xl font-black text-emerald-400 tracking-tighter relative z-10">{Num.fmt(modalForm.selectedAlbs.reduce((acc, id) => { const alb = albaranesSeguros.find(a => a.id === id); return acc + (Num.parse(alb?.total) || 0); }, 0))}</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mode === 'socio' ? (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 block mb-2">Responsable (Socio)</label>
                      <select value={modalForm.num.startsWith('SOCIO-') ? modalForm.num.split('-')[1] : ''} onChange={(e) => { const socio = e.target.value; setModalForm({ ...modalForm, num: `LIQ-${socio}-${modalForm.date.replace(/-/g,'')}` }); setSelectedGroup(prev => prev ? { ...prev, label: socio } : null); }} className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-slate-800 outline-none focus:bg-white focus:border-indigo-400 transition cursor-pointer">
                        <option value="">-- Selecciona --</option>{SOCIOS_REALES_NAMES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 block mb-2">Nº Factura Oficial</label>
                      <input type="text" value={modalForm.num} onChange={(e) => setModalForm({ ...modalForm, num: e.target.value })} placeholder="Ej: F-2026/012" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-slate-800 outline-none focus:bg-white focus:border-indigo-400 transition" />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 block mb-2">Fecha Emisión</label>
                    <input type="date" value={modalForm.date} onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })} className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-slate-800 outline-none focus:bg-white focus:border-indigo-400 transition cursor-pointer" />
                  </div>
                </div>
                
                <button onClick={handleConfirmManualInvoice} disabled={modalForm.selectedAlbs.length === 0 || isProcessing} className="w-full bg-indigo-600 text-white py-6 rounded-[2.5rem] font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-indigo-200 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition flex justify-center items-center gap-3">
                  {isProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-6 h-6"/>} CERRAR Y FACTURAR
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
