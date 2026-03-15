import React, { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react';
import { 
  Building2, Search, Trash2, UploadCloud, Zap, 
  CheckCircle2, Clock, Check, Download, Package, 
  X, Layers, ShieldCheck, List, Sparkles, ArrowDownLeft,
  Calendar, Wand2, PieChart, ArrowUpRight, ArrowDownRight,
  Eye, Save, MailCheck, Webhook, FileText, Inbox, AlertCircle, Bot,
  ChevronLeft, ChevronRight, Users, Loader2, Smartphone
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";

// 🛡️ TIPOS Y SERVICIOS CONECTADOS AL MOTOR CENTRAL
import { AppData, FacturaExtended, BusinessUnit, EmailDraft } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { basicNorm, linkAlbaranesToFactura, recomputeFacturaFromAlbaranes } from '../services/invoicing'; 
import { fetchNewEmails, markEmailAsParsed } from '../services/supabase';

// 🧩 COMPONENTES HIJOS
import { InvoicesList } from './InvoicesList';
import { InvoiceDetailModal } from './InvoiceDetailModal';

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'DLV', name: 'Catering', icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: Package, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'CORP', name: 'Socios / Corp', icon: Users, color: 'text-slate-600', bg: 'bg-slate-100' },
];

export interface InvoicesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

const safeJSON = (str: string) => { 
  try { const match = str.match(/\{[\s\S]*\}/); return match ? JSON.parse(match[0]) : {}; } 
  catch { return {}; } 
};

