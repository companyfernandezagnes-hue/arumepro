import React, { useState, useRef, useMemo } from 'react';
import {
  FileText, FileArchive, Download, Upload,
  ShieldCheck, AlertTriangle, Loader2, Filter,
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { AppData, FacturaExtended, Albaran } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

interface ExportToolsProps {
  db: AppData | null;
  onSave: (newData: AppData) => void | Promise<void>;
}

const ArrowRight = ({ className }: { className?: string }) => (
  <svg className={cn('w-4 h-4 transition-transform group-hover:translate-x-0.5', className)}
    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

// ── Helpers ────────────────────────────────────────────────────────────────
const tsFile = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
};

const QUARTERS = [
  { label: 'Todo',  value: 'all'  },
  { label: 'Q1',    value: 'Q1'   },
  { label: 'Q2',    value: 'Q2'   },
  { label: 'Q3',    value: 'Q3'   },
  { label: 'Q4',    value: 'Q4'   },
];

const quarterMonths: Record<string, number[]> = {
  Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12],
};

const inQuarter = (dateStr: string, q: string): boolean => {
  if (q === 'all') return true;
  const month = parseInt(dateStr?.slice(5, 7) || '0', 10);
  return (quarterMonths[q] || []).includes(month);
};

// ── Años disponibles ──────────────────────────────────────────────────────
const getYears = (db: AppData): string[] => {
  const years = new Set<string>();
  [...(db.facturas||[]), ...(db.albaranes||[])].forEach((r: any) => {
    const y = r?.date?.slice(0,4);
    if (y) years.add(y);
  });
  const sorted = Array.from(years).sort().reverse();
  return sorted.length ? sorted : [String(new Date().getFullYear())];
};

