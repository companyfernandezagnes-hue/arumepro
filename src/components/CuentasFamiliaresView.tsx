/**
 * CuentasFamiliaresView.tsx — Librito privado familiar
 * ───────────────────────────────────────────────────────
 * Vista PRIVADA para Agnès. NO sale en el Excel de gestoría.
 * Su propósito: llevar cuentas internas entre Celoso de Palma SL
 * y los familiares que gastan con el CIF de la empresa.
 *
 * Flujo real:
 *  - Agnès/Pau compran algo para Arume → se guarda albarán con socio='Agnès'/'Pau'
 *  - La empresa lo paga (albarán marcado como paid=true) → Agnès/Pau le DEBEN
 *    el importe a la empresa (son gastos personales que pasaron por el CIF)
 *  - Cuando se saldan → botón "Marcar como saldado"
 *
 * También permite registrar movimientos manuales (adelantos, préstamos internos,
 * gastos sin factura, etc.).
 */
import React, { useMemo, useState, useCallback } from 'react';
import {
  Users, AlertCircle, CheckCircle2, Plus, Trash2, Download,
  ArrowDownRight, ArrowUpRight, Scale, Eye, EyeOff, Calendar,
  FileText, Landmark, X, User
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { AppData, MovimientoInterno, Albaran } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

interface Props {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

const newId = () => `mi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const CuentasFamiliaresView: React.FC<Props> = ({ data, onSave }) => {
  const [ocultar, setOcultar]   = useState(false);
  const [showAdd, setShowAdd]   = useState(false);
  const [selectedYear, setYear] = useState(new Date().getFullYear());
  const [form, setForm]         = useState({
    socio: '',
    fecha: DateUtil.today(),
    concepto: '',
    importe: 0,
    notas: '',
  });

  const movimientos = (data.cuentas_internas || []) as MovimientoInterno[];
  const socios      = (data.socios || []).filter(s => s.active);
  const nombresFamilia = useMemo(
    () => socios
      .filter((s: any) => s.role === 'socio_fundador' || s.role === 'operativo')
      .map(s => s.n),
    [socios]
  );

  // ─── Auto-generar movimientos a partir de albaranes con socio ────────
  // (si el albarán tiene socio y está pagado por la empresa, significa
  // que el familiar debe ese importe a la empresa)
  const movsDesdeAlbaranes = useMemo(() => {
    const albs = (data.albaranes || []) as Albaran[];
    return albs
      .filter((a: any) =>
        a.socio && a.paid &&
        nombresFamilia.some(n => n.toUpperCase() === String(a.socio).toUpperCase()) &&
        String(a.date || '').startsWith(String(selectedYear))
      )
      .map((a: any): MovimientoInterno => ({
        id: `auto-${a.id}`,
        socio: a.socio,
        fecha: a.date,
        concepto: `${a.prov || 'Compra'} · Ref ${a.num || '—'}`,
        importe: -Math.abs(Num.parse(a.total || 0)), // negativo: el familiar debe
        origen: 'albaran',
        albaranId: a.id,
        saldado: !!movimientos.find(m => m.albaranId === a.id && m.saldado),
      }));
  }, [data.albaranes, nombresFamilia, selectedYear, movimientos]);

  // Combinar manuales + automáticos, filtrando por año
  const todos = useMemo(() => {
    const manuales = movimientos.filter(m =>
      m.origen !== 'albaran' && String(m.fecha || '').startsWith(String(selectedYear))
    );
    const combined = [...movsDesdeAlbaranes, ...manuales];
    return combined.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }, [movsDesdeAlbaranes, movimientos, selectedYear]);

  // ─── Saldos por persona ──────────────────────────────────────────────
  const saldosPorSocio = useMemo(() => {
    const map: Record<string, { debe: number; leDebemos: number; neto: number; count: number }> = {};
    nombresFamilia.forEach(n => { map[n] = { debe: 0, leDebemos: 0, neto: 0, count: 0 }; });

    todos.filter(m => !m.saldado).forEach(m => {
      const key = m.socio;
      if (!map[key]) map[key] = { debe: 0, leDebemos: 0, neto: 0, count: 0 };
      if (m.importe < 0) map[key].debe += Math.abs(m.importe);
      else                map[key].leDebemos += m.importe;
      map[key].count++;
    });
    Object.keys(map).forEach(k => {
      map[k].neto = Num.round2(map[k].leDebemos - map[k].debe);
      map[k].debe = Num.round2(map[k].debe);
      map[k].leDebemos = Num.round2(map[k].leDebemos);
    });
    return map;
  }, [todos, nombresFamilia]);

  const totalesGlobal = useMemo(() => {
    const total = Object.values(saldosPorSocio).reduce(
      (acc, s) => ({
        debe:      acc.debe + s.debe,
        leDebemos: acc.leDebemos + s.leDebemos,
        neto:      acc.neto + s.neto,
      }),
      { debe: 0, leDebemos: 0, neto: 0 }
    );
    return {
      debe:      Num.round2(total.debe),
      leDebemos: Num.round2(total.leDebemos),
      neto:      Num.round2(total.neto),
    };
  }, [saldosPorSocio]);

  // ─── Handlers ────────────────────────────────────────────────────────
  const saveMovs = useCallback(async (lista: MovimientoInterno[]) => {
    await onSave({ ...data, cuentas_internas: lista });
  }, [data, onSave]);

  const addManual = async () => {
    if (!form.socio || !form.concepto || !form.importe) {
      toast.warning('Rellena socio, concepto e importe');
      return;
    }
    const nuevo: MovimientoInterno = {
      id: newId(),
      socio: form.socio,
      fecha: form.fecha,
      concepto: form.concepto,
      importe: Number(form.importe),
      origen: 'manual',
      saldado: false,
      notas: form.notas,
    };
    await saveMovs([...movimientos, nuevo]);
    setShowAdd(false);
    setForm({ socio: '', fecha: DateUtil.today(), concepto: '', importe: 0, notas: '' });
    toast.success('Movimiento añadido');
  };

  const toggleSaldado = async (mov: MovimientoInterno) => {
    if (mov.origen === 'albaran') {
      // es sintético; lo guardamos como registro real saldado apuntando al albaranId
      const existe = movimientos.find(m => m.albaranId === mov.albaranId);
      if (existe) {
        const actualizado = movimientos.map(m =>
          m.albaranId === mov.albaranId
            ? { ...m, saldado: !m.saldado, fechaSaldado: !m.saldado ? DateUtil.today() : undefined }
            : m
        );
        await saveMovs(actualizado);
      } else {
        await saveMovs([...movimientos, {
          ...mov, id: newId(), saldado: true, fechaSaldado: DateUtil.today()
        }]);
      }
      toast.success(mov.saldado ? 'Marcado como pendiente' : '✓ Saldado');
      return;
    }
    const actualizados = movimientos.map(m =>
      m.id === mov.id
        ? { ...m, saldado: !m.saldado, fechaSaldado: !m.saldado ? DateUtil.today() : undefined }
        : m
    );
    await saveMovs(actualizados);
    toast.success(mov.saldado ? 'Marcado como pendiente' : '✓ Saldado');
  };

  const eliminar = async (id: string) => {
    const ok = await confirm({ title: '¿Eliminar movimiento?', danger: true });
    if (!ok) return;
    await saveMovs(movimientos.filter(m => m.id !== id));
    toast.success('Eliminado');
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const rows = todos.map(m => ({
      FECHA:    m.fecha,
      PERSONA:  m.socio,
      CONCEPTO: m.concepto,
      IMPORTE:  Num.fmt(m.importe),
      TIPO:     m.importe < 0 ? 'Debe a la empresa' : 'La empresa le debe',
      ESTADO:   m.saldado ? 'Saldado' : 'Pendiente',
      ORIGEN:   m.origen,
      NOTAS:    m.notas || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, `Cuentas_${selectedYear}`);

    const resumen = Object.entries(saldosPorSocio).map(([n, s]) => ({
      PERSONA: n, 'PENDIENTE DEBE': Num.fmt(s.debe), 'PENDIENTE COBRAR': Num.fmt(s.leDebemos), 'NETO': Num.fmt(s.neto),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen');

    XLSX.writeFile(wb, `Cuentas_Familiares_${selectedYear}.xlsx`);
    toast.success('Exportado para papá');
  };

  // ─── RENDER ──────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1400px] mx-auto">

      {/* HEADER con aviso de privacidad */}
      <header className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 md:p-8 rounded-[2.5rem] shadow-xl">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="px-2 py-0.5 bg-rose-500/20 border border-rose-400/40 rounded-full text-[9px] font-black uppercase tracking-widest text-rose-300 flex items-center gap-1">
                <Lock /> Vista privada
              </div>
              <div className="px-2 py-0.5 bg-amber-500/20 border border-amber-400/40 rounded-full text-[9px] font-black uppercase tracking-widest text-amber-300">
                No sale en gestoría
              </div>
            </div>
            <h2 className="text-3xl font-black tracking-tighter">Cuentas Familiares Internas</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-lg">
              Librito privado entre Celoso de Palma SL y los familiares. Muestra qué gastos personales pasaron por el CIF de la empresa y están pendientes de saldar.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <select value={selectedYear} onChange={e => setYear(Number(e.target.value))}
              className="bg-slate-700/50 text-white border border-slate-600 rounded-xl px-3 py-2 text-sm font-bold cursor-pointer">
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => setOcultar(v => !v)}
              className="px-3 py-2 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
              {ocultar ? <Eye className="w-3 h-3"/> : <EyeOff className="w-3 h-3"/>}
              {ocultar ? 'Mostrar importes' : 'Ocultar importes'}
            </button>
          </div>
        </div>
      </header>

      {/* KPIs globales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <ArrowDownRight className="w-3 h-3 text-rose-500"/> Familia debe a la empresa
          </p>
          <p className="text-3xl font-black text-rose-600 tabular-nums">
            {ocultar ? '••••' : Num.fmt(totalesGlobal.debe)}
          </p>
        </div>
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <ArrowUpRight className="w-3 h-3 text-emerald-500"/> Empresa debe a familia
          </p>
          <p className="text-3xl font-black text-emerald-600 tabular-nums">
            {ocultar ? '••••' : Num.fmt(totalesGlobal.leDebemos)}
          </p>
        </div>
        <div className={cn('p-6 rounded-[2rem] border shadow-lg',
          totalesGlobal.neto >= 0
            ? 'bg-emerald-600 border-emerald-700 text-white'
            : 'bg-rose-600 border-rose-700 text-white')}>
          <p className="text-[10px] font-black opacity-80 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Scale className="w-3 h-3"/> Saldo neto
          </p>
          <p className="text-3xl font-black tabular-nums">
            {ocultar ? '••••' : (totalesGlobal.neto >= 0 ? '+' : '') + Num.fmt(totalesGlobal.neto)}
          </p>
          <p className="text-[10px] font-bold opacity-80 mt-1">
            {totalesGlobal.neto >= 0 ? 'La empresa tiene que pagar a familia' : 'La familia tiene que saldar con la empresa'}
          </p>
        </div>
      </div>

      {/* Tarjetas por persona */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(saldosPorSocio).filter(([, s]) => s.count > 0 || nombresFamilia.length <= 4).map(([nombre, s]) => (
          <div key={nombre} className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-100 to-indigo-50 flex items-center justify-center text-indigo-700 font-black">
                {nombre.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-black text-slate-800">{nombre}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{s.count} mov. pendientes</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Debe a empresa</span>
                <span className="font-black text-rose-600 tabular-nums">{ocultar ? '••••' : Num.fmt(s.debe)}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Empresa le debe</span>
                <span className="font-black text-emerald-600 tabular-nums">{ocultar ? '••••' : Num.fmt(s.leDebemos)}</span>
              </div>
              <div className="border-t border-slate-100 pt-2 flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Neto</span>
                <span className={cn('text-base font-black tabular-nums',
                  s.neto >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  {ocultar ? '••••' : ((s.neto >= 0 ? '+' : '') + Num.fmt(s.neto))}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2.5 bg-indigo-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition flex items-center gap-2 shadow-sm">
            <Plus className="w-3.5 h-3.5"/> Añadir movimiento
          </button>
          <button onClick={exportExcel}
            className="px-4 py-2.5 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition flex items-center gap-2 shadow-sm">
            <Download className="w-3.5 h-3.5"/> Excel para Papá
          </button>
        </div>
        <p className="text-[10px] text-slate-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3"/> Los albaranes con socio asignado aparecen aquí automáticamente
        </p>
      </div>

      {/* Lista de movimientos */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-500"/>
          <h3 className="text-sm font-black text-slate-800">Movimientos · {selectedYear}</h3>
          <span className="text-[10px] text-slate-400 ml-auto">{todos.length} registros</span>
        </div>

        {todos.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Landmark className="w-10 h-10 mx-auto mb-3 opacity-40"/>
            <p className="text-xs font-bold">Sin movimientos en {selectedYear}</p>
            <p className="text-[10px] mt-1">Los albaranes con socio asignado aparecerán aquí automáticamente.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {todos.map(m => (
              <div key={m.id}
                className={cn('px-6 py-3 flex items-center gap-4 hover:bg-slate-50 transition',
                  m.saldado && 'opacity-50')}>
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-black text-xs flex-shrink-0">
                  {m.socio.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-800 truncate flex items-center gap-2">
                    {m.socio}
                    {m.saldado && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500"/>}
                    {m.origen === 'albaran' && (
                      <span className="text-[8px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-black uppercase tracking-widest">AUTO</span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{m.concepto}</p>
                  <p className="text-[9px] text-slate-400 mt-0.5 flex items-center gap-2">
                    <Calendar className="w-2.5 h-2.5"/> {m.fecha}
                    {m.saldado && m.fechaSaldado && <span>· Saldado {m.fechaSaldado}</span>}
                  </p>
                </div>
                <div className={cn('text-sm font-black tabular-nums flex-shrink-0',
                  m.importe < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                  {ocultar ? '••••' : ((m.importe >= 0 ? '+' : '') + Num.fmt(m.importe))}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => toggleSaldado(m)}
                    className={cn('px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition',
                      m.saldado
                        ? 'bg-white border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-500'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700')}>
                    {m.saldado ? 'Revertir' : '✓ Saldar'}
                  </button>
                  {m.origen !== 'albaran' && (
                    <button onClick={() => eliminar(m.id)}
                      className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal añadir */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowAdd(false)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-[2rem] p-6 w-full max-w-md shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-black text-slate-800">Nuevo movimiento</h3>
                <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-slate-100 rounded-lg">
                  <X className="w-4 h-4"/>
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Persona</label>
                  <select value={form.socio} onChange={e => setForm({ ...form, socio: e.target.value })}
                    className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold">
                    <option value="">Selecciona...</option>
                    {nombresFamilia.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fecha</label>
                  <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })}
                    className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"/>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Concepto</label>
                  <input type="text" value={form.concepto} onChange={e => setForm({ ...form, concepto: e.target.value })}
                    placeholder="p.ej. Adelanto sueldo, Devolución personal, etc."
                    className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"/>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Importe (€)</label>
                  <input type="number" step="0.01" value={form.importe} onChange={e => setForm({ ...form, importe: Number(e.target.value) })}
                    className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black"/>
                  <p className="text-[10px] text-slate-400 mt-1">
                    <span className="font-bold">Positivo</span>: la empresa le debe a él/ella.<br/>
                    <span className="font-bold">Negativo</span>: él/ella debe a la empresa.
                  </p>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Notas (opcional)</label>
                  <textarea value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })}
                    rows={2}
                    className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"/>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowAdd(false)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition">
                  Cancelar
                </button>
                <button onClick={addManual}
                  className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition">
                  Guardar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Icono Lock compacto (inline svg)
const Lock = () => (
  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);
