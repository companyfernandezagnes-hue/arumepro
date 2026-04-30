// ==========================================
// 👥 NominasView.tsx — Gestión de Nóminas y Seguridad Social
// ==========================================
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  Users, UserPlus, UserMinus, Euro, TrendingUp, TrendingDown,
  Calendar, Briefcase, Shield, Download, Edit3, Trash2, X,
  Save, ChevronDown, ChevronUp, FileText, Building2, PieChart, Scale,
  Clock, AlertCircle, CheckCircle2, Plus, Upload, Loader2, Sparkles,
} from 'lucide-react';
import { scanBase64 } from '../services/aiProviders';
import { pdfFirstPageToImage } from '../services/pdfToImage';
import { AnimatedNumber } from './AnimatedNumber';
import { triggerConfetti } from './Confetti';
import { motion, AnimatePresence } from 'motion/react';
import { AppData } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart as RechartsPie, Pie, Cell,
} from 'recharts';

// ── Tipos ───────────────────────────────────────────────────────────────────

interface Trabajador {
  id: string;
  nombre: string;
  puesto: string;
  contrato: 'indefinido' | 'temporal' | 'formacion' | 'practicas' | 'fijo-discontinuo';
  jornada: 'completa' | 'parcial';
  horasParcial?: number;
  fechaAlta: string;
  fechaBaja?: string;
  salarioBrutoAnual: number;
  grupoSS: string;           // Grupo de cotización
  naf?: string;               // Número afiliación SS
  irpfPct: number;            // Retención IRPF %
  activo: boolean;
  notas?: string;
}

interface NominaRegistro {
  id: string;
  mes: string;               // YYYY-MM
  trabajadorId: string;
  nombre: string;
  bruto: number;
  irpfRetenido: number;
  ssEmpleado: number;
  liquido: number;
  ssEmpresa: number;
  costeTotalEmpresa: number;
}

// ── Constantes ──────────────────────────────────────────────────────────────

const CONTRATOS = [
  { value: 'indefinido',       label: 'Indefinido' },
  { value: 'temporal',         label: 'Temporal' },
  { value: 'formacion',        label: 'Formación' },
  { value: 'practicas',        label: 'Prácticas' },
  { value: 'fijo-discontinuo', label: 'Fijo Discontinuo' },
];

const GRUPOS_SS = [
  { value: '1',  label: '1 - Ingenieros/Licenciados' },
  { value: '2',  label: '2 - Ingenieros Técnicos' },
  { value: '3',  label: '3 - Jefes Administrativos' },
  { value: '4',  label: '4 - Ayudantes no titulados' },
  { value: '5',  label: '5 - Oficiales administrativos' },
  { value: '6',  label: '6 - Subalternos' },
  { value: '7',  label: '7 - Auxiliares administrativos' },
  { value: '8',  label: '8 - Oficiales 1ª y 2ª' },
  { value: '9',  label: '9 - Oficiales 3ª y especialistas' },
  { value: '10', label: '10 - Peones' },
  { value: '11', label: '11 - Menores de 18 años' },
];

const PIE_COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#6366f1', '#14b8a6'];

const MESES_LABEL = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  data: AppData;
  onSave: (d: AppData) => Promise<void>;
}

// ── Componente principal ────────────────────────────────────────────────────

