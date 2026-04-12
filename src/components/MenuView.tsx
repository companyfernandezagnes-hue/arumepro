import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  ChefHat, TrendingUp, PieChart, ChevronLeft, ChevronRight, 
  Zap, Plus, Search, AlertTriangle, CheckCircle2, TableProperties, 
  Scale, Target, Calculator, Receipt, Camera, Loader2, FileText, X, Trash2,
  Calendar
} from 'lucide-react';
import { AppData, Plato } from '../types';
import { Num, DateUtil } from '../services/engine';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { useColumnDetector } from '../hooks/useColumnDetector';
import { scanDocument } from '../services/aiProviders';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';

interface MenuViewProps {
  db: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

type FilterMode = 'day' | 'month' | 'year';
type ViewTab = 'matrix' | 'table' | 'omnes' | 'financials' | 'simulator';

/* =======================================================
 * 🛡️ FUNCIONES BASE A PRUEBA DE CRASHEOS (Null Safety)
 * ======================================================= */
const getIva = (cat?: string) => (String(cat || '').toLowerCase().match(/bebida|alcohol|vino/)) ? 0.21 : 0.10;
const getNetPrice = (price: number, iva: number) => price > 0 ? Num.round2(price / (1 + iva)) : 0;
const norm = (s?: string) => String(s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, '');

const categorizeItem = (name?: string) => {
  const n = String(name || '').toLowerCase();
  if (n.match(/vino|agua|cerveza|copa|refresco|cafe|te\b/)) return 'Bebidas';
  if (n.match(/postre|tarta|helado|coulant/)) return 'Postre';
  if (n.match(/pan|ensalada|croqueta|entrante|tapa/)) return 'Entrantes';
  return 'General';
};

const compressImage = async (file: File | Blob): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1200 / bitmap.width, 1200 / bitmap.height, 1);
  canvas.width = bitmap.width * ratio; canvas.height = bitmap.height * ratio;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const b64 = await new Promise<string>((res) => { 
    const fr = new FileReader(); fr.onload = () => res((fr.result as string).split(',')[1]); 
    canvas.toBlob((b) => fr.readAsDataURL(b as Blob), 'image/jpeg', 0.7); 
  });
  return b64;
};

/* =======================================================
 * 📅 MODAL DE FECHA — reemplaza window.prompt()
 *    Bloqueado en iOS Safari PWA — necesitamos un modal React
 * ======================================================= */
interface DateModalProps {
  title: string;
  defaultDate: string;
  onConfirm: (date: string) => void;
  onCancel: () => void;
}

const DatePickerModal: React.FC<DateModalProps> = ({ title, defaultDate, onConfirm, onCancel }) => {
  const [date, setDate] = useState(defaultDate);

  // Atajos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter')  onConfirm(date);
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date, onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onCancel}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{    opacity: 0, scale: 0.95, y: 8  }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-xs p-6 flex flex-col gap-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
            <Calendar className="w-6 h-6 text-indigo-500" />
          </div>
          <p className="text-sm font-black text-slate-800 leading-snug">{title}</p>
        </div>

        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          autoFocus
          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 transition cursor-pointer"
        />

        <p className="text-center text-[9px] font-bold text-slate-300 uppercase tracking-widest -mt-2">
          Enter para confirmar · Esc para cancelar
        </p>

        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-2xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 transition active:scale-95">
            Cancelar
          </button>
          <button onClick={() => onConfirm(date)} className="flex-1 py-3 rounded-2xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 transition shadow-lg active:scale-95">
            Confirmar
          </button>
        </div>
      </motion.div>
    </div>
  );
};

/* =======================================================
 * 🧠 HOOK: MENU ENGINEERING PRO
 * ======================================================= */
