import React, { useState, useMemo, useDeferredValue, useEffect, useCallback, useRef } from 'react';
import { scanDocument, getActiveVisionProvider } from '../services/aiProviders';
import {
  Building2, Search, Trash2, Upload, Zap,
  CheckCircle2, ArrowRight, TrendingUp, TrendingDown,
  RefreshCw, Eraser, Filter, BarChart3,
  X as CloseIcon, Loader2, Landmark, ShieldCheck, List, Sparkles, Undo2,
  Tag, Edit3, Save, X, ChevronDown, ChevronUp, Calendar,
  FileDown, Info, AlertTriangle, Zap as ZapIcon, FileText, BookOpen,
  Clipboard, Clock, ArrowLeftRight, ThumbsUp, ThumbsDown, SkipForward, Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';

import { findMatches, executeLink, undoLink, fingerprint, isSuspicious, normalizeDesc, daysBetween } from './bancoLogic';
import { CashProjection } from './CashProjection';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

// ─── Constantes etiquetas predefinidas ──────────────────────────────────────
const ETIQUETAS_RAPIDAS = [
  { label: 'Nómina',      color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { label: 'Alquiler',    color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { label: 'Proveedor',   color: 'bg-amber-100 text-amber-700 border-amber-200'   },
  { label: 'Seguridad Soc.', color: 'bg-rose-100 text-rose-700 border-rose-200'   },
  { label: 'Gestoría',    color: 'bg-teal-100 text-teal-700 border-teal-200'      },
  { label: 'Suministros', color: 'bg-cyan-100 text-cyan-700 border-cyan-200'      },
  { label: 'TPV Cobro',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { label: 'Otro',        color: 'bg-slate-100 text-slate-600 border-slate-200'   },
];

// ─── Parser CSV Banca March ─────────────────────────────────────────────────
const parseBancaMarchCSV = (text: string): { date: string; desc: string; amount: number }[] => {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const dateCol   = headers.findIndex(h => h.includes('fecha') || h.includes('date'));
  const descCol   = headers.findIndex(h => h.includes('concepto') || h.includes('descripci') || h.includes('detail') || h.includes('movimiento'));
  const amountCol = headers.findIndex(h => h.includes('importe') || h.includes('amount') || h.includes('cargo') || h.includes('abono'));
  const debitCol  = headers.findIndex(h => h.includes('cargo') || h.includes('débito') || h.includes('debito'));
  const creditCol = headers.findIndex(h => h.includes('abono') || h.includes('crédito') || h.includes('credito') || h.includes('haber'));
  const movs: { date: string; desc: string; amount: number }[] = [];
  lines.slice(1).forEach(line => {
    if (!line.trim()) return;
    const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    let rawDate = dateCol >= 0 ? cols[dateCol] || '' : '';
    let dateISO = '';
    if (rawDate.includes('/')) {
      const p = rawDate.split('/');
      if (p.length === 3) { const y = p[2].length === 4 ? p[2] : `20${p[2]}`; dateISO = `${y}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
    } else if (rawDate.includes('-') && rawDate.length === 10) { dateISO = rawDate; }
    if (!dateISO) return;
    const desc = descCol >= 0 ? cols[descCol] || 'Sin concepto' : 'Sin concepto';
    let amount = 0;
    const parseNum = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    if (debitCol >= 0 && creditCol >= 0) { const d = parseNum(cols[debitCol]||'0'), c = parseNum(cols[creditCol]||'0'); amount = c > 0 ? c : -d; }
    else if (amountCol >= 0) { amount = parseNum(cols[amountCol] || '0'); }
    if (amount === 0) return;
    movs.push({ date: dateISO, desc, amount });
  });
  return movs;
};

// ─── Parser OFX ─────────────────────────────────────────────────────────────
const parseOFX = (text: string): { date: string; desc: string; amount: number }[] => {
  const movs: { date: string; desc: string; amount: number }[] = [];
  const blocks: string[] = text.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) || [];
  blocks.forEach((block: string) => {
    const dateRaw = (block.match(/<DTPOSTED>(.*?)(?:<|\n)/i)?.[1] || '').trim();
    const memo    = (block.match(/<MEMO>(.*?)(?:<|\n)/i)?.[1] || block.match(/<NAME>(.*?)(?:<|\n)/i)?.[1] || '').trim();
    const amtRaw  = (block.match(/<TRNAMT>(.*?)(?:<|\n)/i)?.[1] || '0').trim();
    if (!dateRaw) return;
    const y = dateRaw.slice(0,4), mo = dateRaw.slice(4,6), d = dateRaw.slice(6,8);
    movs.push({ date: `${y}-${mo}-${d}`, desc: memo || 'Sin concepto', amount: parseFloat(amtRaw.replace(',','.')) || 0 });
  });
  return movs;
};

// ─── 🆕 Parser Clipboard (copiar/pegar de web bancaria) ────────────────────
const parseClipboardText = (text: string): { date: string; desc: string; amount: number }[] => {
  const movs: { date: string; desc: string; amount: number }[] = [];
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());

  for (const line of lines) {
    // Intentar detectar: fecha + texto + importe en cada línea
    // Formatos típicos de banca online española al copiar una tabla
    // "15/03/2026  TRANSFERENCIA SEPA GARCIA  -1.250,00"
    // "15/03/2026	TRANSFERENCIA SEPA GARCIA	-1.250,00	12.500,00"
    const parts = line.split(/\t/).map(p => p.trim());
    if (parts.length >= 2) {
      // Tab-separated (tabla HTML copiada)
      const datePart = parts.find(p => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(p));
      const amountParts = parts.filter(p => /^-?[\d.,]+$/.test(p.replace(/\s/g, '')));
      const descParts = parts.filter(p => p !== datePart && !amountParts.includes(p) && p.length > 2);

      if (datePart && (amountParts.length > 0 || descParts.length > 0)) {
        const dateISO = parseSpanishDate(datePart);
        const desc = descParts.join(' ').trim() || 'Sin concepto';
        const amountStr = amountParts[0] || '0';
        const amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.')) || 0;
        if (dateISO && amount !== 0) movs.push({ date: dateISO, desc, amount });
        continue;
      }
    }

    // Fallback: separado por espacios con regex
    const match = line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+?)\s+(-?[\d.,]+)\s*€?\s*$/);
    if (match) {
      const dateISO = parseSpanishDate(match[1]);
      const desc = match[2].trim();
      const amount = parseFloat(match[3].replace(/\./g, '').replace(',', '.')) || 0;
      if (dateISO && amount !== 0) movs.push({ date: dateISO, desc, amount });
    }
  }

  return movs;
};

function parseSpanishDate(raw: string): string {
  const clean = raw.trim();
  if (clean.includes('/')) {
    const p = clean.split('/');
    if (p.length === 3) {
      const y = p[2].length === 4 ? p[2] : `20${p[2]}`;
      return `${y}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    }
  }
  if (clean.includes('-') && clean.length === 10) return clean;
  return '';
}

// ─── EnergyBeam visual ──────────────────────────────────────────────────────
const EnergyBeam = ({ sourceId, targetId, isActive }: { sourceId: string; targetId: string; isActive: boolean }) => {
  const [coords, setCoords] = useState<{ x1:number; y1:number; x2:number; y2:number } | null>(null);
  useEffect(() => {
    const update = () => {
      const el1 = document.getElementById(sourceId);
      const el2 = document.getElementById(targetId);
      if (el1 && el2) {
        const r1 = el1.getBoundingClientRect(); const r2 = el2.getBoundingClientRect();
        setCoords({ x1: r1.left+r1.width/2, y1: r1.bottom, x2: r2.left+r2.width/2, y2: r2.top });
      }
    };
    const t = setTimeout(update, 200);
    window.addEventListener('resize', update);
    return () => { clearTimeout(t); window.removeEventListener('resize', update); };
  }, [sourceId, targetId, isActive]);
  if (!coords) return null;
  return (
    <svg className="absolute inset-0 pointer-events-none z-0 w-full h-full" style={{ overflow:'visible' }}>
      <motion.path
        initial={{ pathLength:0, opacity:0 }}
        animate={{ pathLength:1, opacity: isActive ? 1 : 0.3 }}
        d={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1+50}, ${coords.x2} ${coords.y2-50}, ${coords.x2} ${coords.y2}`}
        stroke={isActive ? '#10b981' : '#818cf8'} strokeWidth={isActive ? 4 : 2}
        fill="none" strokeDasharray={isActive ? 'none' : '4 4'}
        style={{ filter: isActive ? 'drop-shadow(0 0 8px #34d399)' : 'none' }}
      />
      {isActive && (
        <circle r="6" fill="#34d399" style={{ filter:'drop-shadow(0 0 10px #10b981)' }}>
          <animateMotion dur="0.8s" repeatCount="1"
            path={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1+50}, ${coords.x2} ${coords.y2-50}, ${coords.x2} ${coords.y2}`}/>
        </circle>
      )}
    </svg>
  );
};

// ─── Props ──────────────────────────────────────────────────────────────────
interface BancoViewProps {
  data  : AppData;
  onSave: (newData: AppData) => Promise<void>;
}

// ════════════════════════════════════════════════════════════════════════════
export const BancoView = ({ data, onSave }: BancoViewProps) => {

  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [searchTerm,     setSearchTerm]      = useState('');
  const deferredSearch = useDeferredValue(searchTerm);

  const [isMagicLoading,    setIsMagicLoading]    = useState(false);
  const [isAutoLoading,     setIsAutoLoading]      = useState(false);
  const [isApiSyncing,      setIsApiSyncing]       = useState(false);
  const [psd2Status,        setPsd2Status]         = useState<'idle'|'ok'|'error'|'no-config'>('idle');
  const [isSwipeMode,       setIsSwipeMode]        = useState(false);
  const [hoveredMatch,      setHoveredMatch]       = useState<string | null>(null);
  const [showImportGuide,   setShowImportGuide]    = useState(false);
  const [importMsg,         setImportMsg]          = useState('');
  const [importPreview,     setImportPreview]      = useState<{date:string;desc:string;amount:number}[]|null>(null);
  const importAllMovsRef = useRef<{date:string;desc:string;amount:number}[]>([]);
  const [isIAParsing,       setIsIAParsing]        = useState(false);
  const [iaProvider,        setIaProvider]         = useState<string>('');
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // 🖊 Edición de movimientos
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editDesc,    setEditDesc]    = useState('');
  const [editLabel,   setEditLabel]   = useState('');

  //  Filtro por mes
  const [filterMonth, setFilterMonth] = useState('');

  type BankFilter = 'all' | 'pending' | 'unmatched' | 'suspicious' | 'duplicate' | 'reviewed' | 'previstos';
  const [viewFilter, setViewFilter] = useState<BankFilter>('pending');
  const [activeTab,  setActiveTab]  = useState<'list' | 'insights'>('list');

  // 🆕 Clipboard paste
  const [showClipboard, setShowClipboard] = useState(false);
  const [clipboardText, setClipboardText] = useState('');

  // 🆕 Swipe mode state
  const [swipeIndex, setSwipeIndex]   = useState(0);
  const [swipeStats, setSwipeStats]   = useState({ linked: 0, skipped: 0 });

  const psd2Url = data.config?.n8nUrlBanco || '';

  // ─── Stats saldo ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const movements = data.banco || [];
    const sumaMovs = movements.filter((b: any) => b.status === 'matched')
      .reduce((acc: number, b: any) => acc + (Num.parse(b.amount) || 0), 0);
    const saldo    = (Num.parse(data.config?.saldoInicial) || 0) + sumaMovs;
    const saldoReal = (Num.parse(data.config?.saldoInicial) || 0) +
      movements.reduce((acc: number, b: any) => acc + (Num.parse(b.amount) || 0), 0);
    const pending  = movements.filter((b: any) => b.status === 'pending');
    const currentYear = String(new Date().getFullYear());
    const movYear     = movements.filter((b: any) => String(b.date || '').startsWith(currentYear));
    const matchedYear = movYear.filter((b: any) => b.status === 'matched').length;
    const percent  = movYear.length > 0 ? Math.round((matchedYear / movYear.length) * 100) : 0;
    return { saldo, saldoReal, percent, pending: pending.length, total: movYear.length, matched: matchedYear };
  }, [data.banco, data.config?.saldoInicial]);

  // ─── 🆕 Movimientos Previstos (gastos fijos esperados que aún no aparecen) ─
  const movimientosPrevistos = useMemo(() => {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();
    const gastos = (data.gastos_fijos || []).filter((g: any) => g.active !== false && g.freq);
    const banco = data.banco || [];

    const previstos: { id: string; desc: string; amount: number; diaPago: number; date: string; status: 'esperado' | 'atrasado'; gastoFijoId: string }[] = [];

    for (const g of gastos) {
      const nombre = (g as any).name || (g as any).concepto || 'Sin concepto';
      const importe = Num.parse((g as any).amount || (g as any).importe || 0);
      const diaPago = (g as any).dia_pago || 1;
      const isIncome = (g as any).type === 'income' || (g as any).type === 'grant';

      // Solo frecuencias que toca este mes
      const freq = (g as any).freq || 'mensual';
      const tocaEsteMes = freq === 'mensual' || freq === 'semanal' ||
        (freq === 'bimensual' && mesActual % 2 === 0) ||
        (freq === 'trimestral' && [0,3,6,9].includes(mesActual)) ||
        (freq === 'semestral' && [0,6].includes(mesActual)) ||
        (freq === 'anual' && mesActual === 0);

      if (!tocaEsteMes) continue;

      // Verificar si ya existe un movimiento bancario que lo cubra
      const fechaPrevista = `${anioActual}-${String(mesActual+1).padStart(2,'0')}-${String(diaPago).padStart(2,'0')}`;
      const absImporte = Math.abs(importe);

      const yaEnBanco = banco.some((b: any) => {
        const bDate = b.date || '';
        const bMonth = bDate.slice(0,7);
        const esperadoMonth = fechaPrevista.slice(0,7);
        if (bMonth !== esperadoMonth) return false;
        const diff = Math.abs(Math.abs(Num.parse(b.amount)) - absImporte);
        return diff < Math.max(absImporte * 0.1, 5); // 10% tolerancia o 5€
      });

      // Verificar si ya pagado en control_pagos
      const mesKey = `pagos_${anioActual}_${mesActual+1}`;
      const pagados = (data.control_pagos || {} as any)[mesKey] || [];
      const yaPagado = pagados.includes(g.id);

      if (!yaEnBanco && !yaPagado) {
        const atrasado = diaPago < hoy.getDate();
        previstos.push({
          id: `prev-${g.id}`,
          desc: nombre,
          amount: isIncome ? absImporte : -absImporte,
          diaPago,
          date: fechaPrevista,
          status: atrasado ? 'atrasado' : 'esperado',
          gastoFijoId: g.id,
        });
      }
    }

    return previstos.sort((a, b) => a.diaPago - b.diaPago);
  }, [data.gastos_fijos, data.banco, data.control_pagos]);

  // ─── Cashflow histórico 30 días ──────────────────────────────────────────
  const cashFlowData = useMemo(() => {
    const days = 30; const result = []; const now = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(); d.setDate(now.getDate() - i);
      const dateStr = d.toLocaleDateString('sv-SE');
      const dayMovs = (data.banco || []).filter((m: any) => m.date === dateStr && m.status === 'matched');
      const income  = dayMovs.filter((m: any) => Num.parse(m.amount) > 0).reduce((s: number, m: any) => s + Num.parse(m.amount), 0);
      const expense = Math.abs(dayMovs.filter((m: any) => Num.parse(m.amount) < 0).reduce((s: number, m: any) => s + Num.parse(m.amount), 0));
      result.push({ name: d.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}), ingresos: income, gastos: expense });
    }
    return result;
  }, [data.banco]);

  // ─── Cajas TPV pendientes ────────────────────────────────────────────────
  const pendingCajas = useMemo(() => {
    return (data.cierres || []).filter((c: any) => {
      const isCardMatched = (data.banco || []).some((b: any) =>
        b.status === 'matched' && b.link?.type === 'FACTURA' &&
        data.facturas?.find((f: any) => f.id === b.link?.id)?.num === `Z-${c.date.replace(/-/g,'')}`
      );
      return !isCardMatched && Num.parse(c.tarjeta) > 0;
    }).slice(0, 5);
  }, [data.cierres, data.banco, data.facturas]);

  // ─── Previsión 7 días ────────────────────────────────────────────────────
  const prevPagos = useMemo(() => {
    const now = new Date(); const target = new Date(now); target.setDate(now.getDate() + 7);
    return (data.gastos_fijos || [])
      .filter((g: any) => g.active !== false && g.freq && g.dia_pago)
      .map((g: any) => {
        const due = new Date(now.getFullYear(), now.getMonth(), Number(g.dia_pago) || 1);
        if (due < now) due.setMonth(due.getMonth() + 1);
        return { amount: Num.parse(g.amount), within: due <= target };
      })
      .filter((x: any) => x.within)
      .reduce((acc: number, x: any) => acc + x.amount, 0);
  }, [data.gastos_fijos]);

  // ─── 🖊 Contadores por filtro ─────────────────────────────────────────────
  const filterCounts = useMemo(() => {
    const all = data.banco || [];
    return {
      all:        all.length,
      pending:    all.filter((b: any) => b.status === 'pending').length,
      unmatched:  all.filter((b: any) => b.flags?.unmatched).length,
      suspicious: all.filter((b: any) => b.flags?.suspicious).length,
      duplicate:  all.filter((b: any) => b.flags?.duplicate).length,
      reviewed:   all.filter((b: any) => b.reviewed === true).length,
      previstos:  movimientosPrevistos.length,
    };
  }, [data.banco, movimientosPrevistos]);

  // ─── 🖊 Meses disponibles para filtro ─────────────────────────────────────
  const mesesDisponibles = useMemo(() => {
    const set = new Set<string>();
    (data.banco || []).forEach((b: any) => { if (b.date) set.add(b.date.slice(0, 7)); });
    return Array.from(set).sort().reverse();
  }, [data.banco]);

  // ─── Movimientos filtrados ────────────────────────────────────────────────
  const filteredMovements = useMemo(() => {
    // Previstos: retornar directamente
    if (viewFilter === 'previstos') return [];

    let base = (data.banco || []).filter((b: any) =>
      (b.desc || '').toLowerCase().includes(deferredSearch.toLowerCase()) ||
      String(b.amount || '').includes(deferredSearch) ||
      (b.label || '').toLowerCase().includes(deferredSearch.toLowerCase())
    );
    if (filterMonth) base = base.filter((b: any) => (b.date || '').startsWith(filterMonth));
    base = base.filter((b: any) => {
      if (viewFilter === 'all')        return true;
      if (viewFilter === 'pending')    return b.status === 'pending';
      if (viewFilter === 'unmatched')  return b.flags?.unmatched === true;
      if (viewFilter === 'suspicious') return b.flags?.suspicious === true;
      if (viewFilter === 'duplicate')  return b.flags?.duplicate === true;
      if (viewFilter === 'reviewed')   return b.reviewed === true;
      return true;
    });
    return base.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.banco, deferredSearch, viewFilter, filterMonth]);

  const selectedItem = useMemo(() => data.banco?.find((b: any) => b.id === selectedBankId), [data.banco, selectedBankId]);
  const matches = useMemo(() => {
    if (!selectedItem) return [];
    return findMatches(selectedItem, data).slice(0, 3);
  }, [selectedItem, data]);

  // ─── 🆕 Swipe: movimientos pendientes para swipe ─────────────────────────
  const swipePendientes = useMemo(() => {
    return (data.banco || []).filter((b: any) => b.status === 'pending')
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.banco]);

  const swipeCurrent = swipePendientes[swipeIndex] || null;
  const swipeMatches = useMemo(() => {
    if (!swipeCurrent) return [];
    return findMatches(swipeCurrent, data).slice(0, 3);
  }, [swipeCurrent, data]);

  // ─── SYNC PSD2 con estado claro ──────────────────────────────────────────
  const handleApiSync = async () => {
    if (!psd2Url) { setPsd2Status('no-config'); return; }
    setIsApiSyncing(true); setPsd2Status('idle');
    try {
      const result = await proxyFetch(psd2Url, { method:'POST', body:{ action:'sync_banca_march' } });
      if (result?.movements) {
        const newData = JSON.parse(JSON.stringify(data));
        if (!newData.banco) newData.banco = [];
        let added = 0;
        result.movements.forEach((m: any) => {
          const fp = fingerprint(m.date, Num.parse(m.amount), m.desc);
          if (!newData.banco.some((b: any) => b.hash === fp)) {
            newData.banco.push({ id:'march-'+Date.now()+Math.random().toString(36).slice(2,7), date:m.date, amount:Num.parse(m.amount), desc:m.desc, status:'pending', hash:fp });
            added++;
          }
        });
        await onSave(newData);
        setPsd2Status('ok');
        toast.success(`✅ PSD2: ${added} movimientos nuevos importados.`);
      } else { setPsd2Status('ok'); toast.success('✅ PSD2: El banco ya está al día.'); }
    } catch { setPsd2Status('error'); toast.error('❌ Error conectando con PSD2.'); }
    finally { setIsApiSyncing(false); }
  };

  // ─── 📋 Importador CSV/OFX Banca March ───────────────────────────────────
  const handleFileImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        let movs: { date: string; desc: string; amount: number }[] = [];
        const name = file.name.toLowerCase();
        if (name.endsWith('.ofx') || name.endsWith('.qfx') || text.includes('<STMTTRN>')) {
          movs = parseOFX(text);
        } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
          const wb = XLSX.read(evt.target?.result, { type:'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          let headerRowIdx = allRows.findIndex(r => r.some(c => String(c).trim().toLowerCase().includes('operaci')));
          if (headerRowIdx === -1) headerRowIdx = allRows.findIndex(r => r.some(c => { const v = String(c).trim().toLowerCase(); return v === 'fecha' || v === 'importe' || v === 'date'; }));
          if (headerRowIdx === -1) headerRowIdx = 0;
          const headers: string[] = allRows[headerRowIdx].map(c => String(c || '').trim());
          const dateColIdx = headers.findIndex(h => /f\.\s*op/i.test(h) || /f\.\s*valor/i.test(h) || /^fecha$/i.test(h) || /^date$/i.test(h));
          const descColIdx = headers.findIndex(h => /^concepto$/i.test(h) || /descripci/i.test(h) || /^description$/i.test(h));
          const amountColIdx = headers.findIndex(h => /^importe$/i.test(h) || /^amount$/i.test(h));
          const dataRows = allRows.slice(headerRowIdx + 1).filter(r => r.some(c => c !== ''));
          dataRows.forEach(row => {
            const dateRaw = dateColIdx >= 0 ? row[dateColIdx] : '';
            const amount = Num.parse(amountColIdx >= 0 ? row[amountColIdx] : 0);
            const desc = descColIdx >= 0 ? String(row[descColIdx] || 'Sin concepto') : 'Sin concepto';
            let dateISO = String(dateRaw || '');
            if (typeof dateRaw === 'number') dateISO = new Date(new Date(1899,11,30).getTime() + dateRaw * 86400000).toLocaleDateString('sv-SE');
            else if (dateISO.includes('/')) { const p = dateISO.split('/'); if (p.length === 3) { const y = p[2].length === 4 ? p[2] : p[2].length === 2 ? `20${p[2]}` : p[2]; dateISO = `${y}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; } }
            if (dateISO && amount !== 0) movs.push({ date: dateISO, desc: String(desc), amount });
          });
        } else { movs = parseBancaMarchCSV(text); }
        if (!movs.length) { setImportMsg('❌ No se detectaron movimientos.'); return; }
        importAllMovsRef.current = movs;
        setImportPreview(movs);
        setImportMsg(`✅ ${movs.length} movimientos detectados. Revisa y confirma.`);
      } catch { setImportMsg('❌ Error leyendo el archivo.'); }
    };
    if (file.name.toLowerCase().match(/\.xlsx?$/)) reader.readAsBinaryString(file);
    else reader.readAsText(file, 'UTF-8');
  }, []);

  // ─── 🆕 Clipboard Import ─────────────────────────────────────────────────
  const handleClipboardImport = useCallback(() => {
    if (!clipboardText.trim()) { toast.warning('Pega el texto primero'); return; }
    const movs = parseClipboardText(clipboardText);
    if (!movs.length) {
      // Fallback: intentar como CSV
      const csvMovs = parseBancaMarchCSV(clipboardText);
      if (csvMovs.length > 0) {
        importAllMovsRef.current = csvMovs;
        setImportPreview(csvMovs);
        setImportMsg(`✅ ${csvMovs.length} movimientos detectados del portapapeles.`);
        return;
      }
      toast.error('No se pudieron detectar movimientos en el texto pegado.');
      return;
    }
    importAllMovsRef.current = movs;
    setImportPreview(movs);
    setImportMsg(`✅ ${movs.length} movimientos detectados del portapapeles.`);
  }, [clipboardText]);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setClipboardText(text);
        // Auto-parse inmediato
        const movs = parseClipboardText(text);
        if (movs.length > 0) {
          importAllMovsRef.current = movs;
          setImportPreview(movs);
          setImportMsg(`✅ ${movs.length} movimientos pegados del portapapeles.`);
          toast.success(`📋 ${movs.length} movimientos detectados — revisa y confirma`);
        } else {
          const csvMovs = parseBancaMarchCSV(text);
          if (csvMovs.length > 0) {
            importAllMovsRef.current = csvMovs;
            setImportPreview(csvMovs);
            setImportMsg(`✅ ${csvMovs.length} movimientos pegados del portapapeles.`);
            toast.success(`📋 ${csvMovs.length} movimientos detectados — revisa y confirma`);
          } else {
            toast.warning('No se detectaron movimientos. Intenta seleccionar mejor la tabla de Banca March.');
          }
        }
      }
    } catch { toast.error('No se pudo leer del portapapeles. Usa Ctrl+V en el campo de texto.'); }
  }, []);

  // ─── Importar extracto bancario PDF con IA ──────────────────────────────
  const handlePDFImport = async (file: File) => {
    if (!file.type.includes('pdf')) { toast.warning('Solo PDFs.'); return; }
    const provider = getActiveVisionProvider();
    if (!provider) { toast.error('Añade una API Key de IA en Ajustes.'); return; }
    setIsIAParsing(true);
    setImportMsg('🧠 IA leyendo el extracto bancario…');
    try {
      const prompt = `Eres un contable experto. Este documento es un extracto bancario español. Extrae TODOS los movimientos y devuelve SOLO un JSON estricto sin markdown:
{"movimientos": [{"fecha": "YYYY-MM-DD", "descripcion": "Concepto", "importe": 0.00}]}
REGLAS: "importe": positivo=ingreso, negativo=gasto. "fecha": YYYY-MM-DD. Ignora saldos/totales/cabeceras.`;
      const result = await scanDocument(file, prompt);
      setIaProvider(result.provider);
      const movimientos = (result.raw as any)?.movimientos;
      if (!Array.isArray(movimientos) || movimientos.length === 0) throw new Error('No se detectaron movimientos.');
      const movs = movimientos.map((m: any) => ({
        date: String(m.fecha ?? '').trim(), desc: String(m.descripcion ?? '').trim(),
        amount: parseFloat(String(m.importe ?? '0').replace(',', '.')) || 0,
      })).filter(m => m.date && m.desc && m.amount !== 0);
      if (movs.length === 0) throw new Error('No se extrajeron movimientos válidos.');
      importAllMovsRef.current = movs;
      setImportPreview(movs);
      setImportMsg(`✅ ${movs.length} movimientos detectados por ${result.provider}.`);
    } catch (e: any) { setImportMsg(''); toast.error(e.message || 'Error procesando PDF.'); }
    finally { setIsIAParsing(false); }
  };

  // ─── 🆕 Confirmar Import + Auto-conciliar en un paso ─────────────────────
  const confirmImport = async (autoConciliar = false) => {
    if (!importAllMovsRef.current.length) return;
    const newData = JSON.parse(JSON.stringify(data));
    if (!newData.banco) newData.banco = [];
    const existingHashes = new Set((newData.banco as any[]).map((b: any) => b.hash).filter(Boolean));
    const existingKeys = new Set((newData.banco as any[]).map((b: any) =>
      `${b.date}|${Number(b.amount).toFixed(2)}|${String(b.desc||'').toLowerCase().slice(0,20)}`
    ));
    let added = 0, duplicados = 0;
    const newIds: string[] = [];

    importAllMovsRef.current.forEach(m => {
      const fp  = fingerprint(m.date, m.amount, m.desc);
      const key = `${m.date}|${Number(m.amount).toFixed(2)}|${m.desc.toLowerCase().slice(0,20)}`;
      if (existingHashes.has(fp) || existingKeys.has(key)) { duplicados++; return; }
      existingHashes.add(fp); existingKeys.add(key);
      const id = `imp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      newData.banco.push({ id, date:m.date, amount:m.amount, desc:m.desc, status:'pending', hash:fp });
      newIds.push(id);
      added++;
    });

    // 🆕 Auto-conciliar los nuevos importados
    let conciliados = 0;
    if (autoConciliar && newIds.length > 0) {
      for (const id of newIds) {
        const mov = newData.banco.find((b: any) => b.id === id);
        if (!mov) continue;
        const candidates = findMatches(mov, newData);
        if (candidates.length > 0 && candidates[0].score >= 70) {
          executeLink(newData, id, candidates[0].type, candidates[0].id);
          conciliados++;
        }
      }
    }

    await onSave(newData);
    setImportPreview(null); setIaProvider(''); setClipboardText(''); setShowClipboard(false);

    const parts = [`✅ ${added} importados`];
    if (duplicados > 0) parts.push(`${duplicados} duplicados ignorados`);
    if (conciliados > 0) parts.push(`⚡ ${conciliados} auto-conciliados`);
    setImportMsg(parts.join(' · '));
    setShowImportGuide(false);
    setTimeout(() => setImportMsg(''), 6000);
  };

  // ─── ⚡ Auto-conciliar local ──────────────────────────────────────────────
  const handleAutoMatch = async () => {
    const pendientes = (data.banco || []).filter((b: any) => b.status === 'pending');
    if (!pendientes.length) return void toast.warning('No hay movimientos pendientes.');
    if (!await confirm(`⚡ Auto-conciliar ${pendientes.length} movimientos?\n\nSe enlazarán los que tengan coincidencia clara (≥70%).`)) return;
    setIsAutoLoading(true);
    try {
      const newData = JSON.parse(JSON.stringify(data));
      let count = 0;
      for (const mov of pendientes) {
        const candidates = findMatches(mov, newData);
        if (candidates.length > 0 && candidates[0].score >= 70) {
          executeLink(newData, mov.id, candidates[0].type, candidates[0].id);
          count++;
        }
      }
      await onSave(newData);
      toast.success(`✅ ${count} de ${pendientes.length} conciliados automáticamente.`);
    } catch { toast.error('Error durante la auto-conciliación.'); }
    finally { setIsAutoLoading(false); }
  };

  // ─── Análisis / link / undo / cleanup / nuke ─────────────────────────────
  const handleAnalyze = async () => {
    const newData = JSON.parse(JSON.stringify(data));
    const seen: any[] = [];
    newData.banco = (newData.banco || []).map((m: any) => {
      const n = { ...m };
      if (!n.hash) n.hash = fingerprint(n.date, Num.parse(n.amount), n.desc || '');
      let duplicate = false;
      for (const prev of seen) {
        if (Math.abs(Num.parse(prev.amount) - Num.parse(n.amount)) < 0.005 &&
            normalizeDesc(prev.desc) === normalizeDesc(n.desc) &&
            daysBetween(prev.date, n.date) <= 2) { duplicate = true; break; }
      }
      seen.push({ date: n.date, amount: Num.parse(n.amount), desc: n.desc });
      n.flags    = { duplicate, suspicious: isSuspicious(n.desc || ''), unmatched: n.status === 'pending' && !n.link?.id };
      n.reviewed = n.reviewed ?? false;
      return n;
    });
    await onSave(newData);
    toast.success('📊 Análisis completado.');
  };

  const handleLink = async (bankId: string, matchType: string, docId: string, comision = 0) => {
    const newData = JSON.parse(JSON.stringify(data));
    executeLink(newData, bankId, matchType, docId, comision);
    await onSave(newData);
    setSelectedBankId(null);
  };

  const handleUndoLink = async (bankId: string) => {
    if (!await confirm('¿Desenlazar este movimiento?')) return;
    const newData = JSON.parse(JSON.stringify(data));
    undoLink(newData, bankId);
    await onSave(newData);
  };

  const handleQuickAction = async (bankId: string, label: string, type: 'ALBARAN'|'FIXED_EXPENSE'|'TPV'|'CASH'|'INCOME') => {
    const newData = JSON.parse(JSON.stringify(data));
    const item = newData.banco.find((b: any) => b.id === bankId);
    if (!item) return;
    const amt = Math.abs(Num.parse(item.amount));
    if (type === 'FIXED_EXPENSE') {
      const d = new Date(item.date);
      const monthKey = `pagos_${d.getFullYear()}_${d.getMonth()+1}`;
      if (!newData.control_pagos) newData.control_pagos = {};
      if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
      const isPersonal = label.includes('Personal') || label.includes('Nómina');
      const existing = (newData.gastos_fijos || []).find((g: any) =>
        g.active !== false && g.cat === (isPersonal ? 'personal' : 'varios') &&
        !newData.control_pagos[monthKey].includes(g.id) && Math.abs(Num.parse(g.amount) - amt) < 50
      );
      if (existing) { newData.control_pagos[monthKey].push(existing.id); item.link = { type:'GASTO_FIJO', id: existing.id }; }
      else {
        const newId = 'gf-'+Date.now();
        if (!newData.gastos_fijos) newData.gastos_fijos = [];
        newData.gastos_fijos.push({ id: newId, name:`${label} (Auto)`, amount:amt, freq:'mensual', dia_pago:d.getDate(), cat: isPersonal?'personal':'varios', active:true });
        newData.control_pagos[monthKey].push(newId);
        item.link = { type:'GASTO_FIJO', id: newId };
      }
    } else if (type === 'TPV') {
      const zMatch = newData.cierres?.find((c: any) => !c.conciliado_banco && Math.abs(Num.parse(c.tarjeta) - amt) <= 5);
      if (zMatch) { zMatch.conciliado_banco = true; item.link = { type:'TPV', id:zMatch.id }; }
    } else if (type === 'CASH') {
      const cMatch = newData.cierres?.find((c: any) => !c.conciliado_banco && Math.abs(Num.parse(c.efectivo) - amt) <= 50);
      if (cMatch) cMatch.conciliado_banco = true;
      item.link = { type:'CASH', id: cMatch?.id || 'none' };
    }
    item.status = 'matched'; item.category = label;
    await onSave(newData);
    setSelectedBankId(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const newData = JSON.parse(JSON.stringify(data));
    const idx = (newData.banco || []).findIndex((b: any) => b.id === editingId);
    if (idx >= 0) {
      if (editDesc.trim()) newData.banco[idx].desc = editDesc.trim();
      if (editLabel) newData.banco[idx].label = editLabel;
    }
    await onSave(newData);
    setEditingId(null);
  };

  const handleAutoCleanup = async () => {
    if (!await confirm('⚠️ ¿Eliminar movimientos con "Importado Error"?')) return;
    const newData = JSON.parse(JSON.stringify(data));
    newData.banco = (newData.banco || []).filter((b: any) => !b.desc.includes('Importado Error'));
    await onSave(newData);
  };

  const handleNuke = async () => {
    const typed = window.prompt('Para confirmar, escribe BORRAR:');
    if (typed !== 'BORRAR') return;
    const newData = JSON.parse(JSON.stringify(data));
    newData.banco = newData.banco.filter((b: any) => b.status !== 'pending');
    await onSave(newData);
  };

  // ─── 🆕 Swipe handlers ───────────────────────────────────────────────────
  const handleSwipeLink = async (matchType: string, docId: string) => {
    if (!swipeCurrent) return;
    const newData = JSON.parse(JSON.stringify(data));
    executeLink(newData, swipeCurrent.id, matchType, docId);
    await onSave(newData);
    setSwipeStats(prev => ({ ...prev, linked: prev.linked + 1 }));
    setSwipeIndex(prev => prev + 1);
  };

  const handleSwipeSkip = () => {
    setSwipeStats(prev => ({ ...prev, skipped: prev.skipped + 1 }));
    setSwipeIndex(prev => prev + 1);
  };

  const handleSwipeQuick = async (label: string, type: 'FIXED_EXPENSE'|'TPV'|'CASH') => {
    if (!swipeCurrent) return;
    await handleQuickAction(swipeCurrent.id, label, type);
    setSwipeStats(prev => ({ ...prev, linked: prev.linked + 1 }));
    setSwipeIndex(prev => prev + 1);
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">

      {/* ── HEADER EDITORIAL ──────────────────────────────────────────────── */}
      <header className="bg-white p-6 rounded-2xl shadow-sm border border-[color:var(--arume-gray-100)] relative overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end relative z-10 gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Dinero</p>
            <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight mt-1">Banco</h2>
            <p className="text-sm text-[color:var(--arume-gray-500)] mt-1">Banca March · conciliación y análisis</p>
          </div>
          <div className="flex items-end gap-8 flex-wrap justify-end">
            <div className="hidden md:block">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] mb-1.5">Conciliado</p>
              <div className="w-32 h-1.5 bg-[color:var(--arume-gray-100)] rounded-full overflow-hidden">
                <div className="h-full bg-[color:var(--arume-ok)] transition-all duration-1000" style={{ width:`${stats.percent}%` }}/>
              </div>
              <p className="text-[11px] text-[color:var(--arume-gray-400)] mt-1 tabular-nums">{stats.matched}/{stats.total} mov. {new Date().getFullYear()}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)]">Saldo confirmado</p>
              <p className="font-serif text-3xl font-semibold tabular-nums mt-1">{Num.fmt(stats.saldo)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)]">Saldo real</p>
              <p className={cn("font-serif text-xl font-semibold tabular-nums mt-1",
                stats.saldoReal >= stats.saldo ? "text-[color:var(--arume-ok)]" : "text-[color:var(--arume-accent)]")}>{Num.fmt(stats.saldoReal)}</p>
            </div>
          </div>
        </div>

        {/* Barra de herramientas */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setActiveTab('list')}
              className={cn('px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-1.5',
                activeTab==='list' ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100')}>
              <List className="w-3.5 h-3.5"/> Lista
            </button>
            <button onClick={() => setActiveTab('insights')}
              className={cn('px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-1.5',
                activeTab==='insights' ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100')}>
              <BarChart3 className="w-3.5 h-3.5"/> Insights
            </button>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {/* Importador guiado */}
            <button onClick={() => setShowImportGuide(v => !v)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:bg-indigo-700 transition flex items-center gap-2 shadow-md">
              <Upload className="w-3.5 h-3.5"/> Importar
            </button>

            {/* 🆕 Clipboard Paste */}
            <button onClick={handlePasteFromClipboard}
              className="bg-violet-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:bg-violet-700 transition flex items-center gap-2 shadow-md"
              title="Ctrl+V — pegar movimientos de Banca March web">
              <Clipboard className="w-3.5 h-3.5"/> Pegar
            </button>

            {/* SYNC PSD2 */}
            {psd2Url && (
              <button onClick={handleApiSync} disabled={isApiSyncing}
                className={cn("px-4 py-2 rounded-xl text-[10px] font-black transition flex items-center gap-2 border disabled:opacity-60",
                  psd2Status === 'ok' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                  psd2Status === 'error' ? "bg-rose-50 text-rose-700 border-rose-200" :
                  psd2Status === 'no-config' ? "bg-amber-50 text-amber-700 border-amber-200" :
                  "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                )}>
                {isApiSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <RefreshCw className="w-3.5 h-3.5"/>}
                {psd2Status === 'ok' ? '✅ PSD2' : psd2Status === 'error' ? '❌ PSD2' : 'SYNC PSD2'}
              </button>
            )}

            {/* Auto-conciliar */}
            <button onClick={handleAutoMatch} disabled={isAutoLoading}
              className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:bg-emerald-700 transition flex items-center gap-2 shadow-md disabled:opacity-60">
              {isAutoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <ZapIcon className="w-3.5 h-3.5"/>}
              ⚡ Auto-conciliar
            </button>

            {/* 🆕 Modo Swipe REAL */}
            <button onClick={() => { setIsSwipeMode(true); setSwipeIndex(0); setSwipeStats({ linked:0, skipped:0 }); }}
              disabled={swipePendientes.length === 0}
              className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:from-purple-700 hover:to-pink-700 transition shadow-lg flex items-center gap-2 active:scale-95 disabled:opacity-40">
              <ArrowLeftRight className="w-3.5 h-3.5"/> Swipe ({swipePendientes.length})
            </button>

            <div className="flex gap-1 border-l border-slate-100 pl-3">
              <button onClick={handleAnalyze} title="Analizar" className="bg-amber-50 text-amber-600 hover:text-amber-700 p-2 rounded-xl transition"><Filter className="w-4 h-4"/></button>
              <button onClick={handleAutoCleanup} title="Limpiar" className="bg-slate-50 text-slate-400 hover:text-rose-500 p-2 rounded-xl transition"><Eraser className="w-4 h-4"/></button>
              <button onClick={handleNuke} title="Purgar pendientes" className="bg-slate-50 text-slate-400 hover:text-rose-600 p-2 rounded-xl transition"><Trash2 className="w-4 h-4"/></button>
            </div>
          </div>
        </div>

        {/* 📋 Panel de importación */}
        <AnimatePresence>
          {showImportGuide && (
            <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} exit={{ height:0, opacity:0 }}
              className="overflow-hidden border-t border-indigo-100 mt-5 pt-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Instrucciones */}
                <div className="bg-indigo-50 rounded-2xl p-5 border border-indigo-100">
                  <h4 className="font-black text-indigo-800 text-sm flex items-center gap-2 mb-3">
                    <BookOpen className="w-4 h-4"/> Cómo importar
                  </h4>
                  <div className="space-y-3">
                    {/* Opción 1: Copiar/Pegar */}
                    <div className="bg-white rounded-xl p-3 border border-indigo-200">
                      <p className="text-xs font-black text-violet-700 flex items-center gap-1.5 mb-2">
                        <Clipboard className="w-3.5 h-3.5"/> Opción Rápida: Copiar y Pegar
                      </p>
                      <ol className="space-y-1">
                        {[
                          'Abre Banca March Online',
                          'Ve a Cuentas → Movimientos',
                          'Selecciona la tabla de movimientos (Ctrl+A)',
                          'Copia (Ctrl+C)',
                          'Pulsa el botón "Pegar" arriba',
                        ].map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[10px] text-violet-600">
                            <span className="w-4 h-4 bg-violet-100 rounded-full text-[8px] font-black flex items-center justify-center flex-shrink-0">{i+1}</span>
                            {s}
                          </li>
                        ))}
                      </ol>
                    </div>

                    {/* Opción 2: Archivo */}
                    <div className="bg-white rounded-xl p-3 border border-indigo-200">
                      <p className="text-xs font-black text-indigo-700 flex items-center gap-1.5 mb-2">
                        <Upload className="w-3.5 h-3.5"/> Opción Archivo
                      </p>
                      <p className="text-[10px] text-indigo-600">
                        Exporta CSV/Excel desde Banca March y arrástralo al recuadro →
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-indigo-500 font-bold mt-3 bg-indigo-100 rounded-xl px-3 py-2">
                    ✅ Los duplicados se ignoran automáticamente<br/>
                    ⚡ Puedes importar + auto-conciliar en un paso
                  </p>
                </div>

                {/* Drop zone + clipboard + preview */}
                <div className="space-y-3">
                  <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handlePDFImport(f); e.target.value=''; }} />

                  {/* 🆕 Clipboard text area */}
                  <div className="bg-violet-50 rounded-2xl p-3 border border-violet-200">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-black text-violet-700 flex items-center gap-1">
                        <Clipboard className="w-3 h-3"/> Texto del portapapeles
                      </p>
                      <button onClick={handlePasteFromClipboard}
                        className="text-[9px] font-bold bg-violet-200 text-violet-700 px-2 py-1 rounded-lg hover:bg-violet-300 transition">
                        📋 Ctrl+V Auto
                      </button>
                    </div>
                    <textarea
                      value={clipboardText}
                      onChange={e => setClipboardText(e.target.value)}
                      onPaste={e => {
                        setTimeout(() => {
                          const text = (e.target as HTMLTextAreaElement).value;
                          if (text) {
                            const movs = parseClipboardText(text);
                            if (movs.length > 0) {
                              importAllMovsRef.current = movs;
                              setImportPreview(movs);
                              setImportMsg(`✅ ${movs.length} movimientos detectados.`);
                            }
                          }
                        }, 100);
                      }}
                      placeholder="Pega aquí los movimientos de Banca March (Ctrl+V)..."
                      className="w-full h-20 text-[10px] bg-white border border-violet-200 rounded-xl px-3 py-2 font-mono resize-none outline-none focus:border-violet-400"
                    />
                    {clipboardText && !importPreview && (
                      <button onClick={handleClipboardImport}
                        className="w-full mt-2 py-2 bg-violet-600 text-white rounded-xl text-xs font-bold hover:bg-violet-700 transition">
                        Procesar texto
                      </button>
                    )}
                  </div>

                  {/* File drop zone */}
                  <label
                    className="flex flex-col items-center justify-center w-full h-24 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50 cursor-pointer transition"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (!f) return;
                      if (f.type.includes('pdf')) handlePDFImport(f);
                      else handleFileImport(f);
                    }}>
                    <input type="file" accept=".xlsx,.xls,.csv,.ofx,.qfx,.txt" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileImport(f); e.target.value=''; }}/>
                    <Upload className="w-6 h-6 text-indigo-400 mb-1"/>
                    <p className="text-[10px] font-bold text-indigo-600">Archivo CSV · Excel · OFX</p>
                  </label>

                  {/* PDF IA */}
                  <button onClick={() => pdfInputRef.current?.click()} disabled={isIAParsing}
                    className={cn('w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border-2 text-xs font-black transition-all',
                      isIAParsing ? 'border-violet-200 bg-violet-50 text-violet-400' : 'border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-700')}>
                    {isIAParsing ? <><Loader2 className="w-4 h-4 animate-spin"/> Leyendo PDF…</> : <><Sparkles className="w-4 h-4"/> PDF con IA</>}
                  </button>

                  {importMsg && <p className="text-xs font-bold text-indigo-700 bg-indigo-100 px-3 py-2 rounded-xl">{importMsg}</p>}

                  {importPreview && (
                    <>
                      <div className="max-h-36 overflow-y-auto space-y-1 custom-scrollbar">
                        {importPreview.slice(0,8).map((m, i) => (
                          <div key={i} className="flex items-center justify-between bg-white px-3 py-1.5 rounded-xl border border-slate-100 text-xs">
                            <span className="text-slate-400 w-20 flex-shrink-0">{m.date}</span>
                            <span className="text-slate-700 truncate flex-1 mx-2">{m.desc}</span>
                            <span className={cn("font-black flex-shrink-0", m.amount>=0?"text-emerald-600":"text-rose-600")}>
                              {m.amount>=0?'+':''}{Num.fmt(m.amount)}
                            </span>
                          </div>
                        ))}
                        {importPreview.length > 8 && <p className="text-center text-[10px] text-slate-400">...y {importPreview.length-8} más</p>}
                      </div>
                      {/* 🆕 Dos botones: importar solo o importar + conciliar */}
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => confirmImport(false)}
                          className="py-3 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition flex items-center justify-center gap-2">
                          <Upload className="w-4 h-4"/> Importar ({importPreview.length})
                        </button>
                        <button onClick={() => confirmImport(true)}
                          className="py-3 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition flex items-center justify-center gap-2">
                          <ZapIcon className="w-4 h-4"/> Importar + Conciliar
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ── TAB INSIGHTS ─────────────────────────────────────────────────── */}
      {activeTab === 'insights' && (
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-sm font-black text-slate-800 mb-1 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500"/> Cajas TPV Pendientes
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">Sin conciliar con el banco</p>
              {pendingCajas.length > 0 ? (
                <div className="space-y-2">
                  {pendingCajas.map((c: any, i: number) => (
                    <div key={i} className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-xs font-bold text-slate-600">Cierre {c.date}</span>
                      <span className="text-sm font-black text-emerald-600">{Num.fmt(c.tarjeta)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-slate-400 text-center py-6">No hay TPVs pendientes. ✅</p>}
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center items-center text-center">
              <h3 className="text-sm font-black text-slate-800 mb-1 flex items-center gap-2 justify-center">
                <TrendingDown className="w-4 h-4 text-rose-500"/> Previsión a 7 Días
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">Pagos fijos próximos</p>
              <span className="text-5xl font-black text-rose-500 tracking-tighter">{Num.fmt(prevPagos)}</span>
              <p className="text-xs font-bold text-slate-500 mt-2">
                Saldo est. post-pagos: <span className="text-slate-800">{Num.fmt(stats.saldo - prevPagos)}</span>
              </p>
            </div>
          </div>

          {/* 🆕 Movimientos Previstos */}
          {movimientosPrevistos.length > 0 && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-sm font-black text-slate-800 mb-1 flex items-center gap-2">
                <Clock className="w-4 h-4 text-violet-500"/> Movimientos Previstos del Mes
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">
                Gastos fijos que aún no aparecen en el banco
              </p>
              <div className="space-y-2">
                {movimientosPrevistos.map(p => (
                  <div key={p.id} className={cn("flex items-center justify-between p-3 rounded-xl border",
                    p.status === 'atrasado' ? 'bg-rose-50 border-rose-200' : 'bg-violet-50 border-violet-200')}>
                    <div className="flex items-center gap-3">
                      <span className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-black",
                        p.status === 'atrasado' ? 'bg-rose-200 text-rose-700' : 'bg-violet-200 text-violet-700')}>
                        {p.diaPago}
                      </span>
                      <div>
                        <p className="text-xs font-bold text-slate-700">{p.desc}</p>
                        <p className="text-[9px] text-slate-400">
                          {p.status === 'atrasado' ? '⚠️ Atrasado — debería haber aparecido' : `Previsto día ${p.diaPago}`}
                        </p>
                      </div>
                    </div>
                    <span className={cn("text-sm font-black", p.amount >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      {Num.fmt(p.amount)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 border-t border-slate-100 mt-2">
                  <span className="text-[10px] font-black text-slate-500 uppercase">Total previsto pendiente</span>
                  <span className="text-sm font-black text-slate-800">
                    {Num.fmt(movimientosPrevistos.reduce((s, p) => s + p.amount, 0))}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
            <h3 className="text-xl font-black text-slate-800 mb-2">CashFlow → Últimos 30 Días</h3>
            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-6">Solo movimientos conciliados</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <AreaChart data={cashFlowData} margin={{top:5,right:5,left:-20,bottom:0}}>
                  <defs>
                    <linearGradient id="colorInc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorExp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#fb7185" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#fb7185" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                  <XAxis dataKey="name" tick={{fontSize:10,fill:'#94a3b8',fontWeight:'bold'}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:10,fill:'#94a3b8',fontWeight:'bold'}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
                  <Tooltip contentStyle={{borderRadius:16,border:'none',boxShadow:'0 10px 15px -3px rgba(0,0,0,0.1)'}}
                    formatter={(val: number) => Num.fmt(val)} labelStyle={{fontWeight:'black',color:'#1e293b'}}/>
                  <Area type="monotone" dataKey="ingresos" stroke="#34d399" strokeWidth={3} fillOpacity={1} fill="url(#colorInc)" activeDot={{r:6,strokeWidth:0}}/>
                  <Area type="monotone" dataKey="gastos" stroke="#fb7185" strokeWidth={3} fillOpacity={1} fill="url(#colorExp)" activeDot={{r:6,strokeWidth:0}}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <CashProjection data={data} saldoActual={stats.saldo} />
        </motion.div>
      )}

      {/* ── TAB LISTA ────────────────────────────────────────────────────── */}
      {activeTab === 'list' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* ── Columna izquierda ── */}
          <div className="lg:col-span-5 space-y-3">

            <div className="bg-white p-2 rounded-[1.5rem] border border-slate-200 flex items-center gap-2 shadow-sm">
              <Search className="w-4 h-4 text-slate-400 ml-3"/>
              <input type="text" placeholder="Buscar movimiento o etiqueta..." value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-transparent text-xs font-bold outline-none text-slate-600 h-10 px-2"/>
            </div>

            <div className="flex gap-2 items-center">
              <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0"/>
              <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none text-slate-600">
                <option value="">Todos los meses</option>
                {mesesDisponibles.map(m => (
                  <option key={m} value={m}>{new Date(m+'-02').toLocaleDateString('es-ES',{month:'long',year:'numeric'}).toUpperCase()}</option>
                ))}
              </select>
            </div>

            {/* Filtros con contadores — 🆕 añadido Previstos */}
            <div className="flex flex-wrap gap-1.5">
              {([
                { key:'pending' as const,    label:'Pendientes',  count: filterCounts.pending    },
                { key:'all' as const,        label:'Todos',       count: filterCounts.all        },
                { key:'previstos' as const,  label:'Previstos',   count: filterCounts.previstos  },
                { key:'suspicious' as const, label:'Sospechosos', count: filterCounts.suspicious },
                { key:'duplicate' as const,  label:'Duplicados',  count: filterCounts.duplicate  },
                { key:'reviewed' as const,   label:'Revisados',   count: filterCounts.reviewed   },
              ]).map(f => (
                <button key={f.key} onClick={() => setViewFilter(f.key)}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase transition border',
                    viewFilter === f.key
                      ? f.key === 'previstos' ? 'bg-violet-600 text-white border-violet-600' : 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
                  {f.key === 'previstos' && <Clock className="w-3 h-3"/>}
                  {f.label}
                  <span className={cn('rounded-full px-1.5 text-[8px] font-black',
                    viewFilter === f.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}>
                    {f.count}
                  </span>
                </button>
              ))}
            </div>

            {/* 🆕 Lista Previstos */}
            {viewFilter === 'previstos' ? (
              <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1 custom-scrollbar">
                {movimientosPrevistos.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30 text-emerald-400"/>
                    <p className="text-xs font-black">Todos los gastos fijos del mes ya aparecen en banco</p>
                  </div>
                ) : movimientosPrevistos.map(p => (
                  <div key={p.id}
                    className={cn('bg-white p-4 rounded-[1.5rem] border-2 transition',
                      p.status === 'atrasado' ? 'border-rose-200 bg-rose-50/30' : 'border-violet-200 bg-violet-50/30')}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-slate-800 text-sm truncate uppercase tracking-tight">{p.desc}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-slate-400 font-bold">Día {p.diaPago}</span>
                          <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded-full border",
                            p.status === 'atrasado'
                              ? 'bg-rose-100 text-rose-700 border-rose-200'
                              : 'bg-violet-100 text-violet-700 border-violet-200')}>
                            {p.status === 'atrasado' ? '⚠️ Atrasado' : '🔮 Esperado'}
                          </span>
                        </div>
                      </div>
                      <span className={cn('font-black text-lg whitespace-nowrap tracking-tighter shrink-0',
                        p.amount < 0 ? 'text-slate-900' : 'text-emerald-500')}>
                        {Num.fmt(p.amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Lista movimientos normal */
              <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1 custom-scrollbar">
                {filteredMovements.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30 text-emerald-400"/>
                    <p className="text-xs font-black uppercase tracking-widest">Sin movimientos</p>
                  </div>
                ) : filteredMovements.map((b: any) => (
                  <motion.div key={b.id} layoutId={b.id} onClick={() => { setSelectedBankId(b.id); setEditingId(null); }}
                    className={cn('group relative bg-white p-4 rounded-[1.5rem] border-2 transition cursor-pointer',
                      selectedBankId===b.id ? 'border-indigo-400 bg-indigo-50/30 shadow-md' : 'border-slate-100 hover:border-indigo-200')}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-slate-800 text-sm truncate uppercase tracking-tight">{b.desc}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <p className="text-[10px] text-slate-400 font-bold tracking-widest">{b.date}</p>
                          {b.label && (
                            <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded-full border",
                              ETIQUETAS_RAPIDAS.find(e => e.label === b.label)?.color || 'bg-slate-100 text-slate-600 border-slate-200')}>
                              {b.label}
                            </span>
                          )}
                          {b.status==='matched' && (
                            <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-0.5">
                              <ShieldCheck className="w-2.5 h-2.5"/> OK
                            </span>
                          )}
                          {b.flags?.suspicious && <span className="text-[8px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">⚠️</span>}
                          {b.flags?.duplicate  && <span className="text-[8px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-full border border-rose-200">🔄</span>}
                        </div>
                      </div>
                      <span className={cn('font-black text-lg whitespace-nowrap tracking-tighter shrink-0',
                        Num.parse(b.amount) < 0 ? 'text-slate-900' : 'text-emerald-500')}>
                        {Num.parse(b.amount) > 0 ? '+' : ''}{Num.fmt(b.amount)}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* ── Panel detalle ── */}
          <div className="lg:col-span-7">
            <div className="bg-white p-8 md:p-10 rounded-[3rem] border border-slate-100 min-h-[580px] flex flex-col shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-purple-500"/>

              <AnimatePresence mode="wait">
                {selectedItem ? (
                  <motion.div key={selectedItem.id} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className="flex-1 flex flex-col gap-6">
                    <div className="border-b border-slate-100 pb-6">
                      <div className="flex justify-between items-center mb-3">
                        <span className={cn('text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest',
                          Num.parse(selectedItem.amount) > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>
                          {Num.parse(selectedItem.amount) > 0 ? 'INGRESO' : 'GASTO'}
                        </span>
                        {selectedItem.status === 'matched' && (
                          <button onClick={() => handleUndoLink(selectedItem.id)}
                            className="bg-slate-100 text-slate-500 hover:bg-rose-100 hover:text-rose-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase flex items-center gap-1.5 transition">
                            <Undo2 className="w-3 h-3"/> Deshacer
                          </button>
                        )}
                      </div>
                      {editingId === selectedItem.id ? (
                        <div className="space-y-3">
                          <input value={editDesc} onChange={e => setEditDesc(e.target.value)}
                            className="w-full font-black text-xl text-slate-800 bg-slate-50 rounded-xl px-4 py-2 outline-none border border-indigo-300"/>
                          <div className="flex flex-wrap gap-1.5">
                            {ETIQUETAS_RAPIDAS.map(et => (
                              <button key={et.label} onClick={() => setEditLabel(et.label)}
                                className={cn("text-[9px] font-black px-2.5 py-1 rounded-full border transition",
                                  editLabel === et.label ? et.color + ' ring-2 ring-offset-1 ring-indigo-400' : et.color)}>
                                {et.label}
                              </button>
                            ))}
                            {editLabel && <button onClick={() => setEditLabel('')} className="text-[9px] px-2 py-1 rounded-full border border-slate-200 text-slate-400 hover:text-rose-500"><X className="w-3 h-3"/></button>}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={handleSaveEdit} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition"><Save className="w-3.5 h-3.5"/> Guardar</button>
                            <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black">Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-black text-2xl md:text-3xl leading-tight text-slate-800 tracking-tighter line-clamp-2" id={`bank-preview-${selectedItem.id}`}>
                              {selectedItem.desc}
                            </h3>
                            <p className={cn('text-4xl md:text-5xl font-black mt-2 tracking-tighter',
                              Num.parse(selectedItem.amount) > 0 ? 'text-emerald-500' : 'text-slate-900')}>
                              {Num.fmt(selectedItem.amount)}
                            </p>
                            {(selectedItem as any).label && (
                              <span className={cn("mt-2 inline-block text-[9px] font-black px-2.5 py-1 rounded-full border",
                                ETIQUETAS_RAPIDAS.find(e => e.label === (selectedItem as any).label)?.color || 'bg-slate-100')}>
                                · {(selectedItem as any).label}
                              </span>
                            )}
                          </div>
                          <button onClick={() => { setEditingId(selectedItem.id); setEditDesc(selectedItem.desc || ''); setEditLabel((selectedItem as any).label || ''); }}
                            className="flex-shrink-0 p-2 bg-slate-100 hover:bg-indigo-100 hover:text-indigo-600 rounded-xl transition">
                            <Edit3 className="w-4 h-4 text-slate-500"/>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                      {matches.length > 0 && selectedItem.status === 'pending' ? (
                        <div className="space-y-3">
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-indigo-500"/> Sugerencias Inteligentes
                          </p>
                          {matches.slice(0,3).map((m: any, idx: number) => {
                            const matchIdStr = `match-card-${m.id}-${idx}`;
                            const isHov = hoveredMatch === m.id;
                            return (
                              <div key={idx} className="relative">
                                <EnergyBeam sourceId={`bank-preview-${selectedItem.id}`} targetId={matchIdStr} isActive={isHov}/>
                                <div id={matchIdStr}
                                  onMouseEnter={() => setHoveredMatch(m.id)} onMouseLeave={() => setHoveredMatch(null)}
                                  className={cn('relative z-20 flex justify-between items-center p-4 rounded-2xl border-2 hover:shadow-md transition-all bg-white',
                                    isHov ? 'border-emerald-400 shadow-emerald-200/50 shadow-lg scale-[1.02]' : 'border-slate-200 hover:border-indigo-200')}>
                                  <div>
                                    <span className={cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded',
                                      m.color==='emerald'?'bg-emerald-50 text-emerald-700':m.color==='amber'?'bg-amber-50 text-amber-700':m.color==='indigo'?'bg-indigo-50 text-indigo-700':'bg-rose-50 text-rose-700'
                                    )}>{m.type}</span>
                                    <p className="text-sm font-black text-slate-800 mt-1.5 truncate max-w-[220px]">{m.title}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">{m.date}</p>
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-right">
                                      <span className="text-[10px] font-bold text-slate-400 block">Puntuación</span>
                                      <span className="font-black text-indigo-600">{m.score}%</span>
                                    </div>
                                    <button onClick={() => handleLink(selectedItem.id, m.type, m.id)}
                                      className={cn('px-4 py-2 rounded-xl text-[10px] font-black text-white transition active:scale-95 shadow-md',
                                        isHov ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-indigo-600 hover:bg-indigo-700')}>
                                      Enlazar →
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : selectedItem.status === 'matched' ? (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                          <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3 opacity-60"/>
                          <p className="text-sm font-black text-slate-700">Movimiento conciliado</p>
                          <p className="text-xs text-slate-400 mt-1">Categoría: {(selectedItem as any).category || '—'}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Asignación Manual</p>
                          {(Num.parse(selectedItem.amount) > 0 ? [
                            { label:'Cierre TPV (Tarjetas)', type:'TPV' as const },
                            { label:'Ingreso Efectivo', type:'CASH' as const },
                          ] : [
                            { label:'Gasto Fijo', type:'FIXED_EXPENSE' as const },
                            { label:'Comisión Bancaria', type:'FIXED_EXPENSE' as const },
                            { label:'Personal / Nómina', type:'FIXED_EXPENSE' as const },
                          ]).map(cat => (
                            <button key={cat.label} onClick={() => handleQuickAction(selectedItem.id, cat.label, cat.type)}
                              className="w-full p-4 border-2 border-slate-100 rounded-[1.5rem] hover:bg-slate-50 hover:border-indigo-100 text-left transition-all group">
                              <p className="text-xs font-black text-slate-600 uppercase tracking-tight group-hover:text-indigo-600">{cat.label}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center items-center text-center opacity-40">
                    <Landmark className="w-16 h-16 mb-5"/>
                    <p className="text-xs font-black uppercase tracking-widest">Selecciona un movimiento</p>
                    <p className="text-[10px] text-slate-400 mt-1">para ver sugerencias y enlazarlo</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
         🆕 MODO SWIPE — Conciliación rápida tipo Tinder
         ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {isSwipeMode && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-900/95 text-white p-4">
            <div className="w-full max-w-lg">

              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-black flex items-center gap-2">
                    <ArrowLeftRight className="w-5 h-5 text-purple-400"/> Modo Swipe
                  </h3>
                  <p className="text-xs text-slate-400">
                    {swipeIndex + 1} de {swipePendientes.length} pendientes ·
                    ✅ {swipeStats.linked} enlazados · ⏭ {swipeStats.skipped} saltados
                  </p>
                </div>
                <button onClick={() => setIsSwipeMode(false)}
                  className="p-2 bg-slate-700 rounded-full hover:bg-rose-500 transition">
                  <CloseIcon className="w-4 h-4"/>
                </button>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-slate-700 rounded-full mb-6 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                  style={{ width: `${swipePendientes.length > 0 ? ((swipeIndex) / swipePendientes.length) * 100 : 0}%` }}/>
              </div>

              {swipeCurrent ? (
                <motion.div
                  key={swipeCurrent.id}
                  initial={{ opacity:0, scale:0.9, y:20 }}
                  animate={{ opacity:1, scale:1, y:0 }}
                  exit={{ opacity:0, scale:0.9, y:-20 }}
                  className="space-y-4"
                >
                  {/* Tarjeta movimiento */}
                  <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700">
                    <div className="flex justify-between items-start mb-3">
                      <span className={cn('text-[10px] font-black px-3 py-1 rounded-full',
                        Num.parse(swipeCurrent.amount) > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400')}>
                        {Num.parse(swipeCurrent.amount) > 0 ? 'INGRESO' : 'GASTO'}
                      </span>
                      <span className="text-xs text-slate-500">{swipeCurrent.date}</span>
                    </div>
                    <p className="text-lg font-black text-white mb-2 leading-snug">{swipeCurrent.desc}</p>
                    <p className={cn('text-4xl font-black tracking-tighter',
                      Num.parse(swipeCurrent.amount) > 0 ? 'text-emerald-400' : 'text-white')}>
                      {Num.fmt(swipeCurrent.amount)}
                    </p>
                  </div>

                  {/* Sugerencias */}
                  {swipeMatches.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        Mejor coincidencia ({swipeMatches[0].score}%)
                      </p>
                      {swipeMatches.slice(0, 2).map((m: any, idx: number) => (
                        <button key={idx} onClick={() => handleSwipeLink(m.type, m.id)}
                          className="w-full flex items-center justify-between bg-slate-800 border border-slate-700 hover:border-emerald-500 rounded-2xl p-4 transition group">
                          <div className="text-left">
                            <span className="text-[9px] font-black text-indigo-400 uppercase">{m.type}</span>
                            <p className="text-sm font-bold text-white mt-0.5">{m.title}</p>
                            <p className="text-[10px] text-slate-500">{m.date} · {m.score}%</p>
                          </div>
                          <ThumbsUp className="w-6 h-6 text-slate-600 group-hover:text-emerald-400 transition"/>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Sin coincidencias automáticas</p>
                      {(Num.parse(swipeCurrent.amount) > 0 ? [
                        { label:'TPV', type:'TPV' as const },
                        { label:'Efectivo', type:'CASH' as const },
                      ] : [
                        { label:'Gasto Fijo', type:'FIXED_EXPENSE' as const },
                        { label:'Nómina', type:'FIXED_EXPENSE' as const },
                      ]).map(cat => (
                        <button key={cat.label} onClick={() => handleSwipeQuick(cat.label, cat.type)}
                          className="w-full flex items-center justify-between bg-slate-800 border border-slate-700 hover:border-indigo-500 rounded-2xl p-3 transition">
                          <span className="text-xs font-bold text-slate-300">{cat.label}</span>
                          <ThumbsUp className="w-5 h-5 text-slate-600"/>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Botones de acción */}
                  <div className="flex gap-3 pt-2">
                    <button onClick={handleSwipeSkip}
                      className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-700 hover:bg-slate-600 rounded-2xl text-sm font-black transition active:scale-95">
                      <SkipForward className="w-5 h-5"/> Saltar
                    </button>
                    {swipeMatches.length > 0 && (
                      <button onClick={() => handleSwipeLink(swipeMatches[0].type, swipeMatches[0].id)}
                        className="flex-1 flex items-center justify-center gap-2 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl text-sm font-black transition active:scale-95 shadow-lg shadow-emerald-900/30">
                        <ThumbsUp className="w-5 h-5"/> Enlazar
                      </button>
                    )}
                  </div>
                </motion.div>
              ) : (
                /* Swipe terminado */
                <motion.div initial={{opacity:0,scale:0.9}} animate={{opacity:1,scale:1}}
                  className="text-center py-12">
                  <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4"/>
                  <h3 className="text-2xl font-black mb-2">¡Sesión completada!</h3>
                  <p className="text-slate-400 mb-6">
                    ✅ {swipeStats.linked} enlazados · ⏭ {swipeStats.skipped} saltados
                  </p>
                  <button onClick={() => setIsSwipeMode(false)}
                    className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-black transition">
                    Cerrar
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
