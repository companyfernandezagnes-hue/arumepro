/**
 * PresupuestosView.tsx — Arume PRO
 * Módulo nuevo: gestión de presupuestos/ofertas B2B para hoteles y eventos.
 *
 * Flujo:
 *   Borrador → Enviado → Aceptado ──► pasa a cobro en Tesorería (cobros_b2b)
 *                      → Rechazado
 *                      → Caducado
 *
 * Datos almacenados en data.presupuestos (nuevo campo en AppData)
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  FileText, Plus, Send, CheckCircle2, XCircle, Clock,
  ChevronRight, Trash2, Edit3, Save, X, Download,
  Building2, Users, Calendar, Euro, Sparkles, Copy,
  ArrowRight, AlertTriangle, Loader2, Hotel, Package,
  TrendingUp, Star, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData, EstadoPresupuesto, LineaPresupuesto, Presupuesto } from '../types';
import { askAI } from '../services/aiProviders';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

// ─── Tipos (importados desde ../types) ────────────────────────────────────────





interface Props {
  data  : AppData;
  onSave: (d: AppData) => Promise<void>;
}

// ─── Constantes ───────────────────────────────────────────────────────────
const ESTADO_META: Record<EstadoPresupuesto, { label:string; color:string; bg:string; border:string; icon:any }> = {
  borrador:   { label:'Borrador',   color:'text-slate-600',   bg:'bg-slate-100',   border:'border-slate-200',  icon:Edit3        },
  enviado:    { label:'Enviado',    color:'text-indigo-700',  bg:'bg-indigo-50',   border:'border-indigo-200', icon:Send         },
  aceptado:   { label:'Aceptado',  color:'text-emerald-700', bg:'bg-emerald-50',  border:'border-emerald-200',icon:CheckCircle2 },
  rechazado:  { label:'Rechazado', color:'text-rose-700',    bg:'bg-rose-50',     border:'border-rose-200',   icon:XCircle      },
  caducado:   { label:'Caducado',  color:'text-amber-700',   bg:'bg-amber-50',    border:'border-amber-200',  icon:Clock        },
};

const UNIDADES = [
  { id:'REST', label:'Restaurante Arume' },
  { id:'DLV',  label:'Catering Hoteles'  },
  { id:'CORP', label:'Eventos Corporativos' },
];

const emptyLinea = (): LineaPresupuesto => ({
  id: `l-${Date.now()}`, concepto:'', qty:1, precio:0, iva:10,
});

const emptyPresup = (): Omit<Presupuesto,'id'|'num'|'creadoEn'> => ({
  cliente:'', contacto:'', email:'', fecha: DateUtil.today(),
  fechaEvento:'', validezDias:15, estado:'borrador',
  lineas:[ emptyLinea() ], notas:'', unidad:'DLV', irpfPct: 0,
});

// ─── Helpers de cálculo ───────────────────────────────────────────────────
const calcLinea = (l: LineaPresupuesto) => {
  const base = Num.round2(l.qty * l.precio);
  const iva  = Num.round2(base * l.iva / 100);
  return { base, iva, total: Num.round2(base + iva) };
};

const calcTotal = (lineas: LineaPresupuesto[], irpfPct: number = 0) => {
  const base  = lineas.reduce((s,l) => s + calcLinea(l).base,  0);
  const iva   = lineas.reduce((s,l) => s + calcLinea(l).iva,   0);
  const irpf  = irpfPct > 0 ? Num.round2(base * irpfPct / 100) : 0;
  const total = lineas.reduce((s,l) => s + calcLinea(l).total, 0);
  return { base: Num.round2(base), iva: Num.round2(iva), irpf, total: Num.round2(total - irpf) };
};

const genNum = (lista: Presupuesto[]) => {
  const y   = new Date().getFullYear();
  const seq = lista.filter(p => p.num.startsWith(`P${y}`)).length + 1;
  return `P${y}-${String(seq).padStart(3,'0')}`;
};

// ─── Icono estado ─────────────────────────────────────────────────────────
const EstadoBadge: React.FC<{ estado: EstadoPresupuesto }> = ({ estado }) => {
  const m    = ESTADO_META[estado];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-full border uppercase tracking-widest',
      m.color, m.bg, m.border)}>
      <Icon className="w-3 h-3"/> {m.label}
    </span>
  );
};

// ════════════════════════════════════════════════════════════════════════════
export const PresupuestosView: React.FC<Props> = ({ data, onSave }) => {
  const presupuestos: Presupuesto[] = useMemo(
    () => Array.isArray((data as any).presupuestos) ? (data as any).presupuestos : [],
    [data]
  );

  const [selected,     setSelected]     = useState<Presupuesto | null>(null);
  const [showForm,     setShowForm]      = useState(false);
  const [editingId,    setEditingId]     = useState<string | null>(null);
  const [form,         setForm]          = useState(emptyPresup());
  const [saving,       setSaving]        = useState(false);
  const [aiLoading,    setAiLoading]     = useState(false);
  const [aiText,       setAiText]        = useState('');
  const [filtroEstado, setFiltroEstado]  = useState<EstadoPresupuesto | 'todos'>('todos');

  // ─── KPIs ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const activos   = presupuestos.filter(p => p.estado !== 'rechazado' && p.estado !== 'caducado');
    const aceptados = presupuestos.filter(p => p.estado === 'aceptado');
    const enviados  = presupuestos.filter(p => p.estado === 'enviado');
    const totalPipe = activos.reduce((s,p) => s + calcTotal(p.lineas).total, 0);
    const totalGan  = aceptados.reduce((s,p) => s + calcTotal(p.lineas).total, 0);
    const convRate  = presupuestos.length > 0
      ? Math.round((aceptados.length / presupuestos.filter(p=>p.estado!=='borrador').length || 1) * 100)
      : 0;
    return { totalPipe, totalGan, convRate, nEnviados: enviados.length, nAceptados: aceptados.length };
  }, [presupuestos]);

  // ─── Filtrado ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...presupuestos].sort((a,b) => b.creadoEn.localeCompare(a.creadoEn));
    if (filtroEstado !== 'todos') list = list.filter(p => p.estado === filtroEstado);
    return list;
  }, [presupuestos, filtroEstado]);

  // ─── Contadores ──────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const r: Partial<Record<EstadoPresupuesto|'todos',number>> = { todos: presupuestos.length };
    Object.keys(ESTADO_META).forEach(k => {
      r[k as EstadoPresupuesto] = presupuestos.filter(p => p.estado === k).length;
    });
    return r;
  }, [presupuestos]);

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  const saveList = useCallback(async (list: Presupuesto[]) => {
    setSaving(true);
    try {
      const newData = { ...data, presupuestos: list } as any;
      await onSave(newData);
    } finally { setSaving(false); }
  }, [data, onSave]);

  const handleCreate = async () => {
    if (!form.cliente.trim()) return void toast.info('El cliente es obligatorio.');
    if (form.lineas.every(l => !l.concepto.trim())) return void toast.info('Añade al menos una línea con concepto.');
    const nuevo: Presupuesto = {
      ...form,
      id: `pres-${Date.now()}`,
      num: genNum(presupuestos),
      creadoEn: new Date().toISOString(),
    };
    await saveList([...presupuestos, nuevo]);
    setShowForm(false);
    setForm(emptyPresup());
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    const list = presupuestos.map(p => p.id === editingId ? { ...p, ...form } : p);
    await saveList(list);
    setEditingId(null);
    setSelected(prev => prev ? { ...prev, ...form } : null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este presupuesto permanentemente?')) return;
    await saveList(presupuestos.filter(p => p.id !== id));
    setSelected(null);
  };

  const handleChangeEstado = async (id: string, estado: EstadoPresupuesto) => {
    const list = presupuestos.map(p => p.id === id ? { ...p, estado } : p);
    await saveList(list);
    setSelected(prev => prev ? { ...prev, estado } : null);
  };

  // ─── Generar número de factura de venta automático ─────────────────────────
  const genNumFacturaVenta = () => {
    const y = new Date().getFullYear();
    const prefix = `FV${y}-`;
    const existentes = (data.facturas || []).filter((f: any) =>
      f.tipo === 'venta' && typeof f.num === 'string' && f.num.startsWith(prefix)
    );
    const maxSeq = existentes.reduce((max: number, f: any) => {
      const n = parseInt(f.num.replace(prefix, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  // ─── Convertir a CobroB2B + Factura de venta ──────────────────────────────
  const handleConvertir = async (pres: Presupuesto) => {
    if (!confirm(`¿Aceptar "${pres.num}" y generar factura de venta?\n\nSe creará:\n• Factura de venta oficial\n• Cobro pendiente en Tesorería`)) return;
    const irpfPct = pres.irpfPct || 0;
    const tot = calcTotal(pres.lineas, irpfPct);
    const numFac = genNumFacturaVenta();

    // 1) CobroB2B en Tesorería
    const nuevocobro = {
      id:        `cb2b-${Date.now()}`,
      tipo:      'presupuesto' as const,
      cliente:   pres.cliente,
      concepto:  pres.lineas.map(l => l.concepto).join(' / '),
      total:     tot.total,
      base:      tot.base,
      iva:       tot.iva,
      fecha:     DateUtil.today(),
      vencimiento: pres.fechaEvento || DateUtil.today(),
      paid:      false,
      numFactura: numFac,
      notas:     `Generado desde presupuesto ${pres.num}${irpfPct > 0 ? ` (IRPF ${irpfPct}%)` : ''}`,
      unidad:    pres.unidad,
    };

    // 2) Factura de venta oficial
    const nuevaFactura: any = {
      id:              `fac-${Date.now()}`,
      tipo:            'venta',
      num:             numFac,
      date:            DateUtil.today(),
      cliente:         pres.cliente,
      prov:            pres.cliente,           // para compatibilidad con LibrosIVA
      base:            tot.base,
      tax:             tot.iva,
      total:           tot.total,
      irpfPct:         irpfPct > 0 ? irpfPct : undefined,
      irpfAmount:      tot.irpf > 0 ? tot.irpf : undefined,
      paid:            false,
      reconciled:      false,
      status:          'approved',
      unidad_negocio:  pres.unidad,
      source:          'presupuesto',
      presupuestoId:   pres.id,
      presupuestoNum:  pres.num,
      lineas:          pres.lineas.map(l => ({
        concepto: l.concepto,
        qty:      l.qty,
        precio:   l.precio,
        iva:      l.iva,
        total:    calcLinea(l).total,
      })),
      notas:           `Auto-generada desde presupuesto ${pres.num}${irpfPct > 0 ? ` · IRPF ${irpfPct}%: -${Num.fmt(tot.irpf)}` : ''}`,
    };

    const newData = { ...data } as any;
    if (!newData.cobros_b2b) newData.cobros_b2b = [];
    if (!newData.facturas) newData.facturas = [];
    newData.cobros_b2b.unshift(nuevocobro);
    newData.facturas.unshift(nuevaFactura);
    // Marcar presupuesto como aceptado y con id de cobro + factura
    newData.presupuestos = presupuestos.map(p =>
      p.id === pres.id ? { ...p, estado: 'aceptado', convertidoId: nuevocobro.id, facturaId: nuevaFactura.id } : p
    );
    await onSave(newData);
    setSelected(prev => prev ? { ...prev, estado:'aceptado', convertidoId: nuevocobro.id } : null);
    toast.info(`✅ Factura ${numFac} creada (${Num.fmt(tot.total)})\n→ Cobro pendiente en Tesorería\n→ Factura en Libros IVA Emitidas`);
  };

  // ─── IA: Redactar presupuesto ────────────────────────────────────────────
  const handleIADraft = async (pres: Presupuesto) => {
    setAiLoading(true); setAiText('');
    try {
      const tot = calcTotal(pres.lineas, pres.irpfPct || 0);
      const prompt = `Eres el responsable comercial de "Arume Sake Bar", restaurante japonés premium en Palma de Mallorca.
Redacta un email comercial profesional y cálido para enviar el siguiente presupuesto:

Cliente: ${pres.cliente}
Referencia: ${pres.num}
Fecha evento: ${pres.fechaEvento || 'Por confirmar'}
Servicios: ${pres.lineas.map(l=>`${l.qty}x ${l.concepto} (${Num.fmt(l.precio)}€/ud)`).join(', ')}
Total: ${Num.fmt(tot.total)} (IVA incluido)
Válido: ${pres.validezDias} días

El email debe:
1. Ser cálido pero profesional
2. Mencionar nuestra especialización en sake y cocina japonesa de autor
3. Incluir un párrafo destacando el valor diferencial
4. Terminar con una llamada a la acción clara
5. Máximo 200 palabras`;
      const res = await askAI([{ role: 'user', content: prompt }]);
      setAiText(res.text || '');
    } catch (e) { setAiText(`Error: ${(e as Error).message}`); }
    finally { setAiLoading(false); }
  };

  // ─── Enviar por email ──────────────────────────────────────────────────────
  const buildEmailBody = (pres: Presupuesto) => {
    const tot = calcTotal(pres.lineas, pres.irpfPct || 0);
    return `Estimado/a ${pres.contacto || pres.cliente},

Le adjuntamos el presupuesto ${pres.num} de Arume Sake Bar para su revisión.

DETALLE:
${pres.lineas.map(l => `  • ${l.qty}x ${l.concepto} — ${Num.fmt(calcLinea(l).total)}€`).join('\n')}

  Base imponible: ${Num.fmt(tot.base)}€
  IVA: ${Num.fmt(tot.iva)}€${tot.irpf > 0 ? `\n  Retención IRPF (${pres.irpfPct}%): -${Num.fmt(tot.irpf)}€` : ''}
  TOTAL: ${Num.fmt(tot.total)}€

${pres.fechaEvento ? `Fecha del evento: ${pres.fechaEvento}` : ''}
Validez: ${pres.validezDias} días desde la fecha de emisión.

Quedamos a su disposición para cualquier consulta.

Un cordial saludo,
Arume Sake Bar
Celoso de Palma SL`;
  };

  const handleSendEmail = async (pres: Presupuesto) => {
    const email = pres.email;
    if (!email) {
      toast.info('Este presupuesto no tiene email de cliente. Edítalo para añadir uno.');
      return;
    }

    const tot = calcTotal(pres.lineas, pres.irpfPct || 0);
    const subject = `Presupuesto ${pres.num} — Arume Sake Bar (${Num.fmt(tot.total)}€)`;
    const body = aiText || buildEmailBody(pres);

    // Abrir Gmail compose con datos pre-rellenados
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');

    // Marcar como enviado si estaba en borrador
    if (pres.estado === 'borrador') {
      const list = presupuestos.map(p =>
        p.id === pres.id ? { ...p, estado: 'enviado' as EstadoPresupuesto } : p
      );
      await saveList(list);
      setSelected(prev => prev ? { ...prev, estado: 'enviado' } : null);
      toast.info(`✅ Presupuesto ${pres.num} marcado como enviado`);
    } else {
      toast.info('📧 Gmail abierto con el presupuesto');
    }
  };

  // ─── Export PDF texto ────────────────────────────────────────────────────
  const handleExportXLSX = (pres: Presupuesto) => {
    const tot = calcTotal(pres.lineas, pres.irpfPct || 0);
    const wb  = XLSX.utils.book_new();
    const rows = [
      { '': `PRESUPUESTO ${pres.num}`,  IMPORTE:'' },
      { '': `Cliente: ${pres.cliente}`, IMPORTE:'' },
      { '': `Fecha: ${pres.fecha}`,     IMPORTE:'' },
      { '': `Evento: ${pres.fechaEvento||'—'}`, IMPORTE:'' },
      { '': '', IMPORTE:'' },
      { '': 'CONCEPTO · Cant × Precio', IMPORTE:'TOTAL' },
      ...pres.lineas.map(l => ({
        '': `${l.concepto} · ${l.qty} × ${Num.fmt(l.precio)}€ (IVA ${l.iva}%)`,
        IMPORTE: Num.fmt(calcLinea(l).total),
      })),
      { '': '', IMPORTE:'' },
      { '': 'Base imponible', IMPORTE: Num.fmt(tot.base)  },
      { '': 'IVA',           IMPORTE: Num.fmt(tot.iva)   },
      { '': 'TOTAL',         IMPORTE: Num.fmt(tot.total) },
    ];
    if (pres.notas) rows.push({ '': `Notas: ${pres.notas}`, IMPORTE:'' });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch:45 },{ wch:16 }];
    XLSX.utils.book_append_sheet(wb, ws, pres.num);
    XLSX.writeFile(wb, `Presupuesto_${pres.num}_${pres.cliente.replace(/\s/g,'_')}.xlsx`);
  };

  // ─── Duplicar ────────────────────────────────────────────────────────────
  const handleDuplicate = async (pres: Presupuesto) => {
    const nuevo: Presupuesto = {
      ...pres,
      id:      `pres-${Date.now()}`,
      num:     genNum([...presupuestos, pres]),
      estado:  'borrador',
      creadoEn: new Date().toISOString(),
      convertidoId: undefined,
    };
    await saveList([...presupuestos, nuevo]);
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">

      {/* HEADER */}
      <header className="bg-white p-6 rounded-2xl shadow-sm border border-[color:var(--arume-gray-100)]">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Ventas · B2B</p>
            <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight mt-1">Presupuestos</h2>
            <p className="text-sm text-[color:var(--arume-gray-500)] mt-1">Hoteles · eventos · catering · corporativo</p>
          </div>
          <button onClick={() => { setShowForm(true); setForm(emptyPresup()); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)] transition active:scale-[0.98]">
            <Plus className="w-3.5 h-3.5"/> Nuevo presupuesto
          </button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100">
          {[
            { label:'Pipeline',          val: Num.fmt(kpis.totalPipe),    icon: TrendingUp,    color:'text-indigo-600',  bg:'bg-indigo-50'  },
            { label:'Ganado',            val: Num.fmt(kpis.totalGan),     icon: Star,          color:'text-emerald-600', bg:'bg-emerald-50' },
            { label:'Enviados pendientes', val: String(kpis.nEnviados),   icon: Send,          color:'text-amber-600',   bg:'bg-amber-50'   },
            { label:'Tasa conversión',   val: `${kpis.convRate}%`,         icon: CheckCircle2,  color:'text-teal-600',    bg:'bg-teal-50'    },
          ].map(k => {
            const Icon = k.icon;
            return (
              <div key={k.label} className={cn('flex items-center gap-3 p-4 rounded-2xl', k.bg)}>
                <Icon className={cn('w-6 h-6 flex-shrink-0', k.color)}/>
                <div>
                  <p className="font-black text-slate-800 text-lg leading-tight tabular-nums">{k.val}</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{k.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </header>

      {/* FILTROS */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFiltroEstado('todos')}
          className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition',
            filtroEstado==='todos' ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
          Todos <span className={cn('rounded-full px-1.5 text-[8px] font-black', filtroEstado==='todos'?'bg-white/20':'bg-slate-100 text-slate-500')}>{counts.todos}</span>
        </button>
        {(Object.keys(ESTADO_META) as EstadoPresupuesto[]).map(e => {
          const m    = ESTADO_META[e];
          const Icon = m.icon;
          return (
            <button key={e} onClick={() => setFiltroEstado(e)}
              className={cn('flex items-center gap-1.5 px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition',
                filtroEstado===e ? `${m.bg} ${m.color} ${m.border}` : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
              <Icon className="w-3 h-3"/> {m.label}
              <span className={cn('rounded-full px-1.5 text-[8px] font-black', m.bg)}>{counts[e] || 0}</span>
            </button>
          );
        })}
      </div>

      {/* LISTA */}
      {filtered.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4"/>
          <p className="text-sm font-black text-slate-500">
            {presupuestos.length === 0 ? 'Aún no hay presupuestos' : 'Sin resultados para este filtro'}
          </p>
          {presupuestos.length === 0 && (
            <button onClick={() => setShowForm(true)}
              className="mt-4 px-4 py-2 bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] rounded-xl text-xs font-black uppercase hover:bg-[color:var(--arume-gray-700)] transition">
              Crear Primer Presupuesto
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(pres => {
            const tot = calcTotal(pres.lineas, pres.irpfPct || 0);
            const caducado = pres.estado === 'enviado' && pres.fecha &&
              new Date(pres.fecha).getTime() + pres.validezDias * 86400000 < Date.now();
            return (
              <motion.div key={pres.id} whileHover={{y:-2}}
                className={cn('bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all overflow-hidden cursor-pointer',
                  caducado ? 'border-amber-200' : 'border-slate-100')}
                onClick={() => setSelected(pres)}>
                {caducado && (
                  <div className="bg-amber-50 border-b border-amber-100 px-4 py-1.5 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0"/>
                    <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest">Presupuesto caducado</p>
                  </div>
                )}
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{pres.num}</p>
                        <EstadoBadge estado={pres.estado}/>
                      </div>
                      <p className="font-black text-slate-800 truncate">{pres.cliente}</p>
                      {pres.fechaEvento && (
                        <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1 mt-0.5">
                          <Calendar className="w-3 h-3"/> Evento: {pres.fechaEvento}
                        </p>
                      )}
                    </div>
                    <p className="text-xl font-black text-slate-800 tabular-nums flex-shrink-0">{Num.fmt(tot.total)}</p>
                  </div>

                  <div className="text-[10px] text-slate-400 mb-3 space-y-0.5">
                    {pres.lineas.slice(0,2).map(l => (
                      <p key={l.id} className="truncate">· {l.concepto} ({l.qty}×{Num.fmt(l.precio)}€)</p>
                    ))}
                    {pres.lineas.length > 2 && <p className="text-indigo-400">+{pres.lineas.length-2} líneas más</p>}
                  </div>

                  <div className="flex gap-2">
                    <button onClick={e => { e.stopPropagation(); handleDuplicate(pres); }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 text-slate-500 rounded-lg text-[9px] font-black uppercase hover:bg-slate-100 transition border border-slate-100">
                      <Copy className="w-3 h-3"/> Duplicar
                    </button>
                    <button onClick={e => { e.stopPropagation(); setSelected(pres); }}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-[9px] font-black uppercase hover:bg-indigo-100 transition">
                      <ChevronRight className="w-3 h-3"/> Ver
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* MODAL DETALLE / ACCIONES */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
            onClick={e => { if (e.target===e.currentTarget) { setSelected(null); setEditingId(null); setAiText(''); } }}>
            <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
              className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

              {/* Header modal */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-black text-indigo-600 text-sm">{selected.num}</p>
                    <EstadoBadge estado={selected.estado}/>
                  </div>
                  <p className="font-black text-slate-800">{selected.cliente}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleExportXLSX(selected)}
                    title="Exportar Excel" className="p-2 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition">
                    <Download className="w-4 h-4 text-emerald-600"/>
                  </button>
                  <button onClick={() => { setEditingId(selected.id); setForm({...selected}); }}
                    className="p-2 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition">
                    <Edit3 className="w-4 h-4 text-indigo-600"/>
                  </button>
                  <button onClick={() => { setSelected(null); setAiText(''); }}
                    className="p-2 hover:bg-slate-200 rounded-xl transition">
                    <X className="w-4 h-4 text-slate-500"/>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">

                {/* Tabla líneas */}
                <div className="rounded-2xl overflow-hidden border border-slate-100">
                  <div className="grid grid-cols-12 bg-slate-50 px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    <span className="col-span-5">Concepto</span>
                    <span className="col-span-2 text-right">Qty</span>
                    <span className="col-span-2 text-right">P.Unit</span>
                    <span className="col-span-1 text-center">IVA</span>
                    <span className="col-span-2 text-right">Total</span>
                  </div>
                  {selected.lineas.map(l => {
                    const c = calcLinea(l);
                    return (
                      <div key={l.id} className="grid grid-cols-12 px-4 py-3 border-t border-slate-50 text-xs">
                        <span className="col-span-5 font-bold text-slate-700 truncate">{l.concepto}</span>
                        <span className="col-span-2 text-right text-slate-500">{l.qty}</span>
                        <span className="col-span-2 text-right text-slate-500">{Num.fmt(l.precio)}€</span>
                        <span className="col-span-1 text-center text-slate-400">{l.iva}%</span>
                        <span className="col-span-2 text-right font-black text-slate-800 tabular-nums">{Num.fmt(c.total)}</span>
                      </div>
                    );
                  })}
                  {/* Totales */}
                  {(() => { const t = calcTotal(selected.lineas, selected.irpfPct || 0); return (
                    <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 space-y-1">
                      <div className="flex justify-between text-xs text-slate-500"><span>Base imponible</span><span className="font-bold">{Num.fmt(t.base)}</span></div>
                      <div className="flex justify-between text-xs text-slate-500"><span>IVA</span><span className="font-bold">{Num.fmt(t.iva)}</span></div>
                      {t.irpf > 0 && (
                        <div className="flex justify-between text-xs text-amber-600"><span>IRPF retención ({selected.irpfPct}%)</span><span className="font-bold">-{Num.fmt(t.irpf)}</span></div>
                      )}
                      <div className="flex justify-between text-sm font-black text-slate-900 pt-1 border-t border-slate-200"><span>TOTAL</span><span>{Num.fmt(t.total)}</span></div>
                    </div>
                  ); })()}
                </div>

                {/* Info adicional */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {[
                    { label:'Fecha emisión', val: selected.fecha },
                    { label:'Fecha evento',  val: selected.fechaEvento || '—' },
                    { label:'Validez',       val: `${selected.validezDias} días` },
                    { label:'Unidad',        val: UNIDADES.find(u=>u.id===selected.unidad)?.label || selected.unidad },
                  ].map(f => (
                    <div key={f.label} className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] text-slate-400 font-bold uppercase">{f.label}</p>
                      <p className="font-black text-slate-700 mt-0.5">{f.val}</p>
                    </div>
                  ))}
                </div>
                {selected.notas && (
                  <div className="bg-slate-50 rounded-2xl p-4">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Notas</p>
                    <p className="text-xs text-slate-600">{selected.notas}</p>
                  </div>
                )}

                {/* Cambio de estado */}
                {selected.estado !== 'aceptado' && selected.estado !== 'caducado' && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cambiar estado</p>
                    <div className="flex flex-wrap gap-2">
                      {(['enviado','aceptado','rechazado','caducado'] as EstadoPresupuesto[])
                        .filter(e => e !== selected.estado)
                        .map(e => {
                          const m = ESTADO_META[e]; const Icon = m.icon;
                          return (
                            <button key={e} onClick={() => handleChangeEstado(selected.id, e)}
                              className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase border transition hover:shadow-sm',
                                m.color, m.bg, m.border)}>
                              <Icon className="w-3.5 h-3.5"/> {m.label}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* Aceptar → Factura + Cobro */}
                {selected.estado !== 'aceptado' && selected.estado !== 'rechazado' && !selected.convertidoId && (
                  <button onClick={() => handleConvertir(selected)}
                    className="w-full flex items-center justify-center gap-2 py-4 bg-emerald-600 text-white rounded-2xl text-sm font-black uppercase hover:bg-emerald-700 transition shadow-lg">
                    <ArrowRight className="w-4 h-4"/> Aceptar y Generar Factura
                  </button>
                )}
                {selected.convertidoId && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-black text-emerald-700">
                      <CheckCircle2 className="w-4 h-4"/> Cobro creado en Tesorería
                    </div>
                    {(selected as any).facturaId && (
                      <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-2xl text-xs font-black text-blue-700">
                        <FileText className="w-4 h-4"/> Factura de venta generada: {
                          ((data.facturas || []) as any[]).find((f: any) => f.id === (selected as any).facturaId)?.num || '—'
                        }
                      </div>
                    )}
                  </div>
                )}

                {/* Email: IA + Enviar */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button onClick={() => handleIADraft(selected)} disabled={aiLoading}
                      className="flex-1 flex items-center justify-center gap-2 py-3 bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] rounded-2xl text-xs font-black uppercase hover:bg-[color:var(--arume-gray-700)] transition disabled:opacity-50">
                      {aiLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
                      {aiLoading ? 'Generando...' : 'Redactar con IA'}
                    </button>
                    <button onClick={() => handleSendEmail(selected)}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black uppercase transition',
                        selected.email
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      )}
                      disabled={!selected.email}>
                      <Send className="w-4 h-4"/>
                      {selected.email ? 'Enviar Email' : 'Sin email'}
                    </button>
                  </div>
                  {!selected.email && (
                    <p className="text-[9px] text-amber-500 font-bold text-center">
                      Edita el presupuesto para añadir el email del cliente
                    </p>
                  )}
                </div>
                {aiText && (
                  <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1">
                        <Sparkles className="w-3 h-3"/> Borrador Email IA
                      </p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { navigator.clipboard.writeText(aiText); toast.info('Copiado al portapapeles'); }}
                          className="text-[9px] font-black text-indigo-500 hover:text-indigo-700 flex items-center gap-1">
                          <Copy className="w-3 h-3"/> Copiar
                        </button>
                        {selected.email && (
                          <button onClick={() => handleSendEmail(selected)}
                            className="text-[9px] font-black text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                            <Send className="w-3 h-3"/> Enviar este
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{aiText}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-slate-100 p-4 flex gap-3 shrink-0 flex-wrap">
                <button onClick={() => handleDelete(selected.id)}
                  className="px-4 py-2.5 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl font-black text-[10px] uppercase hover:bg-rose-100 transition">
                  <Trash2 className="w-3.5 h-3.5"/>
                </button>
                <button onClick={() => handleDuplicate(selected)}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase hover:bg-slate-200 transition">
                  <Copy className="w-3.5 h-3.5"/> Duplicar
                </button>
                <button onClick={() => handleExportXLSX(selected)}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-600 rounded-xl font-black text-[10px] uppercase hover:bg-emerald-100 transition">
                  <Download className="w-3.5 h-3.5"/> Excel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL NUEVO / EDITAR */}
      <AnimatePresence>
        {(showForm || editingId) && (
          <PresupuestoFormModal
            form={form} setForm={setForm} saving={saving}
            onClose={() => { setShowForm(false); setEditingId(null); }}
            onSave={editingId ? handleUpdate : handleCreate}
            titulo={editingId ? 'Editar Presupuesto' : 'Nuevo Presupuesto'}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// FORMULARIO CREAR / EDITAR
// ════════════════════════════════════════════════════════════════════════════
const PresupuestoFormModal: React.FC<{
  form: any; setForm: (f:any)=>void; saving:boolean;
  onClose:()=>void; onSave:()=>void; titulo:string;
}> = ({ form, setForm, saving, onClose, onSave, titulo }) => {

  const tot = calcTotal(form.lineas || [], form.irpfPct || 0);

  const addLinea = () => setForm({ ...form, lineas: [...(form.lineas||[]), emptyLinea()] });
  const removeLinea = (id:string) => setForm({ ...form, lineas: (form.lineas||[]).filter((l:LineaPresupuesto)=>l.id!==id) });
  const updateLinea = (id:string, field:string, val:any) =>
    setForm({ ...form, lineas: (form.lineas||[]).map((l:LineaPresupuesto) => l.id===id ? {...l,[field]:val} : l) });

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4"
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
        className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-black text-slate-800">{titulo}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition"><X className="w-4 h-4 text-slate-500"/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">

          {/* Datos cliente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { key:'cliente',     label:'Cliente *',   type:'text'  },
              { key:'contacto',    label:'Contacto',    type:'text'  },
              { key:'email',       label:'Email',       type:'email' },
              { key:'fecha',       label:'Fecha',       type:'date'  },
              { key:'fechaEvento', label:'Fecha Evento',type:'date'  },
              { key:'validezDias', label:'Validez (días)',type:'number'},
            ].map(f => (
              <div key={f.key}>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">{f.label}</label>
                <input type={f.type} value={form[f.key]||''}
                  onChange={e => setForm({...form,[f.key]: f.type==='number'?Number(e.target.value):e.target.value})}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition"/>
              </div>
            ))}
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Unidad</label>
              <select value={form.unidad||'DLV'} onChange={e => setForm({...form,unidad:e.target.value})}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition">
                {UNIDADES.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Retención IRPF</label>
              <select value={form.irpfPct || 0} onChange={e => setForm({...form, irpfPct: Number(e.target.value)})}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition">
                <option value={0}>Sin retención</option>
                <option value={7}>7% (inicio actividad)</option>
                <option value={15}>15% (estándar)</option>
                <option value={19}>19% (arrendamientos)</option>
              </select>
            </div>
          </div>

          {/* Líneas */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Líneas del presupuesto</label>
              <button onClick={addLinea}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black hover:bg-indigo-100 transition">
                <Plus className="w-3 h-3"/> Añadir línea
              </button>
            </div>

            <div className="space-y-2">
              {(form.lineas||[]).map((l:LineaPresupuesto) => {
                const c = calcLinea(l);
                return (
                  <div key={l.id} className="grid grid-cols-12 gap-2 items-center bg-slate-50 rounded-2xl p-3">
                    <input value={l.concepto} placeholder="Concepto..."
                      onChange={e => updateLinea(l.id,'concepto',e.target.value)}
                      className="col-span-4 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-indigo-400"/>
                    <input type="number" value={l.qty} min={1}
                      onChange={e => updateLinea(l.id,'qty',Number(e.target.value))}
                      className="col-span-2 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-center focus:outline-none focus:border-indigo-400" placeholder="Qty"/>
                    <input type="number" value={l.precio} min={0} step={0.01}
                      onChange={e => updateLinea(l.id,'precio',Number(e.target.value))}
                      className="col-span-2 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-right focus:outline-none focus:border-indigo-400" placeholder="€/ud"/>
                    <select value={l.iva} onChange={e => updateLinea(l.id,'iva',Number(e.target.value))}
                      className="col-span-2 bg-white border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold focus:outline-none focus:border-indigo-400">
                      <option value={10}>10%</option>
                      <option value={21}>21%</option>
                    </select>
                    <div className="col-span-1 text-xs font-black text-right text-slate-700 tabular-nums pr-1">{Num.fmt(c.total)}</div>
                    <button onClick={() => removeLinea(l.id)} disabled={(form.lineas||[]).length<=1}
                      className="col-span-1 flex items-center justify-center p-1.5 text-rose-300 hover:text-rose-500 disabled:opacity-20 transition">
                      <X className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Total */}
            <div className="flex justify-end gap-6 mt-4 px-4 py-3 bg-slate-900 rounded-2xl text-white text-xs">
              <div className="text-center"><p className="text-slate-400 font-bold">Base</p><p className="font-black tabular-nums">{Num.fmt(tot.base)}</p></div>
              <div className="text-center"><p className="text-slate-400 font-bold">IVA</p><p className="font-black tabular-nums">{Num.fmt(tot.iva)}</p></div>
              {tot.irpf > 0 && (
                <div className="text-center"><p className="text-amber-400 font-bold">IRPF -{(form as any).irpfPct}%</p><p className="font-black tabular-nums text-amber-300">-{Num.fmt(tot.irpf)}</p></div>
              )}
              <div className="text-center"><p className="text-slate-300 font-bold">TOTAL</p><p className="font-black text-lg tabular-nums">{Num.fmt(tot.total)}</p></div>
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Notas internas</label>
            <textarea value={form.notas||''} rows={2}
              onChange={e => setForm({...form,notas:e.target.value})}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 transition resize-none"/>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase hover:bg-slate-200 transition">Cancelar</button>
          <button onClick={onSave} disabled={saving}
            className="flex-1 py-3 bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] rounded-2xl font-black text-xs uppercase hover:bg-[color:var(--arume-gray-700)] transition flex items-center justify-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>} Guardar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