export const InvoicesView = ({ data, onSave }: InvoicesViewProps) => {
  const safeData = data || {};
  const facturasSeguras = Array.isArray(safeData.facturas) ? safeData.facturas as FacturaExtended[] : [];
  const albaranesSeguros = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  const sociosSeguros = Array.isArray(safeData.socios) ? safeData.socios : [];

  const sociosRealesObj = sociosSeguros.length > 0 ? sociosSeguros.filter(s => s && s.active) : [{ id: "s1", n: "ARUME" }];
  const SOCIOS_REALES_NAMES = sociosRealesObj.map(s => String(s?.n || 'Desconocido'));

  // 🛡️ CORTAFUEGOS: Eliminar Cajas Z de la Bóveda de Facturas B2B
  const facturasBoveda = useMemo(() => {
    return facturasSeguras.filter(f => {
      if (!f) return false;
      if (f.tipo === 'caja') return false;
      if (f.cliente === 'Z DIARIO') return false;
      if (String(f.num || '').toUpperCase().startsWith('Z')) return false;
      if (String(f.num || '').toUpperCase().startsWith('CAJA')) return false;
      return true; 
    });
  }, [facturasSeguras]);

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
  const [isProcessing, setIsProcessing] = useState(false); 

  const [selectedGroup, setSelectedGroup] = useState<{ label: string; ids: string[], unitId: BusinessUnit } | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<FacturaExtended | null>(null);
  const [modalForm, setModalForm] = useState({ num: '', date: DateUtil.today(), selectedAlbs: [] as string[], unitId: 'REST' as BusinessUnit });

  const [autoGroupPreview, setAutoGroupPreview] = useState<FacturaExtended[] | null>(null);
  const [emailAuditInbox, setEmailAuditInbox] = useState<EmailDraft[]>([]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedGroup(null); setIsExportModalOpen(false); setSelectedInvoice(null); setAutoGroupPreview(null); }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement; const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!isTyping && e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder^="Buscar"]')?.focus(); }
      if (!isTyping && e.key.toLowerCase() === 'g') { e.preventDefault(); setActiveTab(t => t === 'pend' ? 'hist' : 'pend'); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ============================================================================
  // 🧠 CEREBRO DE AGRUPACIÓN INTELIGENTE (TARJETAS)
  // ============================================================================
  const pendingGroups = useMemo(() => {
    try {
      const byMonth: Record<string, { name: string; groups: Record<string, any> }> = {};
      const q = deferredSearch ? basicNorm(deferredSearch) : ''; 

      albaranesSeguros.forEach(a => {
        if (!a || typeof a !== 'object' || a.invoiced) return;
        
        let aDate = String(a.date || '');
        if (aDate.includes('/')) {
            const parts = aDate.split('/');
            if (parts.length === 3) aDate = `${parts[2].length === 2 ? '20'+parts[2] : parts[2]}-${parts[1]}-${parts[0]}`;
        }
        if (!aDate.startsWith(year.toString())) return;
        
        const itemUnit = (a as any).unitId || 'REST';
        if (selectedUnit !== 'ALL' && itemUnit !== selectedUnit) return;
        
        const owner = String((mode === 'proveedor' ? a.prov : a.socio) || 'Sin Identificar');
        
        if (q) {
            const matchOwner = basicNorm(owner).includes(q); 
            const matchNum = basicNorm(String(a.num || '')).includes(q); 
            if (!matchOwner && !matchNum) return;
        }

        const mk = aDate.substring(0, 7); 
        if (!mk) return;

        if (!byMonth[mk]) {
          const parts = mk.split('-'); 
          const y = parts[0] || '0000';
          const m = parseInt(parts[1] || '1', 10);
          const finalM = isNaN(m) ? 1 : m;
          const names = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
          byMonth[mk] = { name: `${names[finalM] || 'Mes'} ${y}`, groups: {} };
        }

        const groupKey = `${basicNorm(owner)}_${itemUnit}`; 
        if (!byMonth[mk].groups[groupKey]) {
            byMonth[mk].groups[groupKey] = { label: owner, unitId: itemUnit, t: 0, ids: [], count: 0 };
        }
        
        byMonth[mk].groups[groupKey].t += Math.abs(Num.parse(a.total) || 0); 
        byMonth[mk].groups[groupKey].count += 1; 
        byMonth[mk].groups[groupKey].ids.push(a.id);
      });

      return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
    } catch (error) { return []; }
  }, [albaranesSeguros, year, mode, deferredSearch, selectedUnit]);

  const handlePrepareAutoGroup = () => {
    const drafts: FacturaExtended[] = [];
    
    pendingGroups.forEach(([monthKey, dataGroup]) => {
      Object.values(dataGroup.groups).forEach((g: any) => {
        if (g.count > 0) {
          drafts.push({
            id: `draft-fac-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, 
            tipo: mode === 'proveedor' ? 'compra' : 'venta', 
            num: '', 
            date: `${monthKey}-28`, 
            prov: mode === 'proveedor' ? String(g.label) : 'Varios', 
            cliente: mode === 'socio' ? String(g.label) : 'Arume',
            total: String(g.t), base: "0", tax: "0", 
            albaranIdsArr: g.ids,
            paid: false, reconciled: false, source: 'manual-group', status: 'approved', 
            unidad_negocio: g.unitId || 'REST' 
          });
        }
      });
    });

    if (drafts.length > 0) setAutoGroupPreview(drafts);
    else alert("No hay albaranes pendientes para agrupar.");
  };

  const handleConfirmAutoGroupAll = async () => {
    if (!autoGroupPreview) return;
    const missingNum = autoGroupPreview.some(f => !f.num.trim());
    if (missingNum) {
       if(!window.confirm("⚠️ Algunas facturas no tienen número oficial (quedarán en blanco). ¿Continuar de todos modos?")) return;
    }

    setIsProcessing(true);
    try {
      const newData = JSON.parse(JSON.stringify(safeData));
      if (!newData.facturas) newData.facturas = [];

      autoGroupPreview.forEach(f => {
        f.total = "0"; f.base = "0"; f.tax = "0";
        newData.facturas.unshift(f);
        linkAlbaranesToFactura(newData, f.id, f.albaranIdsArr || [], { strategy: 'useAlbTotals' });
      });

      newData.facturas = [...newData.facturas]; 
      await onSave(newData);
      
      setAutoGroupPreview(null);
      setActiveTab('hist'); 
      alert(`✅ ¡Perfecto! Se han guardado ${autoGroupPreview.length} facturas. Totales recalculados con éxito.`);
    } catch (e) { alert("⚠️ Hubo un error al guardar."); } finally { setIsProcessing(false); }
  };

  const handleConfirmManualInvoice = async () => {
    if (!modalForm.num.trim() || modalForm.selectedAlbs.length === 0) return;
    setIsProcessing(true);
    try {
      const newData = JSON.parse(JSON.stringify(safeData));
      const newFacId = `fac-manual-${Date.now()}`;
      
      const newFactura: FacturaExtended = {
        id: newFacId, tipo: mode === 'proveedor' ? 'compra' : 'venta', num: modalForm.num, date: modalForm.date,
        prov: mode === 'proveedor' ? (selectedGroup?.label || '') : 'Varios', cliente: mode === 'socio' ? (selectedGroup?.label || '') : 'Arume',
        total: "0", base: "0", tax: "0", albaranIdsArr: [], paid: false, reconciled: false, source: 'manual-group', status: 'approved', unidad_negocio: modalForm.unitId || 'REST' 
      };

      newData.facturas.unshift(newFactura);
      linkAlbaranesToFactura(newData, newFacId, modalForm.selectedAlbs, { strategy: 'useAlbTotals' });
      
      newData.facturas = [...newData.facturas]; 
      await onSave(newData); 
      setSelectedGroup(null);
    } catch (e) { alert("Error guardando la factura."); } finally { setIsProcessing(false); }
  };

  const handleToggleAlbaran = (id: string) => {
    setModalForm(prev => {
      const isSelected = prev.selectedAlbs.includes(id);
      return { ...prev, selectedAlbs: isSelected ? prev.selectedAlbs.filter(alId => alId !== id) : [...prev.selectedAlbs, id] };
    });
  };

  const handleTogglePago = async (id: string) => {
    const newData = JSON.parse(JSON.stringify(safeData));
    const idx = newData.facturas.findIndex((f:any) => f && f.id === id);
    if (idx !== -1) {
      if (newData.facturas[idx].reconciled) return alert("🔒 Factura conciliada por el banco. No se puede alterar el pago manualmente.");
      newData.facturas[idx].paid = !newData.facturas[idx].paid;
      newData.facturas[idx].status = newData.facturas[idx].paid ? 'paid' : 'approved';
      newData.facturas = [...newData.facturas];
      await onSave(newData);
    }
  };

  const handleDeleteFactura = async (id: string) => {
    const fac = facturasBoveda.find(f => f && f.id === id); 
    if (!fac) return;
    if (fac.reconciled) return alert("⚠️ No puedes borrar una factura validada por el Banco.");
    if (!window.confirm(`🛑 ¿Eliminar DEFINITIVAMENTE la factura ${fac.num || 'sin número'}? Los albaranes volverán a estar sueltos en la sala de espera.`)) return;
    
    const newData = JSON.parse(JSON.stringify(safeData));
    const idsToFree = fac.albaranIdsArr || [];
    
    if (Array.isArray(newData.albaranes)) {
       newData.albaranes.forEach((a: any) => { 
         if (a && idsToFree.includes(a.id)) a.invoiced = false; 
       });
    }
    
    newData.facturas = newData.facturas.filter((f: any) => f && f.id !== id);
    await onSave(newData);
  };

  const handleExportGestoria = () => {
    const q = exportQuarter; const y = year; const startMonth = (q - 1) * 3 + 1; const endMonth = q * 3;
    const filtered = facturasBoveda.filter(f => {
      if (!f || typeof f !== 'object') return false;
      const fDate = String(f.date || '');
      return f.status !== 'draft' && 
             (selectedUnit === 'ALL' || f.unidad_negocio === selectedUnit) && 
             (fDate.startsWith(y.toString())) && 
             Number(fDate.split('-')[1]) >= startMonth && 
             Number(fDate.split('-')[1]) <= endMonth;
    });
    
    if (filtered.length === 0) return alert("No hay facturas en este periodo.");

    const rows = filtered.map(f => {
      const total = Math.abs(Num.parse(f.total) || 0); 
      const base = Math.abs(Num.parse(f.base) || Num.round2(total / 1.10)); 
      const tax = Math.abs(Num.parse(f.tax) || Num.round2(total - base));
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

  // ============================================================================
  // 🛡️ LÓGICA DE AUDITORÍA DE CORREOS
  // ============================================================================
  const fetchPendingAudits = async () => {
    setIsSyncing(true);
    try {
      const emails = await fetchNewEmails(); 
      if (emails.length > 0) setEmailAuditInbox(emails);
      else alert("📭 No hay PDFs nuevos en el buzón para auditar.");
    } catch (e) { alert("⚠️ Error conectando al buzón IMAP."); }
    setIsSyncing(false);
  };

  const processEmailAudit = async (email: EmailDraft) => {
    if (!email.fileBase64) return;
    setIsProcessing(true);
    try {
      const apiKey = localStorage.getItem('gemini_api_key');
      if (!apiKey) throw new Error("NO_API_KEY");

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Actúa como un Auditor. Solo dime de quién es esta factura y el importe total a pagar. Devuelve JSON estricto: {"proveedor": "Nombre", "total": 0}`;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: email.fileBase64, mimeType: "application/pdf" } }] }],
        config: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const rawJson = safeJSON(response.text || "");
      const provDetectado = rawJson.proveedor || '';
      const totalDetectado = Num.parse(rawJson.total);

      const match = facturasBoveda.find(f => 
        !f.file_base64 && 
        Math.abs(Num.parse(f.total) - totalDetectado) <= 1.00
      );

      if (match) {
        if (window.confirm(`✅ ¡MATCH ENCONTRADO!\n\nEl PDF de ${provDetectado} (${Num.fmt(totalDetectado)}) coincide con tu factura ${match.num}.\n\n¿Quieres adjuntar este PDF a esa factura?`)) {
           const newData = JSON.parse(JSON.stringify(safeData));
           const fIndex = newData.facturas.findIndex((f:any) => f.id === match.id);
           if (fIndex > -1) {
              newData.facturas[fIndex].file_base64 = `data:application/pdf;base64,${email.fileBase64}`;
              await onSave(newData);
              await markEmailAsParsed(email.id);
              setEmailAuditInbox(prev => prev.filter(e => e.id !== email.id));
              alert("📎 PDF adjuntado correctamente a la bóveda.");
           }
        }
      } else {
        alert(`❌ Sin coincidencias.\n\nEl PDF es de ${provDetectado} por ${Num.fmt(totalDetectado)}.\nNo hay ninguna factura en la bóveda esperando un PDF con ese importe.`);
      }
    } catch (e) {
      alert("Error procesando el PDF. Asegúrate de tener la clave API configurada.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTriggerN8N = async () => {
    const webhookUrl = safeData.config?.n8nUrlAlbaranes || safeData.config?.n8nUrlIA;
    if (!webhookUrl) return alert("⚠️ Falta configurar la URL del Webhook de n8n en los Ajustes (Settings).");
    setIsProcessing(true);
    try {
      await fetch(webhookUrl, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: "sync_invoices", timestamp: new Date().toISOString() })
      });
      alert("🚀 ¡Señal enviada a n8n con éxito! La automatización está corriendo en segundo plano.");
    } catch (e) {
      alert("❌ Error al contactar con n8n. Revisa la URL o si el webhook está activo.");
    } finally { setIsProcessing(false); }
  };

  // 🚀 MAGIA BOT: EL AUDÍFONO (Escucha comandos de TelegramWidget)
  useEffect(() => {
    const handleBotCommand = (e: any) => {
      const { cmd, q } = e.detail || {};
      if (cmd === 'buscar' && q) {
        setSearchQ(q);
        window.scrollTo({ top: 0, behavior: 'smooth' }); 
      }
      if (cmd === 'sync_emails') {
        // Disparamos la sincronización de correos
        fetchPendingAudits();
        // Navegamos suavemente hacia la sección de abajo para ver los resultados
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    };
    window.addEventListener('arume-bot-command', handleBotCommand);
    return () => window.removeEventListener('arume-bot-command', handleBotCommand);
  }, []);

  // Cálculos para la Barra de Progreso Financiero
  const totalFacturadoCalc = facturasBoveda.filter(f => f.tipo === 'compra').reduce((acc, f) => acc + Math.abs(Num.parse(f.total)||0), 0);
  const totalPagadoCalc = facturasBoveda.filter(f => f.tipo === 'compra' && f.paid).reduce((acc, f) => acc + Math.abs(Num.parse(f.total)||0), 0);
  const progressPercent = totalFacturadoCalc > 0 ? (totalPagadoCalc / totalFacturadoCalc) * 100 : 0;

  return (
    <div className="animate-fade-in space-y-4 pb-32 relative max-w-[1600px] mx-auto text-xs">
      
      {/* 🛡️ PÍLDORAS DE RESUMEN FINANCIERO */}
      <AnimatePresence mode="wait">
        {activeTab === 'hist' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-4">
             <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 }} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center relative overflow-hidden">
                 <div className="flex items-center justify-between mb-1">
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Facturado (B2B)</p>
                   <span className="flex items-center gap-0.5 text-[8px] font-bold text-slate-50 bg-slate-100 px-1 rounded"><ArrowUpRight className="w-2.5 h-2.5"/></span>
                 </div>
                 <p className="text-xl font-black text-slate-800">{Num.fmt(totalFacturadoCalc)}</p>
               </motion.div>

               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 }} className="bg-white p-4 rounded-2xl border border-rose-100 shadow-sm flex flex-col justify-center relative">
                 <div className="flex items-center justify-between mb-1">
                   <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest">Pendiente Pago</p>
                   <span className="flex items-center gap-0.5 text-[8px] font-bold text-rose-500 bg-rose-50 px-1 rounded"><ArrowDownRight className="w-2.5 h-2.5"/></span>
                 </div>
                 <p className="text-xl font-black text-rose-600">{Num.fmt(totalFacturadoCalc - totalPagadoCalc)}</p>
               </motion.div>

               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.3 }} className="bg-white p-4 rounded-2xl border border-emerald-100 shadow-sm flex flex-col justify-center relative">
                 <div className="flex items-center justify-between mb-1">
                   <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Total Pagado</p>
                   <span className="flex items-center gap-0.5 text-[8px] font-bold text-emerald-500 bg-emerald-50 px-1 rounded"><CheckCircle2 className="w-2.5 h-2.5"/></span>
                 </div>
                 <p className="text-xl font-black text-emerald-600">{Num.fmt(totalPagadoCalc)}</p>
               </motion.div>
             </div>

             <div className="mt-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex items-center gap-4">
               <PieChart className="w-4 h-4 text-slate-400" />
               <div className="flex-1 h-2 bg-rose-100 rounded-full overflow-hidden flex">
                 <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${progressPercent}%` }} />
               </div>
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{progressPercent.toFixed(0)}% Pagado</span>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER DE NAVEGACIÓN */}
      <header className="bg-white/90 backdrop-blur-md rounded-[2rem] border border-slate-200 shadow-sm p-4 md:p-5 flex flex-col xl:flex-row justify-between gap-4 relative z-40 items-center sticky top-4">
        <div className="flex items-center gap-4 w-full xl:w-auto justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight leading-none">Facturación Global</h2>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Crea o revisa facturas finales</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          <div className="flex items-center bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-full md:w-auto">
            <button onClick={() => setActiveTab('pend')} className={cn("flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all", activeTab === 'pend' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}>📦 Agrupar Albaranes</button>
            <button onClick={() => setActiveTab('hist')} className={cn("flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all", activeTab === 'hist' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}>💰 Bóveda (Excel)</button>
          </div>

          <div className="w-px h-8 bg-slate-200 hidden md:block mx-1"></div>

          <button onClick={() => setIsExportModalOpen(true)} className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-all flex items-center gap-2 shadow-sm active:scale-95">
            <Download className="w-4 h-4" /> Excel Gestoría
          </button>
        </div>
      </header>

      {/* BARRA DE FILTROS SUPERIOR */}
      <div className="bg-white px-5 py-3 rounded-2xl shadow-sm border border-slate-200 flex flex-col lg:flex-row items-center justify-between gap-3 relative z-30">
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200">
              <button onClick={() => setMode('proveedor')} className={cn("px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all", mode === 'proveedor' ? "bg-white text-slate-800 shadow-sm border border-slate-200" : "text-slate-500 hover:bg-slate-100")}>Proveedor</button>
              <button onClick={() => setMode('socio')} className={cn("px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all", mode === 'socio' ? "bg-white text-slate-800 shadow-sm border border-slate-200" : "text-slate-500 hover:bg-slate-100")}>Socio</button>
            </div>

            <select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value as any)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest outline-none text-slate-700 focus:border-indigo-400 cursor-pointer">
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
      <div className="grid grid-cols-1 xl:grid-cols-1 gap-6 relative z-10">
        <section className="space-y-4">
          <AnimatePresence mode="wait">
            {activeTab === 'pend' ? (
              <motion.div key="pend" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{type: 'spring', damping: 25}}>
                
                {/* 🚀 BOTÓN MÁGICO DE PRE-VISUALIZACIÓN */}
                {pendingGroups.length > 0 && (
                  <div className="mb-6 flex justify-end">
                    <button onClick={handlePrepareAutoGroup} disabled={isProcessing} className="bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest px-6 py-3 rounded-xl shadow-lg hover:bg-indigo-700 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50">
                      {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                      Revisar Auto-Agrupación
                    </button>
                  </div>
                )}

                {/* 🚀 MODAL / PANEL DE PREVISUALIZACIÓN */}
                <AnimatePresence>
                  {autoGroupPreview && (
                    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="mb-6 bg-white border-2 border-indigo-200 rounded-[2rem] p-6 shadow-xl overflow-hidden relative">
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h3 className="text-xl font-black text-indigo-700 flex items-center gap-2"><Sparkles className="w-5 h-5"/> Borradores Listos</h3>
                          <p className="text-xs font-bold text-slate-500 mt-1">Revisa, edita los números y confirma. Puedes eliminar los que no quieras agrupar aún.</p>
                        </div>
                        <button onClick={() => setAutoGroupPreview(null)} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition"><X className="w-5 h-5"/></button>
                      </div>

                      <div className="space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2 mb-6">
                        {autoGroupPreview.map((draft, idx) => (
                          <div key={draft.id} className="flex flex-col md:flex-row items-center gap-4 bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                            <div className="flex-1">
                              <p className="font-black text-slate-800 text-sm">{draft.prov}</p>
                              <p className="text-[10px] font-bold text-slate-500 uppercase">{draft.albaranIdsArr?.length} albaranes a unificar</p>
                            </div>
                            <div className="flex-1 w-full md:w-auto">
                              <input 
                                type="text" 
                                placeholder="Nº Factura Oficial..." 
                                value={draft.num}
                                onChange={(e) => {
                                  const newDrafts = [...autoGroupPreview];
                                  newDrafts[idx].num = e.target.value;
                                  setAutoGroupPreview(newDrafts);
                                }}
                                className={cn("w-full p-3 rounded-xl text-xs font-bold outline-none border transition-colors", draft.num.trim() ? "bg-white border-emerald-200 focus:border-emerald-400" : "bg-rose-50 border-rose-200 focus:border-rose-400 placeholder:text-rose-300")}
                              />
                            </div>
                            <div className="text-right w-24">
                              <p className="font-black text-indigo-600 text-lg">{Num.fmt(Num.parse(draft.total))}</p>
                            </div>
                            <button 
                              onClick={() => setAutoGroupPreview(autoGroupPreview.filter((_, i) => i !== idx))}
                              className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200 transition"
                              title="Descartar esta agrupación"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-end gap-3 border-t border-slate-100 pt-6">
                        <button onClick={() => setAutoGroupPreview(null)} className="px-6 py-3 rounded-xl font-black text-xs text-slate-500 hover:bg-slate-100 transition uppercase">Cancelar</button>
                        <button onClick={handleConfirmAutoGroupAll} disabled={isProcessing || autoGroupPreview.length === 0} className="bg-emerald-600 text-white font-black text-xs uppercase tracking-widest px-8 py-3 rounded-xl shadow-lg hover:bg-emerald-700 transition-all flex items-center gap-2 disabled:opacity-50">
                          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Confirmar {autoGroupPreview.length} Facturas
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* TARJETAS DE GRUPOS NORMALES (LA SALA DE ESPERA) */}
                {!autoGroupPreview && (
                  <>
                    {pendingGroups.length > 0 ? pendingGroups.map(([mk, dataGroup]) => (
                      <div key={mk} className="mb-6 animate-fade-in bg-white p-5 rounded-[2.5rem] shadow-[0_4px_20px_-5px_rgba(0,0,0,0.05)] border border-slate-100">
                        <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2 px-2">
                           <Calendar className="w-4 h-4 text-indigo-500" /> {dataGroup.name}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4">
                          {Object.values(dataGroup.groups || {}).map((g: any) => {
                             const unitConfig = BUSINESS_UNITS.find(u => u.id === g.unitId);
                             return (
                                <div key={g.label + g.unitId} onClick={() => { setSelectedGroup({ label: String(g.label), ids: g.ids, unitId: g.unitId }); setModalForm({ num: '', date: DateUtil.today(), selectedAlbs: [...g.ids], unitId: g.unitId }); }} className="flex flex-col p-5 bg-slate-50 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:bg-white hover:shadow-md transition-all cursor-pointer group">
                                  <div className="flex justify-between items-start mb-4">
                                    {unitConfig && <span className={cn("text-[8px] px-2 py-1 rounded-md font-black uppercase tracking-wider", unitConfig.bg, unitConfig.color)}>{unitConfig.name.split(' ')[0]}</span>}
                                    <span className="text-[10px] font-bold text-slate-400 bg-white px-2 py-1 rounded-md border border-slate-100 shadow-sm">{g.count} albaranes</span>
                                  </div>
                                  <p className="font-black text-slate-800 text-sm truncate mb-1">{String(g.label)}</p>
                                  <p className="font-black text-indigo-600 text-2xl group-hover:text-indigo-700 transition-colors">{Num.fmt(g.t)}</p>
                                </div>
                             );
                          })}
                        </div>
                      </div>
                    )) : (
                      <div className="py-24 text-center bg-white rounded-[3rem] border border-slate-100 shadow-sm flex flex-col items-center">
                          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100"><Package className="w-10 h-10 text-slate-300" /></div>
                          <p className="text-slate-800 font-black text-base uppercase tracking-widest">Todo al día</p>
                          <p className="text-sm font-medium text-slate-400 mt-2">No hay albaranes sueltos esperando en la sala.</p>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div key="hist" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{type: 'spring', damping: 25}}>
                {/* 💰 AQUÍ ESTÁ LA TABLA EXCEL (BÓVEDA) */}
                <InvoicesList 
                  facturas={facturasBoveda} searchQ={deferredSearch} selectedUnit={selectedUnit} mode={mode} filterStatus={filterStatus} year={year} businessUnits={BUSINESS_UNITS} sociosReales={SOCIOS_REALES_NAMES} superNorm={basicNorm} onOpenDetail={setSelectedInvoice as any} onTogglePago={handleTogglePago} onDelete={handleDeleteFactura} albaranesSeguros={albaranesSeguros} 
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      {/* 🚀 AUDITORÍA DOCUMENTAL Y AUTOMATIZACIONES (BOTTOM) */}
      <div className="mt-8 bg-slate-900 rounded-[2.5rem] p-6 md:p-8 shadow-2xl relative overflow-hidden flex flex-col lg:flex-row gap-8">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-500" />
        
        {/* PANEL 1: AUDITORÍA DE CORREOS */}
        <div className="flex-1 space-y-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center border border-slate-700">
                <MailCheck className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white tracking-tight">Auditoría Documental</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                  Cruza PDFs del correo con facturas de tu bóveda.
                </p>
              </div>
            </div>
            <button onClick={fetchPendingAudits} disabled={isSyncing} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition shadow-lg flex items-center gap-2 disabled:opacity-50 whitespace-nowrap">
              {isSyncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Search className="w-4 h-4" />} Escanear Buzón
            </button>
          </div>

          {emailAuditInbox.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800 pt-6">
              {emailAuditInbox.map(mail => (
                <div key={mail.id} className="bg-slate-800 border border-slate-700 p-4 rounded-2xl flex flex-col justify-between">
                  <div>
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2">{mail.date}</p>
                    <p className="text-sm font-black text-white truncate">{mail.from}</p>
                    <p className="text-[10px] text-slate-400 font-bold truncate mt-1">{mail.subject}</p>
                  </div>
                  <button onClick={() => processEmailAudit(mail)} disabled={isProcessing} className="w-full mt-4 bg-slate-700 hover:bg-blue-600 text-white py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition flex items-center justify-center gap-2">
                    <ShieldCheck className="w-4 h-4" /> Comprobar Cuadre
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PANEL 2: INTEGRACIÓN N8N */}
        <div className="lg:w-1/3 w-full border-t lg:border-t-0 lg:border-l border-slate-800 pt-6 lg:pt-0 lg:pl-8 flex flex-col justify-center">
          <div className="bg-indigo-900/30 border border-indigo-500/30 p-6 rounded-3xl text-center flex flex-col items-center">
            <div className="w-14 h-14 bg-indigo-600 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(79,70,229,0.4)] mb-4">
               <Webhook className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-base font-black text-indigo-100 mb-2">Motor de Automatización</h3>
            <p className="text-[10px] text-indigo-300/80 uppercase font-bold tracking-widest mb-6 leading-relaxed">
              Ejecuta el flujo de trabajo en N8N para descargar facturas de Drive, Dropbox o APIs de proveedores.
            </p>
            <button onClick={handleTriggerN8N} disabled={isProcessing} className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-black text-[10px] uppercase tracking-widest px-6 py-3.5 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 active:scale-95 disabled:opacity-50">
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Zap className="w-4 h-4" />}
              Lanzar Webhook N8N
            </button>
          </div>
        </div>

      </div>

      {/* 🛡️ MODAL DE EXPORTACIÓN */}
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

      {/* 🛡️ MODAL DE AGRUPACIÓN MANUAL */}
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
                
                <div className="flex items-center gap-2">
                  <button onClick={() => {
                     const validIds = albaranesSeguros.filter(a => selectedGroup.ids.includes(a.id) && Math.abs(Num.parse(a.total)) > 0).map(a => a.id);
                     setModalForm(p => ({...p, selectedAlbs: validIds}));
                  }} className="text-[10px] font-black uppercase text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition flex items-center gap-1 border border-amber-200">
                    <Wand2 className="w-3 h-3"/> Selección Mágica
                  </button>

                  <button onClick={() => { const allIds = selectedGroup.ids; setModalForm(p => ({...p, selectedAlbs: p.selectedAlbs.length === allIds.length ? [] : allIds })) }} className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition border border-indigo-100">
                    {modalForm.selectedAlbs.length === selectedGroup.ids.length ? 'Desmarcar Todos' : 'Marcar Todos'}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50 rounded-2xl p-3 border border-slate-200 space-y-2">
                {(albaranesSeguros).filter(a => a && selectedGroup.ids.includes(a.id)).map(a => (
                  <label 
                    key={a.id} 
                    onClick={(e) => { e.preventDefault(); handleToggleAlbaran(a.id); }} 
                    className={cn("flex justify-between items-center p-3 rounded-xl cursor-pointer border transition-all", modalForm.selectedAlbs.includes(a.id) ? "bg-white border-indigo-400 shadow-sm" : "border-transparent hover:bg-white hover:border-slate-300")}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn("w-5 h-5 rounded flex items-center justify-center border", modalForm.selectedAlbs.includes(a.id) ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-300")}>
                        {modalForm.selectedAlbs.includes(a.id) && <Check className="w-3.5 h-3.5"/>}
                      </div>
                      <div>
                        <p className="font-black text-slate-800 text-xs">{String(a.date || 'S/F')}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">Ref: {String(a.num || 'S/N')}</p>
                      </div>
                    </div>
                    <p className="font-black text-slate-900 text-sm">{Num.fmt(Math.abs(Num.parse(a.total || 0)))}</p>
                  </label>
                ))}
              </div>
              
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between bg-slate-900 p-4 rounded-2xl text-white shadow-inner">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Factura</span>
                  <span className="text-2xl font-black text-emerald-400 tracking-tighter">{Num.fmt(modalForm.selectedAlbs.reduce((acc, id) => { const alb = albaranesSeguros.find(a => a && a.id === id); return acc + Math.abs(Num.parse(alb?.total || 0)); }, 0))}</span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  {mode === 'socio' ? (
                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Responsable</label><select value={modalForm.num.startsWith('SOCIO-') ? modalForm.num.split('-')[1] : ''} onChange={(e) => { const socio = e.target.value; setModalForm({ ...modalForm, num: `LIQ-${socio}-${modalForm.date.replace(/-/g,'')}` }); setSelectedGroup(prev => prev ? { ...prev, label: socio } : null); }} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition cursor-pointer"><option value="">Selecciona</option>{SOCIOS_REALES_NAMES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                  ) : (
                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Nº Oficial Factura</label><input type="text" value={modalForm.num} onChange={(e) => setModalForm({ ...modalForm, num: e.target.value })} placeholder="F-2026/012" className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition" /></div>
                  )}
                  <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Fecha Emisión</label><input type="date" value={modalForm.date} onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition" /></div>
                </div>

                {modalForm.selectedAlbs.length > 0 && !modalForm.num.trim() && (
                   <p className="text-[10px] font-bold text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-200 flex items-center gap-1.5">
                     <AlertCircle className="w-3.5 h-3.5" /> Escribe un número de factura para guardar.
                   </p>
                )}
                
                <button onClick={handleConfirmManualInvoice} disabled={modalForm.selectedAlbs.length === 0 || isProcessing || !modalForm.num.trim()} className="w-full bg-indigo-600 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 shadow-lg shadow-indigo-600/20 active:scale-95 transition-all">
                  {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5"/>} Emitir Factura Final
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🛡️ MODAL DE DETALLE DE FACTURA */}
      {selectedInvoice && typeof selectedInvoice === 'object' && selectedInvoice.id && (
        <InvoiceDetailModal 
          factura={selectedInvoice as any} 
          albaranes={albaranesSeguros} 
          businessUnits={BUSINESS_UNITS} 
          mode={mode} 
          onClose={() => setSelectedInvoice(null)} 
          onDownloadFile={handleDownloadFile}
          onTogglePago={handleTogglePago} 
          onSaveData={onSave}
          fullData={safeData}
        />
      )}
    </div>
  );
};
