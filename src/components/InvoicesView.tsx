import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  FileText, Search, ChevronLeft, ChevronRight, Zap, Users, Building2, Package, CheckCircle2, Clock, Trash2, AlertCircle, Link as LinkIcon, Mail, ArrowRight, X, RefreshCw, Download, Bell, CheckSquare, Hotel, ShoppingBag, Layers, UploadCloud, FileDown, FileArchive
} from 'lucide-react';

import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";

import { AppData, Factura, Albaran } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { NotificationService } from '../services/notifications';

// 🚀 IMPORTAMOS NUESTROS COMPONENTES SEPARADOS
import { InvoicesList } from '../components/InvoicesList';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';

// 🚀 TIPOS B2B
export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

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

// 🚀 SUPER NORMALIZADOR (Blindado)
export const superNorm = (s: string | undefined | null) => {
  if (!s || typeof s !== 'string') return 'desconocido';
  try {
    return s.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
      .replace(/\b(s\.?l\.?|s\.?a\.?|s\.?l\.?u\.?|s\.?c\.?p\.?)\b/gi, '') 
      .replace(/[^a-z0-9]/g, '') 
      .trim();
  } catch (e) {
    return 'desconocido';
  }
};

export const InvoicesView = ({ data, onSave }: InvoicesViewProps) => {
  // ✅ MODO SEGURO EXTREMO
  const safeData = data || {};
  const facturasSeguras = Array.isArray(safeData.facturas) ? safeData.facturas : [];
  const albaranesSeguros = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  const sociosSeguros = Array.isArray(safeData.socios) ? safeData.socios : [];
  
  // ✅ CONEXIÓN A LA NUEVA BASE DE DATOS DE SOCIOS (Soluciona Error 7)
  const SOCIOS_REALES = sociosSeguros.filter(s => s?.active).map(s => s?.n) || ['PAU', 'JERONI', 'AGNES', 'ONLY ONE', 'TIENDA DE SAKES'];

  const [activeTab, setActiveTab] = useState<'pend' | 'hist'>('pend');
  const [mode, setMode] = useState<'proveedor' | 'socio'>('proveedor');
  const [year, setYear] = useState(new Date().getFullYear());
  const [searchQ, setSearchQ] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid' | 'reconciled'>('all');
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL');
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportQuarter, setExportQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  
  // 🛡️ DRAG & DROP STATE
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  // Modal State
  const [selectedGroup, setSelectedGroup] = useState<{ label: string; ids: string[], unitId: BusinessUnit } | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Factura | null>(null);
  const [modalForm, setModalForm] = useState({ 
    num: '', 
    date: DateUtil.today(), 
    selectedAlbs: [] as string[],
    unitId: 'REST' as BusinessUnit
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 🛡️ DRAG & DROP HANDLERS SEGUROS
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      dragDepth.current = 0;
      setIsDragging(false);
    };

    const onWindowDragLeave = (e: DragEvent) => {
      const out = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
      if (out) { dragDepth.current = 0; setIsDragging(false); }
    };

    window.addEventListener('dragend', handleGlobalDragEnd);
    window.addEventListener('drop', handleGlobalDragEnd);
    window.addEventListener('dragleave', onWindowDragLeave);
    
    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd);
      window.removeEventListener('drop', handleGlobalDragEnd);
      window.removeEventListener('dragleave', onWindowDragLeave);
    };
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const t = setTimeout(() => {
      dragDepth.current = 0;
      setIsDragging(false);
    }, 4000);
    return () => clearTimeout(t);
  }, [isDragging]);

  // --- IA AUDIT ENGINE (Blindado) ---
  const draftsIA = useMemo(() => {
    try {
      return facturasSeguras.filter(f => f?.status === 'draft').map(draft => {
        // Protección contra fechas vacías
        const draftDate = draft?.date || DateUtil.today();
        const mesDraft = draftDate.substring(0, 7);
        const provDraftNormalizado = superNorm(draft?.prov); 
        
        const albaranesCandidatos = albaranesSeguros.filter(a => 
          !a?.invoiced && 
          superNorm(a?.prov) === provDraftNormalizado && 
          (a?.date || '').startsWith(mesDraft)
        );

        const sumaAlbaranes = albaranesCandidatos.reduce((acc, a) => acc + (Num.parse(a?.total) || 0), 0);
        const totalDraft = Num.parse(draft?.total) || 0;
        const diferencia = Math.abs(sumaAlbaranes - Math.abs(totalDraft));
        const cuadraPerfecto = diferencia < 0.05 && albaranesCandidatos.length > 0;

        return {
          ...draft,
          candidatos: albaranesCandidatos,
          sumaAlbaranes,
          diferencia,
          cuadraPerfecto
        };
      });
    } catch (e) {
      console.error("Error en draftsIA:", e);
      return [];
    }
  }, [facturasSeguras, albaranesSeguros]);

  const handleSyncIA = async () => {
    setIsSyncing(true);
    try {
      const webhookN8N = safeData?.config?.n8nUrlIA || "https://ia.permatunnelopen.org/webhook/forzar-facturas";
      await proxyFetch(webhookN8N, { method: "POST" });
      alert("Sincronización con n8n lanzada.");
    } catch (err) {
      alert("Error conectando con la IA en n8n.");
    } finally {
      setIsSyncing(false);
    }
  };

  // 🚀 LECTOR DE PDF / IMÁGENES NATIVO
  const processLocalFile = async (file: File) => {
    const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
    setIsSyncing(true); 

    try {
      if (!apiKey) throw new Error("NO_API_KEY");

      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string); 
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
      });
      
      const soloBase64 = fileBase64.split(',')[1];

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Analiza esta factura. Devuelve SOLO un JSON estricto con los datos extraídos:
      {
        "proveedor": "Nombre de la empresa",
        "num": "Número de factura (ej: F-2024-001)",
        "fecha": "YYYY-MM-DD",
        "total": 150.50,
        "base": 124.38,
        "iva": 26.12
      }
      Si no ves algún dato, déjalo vacío o en 0.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: soloBase64, mimeType: file.type } }] }],
        config: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const cleanText = (response.text || "").replace(/(?:json)?/gi, '').replace(/```/g, '').trim();
      const rawJson = JSON.parse(cleanText);

      const newData = { ...safeData, facturas: [...facturasSeguras] };

      newData.facturas.push({
        id: 'draft-local-' + Date.now(),
        num: rawJson.num || 'S/N',
        date: rawJson.fecha || DateUtil.today(),
        prov: rawJson.proveedor || 'Proveedor Desconocido',
        total: String(rawJson.total || 0),
        base: String(rawJson.base || 0),
        tax: String(rawJson.iva || 0),
        paid: false,
        reconciled: false,
        source: 'email-ia',
        status: 'draft',
        unidad_negocio: 'REST',
        file_base64: fileBase64 
      });

      await onSave(newData);
      alert("✅ Factura procesada al instante por la IA y Documento Guardado. Búscala en los borradores.");

    } catch (e) {
      console.warn("⚠️ Gemini falló. Activando el Plan B de Emergencia...");
      
      try {
        let extractedText = "";
        let possibleTotal = 0;

        const fileBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
        });

        if (file.type.includes('image')) {
           const tesseractModule = await import('tesseract.js');
           const Tesseract = tesseractModule.default || tesseractModule;
           const { data: { text } } = await Tesseract.recognize(file, 'spa');
           extractedText = text;
        } else if (file.type === 'application/pdf') {
           const pdfjsModule = await import('pdfjs-dist');
           const pdfjsLib = pdfjsModule.default || pdfjsModule;
           pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
           
           const arrayBuffer = await file.arrayBuffer();
           const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
           
           for (let i = 1; i <= pdfDoc.numPages; i++) {
             const page = await pdfDoc.getPage(i);
             const textContent = await page.getTextContent();
             extractedText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
           }
        } 
        
        const matches = extractedText.match(/(\d+([.,]\d{2}))/g);
        if (matches) {
            const nums = matches.map(m => parseFloat(m.replace(',', '.')));
            const validNums = nums.filter(n => n < 50000);
            possibleTotal = validNums.length > 0 ? Math.max(...validNums) : 0;
        }
        
        const newData = { ...safeData, facturas: [...facturasSeguras] };
        
        newData.facturas.push({
          id: 'draft-fallback-' + Date.now(),
          num: 'REVISAR MANUAL',
          date: DateUtil.today(),
          prov: file.type.includes('image') ? '📷 OCR Emergencia' : `📄 PDF Rescatado`,
          total: String(possibleTotal || 0),
          base: String(possibleTotal ? (possibleTotal / 1.10).toFixed(2) : 0),
          tax: String(possibleTotal ? (possibleTotal - (possibleTotal / 1.10)).toFixed(2) : 0),
          paid: false,
          reconciled: false,
          source: 'email-ia',
          status: 'draft',
          unidad_negocio: 'REST',
          file_base64: fileBase64 
        });

        await onSave(newData);
        alert(`⚠️ Los tokens de la IA se agotaron.\nPero el Sistema de Rescate ha leído el archivo y creado un borrador. El archivo original está guardado.`);

      } catch (fallbackErr) {
        console.error(fallbackErr);
        alert("⚠️ Error crítico: Ni la IA ni el Lector de Emergencia pudieron procesar este archivo.");
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDownloadFile = (factura: Factura) => {
    if (!factura?.file_base64) {
      alert("Lo siento, no hay documento original guardado para esta factura.");
      return;
    }

    try {
      const a = document.createElement('a');
      a.href = factura.file_base64;
      
      let ext = "pdf";
      if (factura.file_base64.includes('image/jpeg')) ext = "jpg";
      if (factura.file_base64.includes('image/png')) ext = "png";

      const safeProvName = (factura.prov || 'Factura').replace(/[^a-z0-9]/gi, '_');
      const safeNum = (factura.num || 'SN').replace(/[^a-z0-9]/gi, '_');
      
      a.download = `Factura_${safeProvName}_${safeNum}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error(e);
      alert("Hubo un error al intentar descargar el archivo.");
    }
  };

  // ... Drag and drop handlers ...
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); dragDepth.current += 1; if (e.dataTransfer.items && e.dataTransfer.items.length > 0) { if (!isDragging) setIsDragging(true); } };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); dragDepth.current -= 1; if (dragDepth.current <= 0) { setIsDragging(false); dragDepth.current = 0; } };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragDepth.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        processLocalFile(file);
      } else { alert("⚠️ Solo se permiten archivos PDF o imágenes."); }
    }
  };

  const handleConfirmAuditoriaIA = async (draftId: string) => {
    const newData = { ...safeData, facturas: [...facturasSeguras], albaranes: [...albaranesSeguros] };
    const draftIdx = newData.facturas.findIndex(f => f.id === draftId);
    const audit = draftsIA.find(d => d.id === draftId);
    
    if (draftIdx === -1 || !audit) return;

    let unitToAssign: BusinessUnit = 'REST'; 

    if (audit.candidatos && audit.candidatos.length > 0) {
      const idsVincular = audit.candidatos.map((a: any) => a.id);
      newData.albaranes = newData.albaranes.map(a => 
        idsVincular.includes(a.id) ? { ...a, invoiced: true } : a
      );
      newData.facturas[draftIdx].albaranIdsArr = idsVincular;
      newData.facturas[draftIdx].albaranIds = idsVincular.join(',');
      
      unitToAssign = (audit.candidatos[0] as any).unitId || 'REST';
    }

    newData.facturas[draftIdx].status = 'approved'; // Pendiente de pago
    newData.facturas[draftIdx].source = 'email-ia';
    newData.facturas[draftIdx].unidad_negocio = unitToAssign; 
    await onSave(newData);
  };

  const handleDiscardDraftIA = async (id: string) => {
    if (!window.confirm("¿Eliminar factura leída por IA?")) return;
    const newData = { ...safeData, facturas: facturasSeguras.filter(f => f.id !== id) };
    await onSave(newData);
  };

  const handleExportGestoria = () => {
    try {
      const q = exportQuarter;
      const y = year;
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      
      const filtered = facturasSeguras.filter(f => {
        if (f?.status === 'draft') return false;
        if (selectedUnit !== 'ALL' && f?.unidad_negocio !== selectedUnit) return false;
        const dateStr = f?.date || '';
        const [fYear, fMonth] = dateStr.split('-').map(Number);
        return fYear === y && fMonth >= startMonth && fMonth <= endMonth;
      });

      if (filtered.length === 0) return alert("No hay facturas en este periodo para la unidad seleccionada.");

      const rows = filtered.map(f => {
        const total = Math.abs(Num.parse(f?.total) || 0);
        const taxRate = 0.10; 
        const base = Num.parse(f?.base) || (total / (1 + taxRate));
        const tax = Num.parse(f?.tax) || (total - base);
        
        return {
          'FECHA': f?.date || '',
          'Nº FACTURA': f?.num || '',
          'PROVEEDOR/CLIENTE': f?.prov || f?.cliente || '—',
          'UNIDAD NEGOCIO': BUSINESS_UNITS.find(u => u.id === f?.unidad_negocio)?.name || 'Restaurante',
          'BASE IMPONIBLE': Num.fmt(base),
          'IVA': Num.fmt(tax),
          'TOTAL': Num.fmt(total),
          'ESTADO': f?.paid ? 'PAGADA' : 'PENDIENTE',
          'CONCILIADA': f?.reconciled ? 'SÍ' : 'NO'
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Facturas");
      XLSX.writeFile(wb, `Gestoria_Arume_${y}_Q${q}_${selectedUnit}.xlsx`);
      setIsExportModalOpen(false);
    } catch (e) {
      console.error("Error al exportar:", e);
      alert("Hubo un error al generar el Excel.");
    }
  };

  // --- MANUAL GROUPING (Blindado) ---
  const pendingGroups = useMemo(() => {
    try {
      const albs = albaranesSeguros.filter(a => {
        if (a?.invoiced || !(a?.date || '').startsWith(year.toString())) return false;
        const itemUnit = (a as any).unitId || 'REST';
        if (selectedUnit !== 'ALL' && itemUnit !== selectedUnit) return false;
        
        const owner = (mode === 'proveedor' ? a?.prov : a?.socio) || 'Arume';
        const searchNorm = superNorm(searchQ);
        if (searchQ && !superNorm(owner).includes(searchNorm) && !superNorm(a?.num || '').includes(searchNorm)) return false;
        return true;
      });

      const byMonth: Record<string, { name: string; groups: Record<string, any> }> = {};
      
      albs.forEach(a => {
        const mk = (a?.date || '').substring(0, 7);
        if (!mk) return;

        if (!byMonth[mk]) {
          const parts = mk.split('-');
          if (parts.length !== 2) return;
          const [y, m] = parts;
          const names = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
          const mInt = parseInt(m);
          byMonth[mk] = { name: `${mInt >= 1 && mInt <= 12 ? names[mInt] : m} ${y}`, groups: {} };
        }

        const rawOwner = (mode === 'proveedor') ? (a?.prov || 'Sin Proveedor') : (a?.socio || 'PENDIENTE');
        const ownerKey = superNorm(rawOwner); 
        
        const unitId = (a as any).unitId || 'REST';
        const groupKey = `${ownerKey}_${unitId}`;

        if (!byMonth[mk].groups[groupKey]) {
          byMonth[mk].groups[groupKey] = { label: rawOwner, unitId: unitId, t: 0, ids: [], count: 0 };
        }
        
        byMonth[mk].groups[groupKey].t += (Num.parse(a?.total) || 0);
        byMonth[mk].groups[groupKey].count += 1;
        byMonth[mk].groups[groupKey].ids.push(a?.id);
      });

      return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
    } catch (e) {
      console.error("Error en pendingGroups:", e);
      return [];
    }
  }, [albaranesSeguros, year, mode, searchQ, selectedUnit]);

  const handleOpenGroup = (label: string, ids: string[], unitId: BusinessUnit) => {
    setSelectedGroup({ label, ids, unitId });
    setModalForm({
      num: '',
      date: DateUtil.today(),
      selectedAlbs: [...ids],
      unitId: unitId
    });
  };

  const handleToggleAllAlbs = () => {
    if (!selectedGroup) return;
    if (modalForm.selectedAlbs.length === selectedGroup.ids.length) {
      setModalForm({ ...modalForm, selectedAlbs: [] });
    } else {
      setModalForm({ ...modalForm, selectedAlbs: [...selectedGroup.ids] });
    }
  };

  const handleConfirmManualInvoice = async () => {
    if (!modalForm.num.trim()) return alert("Por favor, introduce el número de factura oficial.");
    if (modalForm.selectedAlbs.length === 0) return alert("Debes seleccionar al menos un albarán.");

    const newData = { ...safeData, albaranes: [...albaranesSeguros], facturas: [...facturasSeguras] };
    const ownerLabel = selectedGroup?.label || '';

    let totalFactura = 0;
    
    newData.albaranes = newData.albaranes.map(a => {
      if (modalForm.selectedAlbs.includes(a.id)) {
        totalFactura += Num.parse(a.total) || 0;
        return { ...a, invoiced: true };
      }
      return a;
    });

    newData.facturas.push({
      id: 'fac-' + Date.now() + Math.random().toString(36).slice(2,5),
      num: modalForm.num,
      date: modalForm.date,
      prov: mode === 'proveedor' ? ownerLabel : 'Varios',
      cliente: mode === 'socio' ? ownerLabel : 'Arume',
      total: Math.abs(Math.round(totalFactura * 100) / 100).toString(),
      albaranIdsArr: modalForm.selectedAlbs,
      paid: false,
      reconciled: false,
      source: 'manual-group',
      status: 'approved', // Factura generada y pendiente de pago
      unidad_negocio: modalForm.unitId 
    });

    await onSave(newData);
    setSelectedGroup(null);
  };

  // 🚀 LÓGICA ERP: Control de Pagos y Estados
  const handleTogglePago = async (id: string) => {
    const newData = { ...safeData, facturas: [...facturasSeguras] };
    const idx = newData.facturas.findIndex(f => f.id === id);
    
    if (idx !== -1) {
      const factura = newData.facturas[idx];
      
      if (factura.reconciled) {
        alert("🔒 ACCIÓN DENEGADA: Esta factura ya está conciliada con el Banco. Para modificarla, desvincúlala primero en el módulo de Tesorería.");
        return;
      }

      const isCurrentlyPaid = factura.paid;
      
      factura.paid = !isCurrentlyPaid;
      
      if (!isCurrentlyPaid) {
        factura.status = 'paid';
        factura.fecha_pago = DateUtil.today();
      } else {
        factura.status = 'approved'; 
        factura.fecha_pago = undefined;
      }

      await onSave(newData);
    }
  };

  // 🛡️ UX SEGURA: Confirmación antes de borrar
  const handleDeleteFactura = async (id: string) => {
    const fac = facturasSeguras.find(f => f.id === id);
    if (!fac) return;
    
    if (fac.reconciled) {
      alert("⚠️ No puedes borrar una factura que ya ha sido procesada y validada por el Banco.");
      return;
    }
    
    const isConfirmed = window.confirm(`🛑 ¿Estás seguro de que deseas ELIMINAR DEFINITIVAMENTE la factura ${fac.num || 'sin número'} de ${fac.prov || fac.cliente}? \n\nLos albaranes vinculados volverán a quedar libres y pendientes de facturar.`);
    
    if (!isConfirmed) return;

    const newData = { ...safeData, facturas: [...facturasSeguras], albaranes: [...albaranesSeguros] };
    const ids = fac.albaranIdsArr || [];
    
    newData.albaranes = newData.albaranes.map(a => ids.includes(a.id) ? { ...a, invoiced: false } : a);
    newData.facturas = newData.facturas.filter(f => f.id !== id);
    
    await onSave(newData);
  };

  const notifyOverdue = async () => {
    try {
      const todayStr = DateUtil.today();
      const overdue = facturasSeguras.filter(f => 
        !f?.paid && 
        f?.dueDate && 
        f?.dueDate < todayStr && 
        f?.status !== 'draft'
      );

      if (overdue.length > 0) {
        const msg = `🔔 *FACTURAS VENCIDAS*\n\nHay ${overdue.length} facturas pendientes de pago pasadas de fecha:\n` +
          overdue.slice(0, 5).map(f => `- ${f?.prov}: ${Num.fmt(f?.total)} (Venció: ${f?.dueDate})`).join('\n') +
          (overdue.length > 5 ? `\n...y ${overdue.length - 5} más.` : '');
        
        if (NotificationService && NotificationService.sendAlert) {
            await NotificationService.sendAlert(safeData, msg, 'WARNING');
            alert("Alerta de vencimientos enviada a Telegram.");
        } else {
            alert("Alerta local: Tienes facturas vencidas.");
        }
      } else {
        alert("No hay facturas vencidas hoy.");
      }
    } catch (e) {
      console.error(e);
      alert("Error al comprobar vencimientos.");
    }
  };

  // 🛡️ TRY/CATCH GLOBAL EN RENDERIZADO PARA EVITAR PANTALLA BLANCA
  try {
    return (
      <div 
        className={cn("space-y-6 pb-24 min-h-screen relative transition-colors duration-300", isDragging && "bg-indigo-50/50")}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="fixed bottom-2 right-2 z-[999999] bg-black/80 text-white px-3 py-1 rounded text-[10px] font-mono pointer-events-none">
          ✅ Render OK — Datos: {String(facturasSeguras.length)}
        </div>

        {/* OVERLAY NATIVO (Sin Framer Motion) */}
        {isDragging && (
          <div className="fixed inset-0 z-[9999] bg-indigo-600/90 backdrop-blur-sm border-[16px] border-dashed border-white/40 flex flex-col items-center justify-center pointer-events-none transition-opacity duration-300">
            <div className="flex flex-col items-center justify-center">
              <FileDown className="w-32 h-32 text-white mb-6 animate-bounce" />
              <h2 className="text-5xl font-black text-white tracking-tighter drop-shadow-lg">¡Suelta tu PDF aquí!</h2>
              <p className="text-indigo-200 text-xl font-bold mt-4">La IA se encarga de extraer todos los datos</p>
            </div>
          </div>
        )}

        {/* IA AUDIT SECTION NATIVA */}
        {draftsIA.length > 0 && (
          <div className="bg-slate-900 p-6 rounded-[2.5rem] shadow-2xl border border-slate-800 relative overflow-hidden transition-all duration-300">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-500"></div>
            <h3 className="text-white text-lg font-black flex items-center gap-2 mb-4">
              <Mail className="w-5 h-5 text-purple-400 animate-bounce" /> 
              Borradores y Auditoría 
              <span className="bg-purple-600 text-xs px-2 py-0.5 rounded-full">{draftsIA.length}</span>
            </h3>
            
            <div className="space-y-4">
              {draftsIA.map(d => (
                <div key={d.id} className={cn(
                  "bg-slate-800/50 p-5 rounded-3xl border transition-colors",
                  d.cuadraPerfecto ? 'border-emerald-500/50' : 'border-amber-500/50'
                )}>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex-1">
                      <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-1">Leído en el Documento</p>
                      {(d.prov || '').includes('Emergencia') || (d.prov || '').includes('PDF:') ? (
                        <h4 className="text-amber-400 font-black text-xl flex items-center gap-2">
                           <AlertCircle className="w-5 h-5" /> {d.prov}
                        </h4>
                      ) : (
                        <h4 className="text-white font-black text-xl">{d.prov || 'Sin Proveedor'}</h4>
                      )}
                      
                      <p className="text-slate-400 text-xs font-mono">Ref: {d.num} | Fecha: {d.date}</p>
                      <p className="text-3xl font-black text-white mt-2">{Num.fmt(Math.abs(Num.parse(d.total)))}</p>
                    </div>

                    <div className="flex-1 bg-slate-900 p-4 rounded-2xl w-full">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-slate-400 font-bold uppercase">Tus Albaranes ({(d.candidatos || []).length})</span>
                        <span className="text-sm font-black text-white">{Num.fmt(d.sumaAlbaranes)}</span>
                      </div>
                      {(d.candidatos || []).length > 0 ? (
                        <div className="space-y-1 max-h-24 overflow-y-auto custom-scrollbar pr-2">
                          {d.candidatos.map((c: any) => (
                            <div key={c.id} className="flex justify-between text-[10px] text-slate-500 border-b border-slate-800 pb-1">
                              <span>📅 {c.date} - {c.num}</span>
                              <span className="text-slate-300 font-bold">{Num.fmt(c.total)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-rose-400 text-[10px] font-bold italic py-2">⚠️ No hay albaranes pendientes este mes para este proveedor.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-700 flex flex-wrap gap-2 items-center justify-between">
                    <div>
                      {d.cuadraPerfecto ? (
                        <span className="bg-emerald-500/20 text-emerald-400 text-xs font-black px-3 py-1 rounded-lg">✅ CUADRA PERFECTO</span>
                      ) : (
                        <span className="bg-amber-500/20 text-amber-400 text-xs font-black px-3 py-1 rounded-lg">⚠️ DESCUADRE: {Num.fmt(d.diferencia)}</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleConfirmAuditoriaIA(d.id)}
                        className={cn(
                          "text-white text-xs px-5 py-2.5 rounded-xl font-black shadow-lg transition active:scale-95",
                          d.cuadraPerfecto ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-500 hover:bg-amber-600'
                        )}
                      >
                        {d.cuadraPerfecto ? 'VINCULAR Y CERRAR MES' : 'CERRAR IGNORANDO DIFERENCIA'}
                      </button>
                      <button 
                        onClick={() => handleDiscardDraftIA(d.id)}
                        className="bg-slate-700 hover:bg-rose-500 text-white text-xs p-2.5 rounded-xl font-black transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <section className="p-6 bg-white rounded-[2.5rem] shadow-sm border border-slate-100 relative z-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedUnit('ALL')}
                className={cn(
                  "px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border",
                  selectedUnit === 'ALL' ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
                )}
              >
                <Layers className="w-3 h-3 inline-block mr-1" />
                Ver Todos
              </button>
              {BUSINESS_UNITS.map(unit => (
                <button
                  key={unit.id}
                  onClick={() => setSelectedUnit(unit.id)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-2",
                    selectedUnit === unit.id 
                      ? "bg-indigo-600 text-white border-indigo-600" 
                      : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
                  )}
                >
                  <unit.icon className="w-3 h-3" />
                  {unit.name}
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-2">
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="application/pdf, image/*" 
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    processLocalFile(e.target.files[0]);
                    e.target.value = '';
                  }
                }}
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isSyncing}
                className="bg-indigo-50 border border-indigo-100 text-indigo-600 px-4 py-2 rounded-xl text-[10px] font-black hover:bg-indigo-100 transition flex items-center gap-2"
                title="Abre tu PDF o Foto aquí"
              >
                <UploadCloud className="w-4 h-4" /> <span className="hidden md:inline">SUBIR PDF / FOTO</span>
              </button>

              <button 
                onClick={() => setIsExportModalOpen(true)}
                className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm"
              >
                <Download className="w-4 h-4" />
              </button>
              <button 
                onClick={handleSyncIA}
                disabled={isSyncing}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:shadow-lg hover:scale-105 transition flex items-center gap-2 disabled:opacity-50"
              >
                {isSyncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                <span className="hidden md:inline">LEER EMAILS</span>
              </button>
              <button 
                onClick={notifyOverdue}
                className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-[10px] font-black hover:bg-slate-50 transition flex items-center gap-2 shadow-sm"
              >
                <Bell className="w-4 h-4 text-rose-500" />
              </button>
              <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-full border border-slate-200">
                <button 
                  onClick={() => setMode('proveedor')}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all",
                    mode === 'proveedor' ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  Prov
                </button>
                <button 
                  onClick={() => setMode('socio')}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all",
                    mode === 'socio' ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  Socios
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-2xl mb-6">
            <button 
              onClick={() => setActiveTab('pend')}
              className={cn(
                "flex-1 py-3 rounded-xl font-black text-xs transition",
                activeTab === 'pend' ? "bg-white shadow text-indigo-600" : "text-slate-400 hover:bg-slate-200"
              )}
            >
              📦 ALBARANES SUELTOS
            </button>
            <button 
              onClick={() => setActiveTab('hist')}
              className={cn(
                "flex-1 py-3 rounded-xl font-black text-xs transition",
                activeTab === 'hist' ? "bg-white shadow text-indigo-600" : "text-slate-400 hover:bg-slate-200"
              )}
            >
              💰 FACTURAS CERRADAS
            </button>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3 bg-white border px-3 py-1 rounded-2xl shadow-sm w-full md:w-auto justify-center">
              <button onClick={() => setYear(year - 1)} className="text-indigo-600 font-bold p-1 hover:scale-110 transition">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-black text-slate-700 w-10 text-center">{year}</span>
              <button onClick={() => setYear(year + 1)} className="text-indigo-600 font-bold p-1 hover:scale-110 transition">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            
            <div className="relative w-full md:w-96 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Buscar nombre o ref..." 
                  className="w-full p-2 pl-9 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 transition"
                />
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
                <button 
                  key={chip.id}
                  onClick={() => setFilterStatus(chip.id as any)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-bold border transition-all",
                    filterStatus === chip.id 
                      ? "bg-indigo-600 text-white border-indigo-600" 
                      : cn("bg-white border-slate-200 hover:bg-slate-50", chip.color)
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-4">
            {activeTab === 'pend' ? (
              pendingGroups.length > 0 ? (
                pendingGroups.map(([mk, dataGroup]) => (
                  <div key={mk} className="mb-8 animate-fade-in">
                    <h3 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-3 px-2 border-b border-indigo-100 pb-2">{dataGroup.name}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.values(dataGroup.groups).map((g: any) => {
                        const unitConfig = BUSINESS_UNITS.find(u => u.id === g.unitId);
                        return (
                          <div 
                            key={g.label + g.unitId}
                            onClick={() => handleOpenGroup(g.label, g.ids, g.unitId)}
                            className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition cursor-pointer group"
                          >
                            <div>
                              <p className="font-black text-slate-800 group-hover:text-indigo-600 transition flex items-center gap-2">
                                {g.label}
                                {unitConfig && (
                                  <span className={cn("text-[8px] px-2 py-0.5 rounded-full uppercase tracking-wider", unitConfig.bg, unitConfig.color)}>
                                    {unitConfig.name.split(' ')[0]}
                                  </span>
                                )}
                              </p>
                              <span className="inline-block mt-1 px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-[9px] font-bold uppercase">{g.count} Albaranes</span>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-slate-900 text-lg">{Num.fmt(g.t)}</p>
                              <p className="text-[9px] font-bold text-indigo-400 group-hover:underline mt-1 flex items-center gap-1 justify-end">
                                CERRAR MANUAL <ArrowRight className="w-2 h-2" />
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-20 flex flex-col items-center justify-center opacity-50 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                  <Package className="w-12 h-12 mb-3 text-slate-300" />
                  <p className="text-slate-500 font-bold text-sm">No hay albaranes sueltos.</p>
                </div>
              )
            ) : (
              // 🚀 IMPORTAMOS EL COMPONENTE DE LISTA DE FACTURAS
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
                onOpenDetail={setSelectedInvoice} 
                onTogglePago={handleTogglePago} 
                onDelete={handleDeleteFactura} 
              />
            )}
          </div>
        </section>

        {/* MODAL EXPORTAR GESTORÍA NATIVO */}
        {isExportModalOpen && (
          <div className="fixed inset-0 z-[100] flex justify-center items-center p-4">
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setIsExportModalOpen(false)} />
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative z-10 animate-fade-in">
              <h3 className="text-xl font-black text-slate-800 mb-2">Exportar Trimestre</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">Generar Excel para Gestoría</p>
              
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Año Fiscal</label>
                  <input 
                    type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
                    className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-black border-0 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Trimestre</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map(q => (
                      <button
                        key={q} onClick={() => setExportQuarter(q)}
                        className={cn(
                          "py-3 rounded-xl text-xs font-black transition",
                          exportQuarter === q ? "bg-indigo-600 text-white shadow-lg" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                        )}
                      >
                        Q{q}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="pt-4">
                  <button onClick={handleExportGestoria} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-emerald-700 active:scale-95 transition flex justify-center items-center gap-2">
                    <Download className="w-4 h-4" /> DESCARGAR EXCEL
                  </button>
                  <button onClick={() => setIsExportModalOpen(false)} className="w-full text-slate-400 text-xs font-bold py-3 hover:text-slate-600 mt-2">
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL AGRUPAR ALBARANES NATIVO */}
        {selectedGroup && (
          <div className="fixed inset-0 z-[100] flex justify-center items-center p-4">
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setSelectedGroup(null)} />
            <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl relative z-10 flex flex-col max-h-[90vh] animate-fade-in">
              <button onClick={() => setSelectedGroup(null)} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500 text-2xl transition">✕</button>
              
              <div className="border-b border-slate-100 pb-4 mb-4 flex justify-between items-end">
                <div>
                  <h3 className="text-2xl font-black text-slate-800">{selectedGroup.label}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest">Cierre de mes manual</p>
                    <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">
                      {BUSINESS_UNITS.find(u => u.id === selectedGroup.unitId)?.name}
                    </span>
                  </div>
                </div>
                
                <button onClick={handleToggleAllAlbs} className="flex items-center gap-1 text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition">
                  <CheckSquare className="w-3 h-3" />
                  {modalForm.selectedAlbs.length === selectedGroup.ids.length ? 'Desmarcar Todos' : 'Marcar Todos'}
                </button>
              </div>
              
              <div className="space-y-2 flex-1 overflow-y-auto pr-2 custom-scrollbar bg-slate-50 rounded-2xl p-4 border border-slate-100">
                {albaranesSeguros.filter(a => selectedGroup.ids.includes(a.id)).map(a => (
                  <label key={a.id} className="flex justify-between items-center py-3 border-b border-slate-200 last:border-0 cursor-pointer hover:bg-white px-3 rounded-xl transition shadow-sm hover:shadow">
                    <div className="flex items-center gap-4">
                      <div className="relative flex items-center justify-center">
                        <input 
                          type="checkbox" 
                          checked={modalForm.selectedAlbs.includes(a.id)}
                          onChange={(e) => {
                            const newSelected = e.target.checked 
                              ? [...modalForm.selectedAlbs, a.id]
                              : modalForm.selectedAlbs.filter(id => id !== a.id);
                            setModalForm({ ...modalForm, selectedAlbs: newSelected });
                          }}
                          className="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer" 
                        />
                      </div>
                      <div>
                        <p className="font-bold text-slate-700 text-sm">{a.date}</p>
                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">Ref: {a.num || 'S/N'}</p>
                      </div>
                    </div>
                    <p className="font-black text-slate-900">{Num.fmt(a.total)}</p>
                  </label>
                ))}
              </div>
              
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between bg-slate-900 p-5 rounded-2xl text-white shadow-lg">
                  <div>
                    <span className="text-xs font-black uppercase tracking-widest text-slate-400 block mb-1">Total a Facturar</span>
                    <span className="text-[10px] text-indigo-400 font-bold">{modalForm.selectedAlbs.length} albaranes seleccionados</span>
                  </div>
                  <span className="text-4xl font-black text-emerald-400 tracking-tighter">
                    {Num.fmt(modalForm.selectedAlbs.reduce((acc, id) => {
                      const alb = albaranesSeguros.find(a => a.id === id);
                      return acc + (Num.parse(alb?.total) || 0);
                    }, 0))}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mode === 'socio' ? (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Seleccionar Socio</label>
                      <select 
                        value={modalForm.num.startsWith('SOCIO-') ? modalForm.num.split('-')[1] : ''}
                        onChange={(e) => {
                          const socio = e.target.value;
                          setModalForm({ ...modalForm, num: `LIQ-${socio}-${modalForm.date.replace(/-/g,'')}` });
                          setSelectedGroup(prev => prev ? { ...prev, label: socio } : null);
                        }}
                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white transition"
                      >
                        <option value="">-- Selecciona Socio --</option>
                        {SOCIOS_REALES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Nº Factura Oficial</label>
                      <input 
                        type="text" 
                        value={modalForm.num}
                        onChange={(e) => setModalForm({ ...modalForm, num: e.target.value })}
                        placeholder="Ej: F-2024/012" 
                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white transition"
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Fecha de Emisión</label>
                    <input 
                      type="date" 
                      value={modalForm.date}
                      onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white transition cursor-pointer"
                    />
                  </div>
                </div>

                <button 
                  onClick={handleConfirmManualInvoice}
                  disabled={modalForm.selectedAlbs.length === 0}
                  className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-sm shadow-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition"
                >
                  GUARDAR FACTURA OFICIAL
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DETALLE FACTURA MODAL NATIVO (IMPORTAMOS EL NUEVO COMPONENTE) */}
        {selectedInvoice && (
          <InvoiceDetailModal 
            factura={selectedInvoice} 
            albaranes={albaranesSeguros} 
            businessUnits={BUSINESS_UNITS} 
            mode={mode} 
            onClose={() => setSelectedInvoice(null)} 
            onDownloadFile={handleDownloadFile} 
          />
        )}
      </div>
    );
  } catch (error) {
    console.error("Error crítico renderizando InvoicesView:", error);
    return (
      <div className="p-8 bg-red-50 text-red-600 rounded-2xl border border-red-200">
        <h2 className="text-xl font-bold mb-2">Error cargando Facturas</h2>
        <p>Ha ocurrido un problema al procesar los datos. Por favor, recarga la página.</p>
      </div>
    );
  }
};
