import React, { useMemo, useState, useCallback, useRef } from 'react';
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { confirm } from '../hooks/useConfirm';
import { EmptyState } from './EmptyState';
import { toast } from '../hooks/useToast';
import {
  TrendingUp, TrendingDown, CheckCircle2, Clock,
  Loader2, ArrowDownRight, ArrowUpRight, Upload, X, Plus,
  FileText, ReceiptText, Handshake, Hotel, Banknote, Trash2, Edit3,
  ExternalLink, Landmark, AlertTriangle, Calendar, Zap,
  ChevronRight, BadgeEuro, Building2, Utensils, ShoppingBag,
  Wallet, Users as UsersIcon, CircleDollarSign, Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ─── Props ────────────────────────────────────────────────────────────────────
interface TesoreriaViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
  onNavigate?: (tab: string) => void;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────
type CobroTipo = 'bilty' | 'evento' | 'presupuesto';

interface CobroB2B {
  id: string;
  tipo: CobroTipo;
  cliente: string;
  concepto: string;
  total: number;
  base?: number;
  iva?: number;
  fecha: string;
  vencimiento: string;
  paid: boolean;
  numFactura?: string;
  notas?: string;
  unidad?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysDiffLocal = (from: Date, to: Date) => {
  const MS = 1000 * 60 * 60 * 24;
  return Math.floor((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / MS);
};
const safeISODateLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const todayISO = () => safeISODateLocal(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return safeISODateLocal(d);
};

const getRiesgo = (fechaISO: string, hoy: Date) => {
  if (!fechaISO) return { label: 'Sin fecha', cls: 'text-slate-400', urgency: 0 };
  const d = new Date(fechaISO + 'T00:00:00');
  if (isNaN(d.getTime())) return { label: '?', cls: 'text-slate-400', urgency: 0 };
  const diff = daysDiffLocal(hoy, d);
  if (diff < 0)   return { label: `Vencido ${Math.abs(diff)}d`, cls: 'text-rose-500 font-black', urgency: 4 };
  if (diff === 0) return { label: 'Hoy',  cls: 'text-orange-500 font-black', urgency: 3 };
  if (diff <= 7)  return { label: `${diff}d`, cls: 'text-amber-500 font-bold', urgency: 2 };
  if (diff <= 30) return { label: `${diff}d`, cls: 'text-slate-500', urgency: 1 };
  return { label: `${diff}d`, cls: 'text-slate-400', urgency: 0 };
};

const parseCSVRows = (text: string): Record<string, string>[] => {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(/[;,\t]/).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  return lines.slice(1).map(line => {
    const vals = line.split(/[;,\t]/).map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });
    return row;
  });
};

const TIPO_CONFIG: Record<CobroTipo, { label: string; icon: any; color: string; bg: string }> = {
  bilty:       { label: 'Bilty',     icon: ReceiptText, color: 'text-violet-600', bg: 'bg-violet-50' },
  evento:      { label: 'Catering',  icon: Hotel,       color: 'text-amber-600',  bg: 'bg-amber-50'  },
  presupuesto: { label: 'Presupuesto', icon: Handshake, color: 'text-sky-600',    bg: 'bg-sky-50'    },
};

const emptyForm = (): Omit<CobroB2B, 'id' | 'paid'> => ({
  tipo: 'bilty', cliente: '', concepto: '', total: 0, base: 0, iva: 0,
  fecha: todayISO(), vencimiento: addDays(todayISO(), 30),
  numFactura: '', notas: '', unidad: 'DLV',
});

// ─── Subcomponente: Pill de urgencia ──────────────────────────────────────────
const UrgencyPill = ({ fecha, hoy }: { fecha: string; hoy: Date }) => {
  const r = getRiesgo(fecha, hoy);
  return (
    <span className={cn(
      'text-[10px] font-black px-2 py-0.5 rounded-full tabular-nums',
      r.urgency >= 4 ? 'bg-rose-100 text-rose-600' :
      r.urgency >= 3 ? 'bg-orange-100 text-orange-600' :
      r.urgency >= 2 ? 'bg-amber-100 text-amber-600' :
      'bg-slate-100 text-slate-500'
    )}>{r.label}</span>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export const TesoreriaView: React.FC<TesoreriaViewProps> = ({ data, onSave, onNavigate }) => {
  const hoy = useMemo(() => startOfLocalDay(new Date()), []);
  const currentYear = new Date().getFullYear();

  // ─── Cobros B2B ───────────────────────────────────────────────────────────
  const cobrosB2B: CobroB2B[] = useMemo(() => {
    const raw = (data as any).cobros_b2b;
    return Array.isArray(raw) ? raw : [];
  }, [data]);

  const saveCobros = useCallback(async (list: CobroB2B[]) => {
    await onSave({ ...data, cobros_b2b: list } as any);
  }, [data, onSave]);

  // ─── Estado ───────────────────────────────────────────────────────────────
  const [activeTab,      setActiveTab]      = useState<'dashboard' | 'cobrar' | 'pagar' | 'prediccion'>('dashboard');
  const [unitFilter,     setUnitFilter]     = useState<'ALL' | 'REST' | 'SHOP' | 'DLV' | 'CORP'>('ALL');
  const [savingId,       setSavingId]       = useState<string | null>(null);
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [editingCobro,   setEditingCobro]   = useState<CobroB2B | null>(null);
  const [form,           setForm]           = useState(emptyForm());
  const [showPaid,       setShowPaid]       = useState(false);
  const [showBiltyPanel, setShowBiltyPanel] = useState(false);
  const [biltyPreview,   setBiltyPreview]   = useState<CobroB2B[] | null>(null);
  const biltyRef = useRef<HTMLInputElement>(null);

  // ─── AP: albaranes + facturas de compra sin pagar ────────────────────────
  const processedAP = useMemo(() => {
    const computeDue = (dateStr: string | undefined, creditDays?: number) => {
      if (!dateStr) return '';
      const d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d.getTime())) return dateStr;
      d.setDate(d.getDate() + (creditDays ?? 30));
      return safeISODateLocal(d);
    };
    const isOp = (doc: any) => {
      if (!('status' in doc)) return true;
      return doc.status !== 'draft' && doc.status !== 'mismatch';
    };

    // Albaranes sin pagar
    const albsPendientes = (data.albaranes || [])
      .filter(a =>
        isOp(a) &&
        !a.paid &&
        Num.parse(a.total || 0) > 0 &&
        String(a.date || '').startsWith(String(currentYear))
      )
      .map(a => ({
        ...a,
        _tipo: 'albaran' as const,
        dueDate: a.dueDate || computeDue(a.date, a.creditDays),
      }));

    // Facturas de compra sin pagar (que no sean duplicados de albaranes ya listados)
    const albIds = new Set(albsPendientes.map(a => a.id));
    const facsPendientes = (data.facturas || [])
      .filter((f: any) =>
        f.tipo === 'compra' &&
        !f.paid &&
        !f.reconciled &&
        isOp(f) &&
        Num.parse(f.total || 0) > 0 &&
        String(f.date || '').startsWith(String(currentYear))
      )
      // Evitar duplicar: si la factura tiene albaranes vinculados que ya están en la lista, no añadir
      .filter((f: any) => {
        const linkedAlbs = f.albaranIdsArr || [];
        if (linkedAlbs.length === 0) return true;
        // Solo incluir si NO todos sus albaranes están ya en la lista de pendientes
        return !linkedAlbs.every((id: string) => albIds.has(id));
      })
      .map((f: any) => ({
        ...f,
        _tipo: 'factura' as const,
        prov: f.prov || 'Proveedor',
        dueDate: f.dueDate || computeDue(f.date, f.creditDays),
      }));

    const albs = [...albsPendientes, ...facsPendientes]
      .sort((a, b) => {
        const ra = getRiesgo((a as any).dueDate, hoy).urgency;
        const rb = getRiesgo((b as any).dueDate, hoy).urgency;
        if (rb !== ra) return rb - ra;
        return new Date((a as any).dueDate || '').getTime() - new Date((b as any).dueDate || '').getTime();
      });

    const total = Num.round2(albs.reduce((s, a) => s + Num.parse(a.total || 0), 0));

    // Agrupar por proveedor
    const porProv: Record<string, { total: number; count: number; urgency: number }> = {};
    albs.forEach((a: any) => {
      const k = a.prov || 'Varios';
      if (!porProv[k]) porProv[k] = { total: 0, count: 0, urgency: 0 };
      porProv[k].total = Num.round2(porProv[k].total + Num.parse(a.total || 0));
      porProv[k].count++;
      const u = getRiesgo(a.dueDate, hoy).urgency;
      if (u > porProv[k].urgency) porProv[k].urgency = u;
    });
    const topProvs = Object.entries(porProv).sort(([, A], [, B]) => B.total - A.total).slice(0, 5);

    // Vencen esta semana
    const urgentes = albs.filter((a: any) => getRiesgo(a.dueDate, hoy).urgency >= 2);

    return { albs, total, topProvs, urgentes };
  }, [data.albaranes, data.facturas, currentYear, hoy]);

  // ─── AR: cobros B2B ───────────────────────────────────────────────────────
  const processedAR = useMemo(() => {
    const pendientes = cobrosB2B.filter(c => !c.paid);
    const todos = showPaid ? cobrosB2B : pendientes;
    const sorted = [...todos].sort((a, b) => {
      const ua = getRiesgo(a.vencimiento, hoy).urgency;
      const ub = getRiesgo(b.vencimiento, hoy).urgency;
      if (ub !== ua) return ub - ua;
      return new Date(a.vencimiento).getTime() - new Date(b.vencimiento).getTime();
    });
    const total = Num.round2(pendientes.reduce((s, c) => s + c.total, 0));
    const urgentes = pendientes.filter(c => getRiesgo(c.vencimiento, hoy).urgency >= 2);
    return { list: sorted, total, pendientesCount: pendientes.length, urgentes };
  }, [cobrosB2B, showPaid, hoy]);

  // ─── KPIs ─────────────────────────────────────────────────────────────────
  const posicionNeta = Num.round2(processedAR.total - processedAP.total);

  const saldoBanco = useMemo(() => {
    const movs = data.banco || [];
    const suma = movs
      .filter((b: any) => b.status === 'matched')
      .reduce((acc: number, b: any) => acc + (Num.parse(b.amount) || 0), 0);
    return Num.round2((Num.parse(data.config?.saldoInicial) || 0) + suma);
  }, [data.banco, data.config?.saldoInicial]);

  // ═══════════════════════════════════════════════════════════════════════
  // 🆕 TESORERÍA 360 — Datos unificados filtrables por unidad de negocio
  // ═══════════════════════════════════════════════════════════════════════

  // Helpers para normalizar BU
  const getBU = (doc: any): string =>
    (doc?.unidad_negocio || doc?.unitId || doc?.unidad || 'REST').toString().toUpperCase();
  const passFilter = useCallback((bu: string) => unitFilter === 'ALL' || bu === unitFilter, [unitFilter]);

  // ─── Caja diaria (Cierres Z) ──────────────────────────────────────────
  const cajaDiaria = useMemo(() => {
    const cierres = (data.cierres || []).filter((c: any) => passFilter(getBU(c)));
    const todayIso = todayISO();
    // Últimos 7 días
    const startWeek = addDays(todayIso, -6);
    const semana = cierres.filter((c: any) => c.date && c.date >= startWeek && c.date <= todayIso);
    // Mes en curso
    const startMonth = todayIso.slice(0, 7) + '-01';
    const mes = cierres.filter((c: any) => c.date && c.date >= startMonth && c.date <= todayIso);
    // Cierre de hoy
    const hoyCierre = cierres.find((c: any) => c.date === todayIso);

    const sum = (arr: any[]) => Num.round2(arr.reduce((s, c) => s + Num.parse((c as any).totalVenta ?? c.totalVentas ?? 0), 0));

    // Descuadre agregado mes
    const descuadreMes = Num.round2(mes.reduce((s: number, c: any) => s + Num.parse(c.descuadre || 0), 0));

    return {
      hoyVal:     hoyCierre ? Num.parse((hoyCierre as any).totalVenta ?? hoyCierre.totalVentas ?? 0) : 0,
      hoyExiste:  !!hoyCierre,
      semanaVal:  sum(semana),
      semanaN:    semana.length,
      mesVal:     sum(mes),
      mesN:       mes.length,
      descuadreMes,
      ultimos:    [...cierres].sort((a: any, b: any) => (b.date || '').localeCompare(a.date || '')).slice(0, 5),
    };
  }, [data.cierres, passFilter]);

  // ─── Nóminas y gastos fijos del mes ──────────────────────────────────
  const gastosFijosPanel = useMemo(() => {
    const gf = (data.gastos_fijos || []).filter((g: any) => {
      const activo = g.active !== false && g.activo !== false;
      return activo && passFilter(getBU(g)) && g.type !== 'income' && g.type !== 'grant';
    });
    const [y, m] = todayISO().split('-').map(Number);
    const monthKey = `pagos_${y}_${m}`;
    const pagados = new Set(((data.control_pagos as any)?.[monthKey] || []) as string[]);

    const nominas = gf.filter((g: any) => g.type === 'payroll');
    const suministros = gf.filter((g: any) => g.type !== 'payroll');

    const sumAmt = (arr: any[]) => Num.round2(arr.reduce((s: number, g: any) => s + Num.parse(g.amount ?? g.importe ?? 0), 0));

    const nominasTotal   = sumAmt(nominas);
    const nominasPend    = nominas.filter((g: any) => !pagados.has(g.id));
    const nominasPendVal = sumAmt(nominasPend);
    const suministrosTotal = sumAmt(suministros);
    const suministrosPend  = suministros.filter((g: any) => !pagados.has(g.id));
    const suministrosPendVal = sumAmt(suministrosPend);

    return { nominas, nominasTotal, nominasPend, nominasPendVal,
             suministros, suministrosTotal, suministrosPend, suministrosPendVal };
  }, [data.gastos_fijos, data.control_pagos, passFilter]);

  // ─── Métricas filtradas por unidad ────────────────────────────────────
  const arFiltrado = useMemo(() => {
    const list = processedAR.list.filter(c => passFilter((c.unidad || 'DLV').toUpperCase()));
    const pendientes = list.filter(c => !c.paid);
    return {
      list, pendientes,
      total: Num.round2(pendientes.reduce((s, c) => s + Num.parse(c.total), 0)),
      urgentes: pendientes.filter(c => getRiesgo(c.vencimiento, hoy).urgency >= 2),
    };
  }, [processedAR.list, passFilter, hoy]);

  const apFiltrado = useMemo(() => {
    const albs = processedAP.albs.filter((a: any) => passFilter(getBU(a)));
    const total = Num.round2(albs.reduce((s: number, a: any) => s + Num.parse(a.total || 0), 0));
    const urgentes = albs.filter((a: any) => getRiesgo(a.dueDate, hoy).urgency >= 2);
    return { albs, total, urgentes };
  }, [processedAP.albs, passFilter, hoy]);

  // ─── 🎯 Alerta descuadre Caja ↔ Banco (feature innovadora) ────────────
  const descuadreCajaBanco = useMemo(() => {
    const cierres = (data.cierres || []).filter((c: any) => passFilter(getBU(c)));
    const movs = (data.banco || []);
    const limite = addDays(todayISO(), -3); // cierres de hace 3+ días

    // Cierres sin movimiento banco correspondiente
    const sospechosos: any[] = [];
    cierres.forEach((c: any) => {
      if (!c.date || c.date > limite) return; // solo mirar los viejos
      if (c.conciliado_banco) return;
      // Busca movimiento banco en ventana ±2 días con importe similar al efectivo
      const efectivo = Num.parse(c.efectivo || 0);
      if (efectivo <= 0) return;
      const ventanaDesde = addDays(c.date, -1);
      const ventanaHasta = addDays(c.date, 3);
      const match = movs.find((m: any) =>
        m.date >= ventanaDesde && m.date <= ventanaHasta &&
        Math.abs(Num.parse(m.amount) - efectivo) < efectivo * 0.05 // 5% tolerancia
      );
      if (!match) sospechosos.push({ ...c, efectivo });
    });

    const totalDescuadre = Num.round2(sospechosos.reduce((s, c) => s + Num.parse(c.efectivo || 0), 0));
    return { sospechosos: sospechosos.slice(0, 5), count: sospechosos.length, totalDescuadre };
  }, [data.cierres, data.banco, passFilter]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔮 PREDICCIÓN DE TESORERÍA 90 DÍAS
  // ═══════════════════════════════════════════════════════════════════════════
  const prediccion90d = useMemo(() => {
    const hoyStr = todayISO();

    // 1. Saldo actual del banco
    const movsBanco = data.banco || [];
    const saldoActual = Num.round2(
      (Num.parse(data.config?.saldoInicial) || 0) +
      movsBanco
        .filter((b: any) => b.status === 'matched')
        .reduce((acc: number, b: any) => acc + (Num.parse(b.amount) || 0), 0)
    );

    // 2. Cobros esperados (facturas venta !paid + cobros B2B !paid)
    const cobrosEsperados: { fecha: string; importe: number; concepto: string; tipo: string }[] = [];
    (data.facturas || []).forEach((f: any) => {
      if (f.tipo !== 'venta' || f.paid || f.reconciled) return;
      const imp = Math.abs(Num.parse(f.total || 0));
      if (imp <= 0) return;
      cobrosEsperados.push({
        fecha: f.dueDate || addDays(f.date || hoyStr, 30),
        importe: imp,
        concepto: `Fac. ${f.num || '—'} — ${f.cliente || f.prov || 'Cliente'}`,
        tipo: 'factura_venta',
      });
    });
    ((data as any).cobros_b2b || []).forEach((c: any) => {
      if (c.paid) return;
      const imp = Math.abs(Num.parse(c.total || 0));
      if (imp <= 0) return;
      cobrosEsperados.push({
        fecha: c.vencimiento || addDays(c.fecha || hoyStr, 30),
        importe: imp,
        concepto: `${c.cliente} — ${c.concepto}`,
        tipo: 'cobro_b2b',
      });
    });

    // 3. Pagos esperados (albaranes !paid + facturas compra !paid + gastos fijos mensuales)
    const pagosEsperados: { fecha: string; importe: number; concepto: string; tipo: string }[] = [];
    (data.albaranes || []).forEach((a: any) => {
      if (a.paid || a.status === 'draft' || a.status === 'mismatch') return;
      const imp = Math.abs(Num.parse(a.total || 0));
      if (imp <= 0) return;
      pagosEsperados.push({
        fecha: a.dueDate || addDays(a.date || hoyStr, 30),
        importe: imp,
        concepto: `Alb. ${a.num || '—'} — ${a.prov || 'Prov.'}`,
        tipo: 'albaran',
      });
    });
    (data.facturas || []).forEach((f: any) => {
      if (f.tipo !== 'compra' || f.paid || f.reconciled) return;
      // Evitar duplicar con albaranes
      if ((f.albaranIdsArr || []).length > 0) return;
      const imp = Math.abs(Num.parse(f.total || 0));
      if (imp <= 0) return;
      pagosEsperados.push({
        fecha: f.dueDate || addDays(f.date || hoyStr, 30),
        importe: imp,
        concepto: `Fac. ${f.num || '—'} — ${f.prov || 'Prov.'}`,
        tipo: 'factura_compra',
      });
    });

    // Gastos fijos: proyectar 3 meses
    const gf = (data.gastos_fijos || []).filter((g: any) => g.active !== false && g.activo !== false && g.type !== 'income' && g.type !== 'grant');
    for (let m = 0; m < 3; m++) {
      const d = new Date();
      d.setMonth(d.getMonth() + m + 1, 1);
      const fechaPago = safeISODateLocal(d);
      gf.forEach((g: any) => {
        const imp = Math.abs(Num.parse(g.amount ?? g.importe ?? 0));
        if (imp <= 0) return;
        pagosEsperados.push({
          fecha: fechaPago,
          importe: imp,
          concepto: `GF: ${g.name || g.nombre || 'Gasto fijo'}`,
          tipo: 'gasto_fijo',
        });
      });
    }

    // 4. Ingresos recurrentes estimados (media de cierres últimos 30 días × 90)
    const hace30 = addDays(hoyStr, -30);
    const cierresRecientes = (data.cierres || []).filter((c: any) => c.date && c.date >= hace30 && c.date <= hoyStr);
    const mediaDiaria = cierresRecientes.length > 0
      ? Num.round2(cierresRecientes.reduce((s: number, c: any) => s + Num.parse((c as any).totalVenta ?? c.totalVentas ?? 0), 0) / Math.max(cierresRecientes.length, 1))
      : 0;

    // 5. Proyectar día a día los próximos 90 días
    const limite90 = addDays(hoyStr, 90);
    const timeline: { fecha: string; saldo: number; entradas: number; salidas: number; label: string }[] = [];
    let saldoAcum = saldoActual;

    // Filtrar cobros/pagos dentro de la ventana 90d
    const cobros90 = cobrosEsperados.filter(c => c.fecha >= hoyStr && c.fecha <= limite90);
    const pagos90 = pagosEsperados.filter(p => p.fecha >= hoyStr && p.fecha <= limite90);

    // Semana a semana (13 semanas = ~90 días)
    for (let w = 0; w < 13; w++) {
      const semStart = addDays(hoyStr, w * 7);
      const semEnd = addDays(hoyStr, (w + 1) * 7 - 1);

      const entCobros = cobros90
        .filter(c => c.fecha >= semStart && c.fecha <= semEnd)
        .reduce((s, c) => s + c.importe, 0);
      const salPagos = pagos90
        .filter(p => p.fecha >= semStart && p.fecha <= semEnd)
        .reduce((s, p) => s + p.importe, 0);

      // Ingresos estimados de caja (media diaria × 7 días laborables ~5.5)
      const ingCaja = Num.round2(mediaDiaria * 5.5);

      const entradas = Num.round2(entCobros + ingCaja);
      const salidas = Num.round2(salPagos);
      saldoAcum = Num.round2(saldoAcum + entradas - salidas);

      timeline.push({
        fecha: semStart,
        saldo: saldoAcum,
        entradas,
        salidas,
        label: `Sem ${w + 1}`,
      });
    }

    // Resumen por mes
    const mes30 = timeline.slice(0, 4);
    const mes60 = timeline.slice(4, 9);
    const mes90 = timeline.slice(9, 13);
    const saldo30 = mes30[mes30.length - 1]?.saldo ?? saldoActual;
    const saldo60 = mes60[mes60.length - 1]?.saldo ?? saldo30;
    const saldo90 = mes90[mes90.length - 1]?.saldo ?? saldo60;

    const totalCobros = Num.round2(cobros90.reduce((s, c) => s + c.importe, 0));
    const totalPagos = Num.round2(pagos90.reduce((s, p) => s + p.importe, 0));
    const ingCajaEstimado = Num.round2(mediaDiaria * 5.5 * 13);

    // Alertas
    const alertas: string[] = [];
    const saldoMin = Math.min(...timeline.map(t => t.saldo));
    if (saldoMin < 0) alertas.push(`⚠️ Saldo negativo previsto (${Num.fmt(saldoMin)}) — necesitas financiación o adelantar cobros`);
    if (saldoMin < 3000 && saldoMin >= 0) alertas.push(`🟡 Saldo bajo previsto (${Num.fmt(saldoMin)}) — ten cuidado con gastos extra`);
    if (totalPagos > totalCobros + ingCajaEstimado) alertas.push('🔴 Los pagos previstos superan los cobros — revisa prioridades');
    const provConc = pagos90.filter(p => p.tipo === 'albaran' || p.tipo === 'factura_compra');
    if (provConc.length > 0) {
      const porProv: Record<string, number> = {};
      provConc.forEach(p => {
        const prov = p.concepto.split('—')[1]?.trim() || 'Varios';
        porProv[prov] = (porProv[prov] || 0) + p.importe;
      });
      const maxProv = Object.entries(porProv).sort(([, a], [, b]) => b - a)[0];
      if (maxProv && maxProv[1] > totalPagos * 0.3) {
        alertas.push(`📊 ${maxProv[0]} concentra ${Num.round2((maxProv[1] / totalPagos) * 100)}% de pagos (${Num.fmt(maxProv[1])})`);
      }
    }

    return {
      saldoActual, saldo30, saldo60, saldo90, saldoMin,
      timeline, cobros90, pagos90,
      totalCobros, totalPagos, ingCajaEstimado, mediaDiaria,
      alertas,
    };
  }, [data]);

  // Meta por unidad de negocio
  const BU_META: Record<string, { label: string; color: string; icon: any }> = {
    ALL:  { label: 'Todo',         color: 'bg-slate-800 text-white',       icon: Filter     },
    REST: { label: 'Restaurante',  color: 'bg-indigo-500 text-white',      icon: Utensils   },
    SHOP: { label: 'Tienda Sakes', color: 'bg-amber-500 text-white',       icon: ShoppingBag },
    DLV:  { label: 'B2B Hoteles',  color: 'bg-purple-500 text-white',      icon: Hotel      },
    CORP: { label: 'Corporativo',  color: 'bg-slate-500 text-white',       icon: Building2  },
  };

  // ─── Handlers AP ──────────────────────────────────────────────────────────
  const handlePagar = useCallback(async (id: string) => {
    // Buscar en albaranes O en facturas de compra
    const alb = (data.albaranes || []).find(x => x.id === id);
    const fac = !alb ? (data.facturas || []).find((x: any) => x.id === id && x.tipo === 'compra') : null;
    const doc: any = alb || fac;
    if (!doc) return;

    const isFactura = !!fac;
    const prov = doc.prov || 'Proveedor';
    const ref = doc.num || doc.numero || '—';
    const amount = -Math.abs(Num.parse(doc.total || 0));

    const ok = await confirm({
      title: `Pagar a ${prov}`,
      message: `Se registrará un pago de ${Num.fmt(Math.abs(amount))} en el Banco.\n(${isFactura ? 'Factura' : 'Albarán'} ${ref})`,
      confirmLabel: 'Confirmar pago',
    });
    if (!ok) return;
    setSavingId(id);
    try {
      const newData: AppData = {
        ...data,
        albaranes: [...(data.albaranes || [])],
        facturas: [...(data.facturas || [])],
        banco: [...(data.banco || [])],
      };

      if (isFactura) {
        const idx = newData.facturas!.findIndex((x: any) => x.id === id);
        if (idx !== -1) newData.facturas![idx] = { ...newData.facturas![idx], paid: true };
      } else {
        const idx = newData.albaranes!.findIndex(x => x.id === id);
        if (idx !== -1) newData.albaranes![idx] = { ...newData.albaranes![idx], paid: true };
      }

      const linkType = isFactura ? 'FACTURA' : 'ALBARAN';
      const alreadyExists = (data.banco || []).some(m =>
        (m as any).linkType === linkType && (m as any).linkId === id
      );
      if (!alreadyExists) {
        newData.banco!.unshift({
          id: newId('mov'), date: todayISO(),
          desc: `Pago ${prov} (${isFactura ? 'Fac' : 'Alb'}: ${ref})`,
          amount: Num.round2(amount), status: 'matched',
          linkType, linkId: doc.id,
          category: 'Pago Proveedores',
        } as any);
      }
      await onSave(newData);
      toast.success(`Pago a ${prov} registrado`);
    } finally { setSavingId(null); }
  }, [data, onSave]);

  // ─── Handlers AR ──────────────────────────────────────────────────────────
  const handleCobrarB2B = useCallback(async (id: string) => {
    const cobro = cobrosB2B.find(c => c.id === id);
    if (!cobro) return;
    const ok = await confirm({
      title: `Cobrar a ${cobro.cliente}`,
      message: `${cobro.concepto} — ${Num.fmt(cobro.total)}`,
      confirmLabel: 'Confirmar cobro',
    });
    if (!ok) return;
    setSavingId(id);
    try {
      const updated = cobrosB2B.map(c => c.id === id ? { ...c, paid: true } : c);
      const newBanco = [...(data.banco || [])];
      const alreadyExists = newBanco.some(m => (m as any).linkType === 'COBRO_B2B' && (m as any).linkId === id);
      if (!alreadyExists) {
        newBanco.unshift({
          id: newId('mov'), date: todayISO(),
          desc: `Cobro ${cobro.cliente} — ${cobro.concepto}`,
          amount: Num.round2(cobro.total), status: 'matched',
          linkType: 'COBRO_B2B', linkId: id, category: 'Ingreso B2B',
        } as any);
      }
      await onSave({ ...data, cobros_b2b: updated, banco: newBanco } as any);
      toast.success(`Cobro de ${cobro.cliente} registrado`);
    } finally { setSavingId(null); }
  }, [cobrosB2B, data, onSave]);

  const handleDeleteCobro = useCallback(async (id: string) => {
    const ok = await confirm({ title: '¿Eliminar este cobro?', danger: true });
    if (!ok) return;
    await saveCobros(cobrosB2B.filter(c => c.id !== id));
    toast.success('Cobro eliminado');
  }, [cobrosB2B, saveCobros]);

  // ─── Formulario ───────────────────────────────────────────────────────────
  const openAdd = () => { setEditingCobro(null); setForm(emptyForm()); setShowAddModal(true); };
  const openEdit = (c: CobroB2B) => {
    setEditingCobro(c);
    setForm({ tipo: c.tipo, cliente: c.cliente, concepto: c.concepto, total: c.total,
      base: c.base, iva: c.iva, fecha: c.fecha, vencimiento: c.vencimiento,
      numFactura: c.numFactura, notas: c.notas, unidad: c.unidad });
    setShowAddModal(true);
  };
  const handleSaveCobro = async () => {
    if (!form.cliente || !form.total) {
      toast.warning('Cliente e importe son obligatorios');
      return;
    }
    if (editingCobro) {
      await saveCobros(cobrosB2B.map(c => c.id === editingCobro.id ? { ...editingCobro, ...form } : c));
    } else {
      await saveCobros([...cobrosB2B, { id: newId('b2b'), paid: false, ...form }]);
    }
    setShowAddModal(false);
    toast.success(editingCobro ? 'Cobro actualizado' : 'Cobro añadido');
  };

  // ─── Importar Bilty CSV ───────────────────────────────────────────────────
  const handleBiltyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const rows = parseCSVRows(ev.target?.result as string);
        if (!rows.length) { toast.error('CSV vacío o formato incorrecto'); return; }
        const mapped: CobroB2B[] = rows.map(r => {
          const total = parseFloat((r['total'] || r['importe'] || r['amount'] || '0').replace(',', '.')) || 0;
          const base  = parseFloat((r['base'] || '0').replace(',', '.')) || Num.round2(total / 1.10);
          const fecha = (r['fecha'] || r['date'] || todayISO()).slice(0, 10).replace(/\//g, '-').split('-').length === 3
            ? (r['fecha'] || r['date'] || todayISO()).includes('/') ? (r['fecha'] || r['date']).split('/').reverse().join('-') : (r['fecha'] || r['date'] || todayISO()).slice(0, 10)
            : todayISO();
          return {
            id: newId('blt'), tipo: 'bilty' as CobroTipo,
            cliente: r['cliente'] || r['customer'] || '—',
            concepto: r['concepto'] || r['descripcion'] || 'Factura importada',
            total, base, iva: Num.round2(total - base),
            fecha, vencimiento: addDays(fecha, 30),
            paid: (r['estado'] || '').toLowerCase().includes('pag'),
            numFactura: r['nº factura'] || r['numero factura'] || '',
            notas: r['notas'] || '', unidad: 'DLV',
          };
        }).filter(c => c.total > 0);
        setBiltyPreview(mapped);
        toast.success(`${mapped.length} facturas detectadas — revisa y confirma`);
      } catch { toast.error('Error al procesar el CSV'); }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const confirmBiltyImport = async () => {
    if (!biltyPreview) return;
    const existingNums = new Set(cobrosB2B.filter(c => c.numFactura).map(c => c.numFactura));
    const nuevos = biltyPreview.filter(c => !c.numFactura || !existingNums.has(c.numFactura));
    await saveCobros([...cobrosB2B, ...nuevos]);
    setBiltyPreview(null);
    setShowBiltyPanel(false);
    toast.success(`${nuevos.length} facturas importadas`);
  };

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-slate-50 pb-24">

      {/* ── CABECERA ──────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-100 px-4 md:px-6 pt-6 pb-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2.5">
                <BadgeEuro className="w-6 h-6 text-indigo-500" />
                Tesorería 360°
              </h1>
              <p className="text-xs text-slate-400 font-medium mt-0.5">Caja · Cobros · Pagos · Nóminas — unificado por unidad</p>
            </div>

            {/* 🆕 Filtro por unidad de negocio */}
            <div className="flex gap-1 flex-wrap mt-1">
              {(['ALL','REST','SHOP','DLV','CORP'] as const).map(k => {
                const m = BU_META[k];
                const Ic = m.icon;
                const active = unitFilter === k;
                return (
                  <button key={k} onClick={() => setUnitFilter(k)}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all',
                      active ? m.color + ' shadow-md scale-105' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    )}>
                    <Ic className="w-3 h-3" />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mb-4" />

          {/* ── TABS ─────────────────────────────────────────────────────── */}
          <div className="flex gap-0">
            {([
              { key: 'dashboard', label: 'Resumen',  icon: Zap },
              { key: 'cobrar',    label: `Cobrar (${processedAR.pendientesCount})`, icon: TrendingUp },
              { key: 'pagar',     label: `Pagar (${processedAP.albs.length})`,     icon: TrendingDown },
              { key: 'prediccion', label: 'Previsión 90d', icon: Calendar },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all',
                  activeTab === t.key
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                )}>
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-6 pt-5 space-y-4">

        <AnimatePresence mode="wait">

          {/* ════════════════════════════════════════════════════════════════
              TAB DASHBOARD — RESUMEN DEL DÍA
          ════════════════════════════════════════════════════════════════ */}
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

              {/* KPI row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Posición neta */}
                <div className={cn(
                  'rounded-2xl p-4 col-span-2 md:col-span-1 flex flex-col gap-1',
                  posicionNeta >= 0 ? 'bg-emerald-600' : 'bg-rose-600'
                )}>
                  <span className="text-[9px] font-black text-white/60 uppercase tracking-widest">Posición neta</span>
                  <span className="text-2xl font-black text-white tabular-nums">
                    {posicionNeta >= 0 ? '+' : ''}{Num.fmt(posicionNeta)}
                  </span>
                  <span className="text-[9px] text-white/50">Cobrar − Pagar</span>
                </div>
                {/* Por cobrar */}
                <div className="bg-white rounded-2xl p-4 border border-slate-100 flex flex-col gap-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Por cobrar</span>
                  <span className="text-xl font-black text-emerald-600 tabular-nums">{Num.fmt(processedAR.total)}</span>
                  <span className="text-[9px] text-slate-400">{processedAR.pendientesCount} facturas B2B</span>
                </div>
                {/* Por pagar */}
                <div className="bg-white rounded-2xl p-4 border border-slate-100 flex flex-col gap-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Por pagar</span>
                  <span className="text-xl font-black text-rose-500 tabular-nums">{Num.fmt(processedAP.total)}</span>
                  <span className="text-[9px] text-slate-400">{processedAP.albs.length} docs pendientes {currentYear}</span>
                </div>
                {/* Saldo banco */}
                <button onClick={() => onNavigate?.('banco')}
                  className="bg-slate-800 hover:bg-slate-700 rounded-2xl p-4 border border-slate-700 flex flex-col gap-1 text-left transition-all group">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Saldo banco</span>
                    <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                  </div>
                  <span className={cn('text-xl font-black tabular-nums', saldoBanco >= 0 ? 'text-white' : 'text-rose-400')}>
                    {Num.fmt(saldoBanco)}
                  </span>
                  <span className="text-[9px] text-slate-500 group-hover:text-indigo-400 transition-colors">Ver módulo →</span>
                </button>
              </div>

              {/* 🆕 CAJA 360 — Cierres Z de hoy/semana/mes + filtrado por unidad */}
              <div className="bg-white border border-slate-100 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <CircleDollarSign className="w-3 h-3 text-indigo-500"/> Caja diaria
                    {unitFilter !== 'ALL' && (
                      <span className="text-[9px] text-indigo-500 normal-case">· {BU_META[unitFilter].label}</span>
                    )}
                  </p>
                  <button onClick={() => onNavigate?.('cash')}
                    className="text-[9px] font-black text-indigo-500 hover:underline flex items-center gap-0.5">
                    Ver cierres <ChevronRight className="w-3 h-3"/>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className={cn('rounded-xl p-3', cajaDiaria.hoyExiste ? 'bg-indigo-50 border border-indigo-100' : 'bg-slate-50 border border-dashed border-slate-200')}>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Hoy</p>
                    <p className="text-lg font-black text-indigo-600 tabular-nums">{Num.fmt(cajaDiaria.hoyVal)}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{cajaDiaria.hoyExiste ? 'Cerrado' : 'Pendiente'}</p>
                  </div>
                  <div className="rounded-xl p-3 bg-slate-50 border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Semana</p>
                    <p className="text-lg font-black text-slate-700 tabular-nums">{Num.fmt(cajaDiaria.semanaVal)}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{cajaDiaria.semanaN} cierres</p>
                  </div>
                  <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-100">
                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Mes</p>
                    <p className="text-lg font-black text-emerald-700 tabular-nums">{Num.fmt(cajaDiaria.mesVal)}</p>
                    <p className="text-[9px] text-emerald-500 mt-0.5">{cajaDiaria.mesN} cierres</p>
                  </div>
                </div>
                {Math.abs(cajaDiaria.descuadreMes) > 1 && (
                  <div className={cn('mt-2 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5',
                    cajaDiaria.descuadreMes < 0 ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600')}>
                    <AlertTriangle className="w-3 h-3"/>
                    <span className="text-[10px] font-black">
                      Descuadre acumulado mes: {Num.fmt(cajaDiaria.descuadreMes)}
                    </span>
                  </div>
                )}
              </div>

              {/* 🆕 NÓMINAS & GASTOS FIJOS — panel integrado */}
              {(gastosFijosPanel.nominas.length > 0 || gastosFijosPanel.suministros.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white border border-slate-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                      <UsersIcon className="w-3 h-3 text-fuchsia-500"/> Nóminas mes
                    </p>
                    <p className="text-xl font-black text-fuchsia-600 tabular-nums">{Num.fmt(gastosFijosPanel.nominasTotal)}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{gastosFijosPanel.nominas.length} empleados</p>
                    {gastosFijosPanel.nominasPend.length > 0 && (
                      <p className="text-[10px] font-black text-rose-500 mt-2">
                        Pendiente: {Num.fmt(gastosFijosPanel.nominasPendVal)}
                      </p>
                    )}
                  </div>
                  <div className="bg-white border border-slate-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                      <Wallet className="w-3 h-3 text-cyan-500"/> Gastos fijos
                    </p>
                    <p className="text-xl font-black text-cyan-600 tabular-nums">{Num.fmt(gastosFijosPanel.suministrosTotal)}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{gastosFijosPanel.suministros.length} conceptos</p>
                    {gastosFijosPanel.suministrosPend.length > 0 && (
                      <p className="text-[10px] font-black text-rose-500 mt-2">
                        Pendiente: {Num.fmt(gastosFijosPanel.suministrosPendVal)}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 🎯 ALERTA DESCUADRE CAJA ↔ BANCO — feature innovadora */}
              {descuadreCajaBanco.count > 0 && (
                <div className="bg-gradient-to-br from-rose-50 to-orange-50 border-2 border-rose-200 rounded-2xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-[10px] font-black text-rose-700 uppercase tracking-widest flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5"/> Efectivo sin llegar al banco
                      </p>
                      <p className="text-lg font-black text-rose-700 tabular-nums mt-0.5">
                        {Num.fmt(descuadreCajaBanco.totalDescuadre)}
                      </p>
                      <p className="text-[10px] text-rose-500 mt-0.5">
                        {descuadreCajaBanco.count} cierre(s) con efectivo no conciliado en banco (+3 días)
                      </p>
                    </div>
                    <button onClick={() => onNavigate?.('banco')}
                      className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-[10px] font-black hover:bg-rose-700 transition flex items-center gap-1">
                      Revisar <ChevronRight className="w-3 h-3"/>
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {descuadreCajaBanco.sospechosos.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-rose-100">
                        <div className="min-w-0">
                          <p className="text-[11px] font-black text-slate-800">{c.date}</p>
                          <p className="text-[9px] text-slate-400">{getBU(c)} · Efectivo sin conciliar</p>
                        </div>
                        <span className="text-xs font-black text-rose-600 tabular-nums">{Num.fmt(c.efectivo)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Urgentes cobrar */}
              {processedAR.urgentes.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" /> Cobros urgentes
                  </p>
                  <div className="space-y-2">
                    {processedAR.urgentes.slice(0, 3).map(c => (
                      <div key={c.id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-emerald-100">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-800 truncate">{c.cliente}</p>
                          <p className="text-[10px] text-slate-400 truncate">{c.concepto}</p>
                        </div>
                        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                          <UrgencyPill fecha={c.vencimiento} hoy={hoy} />
                          <span className="text-sm font-black text-emerald-700 tabular-nums">{Num.fmt(c.total)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setActiveTab('cobrar')}
                    className="mt-2 text-[10px] font-black text-emerald-600 flex items-center gap-1 hover:gap-2 transition-all">
                    Ver todos los cobros <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Urgentes pagar */}
              {processedAP.urgentes.length > 0 && (
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4">
                  <p className="text-[10px] font-black text-rose-700 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" /> Pagos urgentes
                  </p>
                  <div className="space-y-2">
                    {processedAP.urgentes.slice(0, 3).map((alb: any) => (
                      <div key={alb.id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-rose-100">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-800 truncate">{alb.prov || 'Proveedor'}</p>
                          <p className="text-[10px] text-slate-400">Ref: {alb.num || '—'}</p>
                        </div>
                        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                          <UrgencyPill fecha={alb.dueDate} hoy={hoy} />
                          <span className="text-sm font-black text-rose-600 tabular-nums">{Num.fmt(Num.parse(alb.total || 0))}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setActiveTab('pagar')}
                    className="mt-2 text-[10px] font-black text-rose-600 flex items-center gap-1 hover:gap-2 transition-all">
                    Ver todos los pagos <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Top proveedores con deuda */}
              {processedAP.topProvs.length > 0 && (
                <div className="bg-white border border-slate-100 rounded-2xl p-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Proveedores pendientes</p>
                  <div className="space-y-2">
                    {processedAP.topProvs.map(([prov, info]) => (
                      <div key={prov} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                            info.urgency >= 3 ? 'bg-rose-500' : info.urgency >= 2 ? 'bg-amber-500' : 'bg-slate-300'
                          )} />
                          <span className="text-xs font-bold text-slate-700 truncate">{prov}</span>
                          <span className="text-[10px] text-slate-400 flex-shrink-0">{info.count} doc.</span>
                        </div>
                        <span className="text-sm font-black text-slate-800 tabular-nums ml-3 flex-shrink-0">{Num.fmt(info.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Estado limpio */}
              {processedAR.urgentes.length === 0 && processedAP.urgentes.length === 0 && (
                <div className="bg-white border border-[color:var(--arume-gray-100)] rounded-2xl">
                  <EmptyState
                    icon={CheckCircle2}
                    eyebrow="Buenas noticias"
                    title="Todo al día"
                    message="No hay cobros ni pagos urgentes esta semana."
                    size="sm"
                  />
                </div>
              )}

            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              TAB COBRAR — AR
          ════════════════════════════════════════════════════════════════ */}
          {activeTab === 'cobrar' && (
            <motion.div key="cobrar" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">

              {/* Acciones */}
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <div className="flex gap-2">
                  <button onClick={openAdd}
                    className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition shadow-sm">
                    <Plus className="w-3.5 h-3.5" /> Nuevo cobro
                  </button>
                  <button onClick={() => setShowBiltyPanel(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition">
                    <Upload className="w-3.5 h-3.5" /> Importar Bilty
                  </button>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                  <input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} className="rounded accent-indigo-600" />
                  Mostrar cobrados
                </label>
              </div>

              {/* Panel Bilty */}
              <AnimatePresence>
                {showBiltyPanel && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 overflow-hidden space-y-3">
                    <p className="text-xs font-black text-indigo-700 flex items-center gap-2">
                      <ReceiptText className="w-4 h-4" /> Importar CSV de Bilty
                    </p>
                    <p className="text-[10px] text-indigo-500 leading-relaxed">
                      Columnas: <code className="bg-indigo-100 px-1 rounded">fecha, cliente, concepto, total, base, iva, nº factura, estado</code>
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <input ref={biltyRef} type="file" accept=".csv,.txt" onChange={handleBiltyFile} className="hidden" />
                      <button onClick={() => biltyRef.current?.click()}
                        className="px-3 py-2 bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] rounded-xl text-xs font-black hover:bg-[color:var(--arume-gray-700)] transition flex items-center gap-1.5">
                        <Upload className="w-3.5 h-3.5" /> Seleccionar CSV
                      </button>
                      {biltyPreview && (
                        <button onClick={confirmBiltyImport}
                          className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar {biltyPreview.length} facturas
                        </button>
                      )}
                    </div>
                    {biltyPreview && biltyPreview.slice(0, 5).map(c => (
                      <div key={c.id} className="flex items-center justify-between bg-white px-3 py-2 rounded-xl border border-indigo-100 text-xs">
                        <span className="font-bold text-slate-700 truncate max-w-[160px]">{c.cliente}</span>
                        <span className="font-black text-indigo-600 tabular-nums">{Num.fmt(c.total)}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Lista */}
              {processedAR.list.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-12 flex flex-col items-center text-slate-400">
                  <ReceiptText className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm font-black">Sin cobros pendientes</p>
                  <p className="text-xs mt-1 text-center max-w-xs">Añade facturas B2B manualmente o importa el CSV de Bilty.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {processedAR.list.map(cobro => {
                      const cfg = TIPO_CONFIG[cobro.tipo];
                      const Icon = cfg.icon;
                      return (
                        <motion.div key={cobro.id} layout initial={{ opacity: 0 }} animate={{ opacity: cobro.paid ? 0.5 : 1 }} exit={{ opacity: 0 }}
                          className="bg-white rounded-2xl border border-slate-100 p-4 flex items-center gap-3 hover:border-emerald-200 transition-all">
                          {/* Icono tipo */}
                          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', cfg.bg)}>
                            <Icon className={cn('w-4 h-4', cfg.color)} />
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-black text-slate-800 truncate">{cobro.cliente}</p>
                              {cobro.paid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                            </div>
                            <p className="text-[11px] text-slate-400 truncate">{cobro.concepto}</p>
                          </div>
                          {/* Importe + vencimiento */}
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-black text-slate-800 tabular-nums">{Num.fmt(cobro.total)}</p>
                            <UrgencyPill fecha={cobro.vencimiento} hoy={hoy} />
                          </div>
                          {/* Acciones */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => openEdit(cobro)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition">
                              <Edit3 className="w-3 h-3 text-slate-500" />
                            </button>
                            {!cobro.paid && (
                              <button onClick={() => handleCobrarB2B(cobro.id)} disabled={savingId === cobro.id}
                                className="w-7 h-7 rounded-lg bg-emerald-100 hover:bg-emerald-200 flex items-center justify-center transition">
                                {savingId === cobro.id ? <Loader2 className="w-3 h-3 animate-spin text-emerald-600" /> : <ArrowDownRight className="w-3 h-3 text-emerald-600" />}
                              </button>
                            )}
                            <button onClick={() => handleDeleteCobro(cobro.id)} className="w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 flex items-center justify-center transition">
                              <Trash2 className="w-3 h-3 text-rose-400" />
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              TAB PAGAR — AP
          ════════════════════════════════════════════════════════════════ */}
          {activeTab === 'pagar' && (
            <motion.div key="pagar" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">

              {/* Acceso banco */}
              <button onClick={() => onNavigate?.('banco')}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-2xl px-4 py-3 flex items-center justify-between transition-all group">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-indigo-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Landmark className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-black text-white">Ir al módulo Banco</p>
                    <p className="text-[10px] text-slate-400">Saldo confirmado: {Num.fmt(saldoBanco)}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
              </button>

              {processedAP.albs.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-12 flex flex-col items-center text-slate-400">
                  <CheckCircle2 className="w-10 h-10 mb-3 opacity-30 text-emerald-500" />
                  <p className="text-sm font-black text-slate-600">Sin deudas pendientes en 2026</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {processedAP.albs.map((alb: any) => (
                      <motion.div key={alb.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="bg-white rounded-2xl border border-slate-100 p-4 flex items-center gap-3 hover:border-rose-200 transition-all">
                        {/* Icono */}
                        <div className={`w-9 h-9 ${alb._tipo === 'factura' ? 'bg-orange-50' : 'bg-rose-50'} rounded-xl flex items-center justify-center flex-shrink-0`}>
                          <FileText className={`w-4 h-4 ${alb._tipo === 'factura' ? 'text-orange-500' : 'text-rose-500'}`} />
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-black text-slate-800 truncate">{alb.prov || 'Proveedor'}</p>
                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${alb._tipo === 'factura' ? 'bg-orange-100 text-orange-600' : 'bg-rose-100 text-rose-600'}`}>
                              {alb._tipo === 'factura' ? 'FAC' : 'ALB'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">Ref: {alb.num || alb.numero || '—'} · {alb.date}</p>
                        </div>
                        {/* Importe + vencimiento */}
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-black text-slate-800 tabular-nums">{Num.fmt(Num.parse(alb.total || 0))}</p>
                          <UrgencyPill fecha={alb.dueDate} hoy={hoy} />
                        </div>
                        {/* Pagar */}
                        <button onClick={() => handlePagar(alb.id)} disabled={savingId === alb.id}
                          className="w-8 h-8 rounded-xl bg-rose-100 hover:bg-rose-200 flex items-center justify-center transition flex-shrink-0">
                          {savingId === alb.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" /> : <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />}
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              🔮 PREDICCIÓN DE TESORERÍA 90 DÍAS
              ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'prediccion' && (
            <motion.div key="prediccion" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="space-y-3">

              {/* Saldo proyectado: 3 hitos */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-white rounded-2xl border border-slate-100 p-3 shadow-sm">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Hoy</p>
                  <p className="text-lg font-black text-slate-800 tabular-nums">{Num.fmt(prediccion90d.saldoActual)}</p>
                  <p className="text-[9px] text-slate-400 font-bold">Saldo banco</p>
                </div>
                {[
                  { label: '30 días', val: prediccion90d.saldo30 },
                  { label: '60 días', val: prediccion90d.saldo60 },
                  { label: '90 días', val: prediccion90d.saldo90 },
                ].map((h, i) => (
                  <div key={i} className={cn('rounded-2xl border p-3 shadow-sm',
                    h.val < 0 ? 'bg-rose-50 border-rose-200' : h.val < 3000 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200')}>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{h.label}</p>
                    <p className={cn('text-lg font-black tabular-nums',
                      h.val < 0 ? 'text-rose-600' : h.val < 3000 ? 'text-amber-600' : 'text-emerald-700')}>
                      {Num.fmt(h.val)}
                    </p>
                    <p className={cn('text-[9px] font-bold',
                      h.val < prediccion90d.saldoActual ? 'text-rose-500' : 'text-emerald-500')}>
                      {h.val >= prediccion90d.saldoActual ? '+' : ''}{Num.fmt(Num.round2(h.val - prediccion90d.saldoActual))}
                    </p>
                  </div>
                ))}
              </div>

              {/* Alertas */}
              {prediccion90d.alertas.length > 0 && (
                <div className="space-y-1.5">
                  {prediccion90d.alertas.map((a, i) => (
                    <div key={i} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs font-bold text-amber-800 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Flujos resumen */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded-2xl border border-slate-100 p-3 shadow-sm">
                  <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Cobros esperados</p>
                  <p className="text-base font-black text-emerald-600 tabular-nums">{Num.fmt(prediccion90d.totalCobros)}</p>
                  <p className="text-[9px] text-slate-400">{prediccion90d.cobros90.length} documentos</p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-3 shadow-sm">
                  <p className="text-[8px] font-black text-indigo-500 uppercase tracking-widest">Ingresos caja est.</p>
                  <p className="text-base font-black text-indigo-600 tabular-nums">{Num.fmt(prediccion90d.ingCajaEstimado)}</p>
                  <p className="text-[9px] text-slate-400">Media: {Num.fmt(prediccion90d.mediaDiaria)}/día</p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-3 shadow-sm">
                  <p className="text-[8px] font-black text-rose-500 uppercase tracking-widest">Pagos previstos</p>
                  <p className="text-base font-black text-rose-600 tabular-nums">{Num.fmt(prediccion90d.totalPagos)}</p>
                  <p className="text-[9px] text-slate-400">{prediccion90d.pagos90.length} docs + G.Fijos</p>
                </div>
              </div>

              {/* Timeline semanal */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Evolución semanal del saldo</p>
                <div className="space-y-1.5">
                  {prediccion90d.timeline.map((t, i) => {
                    const maxSaldo = Math.max(...prediccion90d.timeline.map(x => Math.abs(x.saldo)), 1);
                    const pct = Math.min(Math.abs(t.saldo) / maxSaldo * 100, 100);
                    const isNeg = t.saldo < 0;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[9px] font-black text-slate-400 w-12 flex-shrink-0">{t.label}</span>
                        <div className="flex-1 h-4 bg-slate-50 rounded-full overflow-hidden relative">
                          <div className={cn('h-full rounded-full transition-all',
                            isNeg ? 'bg-rose-400' : t.saldo < 3000 ? 'bg-amber-400' : 'bg-emerald-400')}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <div className="w-20 text-right flex-shrink-0">
                          <span className={cn('text-[10px] font-black tabular-nums',
                            isNeg ? 'text-rose-600' : t.saldo < 3000 ? 'text-amber-600' : 'text-slate-800')}>
                            {Num.fmt(t.saldo)}
                          </span>
                        </div>
                        <div className="w-28 flex-shrink-0 hidden md:flex gap-1.5 justify-end">
                          <span className="text-[8px] text-emerald-500 font-bold tabular-nums">+{Num.fmt(t.entradas)}</span>
                          <span className="text-[8px] text-rose-500 font-bold tabular-nums">-{Num.fmt(t.salidas)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Próximos cobros y pagos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Próximos cobros */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                  <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2">Próximos cobros</p>
                  {prediccion90d.cobros90.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">Sin cobros pendientes</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {[...prediccion90d.cobros90].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 8).map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="text-[9px] text-slate-400 w-16 flex-shrink-0">{c.fecha.slice(5)}</span>
                          <span className="flex-1 truncate text-slate-700 font-bold">{c.concepto}</span>
                          <span className="text-emerald-600 font-black tabular-nums flex-shrink-0">+{Num.fmt(c.importe)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Próximos pagos */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                  <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-2">Próximos pagos</p>
                  {prediccion90d.pagos90.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">Sin pagos pendientes</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {[...prediccion90d.pagos90].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 8).map((p, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="text-[9px] text-slate-400 w-16 flex-shrink-0">{p.fecha.slice(5)}</span>
                          <span className="flex-1 truncate text-slate-700 font-bold">{p.concepto}</span>
                          <span className="text-rose-600 font-black tabular-nums flex-shrink-0">-{Num.fmt(p.importe)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800">
                <p className="font-black mb-1">🔮 ¿Cómo funciona la previsión?</p>
                <ul className="space-y-0.5 text-[11px] text-blue-700">
                  <li>• <b>Saldo actual</b>: movimientos conciliados en el banco</li>
                  <li>• <b>Cobros</b>: facturas de venta + cobros B2B sin cobrar</li>
                  <li>• <b>Pagos</b>: albaranes/facturas sin pagar + gastos fijos × 3 meses</li>
                  <li>• <b>Ingresos caja</b>: estimados con la media de cierres Z de los últimos 30 días</li>
                  <li>• Los datos reales sustituyen estimados conforme pasan los días</li>
                </ul>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── MODAL NUEVO / EDITAR COBRO ──────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false); }}>
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-800">{editingCobro ? 'Editar cobro' : 'Nuevo cobro B2B'}</h3>
                <button onClick={() => setShowAddModal(false)} className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center transition">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              {/* Tipo */}
              <div className="flex gap-2">
                {(Object.keys(TIPO_CONFIG) as CobroTipo[]).map(t => {
                  const cfg = TIPO_CONFIG[t];
                  const Icon = cfg.icon;
                  return (
                    <button key={t} onClick={() => setForm(f => ({ ...f, tipo: t }))}
                      className={cn('flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-black transition',
                        form.tipo === t ? `${cfg.bg} ${cfg.color} border-current` : 'border-slate-100 text-slate-400 hover:border-slate-200'
                      )}>
                      <Icon className="w-4 h-4" />
                      <span className="text-[9px]">{cfg.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Campos */}
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Cliente *</label>
                  <input value={form.cliente} onChange={e => setForm(f => ({ ...f, cliente: e.target.value }))}
                    placeholder="Nombre del cliente" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 transition" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Concepto</label>
                  <input value={form.concepto} onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))}
                    placeholder="Descripción del servicio" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 transition" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Total (€) *</label>
                    <input type="number" step="0.01" value={form.total || ''} onChange={e => {
                      const t = parseFloat(e.target.value) || 0;
                      setForm(f => ({ ...f, total: t, base: Num.round2(t / 1.10), iva: Num.round2(t - Num.round2(t / 1.10)) }));
                    }} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 transition" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Nº Factura</label>
                    <input value={form.numFactura || ''} onChange={e => setForm(f => ({ ...f, numFactura: e.target.value }))}
                      placeholder="F2026-001" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 transition" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Fecha emisión</label>
                    <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value, vencimiento: addDays(e.target.value, 30) }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 transition" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Vencimiento</label>
                    <input type="date" value={form.vencimiento} onChange={e => setForm(f => ({ ...f, vencimiento: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 transition" />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowAddModal(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-2xl text-sm font-black hover:bg-slate-200 transition">
                  Cancelar
                </button>
                <button onClick={handleSaveCobro} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-2xl text-sm font-black hover:bg-emerald-700 transition shadow-sm">
                  {editingCobro ? 'Guardar' : 'Añadir'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};
