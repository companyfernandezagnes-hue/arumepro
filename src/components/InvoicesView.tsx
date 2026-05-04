import React, { useState, useMemo, useEffect, useDeferredValue, useRef } from 'react';
import { 
  Building2, Search, Trash2, UploadCloud, Zap, 
  CheckCircle2, Clock, Check, Download, Package, 
  X, Layers, ShieldCheck, List, Sparkles, ArrowDownLeft,
  Calendar, Wand2, PieChart, ArrowUpRight, ArrowDownRight,
  Eye, Save, MailCheck, FileText, Inbox, AlertCircle, Bot,
  ChevronLeft, ChevronRight, Users, Loader2, Smartphone, Merge,
  // 🆕 NUEVOS para vista de proveedores
  AlertTriangle, ChevronDown, ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { scanBase64 } from '../services/aiProviders';
import { AnimatedNumber } from './AnimatedNumber';
import { ReconciliadorEmails } from './ReconciliadorEmails';
import { FixYearsModal } from './FixYearsModal';

// 🛡️ TIPOS Y SERVICIOS CONECTADOS AL MOTOR CENTRAL
import { AppData, FacturaExtended, BusinessUnit, EmailDraft } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { basicNorm, linkAlbaranesToFactura, recomputeFacturaFromAlbaranes } from '../services/invoicing'; 
import { fetchNewEmails, markEmailAsParsed } from '../services/supabase';
import { GmailDirectSync } from '../services/gmailDirectSync';

// 🧩 COMPONENTES HIJOS
import { InvoicesList } from './InvoicesList';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'DLV',  name: 'Catering',    icon: Zap,       color: 'text-amber-600',  bg: 'bg-amber-50'  },
  { id: 'SHOP', name: 'Tienda Sake', icon: Package,   color: 'text-emerald-600',bg: 'bg-emerald-50'},
  { id: 'CORP', name: 'Socios/Corp', icon: Users,     color: 'text-slate-600',  bg: 'bg-slate-100' },
];

export interface InvoicesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

const safeJSON = (str: string) => { 
  try { const match = str.match(/\{[\s\S]*\}/); return match ? JSON.parse(match[0]) : {}; } 
  catch { return {}; } 
};

