import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, CreditCard, Banknote, Truck, Sparkles,
  Trash2, CheckCircle2, Clock, AlertTriangle, RefreshCw,
  Scan, Building2, ShoppingBag, Layers, SplitSquareHorizontal,
  Mic, Square, Plus, Download, XCircle, FileArchive
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { AppData, Cierre } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { CashHistoryList } from './CashHistoryList';
import { scanDocument } from '../services/aiProviders';
import { toast } from '../hooks/useToast';
import { CashWeekSummary, getLastCierreValues } from './CashWeekSummary';
import { confirm } from '../hooks/useConfirm';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { triggerConfetti } from './Confetti';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type CashBusinessUnit = 'REST' | 'SHOP';

export const CASH_UNITS: { id: CashBusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' },
];

const COMISIONES = { glovo: 0.30, uber: 0.30, apperStreet: 0.0, madisa: 0.0 };

interface CashViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getSafeDate = () => new Date().toLocaleDateString('sv-SE');

const safeJSON = (str: string) => {
  try {
    const match = str.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch { return {}; }
};

const compressImageToBase64 = async (file: File | Blob): Promise<string> => {
  const bmp = await createImageBitmap(file);
  const cvs = document.createElement('canvas');
  const r   = Math.min(1200 / bmp.width, 1200 / bmp.height, 1);
  cvs.width  = bmp.width  * r;
  cvs.height = bmp.height * r;
  cvs.getContext('2d')?.drawImage(bmp, 0, 0, cvs.width, cvs.height);
  return cvs.toDataURL('image/jpeg', 0.75).split(',')[1];
};

function upsertFactura(list: any[], item: any, key = 'num') {
  const idx = list.findIndex(x => x[key] === item[key]);
  if (idx >= 0) list[idx] = { ...list[idx], ...item };
  else list.push(item);
}

// ─── Hook cálculos ────────────────────────────────────────────────────────────

function useCashCalculations(form: any, fondoCaja: number) {
  const totalTarjetas = useMemo(
    () => Num.parse(form.tpv1) + Num.parse(form.tpv2) + Num.parse(form.amex),
    [form.tpv1, form.tpv2, form.amex]
  );
  const appsBrutas = useMemo(
    () => Num.parse(form.glovo) + Num.parse(form.uber) + Num.parse(form.madisa) + Num.parse(form.apperStreet),
    [form.glovo, form.uber, form.madisa, form.apperStreet]
  );
  const appsNetas = useMemo(() => Num.round2(
    Num.parse(form.glovo)       * (1 - COMISIONES.glovo) +
    Num.parse(form.uber)        * (1 - COMISIONES.uber) +
    Num.parse(form.madisa)      * (1 - COMISIONES.madisa) +
    Num.parse(form.apperStreet) * (1 - COMISIONES.apperStreet)
  ), [form.glovo, form.uber, form.madisa, form.apperStreet]);

  const totalRestauranteNeto = useMemo(
    () => Num.parse(form.efectivo) + totalTarjetas + appsNetas - Num.parse(form.tienda),
    [form.efectivo, totalTarjetas, appsNetas, form.tienda]
  );
  const descuadreVivo = useMemo(() => {
    if (form.cajaFisica === '' || form.efectivo === '') return null;
    return Num.round2(Num.parse(form.cajaFisica) - (Num.parse(form.efectivo) + fondoCaja));
  }, [form.cajaFisica, form.efectivo, fondoCaja]);

  return { totalTarjetas, appsBrutas, appsNetas, totalRestauranteNeto, descuadreVivo };
}

// ─── Mapa de keywords para parseVoiceCommand ─────────────────────────────────
// Soporta Groq Whisper (transcribe todo de golpe) y modo navegador
// Incluye variantes fonéticas comunes del español

const VOICE_MAPPINGS: { keys: string[]; field: string }[] = [
  { keys: ['efectivo', 'efect'],                         field: 'efectivo'    },
  { keys: ['tpv1', 'tpv 1', 'tpv uno'],                 field: 'tpv1'        },
  { keys: ['tpv2', 'tpv 2', 'tpv dos'],                 field: 'tpv2'        },
  { keys: ['amex'],                                       field: 'amex'        },
  { keys: ['glovo', 'globo'],                            field: 'glovo'       },
  { keys: ['uber'],                                       field: 'uber'        },
  { keys: ['madisa', 'madissa', 'madis'],                field: 'madisa'      },
  { keys: ['apper', 'apperstreet', 'aper street'],       field: 'apperStreet' },
  { keys: ['tienda'],                                     field: 'tienda'      },
  { keys: ['caja fisica', 'caja fis', 'arqueo'],         field: 'cajaFisica'  },
];

/* =============================================================================
 * COMPONENTE PRINCIPAL: CASH VIEW
 * ============================================================================= */
export const CashView = ({ data, onSave }: CashViewProps) => {

  // ─── Estado UI ───────────────────────────────────────────────────────────
  const [currentFilterDate, setCurrentFilterDate] = useState(getSafeDate().slice(0, 7));
  const [selectedUnit,      setSelectedUnit]      = useState<CashBusinessUnit | 'ALL'>('ALL');
  const [scanStatus,        setScanStatus]        = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [images,            setImages]            = useState<{ img1: string | null }>({ img1: null });
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportYear,        setExportYear]        = useState(new Date().getFullYear());
  const [exportMonth,       setExportMonth]       = useState<number | 'all'>(new Date().getMonth()); // 0-11, 'all' = año entero
  const [isSaving,          setIsSaving]          = useState(false);

  // ─── Diagnóstico voz (temporal — borrar cuando funcione) ─────────────────
  const [lastRawText,   setLastRawText]   = useState('');
  const [voiceDiag,     setVoiceDiag]     = useState<string[]>([]);
  const [showVoiceDiag, setShowVoiceDiag] = useState(false);

  // ─── Formulario ──────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    date: getSafeDate(), efectivo: '', tpv1: '', tpv2: '', amex: '',
    glovo: '', uber: '', madisa: '', apperStreet: '',
    cajaFisica: '', tienda: '', notas: '',
  });
  const [fondoCaja,     setFondoCaja]     = useState<number>(300);
  const [depositoBanco, setDepositoBanco] = useState('');
  const [gastosCaja,    setGastosCaja]    = useState<any[]>([]);

  // ─── Voz: stale-closure fix con ref ──────────────────────────────────────
  const parseVoiceCommandRef = useRef<(text: string) => void>(() => {});

  const { isRecording, liveTranscript, toggleRecording } = useVoiceInput({
    onResult: (text) => parseVoiceCommandRef.current(text),
  });

  // ─── parseVoiceCommand: multi-campo, compatible con Groq Whisper ─────────
  // Groq transcribe TODO de golpe: "Efectivo 313 TPV1 1446,25 Glovo 61"
  // → detecta TODOS los campos en una sola pasada, sin else-if
  const parseVoiceCommand = useCallback((text: string) => {
    const lower = text.toLowerCase();
    setLastRawText(text);

    // Extrae el número que sigue inmediatamente a la keyword
    const extractNum = (keyword: string): string | null => {
      const re = new RegExp(keyword + '[^\\d]*(\\d+([.,]\\d+)?)', 'i');
      const m  = lower.match(re);
      return m ? m[1].replace(',', '.') : null;
    };

    const updates: Record<string, string> = {};
    const logParts: string[] = [];
    const ts = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    for (const { keys, field } of VOICE_MAPPINGS) {
      for (const key of keys) {
        if (lower.includes(key)) {
          const val = extractNum(key);
          if (val) {
            updates[field] = val;
            logParts.push(`${field}=${val}`);
          }
          break; // siguiente campo
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      setForm(f => ({ ...f, ...updates }));
    }

    const resumen = logParts.length > 0 ? logParts.join(' | ') : 'SIN COINCIDENCIA';
    setVoiceDiag(prev => [`[${ts}] "${text}" → ${resumen}`, ...prev].slice(0, 10));
  }, []);

  // Sincronizar ref → siempre apunta a la función más reciente
  useEffect(() => {
    parseVoiceCommandRef.current = parseVoiceCommand;
  }, [parseVoiceCommand]);

  const calc = useCashCalculations(form, fondoCaja);

  // ─── Detección cierre hoy ────────────────────────────────────────────────
  const estadoCierreHoy = useMemo(() => {
    const fecha    = form.date;
    const cierres  = data.cierres || [];
    const cRest    = cierres.find((c: any) => c.date === fecha && (c.unitId === 'REST' || !c.unitId));
    const cShop    = cierres.find((c: any) => c.date === fecha && c.unitId === 'SHOP');
    return {
      restCerrado: !!cRest,
      shopCerrado: !!cShop,
      ventaRest: cRest ? Num.round2(Num.parse((cRest as any).totalVenta || 0)) : null,
      ventaShop: cShop ? Num.round2(Num.parse((cShop as any).totalVenta || 0)) : null,
    };
  }, [data.cierres, form.date]);

  // ─── Aviso días sin cierre ───────────────────────────────────────────────
  const diasSinCierre = useMemo(() => {
    const cierres = data.cierres || [];
    let count = 0;
    for (let i = 1; i <= 5; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = d.toLocaleDateString('sv-SE');
      const tiene = cierres.some((c: any) => c.date === iso && (c.unitId === 'REST' || !c.unitId));
      if (!tiene) count++; else break;
    }
    return count;
  }, [data.cierres]);

  // ─── KPIs del mes ────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const cierresMes = (data.cierres || []).filter((c: any) => {
      if (!c?.date) return false;
      const match = c.date.startsWith(currentFilterDate);
      if (selectedUnit === 'ALL') return match;
      return match && (c.unitId === selectedUnit || (!c.unitId && selectedUnit === 'REST'));
    });
    let total = 0, tarj = 0, efec = 0, apps = 0;
    cierresMes.forEach((c: any) => {
      total += Num.parse(c.totalVenta || 0);
      tarj  += Num.parse(c.tarjeta   || 0);
      efec  += Num.parse(c.efectivo  || 0);
      apps  += Num.parse(c.apps      || 0);
    });
    return { total: Num.round2(total), tarj: Num.round2(tarj), efec: Num.round2(efec), apps: Num.round2(apps), cierresMes };
  }, [data.cierres, currentFilterDate, selectedUnit]);

  const handleMonthChange = (dir: number) => {
    const [y, m] = currentFilterDate.split('-').map(Number);
    const d = new Date(y, m - 1 + dir);
    setCurrentFilterDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // ─── Guardar cierre ───────────────────────────────────────────────────────
  const handleSaveCierre = async () => {
    const fecha    = form.date;
    const cierreId = `ZR-${fecha.replace(/-/g, '')}`;

    if (estadoCierreHoy.restCerrado) {
      const ok = await confirm(
        `⚠️ Ya existe un cierre para el ${fecha} con ${Num.fmt(estadoCierreHoy.ventaRest!)} en ventas.\n\n` +
        `¿Quieres SOBREESCRIBIRLO con los nuevos valores?\n\n` +
        `(Pulsa Cancelar si fue un error)`
      );
      if (!ok) return;
    }

    setIsSaving(true);
    try {
      const newData: AppData = JSON.parse(JSON.stringify(data));
      if (!newData.cierres)  newData.cierres  = [];
      if (!newData.facturas) newData.facturas = [];
      if (!newData.banco)    newData.banco    = [];

      // Gastos de caja
      gastosCaja.forEach((g, idx) => {
        const imp  = Num.parse(g.importe);
        const base = Num.round2(imp / (1 + g.iva / 100));
        newData.facturas!.unshift({
          id: `gc-${Date.now()}-${idx}`, tipo: 'caja', num: `GC-${fecha}-${idx}`,
          date: fecha, prov: g.concepto.toUpperCase(), total: imp, base, tax: imp - base,
          paid: true, reconciled: true, unidad_negocio: g.unidad,
        } as any);
      });

      // Ingreso a banco
      if (Num.parse(depositoBanco) > 0) {
        newData.banco!.unshift({
          id: `dep-${Date.now()}`, date: fecha,
          desc: 'Ingreso efectivo caja', amount: Num.parse(depositoBanco), status: 'pending',
        } as any);
      }

      // Cierre Restaurante
      const cierreRest: Cierre = {
        id: cierreId, date: fecha,
        totalVenta: calc.totalRestauranteNeto,
        efectivo:   Num.parse(form.efectivo),
        tarjeta:    calc.totalTarjetas,
        apps:       calc.appsNetas,
        descuadre:  calc.descuadreVivo || 0,
        notas:      form.notas,
        unitId:     'REST',
      };
      upsertFactura(newData.cierres!, cierreRest, 'id');
      upsertFactura(newData.facturas!, {
        id: `f-zr-${fecha}`, tipo: 'caja', num: cierreId, date: fecha,
        prov: 'Z DIARIO', total: calc.totalRestauranteNeto,
        paid: false, reconciled: false, unidad_negocio: 'REST',
      } as any, 'num');

      // Cierre Tienda Sake
      if (Num.parse(form.tienda) > 0) {
        const shopId = `ZS-${fecha.replace(/-/g, '')}`;
        upsertFactura(newData.cierres!, {
          id: shopId, date: fecha, totalVenta: Num.parse(form.tienda),
          efectivo: 0, tarjeta: 0, apps: 0, descuadre: 0,
          notas: 'Venta separada', unitId: 'SHOP',
        } as any, 'id');
        upsertFactura(newData.facturas!, {
          id: `f-zs-${fecha}`, tipo: 'caja', num: shopId, date: fecha,
          prov: 'Z DIARIO', total: Num.parse(form.tienda),
          paid: false, reconciled: false, unidad_negocio: 'SHOP',
        } as any, 'num');
      }

      await onSave(newData);
      toast.success(`✨ Caja del ${fecha} cerrada · Neto: ${Num.fmt(calc.totalRestauranteNeto)}`);
      triggerConfetti(); // 🎉 celebración
      setForm({
        date: getSafeDate(), efectivo: '', tpv1: '', tpv2: '', amex: '',
        glovo: '', uber: '', madisa: '', apperStreet: '',
        cajaFisica: '', tienda: '', notas: '',
      });
      setImages({ img1: null }); setGastosCaja([]); setDepositoBanco('');
    } catch {
      toast.error('❌ Error crítico al guardar. Comprueba la conexión.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCierre = async (id: string) => {
    if (!await confirm('¿Borrar permanentemente este cierre?')) return;
    const newData = { ...data };
    newData.facturas = (newData.facturas || []).filter((f: any) => f.num !== id);
    newData.cierres  = (newData.cierres  || []).filter((x: any) => x.id  !== id);
    await onSave(newData);
  };

  /**
   * 📝 Cargar un cierre ya guardado al formulario para poder editarlo.
   * El usuario pulsa en un cierre del histórico → se cargan todos sus
   * valores al formulario → puede corregir fecha, gastos, lo que sea
   * → al pulsar 'Cerrar Caja' se sobreescribe (upsert por id) y
   * actualiza también la factura Z asociada.
   */
  const handleEditCierre = useCallback(async (cierre: Cierre & any) => {
    // Confirmación si ya hay valores escritos sin guardar
    const hayDatosSinGuardar = Boolean(
      form.efectivo || form.tpv1 || form.tpv2 || form.amex ||
      form.glovo || form.uber || form.madisa || form.apperStreet ||
      form.cajaFisica || form.tienda || form.notas ||
      gastosCaja.length > 0 || depositoBanco
    );
    if (hayDatosSinGuardar) {
      const ok = await confirm({
        title: '¿Descartar lo que estás escribiendo?',
        message: `Vas a cargar el cierre del ${cierre.date} para editarlo. Lo que tienes ahora en el formulario se perderá.`,
        danger: true,
        confirmLabel: 'Sí, cargar',
      });
      if (!ok) return;
    }

    // Cargamos valores al formulario
    setForm({
      date:        cierre.date || getSafeDate(),
      efectivo:    String(Num.parse(cierre.efectivo || 0) || ''),
      tpv1:        String(Num.parse(cierre.tpv1 || 0) || ''),
      tpv2:        String(Num.parse(cierre.tpv2 || 0) || ''),
      amex:        String(Num.parse(cierre.amex || 0) || ''),
      glovo:       String(Num.parse(cierre.glovo || 0) || ''),
      uber:        String(Num.parse(cierre.uber || 0) || ''),
      madisa:      String(Num.parse(cierre.madisa || 0) || ''),
      apperStreet: String(Num.parse(cierre.apperStreet || 0) || ''),
      cajaFisica:  String(Num.parse(cierre.cajaFisica || 0) || ''),
      tienda:      String(Num.parse(cierre.tienda || 0) || ''),
      notas:       String(cierre.notas || ''),
    });

    // Scroll suave al formulario arriba
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);

    toast.info(`📝 Editando cierre del ${cierre.date}. Corrige y pulsa "Cerrar Caja" para sobreescribir.`);
  }, [form, gastosCaja, depositoBanco]);

  const handleExportGestoria = () => {
    // ─── Filtrado por periodo ─────────────────────────────────────────────
    const prefix = exportMonth === 'all'
      ? `${exportYear}-`
      : `${exportYear}-${String(exportMonth + 1).padStart(2, '0')}-`;

    const cierresFiltrados = (data.cierres || [])
      .filter(c => String(c.date || '').startsWith(prefix))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    if (cierresFiltrados.length === 0) {
      toast.info('No hay cierres de caja en ese periodo.');
      return;
    }

    const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const periodoLabel = exportMonth === 'all' ? `Año ${exportYear}` : `${MESES[exportMonth as number]} ${exportYear}`;

    // ─── Hoja 1: Detalle día por día (lo que necesita la gestoría) ────────
    const detalleRows = cierresFiltrados.map((c: any) => {
      const efectivo    = Num.parse(c.efectivo || 0);
      const tarjeta     = Num.parse(c.tarjeta || c.tpv1 || 0) + Num.parse(c.tpv2 || 0) + Num.parse(c.amex || 0);
      const apps        = Num.parse(c.apps || 0) + Num.parse(c.glovo || 0) + Num.parse(c.uber || 0) + Num.parse(c.madisa || 0) + Num.parse(c.apperStreet || 0);
      const total       = Num.parse(c.totalVenta || c.totalVentas || 0);
      const baseNeta    = total > 0 ? Num.round2(total / 1.10) : 0;
      const iva         = total > 0 ? Num.round2(total - baseNeta) : 0;
      return {
        'FECHA'           : c.date,
        'UNIDAD'          : c.unitId || 'REST',
        'EFECTIVO'        : Num.round2(efectivo),
        'TARJETA'         : Num.round2(tarjeta),
        'APPS DELIVERY'   : Num.round2(apps),
        'TOTAL VENTA'     : Num.round2(total),
        'BASE IMPONIBLE'  : baseNeta,
        'IVA 10%'         : iva,
        'DESCUADRE'       : Num.round2(Num.parse(c.descuadre || 0)),
        'NOTAS'           : c.notas || c.notas || '',
      };
    });

    // ─── Hoja 2: Resumen del periodo ──────────────────────────────────────
    const totEfectivo = detalleRows.reduce((s, r) => s + r['EFECTIVO'], 0);
    const totTarjeta  = detalleRows.reduce((s, r) => s + r['TARJETA'], 0);
    const totApps     = detalleRows.reduce((s, r) => s + r['APPS DELIVERY'], 0);
    const totVenta    = detalleRows.reduce((s, r) => s + r['TOTAL VENTA'], 0);
    const totBase     = detalleRows.reduce((s, r) => s + r['BASE IMPONIBLE'], 0);
    const totIVA      = detalleRows.reduce((s, r) => s + r['IVA 10%'], 0);
    const totDescuadre = detalleRows.reduce((s, r) => s + r['DESCUADRE'], 0);

    const resumenRows = [
      { CONCEPTO: `PERIODO`,                     IMPORTE: periodoLabel        },
      { CONCEPTO: `DÍAS CON CIERRE`,              IMPORTE: detalleRows.length   },
      { CONCEPTO: '',                             IMPORTE: '' },
      { CONCEPTO: 'TOTAL EFECTIVO',               IMPORTE: Num.round2(totEfectivo) },
      { CONCEPTO: 'TOTAL TARJETA (TPV + AMEX)',   IMPORTE: Num.round2(totTarjeta) },
      { CONCEPTO: 'TOTAL APPS (Glovo/Uber/etc.)', IMPORTE: Num.round2(totApps) },
      { CONCEPTO: '',                             IMPORTE: '' },
      { CONCEPTO: 'TOTAL VENTA',                  IMPORTE: Num.round2(totVenta) },
      { CONCEPTO: 'BASE IMPONIBLE (sin IVA)',     IMPORTE: Num.round2(totBase) },
      { CONCEPTO: 'IVA REPERCUTIDO 10%',          IMPORTE: Num.round2(totIVA) },
      { CONCEPTO: '',                             IMPORTE: '' },
      { CONCEPTO: 'DESCUADRE ACUMULADO',          IMPORTE: Num.round2(totDescuadre) },
    ];

    // ─── Generar Excel ────────────────────────────────────────────────────
    const wsDetalle = XLSX.utils.json_to_sheet(detalleRows);
    wsDetalle['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
      { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 30 },
    ];
    const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
    wsResumen['!cols'] = [{ wch: 32 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');
    XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle Diario');

    const fileName = exportMonth === 'all'
      ? `Cierres_Caja_Arume_${exportYear}.xlsx`
      : `Cierres_Caja_Arume_${exportYear}-${String((exportMonth as number) + 1).padStart(2, '0')}.xlsx`;

    XLSX.writeFile(wb, fileName);
    setIsExportModalOpen(false);
    toast.success(`${detalleRows.length} cierres exportados`);
  };

  // ─── Scan IA ──────────────────────────────────────────────────────────────
  const handleScanIA = async (file: File) => {
    setScanStatus('loading');
    try {
      // Guardar preview de la imagen escaneada
      setImages({ img1: URL.createObjectURL(file) });

      const prompt = 'Eres un asistente contable. Lee este ticket de caja y extrae los totales. Devuelve SOLO JSON: {"efectivo":0,"tpv1":0,"tpv2":0,"glovo":0,"uber":0,"tienda":0,"notas":""}';
      // Forzamos Gemini para tickets de caja: si falla, mejor un error que un
      // modelo de menor capacidad (Mistral/Groq) inventando un total. Para
      // facturas/albaranes el fallback sigue activo en su flujo propio.
      const result = await scanDocument(file, prompt, 'gemini');
      const raw: any = result.raw;
      // ⚠️ FIX: el `0` es falsy en JS. Usar `?` ignoraba un cero legítimo
      // (un domingo sin efectivo) y dejaba el valor anterior del formulario.
      // Aceptamos números (incluyendo 0) y strings no vacíos.
      const pickNum = (v: any, fallback: string) =>
        (v === undefined || v === null || v === '') ? fallback : String(v);
      setForm(f => ({
        ...f,
        efectivo: pickNum(raw.efectivo, f.efectivo),
        tpv1:     pickNum(raw.tpv1,     f.tpv1),
        tpv2:     pickNum(raw.tpv2,     f.tpv2),
        glovo:    pickNum(raw.glovo,    f.glovo),
        uber:     pickNum(raw.uber,     f.uber),
        tienda:   pickNum(raw.tienda,   f.tienda),
        // notas vacías sí mantienen el valor previo (no queremos borrarlas)
        notas:    raw.notas ? raw.notas : f.notas,
      }));
      setScanStatus('success');
    } catch {
      setScanStatus('error');
    }
  };

  // ─── Cabecera mes ────────────────────────────────────────────────────────
  const [yearStr, monthStr] = currentFilterDate.split('-');
  const nombreMes = new Date(Number(yearStr), Number(monthStr) - 1)
    .toLocaleString('es-ES', { month: 'long', year: 'numeric' })
    .toUpperCase();

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className={cn('animate-fade-in space-y-6 pb-24', scanStatus === 'loading' && 'transition-none')}>

      {/* OVERLAY GRABACIÓN VOZ */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] w-11/12 max-w-md bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] p-4 rounded-3xl shadow-2xl border-2 border-indigo-500 cursor-pointer flex flex-col items-center gap-2"
            onClick={toggleRecording}
          >
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse"/>
              <span className="text-xs font-black uppercase tracking-widest">Escuchando… (Toca para parar)</span>
            </div>
            <p className="text-xs text-slate-300 text-center italic line-clamp-3 w-full">
              {liveTranscript || "Di 'Efectivo 300, TPV1 1200, Glovo 60'…"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── PANEL DIAGNÓSTICO VOZ ── borrar cuando funcione correctamente ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-indigo-500"/>
            <span className="text-xs font-black text-slate-700 uppercase tracking-widest">Diagnóstico de Voz</span>
          </div>
          <button onClick={() => setShowVoiceDiag(p => !p)} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 transition">
            {showVoiceDiag ? 'Ocultar' : 'Ver log'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className={cn('px-3 py-2 rounded-xl font-bold flex items-center gap-2',
            (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
              ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
            <span className="w-2 h-2 rounded-full bg-current"/>
            {(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
              ? 'SpeechRecognition: OK' : 'NO DISPONIBLE'}
          </div>
          <div className={cn('px-3 py-2 rounded-xl font-bold flex items-center gap-2',
            localStorage.getItem('voice_provider') === 'groq' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700')}>
            <span className="w-2 h-2 rounded-full bg-current"/>
            {localStorage.getItem('voice_provider') === 'groq' ? '⚡ Groq Whisper' : '🌐 Navegador'}
          </div>
          <div className={cn('px-3 py-2 rounded-xl font-bold flex items-center gap-2',
            localStorage.getItem('groq_api_key') ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
            <span className="w-2 h-2 rounded-full bg-current"/>
            Groq key: {localStorage.getItem('groq_api_key') ? '✅ OK' : '❌ Sin key'}
          </div>
          <div className={cn('px-3 py-2 rounded-xl font-bold flex items-center gap-2',
            isRecording ? 'bg-rose-50 text-rose-700 animate-pulse' : 'bg-slate-100 text-slate-500')}>
            <span className="w-2 h-2 rounded-full bg-current"/>
            {isRecording ? '🔴 Grabando…' : '⚪ En espera'}
          </div>
        </div>

        {lastRawText && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1">Último texto recibido</p>
            <p className="text-sm font-bold text-indigo-800">"{lastRawText}"</p>
          </div>
        )}

        {showVoiceDiag && voiceDiag.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Log</p>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {voiceDiag.map((line, i) => (
                <div key={i} className={cn('text-[10px] font-mono px-3 py-1.5 rounded-lg',
                  line.includes('SIN COINCIDENCIA') ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>
                  {line}
                </div>
              ))}
            </div>
            <button onClick={() => { setVoiceDiag([]); setLastRawText(''); }}
              className="text-[9px] font-bold text-slate-400 hover:text-rose-500 transition">
              Limpiar log
            </button>
          </div>
        )}

        <button onClick={toggleRecording}
          className={cn('w-full py-3 rounded-xl font-black text-xs uppercase tracking-widest transition flex items-center justify-center gap-2',
            isRecording ? 'bg-rose-500 text-white animate-pulse' : 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] hover:bg-[color:var(--arume-gray-700)]')}>
          {isRecording
            ? <><Square className="w-4 h-4"/> Parar y ver resultado</>
            : <><Mic className="w-4 h-4"/> Probar micrófono</>}
        </button>
      </div>
      {/* ── FIN PANEL DIAGNÓSTICO ── */}

      {/* BANNER DÍAS SIN CIERRE */}
      <AnimatePresence>
        {diasSinCierre >= 1 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-amber-600"/>
              </div>
              <div>
                <p className="text-sm font-black text-amber-800">
                  {diasSinCierre === 1 ? 'Ayer no tiene cierre de caja' : `${diasSinCierre} días consecutivos sin cierre`}
                </p>
                <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">
                  Cambia la fecha del formulario para registrarlo
                </p>
              </div>
            </div>
            <button
              onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); setForm(f => ({ ...f, date: d.toLocaleDateString('sv-SE') })); }}
              className="flex-shrink-0 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition">
              Ir a ayer
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER EDITORIAL */}
      <header className="flex flex-col md:flex-row justify-between md:items-end gap-4 bg-white p-6 rounded-2xl shadow-sm border border-[color:var(--arume-gray-100)]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Ventas</p>
          <h2 className="font-serif text-2xl md:text-3xl font-semibold tracking-tight mt-1">Caja y arqueo</h2>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {estadoCierreHoy.restCerrado ? (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-ok)] bg-[color:var(--arume-ok)]/10 border border-[color:var(--arume-ok)]/20 px-3 py-1 rounded-full tabular-nums">
                <CheckCircle2 className="w-3 h-3"/> Restaurante · {Num.fmt(estadoCierreHoy.ventaRest!)}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] bg-[color:var(--arume-gray-50)] border border-[color:var(--arume-gray-100)] px-3 py-1 rounded-full">
                <Clock className="w-3 h-3"/> Restaurante pendiente
              </span>
            )}
            {estadoCierreHoy.shopCerrado && (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-ok)] bg-[color:var(--arume-ok)]/10 border border-[color:var(--arume-ok)]/20 px-3 py-1 rounded-full tabular-nums">
                <CheckCircle2 className="w-3 h-3"/> Tienda · {Num.fmt(estadoCierreHoy.ventaShop!)}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 bg-slate-100 p-1.5 rounded-2xl">
          <button onClick={() => handleMonthChange(-1)} className="p-2 hover:bg-white rounded-xl transition text-slate-600"><ChevronLeft className="w-5 h-5"/></button>
          <input type="month" value={currentFilterDate} onChange={e => setCurrentFilterDate(e.target.value)} className="bg-transparent font-bold text-sm outline-none w-32 text-center"/>
          <button onClick={() => handleMonthChange(1)} className="p-2 hover:bg-white rounded-xl transition text-slate-600"><ChevronRight className="w-5 h-5"/></button>
        </div>
      </header>

      {/* FILTROS UNIDAD */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSelectedUnit('ALL')}
            className={cn('px-4 py-2 rounded-xl text-[9px] font-black uppercase border flex gap-1.5 items-center',
              selectedUnit === 'ALL' ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)]' : 'bg-white text-slate-400')}>
            <Layers className="w-3 h-3"/> Consolidado
          </button>
          {CASH_UNITS.map(u => (
            <button key={u.id} onClick={() => setSelectedUnit(u.id)}
              className={cn('px-4 py-2 rounded-xl text-[9px] font-black uppercase border flex gap-1.5 items-center',
                selectedUnit === u.id ? 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)]' : 'bg-white text-slate-400')}>
              <u.icon className="w-3 h-3"/> {u.name}
            </button>
          ))}
        </div>
        <button onClick={() => setIsExportModalOpen(true)}
          className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:bg-emerald-700 transition flex items-center gap-2">
          <Download className="w-4 h-4"/> EXPORTAR GESTORÍA
        </button>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 p-6 rounded-2xl text-white shadow-xl">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Facturación {nombreMes}</p>
          <p className="text-4xl font-black mt-2">{Num.fmt(kpis.total)}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center gap-2">
          {[
            { label: 'Tarjeta',  val: kpis.tarj, total: kpis.total, color: 'bg-indigo-500', Icon: CreditCard },
            { label: 'Efectivo', val: kpis.efec,  total: kpis.total, color: 'bg-emerald-500', Icon: Banknote  },
          ].map(({ label, val, total, color, Icon }) => (
            <div key={label}>
              <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
                <span className="flex items-center gap-1"><Icon className="w-3 h-3"/> {label}</span>
                <span>{Num.fmt(val)}</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={cn('h-full transition-all', color)} style={{ width: `${total > 0 ? (val / total) * 100 : 0}%` }}/>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center">
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
            <span className="flex items-center gap-1"><Truck className="w-3 h-3"/> Delivery</span>
            <span>{Num.fmt(kpis.apps)}</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 transition-all" style={{ width: `${kpis.total > 0 ? (kpis.apps / kpis.total) * 100 : 0}%` }}/>
          </div>
          <p className="text-[9px] font-bold text-slate-400 mt-3 uppercase tracking-widest">{kpis.cierresMes.length} cierres registrados</p>
        </div>
      </div>

      {/* FORMULARIO CIERRE */}
      <div className="bg-white p-8 md:p-10 rounded-[3rem] shadow-sm border border-slate-100">
        <div className="flex flex-col lg:flex-row gap-10">
          <div className="flex-1 space-y-6">

            {/* Fecha + botones */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fecha del Cierre</label>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400 transition"/>
                {/* 📅 Día de la semana + fecha larga tipo Google Calendar */}
                {form.date && (() => {
                  const d = new Date(form.date + 'T00:00:00');
                  if (isNaN(d.getTime())) return null;
                  const diaLargo = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const isToday = getSafeDate() === form.date;
                  return (
                    <span className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] border capitalize',
                      isToday ? 'bg-[color:var(--arume-gold)]/15 text-[color:var(--arume-ink)] border-[color:var(--arume-gold)]/30' :
                      isWeekend ? 'bg-[color:var(--arume-accent)]/10 text-[color:var(--arume-accent)] border-[color:var(--arume-accent)]/20' :
                      'bg-[color:var(--arume-gray-50)] text-[color:var(--arume-gray-600)] border-[color:var(--arume-gray-200)]'
                    )}>
                      {isToday ? '✨ Hoy · ' : ''}{diaLargo}
                    </span>
                  );
                })()}
              </div>
              <div className="flex gap-2">
                <button onClick={toggleRecording}
                  className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition border',
                    isRecording ? 'bg-red-500 text-white border-red-500' : 'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] border-slate-900 hover:bg-slate-700')}>
                  {isRecording ? <><Square className="w-3 h-3"/> PARAR</> : <><Mic className="w-3 h-3"/> DICTAR IA</>}
                </button>
                <button
                  onClick={async () => {
                    const last = getLastCierreValues(data);
                    if (!last) return void toast.warning('No hay cierres anteriores para copiar.');
                    if (!await confirm(`¿Copiar valores del cierre del ${last.date}?`)) return;
                    setForm(prev => ({ ...prev, efectivo: String(last.efectivo), tpv1: String(last.tpv1), tpv2: String(last.tpv2), glovo: String(last.glovo), uber: String(last.uber) }));
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-100 transition border border-indigo-200">
                  <RefreshCw className="w-3 h-3"/> Cierre Rápido
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Col izquierda */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. EFECTIVO DEL SOBRE</label>
                <input type="number" placeholder="0.00" value={form.efectivo}
                  onChange={e => setForm({ ...form, efectivo: e.target.value })}
                  className="w-full p-4 bg-slate-50 rounded-2xl text-2xl font-black outline-none border border-slate-100 focus:bg-white focus:border-indigo-300 transition-all tabular-nums"/>

                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mt-4">2. TARJETAS</label>
                <div className="grid grid-cols-3 gap-2">
                  {[{ key: 'tpv1', label: 'TPV 1' }, { key: 'tpv2', label: 'TPV 2' }, { key: 'amex', label: 'AMEX' }].map(f => (
                    <div key={f.key}>
                      <p className="text-[9px] text-slate-400 font-black mb-1">{f.label}</p>
                      <input type="number" placeholder="0" value={(form as any)[f.key]}
                        onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                        className="w-full p-3 bg-slate-50 rounded-xl text-sm font-black outline-none border border-slate-100 focus:border-indigo-300 transition-all tabular-nums"/>
                    </div>
                  ))}
                </div>

                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mt-4">3. DELIVERY</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'glovo',       label: 'Glovo (-30%)'  },
                    { key: 'uber',        label: 'Uber (-30%)'   },
                    { key: 'madisa',      label: 'Madisa'        },
                    { key: 'apperStreet', label: 'ApperStreet'   },
                  ].map(f => (
                    <div key={f.key}>
                      <p className="text-[9px] text-slate-400 font-black mb-1">{f.label}</p>
                      <input type="number" placeholder="0" value={(form as any)[f.key]}
                        onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                        className="w-full p-3 bg-slate-50 rounded-xl text-sm font-black outline-none border border-slate-100 focus:border-indigo-300 transition-all tabular-nums"/>
                    </div>
                  ))}
                </div>
              </div>

              {/* Col derecha */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">4. ARQUEO FÍSICO</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] text-slate-400 font-black mb-1">Fondo de Caja (€)</p>
                    <input type="number" value={fondoCaja} onChange={e => setFondoCaja(Number(e.target.value) || 0)}
                      className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold outline-none border border-slate-100 focus:border-indigo-300 transition-all"/>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-400 font-black mb-1">Caja Física Total (€)</p>
                    <input type="number" placeholder="0.00" value={form.cajaFisica}
                      onChange={e => setForm({ ...form, cajaFisica: e.target.value })}
                      className={cn('w-full p-3 rounded-xl text-sm font-black outline-none border transition-all',
                        calc.descuadreVivo === null        ? 'bg-slate-50 border-slate-100'    :
                        Math.abs(calc.descuadreVivo) <= 2  ? 'bg-emerald-50 border-emerald-200' :
                                                             'bg-rose-50 border-rose-200')}/>
                  </div>
                </div>
                {calc.descuadreVivo !== null && (
                  <div className={cn('px-4 py-3 rounded-2xl flex items-center justify-between',
                    Math.abs(calc.descuadreVivo) <= 2 ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200')}>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Descuadre</span>
                    <span className={cn('font-black text-lg tabular-nums',
                      Math.abs(calc.descuadreVivo) <= 2 ? 'text-emerald-600' : 'text-rose-600')}>
                      {calc.descuadreVivo >= 0 ? '+' : ''}{Num.fmt(calc.descuadreVivo)}
                    </span>
                  </div>
                )}

                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mt-4">5. TIENDA SAKE</label>
                <input type="number" placeholder="0.00" value={form.tienda}
                  onChange={e => setForm({ ...form, tienda: e.target.value })}
                  className="w-full p-3 bg-slate-50 rounded-xl text-sm font-black outline-none border border-slate-100 focus:border-indigo-300 transition-all tabular-nums"/>

                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mt-4">6. INGRESO A BANCO (€)</label>
                <input type="number" placeholder="¿Cuánto efectivo llevas al banco hoy?" value={depositoBanco}
                  onChange={e => setDepositoBanco(e.target.value)}
                  className="w-full p-3 bg-indigo-50 rounded-xl text-sm font-bold outline-none border border-indigo-100 focus:border-indigo-300 transition-all tabular-nums"/>
              </div>
            </div>

            {/* Gastos sobre */}
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">7. GASTOS PAGADOS CON DINERO DEL SOBRE</label>
              <GastoCajaEditor
                gastos={gastosCaja}
                onAdd={(g) => setGastosCaja(prev => [...prev, g])}
                onDelete={(i) => setGastosCaja(prev => prev.filter((_, idx) => idx !== i))}
              />
            </div>

            {/* Notas */}
            <div className="relative">
              <textarea value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })}
                className="w-full p-5 bg-slate-50 rounded-2xl text-xs min-h-[100px] outline-none border border-slate-100 focus:bg-white transition-all"
                placeholder="Notas del día (incidencias, eventos especiales...)"/>
              {form.notas && (
                <button onClick={() => setForm({ ...form, notas: '' })} className="absolute top-5 right-5 text-slate-300 hover:text-rose-500 transition-colors">
                  <XCircle className="w-5 h-5"/>
                </button>
              )}
            </div>

            {/* Botón cerrar caja */}
            <button onClick={handleSaveCierre} disabled={isSaving}
              className={cn('w-full mt-2 py-6 text-white rounded-2xl font-black text-base shadow-2xl transition-all transform active:scale-95 disabled:opacity-50',
                estadoCierreHoy.restCerrado
                  ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20'
                  : 'bg-slate-900 hover:bg-[color:var(--arume-gray-700)] shadow-slate-900/20')}>
              {isSaving
                ? 'PROCESANDO CIERRE...'
                : estadoCierreHoy.restCerrado
                  ? `⚠️ SOBREESCRIBIR CIERRE (${Num.fmt(calc.totalRestauranteNeto)} NETOS)`
                  : `✓ CERRAR CAJA · ${Num.fmt(calc.totalRestauranteNeto)} NETOS`}
            </button>
          </div>

          {/* Panel lateral escaneo + resumen */}
          <div className="lg:w-72 space-y-4">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Escanear Ticket con IA</label>
            <label className={cn(
              'flex flex-col items-center justify-center w-full h-48 rounded-2xl border-2 border-dashed cursor-pointer transition-all',
              scanStatus === 'loading' ? 'border-indigo-300 bg-indigo-50'  :
              scanStatus === 'success' ? 'border-emerald-300 bg-emerald-50' :
              scanStatus === 'error'   ? 'border-rose-300 bg-rose-50'       :
              'border-slate-200 hover:border-indigo-300 hover:bg-slate-50')}>
              <input type="file" accept="image/*" className="hidden" onChange={async e => {
                if (e.target.files?.[0]) await handleScanIA(e.target.files[0]);
                e.target.value = '';
              }}/>
              {scanStatus === 'loading' ? <><Sparkles className="w-8 h-8 text-indigo-400 animate-pulse mb-2"/><p className="text-xs font-black text-indigo-500">Analizando...</p></> :
               scanStatus === 'success' ? <><CheckCircle2 className="w-8 h-8 text-emerald-400 mb-2"/><p className="text-xs font-black text-emerald-500">¡Datos extraídos!</p></> :
               scanStatus === 'error'   ? <><AlertTriangle className="w-8 h-8 text-rose-400 mb-2"/><p className="text-xs font-black text-rose-500">Error al leer</p></> :
               <><Scan className="w-8 h-8 text-slate-300 mb-2"/><p className="text-xs font-bold text-slate-400 text-center px-4">Sube una foto del ticket<br/>y la IA rellenará el formulario</p></>}
            </label>
            {images.img1 && (
              <div className="relative rounded-2xl overflow-hidden">
                <img src={images.img1} alt="ticket" className="w-full h-32 object-cover"/>
                <button onClick={() => { setImages({ img1: null }); setScanStatus('idle'); }}
                  className="absolute top-2 right-2 bg-white/80 rounded-full p-1 hover:bg-white transition">
                  <XCircle className="w-4 h-4 text-slate-600"/>
                </button>
              </div>
            )}

            {/* Aviso de revisión post-escaneo: la IA puede leer mal cifras
                borrosas. No bloqueamos el botón "Cerrar Caja" para no estorbar
                cuando ya has revisado, sólo subrayamos que mires la foto. */}
            {scanStatus === 'success' && (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-black text-amber-800 uppercase tracking-wider">Revisa antes de cerrar</p>
                  <p className="text-[10px] font-bold text-amber-700 mt-0.5">La IA pre-rellena los campos pero puede equivocarse con cifras borrosas. Compara los importes con la foto antes de pulsar "Cerrar Caja".</p>
                </div>
              </div>
            )}

            {/* Resumen en vivo */}
            <div className="bg-slate-900 p-5 rounded-2xl text-white space-y-2">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Resumen en Vivo</p>
              {[
                { label: 'Efectivo',    val: Num.parse(form.efectivo), color: 'text-emerald-400' },
                { label: 'Tarjetas',    val: calc.totalTarjetas,       color: 'text-indigo-400'  },
                { label: 'Apps (neto)', val: calc.appsNetas,           color: 'text-amber-400'   },
                { label: 'Tienda Sake', val: Num.parse(form.tienda),   color: 'text-purple-400'  },
              ].map(r => (
                <div key={r.label} className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">{r.label}</span>
                  <span className={cn('font-black tabular-nums', r.color)}>{Num.fmt(r.val)}</span>
                </div>
              ))}
              <div className="border-t border-slate-700 pt-2 mt-2 flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-300 uppercase">NETO REST.</span>
                <span className="font-black text-xl text-white tabular-nums">{Num.fmt(calc.totalRestauranteNeto)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CashWeekSummary data={data}/>

      <div className="space-y-6">
        <CashHistoryList cierres={kpis.cierresMes} onDelete={handleDeleteCierre} onEdit={handleEditCierre}/>
      </div>

      {/* MODAL EXPORT — rediseñado editorial */}
      <AnimatePresence>
        {isExportModalOpen && (
          <div className="fixed inset-0 z-[600] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[color:var(--arume-ink)]/70 backdrop-blur-sm cursor-default"
              onClick={() => setIsExportModalOpen(false)}
            />
            <motion.div
              initial={{ y: 30, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 30, opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative bg-[color:var(--arume-paper)] w-full max-w-md rounded-2xl z-10 overflow-hidden"
              style={{ boxShadow: '0 24px 80px rgba(11,11,12,0.35)' }}
            >
              <span className="absolute top-0 left-0 right-0 h-[2px] bg-[color:var(--arume-gold)]"/>

              <div className="p-6 border-b border-[color:var(--arume-gray-100)]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[color:var(--arume-gold)]/10 border border-[color:var(--arume-gold)]/20 flex items-center justify-center">
                    <FileArchive className="w-5 h-5 text-[color:var(--arume-gold)]"/>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--arume-gray-500)]">Gestoría</p>
                    <h3 className="font-serif text-xl font-semibold mt-0.5">Exportar cierres de caja</h3>
                  </div>
                </div>
                <p className="text-sm text-[color:var(--arume-gray-500)] mt-3">
                  Excel con resumen del periodo + detalle diario. Formato listo para tu gestoría.
                </p>
              </div>

              <div className="p-6 space-y-4">
                {/* Año */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] mb-1.5 block">Año</label>
                  <select value={exportYear} onChange={e => setExportYear(Number(e.target.value))}
                    className="w-full p-3 bg-white border border-[color:var(--arume-gray-200)] rounded-xl text-sm outline-none focus:border-[color:var(--arume-ink)] transition">
                    {[2023, 2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>

                {/* Mes */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)] mb-1.5 block">Mes</label>
                  <select value={exportMonth === 'all' ? 'all' : String(exportMonth)} onChange={e => setExportMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="w-full p-3 bg-white border border-[color:var(--arume-gray-200)] rounded-xl text-sm outline-none focus:border-[color:var(--arume-ink)] transition">
                    <option value="all">— Año entero —</option>
                    {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) =>
                      <option key={i} value={i}>{m}</option>
                    )}
                  </select>
                  <p className="text-[11px] text-[color:var(--arume-gray-400)] mt-1.5">
                    Mensual = lo habitual para la gestoría. Año entero = cierre fiscal.
                  </p>
                </div>
              </div>

              <div className="p-4 border-t border-[color:var(--arume-gray-100)] flex gap-2 justify-end">
                <button onClick={() => setIsExportModalOpen(false)}
                  className="px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-600)] border border-[color:var(--arume-gray-200)] hover:bg-[color:var(--arume-gray-50)] transition">
                  Cancelar
                </button>
                <button onClick={handleExportGestoria}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] hover:brightness-95 transition active:scale-[0.98]">
                  <FileArchive className="w-3.5 h-3.5"/> Descargar Excel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Editor de gastos de sobre ────────────────────────────────────────────────
function GastoCajaEditor({ gastos, onAdd, onDelete }: {
  gastos: any[];
  onAdd: (g: any) => void;
  onDelete: (i: number) => void;
}) {
  const [row, setRow] = useState({ concepto: '', importe: '', iva: 10 as 4 | 10 | 21, unidad: 'REST' as CashBusinessUnit });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input value={row.concepto} onChange={e => setRow({ ...row, concepto: e.target.value })} placeholder="Ej: Pan, Hielo..."
          className="md:col-span-2 p-3 rounded-xl bg-slate-50 text-xs font-bold border-none outline-none focus:ring-2 ring-amber-200"/>
        <input value={row.importe} onChange={e => setRow({ ...row, importe: e.target.value })} placeholder="0.00 €" type="number"
          className="p-3 rounded-xl bg-slate-50 text-xs font-black border-none outline-none focus:ring-2 ring-amber-200"/>
        <select value={row.iva} onChange={e => setRow({ ...row, iva: Number(e.target.value) as 4 | 10 | 21 })}
          className="p-3 rounded-xl bg-slate-50 text-xs font-bold border-none outline-none">
          <option value={4}>4%</option><option value={10}>10%</option><option value={21}>21%</option>
        </select>
        <button
          onClick={() => { if (!row.concepto || !row.importe) return; onAdd(row); setRow({ concepto: '', importe: '', iva: 10, unidad: 'REST' }); }}
          className="p-3 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase hover:bg-amber-600 transition shadow-md flex items-center justify-center">
          <Plus className="w-5 h-5"/>
        </button>
      </div>
      {gastos.length > 0 && (
        <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
          {gastos.map((g, i) => (
            <motion.div initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} key={i}
              className="text-xs flex justify-between items-center bg-white rounded-xl px-4 py-3 border border-amber-100 shadow-sm">
              <span className="font-bold text-slate-600 uppercase text-[10px]">
                {g.concepto} <span className="text-slate-300 ml-2">({g.iva}%)</span>
              </span>
              <div className="flex items-center gap-4">
                <span className="font-black text-amber-600">{Num.fmt(Number(g.importe))}</span>
                <button onClick={() => onDelete(i)} className="text-rose-300 hover:text-rose-500">
                  <Trash2 className="w-4 h-4"/>
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
