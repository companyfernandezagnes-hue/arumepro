import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Building2, Search, Plus, Trash2, CheckCircle2, AlertTriangle,
  Calendar, Scale, Edit3, X,
  Loader2, Hotel, ShoppingBag, Users, Layers, FileDown, FileUp, Target,
  Landmark, Wrench, AlertOctagon, Save, Filter, UserCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, GastoFijo } from '../types';
import { scanDocument } from '../services/aiProviders';
import { cn } from '../lib/utils';
import { Num } from '../services/engine';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

// ─── UNIDADES DE NEGOCIO ──────────────────────────────────────────────────────
export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante',      icon: Building2,  color: 'text-indigo-600',  bg: 'bg-indigo-50'  },
  { id: 'DLV',  name: 'Catering Hoteles', icon: Hotel,      color: 'text-amber-600',   bg: 'bg-amber-50'   },
  { id: 'SHOP', name: 'Tienda Sake',      icon: ShoppingBag,color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'CORP', name: 'Socios / Corp',    icon: Users,      color: 'text-slate-600',   bg: 'bg-slate-100'  },
];

// ─── TIPOS DE COMPROMISOS ─────────────────────────────────────────────────────
const COMMITMENT_TYPES = [
  { id: 'expense',     name: 'Gasto Deducible',        icon: FileDown,    color: 'text-rose-600',    bg: 'bg-rose-50',    border: 'border-rose-100'    },
  { id: 'income',      name: 'Ingreso Fijo',            icon: FileUp,      color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  { id: 'payroll',     name: 'Personal y Seguros Soc.', icon: UserCircle,  color: 'text-fuchsia-600', bg: 'bg-fuchsia-50', border: 'border-fuchsia-100' },
  { id: 'tax',         name: 'Tributo / AEAT',          icon: Scale,       color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-100'   },
  { id: 'grant',       name: 'Subvención',              icon: Target,      color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-100'    },
  { id: 'debt',        name: 'Préstamo / Deuda',        icon: Landmark,    color: 'text-purple-600',  bg: 'bg-purple-50',  border: 'border-purple-100'  },
  { id: 'maintenance', name: 'Mantenimiento',           icon: Wrench,      color: 'text-slate-600',   bg: 'bg-slate-100',  border: 'border-slate-200'   },
  { id: 'fine',        name: 'Multa / Sanción',         icon: AlertOctagon,color: 'text-red-600',     bg: 'bg-red-50',     border: 'border-red-100'     },
];

interface FixedExpensesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

// ─── HELPER: ¿toca pagar este mes? ───────────────────────────────────────────
const isDueThisMonth = (g: any, refDate: Date) => {
  if (g.active === false) return false;
  const m0 = refDate.getMonth();
  const y0 = refDate.getFullYear();
  if (g.startDate) {
    const start = new Date(g.startDate);
    if (start.getFullYear() > y0 || (start.getFullYear() === y0 && start.getMonth() > m0)) return false;
  }
  if (g.endDate) {
    const end = new Date(g.endDate);
    if (end.getFullYear() < y0 || (end.getFullYear() === y0 && end.getMonth() < m0)) return false;
  }
  const start      = g.startDate ? new Date(g.startDate) : new Date(y0, m0, 1);
  const monthsDiff = (y0 - start.getFullYear()) * 12 + (m0 - start.getMonth());
  switch (g.freq) {
    case 'once':       return g.startDate
      ? (new Date(g.startDate).getFullYear() === y0 && new Date(g.startDate).getMonth() === m0)
      : false;
    case 'mensual':    return monthsDiff >= 0;
    case 'bimensual':  return monthsDiff >= 0 && monthsDiff % 2 === 0;
    case 'trimestral': return monthsDiff >= 0 && monthsDiff % 3 === 0;
    case 'semestral':  return monthsDiff >= 0 && monthsDiff % 6 === 0;
    case 'anual':      return monthsDiff >= 0 && monthsDiff % 12 === 0;
    case 'semanal':    return true;
    default:           return true;
  }
};

// ✅ FIX 1: helper que detecta si un `freq:'once'` no fue pagado y tiene
// menos de 3 meses de antigüedad — para que no desaparezca del filtro "este mes"
const isOverdueOnce = (g: any, refDate: Date, paidIds: string[]): boolean => {
  if (g.freq !== 'once' || !g.startDate) return false;
  if (paidIds.includes(g.id)) return false; // ya pagado, no urgente
  const start = new Date(g.startDate);
  const y0 = refDate.getFullYear();
  const m0 = refDate.getMonth();
  const startY = start.getFullYear();
  const startM = start.getMonth();
  // monthsDiff: cuántos meses atrás está
  const diff = (y0 - startY) * 12 + (m0 - startM);
  return diff > 0 && diff <= 3; // pasado pero en los últimos 3 meses
};

// ─── HELPER: prorrateo mensual de un gasto fijo ──────────────────────────────
// Definida fuera del componente — es una función pura, no necesita recrearse
const getProrrateoMensual = (g: any): number => {
  const amount = Math.abs(Num.parse(g.amount)) || 0;
  if (g.freq === 'anual')      return amount / 12;
  if (g.freq === 'semestral')  return amount / 6;
  if (g.freq === 'trimestral') return amount / 3;
  if (g.freq === 'bimensual')  return amount / 2;
  if (g.freq === 'semanal')    return amount * 4.33;
  if (g.freq === 'once')       return 0;
  return amount;
};

// ─────────────────────────────────────────────────────────────────────────────
export const FixedExpensesView = ({ data, onSave }: FixedExpensesViewProps) => {
  const migrationDoneRef = useRef(false);
  const nominasInputRef  = useRef<HTMLInputElement>(null);

  const [searchTerm,          setSearchTerm]          = useState('');
  const [selectedUnit,        setSelectedUnit]        = useState<BusinessUnit | 'ALL'>('ALL');
  const [showDueOnly,         setShowDueOnly]         = useState(false);
  const [showPayrollOnly,     setShowPayrollOnly]     = useState(false);
  const [isProcessingNominas, setIsProcessingNominas] = useState(false);
  const [isModalOpen,         setIsModalOpen]         = useState(false);
  const [editingGasto,        setEditingGasto]        = useState<any | null>(null);

  const [nominasConfirm, setNominasConfirm] = useState<{
    nTrab: number;
    mesLabelCap: string;
    liquido: number;
    ss: number;
    costTotal: number;
    trabajadores: any[];
    nuevasEntradas: any[];
  } | null>(null);

  // ✅ FIX 2: `today` en useMemo para que se recalcule si el componente
  // se desmonta/monta al cambiar de mes (evita fechas congeladas en sesiones largas)
  const today = useMemo(() => new Date(), []);

  const currentMonthKey = `pagos_${today.getFullYear()}_${today.getMonth() + 1}`;
  const gastosFijos     = data.gastos_fijos || [];
  const controlPagos    = data.control_pagos || {};
  const currentPagos    = controlPagos[currentMonthKey] || [];

  // ── Migración silenciosa: cat:'personal' → type:'payroll' ────────────────
  useEffect(() => {
    if (migrationDoneRef.current) return;
    const newData = JSON.parse(JSON.stringify(data)) as AppData;
    let needsSave = false;
    if (newData.gastos_fijos) {
      newData.gastos_fijos.forEach((g: any) => {
        if (!g.type && g.cat === 'personal') { g.type = 'payroll'; needsSave = true; }
      });
      if (needsSave) { migrationDoneRef.current = true; onSave(newData); }
    }
  }, [data.gastos_fijos, onSave]);

  const stats = useMemo(() => {
    try {
      const activeItems = gastosFijos.filter((g: any) => {
        if (g.active === false) return false;
        const gUnit = g.unitId || 'REST';
        if (selectedUnit !== 'ALL' && gUnit !== selectedUnit) return false;
        if (g.startDate && new Date(g.startDate) > new Date(today.getFullYear(), today.getMonth() + 1, 0)) return false;
        if (g.endDate   && new Date(g.endDate)   < new Date(today.getFullYear(), today.getMonth(), 1))     return false;
        return true;
      });

      let totalMochilaGastos = 0, totalPagadoGastos = 0;
      let totalMochilaIngresos = 0, totalPagadoIngresos = 0;
      let totalMochilaPersonal = 0, totalPagadoPersonal = 0;
      let dueRealGastos = 0, dueRealIngresos = 0, dueRealPersonal = 0;

      activeItems.forEach((g: any) => {
        const isIncome  = g.type === 'income' || g.type === 'grant';
        const isPayroll = g.type === 'payroll' || g.cat === 'personal';
        const isDone    = currentPagos.includes(g.id);
        const prorrateo = getProrrateoMensual(g);
        const importeReal = Math.abs(Num.parse(g.amount)) || 0;
        // ✅ FIX 1: incluir overdue once en stats también
        const tocaEsteMes = isDueThisMonth(g, today) || isOverdueOnce(g, today, currentPagos);

        if (isIncome) {
          totalMochilaIngresos += prorrateo;
          if (isDone && tocaEsteMes) totalPagadoIngresos += importeReal;
          if (tocaEsteMes) dueRealIngresos += importeReal;
        } else if (isPayroll) {
          totalMochilaPersonal += prorrateo;
          if (isDone && tocaEsteMes) totalPagadoPersonal += importeReal;
          if (tocaEsteMes) dueRealPersonal += importeReal;
        } else {
          totalMochilaGastos += prorrateo;
          if (isDone && tocaEsteMes) totalPagadoGastos += importeReal;
          if (tocaEsteMes) dueRealGastos += importeReal;
        }
      });

      const totalDueSalidas      = dueRealGastos + dueRealPersonal;
      const totalPagadoSalidas   = totalPagadoGastos + totalPagadoPersonal;
      const totalPendienteSalidas = Math.max(0, totalDueSalidas - totalPagadoSalidas);
      const porcentajeSalidas    = totalDueSalidas > 0 ? (totalPagadoSalidas / totalDueSalidas) * 100 : 0;

      return {
        totalMochilaGastos, totalPagadoGastos, totalPendienteSalidas, porcentajeSalidas,
        totalMochilaIngresos, dueRealGastos, dueRealIngresos, dueRealPersonal,
        totalDueSalidas, totalMochilaPersonal,
      };
    } catch { return null; }
  }, [gastosFijos, currentPagos, selectedUnit, today]);

  const filteredGastos = useMemo(() => {
    return gastosFijos
      .filter((g: any) => {
        if (g.active === false) return false;
        const gUnit = g.unitId || 'REST';
        if (selectedUnit !== 'ALL' && gUnit !== selectedUnit) return false;
        // ✅ FIX 1: con showDueOnly, los `once` sin pagar de meses recientes
        //           también aparecen para que no se pierdan silenciosamente
        if (showDueOnly) {
          const tocaEsteMes = isDueThisMonth(g, today);
          const pendienteReciente = isOverdueOnce(g, today, currentPagos);
          if (!tocaEsteMes && !pendienteReciente) return false;
        }
        if (showPayrollOnly && g.type !== 'payroll' && g.cat !== 'personal') return false;
        return (g.name || g.concepto || '').toLowerCase().includes(searchTerm.toLowerCase());
      })
      .sort((a: any, b: any) => {
        const isPaidA = currentPagos.includes(a.id);
        const isPaidB = currentPagos.includes(b.id);
        if (isPaidA !== isPaidB) return isPaidA ? 1 : -1;
        return (a.dia_pago || 1) - (b.dia_pago || 1);
      });
  }, [gastosFijos, searchTerm, currentPagos, selectedUnit, showDueOnly, showPayrollOnly, today]);

  // ── Marcar/desmarcar pago ─────────────────────────────────────────────────
  const handleTogglePago = async (g: any) => {
    const newData = JSON.parse(JSON.stringify(data)) as AppData;
    if (!newData.control_pagos)                    newData.control_pagos = {};
    if (!newData.control_pagos[currentMonthKey])   newData.control_pagos[currentMonthKey] = [];

    const idx         = newData.control_pagos[currentMonthKey].indexOf(g.id);
    const importeReal = Math.abs(Num.parse(g.amount)) || 0;
    const isIncome    = g.type === 'income' || g.type === 'grant';
    const actionWord  = isIncome ? 'ingreso' : 'salida';
    const sign        = isIncome ? 1 : -1;

    if (idx === -1) {
      newData.control_pagos[currentMonthKey].push(g.id);
      if (await confirm({
        title:        `¿Registrar ${actionWord} en el Banco?`,
        message:      `Se creará un movimiento pendiente de ${Num.fmt(importeReal)} para conciliar.`,
        confirmLabel: 'Sí, registrar',
      })) {
        if (!newData.banco) newData.banco = [];
        newData.banco.unshift({
          id:      'gf-pending-' + Date.now(),
          date:    new Date().toISOString().split('T')[0],
          desc:    `[COMPROMISO] ${isIncome ? 'COBRO' : 'PAGO'} • ${String(g.type || 'expense').toUpperCase()} • ${g.name || g.concepto}`,
          amount:  Num.round2(importeReal * sign),
          status:  'pending',
          link:     { type: 'GASTO_FIJO', id: g.id },
          linkHint: { text: g.name || g.concepto, amount: importeReal },
        } as any);
      }
    } else {
      newData.control_pagos[currentMonthKey].splice(idx, 1);
      if (newData.banco) {
        const movIdx = newData.banco.findIndex((b: any) => b.link?.type === 'GASTO_FIJO' && b.link?.id === g.id && b.status === 'pending');
        if (movIdx >= 0) newData.banco.splice(movIdx, 1);
      }
    }
    await onSave(newData);
  };

  // ── Guardar gasto (nuevo o edición) ──────────────────────────────────────
  const handleSaveGasto = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const nuevo: any = {
      id:        editingGasto?.id || `compromiso-${Date.now()}`,
      type:      formData.get('type') as string,
      name:      formData.get('name') as string,
      amount:    Math.abs(parseFloat(formData.get('amount') as string) || 0),
      freq:      formData.get('freq') as any,
      cat:       formData.get('type') === 'payroll' ? 'personal' : 'varios',
      dia_pago:  parseInt(formData.get('dia_pago') as string) || 1,
      startDate: formData.get('startDate') as string,
      endDate:   formData.get('endDate') as string,
      active:    true,
      notes:     formData.get('notes') as string,
      unitId:    formData.get('unitId') as string,
    };

    const newData = JSON.parse(JSON.stringify(data)) as AppData;
    if (!newData.gastos_fijos) newData.gastos_fijos = [];
    const idx = newData.gastos_fijos.findIndex((x: any) => x.id === nuevo.id);
    if (idx >= 0) newData.gastos_fijos[idx] = nuevo;
    else newData.gastos_fijos.push(nuevo);

    await onSave(newData);
    setIsModalOpen(false);
    setEditingGasto(null);
    toast.success(idx >= 0 ? 'Compromiso actualizado ✓' : 'Compromiso añadido ✓');
  };

  // ── Archivar gasto ────────────────────────────────────────────────────────
  const handleDeleteGasto = async (id: string) => {
    if (!await confirm({
      title:        '¿Archivar este compromiso?',
      message:      'Dejará de aparecer en la agenda. El historial se conserva.',
      danger:        true,
      confirmLabel: 'Archivar',
    })) return;

    const newData = JSON.parse(JSON.stringify(data)) as AppData;
    const idx = newData.gastos_fijos.findIndex((x: any) => x.id === id);
    if (idx >= 0) {
      newData.gastos_fijos[idx].active = false;
      await onSave(newData);
      toast.success('Compromiso archivado');
    }
    setIsModalOpen(false);
    setEditingGasto(null);
  };

  // ── Importar nóminas PDF con Gemini ──────────────────────────────────────
  const handleNominasPDFChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsProcessingNominas(true);
    toast.success('Leyendo PDF con IA…');

    try {
      const prompt = `Eres un contable experto en nóminas españolas. Este PDF contiene una o más nóminas de trabajadores. Analiza TODAS las páginas y devuelve SOLO un JSON estricto sin comentarios ni markdown:
{
  "mes": "YYYY-MM",
  "num_trabajadores": 0,
  "total_liquido": 0,
  "total_ss_empresa": 0,
  "trabajadores": [
    { "nombre": "Apellido1 Apellido2, Nombre", "liquido": 0, "ss_empresa": 0 }
  ]
}

Instrucciones:
- "mes": el periodo devengado en formato YYYY-MM (ej: 2026-03)
- "total_liquido": suma de todos los campos "LIQUIDO TOTAL A PERCIBIR" de cada nómina
- "total_ss_empresa": suma de todas las APORTACIONES EMPRESA (Contingencias Comunes + AT Y EP + Desempleo + Formación Profesional + Fondo Garantía Salarial) de cada nómina
- "num_trabajadores": número total de nóminas en el documento
- "trabajadores": detalle de cada persona con su líquido y su coste SS empresa
- Usa punto como separador decimal, NO comas`;

      const result = await scanDocument(file, prompt);
      const parsed: any = result.raw;

      const mes: string      = parsed.mes || '';
      const liquido: number  = parseFloat(parsed.total_liquido)    || 0;
      const ss: number       = parseFloat(parsed.total_ss_empresa) || 0;
      const nTrab: number    = parseInt(parsed.num_trabajadores)   || 0;
      const trabajadores: any[] = parsed.trabajadores || [];

      if (!mes || !/^\d{4}-\d{2}$/.test(mes)) throw new Error(`Mes extraído no válido: "${mes}". Revisa el PDF.`);
      if (liquido <= 0 || ss <= 0)             throw new Error(`Importes inválidos.\nLíquido: ${liquido} | SS empresa: ${ss}\nRevisa que el PDF contiene nóminas válidas.`);

      const costeTotal  = Num.round2(liquido + ss);
      const [anio, mesNum] = mes.split('-');
      const mesLabel    = new Date(Number(anio), Number(mesNum) - 1, 1)
        .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      const mesLabelCap = mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1);

      const idBase    = `payroll-${anio}-${mesNum}`;
      const startDate = `${anio}-${mesNum}-01`;

      const nuevasEntradas: any[] = [
        {
          id:        `${idBase}-nominas`,
          type:      'payroll',
          cat:       'personal',
          name:      `Nóminas Plantilla — ${mesLabelCap}`,
          amount:    liquido,
          freq:      'once',
          dia_pago:  31,
          startDate,
          unitId:    'REST',
          active:    true,
          notes: [
            `Resumen nóminas ${mesLabelCap}.`,
            `${nTrab} trabajadores.`,
            `SS empresa: ${Num.fmt(ss)}.`,
            `Coste total empresa: ${Num.fmt(costeTotal)}.`,
            trabajadores.length > 0
              ? 'Detalle: ' + trabajadores.map((t: any) =>
                  `${t.nombre} (${Number(t.liquido).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €)`
                ).join(', ')
              : '',
          ].filter(Boolean).join(' '),
        },
        {
          id:        `${idBase}-ss-empresa`,
          type:      'payroll',
          cat:       'personal',
          name:      `Seguridad Social Empresa — ${mesLabelCap}`,
          amount:    ss,
          freq:      'once',
          dia_pago:  31,
          startDate,
          unitId:    'REST',
          active:    true,
          notes:     `Cuotas SS empresa ${mesLabelCap}. Contingencias comunes + AT&EP + Desempleo + FP + FOGASA.`,
        },
      ];

      setNominasConfirm({ nTrab, mesLabelCap, liquido, ss, costTotal: costeTotal, trabajadores, nuevasEntradas });

    } catch (err: any) {
      toast.error(`Error al procesar el PDF: ${err.message || err}`);
    } finally {
      setIsProcessingNominas(false);
    }
  };

  // ── Guardar nóminas tras confirmar ────────────────────────────────────────
  const handleConfirmNominas = async () => {
    if (!nominasConfirm) return;
    const { nuevasEntradas, mesLabelCap } = nominasConfirm;

    const newData = JSON.parse(JSON.stringify(data)) as AppData;
    if (!newData.gastos_fijos) newData.gastos_fijos = [];
    let sobreescritos = 0;
    nuevasEntradas.forEach(entrada => {
      const idx = newData.gastos_fijos.findIndex((g: any) => g.id === entrada.id);
      if (idx !== -1) { newData.gastos_fijos[idx] = entrada; sobreescritos++; }
      else newData.gastos_fijos.push(entrada);
    });
    await onSave(newData);
    setNominasConfirm(null);
    toast.success(sobreescritos > 0
      ? `✅ Nóminas ${mesLabelCap} actualizadas.`
      : `✅ Nóminas ${mesLabelCap} registradas en Gastos Fijos.`
    );
  };

  // ── Tema visual por tipo ──────────────────────────────────────────────────
  const getTypeTheme = (type?: string, legacyCat?: string) => {
    if (type) { const found = COMMITMENT_TYPES.find(t => t.id === type); if (found) return found; }
    switch (legacyCat) {
      case 'personal':   return COMMITMENT_TYPES[2];
      case 'impuestos':  return COMMITMENT_TYPES[3];
      default:           return COMMITMENT_TYPES[0];
    }
  };

  if (!stats) return (
    <div className="flex items-center justify-center h-[50vh] text-indigo-500">
      <Loader2 className="w-8 h-8 animate-spin" />
    </div>
  );

  return (
    <div className="animate-fade-in space-y-6 pb-24">

      {/* ── HEADER DINÁMICO ──────────────────────────────────────────────── */}
      <header className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">

        <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col justify-center xl:col-span-1 md:col-span-2">
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Agenda Financiera</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            {selectedUnit === 'ALL' ? 'Grupo Arume' : BUSINESS_UNITS.find(u => u.id === selectedUnit)?.name} • {today.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase()}
          </p>
        </div>

        <div className="bg-slate-900 p-6 rounded-[2.5rem] shadow-lg border border-slate-800 flex items-center justify-between text-white relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-rose-500" />
          <div className="flex flex-col pl-4">
            <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-1">Obligaciones (Salidas)</p>
            <p className="text-3xl font-black">{Num.fmt(stats.totalPendienteSalidas)} <span className="text-sm text-slate-400 font-medium tracking-normal">pendientes</span></p>
            <p className="text-[10px] text-slate-400 font-bold mt-1">De un total de {Num.fmt(stats.totalDueSalidas)} previstos</p>
          </div>
          <div className="w-14 h-14 rounded-full border-4 border-slate-800 flex items-center justify-center relative overflow-hidden shadow-inner bg-slate-800 shrink-0">
            <div className="absolute bottom-0 w-full bg-rose-500 transition-all duration-1000" style={{ height: `${stats.porcentajeSalidas}%` }} />
            <span className="text-[9px] font-black z-10 relative text-white">{Math.round(stats.porcentajeSalidas)}%</span>
          </div>
        </div>

        <div className="bg-fuchsia-50 p-6 rounded-[2.5rem] shadow-sm border border-fuchsia-100 flex items-center justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-fuchsia-500" />
          <div className="flex flex-col pl-4">
            <p className="text-[9px] font-black text-fuchsia-600 uppercase tracking-widest mb-1">Coste Laboral Mes</p>
            <p className="text-3xl font-black text-fuchsia-700">{Num.fmt(stats.dueRealPersonal)}</p>
            <p className="text-[10px] text-fuchsia-500/70 font-bold mt-1">Nóminas y Seguros Sociales</p>
          </div>
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm shrink-0">
            <UserCircle className="w-5 h-5 text-fuchsia-500" />
          </div>
        </div>

        <div className="bg-emerald-50 p-6 rounded-[2.5rem] shadow-sm border border-emerald-100 flex items-center justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500" />
          <div className="flex flex-col pl-4">
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">Previsión Ingresos</p>
            <p className="text-3xl font-black text-emerald-700">{Num.fmt(stats.dueRealIngresos)}</p>
            <p className="text-[10px] text-emerald-500/70 font-bold mt-1">Ayudas, Subvenciones y otros</p>
          </div>
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm shrink-0">
            <FileUp className="w-5 h-5 text-emerald-500" />
          </div>
        </div>

      </header>

      {/* ── BUSCADOR Y FILTROS ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 bg-white p-3 rounded-[2rem] border border-slate-100 shadow-sm sticky top-2 z-10">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-2">

          <div className="flex items-center gap-2 flex-1 px-3 bg-slate-50 rounded-xl py-2 w-full">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar nómina, alquiler, AEAT..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="bg-transparent outline-none text-xs font-bold text-slate-600 w-full"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">

            <input ref={nominasInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleNominasPDFChange} />

            {/* ✅ FIX 3: spinner inline en el botón de importar nóminas */}
            <button
              onClick={() => nominasInputRef.current?.click()}
              disabled={isProcessingNominas}
              className={cn(
                'flex-1 md:flex-none px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border flex items-center justify-center gap-2 whitespace-nowrap',
                isProcessingNominas
                  ? 'bg-fuchsia-100 text-fuchsia-400 border-fuchsia-200 cursor-wait'
                  : 'bg-fuchsia-600 text-white border-fuchsia-600 hover:bg-fuchsia-700 shadow-sm active:scale-95'
              )}
            >
              {isProcessingNominas
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Leyendo PDF…</>
                : <><UserCircle className="w-3.5 h-3.5" /> Importar Nóminas</>
              }
            </button>

            <button
              onClick={() => setShowPayrollOnly(!showPayrollOnly)}
              className={cn(
                'flex-1 md:flex-none px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border flex items-center justify-center gap-2 whitespace-nowrap',
                showPayrollOnly ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              )}
            >
              <UserCircle className="w-3.5 h-3.5" /> {showPayrollOnly ? 'Ver Todo' : 'Solo Personal'}
            </button>

            <button
              onClick={() => setShowDueOnly(!showDueOnly)}
              className={cn(
                'flex-1 md:flex-none px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border flex items-center justify-center gap-2 whitespace-nowrap',
                showDueOnly ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              )}
            >
              <Filter className="w-3.5 h-3.5" /> {showDueOnly ? 'Viendo este Mes' : 'Ver todo el año'}
            </button>

            <button
              onClick={() => { setEditingGasto(null); setIsModalOpen(true); }}
              className="flex-1 md:flex-none bg-slate-900 text-white px-6 py-2.5 rounded-xl text-[10px] font-black hover:bg-indigo-600 transition flex-shrink-0 shadow-lg flex items-center justify-center gap-2 whitespace-nowrap active:scale-95"
            >
              <Plus className="w-4 h-4" /> NUEVO
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 px-1">
          <button
            onClick={() => setSelectedUnit('ALL')}
            className={cn('px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5', selectedUnit === 'ALL' ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50')}
          >
            <Layers className="w-3 h-3" /> Todas
          </button>
          {BUSINESS_UNITS.map(unit => (
            <button
              key={unit.id}
              onClick={() => setSelectedUnit(unit.id)}
              className={cn('px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5', selectedUnit === unit.id ? `${unit.color.replace('text-', 'bg-')} text-white border-transparent shadow-md` : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50')}
            >
              <unit.icon className="w-3 h-3" /> {unit.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* ── LISTA DE COMPROMISOS ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence>
          {filteredGastos.map((g: any) => {
            const isDone           = currentPagos.includes(g.id);
            const importeBruto     = Math.abs(Num.parse(g.amount)) || 0;
            const prorrateoMensual = getProrrateoMensual(g);
            const theme            = getTypeTheme(g.type, g.cat);
            const diaHoy           = today.getDate();
            const tocaEsteMes      = isDueThisMonth(g, today);
            // ✅ FIX 1: badge especial para once pendientes de meses pasados
            const pendienteReciente = isOverdueOnce(g, today, currentPagos);
            const esUrgente        = tocaEsteMes && !isDone && (g.dia_pago - diaHoy <= 5) && (g.dia_pago - diaHoy >= -5);
            const isIncome         = g.type === 'income' || g.type === 'grant';
            const unitConfig       = BUSINESS_UNITS.find(u => u.id === (g.unitId || 'REST'));

            return (
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{    opacity: 0, scale: 0.9 }}
                key={g.id}
                className={cn(
                  'bg-white p-5 rounded-[2.5rem] border transition-all relative group hover:shadow-xl flex flex-col justify-between',
                  !tocaEsteMes && !pendienteReciente ? 'opacity-40 grayscale hover:grayscale-0 hover:opacity-100' : '',
                  isDone          ? 'border-emerald-200 bg-emerald-50/20' :
                  pendienteReciente ? 'border-amber-300 shadow-amber-100 shadow-md' :
                  esUrgente       ? 'border-rose-300 shadow-rose-100 shadow-lg' : 'border-slate-100 shadow-sm'
                )}
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3 overflow-hidden flex-1">
                      <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-sm border', theme.bg, theme.color, theme.border)}>
                        <theme.icon className="w-6 h-6" />
                      </div>
                      <div className="overflow-hidden">
                        <h4 className="font-black text-slate-800 text-sm truncate leading-tight" title={g.name}>{g.name || g.concepto}</h4>
                        <div className="flex gap-2 text-[9px] font-bold uppercase tracking-wide mt-1.5 items-center flex-wrap">
                          <span className={cn('px-1.5 py-0.5 rounded border', theme.bg, theme.color, theme.border)}>{theme.name}</span>
                          <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{g.freq}</span>
                          {unitConfig && (
                            <span className={cn('px-1.5 py-0.5 rounded border border-current opacity-80', unitConfig.color, unitConfig.bg)}>
                              {unitConfig.name.split(' ')[0]}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => { setEditingGasto(g); setIsModalOpen(true); }}
                        className="w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center transition"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      {(tocaEsteMes || pendienteReciente) && (
                        <button
                          onClick={() => handleTogglePago(g)}
                          className="transition-all active:scale-90"
                          title={isDone ? 'Deshacer y borrar del banco' : 'Marcar como pagado/cobrado'}
                        >
                          {isDone ? (
                            <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-200">
                              <CheckCircle2 className="w-5 h-5" />
                            </div>
                          ) : (
                            <div className="w-8 h-8 bg-white border-2 border-slate-200 rounded-full flex items-center justify-center hover:border-indigo-400 transition-colors">
                              <div className="w-2 h-2 rounded-full bg-slate-100" />
                            </div>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {(g.startDate || g.endDate) && (
                    <div className="flex items-center gap-4 mb-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 p-2 rounded-xl">
                      {g.startDate && <span>Desde: {g.startDate}</span>}
                      {g.endDate   && <span>Hasta: {g.endDate}</span>}
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-end pt-4 border-t border-slate-50">
                  <div>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Día {g.dia_pago}
                    </p>
                    <p className="text-sm font-black text-slate-800 mt-1">{Num.fmt(importeBruto)} / oficial</p>
                  </div>
                  <div className="text-right">
                    <p className={cn('text-[9px] font-bold uppercase tracking-widest', isIncome ? 'text-emerald-500' : 'text-indigo-400')}>Prorrateo Mensual</p>
                    <p className={cn('text-lg font-black', isIncome ? 'text-emerald-600' : 'text-indigo-600')}>
                      {isIncome ? '+' : '-'}{Num.fmt(prorrateoMensual)}
                    </p>
                  </div>
                </div>

                {/* Badges en esquina */}
                {esUrgente && !isIncome && (
                  <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[8px] font-black px-2 py-1 rounded-lg shadow-lg animate-bounce">
                    PAGO CERCANO
                  </div>
                )}
                {/* ✅ FIX 1: badge específico para nóminas/pagos únicos pendientes de meses pasados */}
                {pendienteReciente && !isDone && (
                  <div className="absolute -top-2 -right-2 bg-amber-500 text-white text-[8px] font-black px-2 py-1 rounded-lg shadow-lg">
                    PENDIENTE
                  </div>
                )}
                {!tocaEsteMes && !pendienteReciente && (
                  <div className="absolute -top-2 -right-2 bg-slate-100 text-slate-400 text-[8px] font-black px-2 py-1 rounded-lg shadow-sm border border-slate-200">
                    NO TOCA ESTE MES
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {filteredGastos.length === 0 && (
          <div className="col-span-full text-center py-20 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200">
            <AlertTriangle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-xs font-black text-slate-400 uppercase">No hay compromisos en esta vista</p>
          </div>
        )}
      </div>

      {/* ── MODAL NUEVO / EDITAR COMPROMISO ──────────────────────────────── */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[9999] flex justify-center items-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1,    y: 0  }}
              exit={{    opacity: 0, scale: 0.9, y: 20  }}
              className="bg-white w-full max-w-xl rounded-[3rem] p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <button
                onClick={() => { setIsModalOpen(false); setEditingGasto(null); }}
                className="absolute top-6 right-6 text-slate-400 hover:text-rose-500 transition bg-slate-50 hover:bg-rose-50 p-2 rounded-full z-50 border border-slate-100 hover:border-rose-200"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-2xl font-black text-slate-800 mb-6 flex items-center gap-2">
                <Layers className="w-6 h-6 text-indigo-500" />
                {editingGasto ? 'Editar Compromiso' : 'Nuevo Compromiso'}
              </h3>

              <form onSubmit={handleSaveGasto} className="space-y-6">

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Naturaleza de la Operación</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {COMMITMENT_TYPES.map(t => (
                      <label key={t.id} className="relative cursor-pointer group">
                        <input type="radio" name="type" value={t.id} defaultChecked={editingGasto?.type ? editingGasto.type === t.id : t.id === 'expense'} className="peer sr-only" />
                        <div className={cn('p-3 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 text-center', 'border-slate-100 bg-white text-slate-500 group-hover:bg-slate-50', 'peer-checked:border-indigo-500 peer-checked:bg-indigo-50 peer-checked:text-indigo-700 shadow-sm')}>
                          <t.icon className="w-5 h-5" />
                          <span className="text-[9px] font-black uppercase leading-tight">{t.name}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-[2rem] border border-slate-100 shadow-inner">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 mb-3 block tracking-widest">A qué bloque pertenece</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {BUSINESS_UNITS.map(unit => (
                      <label key={unit.id} className="relative cursor-pointer">
                        <input type="radio" name="unitId" value={unit.id} defaultChecked={editingGasto?.unitId === unit.id || (!editingGasto && unit.id === 'REST')} className="peer sr-only" />
                        <div className="p-3 rounded-xl border-2 border-transparent bg-white text-slate-400 transition-all peer-checked:border-indigo-500 peer-checked:bg-indigo-500 peer-checked:text-white flex flex-col items-center gap-1.5 shadow-sm hover:shadow">
                          <unit.icon className="w-4 h-4" />
                          <span className="text-[9px] font-black uppercase text-center">{unit.name}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Nombre / Concepto</label>
                    <input name="name" type="text" defaultValue={editingGasto?.name || ''} placeholder="Ej: Nómina Recepción, Préstamo ICO..." required className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Importe Oficial (€)</label>
                      <input name="amount" type="number" step="0.01" defaultValue={editingGasto?.amount || ''} placeholder="0.00" required className="w-full p-4 bg-slate-50 rounded-2xl font-black text-lg border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Día de Cargo</label>
                      <input name="dia_pago" type="number" min="1" max="31" defaultValue={editingGasto?.dia_pago || 1} required className="w-full p-4 bg-slate-50 rounded-2xl font-black text-lg border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Periodicidad</label>
                    <select name="freq" defaultValue={editingGasto?.freq || 'mensual'} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20 appearance-none cursor-pointer">
                      <option value="once">Única vez (Una sola cuota)</option>
                      <option value="mensual">Mensual (12 al año)</option>
                      <option value="trimestral">Trimestral (4 al año)</option>
                      <option value="semestral">Semestral (2 al año)</option>
                      <option value="anual">Anual (1 al año)</option>
                      <option value="bimensual">Bimensual (6 al año)</option>
                      <option value="semanal">Semanal (52 al año)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Inicio (Opcional)</label>
                      <input name="startDate" type="date" defaultValue={editingGasto?.startDate || ''} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-xs border border-slate-100 outline-none cursor-text" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Fin (Opcional)</label>
                      <input name="endDate" type="date" defaultValue={editingGasto?.endDate || ''} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-xs border border-slate-100 outline-none cursor-text" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Notas o Expediente</label>
                    <textarea name="notes" defaultValue={editingGasto?.notes || ''} placeholder="Nº de expediente, condiciones, referencias..." className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm border border-slate-100 outline-none h-20 resize-none" />
                  </div>
                </div>

                <div className="pt-2 space-y-3">
                  <button type="submit" className="w-full bg-slate-900 text-white py-5 rounded-3xl font-black shadow-xl hover:bg-indigo-600 transition active:scale-95 flex justify-center items-center gap-2">
                    <Save className="w-5 h-5" /> GUARDAR COMPROMISO
                  </button>
                  {editingGasto && (
                    <button type="button" onClick={() => handleDeleteGasto(editingGasto.id)} className="w-full text-rose-400 text-[10px] font-black uppercase py-2 hover:text-rose-600 transition flex justify-center items-center gap-1">
                      <Trash2 className="w-3 h-3" /> Archivar este registro
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── MODAL CONFIRMACIÓN DE NÓMINAS ────────────────────────────────── */}
      <AnimatePresence>
        {nominasConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            onClick={() => setNominasConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1,    y: 0  }}
              exit={{    scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-black text-lg text-slate-800 leading-tight">
                    Gemini ha leído {nominasConfirm.nTrab} nóminas
                  </h3>
                  <p className="text-xs font-bold text-fuchsia-600 mt-0.5">{nominasConfirm.mesLabelCap}</p>
                </div>
                <button onClick={() => setNominasConfirm(null)} className="p-1.5 bg-slate-100 rounded-full text-slate-400 hover:bg-slate-200 transition">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Líquido plantilla', value: nominasConfirm.liquido,   color: 'text-fuchsia-700' },
                  { label: 'SS Empresa',         value: nominasConfirm.ss,        color: 'text-amber-700'   },
                  { label: 'Coste total',        value: nominasConfirm.costTotal, color: 'text-slate-800'   },
                ].map(k => (
                  <div key={k.label} className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-100">
                    <p className={cn('text-base font-black', k.color)}>{Num.fmt(k.value)}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{k.label}</p>
                  </div>
                ))}
              </div>

              {nominasConfirm.trabajadores.length > 0 && (
                <div className="bg-fuchsia-50 rounded-2xl p-3 border border-fuchsia-100 max-h-32 overflow-y-auto space-y-1">
                  {nominasConfirm.trabajadores.map((t: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs px-1">
                      <span className="font-bold text-slate-700 truncate">{t.nombre}</span>
                      <span className="font-black text-fuchsia-700 shrink-0 ml-2">{Num.fmt(Number(t.liquido))}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[10px] font-bold text-slate-500 bg-slate-50 rounded-xl px-3 py-2 flex items-center gap-1.5 border border-slate-100">
                ℹ️ Se registrarán como <strong>pago único</strong> — no reaparecerán en meses futuros.
              </p>

              <p className="text-sm font-bold text-slate-700">¿Registrar estas 2 entradas en Gastos Fijos?</p>

              <div className="flex gap-3">
                <button
                  onClick={() => setNominasConfirm(null)}
                  className="flex-1 py-3 rounded-2xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmNominas}
                  className="flex-1 py-3 rounded-2xl bg-fuchsia-600 text-white text-xs font-black hover:bg-fuchsia-700 transition shadow-lg active:scale-95 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" /> Confirmar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};