export const ExportTools: React.FC<ExportToolsProps> = ({ db, onSave }) => {
  const [isExporting,   setIsExporting]   = useState(false);
  const [filterQ,       setFilterQ]       = useState('all');
  const [filterYear,    setFilterYear]    = useState<string>('');
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const years = useMemo(() => db ? getYears(db) : [], [db]);

  // Año activo: el seleccionado o el más reciente
  const activeYear = filterYear || years[0] || String(new Date().getFullYear());

  if (!db) return null;

  // ── Contadores para los botones ──────────────────────────────────────────
  const counts = useMemo(() => {
    const filt = (arr: any[]) => arr.filter(r =>
      r?.date?.startsWith(activeYear) && inQuarter(r?.date || '', filterQ)
    );
    return {
      facturas:  filt(db.facturas  || []).length,
      albaranes: filt(db.albaranes || []).length,
      banco:     (db.banco || []).filter(m => m?.date?.startsWith(activeYear)).length,
      gastos:    (db.gastos_fijos || []).filter((g: any) => g?.active).length,
    };
  }, [db, activeYear, filterQ]);

  // ── Export Excel ──────────────────────────────────────────────────────────
  const exportToExcel = () => {
    setIsExporting(true);
    try {
      const wb  = XLSX.utils.book_new();
      const ts  = tsFile();
      const label = filterQ === 'all' ? activeYear : `${activeYear}_${filterQ}`;

      const facFilt = (db.facturas || []).filter((f: FacturaExtended) =>
        f?.date?.startsWith(activeYear) && inQuarter(f?.date || '', filterQ)
      );
      if (facFilt.length > 0) {
        const rows = facFilt.map((f: FacturaExtended) => {
          const total = Math.abs(Num.parse(f?.total) || 0);
          const base  = Num.parse(f?.base) || Num.round2(total / 1.10);
          const tax   = Num.parse(f?.tax)  || Num.round2(total - base);
          return {
            'Nº FACTURA'       : String(f?.num  || 'S/N'),
            'FECHA'            : String(f?.date || ''),
            'TIPO'             : String(f?.tipo || '').toUpperCase(),
            'PROVEEDOR/CLIENTE': String(f?.prov || f?.cliente || 'DESCONOCIDO'),
            'UNIDAD NEGOCIO'   : String(f?.unidad_negocio || 'REST'),
            'BASE IMPONIBLE'   : Num.fmt(base),
            'IVA'              : Num.fmt(tax),
            'TOTAL'            : Num.fmt(total),
            'PAGADA'           : f?.paid       ? 'SÍ' : 'NO',
            'CONCILIADA BCO'   : f?.reconciled ? 'SÍ' : 'NO',
            'ORIGEN'           : String(f?.source || 'MANUAL'),
          };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{wch:15},{wch:12},{wch:10},{wch:35},{wch:15},{wch:15},{wch:12},{wch:12},{wch:10},{wch:15},{wch:15}];
        XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
      }

      const albFilt = (db.albaranes || []).filter((a: Albaran) =>
        a?.date?.startsWith(activeYear) && inQuarter(a?.date || '', filterQ)
      );
      if (albFilt.length > 0) {
        const rows = albFilt.map((a: Albaran) => ({
          'Nº ALBARÁN' : String(a?.num  || 'S/N'),
          'FECHA'      : String(a?.date || ''),
          'PROVEEDOR'  : String(a?.prov || 'Varios'),
          'SOCIO'      : String(a?.socio || 'Arume'),
          'BASE'       : Num.fmt(Math.abs(Num.parse(a?.base)  || 0)),
          'IVA'        : Num.fmt(Math.abs(Num.parse(a?.taxes) || 0)),
          'TOTAL'      : Num.fmt(Math.abs(Num.parse(a?.total) || 0)),
          'FACTURADO'  : a?.invoiced   ? 'SÍ' : 'NO',
          'PAGADO'     : a?.paid       ? 'SÍ' : 'NO',
          'CONCILIADO' : a?.reconciled ? 'SÍ' : 'NO',
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{wch:15},{wch:12},{wch:30},{wch:15},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12}];
        XLSX.utils.book_append_sheet(wb, ws, 'Albaranes');
      }

      // 🆕 Hoja de Gastos Fijos activos (útil para la gestoría)
      if (Array.isArray(db.gastos_fijos) && db.gastos_fijos.length > 0) {
        const rows = (db.gastos_fijos as any[])
          .filter(g => g?.active)
          .map(g => ({
            'NOMBRE'      : String(g?.name      || ''),
            'CATEGORÍA'   : String(g?.cat       || ''),
            'IMPORTE'     : Num.fmt(Math.abs(Num.parse(g?.amount) || 0)),
            'FRECUENCIA'  : String(g?.freq      || 'mensual'),
            'DÍA PAGO'    : String(g?.dia_pago  || ''),
            'UNIDAD'      : String(g?.unitId    || 'CORP'),
            'NOTAS'       : String(g?.notes     || ''),
          }));
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{wch:30},{wch:15},{wch:12},{wch:12},{wch:10},{wch:10},{wch:30}];
        XLSX.utils.book_append_sheet(wb, ws, 'Gastos Fijos');
      }

      const bancoFilt = (db.banco || []).filter((m: any) => m?.date?.startsWith(activeYear));
      if (bancoFilt.length > 0) {
        const rows = bancoFilt.map((m: any) => ({
          'FECHA'      : String(m?.date    || ''),
          'IMPORTE'    : Num.parse(m?.amount) || 0,
          'DESCRIPCIÓN': String(m?.desc    || ''),
          'ESTADO'     : String(m?.status  || 'pending'),
          'CATEGORÍA'  : String(m?.category || ''),
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{wch:12},{wch:12},{wch:45},{wch:12},{wch:20}];
        XLSX.utils.book_append_sheet(wb, ws, 'Banco');
      }

      // 🆕 FIX: toast en vez de alert()
      if (wb.SheetNames.length === 0) {
        toast.warning('No hay datos para exportar en el período seleccionado.');
        return;
      }

      XLSX.writeFile(wb, `Contabilidad_Arume_${label}_${ts}.xlsx`);
      toast.success(`Excel generado — ${wb.SheetNames.length} hojas exportadas.`);
    } catch (e) {
      console.error('[ExportTools] Error Excel:', e);
      // 🆕 FIX: toast en vez de alert()
      toast.error('Error al generar el Excel. Comprueba la consola.');
    } finally { setIsExporting(false); }
  };

  // ── Export PDF ────────────────────────────────────────────────────────────
  const exportToPDF = () => {
    setIsExporting(true);
    try {
      const facFilt = (db.facturas || []).filter((f: FacturaExtended) =>
        f?.date?.startsWith(activeYear) && inQuarter(f?.date || '', filterQ)
      );

      // 🆕 FIX: toast en vez de alert()
      if (facFilt.length === 0) {
        toast.warning('No hay facturas en el período seleccionado para generar el reporte.');
        setIsExporting(false);
        return;
      }

      const label = filterQ === 'all' ? activeYear : `${activeYear} ${filterQ}`;
      const doc   = new jsPDF() as any;
      const ts    = new Date().toLocaleString('es-ES');

      // Cabecera
      doc.setFontSize(18); doc.setTextColor(30,41,59);
      doc.text(`Resumen Contable — Arume ERP`, 14, 18);
      doc.setFontSize(9); doc.setTextColor(100,116,139);
      doc.text(`Período: ${label}  ·  Generado: ${ts}`, 14, 25);

      // Totales resumen
      const totalFacturado = facFilt.reduce((s, f) => s + Math.abs(Num.parse(f?.total) || 0), 0);
      const totalPendiente = facFilt.filter(f => !f?.paid).reduce((s, f) => s + Math.abs(Num.parse(f?.total) || 0), 0);
      doc.setFontSize(8); doc.setTextColor(99,102,241);
      doc.text(`Total facturado: ${Num.fmt(totalFacturado)}  ·  Pendiente de pago: ${Num.fmt(totalPendiente)}`, 14, 31);

      const recientes = [...facFilt]
        .sort((a,b) => (String(b?.date||'')).localeCompare(String(a?.date||'')))
        .slice(0, 80);

      const tableData = recientes.map((f: FacturaExtended) => [
        String(f?.date || ''),
        String(f?.num  || 'S/N'),
        String(f?.prov || f?.cliente || '').substring(0, 28),
        String(f?.unidad_negocio || 'REST'),
        Num.fmt(Math.abs(Num.parse(f?.total) || 0)),
        f?.reconciled ? 'CONCIL.' : f?.paid ? 'PAGADA' : 'PDTE',
      ]);

      doc.autoTable({
        startY: 36,
        head:   [['Fecha', 'Nº Factura', 'Titular', 'Unidad', 'Total', 'Estado']],
        body:   tableData,
        theme:  'grid',
        headStyles:        { fillColor:[99,102,241], textColor:255, fontStyle:'bold', fontSize:7 },
        styles:            { fontSize:6.5, cellPadding:1.8 },
        alternateRowStyles:{ fillColor:[248,250,252] },
        columnStyles:      { 5: { halign: 'center' } },
      });

      // 🆕 FIX: timestamp en el nombre del archivo
      doc.save(`Resumen_Ejecutivo_Arume_${filterQ === 'all' ? activeYear : `${activeYear}_${filterQ}`}_${tsFile()}.pdf`);
      toast.success(`PDF generado — ${recientes.length} facturas incluidas.`);
    } catch (e) {
      console.error('[ExportTools] Error PDF:', e);
      // 🆕 FIX: toast en vez de alert()
      toast.error('Error al generar el PDF.');
    } finally { setIsExporting(false); }
  };

  // ── Backup JSON ───────────────────────────────────────────────────────────
  const handleBackup = () => {
    try {
      const payload = JSON.stringify({ version:2, data:db, exportedAt:new Date().toISOString() }, null, 2);
      const blob    = new Blob([payload], { type:'application/json' });
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement('a');
      // 🆕 timestamp en el nombre para no sobreescribir backups del mismo día
      a.href = url; a.download = `Arume_Backup_${tsFile()}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast.success('Backup descargado correctamente.');
    } catch {
      // 🆕 FIX: toast en vez de alert()
      toast.error('Error al generar el backup.');
    }
  };

  // ── Restaurar JSON ────────────────────────────────────────────────────────
  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (restoreInputRef.current) restoreInputRef.current.value = '';

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const raw  = JSON.parse(String(ev.target?.result || '{}'));
        const json = (raw?.version === 2 && raw?.data) ? raw.data : raw;
        if (!json?.albaranes && !json?.facturas) throw new Error('El archivo no tiene la estructura de Arume.');

        // 🆕 FIX: confirm del hook en vez de window.confirm() — bloqueado en iOS Safari PWA
        const ok = await confirm({
          title:        '¿Restaurar backup?',
          message:      'Se sobreescribirá TODA la base de datos en Supabase para todos los usuarios. Esta acción no se puede deshacer.',
          danger:        true,
          confirmLabel: 'Sí, restaurar',
        });

        if (ok) {
          await onSave(json);
          // 🆕 FIX: toast en vez de alert()
          toast.success('Restauración completada. Recarga la aplicación si algo no se ve bien.');
        }
      } catch (err: any) {
        // 🆕 FIX: toast en vez de alert()
        toast.error(`Archivo no válido: ${err?.message || 'JSON corrupto'}`);
      }
    };
    reader.readAsText(file);
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="space-y-3 max-w-3xl mx-auto pb-16">

      {/* ── FILTRO AÑO + TRIMESTRE ───────────────────────────────────────── */}
      <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
        className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">
          <Filter className="w-3.5 h-3.5" /> Período
        </div>

        {/* Selector de año */}
        <select value={activeYear} onChange={e => setFilterYear(e.target.value)}
          className="text-[11px] font-black text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none cursor-pointer">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        {/* Filtro de trimestre */}
        <div className="flex gap-1">
          {QUARTERS.map(q => (
            <button key={q.value} onClick={() => setFilterQ(q.value)}
              className={cn('px-2.5 py-1 rounded-lg text-[10px] font-black transition border',
                filterQ === q.value
                  ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] border-indigo-600 shadow-sm'
                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
              )}>
              {q.label}
            </button>
          ))}
        </div>

        {/* Contadores del período activo */}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {counts.facturas > 0 && (
            <span className="text-[9px] font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-100">
              {counts.facturas} fact.
            </span>
          )}
          {counts.albaranes > 0 && (
            <span className="text-[9px] font-black bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-100">
              {counts.albaranes} alb.
            </span>
          )}
          {counts.gastos > 0 && (
            <span className="text-[9px] font-black bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-100">
              {counts.gastos} gastos fijos
            </span>
          )}
        </div>
      </motion.div>

      {/* ── EXPORTACIÓN GESTORÍA ─────────────────────────────────────────── */}
      <motion.section initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}
        className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
          <FileArchive className="w-4 h-4 text-indigo-500"/>
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
            Cierre Contable · Exportación Gestoría
          </span>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">

          {/* Excel */}
          <button onClick={exportToExcel} disabled={isExporting}
            className="group flex items-center justify-between p-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition disabled:opacity-50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-white rounded-md shadow-sm flex items-center justify-center">
                <FileText className="w-4 h-4 text-emerald-600"/>
              </div>
              <div className="text-left">
                <p className="text-[11px] font-black text-emerald-800 uppercase tracking-wide">Excel (.xlsx)</p>
                {/* 🆕 Contador de registros */}
                <p className="text-[10px] text-emerald-600/70">
                  {counts.facturas} fact · {counts.albaranes} alb · {counts.gastos} gastos fijos
                </p>
              </div>
            </div>
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin text-emerald-500"/> : <ArrowRight className="text-emerald-500"/>}
          </button>

          {/* PDF */}
          <button onClick={exportToPDF} disabled={isExporting}
            className="group flex items-center justify-between p-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition disabled:opacity-50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-white rounded-md shadow-sm flex items-center justify-center">
                <FileText className="w-4 h-4 text-indigo-600"/>
              </div>
              <div className="text-left">
                <p className="text-[11px] font-black text-indigo-800 uppercase tracking-wide">PDF Resumen</p>
                {/* 🆕 Contador de registros */}
                <p className="text-[10px] text-indigo-600/70">
                  {counts.facturas > 0 ? `${Math.min(counts.facturas, 80)} facturas` : 'Sin facturas en este período'}
                </p>
              </div>
            </div>
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500"/> : <ArrowRight className="text-indigo-500"/>}
          </button>

        </div>
      </motion.section>

      {/* ── BACKUP & RESTAURACIÓN ────────────────────────────────────────── */}
      <motion.section initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.05}}
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/50">
          <ShieldCheck className="w-4 h-4 text-emerald-400"/>
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Backup & Restauración</span>
        </div>
        <div className="p-3 space-y-2">

          {/* Descargar backup */}
          <button onClick={handleBackup}
            className="group w-full flex items-center justify-between p-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/40 rounded-lg transition">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-emerald-500/10 rounded-md flex items-center justify-center">
                <Download className="w-4 h-4 text-emerald-400"/>
              </div>
              <div className="text-left">
                <p className="text-[11px] font-black text-white uppercase tracking-wide">Descargar Backup</p>
                <p className="text-[10px] text-slate-400">Copia de seguridad completa (.json)</p>
              </div>
            </div>
            <ArrowRight className="text-emerald-500"/>
          </button>

          {/* Restaurar backup */}
          <label className="group w-full flex items-center justify-between p-3 bg-slate-800/30 hover:bg-slate-800/60 border-2 border-dashed border-slate-700 hover:border-amber-500/40 rounded-lg cursor-pointer transition">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-amber-500/10 rounded-md flex items-center justify-center">
                <Upload className="w-4 h-4 text-amber-400"/>
              </div>
              <div className="text-left">
                <p className="text-[11px] font-black text-amber-100 uppercase tracking-wide">Restaurar Backup</p>
                <p className="text-[10px] text-slate-400">Sube un .json para reemplazar la BD</p>
              </div>
            </div>
            <input ref={restoreInputRef} type="file" accept=".json" onChange={handleRestore} className="hidden"/>
            <ArrowRight className="text-amber-500"/>
          </label>

        </div>
        <div className="mx-3 mb-3 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5"/>
          <p className="text-[10px] text-amber-200/80 font-semibold leading-snug">
            Restaurar sobrescribe la base de datos en Supabase para todos los usuarios. Úsalo solo en emergencias.
          </p>
        </div>
      </motion.section>

    </div>
  );
};