function useMenuIntelligencePRO(
  db: AppData, filterMode: FilterMode, filterValue: string, searchQ: string, 
  targetFC: number, invInicial: number, invFinal: number, costesFijos: number
) {
  return useMemo(() => {
    const result = { 
      mixTable: [] as any[], familiasData: {} as Record<string, any>, tips: [] as string[],
      global: {
        totalTeoricoBruto: 0, totalTeoricoNeto: 0, totalCosteIdeal: 0, totalBeneficioBruto: 0, 
        foodCostTeorico: 0, foodCostReal: 0, consumoReal: 0, cajaRealNeta: 0, totalComprasNetas: 0,
        clientes: 0, ticketMedio: 0, nrc: 0, mcPct: 0, breakEvenVentas: 0, breakEvenClientes: 0
      },
      omnes: { precioMedioOfertado: 0, precioMedioDemandado: 0, ratioOmnes: 0, rangoMax: 0, rangoMin: 0, amplitud: 0, cumple1: false, cumple2: false, grupos: { bajo:0, medio:0, alto:0} }
    };
    
    if (!db || !Array.isArray(db.platos) || db.platos.length === 0) return result;

    const checkDate = (dateStr?: string) => {
      if (!dateStr) return false;
      if (filterMode === 'day')   return dateStr === filterValue;
      if (filterMode === 'month') return dateStr.startsWith(filterValue);
      if (filterMode === 'year')  return dateStr.startsWith(filterValue);
      return false;
    };

    const ventasFiltradas  = (Array.isArray(db.ventas_menu) ? db.ventas_menu : []).filter(v => checkDate(v?.date) && Num.parse(v?.qty) > 0);
    const cierresFiltrados = (Array.isArray(db.cierres) ? db.cierres : []).filter(c => checkDate(c?.date) && c?.unitId === 'REST');
    
    result.global.cajaRealNeta       = cierresFiltrados.reduce((acc, c) => acc + (Num.parse(c?.totalVenta) / 1.10), 0);
    result.global.clientes           = cierresFiltrados.reduce((acc, c) => acc + (Num.parse((c as any)?.clientes) || 0), 0);
    result.global.totalComprasNetas  = (Array.isArray(db.albaranes) ? db.albaranes : []).filter(a => checkDate(a?.date) && (a?.unitId === 'REST' || !a?.unitId)).reduce((sum, alb) => sum + (Num.parse(alb?.base) || 0), 0);
    result.global.consumoReal        = invInicial + result.global.totalComprasNetas - invFinal;
    result.global.foodCostReal       = result.global.cajaRealNeta > 0 ? (result.global.consumoReal / result.global.cajaRealNeta) * 100 : 0;

    const ventasPorPlato: Record<string, number> = {};
    let totalUnidadesVendidas = 0;
    ventasFiltradas.forEach(v => { const q = Num.parse(v.qty); ventasPorPlato[v.id] = (ventasPorPlato[v.id] || 0) + q; totalUnidadesVendidas += q; });

    result.global.ticketMedio     = result.global.clientes > 0 ? result.global.cajaRealNeta / result.global.clientes : 0;
    result.global.nrc             = result.global.clientes > 0 ? totalUnidadesVendidas / result.global.clientes : 0;
    result.global.mcPct           = result.global.cajaRealNeta > 0 ? 1 - (result.global.foodCostReal / 100) : 0.70;
    result.global.breakEvenVentas = result.global.mcPct > 0 ? costesFijos / result.global.mcPct : 0;
    result.global.breakEvenClientes = result.global.ticketMedio > 0 ? result.global.breakEvenVentas / result.global.ticketMedio : 0;

    let totalQty = 0; const searchN = norm(searchQ);
    const tempFamilias: Record<string, any> = {};

    const analisis = db.platos.map(p => {
      const platoName  = String(p?.name || 'Plato sin nombre');
      const cat        = String(p?.category || 'General');
      const iva        = getIva(cat);
      const precioBruto  = Num.parse(p?.price);
      const precioNeto   = getNetPrice(precioBruto, iva);
      const costeBruto   = Num.parse(p?.cost) || 0; 
      const mermaPct     = Num.parse((p as any)?.merma) || 0;
      const mermaSegura  = mermaPct >= 100 ? 99 : mermaPct; 
      const costeRealEscandallo = costeBruto > 0 ? Num.round2(costeBruto / (1 - (mermaSegura / 100))) : costeBruto;
      const qty            = p?.id ? (ventasPorPlato[p.id] || 0) : 0;
      const margenUnitario = precioNeto - costeRealEscandallo;
      const fcUnitario     = precioNeto > 0 ? (costeRealEscandallo / precioNeto) * 100 : 0;
      const precioIdeal    = costeRealEscandallo > 0 ? Num.round2((costeRealEscandallo / (targetFC / 100)) * (1 + iva)) : precioBruto; 
      const totalVentasBrutoLinea = precioBruto * qty;
      const totalVentasNetoLinea  = precioNeto * qty;
      const totalCosteLinea       = costeRealEscandallo * qty;
      const totalBeneficioLinea   = margenUnitario * qty;

      totalQty += qty;
      result.global.totalTeoricoBruto  += totalVentasBrutoLinea;
      result.global.totalTeoricoNeto   += totalVentasNetoLinea;
      result.global.totalCosteIdeal    += totalCosteLinea;
      result.global.totalBeneficioBruto += totalBeneficioLinea;

      if (!tempFamilias[cat]) tempFamilias[cat] = { qty: 0, ventasBrutas: 0, ventasNetas: 0, coste: 0, beneficio: 0 };
      tempFamilias[cat].qty         += qty;
      tempFamilias[cat].ventasNetas  += totalVentasNetoLinea;
      tempFamilias[cat].ventasBrutas += totalVentasBrutoLinea; 
      tempFamilias[cat].coste        += totalCosteLinea;
      tempFamilias[cat].beneficio    += totalBeneficioLinea;

      return { 
        ...p, name: platoName, category: cat, qty, precioNeto, costeRealEscandallo, margenUnitario, fcUnitario, precioIdeal,
        totalVentasLinea: totalVentasNetoLinea, totalVentasBruto: totalVentasBrutoLinea, totalCosteLinea, totalBeneficioLinea 
      };
    });

    result.global.foodCostTeorico = result.global.totalTeoricoNeto > 0 ? (result.global.totalCosteIdeal / result.global.totalTeoricoNeto) * 100 : 0;

    const categorias = [...new Set(analisis.map(p => p.category))];
    categorias.forEach(cat => {
      const platosFamilia  = analisis.filter(p => p.category === cat);
      const activosFamilia = platosFamilia.filter(p => p.qty > 0);
      const udsFamilia     = tempFamilias[cat]?.qty || 0;
      const ventasBrutasFamilia = tempFamilias[cat]?.ventasBrutas || 0;
      const margenTotalFamilia  = platosFamilia.reduce((acc, p) => acc + (p.margenUnitario * p.qty), 0);

      let mediaPop = 0; let mediaMargen = 0;
      if (udsFamilia > 0 && activosFamilia.length > 0) {
        mediaPop    = (1 / activosFamilia.length) * 100; 
        mediaMargen = margenTotalFamilia / udsFamilia;
      }

      const preciosValidos = platosFamilia.filter(p => p.price > 0).map(p => p.price).sort((a,b) => a-b);
      const omnes = { pMedioOfertado: 0, pMedioDemandado: 0, ratio: 0, min: 0, max: 0, amplitud: 0, grupos: { bajo:0, medio:0, alto:0 }, cumple1: false, cumple2: false };
      
      if (preciosValidos.length > 0 && udsFamilia > 0) {
        omnes.min = preciosValidos[0]; omnes.max = preciosValidos[preciosValidos.length - 1];
        omnes.amplitud = omnes.min > 0 ? omnes.max / omnes.min : 0;
        const recorrido = (omnes.max - omnes.min) / 3;
        preciosValidos.forEach(p => {
          if (p <= omnes.min + recorrido) omnes.grupos.bajo++;
          else if (p <= omnes.min + 2 * recorrido) omnes.grupos.medio++;
          else omnes.grupos.alto++;
        });
        omnes.cumple1 = omnes.grupos.medio >= (omnes.grupos.bajo + omnes.grupos.alto);
        omnes.cumple2 = preciosValidos.length > 9 ? omnes.amplitud <= 3 : omnes.amplitud <= 2.5;
        omnes.pMedioOfertado  = preciosValidos.reduce((a,b)=>a+b,0) / preciosValidos.length;
        omnes.pMedioDemandado = ventasBrutasFamilia / udsFamilia; 
        omnes.ratio = omnes.pMedioOfertado > 0 ? omnes.pMedioDemandado / omnes.pMedioOfertado : 0;
      }

      const stars: any[] = []; const horses: any[] = []; const puzzles: any[] = []; const dogs: any[] = [];
      
      platosFamilia.forEach(p => {
        const mixPct = udsFamilia > 0 ? (p.qty / udsFamilia) * 100 : 0;
        const item   = { ...p, mixPct, grupo: '' };
        const esPop  = mixPct >= mediaPop;
        const esRent = p.margenUnitario >= mediaMargen;

        if (esPop && esRent)   { item.grupo = 'Estrella'; stars.push(item); }
        else if (esPop)        { item.grupo = 'Vaca';     horses.push(item); }
        else if (esRent)       { item.grupo = 'Puzzle';   puzzles.push(item); }
        else                   { item.grupo = 'Perro';    dogs.push(item); }

        if (p.qty > 0 || (searchN && norm(p.name).includes(searchN))) result.mixTable.push(item);
      });

      result.familiasData[cat] = { stars, horses, puzzles, dogs, omnes, udsFamilia, ventasBrutasFamilia };
    });

    result.mixTable.sort((a, b) => b.totalBeneficioLinea - a.totalBeneficioLinea);
    return result;
  }, [db?.platos, db?.ventas_menu, db?.cierres, db?.albaranes, filterMode, filterValue, searchQ, targetFC, invInicial, invFinal, costesFijos]);
}