export const NominasView: React.FC<Props> = ({ data, onSave }) => {
  const [tab, setTab] = useState<'dashboard' | 'plantilla' | 'registro' | 'resumen'>('dashboard');
  const [year, setYear] = useState(new Date().getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [editTrab, setEditTrab] = useState<Trabajador | null>(null);
  const [showNominaForm, setShowNominaForm] = useState(false);
  const [expandedTrab, setExpandedTrab] = useState<string | null>(null);

  // ── Importación masiva de nóminas con IA ──
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [importResults, setImportResults] = useState<{ name: string; status: 'ok' | 'error'; msg: string }[]>([]);
  const nominasFileRef = useRef<HTMLInputElement>(null);

  // ── Data accessors ──
  const plantilla: Trabajador[] = (data as any).plantilla || [];
  const nominasReg: NominaRegistro[] = (data as any).nominas_registro || [];
  const gastosFijos = data.gastos_fijos || [];

  // ── Datos de gastos fijos payroll ──
  const payrollGF = useMemo(() =>
    gastosFijos.filter((g: any) => g.type === 'payroll' || g.cat === 'personal'),
    [gastosFijos]
  );

  // ── Nóminas del año seleccionado ──
  const nominasYear = useMemo(() =>
    nominasReg.filter(n => n.mes.startsWith(String(year))),
    [nominasReg, year]
  );

  // ── Trabajadores activos ──
  const activos = useMemo(() => plantilla.filter(t => t.activo), [plantilla]);

  // ── Evolución mensual del coste laboral ──
  const evolucionMensual = useMemo(() => {
    const meses: { mes: string; label: string; liquido: number; ssEmpresa: number; costeTotal: number; numTrab: number }[] = [];

    for (let m = 0; m < 12; m++) {
      const mesKey = `${year}-${String(m + 1).padStart(2, '0')}`;
      const nomsMes = nominasYear.filter(n => n.mes === mesKey);

      if (nomsMes.length > 0) {
        meses.push({
          mes: mesKey,
          label: MESES_LABEL[m],
          liquido: Num.round2(nomsMes.reduce((s, n) => s + n.liquido, 0)),
          ssEmpresa: Num.round2(nomsMes.reduce((s, n) => s + n.ssEmpresa, 0)),
          costeTotal: Num.round2(nomsMes.reduce((s, n) => s + n.costeTotalEmpresa, 0)),
          numTrab: nomsMes.length,
        });
      } else {
        // Intentar datos de gastos fijos
        const gfMes = payrollGF.filter((g: any) => {
          const sd = g.startDate || '';
          return sd.startsWith(mesKey);
        });
        if (gfMes.length > 0) {
          const liquido = gfMes.filter((g: any) => (g.name || '').toLowerCase().includes('nómina'))
            .reduce((s: number, g: any) => s + Math.abs(Num.parse(g.amount)), 0);
          const ss = gfMes.filter((g: any) => (g.name || '').toLowerCase().includes('seguridad'))
            .reduce((s: number, g: any) => s + Math.abs(Num.parse(g.amount)), 0);
          if (liquido > 0 || ss > 0) {
            meses.push({
              mes: mesKey,
              label: MESES_LABEL[m],
              liquido: Num.round2(liquido),
              ssEmpresa: Num.round2(ss),
              costeTotal: Num.round2(liquido + ss),
              numTrab: 0,
            });
          }
        }
      }
    }
    return meses;
  }, [nominasYear, payrollGF, year]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const totalCoste = evolucionMensual.reduce((s, m) => s + m.costeTotal, 0);
    const totalLiquido = evolucionMensual.reduce((s, m) => s + m.liquido, 0);
    const totalSS = evolucionMensual.reduce((s, m) => s + m.ssEmpresa, 0);
    const mesesConDatos = evolucionMensual.length || 1;
    const mediaCoste = totalCoste / mesesConDatos;
    const pctSS = totalCoste > 0 ? (totalSS / totalCoste) * 100 : 0;
    return { totalCoste, totalLiquido, totalSS, mediaCoste, mesesConDatos, pctSS, activos: activos.length };
  }, [evolucionMensual, activos]);

  // ── Coste por trabajador (pie chart) ──
  const costePorTrabajador = useMemo(() => {
    const map = new Map<string, number>();
    nominasYear.forEach(n => {
      map.set(n.nombre, (map.get(n.nombre) || 0) + n.costeTotalEmpresa);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Num.round2(value) }))
      .sort((a, b) => b.value - a.value);
  }, [nominasYear]);

  // ── Guardar trabajador ──
  const handleSaveTrab = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const trab: Trabajador = {
      id: editTrab?.id || `trab-${Date.now()}`,
      nombre: fd.get('nombre') as string,
      puesto: fd.get('puesto') as string,
      contrato: fd.get('contrato') as any,
      jornada: fd.get('jornada') as any,
      horasParcial: fd.get('jornada') === 'parcial' ? parseFloat(fd.get('horasParcial') as string) || 0 : undefined,
      fechaAlta: fd.get('fechaAlta') as string,
      fechaBaja: (fd.get('fechaBaja') as string) || undefined,
      salarioBrutoAnual: parseFloat(fd.get('salarioBrutoAnual') as string) || 0,
      grupoSS: fd.get('grupoSS') as string,
      naf: (fd.get('naf') as string) || undefined,
      irpfPct: parseFloat(fd.get('irpfPct') as string) || 0,
      activo: !(fd.get('fechaBaja') as string),
      notas: (fd.get('notas') as string) || undefined,
    };

    const newData = JSON.parse(JSON.stringify(data));
    if (!newData.plantilla) newData.plantilla = [];
    const idx = newData.plantilla.findIndex((t: any) => t.id === trab.id);
    if (idx >= 0) newData.plantilla[idx] = trab;
    else newData.plantilla.push(trab);

    await onSave(newData);
    setShowForm(false);
    setEditTrab(null);
    toast.success(idx >= 0 ? 'Trabajador actualizado' : 'Trabajador añadido');
  }, [data, onSave, editTrab]);

  // ── Dar de baja trabajador ──
  const handleBaja = useCallback(async (id: string) => {
    if (!await confirm({ title: '¿Dar de baja a este trabajador?', message: 'Se marcará como inactivo. El historial se conserva.', danger: true, confirmLabel: 'Dar de Baja' })) return;
    const newData = JSON.parse(JSON.stringify(data));
    const t = (newData.plantilla || []).find((x: any) => x.id === id);
    if (t) {
      t.activo = false;
      t.fechaBaja = new Date().toISOString().split('T')[0];
      await onSave(newData);
      toast.success('Trabajador dado de baja');
    }
  }, [data, onSave]);

  // ── Añadir nómina manual ──
  const handleSaveNomina = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const trabajadorId = fd.get('trabajadorId') as string;
    const trab = plantilla.find(t => t.id === trabajadorId);

    const nomina: NominaRegistro = {
      id: `nom-${Date.now()}`,
      mes: fd.get('mes') as string,
      trabajadorId,
      nombre: trab?.nombre || fd.get('nombreManual') as string || 'Sin nombre',
      bruto: parseFloat(fd.get('bruto') as string) || 0,
      irpfRetenido: parseFloat(fd.get('irpfRetenido') as string) || 0,
      ssEmpleado: parseFloat(fd.get('ssEmpleado') as string) || 0,
      liquido: parseFloat(fd.get('liquido') as string) || 0,
      ssEmpresa: parseFloat(fd.get('ssEmpresa') as string) || 0,
      costeTotalEmpresa: 0,
    };
    nomina.costeTotalEmpresa = Num.round2(nomina.bruto + nomina.ssEmpresa);

    const newData = JSON.parse(JSON.stringify(data));
    if (!newData.nominas_registro) newData.nominas_registro = [];
    newData.nominas_registro.push(nomina);
    await onSave(newData);
    setShowNominaForm(false);
    toast.success('Nómina registrada');
  }, [data, onSave, plantilla]);

  // ── Importar nóminas del mes con IA (OCR + extracción estructurada) ──
  const handleBulkImportNominas = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (fileList.length === 0) return;

    setIsImporting(true);
    setImportResults([]);
    const results: typeof importResults = [];
    const nuevas: NominaRegistro[] = [];
    const nuevosTrabajadores: Trabajador[] = [];

    const prompt = `Eres un experto en nóminas españolas. Extrae de esta nómina los siguientes campos y devuelve SOLO un JSON válido sin markdown ni comentarios:
{
  "nombre_trabajador": "nombre completo del empleado",
  "mes": "YYYY-MM del periodo de la nómina",
  "bruto": número (devengos brutos totales),
  "irpf_retenido": número (retención IRPF en euros),
  "ss_empleado": número (aportación del trabajador a la SS),
  "liquido": número (líquido a percibir),
  "ss_empresa": número (coste SS a cargo de la empresa, si aparece; 0 si no)
}
Todos los importes SIN símbolo €, con punto decimal. Si algún campo no aparece, usa 0.`;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setImportProgress(`Leyendo ${i + 1}/${fileList.length}: ${file.name}`);
      try {
        // Si es PDF, convertimos la primera página a imagen JPEG.
        // Así cualquier proveedor de visión (Gemini/Mistral/Groq) puede procesarlo,
        // y no dependemos solo de Gemini (que a veces está saturado).
        let b64: string;
        let mimeType: string;
        const isPdf = (file.type || '').includes('pdf') || file.name.toLowerCase().endsWith('.pdf');

        if (isPdf) {
          setImportProgress(`Convirtiendo PDF ${i + 1}/${fileList.length}: ${file.name}`);
          const img = await pdfFirstPageToImage(file);
          b64 = img.base64;
          mimeType = img.mimeType;
          setImportProgress(`Leyendo ${i + 1}/${fileList.length}: ${file.name}`);
        } else {
          b64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Error leyendo archivo'));
            reader.readAsDataURL(file);
          });
          mimeType = file.type || 'image/jpeg';
        }

        const scan = await scanBase64(b64, mimeType, prompt);
        // scanBase64 devuelve raw como objeto JSON ya parseado (o {} si falló el parseo).
        // Los campos están directamente accesibles, no dentro de .copy.
        const parsed: any = scan?.raw && typeof scan.raw === 'object' ? scan.raw : {};

        // Si el objeto está vacío, la IA no devolvió JSON → mostrar error claro
        if (Object.keys(parsed).length === 0) {
          results.push({
            name: file.name,
            status: 'error',
            msg: `La IA (${scan?.provider || 'sin proveedor'}) no devolvió datos. ¿PDF legible?`,
          });
          continue;
        }

        const nombre = String(parsed.nombre_trabajador || parsed.nombre || '').trim();
        const mes = String(parsed.mes || '').trim().slice(0, 7);
        const bruto = Num.parse(parsed.bruto || 0);
        const irpf = Num.parse(parsed.irpf_retenido || parsed.irpf || 0);
        const ssEmp = Num.parse(parsed.ss_empleado || 0);
        const liquido = Num.parse(parsed.liquido || (bruto - irpf - ssEmp));
        const ssEmpresaRaw = Num.parse(parsed.ss_empresa || 0);
        // Si la nómina no incluye SS empresa (habitual), estimamos ~30% del bruto
        const ssEmpresa = ssEmpresaRaw > 0 ? ssEmpresaRaw : Num.round2(bruto * 0.30);

        if (!nombre || !mes || !/^\d{4}-\d{2}$/.test(mes)) {
          results.push({
            name: file.name,
            status: 'error',
            msg: `No se extrajo nombre o mes válido (leído: ${nombre || '¿?'} / ${mes || '¿?'})`,
          });
          continue;
        }

        // Buscar trabajador existente por nombre (match flexible)
        const nomLow = nombre.toLowerCase();
        const trab = plantilla.find(t => t.nombre.toLowerCase().includes(nomLow) || nomLow.includes(t.nombre.toLowerCase()));

        // Si no existe, marcamos para auto-crear ficha mínima en plantilla
        const trabajadorIdFinal = trab?.id || `trab-auto-${Date.now()}-${i}`;
        const esNuevo = !trab;

        const nomina: NominaRegistro = {
          id: `nom-${Date.now()}-${i}`,
          mes,
          trabajadorId: trabajadorIdFinal,
          nombre: trab?.nombre || nombre,
          bruto: Num.round2(bruto),
          irpfRetenido: Num.round2(irpf),
          ssEmpleado: Num.round2(ssEmp),
          liquido: Num.round2(liquido),
          ssEmpresa: Num.round2(ssEmpresa),
          costeTotalEmpresa: Num.round2(bruto + ssEmpresa),
        };

        nuevas.push(nomina);

        if (esNuevo) {
          // Guardamos una ficha mínima que se creará al guardar en lote
          nuevosTrabajadores.push({
            id: trabajadorIdFinal,
            nombre,
            puesto: '',
            contrato: 'indefinido',
            jornada: 'completa',
            fechaAlta: `${mes}-01`,
            salarioBrutoAnual: 0,
            grupoSS: '',
            irpfPct: bruto > 0 ? Num.round2((irpf / bruto) * 100) : 0,
            activo: true,
            notas: 'Creado automáticamente al importar nómina con IA — completar datos con la gestoría',
          });
        }

        const ssNote = ssEmpresaRaw === 0 ? ' · SS empresa estimada (30%)' : '';
        results.push({
          name: file.name,
          status: 'ok',
          msg: `${nomina.nombre} · ${mes} · Líquido ${Num.fmt(nomina.liquido)} · Coste empresa ${Num.fmt(nomina.costeTotalEmpresa)}${ssNote}${esNuevo ? ' · 🆕 ficha creada (completar desde gestoría)' : ''}`,
        });
      } catch (err: any) {
        results.push({ name: file.name, status: 'error', msg: err?.message || 'Error al procesar' });
      }
    }

    // Guardar todas las nóminas + trabajadores nuevos a la vez
    if (nuevas.length > 0 || nuevosTrabajadores.length > 0) {
      const newData = JSON.parse(JSON.stringify(data));
      if (!newData.nominas_registro) newData.nominas_registro = [];
      if (!newData.plantilla) newData.plantilla = [];

      // 1) Añadir trabajadores nuevos (evitando duplicar por nombre si ya se añadió en este mismo lote)
      const yaEnPlantilla = new Set(
        (newData.plantilla as Trabajador[]).map(t => t.nombre.toLowerCase())
      );
      let trabAñadidos = 0;
      for (const t of nuevosTrabajadores) {
        if (!yaEnPlantilla.has(t.nombre.toLowerCase())) {
          newData.plantilla.push(t);
          yaEnPlantilla.add(t.nombre.toLowerCase());
          trabAñadidos++;
        }
      }

      // 2) Añadir nóminas evitando duplicados (mismo nombre + mes + bruto)
      const existentes = new Set(
        (newData.nominas_registro as NominaRegistro[]).map(n => `${n.nombre}__${n.mes}__${n.bruto.toFixed(2)}`)
      );
      let añadidas = 0;
      for (const n of nuevas) {
        const key = `${n.nombre}__${n.mes}__${n.bruto.toFixed(2)}`;
        if (!existentes.has(key)) {
          newData.nominas_registro.push(n);
          añadidas++;
        }
      }
      await onSave(newData);
      const parts: string[] = [];
      if (añadidas > 0) parts.push(`${añadidas} nómina${añadidas !== 1 ? 's' : ''}`);
      if (trabAñadidos > 0) parts.push(`${trabAñadidos} trabajador${trabAñadidos !== 1 ? 'es' : ''} nuevo${trabAñadidos !== 1 ? 's' : ''}`);
      toast.success(parts.join(' + ') + ' importado ✨');
      triggerConfetti(); // 🎉 menos papeleo manual
    }

    setImportResults(results);
    setImportProgress('');
    setIsImporting(false);
  }, [data, onSave, plantilla]);

  // ── Export Excel ──
  const handleExport = () => {
    const headers = ['Mes', 'Trabajador', 'Bruto', 'IRPF Ret.', 'SS Empleado', 'Líquido', 'SS Empresa', 'Coste Total'];
    const rows = nominasYear
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map(n => [n.mes, n.nombre, n.bruto.toFixed(2), n.irpfRetenido.toFixed(2), n.ssEmpleado.toFixed(2), n.liquido.toFixed(2), n.ssEmpresa.toFixed(2), n.costeTotalEmpresa.toFixed(2)]);
    const csv = [headers, ...rows].map(r => r.join('\t')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nominas_${year}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Tabs ──
  const TABS = [
    { key: 'dashboard' as const, label: 'Dashboard',  icon: PieChart },
    { key: 'plantilla' as const, label: 'Plantilla',  icon: Users },
    { key: 'registro'  as const, label: 'Nóminas',    icon: FileText },
    { key: 'resumen'   as const, label: 'Resumen Anual', icon: Calendar },
  ];

  return (
    <div className="animate-fade-in space-y-6 pb-24">

      {/* ── HEADER EDITORIAL NIGHT ── */}
      <header className="relative overflow-hidden hero-breathing bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] p-6 md:p-8 rounded-2xl shadow-[0_12px_40px_rgba(11,11,12,0.18)]">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[color:var(--arume-gold)]/80"/>
        <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-[color:var(--arume-gold)]/5 pointer-events-none"/>
        <div className="relative z-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--arume-gold)]">Personal</p>
          <h2 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight mt-2">Nóminas y Seguridad Social</h2>
          <p className="text-sm text-white/60 mt-1">Celoso de Palma SL</p>
          <div className="flex items-center gap-2 mt-5 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
              👥 <AnimatedNumber value={kpis.activos} format={(n) => Math.round(n).toString()}/> empleados activos
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-white/5 border border-white/10 px-3 py-1.5 rounded-full tabular-nums">
              💼 Coste {year}: <AnimatedNumber value={kpis.totalCoste} format={(n) => Num.fmt(n)}/>
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] bg-white/5 border border-white/10 px-3 py-1.5 rounded-full tabular-nums">
              📊 Media: <AnimatedNumber value={kpis.mediaCoste} format={(n) => Num.fmt(n)}/>
            </span>
          </div>
        </div>
      </header>

      {/* ── Tabs + Year ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-gray-100 rounded-2xl p-1.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all',
                tab === t.key ? 'bg-fuchsia-600 text-white shadow-lg' : 'text-gray-500 hover:bg-white'
              )}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="bg-white border rounded-xl px-3 py-2 text-sm font-bold">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition">
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: DASHBOARD                                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'dashboard' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border shadow-sm">
              <div className="text-xs text-gray-500 mb-1 font-medium">Coste Total {year}</div>
              <div className="text-2xl font-black text-fuchsia-700">{Num.fmt(kpis.totalCoste)}</div>
              <div className="text-xs text-gray-400 mt-1">{kpis.mesesConDatos} meses con datos</div>
            </div>
            <div className="bg-white p-5 rounded-2xl border shadow-sm">
              <div className="text-xs text-gray-500 mb-1 font-medium">Líquido Total</div>
              <div className="text-2xl font-black text-purple-700">{Num.fmt(kpis.totalLiquido)}</div>
              <div className="text-xs text-gray-400 mt-1">Neto a percibir</div>
            </div>
            <div className="bg-white p-5 rounded-2xl border shadow-sm">
              <div className="text-xs text-gray-500 mb-1 font-medium">SS Empresa</div>
              <div className="text-2xl font-black text-rose-600">{Num.fmt(kpis.totalSS)}</div>
              <div className="text-xs text-gray-400 mt-1">{kpis.pctSS.toFixed(1)}% del coste total</div>
            </div>
            <div className="bg-white p-5 rounded-2xl border shadow-sm">
              <div className="text-xs text-gray-500 mb-1 font-medium">Media Mensual</div>
              <div className="text-2xl font-black text-indigo-600">{Num.fmt(kpis.mediaCoste)}</div>
              <div className="text-xs text-gray-400 mt-1">{kpis.activos} empleados activos</div>
            </div>
          </div>

          {/* Gráfico evolución mensual */}
          {evolucionMensual.length > 0 ? (
            <div className="bg-white p-6 rounded-2xl border shadow-sm">
              <h3 className="font-bold text-gray-800 mb-4">Evolución Coste Laboral {year}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={evolucionMensual}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => Num.fmt(v)} />
                  <Legend />
                  <Bar dataKey="liquido" name="Líquido" fill="#a855f7" radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="ssEmpresa" name="SS Empresa" fill="#ec4899" radius={[4, 4, 0, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-2xl p-8 text-center">
              <Users className="w-12 h-12 mx-auto mb-3 text-fuchsia-400 opacity-50" />
              <p className="text-fuchsia-700 font-bold">Sin datos de nóminas para {year}</p>
              <p className="text-sm text-fuchsia-500 mt-2">
                Importa nóminas PDF desde <strong>Gastos Fijos</strong> o registra manualmente en la pestaña <strong>Nóminas</strong>
              </p>
            </div>
          )}

          {/* Pie chart coste por trabajador */}
          {costePorTrabajador.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-2xl border shadow-sm">
                <h3 className="font-bold text-gray-800 mb-4">Distribución por Empleado</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <RechartsPie>
                    <Pie data={costePorTrabajador} cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                      paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}>
                      {costePorTrabajador.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => Num.fmt(v)} />
                  </RechartsPie>
                </ResponsiveContainer>
              </div>
              <div className="bg-white p-6 rounded-2xl border shadow-sm">
                <h3 className="font-bold text-gray-800 mb-4">Ranking Coste Empresa</h3>
                <div className="space-y-3">
                  {costePorTrabajador.slice(0, 8).map((t, i) => (
                    <div key={t.name} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{t.name}</div>
                        <div className="h-2 bg-gray-100 rounded-full mt-1">
                          <div className="h-2 rounded-full transition-all" style={{
                            width: `${(t.value / (costePorTrabajador[0]?.value || 1)) * 100}%`,
                            backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                          }} />
                        </div>
                      </div>
                      <div className="text-sm font-bold text-gray-700">{Num.fmt(t.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Datos importados de Gastos Fijos */}
          {payrollGF.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
              <h4 className="font-bold text-purple-800 text-sm mb-3 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Importados desde Gastos Fijos ({payrollGF.length} registros)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {payrollGF.slice(0, 6).map((g: any) => (
                  <div key={g.id} className="bg-white rounded-xl p-3 text-sm flex justify-between items-center">
                    <div>
                      <div className="font-semibold text-gray-700 truncate">{g.name || g.concepto}</div>
                      <div className="text-xs text-gray-400">{g.startDate || g.freq}</div>
                    </div>
                    <div className="font-bold text-fuchsia-700">{Num.fmt(Math.abs(Num.parse(g.amount)))}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: PLANTILLA                                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'plantilla' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-900">Plantilla de Trabajadores</h3>
            <button onClick={() => { setEditTrab(null); setShowForm(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-fuchsia-600 text-white rounded-xl text-sm font-bold hover:bg-fuchsia-700 transition">
              <UserPlus className="w-4 h-4" /> Alta Trabajador
            </button>
          </div>

          {/* Lista de trabajadores */}
          {plantilla.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-12 text-center">
              <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 font-bold">No hay trabajadores registrados</p>
              <p className="text-sm text-gray-400 mt-2">Pulsa "Alta Trabajador" para añadir el primero</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {plantilla.map(t => {
                const isExpanded = expandedTrab === t.id;
                const nomsTrab = nominasYear.filter(n => n.trabajadorId === t.id);
                const costAnual = nomsTrab.reduce((s, n) => s + n.costeTotalEmpresa, 0);
                const salMensual = Num.round2(t.salarioBrutoAnual / 14);

                return (
                  <motion.div key={t.id} layout
                    className={cn('bg-white rounded-2xl border overflow-hidden transition-all',
                      !t.activo && 'opacity-50 grayscale')}>
                    <div className="p-5">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white text-lg',
                            t.activo ? 'bg-fuchsia-500' : 'bg-gray-400')}>
                            {t.nombre.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-gray-800">{t.nombre}</div>
                            <div className="text-xs text-gray-500">{t.puesto}</div>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => { setEditTrab(t); setShowForm(true); }}
                            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-fuchsia-50 hover:text-fuchsia-600 transition">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {t.activo && (
                            <button onClick={() => handleBaja(t.id)}
                              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-600 transition">
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-4">
                        <div className="bg-gray-50 rounded-xl p-2 text-center">
                          <div className="text-[10px] text-gray-400 uppercase font-bold">Contrato</div>
                          <div className="text-xs font-bold text-gray-700 capitalize">{t.contrato}</div>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-2 text-center">
                          <div className="text-[10px] text-gray-400 uppercase font-bold">Jornada</div>
                          <div className="text-xs font-bold text-gray-700 capitalize">
                            {t.jornada === 'parcial' ? `Parcial ${t.horasParcial || ''}h` : 'Completa'}
                          </div>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-2 text-center">
                          <div className="text-[10px] text-gray-400 uppercase font-bold">IRPF</div>
                          <div className="text-xs font-bold text-gray-700">{t.irpfPct}%</div>
                        </div>
                      </div>

                      <div className="flex justify-between items-center mt-4">
                        <div>
                          <span className="text-xs text-gray-400">Bruto anual:</span>
                          <span className="ml-2 font-bold text-fuchsia-700">{Num.fmt(t.salarioBrutoAnual)}</span>
                          <span className="text-xs text-gray-400 ml-2">({Num.fmt(salMensual)}/mes)</span>
                        </div>
                        <button onClick={() => setExpandedTrab(isExpanded ? null : t.id)}
                          className="text-xs text-fuchsia-600 font-bold flex items-center gap-1">
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {nomsTrab.length} nóminas
                        </button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                          <div className="px-5 pb-4 border-t space-y-2 pt-3">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Alta:</span>
                              <span className="font-semibold">{t.fechaAlta}</span>
                            </div>
                            {t.fechaBaja && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Baja:</span>
                                <span className="font-semibold text-red-600">{t.fechaBaja}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Grupo SS:</span>
                              <span className="font-semibold">{t.grupoSS}</span>
                            </div>
                            {t.naf && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">NAF:</span>
                                <span className="font-mono text-xs">{t.naf}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-sm font-bold border-t pt-2 mt-2">
                              <span className="text-fuchsia-600">Coste empresa {year}:</span>
                              <span className="text-fuchsia-700">{Num.fmt(costAnual)}</span>
                            </div>
                            {t.notas && <p className="text-xs text-gray-400 italic">{t.notas}</p>}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: REGISTRO NÓMINAS                                               */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'registro' && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <h3 className="text-lg font-bold text-gray-900">Registro de Nóminas {year}</h3>
            <div className="flex gap-2">
              <input
                ref={nominasFileRef}
                type="file"
                accept="application/pdf,image/*"
                multiple
                className="hidden"
                onChange={handleBulkImportNominas}
              />
              <button
                onClick={() => nominasFileRef.current?.click()}
                disabled={isImporting}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition border',
                  isImporting
                    ? 'bg-fuchsia-100 text-fuchsia-400 border-fuchsia-200 cursor-wait'
                    : 'bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white border-transparent hover:from-fuchsia-600 hover:to-violet-600 shadow'
                )}
              >
                {isImporting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Leyendo…</>
                ) : (
                  <><Sparkles className="w-4 h-4 ai-pulse" /> Importar con IA</>
                )}
              </button>
              <button onClick={() => setShowNominaForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-50 transition">
                <Plus className="w-4 h-4" /> Manual
              </button>
            </div>
          </div>

          {/* Progreso de importación */}
          {isImporting && importProgress && (
            <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl p-3 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-fuchsia-500"/>
              <p className="text-sm font-bold text-fuchsia-700">{importProgress}</p>
            </div>
          )}

          {/* Resultados de la última importación */}
          {importResults.length > 0 && !isImporting && (
            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">
                  Resultado · {importResults.filter(r => r.status === 'ok').length}/{importResults.length} OK
                </p>
                <button onClick={() => setImportResults([])}
                  className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest">
                  Cerrar
                </button>
              </div>
              {importResults.map((r, i) => (
                <div key={i} className={cn('flex items-start gap-2 text-xs p-2 rounded-lg',
                  r.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
                  {r.status === 'ok'
                    ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5"/>
                    : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5"/>}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold truncate">{r.name}</p>
                    <p className="opacity-80">{r.msg}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {nominasYear.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-12 text-center">
              <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 font-bold">Sin nóminas registradas en {year}</p>
              <p className="text-sm text-gray-400 mt-2">
                Puedes importar PDFs desde Gastos Fijos o añadir manualmente aquí
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="text-left px-4 py-3 font-bold">Mes</th>
                      <th className="text-left px-4 py-3 font-bold">Trabajador</th>
                      <th className="text-right px-4 py-3 font-bold">Bruto</th>
                      <th className="text-right px-4 py-3 font-bold">IRPF Ret.</th>
                      <th className="text-right px-4 py-3 font-bold">SS Empl.</th>
                      <th className="text-right px-4 py-3 font-bold">Líquido</th>
                      <th className="text-right px-4 py-3 font-bold">SS Empresa</th>
                      <th className="text-right px-4 py-3 font-bold">Coste Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nominasYear
                      .sort((a, b) => b.mes.localeCompare(a.mes) || a.nombre.localeCompare(b.nombre))
                      .map(n => (
                      <tr key={n.id} className="border-t hover:bg-fuchsia-50/30 transition">
                        <td className="px-4 py-3 font-semibold text-gray-700">{n.mes}</td>
                        <td className="px-4 py-3">{n.nombre}</td>
                        <td className="px-4 py-3 text-right font-mono">{Num.fmt(n.bruto)}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-600">{Num.fmt(n.irpfRetenido)}</td>
                        <td className="px-4 py-3 text-right font-mono text-orange-600">{Num.fmt(n.ssEmpleado)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-purple-700">{Num.fmt(n.liquido)}</td>
                        <td className="px-4 py-3 text-right font-mono text-rose-600">{Num.fmt(n.ssEmpresa)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-fuchsia-700">{Num.fmt(n.costeTotalEmpresa)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 bg-fuchsia-50 font-bold">
                      <td className="px-4 py-3" colSpan={2}>TOTAL {year}</td>
                      <td className="px-4 py-3 text-right">{Num.fmt(nominasYear.reduce((s, n) => s + n.bruto, 0))}</td>
                      <td className="px-4 py-3 text-right text-amber-600">{Num.fmt(nominasYear.reduce((s, n) => s + n.irpfRetenido, 0))}</td>
                      <td className="px-4 py-3 text-right text-orange-600">{Num.fmt(nominasYear.reduce((s, n) => s + n.ssEmpleado, 0))}</td>
                      <td className="px-4 py-3 text-right text-purple-700">{Num.fmt(nominasYear.reduce((s, n) => s + n.liquido, 0))}</td>
                      <td className="px-4 py-3 text-right text-rose-600">{Num.fmt(nominasYear.reduce((s, n) => s + n.ssEmpresa, 0))}</td>
                      <td className="px-4 py-3 text-right text-fuchsia-700">{Num.fmt(nominasYear.reduce((s, n) => s + n.costeTotalEmpresa, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: RESUMEN ANUAL                                                  */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'resumen' && (
        <div className="space-y-6">
          <h3 className="text-lg font-bold text-gray-900">Resumen Anual {year} — Modelo 190</h3>

          {/* Tabla resumen por trabajador */}
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="text-left px-4 py-3 font-bold">Trabajador</th>
                    <th className="text-center px-4 py-3 font-bold">Meses</th>
                    <th className="text-right px-4 py-3 font-bold">Bruto Anual</th>
                    <th className="text-right px-4 py-3 font-bold">IRPF Retenido</th>
                    <th className="text-right px-4 py-3 font-bold">SS Empleado</th>
                    <th className="text-right px-4 py-3 font-bold">Líquido Anual</th>
                    <th className="text-right px-4 py-3 font-bold">SS Empresa</th>
                    <th className="text-right px-4 py-3 font-bold">Coste Empresa</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const map = new Map<string, { nombre: string; meses: Set<string>; bruto: number; irpf: number; ssEmpl: number; liquido: number; ssEmp: number; coste: number }>();
                    nominasYear.forEach(n => {
                      const prev = map.get(n.nombre) || { nombre: n.nombre, meses: new Set(), bruto: 0, irpf: 0, ssEmpl: 0, liquido: 0, ssEmp: 0, coste: 0 };
                      prev.meses.add(n.mes);
                      prev.bruto += n.bruto;
                      prev.irpf += n.irpfRetenido;
                      prev.ssEmpl += n.ssEmpleado;
                      prev.liquido += n.liquido;
                      prev.ssEmp += n.ssEmpresa;
                      prev.coste += n.costeTotalEmpresa;
                      map.set(n.nombre, prev);
                    });
                    return Array.from(map.values()).sort((a, b) => b.coste - a.coste).map(t => (
                      <tr key={t.nombre} className="border-t hover:bg-fuchsia-50/30">
                        <td className="px-4 py-3 font-semibold">{t.nombre}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="bg-fuchsia-100 text-fuchsia-700 px-2 py-0.5 rounded-full text-xs font-bold">{t.meses.size}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{Num.fmt(t.bruto)}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-600">{Num.fmt(t.irpf)}</td>
                        <td className="px-4 py-3 text-right font-mono text-orange-600">{Num.fmt(t.ssEmpl)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-purple-700">{Num.fmt(t.liquido)}</td>
                        <td className="px-4 py-3 text-right font-mono text-rose-600">{Num.fmt(t.ssEmp)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-fuchsia-700">{Num.fmt(t.coste)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-fuchsia-50 font-bold">
                    <td className="px-4 py-3">TOTAL EMPRESA</td>
                    <td className="px-4 py-3 text-center">{kpis.mesesConDatos}m</td>
                    <td className="px-4 py-3 text-right">{Num.fmt(nominasYear.reduce((s, n) => s + n.bruto, 0))}</td>
                    <td className="px-4 py-3 text-right text-amber-600">{Num.fmt(nominasYear.reduce((s, n) => s + n.irpfRetenido, 0))}</td>
                    <td className="px-4 py-3 text-right text-orange-600">{Num.fmt(nominasYear.reduce((s, n) => s + n.ssEmpleado, 0))}</td>
                    <td className="px-4 py-3 text-right text-purple-700">{Num.fmt(nominasYear.reduce((s, n) => s + n.liquido, 0))}</td>
                    <td className="px-4 py-3 text-right text-rose-600">{Num.fmt(nominasYear.reduce((s, n) => s + n.ssEmpresa, 0))}</td>
                    <td className="px-4 py-3 text-right text-fuchsia-700">{Num.fmt(nominasYear.reduce((s, n) => s + n.costeTotalEmpresa, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Info fiscal */}
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex gap-3">
            <Shield className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
            <div className="text-sm text-purple-800">
              <strong>Obligaciones fiscales:</strong>
              <ul className="list-disc ml-4 mt-2 space-y-1 text-xs">
                <li><strong>Modelo 111</strong> — Trimestral: retenciones IRPF de trabajadores</li>
                <li><strong>Modelo 190</strong> — Anual: resumen de retenciones e ingresos a cuenta</li>
                <li><strong>TC1/TC2</strong> — Mensual: liquidación y relación nominal de trabajadores (TGSS)</li>
                <li><strong>Modelo 145</strong> — Comunicación de datos al pagador (cada trabajador)</li>
              </ul>
            </div>
          </div>

          {/* Resumen trimestral Modelo 111 */}
          <div className="bg-white rounded-2xl border p-6">
            <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Scale className="w-4 h-4 text-amber-600" /> Estimación Modelo 111 (Retenciones IRPF Trimestrales)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(q => {
                const mesesQ = [1, 2, 3].map(m => `${year}-${String((q - 1) * 3 + m).padStart(2, '0')}`);
                const nomsQ = nominasYear.filter(n => mesesQ.includes(n.mes));
                const irpfQ = nomsQ.reduce((s, n) => s + n.irpfRetenido, 0);
                const numPerc = new Set(nomsQ.map(n => n.nombre)).size;
                return (
                  <div key={q} className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                    <div className="text-xs font-bold text-amber-600 uppercase">T{q} {year}</div>
                    <div className="text-xl font-black text-amber-700 mt-1">{Num.fmt(irpfQ)}</div>
                    <div className="text-[10px] text-amber-500 mt-1">{numPerc} perceptores · {nomsQ.length} nóminas</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: Alta/Edición Trabajador                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowForm(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-white rounded-3xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl"
              onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black">{editTrab ? 'Editar Trabajador' : 'Alta Trabajador'}</h3>
                <button onClick={() => setShowForm(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleSaveTrab} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">Nombre completo *</label>
                    <input name="nombre" required defaultValue={editTrab?.nombre || ''}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="Apellido1 Apellido2, Nombre" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Puesto *</label>
                    <input name="puesto" required defaultValue={editTrab?.puesto || ''}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="Camarero, Cocinero..." />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Contrato</label>
                    <select name="contrato" defaultValue={editTrab?.contrato || 'indefinido'}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm">
                      {CONTRATOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Jornada</label>
                    <select name="jornada" defaultValue={editTrab?.jornada || 'completa'}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm">
                      <option value="completa">Completa</option>
                      <option value="parcial">Parcial</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Horas (si parcial)</label>
                    <input name="horasParcial" type="number" step="0.5" defaultValue={editTrab?.horasParcial || ''}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="20" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Fecha Alta *</label>
                    <input name="fechaAlta" type="date" required defaultValue={editTrab?.fechaAlta || ''}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Fecha Baja</label>
                    <input name="fechaBaja" type="date" defaultValue={editTrab?.fechaBaja || ''}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Salario Bruto Anual *</label>
                    <input name="salarioBrutoAnual" type="number" step="0.01" required defaultValue={editTrab?.salarioBrutoAnual || ''}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="18000" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">% IRPF Retención</label>
                    <input name="irpfPct" type="number" step="0.01" defaultValue={editTrab?.irpfPct || 15}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Grupo Cotización SS</label>
                    <select name="grupoSS" defaultValue={editTrab?.grupoSS || '9'}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm">
                      {GRUPOS_SS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">NAF (Seg. Social)</label>
                    <input name="naf" defaultValue={editTrab?.naf || ''}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="28/12345678/90" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">Notas</label>
                    <textarea name="notas" rows={2} defaultValue={editTrab?.notas || ''}
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm resize-none" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit"
                    className="flex-1 py-3 bg-fuchsia-600 text-white rounded-xl font-bold hover:bg-fuchsia-700 transition flex items-center justify-center gap-2">
                    <Save className="w-4 h-4" /> {editTrab ? 'Guardar Cambios' : 'Dar de Alta'}
                  </button>
                  <button type="button" onClick={() => setShowForm(false)}
                    className="px-6 py-3 bg-gray-100 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition">
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: Registrar Nómina Manual                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showNominaForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowNominaForm(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-white rounded-3xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl"
              onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black">Registrar Nómina</h3>
                <button onClick={() => setShowNominaForm(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleSaveNomina} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">Mes *</label>
                  <input name="mes" type="month" required defaultValue={`${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`}
                    className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">Trabajador</label>
                  <select name="trabajadorId" className="w-full mt-1 px-4 py-3 border rounded-xl text-sm">
                    <option value="">— Seleccionar —</option>
                    {activos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">O nombre manual</label>
                  <input name="nombreManual" className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="Si no está en plantilla" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Bruto</label>
                    <input name="bruto" type="number" step="0.01" required
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="1500" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">IRPF Retenido</label>
                    <input name="irpfRetenido" type="number" step="0.01"
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="225" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">SS Empleado</label>
                    <input name="ssEmpleado" type="number" step="0.01"
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="95" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Líquido *</label>
                    <input name="liquido" type="number" step="0.01" required
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="1180" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">SS Empresa *</label>
                    <input name="ssEmpresa" type="number" step="0.01" required
                      className="w-full mt-1 px-4 py-3 border rounded-xl text-sm" placeholder="450" />
                  </div>
                </div>
                <button type="submit"
                  className="w-full py-3 bg-fuchsia-600 text-white rounded-xl font-bold hover:bg-fuchsia-700 transition flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" /> Guardar Nómina
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default NominasView;
