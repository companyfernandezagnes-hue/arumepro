import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ChefHat, TrendingUp, PieChart, ChevronLeft, ChevronRight, 
  Zap, Plus, Clipboard, Upload, Bot, Trash2, X, Search, AlertTriangle, 
  CheckCircle2, TableProperties, Scale, Target, Calculator, LayoutGrid, Receipt,
  Camera, Loader2, FileText
} from 'lucide-react';
import { AppData, Plato } from '../types';
import { Num, DateUtil } from '../services/engine';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { GoogleGenAI } from "@google/genai";

interface MenuViewProps {
  db: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

type FilterMode = 'day' | 'month' | 'year';
type ViewTab = 'matrix' | 'table' | 'omnes' | 'financials' | 'simulator';

/* =======================================================
 * 🛡️ FUNCIONES BASE Y DE IA
 * ======================================================= */
const getIva = (cat: string) => (cat.toLowerCase().match(/bebida|alcohol|vino/)) ? 0.21 : 0.10;
const getNetPrice = (price: number, iva: number) => price > 0 ? Num.round2(price / (1 + iva)) : 0;
const norm = (s: string) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, '');

// Compresor de imágenes para OCR
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
 * 🧠 HOOK: MENU ENGINEERING PRO v10 (elBulli + Mermas)
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
    
    // 🛡️ Protección anti-crash si no hay platos
    if (!db.platos || db.platos.length === 0) return result;

    const checkDate = (dateStr: string) => {
      if (!dateStr) return false;
      if (filterMode === 'day') return dateStr === filterValue;
      if (filterMode === 'month') return dateStr.startsWith(filterValue);
      if (filterMode === 'year') return dateStr.startsWith(filterValue);
      return false;
    };

    const ventasFiltradas = (db.ventas_menu || []).filter(v => checkDate(v.date) && Num.parse(v.qty) > 0);
    const cierresFiltrados = (db.cierres || []).filter(c => checkDate(c.date) && c.unitId === 'REST');
    
    result.global.cajaRealNeta = cierresFiltrados.reduce((acc, c) => acc + (Num.parse(c.totalVenta) / 1.10), 0);
    result.global.clientes = cierresFiltrados.reduce((acc, c) => acc + (Num.parse((c as any).clientes) || 0), 0);
    result.global.totalComprasNetas = (db.albaranes || []).filter(a => checkDate(a.date) && (a.unitId === 'REST' || !a.unitId)).reduce((sum, alb) => sum + (Num.parse(alb.base) || 0), 0);
    result.global.consumoReal = invInicial + result.global.totalComprasNetas - invFinal;
    result.global.foodCostReal = result.global.cajaRealNeta > 0 ? (result.global.consumoReal / result.global.cajaRealNeta) * 100 : 0;

    const ventasPorPlato: Record<string, number> = {};
    let totalUnidadesVendidas = 0;
    ventasFiltradas.forEach(v => { const q = Num.parse(v.qty); ventasPorPlato[v.id] = (ventasPorPlato[v.id] || 0) + q; totalUnidadesVendidas += q; });

    result.global.ticketMedio = result.global.clientes > 0 ? result.global.cajaRealNeta / result.global.clientes : 0;
    result.global.nrc = result.global.clientes > 0 ? totalUnidadesVendidas / result.global.clientes : 0;
    result.global.mcPct = result.global.cajaRealNeta > 0 ? 1 - (result.global.foodCostReal / 100) : 0.70;
    result.global.breakEvenVentas = result.global.mcPct > 0 ? costesFijos / result.global.mcPct : 0;
    result.global.breakEvenClientes = result.global.ticketMedio > 0 ? result.global.breakEvenVentas / result.global.ticketMedio : 0;

    let totalQty = 0; let sumMargenPonderado = 0; const searchN = norm(searchQ);
    const tempFamilias: Record<string, any> = {};

    // 🚀 ANÁLISIS DE PLATOS CON MERMA APLICADA (elBulli Method)
    const analisis = db.platos.map(p => {
      const iva = getIva(p.category || 'General');
      const precioBruto = Num.parse(p.price);
      const precioNeto = getNetPrice(precioBruto, iva);
      
      // 🛡️ APLICACIÓN DE LA MERMA AL COSTE
      const costeBruto = Num.parse(p.cost) || 0; 
      const mermaPct = Num.parse((p as any).merma) || 0;
      const costeRealEscandallo = mermaPct < 100 ? Num.round2(costeBruto / (1 - (mermaPct / 100))) : costeBruto;
      
      const qty = ventasPorPlato[p.id] || 0;
      
      const margenUnitario = precioNeto - costeRealEscandallo;
      const fcUnitario = precioNeto > 0 ? (costeRealEscandallo / precioNeto) * 100 : 0;
      const precioIdeal = costeRealEscandallo > 0 ? Num.round2((costeRealEscandallo / (targetFC / 100)) * (1 + iva)) : precioBruto; 
      
      const totalVentasBrutoLinea = precioBruto * qty;
      const totalVentasNetoLinea = precioNeto * qty;
      const totalCosteLinea = costeRealEscandallo * qty;
      const totalBeneficioLinea = margenUnitario * qty;

      totalQty += qty;
      sumMargenPonderado += (margenUnitario * qty);
      
      result.global.totalTeoricoBruto += totalVentasBrutoLinea;
      result.global.totalTeoricoNeto += totalVentasNetoLinea;
      result.global.totalCosteIdeal += totalCosteLinea;
      result.global.totalBeneficioBruto += totalBeneficioLinea;

      const cat = p.category || 'General';
      if (!tempFamilias[cat]) tempFamilias[cat] = { qty: 0, ventasBrutas: 0, ventasNetas: 0, coste: 0, beneficio: 0 };
      tempFamilias[cat].qty += qty;
      tempFamilias[cat].ventasNetas += totalVentasNetoLinea;
      tempFamilias[cat].ventasBrutas += totalVentasBrutoLinea; // Añadido para la ley de Omnes
      tempFamilias[cat].coste += totalCosteLinea;
      tempFamilias[cat].beneficio += totalBeneficioLinea;

      return { 
        ...p, qty, precioNeto, costeRealEscandallo, margenUnitario, fcUnitario, precioIdeal,
        totalVentasLinea: totalVentasNetoLinea, totalVentasBruto: totalVentasBrutoLinea, totalCosteLinea, totalBeneficioLinea 
      };
    });

    result.global.foodCostTeorico = result.global.totalTeoricoNeto > 0 ? (result.global.totalCosteIdeal / result.global.totalTeoricoNeto) * 100 : 0;

    // MATRIZ BCG POR FAMILIAS
    const categorias = [...new Set(analisis.map(p => p.category || 'General'))];
    categorias.forEach(cat => {
      const platosFamilia = analisis.filter(p => p.category === cat);
      const activosFamilia = platosFamilia.filter(p => p.qty > 0);
      const udsFamilia = tempFamilias[cat]?.qty || 0;
      const ventasBrutasFamilia = tempFamilias[cat]?.ventasBrutas || 0;
      const margenTotalFamilia = platosFamilia.reduce((acc, p) => acc + (p.margenUnitario * p.qty), 0);

      let mediaPop = 0; let mediaMargen = 0;
      if (udsFamilia > 0 && activosFamilia.length > 0) {
        mediaPop = (1 / activosFamilia.length) * 100; 
        mediaMargen = margenTotalFamilia / udsFamilia;
      }

      // Ley de Omnes
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
        omnes.pMedioOfertado = preciosValidos.reduce((a,b)=>a+b,0) / preciosValidos.length;
        omnes.pMedioDemandado = ventasBrutasFamilia / udsFamilia; 
        omnes.ratio = omnes.pMedioOfertado > 0 ? omnes.pMedioDemandado / omnes.pMedioOfertado : 0;
      }

      const stars: any[] = []; const horses: any[] = []; const puzzles: any[] = []; const dogs: any[] = [];
      
      platosFamilia.forEach(p => {
        const mixPct = udsFamilia > 0 ? (p.qty / udsFamilia) * 100 : 0;
        const item = { ...p, mixPct, grupo: '' };
        
        const esPop = mixPct >= mediaPop;
        const esRent = p.margenUnitario >= mediaMargen;

        if (esPop && esRent) { item.grupo = 'Estrella'; stars.push(item); }
        else if (esPop && !esRent) { item.grupo = 'Vaca'; horses.push(item); }
        else if (!esPop && esRent) { item.grupo = 'Puzzle'; puzzles.push(item); }
        else { item.grupo = 'Perro'; dogs.push(item); }

        if (p.qty > 0 || (searchN && norm(p.name).includes(searchN))) result.mixTable.push(item);
      });

      result.familiasData[cat] = { stars, horses, puzzles, dogs, omnes, udsFamilia, ventasBrutasFamilia };
    });

    result.mixTable.sort((a, b) => b.totalBeneficioLinea - a.totalBeneficioLinea);
    return result;
  }, [db.platos, db.ventas_menu, db.cierres, db.albaranes, filterMode, filterValue, searchQ, targetFC, invInicial, invFinal, costesFijos]);
}