/* =======================================================
 * 🎨 COMPONENTE PRINCIPAL
 * ======================================================= */
export const MenuView: React.FC<MenuViewProps> = ({ db, onSave }) => {
  const [filterMode,  setFilterMode]  = useState<FilterMode>('month');
  const [filterValue, setFilterValue] = useState(new Date().toISOString().slice(0, 7));
  const [searchQ,     setSearchQ]     = useState('');
  const [viewTab,     setViewTab]     = useState<ViewTab>('financials');
  const [targetFC,    setTargetFC]    = useState(30); 
  const [invInicial,  setInvInicial]  = useState(0);
  const [invFinal,    setInvFinal]    = useState(0);
  const [costesFijos, setCostesFijos] = useState(15000);
  
  const [editingPlato, setEditingPlato] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iaInputRef   = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);

  // 🆕 Estado para el modal de fecha (reemplaza window.prompt)
  const [dateModal, setDateModal] = useState<{
    title: string;
    resolve: (date: string | null) => void;
  } | null>(null);

  // 🆕 Helper: muestra el modal de fecha y devuelve una Promise
  const askDate = useCallback((title: string): Promise<string | null> => {
    return new Promise(resolve => setDateModal({ title, resolve }));
  }, []);

  // Pendientes para procesar tras la selección de fecha en IA/Excel
  const pendingIARef    = useRef<{ platos: any[]; ventas: any[] } | null>(null);
  const pendingExcelRef = useRef<{ platos: any[]; ventas: any[] } | null>(null);

  const { analyzeColumns, saveProfile } = useColumnDetector();
  const data = useMenuIntelligencePRO(db, filterMode, filterValue, searchQ, targetFC, invInicial, invFinal, costesFijos);

  const [simulatedPlatos, setSimulatedPlatos] = useState<any[]>([]);
  useEffect(() => { if (viewTab === 'simulator') setSimulatedPlatos(JSON.parse(JSON.stringify(data.mixTable))); }, [viewTab, data.mixTable]);

  // ── Importar ventas con IA ────────────────────────────────────────────────
  const handleUploadIA = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    setIsScanning(true);
    try {
      const prompt = `Analiza este informe de ventas de restaurante (Ticket Z o PDF). Extrae las líneas de productos vendidos. Devuelve SOLO JSON estricto: { "ventas": [ {"n": "Nombre plato", "q": 5, "p": 12.50} ] }`;

      const result = await scanDocument(file, prompt);
      const json: any = result.raw;
      if (!json.ventas || !Array.isArray(json.ventas)) throw new Error("Formato inválido devuelto por IA");

      // Preparar platos y ventas sin fecha aún
      const newPlatos = [...(db.platos || [])];
      const newVentas = [...(db.ventas_menu || [])];
      let count = 0;

      // Guardamos el trabajo previo en un ref y pedimos la fecha con el modal
      const tempVentasSinFecha: { platoId: string; qty: number }[] = [];

      json.ventas.forEach((v: any) => {
        const name = String(v.n || '').trim(); const sold = Num.parse(v.q); const price = Num.parse(v.p);
        if (name && sold > 0) {
          let plato = newPlatos.find(p => String(p.name || '').toLowerCase().trim() === name.toLowerCase().trim());
          if (!plato) { 
            plato = { id: 'p-' + Date.now() + Math.random(), name, category: categorizeItem(name), price, cost: 0, iva: getIva(categorizeItem(name)) as any }; 
            newPlatos.push(plato); 
          }
          tempVentasSinFecha.push({ platoId: plato.id, qty: sold });
          count++;
        }
      });

      setIsScanning(false);

      // 🆕 Modal de fecha en vez de window.prompt()
      const dateInput = await askDate(`¿A qué fecha corresponden estas ${count} líneas de ventas?`);
      if (!dateInput) return;

      tempVentasSinFecha.forEach(({ platoId, qty }) => {
        const existing = newVentas.find(vt => vt.date === dateInput && vt.id === platoId);
        if (existing) existing.qty += qty;
        else newVentas.push({ date: dateInput, id: platoId, qty });
      });

      await onSave({ ...db, platos: newPlatos, ventas_menu: newVentas });
      toast.success(`IA completada — ${count} líneas importadas.`);

    } catch (error) {
      setIsScanning(false);
      toast.error('La IA no pudo leer el archivo. Comprueba el formato e inténtalo de nuevo.');
    }
  };

  // ── Importar ventas desde Excel ───────────────────────────────────────────
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb   = XLSX.read(new Uint8Array(evt.target?.result as ArrayBuffer), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
        
        const analysis = analyzeColumns(rows);
        const colName  = analysis.mapping.name;
        const colQty   = analysis.mapping.qty;
        const colPrice = analysis.mapping.price;
        
        if (colName === -1 || colQty === -1) return void toast.warning("No se detectaron columnas válidas de 'Artículo' o 'Cantidad'.");

        const newPlatos: any[] = [...(db.platos || [])];
        const ventasSinFecha: { platoId: string; qty: number }[] = [];

        rows.slice(1).forEach(row => {
          const name       = String(row[colName] || '').trim(); 
          const sold       = Num.parse(row[colQty]); 
          const priceFound = colPrice > -1 ? Num.parse(row[colPrice]) : 0;
          if (name && sold > 0) {
            let plato = newPlatos.find(p => String(p.name || '').toLowerCase().trim() === name.toLowerCase().trim());
            if (!plato) { 
              plato = { id: 'p-' + Date.now() + Math.random(), name, category: categorizeItem(name), price: priceFound, cost: 0, iva: getIva(categorizeItem(name)) as any }; 
              newPlatos.push(plato); 
            }
            ventasSinFecha.push({ platoId: plato.id, qty: sold });
          }
        });

        if (ventasSinFecha.length === 0) return void toast.warning('El archivo no contiene filas válidas.');

        // 🆕 Modal de fecha en vez de window.prompt()
        const dateInput = await askDate(`¿A qué fecha corresponden estas ${ventasSinFecha.length} líneas del Excel?`);
        if (!dateInput) return;

        const newVentas = [...(db.ventas_menu || [])];
        ventasSinFecha.forEach(({ platoId, qty }) => {
          const existing = newVentas.find(v => v.date === dateInput && v.id === platoId);
          if (existing) existing.qty += qty;
          else newVentas.push({ date: dateInput, id: platoId, qty });
        });

        saveProfile(rows, analysis.mapping);
        await onSave({ ...db, platos: newPlatos, ventas_menu: newVentas }); 
        toast.success(`Importadas ${ventasSinFecha.length} líneas.`);

      } catch (err) {
        toast.error('Error al leer el archivo Excel.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSavePlato = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editingPlato) return;
    const newPlatos = [...(db.platos || [])];
    const index = newPlatos.findIndex(p => p.id === editingPlato.id);
    if (index > -1) newPlatos[index] = editingPlato; else newPlatos.push(editingPlato);
    await onSave({ ...db, platos: newPlatos });
    setEditingPlato(null);
  };

  const handleDeletePlato = async (id: string) => {
    if (!await confirm({
      title:        '¿Eliminar este plato?',
      message:      'Se perderá también su historial de ventas vinculado.',
      danger:        true,
      confirmLabel: 'Eliminar',
    })) return;
    const newPlatos = (db.platos || []).filter(p => p.id !== id);
    await onSave({ ...db, platos: newPlatos });
    setEditingPlato(null);
  };

  const renderQuad = (title: string, subtitle: string, color: string, list: any[]) => (
    <div className={`bg-white p-4 rounded-3xl border border-slate-200 shadow-sm h-72 flex flex-col group`}>
      <div className="flex justify-between items-start mb-2 border-b border-slate-100 pb-2">
        <div><h3 className={`text-xs font-bold text-${color}-600 uppercase`}>{title}</h3><p className="text-[9px] text-slate-400 mt-0.5">{subtitle}</p></div>
        <span className={`bg-${color}-50 text-${color}-700 text-[9px] font-black px-1.5 py-0.5 rounded`}>{list.length}</span>
      </div>
      <div className="space-y-1 overflow-y-auto custom-scrollbar flex-1 pr-1">
        {list.length > 0 ? list.map(p => (
          <div key={p.id} onClick={() => setEditingPlato(p)} className={`flex justify-between items-center p-2 bg-slate-50 rounded-lg cursor-pointer hover:bg-${color}-50 transition-colors`}>
            <div className="min-w-0 flex-1"><span className="text-[11px] font-semibold text-slate-700 block truncate">{p.name}</span><span className="text-[8px] text-slate-400">{p.qty} uds ({Num.round2(p.mixPct)}%)</span></div>
            <div className="text-right ml-2"><span className={`block text-[10px] font-bold text-${color}-600`}>Bº: {Num.fmt(p.margenUnitario)}</span><span className="text-[8px] text-slate-400">FC: {Num.round2(p.fcUnitario)}%</span></div>
          </div>
        )) : <div className="flex flex-col items-center justify-center h-full text-slate-300 italic"><PieChart className="w-5 h-5 mb-1 opacity-20" /><span className="text-[8px]">Vacío</span></div>}
      </div>
    </div>
  );

  // ============================================================================
  // 🎨 RENDER
  // ============================================================================
  return (
    <div className="animate-fade-in space-y-4 pb-24 relative max-w-[1600px] mx-auto text-xs">
      
      {/* Overlay de escaneo IA */}
      <AnimatePresence>
        {isScanning && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[999] bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center text-white">
            <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mb-4" />
            <h2 className="text-2xl font-bold">Procesando con Inteligencia Artificial...</h2>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🆕 Modal de fecha (reemplaza window.prompt) */}
      <AnimatePresence>
        {dateModal && (
          <DatePickerModal
            title={dateModal.title}
            defaultDate={DateUtil.today()}
            onConfirm={(date) => { dateModal.resolve(date); setDateModal(null); }}
            onCancel={()    => { dateModal.resolve(null);  setDateModal(null); }}
          />
        )}
      </AnimatePresence>

      {/* HEADER CON KPIs */}
      <header className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100">
              <ChefHat className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 tracking-tight">Análisis de Carta</h2>
              <p className="text-[9px] text-slate-500 uppercase mt-0.5">Ingeniería de Menú & Mermas</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200">
            <select value={filterMode} onChange={(e) => setFilterMode(e.target.value as FilterMode)} className="bg-white text-[9px] font-bold uppercase py-1 px-2 rounded border border-slate-200 outline-none text-slate-700 cursor-pointer">
              <option value="day">Día</option><option value="month">Mes</option><option value="year">Año</option>
            </select>
            <input type={filterMode === 'year' ? 'number' : (filterMode === 'month' ? 'month' : 'date')} value={filterValue} onChange={(e) => setFilterValue(e.target.value)} className="bg-transparent font-bold text-slate-700 text-[11px] outline-none px-2 cursor-pointer" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ventas Netas</p>
            <p className="text-sm font-black text-slate-800">{Num.fmt(data.global.totalTeoricoNeto)}</p>
          </div>
          <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">Beneficio Bruto</p>
            <p className="text-sm font-black text-emerald-600">{Num.fmt(data.global.totalBeneficioBruto)}</p>
          </div>
          <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ticket Medio</p>
            <p className="text-sm font-black text-indigo-600">{Num.fmt(data.global.ticketMedio)}</p>
          </div>
          <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">Refs/Cliente</p>
            <p className="text-sm font-black text-indigo-600">{Num.round2(data.global.nrc)}</p>
          </div>
          <div className="col-span-2 bg-slate-800 p-2 rounded-lg flex justify-between items-center text-white">
            <div>
              <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">Food Cost Real vs Teórico</p>
              <div className="flex items-end gap-1.5">
                <p className={cn("text-sm font-black", data.global.foodCostReal > data.global.foodCostTeorico + 2 ? "text-rose-400" : "text-emerald-400")}>{Num.round2(data.global.foodCostReal)}%</p>
                <p className="text-[10px] font-bold text-slate-400 mb-0.5">/ {Num.round2(data.global.foodCostTeorico)}%</p>
              </div>
            </div>
            <Scale className="w-5 h-5 text-slate-600" />
          </div>
        </div>
      </header>

      {/* TABS Y BOTONES */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-3">
        <div className="flex bg-white p-1 rounded-lg border border-slate-200 w-full md:w-auto shadow-sm">
          {[
            { id: 'financials', label: 'Dashboard' },
            { id: 'matrix',     label: 'BCG'       },
            { id: 'table',      label: 'Mix Ventas' },
            { id: 'omnes',      label: 'Omnes'      },
            { id: 'simulator',  label: 'Simulador'  },
          ].map(t => (
            <button key={t.id} onClick={() => setViewTab(t.id as ViewTab)} className={cn("px-3 py-1.5 rounded-md text-[9px] font-bold uppercase transition-colors", viewTab === t.id ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50")}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm w-full md:w-48">
            <Search className="w-3 h-3 text-slate-400 shrink-0" />
            <input type="text" placeholder="Buscar plato..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} className="text-[10px] font-semibold outline-none w-full bg-transparent" />
          </div>
          <button onClick={() => setEditingPlato({ id: 'p-' + Date.now(), name: '', price: 0, cost: 0, category: 'General', iva: 10, merma: 0 })} className="bg-slate-800 text-white p-1.5 rounded-lg shadow-sm hover:bg-slate-700 transition" title="Añadir Plato"><Plus className="w-4 h-4" /></button>
          <label className="bg-emerald-500 text-white p-1.5 rounded-lg shadow-sm hover:bg-emerald-600 transition cursor-pointer" title="Subir Excel TPV"><FileText className="w-4 h-4" /><input type="file" ref={fileInputRef} onChange={handleImportExcel} className="hidden" accept=".csv, .xlsx, .xls" /></label>
          <label className="bg-indigo-600 text-white p-1.5 rounded-lg shadow-sm hover:bg-indigo-700 transition cursor-pointer" title="Leer Ticket Z con IA"><Camera className="w-4 h-4" /><input type="file" ref={iaInputRef} onChange={handleUploadIA} className="hidden" accept=".pdf, image/*" /></label>
        </div>
      </div>

      {/* VISTAS INTERCAMBIABLES */}
      <AnimatePresence mode="wait">
        
        {/* PANEL FINANCIERO */}
        {viewTab === 'financials' && (
          <motion.div key="fin" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Receipt className="w-3 h-3 text-indigo-500"/> Análisis de Consumo</h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div><label className="text-[8px] font-bold text-slate-400 uppercase block mb-1">Inv. Inicial (€)</label><input type="number" value={invInicial || ''} onChange={e => setInvInicial(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 p-1.5 rounded text-[11px] font-bold outline-none focus:border-indigo-400" /></div>
                <div><label className="text-[8px] font-bold text-slate-400 uppercase block mb-1">Inv. Final (€)</label><input type="number" value={invFinal || ''} onChange={e => setInvFinal(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 p-1.5 rounded text-[11px] font-bold outline-none focus:border-indigo-400" /></div>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-1.5">
                <div className="flex justify-between text-[10px] font-semibold text-slate-500"><span>+ Inventario Inicial</span><span>{Num.fmt(invInicial)}</span></div>
                <div className="flex justify-between text-[10px] font-semibold text-slate-500"><span>+ Compras Albaranes</span><span>{Num.fmt(data.global.totalComprasNetas)}</span></div>
                <div className="flex justify-between text-[10px] font-semibold text-slate-500"><span>- Inventario Final</span><span className="text-rose-500">-{Num.fmt(invFinal)}</span></div>
                <div className="border-t border-slate-200 pt-1.5 flex justify-between items-center mt-1.5">
                  <span className="text-[9px] font-bold uppercase text-slate-800">Consumo Real</span>
                  <span className="text-sm font-black text-slate-900">{Num.fmt(data.global.consumoReal)}</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 p-4 rounded-xl text-white shadow-xl">
              <h3 className="text-[11px] font-bold text-amber-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><TrendingUp className="w-3 h-3"/> Punto de Equilibrio</h3>
              <div className="mb-3">
                <label className="text-[8px] font-bold text-slate-400 uppercase block mb-1">Costes Fijos Mensuales (€)</label>
                <input type="number" value={costesFijos} onChange={e => setCostesFijos(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 p-1.5 rounded text-[11px] font-black text-white outline-none focus:border-amber-500" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center border-b border-slate-800 pb-1.5">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Margen Contribución</span>
                  <span className="text-xs font-bold">{Num.round2(data.global.mcPct * 100)}%</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800 pb-1.5">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Ventas Necesarias (P.E.)</span>
                  <span className="text-xs font-bold text-emerald-400">{Num.fmt(data.global.breakEvenVentas)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Clientes Necesarios</span>
                  <span className="text-xs font-bold text-indigo-400">{Math.ceil(data.global.breakEvenClientes)} pax</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* MATRIZ BCG */}
        {viewTab === 'matrix' && (
          <motion.div key="matrix" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="space-y-4">
            {Object.entries(data.familiasData).map(([familia, fData]: any) => (
              <div key={familia} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-2 pl-1">{familia}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                  {renderQuad('⭐ Estrellas', 'Alta Vta / Alto Bº', 'emerald', fData.stars)}
                  {renderQuad('🐴 Vacas',     'Alta Vta / Bajo Bº', 'amber',   fData.horses)}
                  {renderQuad('❓ Puzzles',   'Baja Vta / Alto Bº', 'indigo',  fData.puzzles)}
                  {renderQuad('🐶 Perros',    'Baja Vta / Bajo Bº', 'rose',    fData.dogs)}
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* TABLA MIX DE VENTAS */}
        {viewTab === 'table' && (
          <motion.div key="table" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-2 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest pl-2">Rentabilidad</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold text-slate-600 uppercase">FC% Objetivo:</span>
                  <input type="number" value={targetFC} onChange={e => setTargetFC(Number(e.target.value))} className="w-12 p-0.5 text-center text-[10px] font-bold bg-white border border-slate-300 rounded outline-none" />
                </div>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[8px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="p-2">Plato</th><th className="p-2 text-center">Uds</th><th className="p-2 text-center">Mix %</th>
                      <th className="p-2 text-right">PVP Neto</th><th className="p-2 text-right">Coste MP</th>
                      <th className="p-2 text-center">FC % Real</th>
                      <th className="p-2 text-right text-indigo-600 bg-indigo-50/50">PVP Bruto Ideal</th>
                      <th className="p-2 text-right">Bº Ud.</th><th className="p-2 text-right text-emerald-600">Total Bº</th>
                    </tr>
                  </thead>
                  <tbody className="text-[10px] font-semibold text-slate-700 divide-y divide-slate-100">
                    {data.mixTable.map(p => (
                      <tr key={p.id} onClick={() => setEditingPlato(p)} className="hover:bg-indigo-50/50 cursor-pointer transition-colors">
                        <td className="p-2 text-slate-900 flex items-center gap-1">{p.name} {p.fcUnitario > targetFC && <AlertTriangle className="w-2.5 h-2.5 text-rose-500" />}</td>
                        <td className="p-2 text-center text-slate-900 font-bold">{p.qty}</td>
                        <td className="p-2 text-center text-slate-500">{Num.round2(p.mixPct)}%</td>
                        <td className="p-2 text-right">{Num.fmt(p.precioNeto)}</td>
                        <td className="p-2 text-right text-rose-500">{Num.fmt(p.costeRealEscandallo)}</td>
                        <td className="p-2 text-center"><span className={cn("px-1.5 py-0.5 rounded", p.fcUnitario > targetFC ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600")}>{Num.round2(p.fcUnitario)}%</span></td>
                        <td className="p-2 text-right text-indigo-600 bg-indigo-50/50 font-bold">{Num.fmt(p.precioIdeal)}</td>
                        <td className="p-2 text-right">{Num.fmt(p.margenUnitario)}</td>
                        <td className="p-2 text-right text-emerald-600 font-bold">{Num.fmt(p.totalBeneficioLinea)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {data.mixTable.length > 0 && (
                    <tfoot className="bg-slate-900 text-white font-bold text-[9px]">
                      <tr>
                        <td className="p-2">TOTALES</td>
                        <td className="p-2 text-center">{data.mixTable.reduce((acc, p) => acc + p.qty, 0)}</td>
                        <td className="p-2 text-center">100%</td>
                        <td className="p-2" colSpan={4} />
                        <td className="p-2 text-right text-indigo-400">{Num.fmt(data.global.totalBeneficioBruto)}</td>
                        <td className="p-2 text-right text-emerald-400">{Num.fmt(data.global.totalTeoricoNeto)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* OMNES */}
        {viewTab === 'omnes' && (
          <motion.div key="omnes" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="space-y-4">
            {Object.entries(data.familiasData).map(([familia, fData]: any) => (
              <div key={familia} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-xs font-bold text-slate-800 uppercase mb-3 flex items-center gap-1.5"><Target className="w-3 h-3 text-indigo-500"/> {familia}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">P. Medio Ofertado</p>
                    <p className="text-sm font-bold text-slate-800">{Num.fmt(fData.omnes.pMedioOfertado)}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">P. Medio Demandado</p>
                    <p className="text-sm font-bold text-indigo-600">{Num.fmt(fData.omnes.pMedioDemandado)}</p>
                  </div>
                  <div className={cn("p-3 rounded-lg border text-center", fData.omnes.ratio >= 0.9 && fData.omnes.ratio <= 1 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Ratio Omnes</p>
                    <p className={cn("text-base font-black", fData.omnes.ratio >= 0.9 && fData.omnes.ratio <= 1 ? "text-emerald-600" : "text-amber-600")}>{Num.round2(fData.omnes.ratio)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className={cn("p-3 rounded-lg border shadow-sm", fData.omnes.cumple1 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Principio 1: Dispersión</p>
                    <p className="text-[9px] font-semibold text-slate-800">Baja: {fData.omnes.grupos.bajo} | Media: {fData.omnes.grupos.medio} | Alta: {fData.omnes.grupos.alto}</p>
                  </div>
                  <div className={cn("p-3 rounded-lg border shadow-sm", fData.omnes.cumple2 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Principio 2: Amplitud Gama</p>
                    <p className="text-[9px] font-semibold text-slate-800">Amplitud actual: {Num.round2(fData.omnes.amplitud)} (Máx {fData.omnes.max} / Mín {fData.omnes.min})</p>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* SIMULADOR */}
        {viewTab === 'simulator' && (
          <motion.div key="sim" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="bg-slate-900 rounded-xl p-4 shadow-xl text-white">
            <div className="mb-3 flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-amber-400 flex items-center gap-1.5"><Calculator className="w-4 h-4" /> Simulador de Precios</h3>
              <button onClick={() => setSimulatedPlatos(JSON.parse(JSON.stringify(data.mixTable)))} className="bg-slate-800 text-slate-300 px-2 py-1 rounded text-[9px] font-bold uppercase hover:bg-slate-700 transition">Resetear</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
              <div className="bg-slate-800 p-3 rounded-lg">
                <p className="text-[8px] text-slate-400 uppercase tracking-widest mb-1">Proyección Beneficio Bruto</p>
                <p className="text-lg font-black text-emerald-400">
                  {Num.fmt(simulatedPlatos.reduce((acc, p) => acc + ((p.price / (1 + getIva(p.category))) - p.costeRealEscandallo) * p.qty, 0))}
                </p>
              </div>
              <div className="bg-slate-800 p-3 rounded-lg">
                <p className="text-[8px] text-slate-400 uppercase tracking-widest mb-1">Proyección Food Cost %</p>
                <p className="text-lg font-black text-amber-400">
                  {Num.round2(
                    (simulatedPlatos.reduce((acc, p) => acc + (p.costeRealEscandallo * p.qty), 0) / 
                    (simulatedPlatos.reduce((acc, p) => acc + ((p.price / (1 + getIva(p.category))) * p.qty), 0) || 1)) * 100
                  )}%
                </p>
              </div>
            </div>

            <div className="space-y-1 max-h-[50vh] overflow-y-auto custom-scrollbar pr-1">
              {simulatedPlatos.map((p, i) => {
                const iva    = getIva(p.category);
                const pvpNeto = p.price / (1 + iva);
                const pFC    = pvpNeto > 0 ? (p.costeRealEscandallo / pvpNeto) * 100 : 0;
                return (
                  <div key={p.id} className="flex flex-col md:flex-row items-center justify-between bg-slate-800/50 p-2 rounded-lg gap-2 border border-slate-700">
                    <div className="flex-1 min-w-0 w-full"><p className="font-semibold text-[10px] truncate text-white">{p.name}</p><p className="text-[8px] text-slate-400">Vendidos: {p.qty}</p></div>
                    <div className="flex items-center gap-2 w-full md:w-auto">
                      <div>
                        <label className="text-[7px] text-slate-500 uppercase block mb-0.5">Coste (Mermado)</label>
                        <input type="number" step="0.01" value={p.costeRealEscandallo} onChange={(e) => { const n = [...simulatedPlatos]; n[i].costeRealEscandallo = Number(e.target.value); setSimulatedPlatos(n); }} className="w-16 bg-slate-900 border border-slate-700 rounded p-1 text-rose-400 font-bold text-center text-[10px] outline-none focus:border-indigo-500" />
                      </div>
                      <div>
                        <label className="text-[7px] text-slate-500 uppercase block mb-0.5">PVP Bruto</label>
                        <input type="number" step="0.01" value={p.price} onChange={(e) => { const n = [...simulatedPlatos]; n[i].price = Number(e.target.value); setSimulatedPlatos(n); }} className="w-16 bg-slate-900 border border-slate-700 rounded p-1 text-emerald-400 font-bold text-center text-[10px] outline-none focus:border-indigo-500" />
                      </div>
                      <div className="text-right w-10">
                        <label className="text-[7px] text-slate-500 uppercase block mb-0.5">Nuevo FC</label>
                        <span className={cn("font-bold text-[9px]", pFC > targetFC ? "text-rose-500" : "text-emerald-500")}>
                          {Num.round2(pFC)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

      </AnimatePresence>

      {/* MODAL EDICIÓN / NUEVO PLATO */}
      <AnimatePresence>
        {editingPlato && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingPlato(null)} className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }} className="bg-white p-5 rounded-xl shadow-2xl w-full max-w-sm relative z-10">
              <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <ChefHat className="w-4 h-4 text-indigo-500" /> {db.platos?.some(p => p.id === editingPlato.id) ? 'Editar' : 'Nuevo'} Plato
              </h3>
              <form onSubmit={handleSavePlato} className="space-y-3">
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase ml-1 block mb-1">Nombre del Plato</label>
                  <input value={editingPlato.name} onChange={(e) => setEditingPlato({ ...editingPlato, name: e.target.value })} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold outline-none focus:border-indigo-400" required />
                </div>
                
                <div className="bg-rose-50 border border-rose-100 p-2 rounded-lg space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[8px] font-bold text-rose-500 uppercase ml-1 block mb-1">Coste Bruto (€)</label>
                      <input type="number" step="0.01" value={editingPlato.cost} onChange={(e) => setEditingPlato({ ...editingPlato, cost: Number(e.target.value) })} className="w-full p-1.5 bg-white rounded text-[11px] font-bold text-rose-600 border border-rose-200 outline-none focus:border-rose-400" required />
                    </div>
                    <div className="w-16">
                      <label className="text-[8px] font-bold text-rose-500 uppercase ml-1 block mb-1">% Merma</label>
                      <input type="number" step="1" max="99" min="0" value={editingPlato.merma || 0} onChange={(e) => setEditingPlato({ ...editingPlato, merma: Number(e.target.value) })} className="w-full p-1.5 bg-white rounded text-[11px] font-bold text-rose-600 border border-rose-200 outline-none focus:border-rose-400" />
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[9px] px-1 pt-1">
                    <span className="font-semibold text-rose-800">Coste Real Escandallo:</span>
                    <span className="font-black text-rose-600 text-xs">
                      {Num.fmt((Num.parse(editingPlato.cost) || 0) / (1 - ((Num.parse(editingPlato.merma) || 0) / 100)))}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase ml-1 block mb-1">PVP Bruto (€)</label>
                    <input type="number" step="0.01" value={editingPlato.price} onChange={(e) => setEditingPlato({ ...editingPlato, price: Number(e.target.value) })} className="w-full p-2 bg-emerald-50 border border-emerald-100 rounded-lg text-xs font-bold text-emerald-700 outline-none focus:border-emerald-400" required />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 uppercase ml-1 block mb-1">Familia</label>
                    <select value={editingPlato.category} onChange={(e) => setEditingPlato({ ...editingPlato, category: e.target.value as any })} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-semibold outline-none focus:border-indigo-400">
                      {['Entrantes', 'Principal', 'Postre', 'Bebidas', 'Alcohol', 'General'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                
                <div className="pt-2 flex gap-2">
                  {db.platos?.some(p => p.id === editingPlato.id) && (
                    <button type="button" onClick={() => handleDeletePlato(editingPlato.id)} className="p-2 text-rose-500 bg-rose-50 border border-rose-100 font-bold rounded-lg hover:bg-rose-100 transition" title="Eliminar Plato">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button type="submit" className="flex-1 bg-indigo-600 text-white py-2 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-indigo-700 transition">Guardar</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};