// ─────────────────────────────────────────────────────────────────────────────
// 🧠 FUZZY MATCHING DE PROVEEDORES
// Agrupa nombres similares: "Llorenç Cerdà", "Cerda Obrador", "CERDÁ SL" → mismo grupo
// ─────────────────────────────────────────────────────────────────────────────
const normProv = (s?: string | null): string => {
  if (!s || typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')          // quitar acentos
    .replace(/\b(sl|sa|slu|sll|sc|cb|scp|hijos|hnos|hermanos|distribuciones|distribuidora|comercial|logistica)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const provTokens = (s: string): string[] =>
  normProv(s).split(' ').filter(t => t.length > 2);

// Similitud entre 0-100: cuántos tokens de A aparecen en B o viceversa
const provSimilarity = (a: string, b: string): number => {
  const ta = provTokens(a);
  const tb = provTokens(b);
  if (!ta.length || !tb.length) return 0;
  const matched = ta.filter(t => tb.some(u => u.includes(t) || t.includes(u)));
  return Math.round((matched.length / Math.min(ta.length, tb.length)) * 100);
};

// Dado un nombre de proveedor, devuelve la clave existente si hay similitud ≥ 60%
// o genera una nueva clave. Así "Cerda Obrador" se une al grupo "Llorenç Cerdà".
const getFuzzyProvKey = (owner: string, unitId: string, existingKeys: string[]): string => {
  for (const key of existingKeys) {
    const keyProv = key.replace(/_[A-Z]+$/, ''); // quitar sufijo _REST, _DLV, etc.
    if (provSimilarity(normProv(owner), keyProv) >= 60) return key;
  }
  return `${normProv(owner)}_${unitId}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// 🆕 VISTA POR PROVEEDOR — tipo y función de cálculo de estado
// ─────────────────────────────────────────────────────────────────────────────
interface ProveedorEstado {
  nombre: string;
  albaranesSueltos: any[];         // albaranes sin factura asignada
  facturasPendientes: FacturaExtended[]; // facturas paid=false
  facturasPagadas: FacturaExtended[];    // facturas paid=true o reconciled
  totalSuelto: number;
  totalPendiente: number;
  totalPagado: number;
}

/**
 * Construye un mapa de estado por proveedor usando fuzzy matching para
 * agrupar variantes del mismo nombre ("Cerda", "Cerdà", "Cerda Obrador").
 * Ordena por urgencia: primero proveedores con albaranes sueltos o pendientes.
 */
const buildProveedorEstado = (
  albaranes: any[],
  facturas: FacturaExtended[],
  mesFilter: string  // 'YYYY-MM' o '' para todos los meses
): ProveedorEstado[] => {
  const map = new Map<string, ProveedorEstado>();

  const getOrCreate = (rawName: string): ProveedorEstado => {
    // Buscar si ya existe una entrada fuzzy-similar
    let foundKey = '';
    for (const key of map.keys()) {
      if (provSimilarity(normProv(rawName), normProv(key)) >= 60) { foundKey = key; break; }
    }
    const key = foundKey || rawName;
    if (!map.has(key)) {
      map.set(key, {
        nombre: rawName,
        albaranesSueltos: [], facturasPendientes: [], facturasPagadas: [],
        totalSuelto: 0, totalPendiente: 0, totalPagado: 0,
      });
    }
    const entry = map.get(key)!;
    // Conservar el nombre más descriptivo (más largo)
    if (rawName.length > entry.nombre.length) entry.nombre = rawName;
    return entry;
  };

  // Albaranes sueltos (no invoiced)
  albaranes.forEach(a => {
    if (!a || a.invoiced) return;
    if (mesFilter && !String(a.date || '').startsWith(mesFilter)) return;
    const entry = getOrCreate(String(a.prov || 'Sin proveedor'));
    entry.albaranesSueltos.push(a);
    entry.totalSuelto = Num.round2(entry.totalSuelto + Math.abs(Num.parse(a.total) || 0));
  });

  // Facturas de compra (pagadas y pendientes)
  facturas.forEach(f => {
    if (!f || f.tipo === 'caja' || f.tipo === 'venta') return;
    if (mesFilter && !String(f.date || '').startsWith(mesFilter)) return;
    const entry = getOrCreate(String(f.prov || f.cliente || 'Sin proveedor'));
    if (f.paid || f.reconciled) {
      entry.facturasPagadas.push(f);
      entry.totalPagado = Num.round2(entry.totalPagado + Math.abs(Num.parse(f.total) || 0));
    } else {
      entry.facturasPendientes.push(f);
      entry.totalPendiente = Num.round2(entry.totalPendiente + Math.abs(Num.parse(f.total) || 0));
    }
  });

  // Ordenar: urgentes primero (con sueltos o pendientes), luego por volumen
  return Array.from(map.values()).sort((a, b) => {
    const urgA = (a.albaranesSueltos.length > 0 || a.facturasPendientes.length > 0) ? 1 : 0;
    const urgB = (b.albaranesSueltos.length > 0 || b.facturasPendientes.length > 0) ? 1 : 0;
    if (urgB !== urgA) return urgB - urgA;
    return (b.totalSuelto + b.totalPendiente) - (a.totalSuelto + a.totalPendiente);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 🏦 COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
export const InvoicesView = ({ data, onSave }: InvoicesViewProps) => {
  const safeData          = data || {};
  const facturasSeguras   = Array.isArray(safeData.facturas)    ? safeData.facturas  as FacturaExtended[] : [];
  const albaranesSeguros  = Array.isArray(safeData.albaranes)  ? safeData.albaranes : [];
  const sociosSeguros     = Array.isArray(safeData.socios)     ? safeData.socios    : [];
  const gastosFijos       = Array.isArray(safeData.gastos_fijos) ? safeData.gastos_fijos : [];

  const sociosRealesObj   = sociosSeguros.length > 0 ? sociosSeguros.filter(s => s && s.active) : [{ id: 's1', n: 'ARUME' }];
  const SOCIOS_REALES_NAMES = sociosRealesObj.map(s => String(s?.n || 'Desconocido'));

  // 🛡️ Filtrar cajas Z y facturas de caja de la bóveda B2B
  const facturasBoveda = useMemo(() => facturasSeguras.filter(f => {
    if (!f) return false;
    if (f.tipo === 'caja') return false;
    if (f.cliente === 'Z DIARIO') return false;
    if (String(f.num || '').toUpperCase().startsWith('Z'))    return false;
    if (String(f.num || '').toUpperCase().startsWith('CAJA')) return false;
    return true;
  }), [facturasSeguras]);

  // ── Estado ────────────────────────────────────────────────────────────────
  // 🆕 'proveedores' añadido al tipo de la pestaña activa
  const [activeTab,        setActiveTab]        = useState<'pend' | 'hist' | 'proveedores' | 'gestoria'>('pend');
  const [mode,             setMode]             = useState<'proveedor' | 'socio'>('proveedor');
  const [year,             setYear]             = useState(new Date().getFullYear());
  const [searchQ,          setSearchQ]          = useState('');
  const deferredSearch                          = useDeferredValue(searchQ);

  const [filterStatus,     setFilterStatus]     = useState<'all' | 'pending' | 'paid' | 'reconciled'>('all');
  const [selectedUnit,     setSelectedUnit]     = useState<BusinessUnit | 'ALL'>('ALL');

  const [isExportModalOpen,setIsExportModalOpen]= useState(false);
  const [isReconcilerOpen, setIsReconcilerOpen] = useState(false);
  const [isFixYearsOpen, setIsFixYearsOpen]   = useState(false);
  const [exportQuarter,    setExportQuarter]    = useState(Math.floor(new Date().getMonth() / 3) + 1);

  const [isSyncing,        setIsSyncing]        = useState(false);
  const [isProcessing,     setIsProcessing]     = useState(false);

  const [selectedGroup,    setSelectedGroup]    = useState<{ label: string; ids: string[]; unitId: BusinessUnit } | null>(null);
  const [selectedInvoice,  setSelectedInvoice]  = useState<FacturaExtended | null>(null);
  const [modalForm,        setModalForm]        = useState({ num: '', date: DateUtil.today(), selectedAlbs: [] as string[], unitId: 'REST' as BusinessUnit });

  const [autoGroupPreview, setAutoGroupPreview] = useState<FacturaExtended[] | null>(null);
  // Índice del borrador en edición dentro del preview (-1 = ninguno)
  const [editingDraftIdx,  setEditingDraftIdx]  = useState<number>(-1);

  const [emailAuditInbox,  setEmailAuditInbox]  = useState<EmailDraft[]>([]);

  // 🆕 Estado para la pestaña de proveedores
  const [provMesFilter,    setProvMesFilter]    = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [expandedProv,     setExpandedProv]     = useState<string | null>(null);

  // 📤 Estado para previsualización de PDF en la pestaña Gestoría
  const [previewFactura,   setPreviewFactura]   = useState<FacturaExtended | null>(null);

  // ── Teclado ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedGroup(null); setIsExportModalOpen(false);
        setSelectedInvoice(null); setAutoGroupPreview(null); setEditingDraftIdx(-1);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

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

  // ── Bot Telegram ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handleBotCommand = (e: any) => {
      const { cmd, q } = e.detail || {};
      if (cmd === 'buscar' && q) { setSearchQ(q); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      if (cmd === 'sync_emails') { fetchPendingAudits(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
    };
    window.addEventListener('arume-bot-command', handleBotCommand);
    return () => window.removeEventListener('arume-bot-command', handleBotCommand);
  }, []);

  // ============================================================================
  // 🧠 CEREBRO DE AGRUPACIÓN INTELIGENTE CON FUZZY MATCHING
  // Agrupa albaranes del mismo proveedor (aunque el nombre esté escrito distinto)
  // por mes → genera las tarjetas de la sala de espera
  // ============================================================================
  const pendingGroups = useMemo(() => {
    try {
      const byMonth: Record<string, { name: string; groups: Record<string, any> }> = {};
      const q = deferredSearch ? normProv(deferredSearch) : '';

      albaranesSeguros.forEach(a => {
        if (!a || typeof a !== 'object' || a.invoiced) return;

        let aDate = String(a.date || '');
        if (aDate.includes('/')) {
          const parts = aDate.split('/');
          if (parts.length === 3) aDate = `${parts[2].length === 2 ? '20' + parts[2] : parts[2]}-${parts[1]}-${parts[0]}`;
        }
        if (!aDate.startsWith(year.toString())) return;

        const itemUnit = (a as any).unitId || 'REST';
        if (selectedUnit !== 'ALL' && itemUnit !== selectedUnit) return;

        const owner = String((mode === 'proveedor' ? a.prov : (a as any).socio) || 'Sin Identificar');

        if (q) {
          if (!normProv(owner).includes(q) && !normProv(String(a.num || '')).includes(q)) return;
        }

        const mk = aDate.substring(0, 7);
        if (!mk) return;

        if (!byMonth[mk]) {
          const parts = mk.split('-');
          const y0 = parts[0] || '0000';
          const m0 = parseInt(parts[1] || '1', 10);
          const names = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
          byMonth[mk] = { name: `${names[isNaN(m0) ? 1 : m0] || 'Mes'} ${y0}`, groups: {} };
        }

        // 🆕 FUZZY: busca si ya hay un grupo con nombre similar en este mes
        const existingKeys = Object.keys(byMonth[mk].groups);
        const gKey = getFuzzyProvKey(owner, itemUnit, existingKeys);

        if (!byMonth[mk].groups[gKey]) {
          byMonth[mk].groups[gKey] = { label: owner, unitId: itemUnit, t: 0, ids: [], count: 0 };
        } else {
          // Conservar el nombre más descriptivo (más largo)
          if (owner.length > byMonth[mk].groups[gKey].label.length) {
            byMonth[mk].groups[gKey].label = owner;
          }
        }

        byMonth[mk].groups[gKey].t += Math.abs(Num.parse(a.total) || 0);
        byMonth[mk].groups[gKey].count += 1;
        byMonth[mk].groups[gKey].ids.push(a.id);
      });

      return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
    } catch { return []; }
  }, [albaranesSeguros, year, mode, deferredSearch, selectedUnit]);

  // ── Helper: albaranes disponibles para editar un borrador del preview ─────
  // Devuelve los albaranes del mismo mes que:
  //   a) ya están en ESTE borrador, O
  //   b) no están asignados a ningún OTRO borrador
  const getAlbsForDraftMonth = (draft: FacturaExtended) => {
    const mk = (draft.date || '').substring(0, 7);
    const usedInOtherDrafts = new Set(
      (autoGroupPreview || [])
        .filter(d => d.id !== draft.id)
        .flatMap(d => d.albaranIdsArr || [])
    );
    return albaranesSeguros.filter(a =>
      a && !a.invoiced &&
      String(a.date || '').startsWith(mk) &&
      !usedInOtherDrafts.has(a.id)
    );
  };

  // 🆕 Estado calculado por proveedor para la nueva pestaña
  const proveedorEstados = useMemo(
    () => buildProveedorEstado(albaranesSeguros, facturasBoveda, provMesFilter),
    [albaranesSeguros, facturasBoveda, provMesFilter]
  );

  // 🆕 Lista de meses disponibles para el selector de la pestaña proveedores
  const mesesDisponibles = useMemo(() => {
    const meses = new Set<string>();
    albaranesSeguros.forEach(a => {
      const m = String(a?.date || '').substring(0, 7);
      if (m && m.length === 7) meses.add(m);
    });
    facturasBoveda.forEach(f => {
      const m = String(f?.date || '').substring(0, 7);
      if (m && m.length === 7) meses.add(m);
    });
    return Array.from(meses).sort((a, b) => b.localeCompare(a));
  }, [albaranesSeguros, facturasBoveda]);

  // ── Preparar auto-agrupación (botón "Revisar Auto-Agrupación") ────────────
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
            prov:    mode === 'proveedor' ? String(g.label) : 'Varios',
            cliente: mode === 'socio'     ? String(g.label) : 'Arume',
            total: String(g.t), base: '0', tax: '0',
            albaranIdsArr: g.ids,
            paid: false, reconciled: false, source: 'manual-group', status: 'approved',
            unidad_negocio: g.unitId || 'REST',
          });
        }
      });
    });

    if (drafts.length > 0) { setAutoGroupPreview(drafts); setEditingDraftIdx(-1); }
    else toast.warning('No hay albaranes pendientes para agrupar.');
  };

  // ── Confirmar todos los borradores del preview ────────────────────────────
  const handleConfirmAutoGroupAll = async () => {
    if (!autoGroupPreview) return;
    // Filtrar borradores sin albaranes (el usuario los vació manualmente)
    const validDrafts = autoGroupPreview.filter(f => (f.albaranIdsArr || []).length > 0);
    if (validDrafts.length === 0) { toast.warning('No hay borradores con albaranes para guardar.'); return; }

    const missingNum = validDrafts.some(f => !f.num.trim());
    if (missingNum) {
      if (!await confirm('⚠️ Algunas facturas no tienen número oficial (quedarán en blanco). ¿Continuar de todos modos?')) return;
    }

    setIsProcessing(true);
    try {
      const newData = JSON.parse(JSON.stringify(safeData));
      if (!newData.facturas) newData.facturas = [];

      validDrafts.forEach(f => {
        f.total = '0'; f.base = '0'; f.tax = '0';
        newData.facturas.unshift(f);
        linkAlbaranesToFactura(newData, f.id, f.albaranIdsArr || [], { strategy: 'useAlbTotals' });
      });

      newData.facturas = [...newData.facturas];
      await onSave(newData);
      setAutoGroupPreview(null);
      setEditingDraftIdx(-1);
      setActiveTab('hist');
      toast.success(`✅ ${validDrafts.length} facturas guardadas correctamente.`);
    } catch { toast.error('⚠️ Hubo un error al guardar.'); }
    finally { setIsProcessing(false); }
  };

  // ── Fusionar dos borradores en uno ────────────────────────────────────────
  const handleMergeDrafts = (idxA: number, idxB: number) => {
    if (!autoGroupPreview) return;
    const newDrafts = [...autoGroupPreview];
    const a = newDrafts[idxA];
    const b = newDrafts[idxB];
    // Fusionar: el borrador A absorbe los albaranes de B
    a.albaranIdsArr = [...new Set([...(a.albaranIdsArr || []), ...(b.albaranIdsArr || [])])];
    a.prov = `${a.prov} + ${b.prov}`;
    newDrafts.splice(idxB, 1);
    // Ajustar el índice de edición si hace falta
    if (editingDraftIdx === idxB) setEditingDraftIdx(idxA);
    else if (editingDraftIdx > idxB) setEditingDraftIdx(editingDraftIdx - 1);
    setAutoGroupPreview(newDrafts);
    toast.success('Borradores fusionados ✓');
  };

  // ── Agrupación manual (modal de tarjeta individual) ───────────────────────
  const handleConfirmManualInvoice = async () => {
    if (!modalForm.num.trim() || modalForm.selectedAlbs.length === 0) return;
    setIsProcessing(true);
    try {
      const newData = JSON.parse(JSON.stringify(safeData));
      const newFacId = `fac-manual-${Date.now()}`;
      const newFactura: FacturaExtended = {
        id: newFacId, tipo: mode === 'proveedor' ? 'compra' : 'venta',
        num: modalForm.num, date: modalForm.date,
        prov:    mode === 'proveedor' ? (selectedGroup?.label || '') : 'Varios',
        cliente: mode === 'socio'     ? (selectedGroup?.label || '') : 'Arume',
        total: '0', base: '0', tax: '0',
        albaranIdsArr: [], paid: false, reconciled: false,
        source: 'manual-group', status: 'approved', unidad_negocio: modalForm.unitId || 'REST',
      };
      newData.facturas.unshift(newFactura);
      linkAlbaranesToFactura(newData, newFacId, modalForm.selectedAlbs, { strategy: 'useAlbTotals' });
      newData.facturas = [...newData.facturas];
      await onSave(newData);
      setSelectedGroup(null);
      toast.success('Factura creada correctamente ✓');
    } catch { toast.error('Error guardando la factura.'); }
    finally { setIsProcessing(false); }
  };

  const handleToggleAlbaran = (id: string) => {
    setModalForm(prev => {
      const isSelected = prev.selectedAlbs.includes(id);
      return { ...prev, selectedAlbs: isSelected ? prev.selectedAlbs.filter(alId => alId !== id) : [...prev.selectedAlbs, id] };
    });
  };

  // ── Pago / borrado de facturas ────────────────────────────────────────────
  const handleTogglePago = async (id: string) => {
    const newData = JSON.parse(JSON.stringify(safeData));
    const idx = newData.facturas.findIndex((f: any) => f && f.id === id);
    if (idx !== -1) {
      if (newData.facturas[idx].reconciled) return toast.error('🔒 Factura conciliada por el banco. No se puede alterar manualmente.');
      const nowPaid = !newData.facturas[idx].paid;
      newData.facturas[idx].paid   = nowPaid;
      newData.facturas[idx].status = nowPaid ? 'paid' : 'approved';
      newData.facturas[idx].fecha_pago = nowPaid ? DateUtil.today() : undefined;
      newData.facturas = [...newData.facturas];
      await onSave(newData);
    }
  };

  const handleDeleteFactura = async (id: string) => {
    const fac = facturasBoveda.find(f => f && f.id === id);
    if (!fac) return;
    if (fac.reconciled) return toast.error('⚠️ No puedes borrar una factura validada por el Banco.');
    if (!await confirm(`🛑 ¿Eliminar la factura ${fac.num || 'sin número'}? Los albaranes volverán a la sala de espera.`)) return;

    const newData = JSON.parse(JSON.stringify(safeData));
    const idsToFree = fac.albaranIdsArr || [];
    if (Array.isArray(newData.albaranes)) {
      newData.albaranes.forEach((a: any) => { if (a && idsToFree.includes(a.id)) a.invoiced = false; });
    }
    newData.facturas = newData.facturas.filter((f: any) => f && f.id !== id);
    await onSave(newData);
    toast.success('Factura eliminada. Albaranes liberados.');
  };

  // ── Exportar a Excel ──────────────────────────────────────────────────────
  const handleExportGestoria = () => {
    const q = exportQuarter; const y = year;
    const startMonth = (q - 1) * 3 + 1; const endMonth = q * 3;
    const filtered = facturasBoveda.filter(f => {
      if (!f || typeof f !== 'object') return false;
      const fDate = String(f.date || '');
      return f.status !== 'draft' &&
        (selectedUnit === 'ALL' || f.unidad_negocio === selectedUnit) &&
        fDate.startsWith(y.toString()) &&
        Number(fDate.split('-')[1]) >= startMonth &&
        Number(fDate.split('-')[1]) <= endMonth;
    });
    if (filtered.length === 0) return toast.warning('No hay facturas en este periodo.');

    const rows = filtered.map(f => {
      const total = Math.abs(Num.parse(f.total) || 0);
      const base  = Math.abs(Num.parse(f.base) || Num.round2(total / 1.10));
      const tax   = Math.abs(Num.parse(f.tax)  || Num.round2(total - base));
      return {
        'FECHA': f.date || '', 'Nº FACTURA': f.num || '',
        'PROVEEDOR/CLIENTE': f.prov || f.cliente || '—',
        'UNIDAD NEGOCIO': BUSINESS_UNITS.find(u => u.id === f.unidad_negocio)?.name || 'Restaurante',
        'BASE IMPONIBLE': Num.fmt(base), 'IVA': Num.fmt(tax), 'TOTAL': Num.fmt(total),
        'ESTADO': f.paid ? 'PAGADA' : 'PENDIENTE', 'CONCILIADA': f.reconciled ? 'SÍ' : 'NO',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
    XLSX.writeFile(wb, `Gestoria_Arume_${y}_Q${q}_${selectedUnit}.xlsx`);
    setIsExportModalOpen(false);
  };

  const handleDownloadFile = (f: FacturaExtended) => {
    if (!f || !f.file_base64) return toast.warning('El PDF original no está disponible.');
    try {
      const a = document.createElement('a');
      a.href = f.file_base64.startsWith('data:') ? f.file_base64 : `data:application/pdf;base64,${f.file_base64}`;
      a.download = `${basicNorm(f.prov || 'factura')}_${f.num || 'SN'}.pdf`;
      a.click();
    } catch { toast.error('Error al descargar el archivo'); }
  };

  // ============================================================================
  // 📧 AUDITORÍA DOCUMENTAL — cruza PDFs del correo con facturas de la bóveda
  // ============================================================================
  const fetchPendingAudits = async () => {
    setIsSyncing(true);
    try {
      const byId = new Map<string, EmailDraft>();
      let gmailError: string | undefined;

      // 1. Inbox local (puesto por ArumeAgent / sincronizaciones previas)
      try {
        const localInbox = JSON.parse(localStorage.getItem('arume_gmail_inbox') || '[]');
        for (const e of localInbox) if (e?.id) byId.set(e.id, e);
      } catch { /* ignore */ }

      // 2. Gmail directo en tiempo real si hay sesión
      if (GmailDirectSync.isAuthenticated()) {
        try {
          const result = await GmailDirectSync.fetchNewEmails(10);
          if (result.error) gmailError = result.error;
          if (result.emails.length > 0) {
            const drafts = GmailDirectSync.toEmailDrafts(result.emails);
            for (const d of drafts) if (!byId.has(d.id)) byId.set(d.id, d as any);
            // Persistimos el inbox para no perderlo al recargar
            const merged = Array.from(byId.values()).slice(0, 100);
            localStorage.setItem('arume_gmail_inbox', JSON.stringify(merged));
            // Marcar como leídos sólo después de almacenarlos
            for (const msg of result.emails) await GmailDirectSync.markAsRead(msg.id);
          }
        } catch (err: any) {
          gmailError = err?.message || 'Error de Gmail directo';
        }
      }

      // 3. Fallback Supabase si no hubo nada en local ni Gmail
      if (byId.size === 0) {
        try {
          const supaEmails = await fetchNewEmails();
          for (const e of supaEmails) if (e?.id) byId.set(e.id, e);
        } catch { /* ignore */ }
      }

      const allEmails = Array.from(byId.values());
      if (allEmails.length > 0) {
        setEmailAuditInbox(allEmails);
        toast.success(`📬 ${allEmails.length} PDFs en el buzón.`);
      } else if (gmailError) {
        toast.warning(`⚠️ ${gmailError}`);
      } else {
        toast.warning('📭 No hay PDFs nuevos en el buzón para auditar.');
      }
    } catch (err: any) {
      toast.error(`⚠️ Error conectando al buzón: ${err?.message || 'desconocido'}`);
    }
    setIsSyncing(false);
  };

  const processEmailAudit = async (email: EmailDraft) => {
    if (!email.fileBase64) return;
    setIsProcessing(true);
    try {
      const prompt = `Actúa como un Auditor Contable. Analiza esta factura y devuelve SOLO un JSON estricto:
{"proveedor": "Nombre del emisor", "total": 0.00, "fecha": "YYYY-MM-DD", "num_factura": "Número o S/N"}`;

      const result = await scanBase64(email.fileBase64, 'application/pdf', prompt);

      const rawJson       = result.raw as any;
      const provDetectado = rawJson.proveedor   || '';
      const totalDetectado= Num.parse(rawJson.total);
      const numDetectado  = rawJson.num_factura || '';

      // Buscar coincidencia por total (tolerancia 1€) y/o número de factura
      const match = facturasBoveda.find(f =>
        !f.file_base64 && (
          Math.abs(Num.parse(f.total) - totalDetectado) <= 1.00 ||
          (numDetectado && numDetectado !== 'S/N' && String(f.num || '').includes(numDetectado))
        )
      );

      if (match) {
        if (await confirm(
          `✅ ¡MATCH ENCONTRADO!\n\n` +
          `PDF de ${provDetectado} · ${Num.fmt(totalDetectado)}\n` +
          `↳ Coincide con tu factura: ${match.num} (${Num.fmt(Num.parse(match.total))})\n\n` +
          `¿Adjuntar este PDF a esa factura?`
        )) {
          const newData = JSON.parse(JSON.stringify(safeData));
          const fIndex  = newData.facturas.findIndex((f: any) => f.id === match.id);
          if (fIndex > -1) {
            newData.facturas[fIndex].file_base64 = `data:application/pdf;base64,${email.fileBase64}`;
            await onSave(newData);
            await markEmailAsParsed(email.id);
            setEmailAuditInbox(prev => prev.filter(e => e.id !== email.id));
            // También fuera del estado: limpiar el inbox persistido para que no
            // reaparezca al volver a "Escanear Buzón".
            try {
              const stored = JSON.parse(localStorage.getItem('arume_gmail_inbox') || '[]');
              const filtered = stored.filter((e: any) => e?.id !== email.id);
              localStorage.setItem('arume_gmail_inbox', JSON.stringify(filtered));
            } catch { /* ignore */ }
            toast.success('📎 PDF adjuntado correctamente.');
          }
        }
      } else {
        toast.warning(
          `❌ Sin coincidencias. PDF de ${provDetectado} · ${Num.fmt(totalDetectado)}. ` +
          `No hay facturas pendientes con ese importe.`
        );
      }
    } catch { toast.error('Error procesando el PDF. Comprueba la clave API.'); }
    finally { setIsProcessing(false); }
  };

  const handleTriggerSync = async () => {
    setIsProcessing(true);
    try {
      if (GmailDirectSync.isAuthenticated()) {
        // Ya autenticado → sincronizar
        const result = await GmailDirectSync.fetchNewEmails(20);
        if (result.error) {
          // Mostrar error real (token expirado, fallo API…) en vez de tragarlo
          toast.warning(`⚠️ ${result.error}`);
        } else if (result.emails.length > 0) {
          const drafts = GmailDirectSync.toEmailDrafts(result.emails);
          const existing = JSON.parse(localStorage.getItem('arume_gmail_inbox') || '[]');
          const existingIds = new Set(existing.map((e: any) => e.id));
          const nuevos = drafts.filter(d => !existingIds.has(d.id));
          localStorage.setItem('arume_gmail_inbox', JSON.stringify([...nuevos, ...existing].slice(0, 100)));
          for (const msg of result.emails) await GmailDirectSync.markAsRead(msg.id);
          toast.success(`🤖 ${nuevos.length} PDFs nuevos sincronizados desde Gmail.`);
        } else {
          toast.success('📭 Gmail revisado — sin PDFs nuevos.');
        }
      } else {
        // No autenticado → intentar conectar OAuth
        try {
          const token = await GmailDirectSync.authorize();
          if (token) {
            toast.success('✅ Gmail conectado. Pulsa de nuevo para sincronizar.');
          } else {
            toast.warning('⚠️ No se pudo conectar Gmail. Verifica que tengas un Client ID de Google configurado en la pestaña Agente.');
          }
        } catch (err: any) {
          const code = err?.message;
          if (code === 'NO_CLIENT_ID') {
            toast.warning('🔑 Necesitas configurar un Google Client ID en la pestaña Agente para conectar Gmail directamente.');
          } else if (code === 'GIS_LOAD_FAIL' || code === 'GIS_UNAVAILABLE') {
            toast.error('❌ No se pudo cargar Google Identity Services. Comprueba tu conexión.');
          } else {
            toast.error(`❌ Error al conectar con Gmail: ${code || 'desconocido'}`);
          }
        }
      }
    } catch (err: any) {
      // Mostrar error real (no un mensaje genérico) para poder diagnosticarlo
      toast.error(`❌ Error al sincronizar: ${err?.message || 'desconocido'}`);
    }
    finally { setIsProcessing(false); }
  };

  // ── Subida masiva de PDFs de facturas del correo ─────────────────────────
  const [uploadResults, setUploadResults] = useState<{ name: string; status: 'ok' | 'no-match' | 'error'; msg: string }[]>([]);
  const [isUploading, setIsUploading]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBulkPDFUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadResults([]);
    const results: typeof uploadResults = [];
    let newData = JSON.parse(JSON.stringify(safeData));
    let attached = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = file.name;
      toast.success(`📄 Procesando ${i + 1}/${files.length}: ${fileName}…`);

      try {
        // Leer base64
        const b64: string = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.includes(',') ? result.split(',')[1] : result);
          };
          reader.readAsDataURL(file);
        });

        const mimeType = file.type || 'application/pdf';

        // IA extrae datos del PDF
        const prompt = `Actúa como un Auditor Contable. Analiza esta factura y devuelve SOLO un JSON estricto sin markdown:
{"proveedor": "Nombre del emisor", "total": 0.00, "base": 0.00, "iva": 0.00, "fecha": "YYYY-MM-DD", "num_factura": "Número o S/N"}
Usa punto como separador decimal.`;

        const result = await scanBase64(b64, mimeType, prompt);
        const rawJson       = result.raw as any;
        const provDetectado = String(rawJson.proveedor   || '');
        const totalDetectado= Num.parse(rawJson.total);
        const baseDetectado = Num.parse(rawJson.base);
        const ivaDetectado  = Num.parse(rawJson.iva);
        const fechaDetectada= String(rawJson.fecha       || '');
        const numDetectado  = String(rawJson.num_factura  || '');

        // Buscar coincidencia en facturas sin PDF adjunto
        const match = newData.facturas.find((f: any) =>
          f && !f.file_base64 && f.tipo !== 'caja' && (
            // Match por total (tolerancia 1€)
            Math.abs(Num.parse(f.total) - totalDetectado) <= 1.00 ||
            // Match por número de factura
            (numDetectado && numDetectado !== 'S/N' && String(f.num || '').toLowerCase().includes(numDetectado.toLowerCase())) ||
            // Match por proveedor + importe similar (tolerancia 5€)
            (provDetectado && basicNorm(f.prov || '').includes(basicNorm(provDetectado).substring(0, 6)) && Math.abs(Num.parse(f.total) - totalDetectado) <= 5.00)
          )
        );

        if (match) {
          const fIndex = newData.facturas.findIndex((f: any) => f.id === match.id);
          if (fIndex > -1) {
            newData.facturas[fIndex].file_base64 = `data:${mimeType};base64,${b64}`;
            if (!newData.facturas[fIndex].base && baseDetectado) newData.facturas[fIndex].base = baseDetectado;
            if (!newData.facturas[fIndex].tax && ivaDetectado)   newData.facturas[fIndex].tax  = ivaDetectado;
            attached++;
            results.push({ name: fileName, status: 'ok', msg: `✅ → ${match.prov || provDetectado} · ${match.num || numDetectado} · ${Num.fmt(totalDetectado)}` });
          }
        } else {
          // No hay match → crear factura nueva como borrador
          const newId = `upload-${Date.now()}-${i}`;
          const nuevaFactura: any = {
            id: newId,
            tipo: 'compra',
            num: numDetectado !== 'S/N' ? numDetectado : '',
            date: fechaDetectada || DateUtil.today(),
            prov: provDetectado,
            total: totalDetectado,
            base: baseDetectado || undefined,
            tax: ivaDetectado || undefined,
            paid: false,
            reconciled: false,
            status: 'parsed',
            source: 'dropzone',
            file_base64: `data:${mimeType};base64,${b64}`,
            unidad_negocio: 'REST',
          };
          if (!newData.facturas) newData.facturas = [];
          newData.facturas.push(nuevaFactura);
          attached++;
          results.push({ name: fileName, status: 'no-match', msg: `🆕 Nueva factura: ${provDetectado} · ${Num.fmt(totalDetectado)} — revísala en la Bóveda` });
        }
      } catch (err: any) {
        results.push({ name: fileName, status: 'error', msg: `❌ Error: ${err.message || 'fallo al procesar'}` });
      }
    }

    // Guardar todo de golpe
    if (attached > 0) {
      newData.facturas = [...newData.facturas];
      await onSave(newData);
    }

    setUploadResults(results);
    setIsUploading(false);
    toast.success(`📤 ${files.length} PDFs procesados. ${attached} adjuntados/creados.`);
  };

  // ── Totales para la barra de progreso ────────────────────────────────────
  const totalFacturadoCalc = facturasBoveda.filter(f => f.tipo === 'compra').reduce((acc, f) => acc + Math.abs(Num.parse(f.total) || 0), 0);
  const totalPagadoCalc    = facturasBoveda.filter(f => f.tipo === 'compra' && f.paid).reduce((acc, f) => acc + Math.abs(Num.parse(f.total) || 0), 0);
  const progressPercent    = totalFacturadoCalc > 0 ? (totalPagadoCalc / totalFacturadoCalc) * 100 : 0;

  // 🆕 Badge: albaranes sueltos totales (para la pestaña Proveedores)
  const albsSueltosTotales = albaranesSeguros.filter(a => a && !a.invoiced).length;

  // ============================================================================
  // 📤 PARA GESTORÍA — facturas pagadas listas para subir a Bilky
  // ============================================================================
  const gestoriaData = useMemo(() => {
    // Facturas de compra pagadas
    const pagadas = facturasBoveda.filter(f =>
      f && (f.paid || f.reconciled) && f.tipo === 'compra'
    );
    const conPdf     = pagadas.filter(f => !!f.file_base64);
    const sinPdf     = pagadas.filter(f => !f.file_base64);
    const yaSubidas  = conPdf.filter(f => (f as any).uploaded_gestoria === true);
    const pendientes = conPdf.filter(f => (f as any).uploaded_gestoria !== true);

    // Nóminas y Seguridad Social (gastos fijos tipo payroll)
    const nominas = gastosFijos.filter((g: any) =>
      g && (g.type === 'payroll' || g.cat === 'personal') && (g.active !== false && g.activo !== false)
    );
    const nominasConPdf     = nominas.filter((g: any) => !!g.file_base64);
    const nominasSinPdf     = nominas.filter((g: any) => !g.file_base64);
    const nominasSubidas    = nominasConPdf.filter((g: any) => g.uploaded_gestoria === true);
    const nominasPendientes = nominasConPdf.filter((g: any) => g.uploaded_gestoria !== true);

    return {
      conPdf, sinPdf, yaSubidas, pendientes, totalPagadas: pagadas.length,
      nominas, nominasConPdf, nominasSinPdf, nominasSubidas, nominasPendientes,
    };
  }, [facturasBoveda, gastosFijos]);

  const handleToggleGestoria = async (id: string) => {
    const newData = JSON.parse(JSON.stringify(safeData));
    const idx = newData.facturas.findIndex((f: any) => f && f.id === id);
    if (idx !== -1) {
      const now = (newData.facturas[idx] as any).uploaded_gestoria;
      (newData.facturas[idx] as any).uploaded_gestoria = !now;
      (newData.facturas[idx] as any).fecha_upload_gestoria = !now ? DateUtil.today() : undefined;
      newData.facturas = [...newData.facturas];
      await onSave(newData);
      toast.success(!now ? '✅ Marcada como subida a gestoría' : '↩️ Desmarcada de gestoría');
    }
  };

  const handleToggleGestoriaNomina = async (id: string) => {
    const newData = JSON.parse(JSON.stringify(safeData));
    if (!newData.gastos_fijos) return;
    const idx = newData.gastos_fijos.findIndex((g: any) => g && g.id === id);
    if (idx !== -1) {
      const now = newData.gastos_fijos[idx].uploaded_gestoria;
      newData.gastos_fijos[idx].uploaded_gestoria = !now;
      newData.gastos_fijos[idx].fecha_upload_gestoria = !now ? DateUtil.today() : undefined;
      newData.gastos_fijos = [...newData.gastos_fijos];
      await onSave(newData);
      toast.success(!now ? '✅ Nómina marcada como subida a gestoría' : '↩️ Desmarcada de gestoría');
    }
  };

  const handleDownloadNomina = (g: any) => {
    if (!g || !g.file_base64) return toast.warning('El PDF de la nómina no está disponible.');
    try {
      const a = document.createElement('a');
      a.href = g.file_base64.startsWith('data:') ? g.file_base64 : `data:application/pdf;base64,${g.file_base64}`;
      a.download = `${basicNorm(g.name || 'nomina')}.pdf`;
      a.click();
    } catch { toast.error('Error al descargar el archivo'); }
  };

  const handleDownloadAllGestoria = () => {
    const facturasDown = gestoriaData.pendientes;
    const nominasDown  = gestoriaData.nominasPendientes;
    const total = facturasDown.length + nominasDown.length;
    if (total === 0) return toast.warning('No hay PDFs pendientes de subir.');
    let idx = 0;
    facturasDown.forEach((f) => {
      setTimeout(() => handleDownloadFile(f), idx * 300);
      idx++;
    });
    nominasDown.forEach((g: any) => {
      setTimeout(() => handleDownloadNomina(g), idx * 300);
      idx++;
    });
    toast.success(`⬇️ Descargando ${total} PDF(s)…`);
  };

  // ============================================================================
  // 🎨 RENDER
  // ============================================================================
  return (
    <div className="animate-fade-in space-y-4 pb-32 relative max-w-[1600px] mx-auto text-xs">

      {/* ── HEADER EDITORIAL ─────────────────────────────────────────────── */}
      <header className="bg-white rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm p-5 md:p-6 flex flex-col xl:flex-row justify-between gap-5 relative z-40 sticky top-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Compras</p>
          <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight mt-1">Facturación</h2>
          <p className="text-sm text-[color:var(--arume-gray-500)] mt-1">Agrupa albaranes, crea facturas y prepara la gestoría</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          {/* Pestañas — pills minimalistas */}
          <div className="flex items-center bg-[color:var(--arume-gray-50)] p-1 rounded-full border border-[color:var(--arume-gray-100)] w-full md:w-auto">
            <button onClick={() => setActiveTab('pend')}
              className={cn('flex-1 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] transition',
                activeTab === 'pend' ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] shadow-sm' : 'text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)]')}>
              Agrupar
            </button>
            <button onClick={() => setActiveTab('hist')}
              className={cn('flex-1 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] transition',
                activeTab === 'hist' ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] shadow-sm' : 'text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)]')}>
              Bóveda
            </button>
            <button onClick={() => setActiveTab('proveedores')}
              className={cn('flex-1 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] transition flex items-center justify-center gap-1.5',
                activeTab === 'proveedores' ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] shadow-sm' : 'text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)]')}>
              Proveedores
              {albsSueltosTotales > 0 && (
                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none',
                  activeTab === 'proveedores' ? 'bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)]' : 'bg-[color:var(--arume-accent)] text-white')}>
                  {albsSueltosTotales}
                </span>
              )}
            </button>
            <button onClick={() => setActiveTab('gestoria')}
              className={cn('flex-1 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] transition flex items-center justify-center gap-1.5',
                activeTab === 'gestoria' ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] shadow-sm' : 'text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)]')}>
              Gestoría
              {gestoriaData.pendientes.length > 0 && (
                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none',
                  activeTab === 'gestoria' ? 'bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)]' : 'bg-[color:var(--arume-accent)] text-white')}>
                  {gestoriaData.pendientes.length}
                </span>
              )}
            </button>
          </div>

          <button onClick={() => setIsReconcilerOpen(true)}
            title="Lee tus emails, busca los PDFs de facturas y los compara con las que tienes en la app"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition active:scale-[0.98] relative">
            <Sparkles className="w-3.5 h-3.5 ai-pulse" /> Auto-cuadrar
          </button>
          <button onClick={() => setIsFixYearsOpen(true)}
            title="Detecta documentos con año incorrecto (ej. 2019 en lugar de 2026) y los corrige en bloque"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-warn)]/15 text-[color:var(--arume-warn)] border border-[color:var(--arume-warn)]/30 hover:bg-[color:var(--arume-warn)]/25 transition active:scale-[0.98]">
            <Calendar className="w-3.5 h-3.5" /> Arreglar años
          </button>
          <button onClick={() => setIsExportModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] hover:brightness-95 transition active:scale-[0.98]">
            <Download className="w-3.5 h-3.5" /> Excel gestoría
          </button>
        </div>
      </header>

      {/* ── PÍLDORAS RESUMEN — solo en Bóveda ────────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeTab === 'hist' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white p-5 rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm hover-lift">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">💼 Total facturado B2B</p>
                <p className="font-serif text-2xl font-semibold mt-2 tabular-nums">
                  <AnimatedNumber value={totalFacturadoCalc} format={(n) => Num.fmt(n)}/>
                </p>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm hover-lift">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-accent)]">⏳ Pendiente pago</p>
                <p className="font-serif text-2xl font-semibold mt-2 tabular-nums text-[color:var(--arume-accent)]">
                  <AnimatedNumber value={totalFacturadoCalc - totalPagadoCalc} format={(n) => Num.fmt(n)}/>
                </p>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-[color:var(--arume-gray-100)] shadow-sm hover-lift">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-ok)]">✅ Total pagado</p>
                <p className="font-serif text-2xl font-semibold mt-2 tabular-nums text-[color:var(--arume-ok)]">
                  <AnimatedNumber value={totalPagadoCalc} format={(n) => Num.fmt(n)}/>
                </p>
              </div>
            </div>
            <div className="mt-3 bg-white border border-[color:var(--arume-gray-100)] rounded-xl p-3 shadow-sm flex items-center gap-4">
              <PieChart className="w-4 h-4 text-[color:var(--arume-gray-400)]" />
              <div className="flex-1 h-1.5 bg-[color:var(--arume-gray-100)] rounded-full overflow-hidden">
                <div className="h-full bg-[color:var(--arume-ok)] transition-all duration-1000" style={{ width: `${progressPercent}%` }} />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] tabular-nums">{progressPercent.toFixed(0)}% pagado</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FILTROS — solo visibles en pend e hist, no en proveedores ─────── */}
      {activeTab !== 'proveedores' && (
        <div className="bg-white px-5 py-3 rounded-2xl shadow-sm border border-[color:var(--arume-gray-100)] flex flex-col lg:flex-row items-center justify-between gap-3 relative z-30">
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            {/* Modo proveedor/socio — pills */}
            <div className="flex items-center gap-1 bg-[color:var(--arume-gray-50)] p-1 rounded-full border border-[color:var(--arume-gray-100)]">
              <button onClick={() => setMode('proveedor')}
                className={cn('px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] transition',
                  mode === 'proveedor' ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)]' : 'text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)]')}>Proveedor</button>
              <button onClick={() => setMode('socio')}
                className={cn('px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] transition',
                  mode === 'socio' ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)]' : 'text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)]')}>Socio</button>
            </div>
            {/* Selector unidad */}
            <select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value as any)}
              className="bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)] rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] outline-none text-[color:var(--arume-ink)] focus:border-[color:var(--arume-ink)] cursor-pointer">
              <option value="ALL">Todas las unidades</option>
              <option value="REST">Restaurante</option>
              <option value="DLV">Catering</option>
              <option value="SHOP">Tienda Sake</option>
              <option value="CORP">Corporativo</option>
            </select>
            {/* Año */}
            <div className="flex items-center bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)] rounded-full p-0.5">
              <button className="p-1.5 text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)] hover:bg-white rounded-full transition" onClick={() => setYear(y => y - 1)}><ChevronLeft className="w-3.5 h-3.5"/></button>
              <span className="px-3 text-xs font-semibold tabular-nums">{year}</span>
              <button className="p-1.5 text-[color:var(--arume-gray-500)] hover:text-[color:var(--arume-ink)] hover:bg-white rounded-full transition" onClick={() => setYear(y => y + 1)}><ChevronRight className="w-3.5 h-3.5"/></button>
            </div>
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--arume-gray-400)]" />
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
              placeholder="Buscar factura, proveedor…"
              className="w-full pl-9 pr-4 py-2 rounded-full bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)] text-xs outline-none focus:bg-white focus:border-[color:var(--arume-ink)] transition" />
          </div>
        </div>
      )}

      {/* ── CUERPO PRINCIPAL ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        <AnimatePresence mode="wait">

          {/* ════════ PESTAÑA: AGRUPAR ALBARANES ════════ */}
          {activeTab === 'pend' && (
            <motion.div key="pend" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ type: 'spring', damping: 25 }}>

              {/* Botón principal de auto-agrupación */}
              {pendingGroups.length > 0 && !autoGroupPreview && (
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {pendingGroups.reduce((acc, [, dg]) => acc + Object.keys(dg.groups).length, 0)} grupos detectados
                    {' '}· <span className="text-indigo-500">Fuzzy matching activo</span>
                  </p>
                  <button onClick={handlePrepareAutoGroup} disabled={isProcessing} className="bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] font-black text-[10px] uppercase tracking-widest px-6 py-3 rounded-xl shadow-lg hover:bg-[color:var(--arume-gray-700)] transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50">
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                    Revisar Auto-Agrupación
                  </button>
                </div>
              )}

              {/* ── PANEL DE PREVISUALIZACIÓN Y EDICIÓN ── */}
              <AnimatePresence>
                {autoGroupPreview && (
                  <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="mb-6 bg-white border-2 border-indigo-200 rounded-2xl p-6 shadow-xl overflow-hidden">

                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-black text-indigo-700 flex items-center gap-2"><Sparkles className="w-5 h-5"/> Borradores Listos</h3>
                        <p className="text-xs font-bold text-slate-500 mt-1">
                          Revisa cada borrador. Pulsa <strong>✏️ Editar</strong> para cambiar qué albaranes incluye. Puedes fusionar dos grupos o eliminar los que no quieras agrupar aún.
                        </p>
                      </div>
                      <button onClick={() => { setAutoGroupPreview(null); setEditingDraftIdx(-1); }} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition shrink-0 ml-4">
                        <X className="w-5 h-5"/>
                      </button>
                    </div>

                    <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1 mb-6">
                      {autoGroupPreview.map((draft, idx) => {
                        // Total real calculado desde los albaranes seleccionados (no el campo .total del draft)
                        const draftTotal = (draft.albaranIdsArr || []).reduce((acc, id) => {
                          const alb = albaranesSeguros.find(a => a && a.id === id);
                          return acc + Math.abs(Num.parse(alb?.total || 0));
                        }, 0);
                        const isEditingThis  = editingDraftIdx === idx;
                        const availableAlbs  = getAlbsForDraftMonth(draft);
                        const selectedCount  = (draft.albaranIdsArr || []).length;

                        return (
                          <div key={draft.id} className={cn('flex flex-col gap-0 rounded-2xl border transition-all overflow-hidden', isEditingThis ? 'border-indigo-400 shadow-md' : 'border-slate-200 bg-slate-50')}>

                            {/* Fila principal del borrador */}
                            <div className="flex flex-col md:flex-row items-center gap-3 p-4 bg-white">
                              {/* Info proveedor */}
                              <div className="flex-1 min-w-0">
                                <p className="font-black text-slate-800 text-sm truncate">{draft.prov}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">
                                  {selectedCount} albarán{selectedCount !== 1 ? 'es' : ''} · <span className="text-indigo-500 font-black">{Num.fmt(draftTotal)}</span>
                                </p>
                              </div>

                              {/* Input número factura */}
                              <input
                                type="text"
                                placeholder="Nº Factura Oficial..."
                                value={draft.num}
                                onChange={(e) => {
                                  const newDrafts = [...autoGroupPreview];
                                  newDrafts[idx] = { ...newDrafts[idx], num: e.target.value };
                                  setAutoGroupPreview(newDrafts);
                                }}
                                className={cn('w-full md:w-52 p-3 rounded-xl text-xs font-bold outline-none border transition-colors', draft.num.trim() ? 'bg-white border-emerald-300 focus:border-emerald-400' : 'bg-rose-50 border-rose-200 focus:border-rose-400 placeholder:text-rose-300')}
                              />

                              {/* Total */}
                              <p className="font-black text-indigo-600 text-lg w-24 text-right shrink-0">{Num.fmt(draftTotal)}</p>

                              {/* Botones de acción */}
                              <div className="flex items-center gap-2 shrink-0">
                                {/* ✏️ Editar albaranes */}
                                <button
                                  onClick={() => setEditingDraftIdx(isEditingThis ? -1 : idx)}
                                  title="Editar qué albaranes van en esta factura"
                                  className={cn('p-2.5 rounded-xl border text-xs font-black transition flex items-center gap-1.5', isEditingThis ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] border-indigo-600' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600')}
                                >
                                  <Wand2 className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">{isEditingThis ? 'Cerrar' : 'Editar'}</span>
                                </button>

                                {/* 🔗 Fusionar con otro borrador del mismo mes */}
                                {autoGroupPreview.length > 1 && (
                                  <select
                                    defaultValue=""
                                    onChange={(e) => {
                                      const targetIdx = parseInt(e.target.value);
                                      if (!isNaN(targetIdx)) handleMergeDrafts(idx, targetIdx);
                                      e.target.value = '';
                                    }}
                                    className="p-2.5 rounded-xl border border-slate-200 bg-white text-[9px] font-black text-slate-500 outline-none hover:border-amber-300 cursor-pointer transition"
                                    title="Fusionar con otro borrador"
                                  >
                                    <option value="" disabled>⊕ Fusionar</option>
                                    {autoGroupPreview.map((d, i) => i !== idx ? (
                                      <option key={d.id} value={i}>{d.prov?.substring(0, 20)}</option>
                                    ) : null)}
                                  </select>
                                )}

                                {/* 🗑️ Eliminar borrador */}
                                <button
                                  onClick={() => { setAutoGroupPreview(autoGroupPreview.filter((_, i) => i !== idx)); if (editingDraftIdx === idx) setEditingDraftIdx(-1); }}
                                  title="Descartar esta agrupación"
                                  className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200 transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* ── Panel edición inline de albaranes ── */}
                            {isEditingThis && (
                              <div className="border-t border-indigo-100 bg-indigo-50/40 p-4 space-y-2">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">
                                    Albaranes disponibles en {(draft.date || '').substring(0, 7)} — marca los que van en esta factura
                                  </p>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => {
                                        const validIds = availableAlbs.filter(a => Math.abs(Num.parse(a.total)) > 0).map(a => a.id);
                                        const newDrafts = [...autoGroupPreview];
                                        newDrafts[idx] = { ...newDrafts[idx], albaranIdsArr: validIds };
                                        setAutoGroupPreview(newDrafts);
                                      }}
                                      className="text-[9px] font-black uppercase text-amber-600 bg-white px-2 py-1.5 rounded-lg border border-amber-200 hover:bg-amber-50 transition flex items-center gap-1"
                                    >
                                      <Wand2 className="w-3 h-3"/> Seleccionar válidos
                                    </button>
                                    <button
                                      onClick={() => {
                                        const allIds = availableAlbs.map(a => a.id);
                                        const current = draft.albaranIdsArr || [];
                                        const newDrafts = [...autoGroupPreview];
                                        newDrafts[idx] = { ...newDrafts[idx], albaranIdsArr: current.length === allIds.length ? [] : allIds };
                                        setAutoGroupPreview(newDrafts);
                                      }}
                                      className="text-[9px] font-black uppercase text-indigo-600 bg-white px-2 py-1.5 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition"
                                    >
                                      {(draft.albaranIdsArr || []).length === availableAlbs.length ? 'Desmarcar todos' : 'Marcar todos'}
                                    </button>
                                  </div>
                                </div>

                                {availableAlbs.length === 0 && (
                                  <p className="text-[10px] text-slate-400 text-center py-4">No hay más albaranes disponibles en este mes</p>
                                )}

                                <div className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar">
                                  {availableAlbs.map(a => {
                                    const isSelected = (draft.albaranIdsArr || []).includes(a.id);
                                    return (
                                      <label
                                        key={a.id}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          const newDrafts = [...autoGroupPreview];
                                          const current = newDrafts[idx].albaranIdsArr || [];
                                          newDrafts[idx] = {
                                            ...newDrafts[idx],
                                            albaranIdsArr: isSelected ? current.filter(id => id !== a.id) : [...current, a.id],
                                          };
                                          setAutoGroupPreview(newDrafts);
                                        }}
                                        className={cn('flex justify-between items-center p-3 rounded-xl cursor-pointer border transition-all', isSelected ? 'bg-white border-indigo-400 shadow-sm' : 'bg-white/60 border-transparent hover:bg-white hover:border-slate-200')}
                                      >
                                        <div className="flex items-center gap-3">
                                          <div className={cn('w-5 h-5 rounded flex items-center justify-center border', isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300')}>
                                            {isSelected && <Check className="w-3.5 h-3.5" />}
                                          </div>
                                          <div>
                                            <p className="font-black text-slate-800 text-xs">{String(a.prov || 'S/P')} · {String(a.date || 'S/F')}</p>
                                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">Ref: {String(a.num || 'S/N')}</p>
                                          </div>
                                        </div>
                                        <p className="font-black text-slate-900 text-sm">{Num.fmt(Math.abs(Num.parse(a.total || 0)))}</p>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Botones de acción globales */}
                    <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                      <button onClick={() => { setAutoGroupPreview(null); setEditingDraftIdx(-1); }} className="px-6 py-3 rounded-xl font-black text-xs text-slate-500 hover:bg-slate-100 transition uppercase">
                        Cancelar
                      </button>
                      <button
                        onClick={handleConfirmAutoGroupAll}
                        disabled={isProcessing || autoGroupPreview.every(f => (f.albaranIdsArr || []).length === 0)}
                        className="bg-emerald-600 text-white font-black text-xs uppercase tracking-widest px-8 py-3 rounded-xl shadow-lg hover:bg-emerald-700 transition-all flex items-center gap-2 disabled:opacity-50"
                      >
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Confirmar {autoGroupPreview.filter(f => (f.albaranIdsArr || []).length > 0).length} Facturas
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── TARJETAS DE GRUPOS (sala de espera) ── */}
              {!autoGroupPreview && (
                <>
                  {pendingGroups.length > 0 ? pendingGroups.map(([mk, dataGroup]) => (
                    <div key={mk} className="mb-6 bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2 px-2">
                        <Calendar className="w-4 h-4 text-indigo-500" /> {dataGroup.name}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4">
                        {Object.values(dataGroup.groups || {}).map((g: any) => {
                          const unitConfig = BUSINESS_UNITS.find(u => u.id === g.unitId);
                          return (
                            <div
                              key={g.label + g.unitId}
                              onClick={() => { setSelectedGroup({ label: String(g.label), ids: g.ids, unitId: g.unitId }); setModalForm({ num: '', date: DateUtil.today(), selectedAlbs: [...g.ids], unitId: g.unitId }); }}
                              className="flex flex-col p-5 bg-slate-50 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:bg-white hover:shadow-md transition-all cursor-pointer group"
                            >
                              <div className="flex justify-between items-start mb-4">
                                {unitConfig && <span className={cn('text-[8px] px-2 py-1 rounded-md font-black uppercase tracking-wider', unitConfig.bg, unitConfig.color)}>{unitConfig.name.split(' ')[0]}</span>}
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
                      <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100">
                        <Package className="w-10 h-10 text-slate-300" />
                      </div>
                      <p className="text-slate-800 font-black text-base uppercase tracking-widest">Todo al día</p>
                      <p className="text-sm font-medium text-slate-400 mt-2">No hay albaranes sueltos esperando en la sala.</p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* ════════ PESTAÑA: BÓVEDA ════════ */}
          {activeTab === 'hist' && (
            <motion.div key="hist" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ type: 'spring', damping: 25 }}>
              <InvoicesList
                facturas={facturasBoveda} searchQ={deferredSearch} selectedUnit={selectedUnit}
                mode={mode} filterStatus={filterStatus} year={year} businessUnits={BUSINESS_UNITS}
                sociosReales={SOCIOS_REALES_NAMES} superNorm={basicNorm}
                onOpenDetail={setSelectedInvoice as any} onTogglePago={handleTogglePago}
                onDelete={handleDeleteFactura} albaranesSeguros={albaranesSeguros}
              />
            </motion.div>
          )}

          {/* ════════ PESTAÑA: PROVEEDORES 🆕 ════════ */}
          {activeTab === 'proveedores' && (
            <motion.div key="proveedores" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ type: 'spring', damping: 25 }}>

              {/* ── Zona de subida masiva de facturas PDF ── */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border-2 border-dashed border-blue-300 p-6 mb-6 text-center relative">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  multiple
                  onChange={handleBulkPDFUpload}
                  className="hidden"
                />
                <div className="flex flex-col md:flex-row items-center gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shrink-0">
                      <UploadCloud className="w-6 h-6 text-white" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-black text-blue-900">Subir facturas del correo</h3>
                      <p className="text-[10px] text-blue-500 font-bold mt-0.5">
                        Sube varios PDFs a la vez. La IA los lee, los cruza con tus albaranes y los adjunta automáticamente.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition shadow-lg flex items-center gap-2 active:scale-95 disabled:opacity-50 shrink-0"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    {isUploading ? 'Procesando…' : 'Seleccionar PDFs'}
                  </button>
                </div>

                {/* Resultados de la subida */}
                {uploadResults.length > 0 && (
                  <div className="mt-4 bg-white rounded-2xl border border-blue-100 p-4 text-left">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Resultados</p>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {uploadResults.map((r, i) => (
                        <div key={i} className={cn(
                          'flex items-center gap-2 text-xs px-3 py-2 rounded-xl',
                          r.status === 'ok' ? 'bg-emerald-50 text-emerald-700' :
                          r.status === 'no-match' ? 'bg-amber-50 text-amber-700' :
                          'bg-red-50 text-red-700'
                        )}>
                          <span className="font-black shrink-0">{r.status === 'ok' ? '✅' : r.status === 'no-match' ? '🆕' : '❌'}</span>
                          <span className="font-bold truncate">{r.name}</span>
                          <span className="text-[10px] ml-auto shrink-0">{r.msg}</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setUploadResults([])} className="mt-2 text-[9px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-widest">Cerrar resultados</button>
                  </div>
                )}
              </div>

              {/* Selector de mes + leyenda */}
              <div className="flex items-center gap-3 mb-5 flex-wrap">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mes:</span>
                <select
                  value={provMesFilter}
                  onChange={e => setProvMesFilter(e.target.value)}
                  className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-black text-slate-700 outline-none focus:border-indigo-400 cursor-pointer"
                >
                  <option value="">Todos los meses</option>
                  {mesesDisponibles.map(m => {
                    const [y, mo] = m.split('-');
                    const names = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
                    return <option key={m} value={m}>{names[parseInt(mo)] || mo} {y}</option>;
                  })}
                </select>

                {/* Leyenda de colores */}
                <div className="flex items-center gap-4 ml-auto flex-wrap">
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-amber-400"/><span className="text-[10px] font-bold text-slate-500">Albaranes sueltos</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-400"/><span className="text-[10px] font-bold text-slate-500">Factura pendiente</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-400"/><span className="text-[10px] font-bold text-slate-500">Pagado</span></div>
                </div>
              </div>

              {/* Lista de proveedores */}
              {proveedorEstados.length === 0 ? (
                <div className="py-24 text-center bg-white rounded-[3rem] border border-slate-100 shadow-sm flex flex-col items-center">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100">
                    <Users className="w-10 h-10 text-slate-300" />
                  </div>
                  <p className="text-slate-800 font-black text-base uppercase tracking-widest">Sin datos para este periodo</p>
                  <p className="text-sm font-medium text-slate-400 mt-2">Cambia el filtro de mes o importa albaranes primero.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {proveedorEstados.map(prov => {
                    const isExpanded = expandedProv === prov.nombre;
                    const tieneProblemas = prov.albaranesSueltos.length > 0 || prov.facturasPendientes.length > 0;

                    return (
                      <motion.div
                        key={prov.nombre}
                        layout
                        className={cn(
                          'bg-white rounded-2xl border overflow-hidden',
                          tieneProblemas ? 'border-amber-200 shadow-sm' : 'border-slate-100'
                        )}
                      >
                        {/* Fila resumen — clic para expandir/colapsar */}
                        <button
                          onClick={() => setExpandedProv(isExpanded ? null : prov.nombre)}
                          className="w-full flex items-center gap-4 p-4 text-left hover:bg-slate-50/80 transition-colors"
                        >
                          {/* Avatar inicial del proveedor */}
                          <div className={cn(
                            'w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black shrink-0',
                            tieneProblemas ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                          )}>
                            {prov.nombre.charAt(0).toUpperCase()}
                          </div>

                          {/* Nombre + badges de estado */}
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-slate-800 text-sm truncate">{prov.nombre}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {prov.albaranesSueltos.length > 0 && (
                                <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                  {prov.albaranesSueltos.length} alb. sueltos
                                </span>
                              )}
                              {prov.facturasPendientes.length > 0 && (
                                <span className="text-[9px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                                  {prov.facturasPendientes.length} pendientes de pago
                                </span>
                              )}
                              {prov.facturasPagadas.length > 0 && (
                                <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                  {prov.facturasPagadas.length} pagadas ✓
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Totales en columnas — solo en pantallas medianas+ */}
                          <div className="hidden md:flex items-center gap-6 shrink-0 mr-2">
                            {prov.totalSuelto > 0 && (
                              <div className="text-right">
                                <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Suelto</p>
                                <p className="font-black text-amber-600 text-sm">{Num.fmt(prov.totalSuelto)}</p>
                              </div>
                            )}
                            {prov.totalPendiente > 0 && (
                              <div className="text-right">
                                <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest">Pendiente</p>
                                <p className="font-black text-rose-600 text-sm">{Num.fmt(prov.totalPendiente)}</p>
                              </div>
                            )}
                            {prov.totalPagado > 0 && (
                              <div className="text-right">
                                <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Pagado</p>
                                <p className="font-black text-emerald-600 text-sm">{Num.fmt(prov.totalPagado)}</p>
                              </div>
                            )}
                            <div className="text-right pl-4 border-l border-slate-100">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total</p>
                              <p className="font-black text-slate-800 text-base">{Num.fmt(prov.totalSuelto + prov.totalPendiente + prov.totalPagado)}</p>
                            </div>
                          </div>

                          {/* Chevron */}
                          {isExpanded
                            ? <ChevronUp   className="w-4 h-4 text-slate-400 shrink-0" />
                            : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                          }
                        </button>

                        {/* Panel de detalle expandido */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden border-t border-slate-100"
                            >
                              <div className="p-4 space-y-4 bg-slate-50/40">

                                {/* ── Albaranes sueltos ── */}
                                {prov.albaranesSueltos.length > 0 && (
                                  <div>
                                    <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                      <AlertTriangle className="w-3 h-3" /> Sin agrupar en factura — {Num.fmt(prov.totalSuelto)}
                                    </p>
                                    <div className="space-y-1.5">
                                      {prov.albaranesSueltos.map((a: any) => (
                                        <div key={a.id} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                                          <div>
                                            <p className="font-bold text-slate-700 text-xs">{String(a.date || 'S/F')} · Ref: {String(a.num || 'S/N')}</p>
                                            {a.notes && <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-xs">{a.notes}</p>}
                                          </div>
                                          <p className="font-black text-amber-700 text-sm shrink-0 ml-3">{Num.fmt(Math.abs(Num.parse(a.total) || 0))}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* ── Facturas pendientes de pago ── */}
                                {prov.facturasPendientes.length > 0 && (
                                  <div>
                                    <p className="text-[9px] font-black text-rose-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                      <Clock className="w-3 h-3" /> Pendientes de pago — {Num.fmt(prov.totalPendiente)}
                                    </p>
                                    <div className="space-y-1.5">
                                      {prov.facturasPendientes.map(f => (
                                        <div
                                          key={f.id}
                                          className="flex items-center justify-between bg-rose-50 border border-rose-100 rounded-xl px-3 py-2.5 cursor-pointer hover:border-rose-300 transition-colors"
                                          onClick={() => setSelectedInvoice(f)}
                                        >
                                          <div>
                                            <p className="font-bold text-slate-700 text-xs">{f.date} · {f.num || 'S/N'}</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">{(f.albaranIdsArr || []).length} albaranes vinculados</p>
                                          </div>
                                          <div className="flex items-center gap-2 shrink-0 ml-3">
                                            <p className="font-black text-rose-700 text-sm">{Num.fmt(Math.abs(Num.parse(f.total) || 0))}</p>
                                            <button
                                              onClick={e => { e.stopPropagation(); handleTogglePago(f.id); }}
                                              className="text-[9px] font-black bg-rose-600 text-white px-2.5 py-1 rounded-lg hover:bg-rose-700 transition"
                                            >
                                              ✓ Marcar pagada
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* ── Facturas pagadas ── */}
                                {prov.facturasPagadas.length > 0 && (
                                  <div>
                                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                      <CheckCircle2 className="w-3 h-3" /> Pagadas — {Num.fmt(prov.totalPagado)}
                                    </p>
                                    <div className="space-y-1.5">
                                      {prov.facturasPagadas.map(f => (
                                        <div
                                          key={f.id}
                                          className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5 cursor-pointer hover:border-emerald-300 transition-colors"
                                          onClick={() => setSelectedInvoice(f)}
                                        >
                                          <div>
                                            <p className="font-bold text-slate-700 text-xs">{f.date} · {f.num || 'S/N'}</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">
                                              {f.reconciled ? '✓ Conciliada banco' : 'Pagada manualmente'}
                                            </p>
                                          </div>
                                          <p className="font-black text-emerald-700 text-sm shrink-0 ml-3">{Num.fmt(Math.abs(Num.parse(f.total) || 0))}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* ════════ PESTAÑA: PARA GESTORÍA / BILKY 📤 ════════ */}
          {activeTab === 'gestoria' && (
            <motion.div key="gestoria" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ type: 'spring', damping: 25 }}>

              {/* Resumen + acción masiva */}
              <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl border border-violet-200 p-6 mb-6">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-violet-600 rounded-2xl flex items-center justify-center shadow-lg">
                      <UploadCloud className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-violet-900 tracking-tight">Para Gestoría · Bilky</h3>
                      <p className="text-[10px] font-bold text-violet-500 uppercase tracking-widest mt-1">
                        Facturas, nóminas y SS listas para subir a tu gestoría
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="text-right">
                      <p className="text-[9px] font-black text-violet-400 uppercase tracking-widest">Facturas</p>
                      <p className="text-2xl font-black text-violet-700">{gestoriaData.pendientes.length}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-pink-400 uppercase tracking-widest">Nóminas/SS</p>
                      <p className="text-2xl font-black text-pink-700">{gestoriaData.nominasPendientes.length}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Ya subidas</p>
                      <p className="text-2xl font-black text-emerald-600">{gestoriaData.yaSubidas.length + gestoriaData.nominasSubidas.length}</p>
                    </div>
                    {(gestoriaData.sinPdf.length + gestoriaData.nominasSinPdf.length) > 0 && (
                      <div className="text-right">
                        <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Sin PDF</p>
                        <p className="text-2xl font-black text-amber-600">{gestoriaData.sinPdf.length + gestoriaData.nominasSinPdf.length}</p>
                      </div>
                    )}
                  </div>
                </div>
                {(gestoriaData.pendientes.length + gestoriaData.nominasPendientes.length) > 0 && (
                  <button onClick={handleDownloadAllGestoria} className="mt-4 bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition shadow-lg flex items-center gap-2 active:scale-95">
                    <Download className="w-4 h-4" /> Descargar todos los PDFs pendientes ({gestoriaData.pendientes.length + gestoriaData.nominasPendientes.length})
                  </button>
                )}
              </div>

              {/* Flujo de trabajo */}
              <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6 shadow-sm">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Tu flujo de trabajo</p>
                <div className="flex items-center gap-2 flex-wrap text-[10px] font-bold text-slate-500">
                  <span className="bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg border border-amber-200">1. Albarán escaneado</span>
                  <ArrowDownRight className="w-3 h-3 text-slate-300" />
                  <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200">2. Factura generada</span>
                  <ArrowDownRight className="w-3 h-3 text-slate-300" />
                  <span className="bg-rose-50 text-rose-700 px-3 py-1.5 rounded-lg border border-rose-200">3. Verificada por IA</span>
                  <ArrowDownRight className="w-3 h-3 text-slate-300" />
                  <span className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-200">4. Pagada</span>
                  <ArrowDownRight className="w-3 h-3 text-slate-300" />
                  <span className="bg-violet-100 text-violet-700 px-3 py-1.5 rounded-lg border border-violet-300 font-black">5. Descargar PDF → Subir a Bilky</span>
                </div>
              </div>

              {/* ── Facturas pendientes de subir a gestoría ── */}
              {gestoriaData.pendientes.length > 0 && (
                <div className="mb-6">
                  <p className="text-[10px] font-black text-violet-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <UploadCloud className="w-3.5 h-3.5" /> Pendientes de subir a Bilky — {gestoriaData.pendientes.length} facturas
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {gestoriaData.pendientes.map(f => {
                      const b64 = f.file_base64 || '';
                      const isPdf = b64.startsWith('data:application/pdf') || (!b64.startsWith('data:image') && b64.length > 200);
                      const isImage = b64.startsWith('data:image');
                      const imgSrc = isImage ? b64 : (isPdf ? undefined : undefined);

                      return (
                        <div key={f.id} className="bg-white rounded-2xl border border-violet-100 overflow-hidden hover:border-violet-300 transition-colors shadow-sm flex flex-col">
                          {/* Miniatura del documento — clic para previsualizar */}
                          <button
                            onClick={() => setPreviewFactura(f)}
                            className="w-full h-40 bg-gradient-to-br from-violet-50 to-slate-50 flex items-center justify-center relative group overflow-hidden"
                          >
                            {imgSrc ? (
                              <img src={imgSrc} alt="Factura" className="w-full h-full object-contain" />
                            ) : isPdf ? (
                              <div className="flex flex-col items-center gap-2">
                                <FileText className="w-12 h-12 text-violet-300" />
                                <span className="text-[9px] font-black text-violet-400 uppercase tracking-widest">PDF del proveedor</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-2">
                                <FileText className="w-12 h-12 text-slate-200" />
                                <span className="text-[9px] font-black text-slate-300 uppercase">Documento adjunto</span>
                              </div>
                            )}
                            <div className="absolute inset-0 bg-violet-900/0 group-hover:bg-violet-900/10 transition-colors flex items-center justify-center">
                              <div className="bg-white/90 backdrop-blur rounded-xl px-3 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg flex items-center gap-1.5">
                                <Eye className="w-3.5 h-3.5 text-violet-600" />
                                <span className="text-[9px] font-black text-violet-700 uppercase tracking-widest">Ver documento</span>
                              </div>
                            </div>
                          </button>

                          {/* Info + acciones */}
                          <div className="p-4 flex-1 flex flex-col">
                            <p className="font-black text-slate-800 text-sm truncate">{f.prov || f.cliente || 'Sin proveedor'}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {f.date} · {f.num || 'S/N'} · {f.fecha_pago ? `Pagada: ${f.fecha_pago}` : 'Pagada'}
                            </p>
                            <p className="font-black text-violet-700 text-lg mt-2">{Num.fmt(Math.abs(Num.parse(f.total) || 0))}</p>
                            <div className="flex items-center gap-2 mt-3">
                              <button onClick={() => handleDownloadFile(f)} className="flex-1 bg-violet-50 hover:bg-violet-100 text-violet-600 py-2.5 rounded-xl transition border border-violet-200 font-black text-[9px] uppercase tracking-widest flex items-center justify-center gap-1.5">
                                <Download className="w-3.5 h-3.5" /> Descargar
                              </button>
                              <button onClick={() => handleToggleGestoria(f.id)} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition flex items-center justify-center gap-1.5 shadow-sm">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Subida a Bilky
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════ */}
              {/* ── SECCIÓN: NÓMINAS Y SEGURIDAD SOCIAL ── */}
              {/* ══════════════════════════════════════════════════════════ */}
              {gestoriaData.nominas.length > 0 && (
                <div className="mb-6 mt-2">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-px flex-1 bg-pink-200" />
                    <span className="text-[10px] font-black text-pink-600 uppercase tracking-widest px-3">Nóminas y Seguridad Social</span>
                    <div className="h-px flex-1 bg-pink-200" />
                  </div>

                  {/* Nóminas pendientes de subir */}
                  {gestoriaData.nominasPendientes.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] font-black text-pink-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <UploadCloud className="w-3.5 h-3.5" /> Pendientes de subir — {gestoriaData.nominasPendientes.length} documentos
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {gestoriaData.nominasPendientes.map((g: any) => {
                          const b64 = g.file_base64 || '';
                          const isNomina = String(g.name || '').toLowerCase().includes('nómina') || String(g.name || '').toLowerCase().includes('nomina');

                          return (
                            <div key={g.id} className="bg-white rounded-2xl border border-pink-100 overflow-hidden hover:border-pink-300 transition-colors shadow-sm flex flex-col">
                              <button
                                onClick={() => setPreviewFactura({ id: g.id, file_base64: b64, prov: g.name, num: '', date: g.startDate || '', total: g.amount || 0, tipo: 'compra', paid: true, reconciled: false } as any)}
                                className="w-full h-32 bg-gradient-to-br from-pink-50 to-rose-50 flex items-center justify-center relative group"
                              >
                                <div className="flex flex-col items-center gap-2">
                                  <FileText className="w-10 h-10 text-pink-300" />
                                  <span className="text-[9px] font-black text-pink-400 uppercase tracking-widest">
                                    {isNomina ? 'PDF Nóminas' : 'PDF Seg. Social'}
                                  </span>
                                </div>
                                <div className="absolute inset-0 bg-pink-900/0 group-hover:bg-pink-900/10 transition-colors flex items-center justify-center">
                                  <div className="bg-white/90 backdrop-blur rounded-xl px-3 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg flex items-center gap-1.5">
                                    <Eye className="w-3.5 h-3.5 text-pink-600" />
                                    <span className="text-[9px] font-black text-pink-700 uppercase tracking-widest">Ver documento</span>
                                  </div>
                                </div>
                              </button>
                              <div className="p-4 flex-1 flex flex-col">
                                <p className="font-black text-slate-800 text-sm truncate">{g.name || 'Nómina'}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">{g.startDate || '—'} · {g.notes ? g.notes.substring(0, 60) + '…' : ''}</p>
                                <p className="font-black text-pink-700 text-lg mt-2">{Num.fmt(Math.abs(g.amount || 0))}</p>
                                <div className="flex items-center gap-2 mt-3">
                                  <button onClick={() => handleDownloadNomina(g)} className="flex-1 bg-pink-50 hover:bg-pink-100 text-pink-600 py-2.5 rounded-xl transition border border-pink-200 font-black text-[9px] uppercase tracking-widest flex items-center justify-center gap-1.5">
                                    <Download className="w-3.5 h-3.5" /> Descargar
                                  </button>
                                  <button onClick={() => handleToggleGestoriaNomina(g.id)} className="flex-1 bg-pink-600 hover:bg-pink-500 text-white py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition flex items-center justify-center gap-1.5 shadow-sm">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Subida a Bilky
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Nóminas sin PDF */}
                  {gestoriaData.nominasSinPdf.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Nóminas sin PDF — reimporta desde Gastos Fijos
                      </p>
                      <div className="space-y-2">
                        {gestoriaData.nominasSinPdf.map((g: any) => (
                          <div key={g.id} className="bg-amber-50/50 rounded-2xl border border-amber-100 p-4 flex items-center gap-4">
                            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                              <AlertCircle className="w-5 h-5 text-amber-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-black text-slate-700 text-sm truncate">{g.name || 'Nómina'}</p>
                              <p className="text-[10px] text-amber-500 mt-0.5">
                                {g.startDate || '—'} — Sube el PDF desde "Importar Nóminas" en Gastos Fijos
                              </p>
                            </div>
                            <p className="font-black text-slate-600 text-sm shrink-0">{Num.fmt(Math.abs(g.amount || 0))}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Nóminas ya subidas */}
                  {gestoriaData.nominasSubidas.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5" /> Nóminas ya subidas — {gestoriaData.nominasSubidas.length}
                      </p>
                      <div className="space-y-2">
                        {gestoriaData.nominasSubidas.map((g: any) => (
                          <div key={g.id} className="bg-emerald-50/50 rounded-2xl border border-emerald-100 p-4 flex items-center gap-4">
                            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-black text-slate-700 text-sm truncate">{g.name || 'Nómina'}</p>
                              <p className="text-[10px] text-emerald-500 mt-0.5">Subida: {g.fecha_upload_gestoria || '—'}</p>
                            </div>
                            <p className="font-black text-emerald-700 text-sm shrink-0">{Num.fmt(Math.abs(g.amount || 0))}</p>
                            <button onClick={() => handleToggleGestoriaNomina(g.id)} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 p-2.5 rounded-xl transition border border-emerald-200" title="Desmarcar">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════ */}
              {/* ── SECCIÓN: FACTURAS SIN PDF / YA SUBIDAS ── */}
              {/* ══════════════════════════════════════════════════════════ */}

              {/* ── Facturas sin PDF adjunto ── */}
              {gestoriaData.sinPdf.length > 0 && (
                <div className="mb-6">
                  <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Facturas pagadas sin PDF — no se pueden subir aún
                  </p>
                  <div className="space-y-2">
                    {gestoriaData.sinPdf.map(f => (
                      <div key={f.id} className="bg-amber-50/50 rounded-2xl border border-amber-100 p-4 flex items-center gap-4">
                        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                          <AlertCircle className="w-5 h-5 text-amber-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-slate-700 text-sm truncate">{f.prov || f.cliente || 'Sin proveedor'}</p>
                          <p className="text-[10px] text-amber-500 mt-0.5">
                            {f.date} · {f.num || 'S/N'} — Falta el PDF del correo
                          </p>
                        </div>
                        <p className="font-black text-slate-600 text-sm shrink-0">{Num.fmt(Math.abs(Num.parse(f.total) || 0))}</p>
                        <button onClick={() => setSelectedInvoice(f)} className="bg-amber-100 hover:bg-amber-200 text-amber-700 p-2.5 rounded-xl transition border border-amber-200" title="Ver detalle">
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Todo lo ya subido a gestoría (facturas + nóminas) ── */}
              {gestoriaData.yaSubidas.length > 0 && (
                <div className="mb-6">
                  <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" /> Facturas ya subidas a Bilky — {gestoriaData.yaSubidas.length}
                  </p>
                  <div className="space-y-2">
                    {gestoriaData.yaSubidas.map(f => (
                      <div key={f.id} className="bg-emerald-50/50 rounded-2xl border border-emerald-100 p-4 flex items-center gap-4">
                        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-slate-700 text-sm truncate">{f.prov || f.cliente || 'Sin proveedor'}</p>
                          <p className="text-[10px] text-emerald-500 mt-0.5">
                            {f.date} · {f.num || 'S/N'} · Subida: {(f as any).fecha_upload_gestoria || '—'}
                          </p>
                        </div>
                        <p className="font-black text-emerald-700 text-sm shrink-0">{Num.fmt(Math.abs(Num.parse(f.total) || 0))}</p>
                        <button onClick={() => handleToggleGestoria(f.id)} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 p-2.5 rounded-xl transition border border-emerald-200" title="Desmarcar">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Estado vacío */}
              {gestoriaData.totalPagadas === 0 && gestoriaData.nominas.length === 0 && (
                <div className="py-24 text-center bg-white rounded-[3rem] border border-slate-100 shadow-sm flex flex-col items-center">
                  <div className="w-20 h-20 bg-violet-50 rounded-full flex items-center justify-center mb-4 border border-violet-100">
                    <UploadCloud className="w-10 h-10 text-violet-300" />
                  </div>
                  <p className="text-slate-800 font-black text-base uppercase tracking-widest">Sin documentos para gestoría</p>
                  <p className="text-sm font-medium text-slate-400 mt-2">Cuando marques facturas como pagadas o importes nóminas, aparecerán aquí listas para subir a Bilky.</p>
                </div>
              )}

            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── AUDITORÍA DOCUMENTAL + AGENTE IA ─────────────────────────────── */}
      <div className="mt-8 bg-slate-900 rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden flex flex-col lg:flex-row gap-8">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-500" />

        {/* Panel 1: Auditoría de correos */}
        <div className="flex-1 space-y-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center border border-slate-700">
                <MailCheck className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white tracking-tight">Auditoría Documental</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Cruza PDFs del correo con facturas de tu bóveda automáticamente.</p>
              </div>
            </div>
            <button onClick={fetchPendingAudits} disabled={isSyncing} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition shadow-lg flex items-center gap-2 disabled:opacity-50 whitespace-nowrap">
              {isSyncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Search className="w-4 h-4" />} Escanear Buzón
            </button>
          </div>

          {emailAuditInbox.length === 0 && (
            <div className="border border-slate-700 rounded-2xl p-5 text-center">
              <MailCheck className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Pulsa "Escanear Buzón" para detectar PDFs de facturas en tu correo y cruzarlos automáticamente con la bóveda.</p>
            </div>
          )}

          {emailAuditInbox.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800 pt-6">
              {emailAuditInbox.map(mail => (
                <div key={mail.id} className="bg-slate-800 border border-slate-700 p-4 rounded-2xl flex flex-col justify-between">
                  <div>
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2">{mail.date}</p>
                    <p className="text-sm font-black text-white truncate">{mail.from}</p>
                    <p className="text-[10px] text-slate-400 font-bold truncate mt-1">{mail.subject}</p>
                    {mail.fileName && (
                      <p className="text-[10px] text-indigo-300 font-semibold truncate mt-1" title={mail.fileName}>📎 {mail.fileName}</p>
                    )}
                  </div>
                  <button onClick={() => processEmailAudit(mail)} disabled={isProcessing} className="w-full mt-4 bg-slate-700 hover:bg-blue-600 text-white py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition flex items-center justify-center gap-2">
                    <ShieldCheck className="w-4 h-4" /> Comprobar Cuadre
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Panel 2: Agente IA — Sync Gmail Directo */}
        <div className="lg:w-1/3 w-full border-t lg:border-t-0 lg:border-l border-slate-800 pt-6 lg:pt-0 lg:pl-8 flex flex-col justify-center">
          <div className="bg-indigo-900/30 border border-indigo-500/30 p-6 rounded-3xl text-center flex flex-col items-center">
            <div className="w-14 h-14 bg-indigo-600 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(79,70,229,0.4)] mb-4">
              <Bot className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-base font-black text-indigo-100 mb-2">Agente IA · Gmail</h3>
            <p className="text-[10px] text-indigo-300/80 uppercase font-bold tracking-widest mb-6 leading-relaxed">
              {GmailDirectSync.isAuthenticated()
                ? 'Conectado. Pulsa para sincronizar PDFs de facturas desde Gmail.'
                : 'Pulsa para conectar tu cuenta de Gmail y sincronizar facturas automáticamente.'}
            </p>
            <button onClick={handleTriggerSync} disabled={isProcessing} className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-black text-[10px] uppercase tracking-widest px-6 py-3.5 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 active:scale-95 disabled:opacity-50">
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Bot className="w-4 h-4" />}
              {GmailDirectSync.isAuthenticated() ? '🤖 Sincronizar Gmail' : '🔗 Conectar Gmail'}
            </button>
          </div>
        </div>
      </div>

      {/* ── MODAL RECONCILIADOR EMAILS ─────────────────────────────────── */}
      <ReconciliadorEmails
        isOpen={isReconcilerOpen}
        onClose={() => setIsReconcilerOpen(false)}
        data={data}
        onSave={onSave}
      />

      {/* ── MODAL ARREGLAR AÑOS MASIVO ─────────────────────────────────── */}
      <FixYearsModal
        isOpen={isFixYearsOpen}
        onClose={() => setIsFixYearsOpen(false)}
        data={data}
        onSave={onSave}
      />

      {/* ── MODAL EXPORTAR EXCEL ─────────────────────────────────────────── */}
      <AnimatePresence>
        {isExportModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[500] flex justify-center items-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsExportModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} onClick={e => e.stopPropagation()} className="bg-white w-full max-w-md rounded-2xl p-8 shadow-2xl border border-slate-200">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black text-slate-800">Exportar a Excel</h3>
                <button onClick={() => setIsExportModalOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-700 transition"><X className="w-5 h-5"/></button>
              </div>
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Año Fiscal</label>
                  <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-sm outline-none focus:border-indigo-500 transition" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Trimestre</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map(q => (
                      <button key={q} onClick={() => setExportQuarter(q)} className={cn('py-3 rounded-xl text-xs font-black transition-all border', exportQuarter === q ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>Q{q}</button>
                    ))}
                  </div>
                </div>
                <button onClick={handleExportGestoria} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-emerald-500 transition-all flex justify-center items-center gap-2">
                  <Download className="w-5 h-5" /> Descargar Archivo Excel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MODAL AGRUPACIÓN MANUAL (clic en tarjeta) ─────────────────────── */}
      <AnimatePresence>
        {selectedGroup && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[500] flex justify-center items-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedGroup(null)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} onClick={e => e.stopPropagation()} className="bg-white w-full max-w-2xl rounded-2xl p-6 md:p-8 shadow-2xl relative flex flex-col max-h-[85vh]">
              <button onClick={() => setSelectedGroup(null)} className="absolute top-6 right-6 p-2 bg-slate-100 rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"><X className="w-5 h-5"/></button>

              <div className="border-b border-slate-100 pb-4 mb-4 pr-10">
                <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Layers className="w-4 h-4"/> Agrupación Manual</p>
                <h3 className="text-2xl font-black text-slate-800 truncate">{selectedGroup.label}</h3>
              </div>

              <div className="flex justify-between items-center mb-3 px-1">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{modalForm.selectedAlbs.length} seleccionados</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => { const validIds = albaranesSeguros.filter(a => selectedGroup.ids.includes(a.id) && Math.abs(Num.parse(a.total)) > 0).map(a => a.id); setModalForm(p => ({ ...p, selectedAlbs: validIds })); }} className="text-[10px] font-black uppercase text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition flex items-center gap-1 border border-amber-200">
                    <Wand2 className="w-3 h-3"/> Selección Mágica
                  </button>
                  <button onClick={() => { const allIds = selectedGroup.ids; setModalForm(p => ({ ...p, selectedAlbs: p.selectedAlbs.length === allIds.length ? [] : allIds })); }} className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition border border-indigo-100">
                    {modalForm.selectedAlbs.length === selectedGroup.ids.length ? 'Desmarcar Todos' : 'Marcar Todos'}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50 rounded-2xl p-3 border border-slate-200 space-y-2">
                {albaranesSeguros.filter(a => a && selectedGroup.ids.includes(a.id)).map(a => (
                  <label key={a.id} onClick={e => { e.preventDefault(); handleToggleAlbaran(a.id); }} className={cn('flex justify-between items-center p-3 rounded-xl cursor-pointer border transition-all', modalForm.selectedAlbs.includes(a.id) ? 'bg-white border-indigo-400 shadow-sm' : 'border-transparent hover:bg-white hover:border-slate-300')}>
                    <div className="flex items-center gap-3">
                      <div className={cn('w-5 h-5 rounded flex items-center justify-center border', modalForm.selectedAlbs.includes(a.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300')}>
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
                  <span className="text-2xl font-black text-emerald-400 tracking-tighter">
                    {Num.fmt(modalForm.selectedAlbs.reduce((acc, id) => { const alb = albaranesSeguros.find(a => a && a.id === id); return acc + Math.abs(Num.parse(alb?.total || 0)); }, 0))}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {mode === 'socio' ? (
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Responsable</label>
                      <select value={modalForm.num.startsWith('LIQ-') ? modalForm.num.split('-').slice(1).join('-').replace(/-\d{8}$/, '') : ''} onChange={e => { const socio = e.target.value; setModalForm({ ...modalForm, num: `LIQ-${socio}-${modalForm.date.replace(/-/g, '')}` }); setSelectedGroup(prev => prev ? { ...prev, label: socio } : null); }} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 transition cursor-pointer">
                        <option value="">Selecciona</option>
                        {SOCIOS_REALES_NAMES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Nº Oficial Factura</label>
                      <input type="text" value={modalForm.num} onChange={e => setModalForm({ ...modalForm, num: e.target.value })} placeholder="F-2026/012" className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 transition" />
                    </div>
                  )}
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 ml-1">Fecha Emisión</label>
                    <input type="date" value={modalForm.date} onChange={e => setModalForm({ ...modalForm, date: e.target.value })} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 transition" />
                  </div>
                </div>
                {modalForm.selectedAlbs.length > 0 && !modalForm.num.trim() && (
                  <p className="text-[10px] font-bold text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-200 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> Escribe un número de factura para guardar.
                  </p>
                )}
                <button onClick={handleConfirmManualInvoice} disabled={modalForm.selectedAlbs.length === 0 || isProcessing || !modalForm.num.trim()} className="w-full bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-[color:var(--arume-gray-700)] disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 shadow-lg active:scale-95 transition-all">
                  {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5"/>} Emitir Factura Final
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MODAL PREVISUALIZACIÓN PDF/IMAGEN PARA GESTORÍA ────────────── */}
      <AnimatePresence>
        {previewFactura && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[600] flex justify-center items-center p-4 bg-slate-900/80 backdrop-blur-md"
            onClick={() => setPreviewFactura(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <div>
                  <p className="text-[10px] font-black text-violet-500 uppercase tracking-widest mb-1">Documento original — para subir a Bilky</p>
                  <h3 className="text-lg font-black text-slate-800">{previewFactura.prov || previewFactura.cliente || 'Sin proveedor'}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{previewFactura.date} · {previewFactura.num || 'S/N'} · <span className="font-black text-violet-600">{Num.fmt(Math.abs(Num.parse(previewFactura.total) || 0))}</span></p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { handleDownloadFile(previewFactura); }} className="bg-violet-50 hover:bg-violet-100 text-violet-600 px-4 py-2.5 rounded-xl transition border border-violet-200 font-black text-[9px] uppercase tracking-widest flex items-center gap-1.5">
                    <Download className="w-4 h-4" /> Descargar
                  </button>
                  <button onClick={() => { handleToggleGestoria(previewFactura.id); setPreviewFactura(null); }} className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition flex items-center gap-1.5 shadow-sm">
                    <CheckCircle2 className="w-4 h-4" /> Marcar subida
                  </button>
                  <button onClick={() => setPreviewFactura(null)} className="p-2.5 bg-slate-100 rounded-full text-slate-400 hover:text-slate-700 transition">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Contenido: PDF embebido o imagen */}
              <div className="flex-1 overflow-auto bg-slate-50 p-4 min-h-[400px]">
                {(() => {
                  const b64 = previewFactura.file_base64 || '';
                  const isImage = b64.startsWith('data:image');
                  const isPdf = b64.startsWith('data:application/pdf');
                  const rawB64 = b64.includes(',') ? b64 : `data:application/pdf;base64,${b64}`;

                  if (isImage) {
                    return (
                      <div className="flex justify-center">
                        <img src={b64} alt="Factura" className="max-w-full max-h-[70vh] rounded-2xl shadow-lg border border-slate-200" />
                      </div>
                    );
                  }
                  if (isPdf || b64.length > 200) {
                    return (
                      <iframe
                        src={rawB64}
                        className="w-full h-[70vh] rounded-2xl border border-slate-200 shadow-lg bg-white"
                        title="Previsualización factura"
                      />
                    );
                  }
                  return (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <FileText className="w-16 h-16 text-slate-200 mb-4" />
                      <p className="text-sm font-black text-slate-400">No se puede previsualizar este documento</p>
                      <p className="text-[10px] text-slate-300 mt-1">Descárgalo para verlo en tu ordenador</p>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MODAL DETALLE FACTURA ─────────────────────────────────────────── */}
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