/* =======================================================
 * 🎨 COMPONENTE PRINCIPAL (VISTA)
 * ======================================================= */
export const MenuView: React.FC<MenuViewProps> = ({ db, onSave }) => {
  const [filterMode, setFilterMode] = useState<FilterMode>('month');
  const [filterValue, setFilterValue] = useState(new Date().toISOString().slice(0, 7));
  const [searchQ, setSearchQ] = useState('');
  const [viewTab, setViewTab] = useState<ViewTab>('financials');
  const [targetFC, setTargetFC] = useState(30); 
  const [invInicial, setInvInicial] = useState(0);
  const [invFinal, setInvFinal] = useState(0);
  const [costesFijos, setCostesFijos] = useState(15000);
  
  // Modales
  const [editingPlato, setEditingPlato] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iaInputRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);

  const data = useMenuIntelligencePRO(db, filterMode, filterValue, searchQ, targetFC, invInicial, invFinal, costesFijos);

  const [simulatedPlatos, setSimulatedPlatos] = useState<any[]>([]);
  useEffect(() => { if (viewTab === 'simulator') setSimulatedPlatos(JSON.parse(JSON.stringify(data.mixTable))); }, [viewTab, data.mixTable]);

  const categorizeItem = (name: string) => {
    const n = name.toLowerCase();
    if (n.match(/vino|agua|cerveza|copa|refresco|cafe|te\b/)) return 'Bebidas';
    if (n.match(/postre|tarta|helado|coulant/)) return 'Postre';
    if (n.match(/pan|ensalada|croqueta|entrante|tapa/)) return 'Entrantes';
    return 'General';
  };

  // 🚀 LECTOR DE IA / OCR PARA TICKETS DE VENTAS
  const handleUploadIA = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("⚠️ Conecta la IA en Configuración primero.");
    
    setIsScanning(true);
    try {
      let b64 = "";
      if (file.type.startsWith('image/')) b64 = await compressImage(file);
      else {
        const buffer = await file.arrayBuffer();
        b64 = btoa(new Uint8Array(buffer).reduce((d, byte) => d + String.fromCharCode(byte), ''));
      }

      const prompt = `Analiza este informe de ventas de restaurante (Ticket Z o PDF). Extrae las líneas de productos vendidos. Devuelve SOLO JSON estricto: { "ventas": [ {"n": "Nombre plato", "q": 5, "p": 12.50} ] }`;
      
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: b64.replace(/^data:image\/\w+;base64,/, ""), mimeType: file.type } }] }],
        config: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const raw = response.text || "";
      const json = raw.includes('{') ? JSON.parse(raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) : {};
      
      if (!json.ventas || !Array.isArray(json.ventas)) throw new Error("Formato inválido devuelto por IA");
      
      const dateInput = prompt(`📅 ¿A qué fecha corresponden estas ventas IA? (YYYY-MM-DD):`, DateUtil.today());
      if (!dateInput) { setIsScanning(false); return; }

      const newPlatos = [...(db.platos || [])]; const newVentas = [...(db.ventas_menu || [])];
      let count = 0;

      json.ventas.forEach((v: any) => {
        const name = String(v.n || '').trim(); const sold = Num.parse(v.q); const price = Num.parse(v.p);
        if (name && sold > 0) {
          let plato = newPlatos.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim());
          if (!plato) { 
            plato = { id: 'p-' + Date.now() + Math.random(), name, category: categorizeItem(name), price, cost: 0, iva: getIva(categorizeItem(name)) as any }; 
            newPlatos.push(plato); 
          }
          const existing = newVentas.find(vt => vt.date === dateInput && vt.id === plato!.id);
          if (existing) existing.qty += sold; else newVentas.push({ date: dateInput, id: plato.id, qty: sold });
          count++;
        }
      });

      await onSave({ ...db, platos: newPlatos, ventas_menu: newVentas });
      alert(`✅ IA completada: Se han importado ${count} líneas de venta.`);
    } catch (error) {
      console.error(error);
      alert("⚠️ La IA no pudo leer los platos correctamente. Comprueba el archivo y vuelve a intentarlo.");
    } finally {
      setIsScanning(false);
      e.target.value = '';
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(new Uint8Array(evt.target?.result as ArrayBuffer), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
        
        const dateInput = prompt(`📅 ¿Fecha de estas ventas? (YYYY-MM-DD):`, DateUtil.today());
        if (!dateInput) return;
        let colName = -1, colQty = -1, colPrice = -1;
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          const r = rows[i].map(c => String(c).toLowerCase());
          if (colName === -1) colName = r.findIndex(c => c.match(/articulo|nombre|producto|item/));
          if (colQty === -1) colQty = r.findIndex(c => c.match(/cantidad|unidades|vendidos|qty/));
          if (colPrice === -1) colPrice = r.findIndex(c => c.match(/precio|pvp|price/));
        }
        if (colName === -1 || colQty === -1) return alert("⚠️ Faltan columnas 'Artículo' o 'Cantidad'");

        const newPlatos = [...(db.platos || [])]; const newVentas = [...(db.ventas_menu || [])];
        let count = 0;
        const startRow = rows.findIndex(r => r[colName] && String(r[colName]).toLowerCase().match(/articulo|nombre/)) + 1 || 1;

        rows.slice(startRow).forEach(row => {
          const name = String(row[colName] || '').trim(); const sold = Num.parse(row[colQty]); const priceFound = colPrice > -1 ? Num.parse(row[colPrice]) : 0;
          if (name && sold > 0) {
            let plato = newPlatos.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim());
            if (!plato) { plato = { id: 'p-' + Date.now() + Math.random(), name, category: categorizeItem(name), price: priceFound, cost: 0, iva: getIva(categorizeItem(name)) as any }; newPlatos.push(plato); }
            const existing = newVentas.find(v => v.date === dateInput && v.id === plato!.id);
            if (existing) existing.qty += sold; else newVentas.push({ date: dateInput, id: plato.id, qty: sold });
            count++;
          }
        });
        await onSave({ ...db, platos: newPlatos, ventas_menu: newVentas }); alert(`✅ Importadas ${count} líneas.`);
      } catch (err) { alert("Error al leer Excel."); }
    };
    reader.readAsArrayBuffer(file); e.target.value = '';
  };

  const handleSavePlato = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editingPlato) return;
    const newPlatos = [...(db.platos || [])];
    const index = newPlatos.findIndex(p => p.id === editingPlato.id);
    if (index > -1) newPlatos[index] = editingPlato; else newPlatos.push(editingPlato);
    await onSave({ ...db, platos: newPlatos }); setEditingPlato(null);
  };

  // 🛡️ FUNCIÓN DE BORRADO AÑADIDA PARA EVITAR EL CRASH DE PANTALLA AZUL
  const handleDeletePlato = async (id: string) => {
    if (!window.confirm("¿Seguro que quieres eliminar este plato? Se perderá su historial.")) return;
    const newPlatos = (db.platos || []).filter(p => p.id !== id);
    await onSave({ ...db, platos: newPlatos });
    setEditingPlato(null);
  };

  // --- RENDERS DE COMPONENTES INTERNOS ---
  const renderQuad = (title: string, subtitle: string, color: string, list: any[]) => (
    <div className={`bg-white p-5 rounded-[2.5rem] border border-slate-100 shadow-sm h-80 flex flex-col group hover:shadow-md transition-shadow`}>
      <div className="flex justify-between items-start mb-3">
        <div><h3 className={`text-sm font-black text-${color}-600 uppercase leading-none`}>{title}</h3><p className="text-[9px] text-slate-400">{subtitle}</p></div>
        <span className={`bg-${color}-50 text-${color}-700 text-[10px] font-black px-2 py-1 rounded-lg`}>{list.length}</span>
      </div>
      <div className="space-y-1 overflow-y-auto custom-scrollbar flex-1 pr-1">
        {list.length > 0 ? list.map(p => (
          <div key={p.id} onClick={() => setEditingPlato(p)} className={`flex justify-between items-center p-2.5 bg-slate-50/50 rounded-xl cursor-pointer hover:bg-${color}-50 transition-colors`}>
            <div className="min-w-0 flex-1"><span className="text-xs font-bold text-slate-700 block truncate">{p.name}</span><span className="text-[9px] text-slate-400 font-black">{p.qty} uds ({Num.round2(p.mixPct)}%)</span></div>
            <div className="text-right ml-2"><span className={`block text-[10px] font-black text-${color}-600`}>Bº: {Num.fmt(p.margenUnitario)}</span><span className="text-[8px] text-slate-400 font-bold uppercase">FC: {Num.round2(p.fcUnitario)}%</span></div>
          </div>
        )) : <div className="flex flex-col items-center justify-center h-full text-slate-300 italic"><PieChart className="w-8 h-8 mb-2 opacity-20" /><span className="text-[9px]">Sin datos</span></div>}
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in space-y-6 pb-24 relative max-w-[1600px] mx-auto">
      
      {/* OVERLAY DE CARGA IA */}
      <AnimatePresence>
        {isScanning && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[999] bg-slate-900/90 backdrop-blur-md flex flex-col items-center justify-center text-white">
            <Loader2 className="w-16 h-16 animate-spin text-indigo-500 mb-6" />
            <h2 className="text-3xl font-black tracking-tighter">La IA está leyendo tu Ticket...</h2>
            <p className="text-slate-400 mt-2 font-bold uppercase tracking-widest">Extrayendo Platos y Cantidades</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🚀 HEADER CON KPIs */}
      <header className="bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-6 mb-6">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-slate-900 text-white rounded-3xl shadow-lg">
              <ChefHat className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-black text-slate-800 tracking-tighter">Menu Engineering</h2>
              <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-[0.2em]">Normativa elBullifoundation M2/M3</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
            <select value={filterMode} onChange={(e) => setFilterMode(e.target.value as FilterMode)} className="bg-white text-[10px] font-black uppercase py-2.5 px-3 rounded-xl border-0 outline-none shadow-sm text-slate-700 cursor-pointer">
              <option value="day">Día</option><option value="month">Mes</option><option value="year">Año</option>
            </select>
            <input type={filterMode === 'year' ? 'number' : (filterMode === 'month' ? 'month' : 'date')} value={filterValue} onChange={(e) => setFilterValue(e.target.value)} className="bg-transparent font-black text-slate-800 text-sm outline-none text-center w-32 cursor-pointer" />
          </div>
        </div>

        {/* 📊 KPIs UNIVERSALES */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 pt-6 border-t border-slate-100">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ventas Netas</p>
            <p className="text-xl font-black text-slate-800">{Num.fmt(data.global.totalTeoricoNeto)}</p>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Beneficio Bruto</p>
            <p className="text-xl font-black text-emerald-600">{Num.fmt(data.global.totalBeneficioBruto)}</p>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ticket Medio</p>
            <p className="text-xl font-black text-indigo-600">{Num.fmt(data.global.ticketMedio)}</p>
          </div>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">NRC (Refs/Client)</p>
            <p className="text-xl font-black text-indigo-600">{Num.round2(data.global.nrc)}</p>
          </div>
          <div className="md:col-span-2 bg-slate-900 p-4 rounded-2xl flex justify-between items-center text-white shadow-lg">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">FC Real vs Teórico</p>
              <div className="flex items-end gap-2">
                <p className={cn("text-xl font-black", data.global.foodCostReal > data.global.foodCostTeorico + 2 ? "text-rose-500" : "text-emerald-400")}>{Num.round2(data.global.foodCostReal)}%</p>
                <p className="text-sm font-bold text-slate-500 mb-0.5">/ {Num.round2(data.global.foodCostTeorico)}%</p>
              </div>
            </div>
            <Scale className="w-6 h-6 text-slate-600" />
          </div>
        </div>
      </header>

      {/* 🚀 TABS Y BOTONES IA/OCR */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-1">
        <div className="flex bg-slate-200 p-1.5 rounded-2xl w-full md:w-auto overflow-x-auto no-scrollbar">
          {[
            { id: 'financials', label: 'Financiero & FC', icon: TrendingUp },
            { id: 'matrix', label: 'Menu Engineering', icon: PieChart },
            { id: 'table', label: 'Mix Ventas', icon: TableProperties },
            { id: 'omnes', label: 'Omnes', icon: Target },
            { id: 'simulator', label: 'Simulador', icon: Calculator }
          ].map(t => (
            <button key={t.id} onClick={() => setViewTab(t.id as ViewTab)} className={cn("px-4 md:px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap", viewTab === t.id ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
              <t.icon className="w-3.5 h-3.5 hidden md:block" /> {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-3 py-1 shadow-sm w-full">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input type="text" placeholder="Buscar plato..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} className="p-2 text-xs font-bold outline-none w-full bg-transparent" />
          </div>
          <button onClick={() => setEditingPlato({ id: 'p-' + Date.now(), name: '', price: 0, cost: 0, category: 'General', iva: 10, merma: 0 })} className="bg-slate-900 text-white p-3 rounded-2xl shadow-sm hover:bg-indigo-600 transition" title="Añadir Plato Manual"><Plus className="w-5 h-5" /></button>
          
          <label className="bg-emerald-500 text-white p-3 rounded-2xl shadow-sm hover:bg-emerald-600 transition cursor-pointer" title="Subir Excel TPV">
            <FileSpreadsheet className="w-5 h-5" /><input type="file" ref={fileInputRef} onChange={handleImportExcel} className="hidden" accept=".csv, .xlsx, .xls" />
          </label>
          
          <label className="bg-indigo-600 text-white p-3 rounded-2xl shadow-sm hover:bg-indigo-700 transition cursor-pointer" title="Leer Ticket Z con IA">
            <Camera className="w-5 h-5" /><input type="file" ref={iaInputRef} onChange={handleUploadIA} className="hidden" accept=".pdf, image/*" />
          </label>
        </div>
      </div>

      {/* 🚀 VISTAS INTERCAMBIABLES */}
      <AnimatePresence mode="wait">
        
        {/* PANEL FINANCIERO */}
        {viewTab === 'financials' && (
          <motion.div key="fin" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2"><Receipt className="w-5 h-5 text-indigo-500"/> Análisis de Consumo Real</h3>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Inventario Inicial (€)</label>
                    <input type="number" value={invInicial || ''} onChange={e => setInvInicial(Number(e.target.value))} placeholder="0" className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-bold outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Inventario Final (€)</label>
                    <input type="number" value={invFinal || ''} onChange={e => setInvFinal(Number(e.target.value))} placeholder="0" className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-bold outline-none focus:border-indigo-500" />
                  </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2">
                  <div className="flex justify-between text-xs font-bold text-slate-500"><span>+ Inventario Inicial</span><span>{Num.fmt(invInicial)}</span></div>
                  <div className="flex justify-between text-xs font-bold text-slate-500"><span>+ Compras Netas (Albaranes)</span><span>{Num.fmt(data.global.totalComprasNetas)}</span></div>
                  <div className="flex justify-between text-xs font-bold text-slate-500"><span>- Inventario Final</span><span className="text-rose-500">-{Num.fmt(invFinal)}</span></div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between items-center mt-2">
                    <span className="text-[10px] font-black uppercase text-indigo-600">Consumo Real</span>
                    <span className="text-lg font-black text-slate-900">{Num.fmt(data.global.consumoReal)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl">
                <h3 className="text-sm font-black text-amber-400 uppercase tracking-widest mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5"/> Punto de Equilibrio</h3>
                <div className="mb-6">
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Costes Fijos Mensuales Estimados (€)</label>
                  <input type="number" value={costesFijos} onChange={e => setCostesFijos(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl font-black text-white outline-none focus:border-amber-500" />
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <span className="text-xs text-slate-400 font-bold uppercase">Margen Contribución %</span>
                    <span className="text-xl font-black">{Num.round2(data.global.mcPct * 100)}%</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <span className="text-xs text-slate-400 font-bold uppercase">Ventas Necesarias (P.E.)</span>
                    <span className="text-xl font-black text-emerald-400">{Num.fmt(data.global.breakEvenVentas)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400 font-bold uppercase">Clientes Necesarios</span>
                    <span className="text-xl font-black text-indigo-400">{Math.ceil(data.global.breakEvenClientes)} pers.</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* MATRIZ BCG POR FAMILIAS */}
        {viewTab === 'matrix' && (
          <motion.div key="matrix" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-8">
            {Object.entries(data.familiasData).map(([familia, fData]: any) => (
              <div key={familia} className="bg-slate-50 p-6 rounded-[3rem] border border-slate-200">
                <h3 className="text-lg font-black text-slate-800 uppercase tracking-tighter mb-4 pl-2">{familia}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {renderQuad('⭐ Estrellas', 'Alta Venta / Alto Bº', 'emerald', fData.stars)}
                  {renderQuad('🐴 Vacas', 'Alta Venta / Bajo Bº', 'amber', fData.horses)}
                  {renderQuad('❓ Puzzles', 'Baja Venta / Alto Bº', 'indigo', fData.puzzles)}
                  {renderQuad('🐶 Perros', 'Baja Venta / Bajo Bº', 'rose', fData.dogs)}
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* TABLA MIX DE VENTAS */}
        {viewTab === 'table' && (
          <motion.div key="table" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Ajuste de Rentabilidad</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">FC% Objetivo:</span>
                  <input type="number" value={targetFC} onChange={e => setTargetFC(Number(e.target.value))} className="w-16 p-1 text-center font-black bg-white border border-slate-200 rounded-md outline-none" />
                </div>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="bg-white border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      <th className="p-4">Plato</th><th className="p-4 text-center">Uds</th><th className="p-4 text-center">Mix %</th>
                      <th className="p-4 text-right">PVP Neto</th><th className="p-4 text-right">Coste MP (Real)</th>
                      <th className="p-4 text-center">FC % Real</th>
                      <th className="p-4 text-right text-indigo-600 bg-indigo-50/30">PVP Bruto Ideal</th>
                      <th className="p-4 text-right">Bº Ud.</th><th className="p-4 text-right text-emerald-600">Total Bº Bruto</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-bold text-slate-700 divide-y divide-slate-50">
                    {data.mixTable.map(p => (
                      <tr key={p.id} onClick={() => setEditingPlato(p)} className="hover:bg-slate-50 cursor-pointer transition-colors group">
                        <td className="p-4 text-slate-900 group-hover:text-indigo-600 transition-colors flex items-center gap-2">{p.name} {p.fcUnitario > targetFC && <AlertTriangle className="w-3 h-3 text-rose-500" />}</td>
                        <td className="p-4 text-center text-slate-900 font-black">{p.qty}</td>
                        <td className="p-4 text-center text-slate-400">{Num.round2(p.mixPct)}%</td>
                        <td className="p-4 text-right">{Num.fmt(p.precioNeto)}</td>
                        <td className="p-4 text-right text-rose-500">{Num.fmt(p.costeRealEscandallo)}</td>
                        <td className="p-4 text-center"><span className={cn("px-2 py-1 rounded-md", p.fcUnitario > targetFC ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600")}>{Num.round2(p.fcUnitario)}%</span></td>
                        <td className="p-4 text-right text-indigo-600 bg-indigo-50/30 font-black">{Num.fmt(p.precioIdeal)}</td>
                        <td className="p-4 text-right">{Num.fmt(p.margenUnitario)}</td>
                        <td className="p-4 text-right text-emerald-600 font-black">{Num.fmt(p.totalBeneficioLinea)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {data.mixTable.length > 0 && (
                    <tfoot className="bg-slate-900 text-white font-black text-sm">
                      <tr>
                        <td className="p-4">TOTALES DEL PERIODO</td>
                        <td className="p-4 text-center">{data.mixTable.reduce((acc, p) => acc + p.qty, 0)}</td>
                        <td className="p-4 text-center">100%</td>
                        <td className="p-4" colSpan={4}></td>
                        <td className="p-4 text-right text-indigo-400">{Num.fmt(data.global.totalBeneficioBruto)}</td>
                        <td className="p-4 text-right text-emerald-400">{Num.fmt(data.global.totalTeoricoNeto)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* OMNES POR FAMILIAS */}
        {viewTab === 'omnes' && (
          <motion.div key="omnes" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
             {Object.entries(data.familiasData).map(([familia, fData]: any) => (
               <div key={familia} className="bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100">
                  <h3 className="text-xl font-black text-slate-800 uppercase mb-6 flex items-center gap-2"><Target className="w-5 h-5 text-indigo-500"/> {familia}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 text-center">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">P. Medio Ofertado</p>
                      <p className="text-3xl font-black text-slate-800">{Num.fmt(fData.omnes.pMedioOfertado)}</p>
                    </div>
                    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 text-center">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">P. Medio Demandado</p>
                      <p className="text-3xl font-black text-indigo-600">{Num.fmt(fData.omnes.pMedioDemandado)}</p>
                    </div>
                    <div className={cn("p-6 rounded-[2rem] border text-center", fData.omnes.ratio >= 0.9 && fData.omnes.ratio <= 1 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Ratio Omnes</p>
                      <p className={cn("text-4xl font-black", fData.omnes.ratio >= 0.9 && fData.omnes.ratio <= 1 ? "text-emerald-600" : "text-amber-600")}>{Num.round2(fData.omnes.ratio)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className={cn("p-6 rounded-3xl border shadow-sm", fData.omnes.cumple1 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Principio 1: Dispersión</p>
                      <p className="text-xs font-bold text-slate-800 mt-2">Baja: {fData.omnes.grupos.bajo} | Media: {fData.omnes.grupos.medio} | Alta: {fData.omnes.grupos.alto}</p>
                    </div>
                    <div className={cn("p-6 rounded-3xl border shadow-sm", fData.omnes.cumple2 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Principio 2: Amplitud Gama</p>
                      <p className="text-xs font-bold text-slate-800 mt-2">Amplitud actual: {Num.round2(fData.omnes.amplitud)} (Máximo {fData.omnes.max} / Mínimo {fData.omnes.min})</p>
                    </div>
                  </div>
               </div>
             ))}
          </motion.div>
        )}

        {/* SIMULADOR */}
        {viewTab === 'simulator' && (
          <motion.div key="sim" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="bg-slate-900 rounded-[3rem] p-6 md:p-8 shadow-2xl text-white">
            <div className="mb-6 flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-black text-amber-400 flex items-center gap-2"><Calculator className="w-6 h-6" /> Simulador de Carta</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Cambia precios aquí sin afectar a tu base de datos para ver proyecciones.</p>
              </div>
              <button onClick={() => setSimulatedPlatos(JSON.parse(JSON.stringify(data.mixTable)))} className="bg-slate-800 text-slate-300 px-4 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-slate-700 transition">Resetear</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-800 p-5 rounded-[2rem]">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Proyección Beneficio Bruto</p>
                <p className="text-3xl font-black text-emerald-400">
                  {Num.fmt(simulatedPlatos.reduce((acc, p) => acc + ((p.price / (1 + getIva(p.category))) - p.costeRealEscandallo) * p.qty, 0))}
                </p>
              </div>
              <div className="bg-slate-800 p-5 rounded-[2rem]">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Proyección Food Cost %</p>
                <p className="text-3xl font-black text-amber-400">
                  {Num.round2(
                    (simulatedPlatos.reduce((acc, p) => acc + (p.costeRealEscandallo * p.qty), 0) / 
                    (simulatedPlatos.reduce((acc, p) => acc + ((p.price / (1 + getIva(p.category))) * p.qty), 0) || 1)) * 100
                  )}%
                </p>
              </div>
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
              {simulatedPlatos.map((p, i) => {
                const iva = getIva(p.category);
                const pvpNeto = p.price / (1 + iva);
                const pFC = pvpNeto > 0 ? (p.costeRealEscandallo / pvpNeto) * 100 : 0;
                
                return (
                  <div key={p.id} className="flex flex-col md:flex-row items-center justify-between bg-slate-800/50 p-4 rounded-2xl gap-4 border border-slate-700/50">
                    <div className="flex-1 min-w-0 w-full"><p className="font-bold text-sm truncate text-white">{p.name}</p><p className="text-[10px] text-slate-400">Vendidos: {p.qty}</p></div>
                    <div className="flex items-center gap-4 w-full md:w-auto">
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase block mb-1">Coste Real (Mermado)</label>
                        <input type="number" step="0.01" value={p.costeRealEscandallo} onChange={(e) => { const n = [...simulatedPlatos]; n[i].costeRealEscandallo = Number(e.target.value); setSimulatedPlatos(n); }} className="w-20 bg-slate-900 border border-slate-700 rounded-lg p-2 text-rose-400 font-bold text-center outline-none focus:border-indigo-500" />
                      </div>
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase block mb-1">PVP Bruto</label>
                        <input type="number" step="0.01" value={p.price} onChange={(e) => { const n = [...simulatedPlatos]; n[i].price = Number(e.target.value); setSimulatedPlatos(n); }} className="w-24 bg-slate-900 border border-slate-700 rounded-lg p-2 text-emerald-400 font-bold text-center outline-none focus:border-indigo-500" />
                      </div>
                      <div className="text-right min-w-[60px]">
                        <label className="text-[8px] text-slate-500 uppercase block mb-1">Nuevo FC%</label>
                        <span className={cn("font-black text-sm", pFC > targetFC ? "text-rose-500" : "text-emerald-500")}>
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

      {/* MODAL EDICIÓN PLATO (+ MERMAS) PROTEGIDO */}
      <AnimatePresence>
        {editingPlato && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingPlato(null)} className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-md relative z-10">
              <h3 className="font-black text-slate-800 text-xl mb-6 flex items-center gap-2">
                <ChefHat className="w-6 h-6 text-indigo-500" /> {db.platos?.some(p => p.id === editingPlato.id) ? 'Editar' : 'Nuevo'} Plato
              </h3>
              <form onSubmit={handleSavePlato} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Nombre</label>
                  <input value={editingPlato.name} onChange={(e) => setEditingPlato({ ...editingPlato, name: e.target.value })} className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-bold border-0 outline-none focus:ring-2 ring-indigo-500/20" required />
                </div>
                
                <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] font-black text-rose-400 uppercase ml-2 block mb-1">Coste M.P. Bruto (€)</label>
                      <input type="number" step="0.01" value={editingPlato.cost} onChange={(e) => setEditingPlato({ ...editingPlato, cost: Number(e.target.value) })} className="w-full p-3 bg-white rounded-xl text-sm font-black text-rose-600 border-0 outline-none focus:ring-2 ring-rose-500/30" required />
                    </div>
                    <div className="w-24">
                      <label className="text-[10px] font-black text-rose-400 uppercase ml-2 block mb-1">% Merma</label>
                      <input type="number" step="1" max="99" min="0" value={editingPlato.merma || 0} onChange={(e) => setEditingPlato({ ...editingPlato, merma: Number(e.target.value) })} className="w-full p-3 bg-white rounded-xl text-sm font-black text-rose-600 border-0 outline-none focus:ring-2 ring-rose-500/30" />
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-xs px-2 border-t border-rose-200/50 pt-2">
                    <span className="font-bold text-rose-800">Coste Real Escandallo:</span>
                    <span className="font-black text-rose-600 text-sm">
                      {Num.fmt((Num.parse(editingPlato.cost) || 0) / (1 - ((Num.parse(editingPlato.merma) || 0) / 100)))}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">PVP Bruto (€)</label>
                    <input type="number" step="0.01" value={editingPlato.price} onChange={(e) => setEditingPlato({ ...editingPlato, price: Number(e.target.value) })} className="w-full p-4 bg-emerald-50 rounded-2xl text-sm font-black text-emerald-700 border-0 outline-none focus:ring-2 ring-emerald-500/30" required />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Familia</label>
                    <select value={editingPlato.category} onChange={(e) => setEditingPlato({ ...editingPlato, category: e.target.value as any })} className="w-full p-4 bg-slate-50 rounded-2xl text-xs font-bold border-0 outline-none">
                      {['Entrantes', 'Principal', 'Postre', 'Bebidas', 'Alcohol', 'General'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                
                <div className="pt-4 space-y-2">
                  <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-indigo-600 transition active:scale-95">GUARDAR PLATO</button>
                  {/* 🛡️ BOTÓN DE BORRAR REPARADO */}
                  {db.platos?.some(p => p.id === editingPlato.id) && (
                    <button type="button" onClick={() => handleDeletePlato(editingPlato.id)} className="w-full text-rose-500 font-bold text-xs py-2 hover:bg-rose-50 rounded-xl transition">
                      Eliminar Plato
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
