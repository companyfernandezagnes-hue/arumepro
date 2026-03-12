import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ChefHat, TrendingUp, PieChart, ChevronLeft, ChevronRight, 
  Zap, Plus, Search, AlertTriangle, CheckCircle2, TableProperties, 
  Scale, Target, Calculator, Receipt, Camera, Loader2, FileText, X
} from 'lucide-react';
import { AppData, Plato } from '../types';
import { Num, DateUtil } from '../services/engine';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { GoogleGenAI } from "@google/genai";
import { useColumnDetector } from '../hooks/useColumnDetector';

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
    
    if (!db.platos || db.platos.length === 0) return result;

    const checkDate = (dateStr?: string) => {
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

    const analisis = db.platos.map(p => {
      const iva = getIva(p.category || 'General');
      const precioBruto = Num.parse(p.price);
      const precioNeto = getNetPrice(precioBruto, iva);
      
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
      tempFamilias[cat].ventasBrutas += totalVentasBrutoLinea; 
      tempFamilias[cat].coste += totalCosteLinea;
      tempFamilias[cat].beneficio += totalBeneficioLinea;

      return { 
        ...p, qty, precioNeto, costeRealEscandallo, margenUnitario, fcUnitario, precioIdeal,
        totalVentasLinea: totalVentasNetoLinea, totalVentasBruto: totalVentasBrutoLinea, totalCosteLinea, totalBeneficioLinea 
      };
    });

    result.global.foodCostTeorico = result.global.totalTeoricoNeto > 0 ? (result.global.totalCosteIdeal / result.global.totalTeoricoNeto) * 100 : 0;

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
 * 🎨 COMPONENTE PRINCIPAL (VISTA DENSIDAD ALTA)
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
  
  const [editingPlato, setEditingPlato] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iaInputRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  
  const { analyzeColumns, saveProfile } = useColumnDetector();

  const data = useMenuIntelligencePRO(db, filterMode, filterValue, searchQ, targetFC, invInicial, invFinal, costesFijos);

  const [simulatedPlatos, setSimulatedPlatos] = useState<any[]>([]);
  useEffect(() => { if (viewTab === 'simulator') setSimulatedPlatos(JSON.parse(JSON.stringify(data.mixTable))); }, [viewTab, data.mixTable]);

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
          let plato = newPlatos.find(p => String(p.name || '').toLowerCase().trim() === name.toLowerCase().trim());
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
        
        const analysis = analyzeColumns(rows);
        const colName = analysis.mapping.name;
        const colQty = analysis.mapping.qty;
        const colPrice = analysis.mapping.price;
        
        if (colName === -1 || colQty === -1) return alert("⚠️ No se han detectado columnas válidas de 'Artículo' o 'Cantidad'.");

        const newPlatos = [...(db.platos || [])]; const newVentas = [...(db.ventas_menu || [])];
        let count = 0;
        
        // Asumimos que la primera fila es cabecera, iteramos desde la 1
        rows.slice(1).forEach(row => {
          const name = String(row[colName] || '').trim(); 
          const sold = Num.parse(row[colQty]); 
          const priceFound = colPrice > -1 ? Num.parse(row[colPrice]) : 0;
          
          if (name && sold > 0) {
            let plato = newPlatos.find(p => String(p.name || '').toLowerCase().trim() === name.toLowerCase().trim());
            if (!plato) { 
              plato = { id: 'p-' + Date.now() + Math.random(), name, category: categorizeItem(name), price: priceFound, cost: 0, iva: getIva(categorizeItem(name)) as any }; 
              newPlatos.push(plato); 
            }
            const existing = newVentas.find(v => v.date === dateInput && v.id === plato!.id);
            if (existing) existing.qty += sold; else newVentas.push({ date: dateInput, id: plato.id, qty: sold });
            count++;
          }
        });
        
        saveProfile(rows, analysis.mapping);
        await onSave({ ...db, platos: newPlatos, ventas_menu: newVentas }); 
        alert(`✅ Importadas ${count} líneas.`);
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

  const handleDeletePlato = async (id: string) => {
    if (!window.confirm("¿Seguro que quieres eliminar este plato? Se perderá su historial.")) return;
    const newPlatos = (db.platos || []).filter(p => p.id !== id);
    await onSave({ ...db, platos: newPlatos });
    setEditingPlato(null);
  };

  // --- RENDER DE CUADRANTES BCG COMPACTADO ---
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

  return (
    <div className="animate-fade-in space-y-4 pb-24 relative max-w-[1600px] mx-auto">
      
      <AnimatePresence>
        {isScanning && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[999] bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center text-white">
            <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mb-4" />
            <h2 className="text-2xl font-bold">Procesando con Inteligencia Artificial...</h2>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🚀 HEADER CON KPIs (DISEÑO COMPACTO Y LIMPIO) */}
      <header className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
              <ChefHat className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800 tracking-tight">Análisis de Carta</h2>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Ingeniería de Menú & Mermas</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
            <select value={filterMode} onChange={(e) => setFilterMode(e.target.value as FilterMode)} className="bg-white text-[10px] font-bold uppercase py-1.5 px-2 rounded-lg border border-slate-200 outline-none text-slate-700 cursor-pointer">
              <option value="day">Día</option><option value="month">Mes</option><option value="year">Año</option>
            </select>
            <input type={filterMode === 'year' ? 'number' : (filterMode === 'month' ? 'month' : 'date')} value={filterValue} onChange={(e) => setFilterValue(e.target.value)} className="bg-transparent font-bold text-slate-700 text-xs outline-none px-2 cursor-pointer" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ventas Netas</p>
            <p className="text-lg font-black text-slate-800">{Num.fmt(data.global.totalTeoricoNeto)}</p>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Beneficio Bruto</p>
            <p className="text-lg font-black text-emerald-600">{Num.fmt(data.global.totalBeneficioBruto)}</p>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ticket Medio</p>
            <p className="text-lg font-black text-indigo-600">{Num.fmt(data.global.ticketMedio)}</p>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Refs/Cliente</p>
            <p className="text-lg font-black text-indigo-600">{Num.round2(data.global.nrc)}</p>
          </div>
          <div className="col-span-2 bg-slate-800 p-3 rounded-xl flex justify-between items-center text-white">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Food Cost Real vs Teórico</p>
              <div className="flex items-end gap-1.5">
                <p className={cn("text-lg font-black", data.global.foodCostReal > data.global.foodCostTeorico + 2 ? "text-rose-400" : "text-emerald-400")}>{Num.round2(data.global.foodCostReal)}%</p>
                <p className="text-xs font-bold text-slate-400 mb-0.5">/ {Num.round2(data.global.foodCostTeorico)}%</p>
              </div>
            </div>
            <Scale className="w-6 h-6 text-slate-600" />
          </div>
        </div>
      </header>

      {/* 🚀 TABS Y BOTONES IA/OCR (ESTILO INTERRUPTOR) */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-3">
        <div className="flex bg-white p-1 rounded-xl border border-slate-200 w-full md:w-auto shadow-sm">
          {[
            { id: 'financials', label: 'Dashboard' },
            { id: 'matrix', label: 'BCG' },
            { id: 'table', label: 'Mix Ventas' },
            { id: 'omnes', label: 'Omnes' },
            { id: 'simulator', label: 'Simulador' }
          ].map(t => (
            <button key={t.id} onClick={() => setViewTab(t.id as ViewTab)} className={cn("px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-colors", viewTab === t.id ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-50")}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm w-full md:w-48">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input type="text" placeholder="Buscar plato..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} className="text-[11px] font-semibold outline-none w-full bg-transparent" />
          </div>
          
          <button onClick={() => setEditingPlato({ id: 'p-' + Date.now(), name: '', price: 0, cost: 0, category: 'General', iva: 10, merma: 0 })} className="bg-slate-800 text-white p-2 rounded-xl shadow-sm hover:bg-slate-700 transition" title="Añadir Plato"><Plus className="w-4 h-4" /></button>
          <label className="bg-emerald-500 text-white p-2 rounded-xl shadow-sm hover:bg-emerald-600 transition cursor-pointer" title="Subir Excel TPV"><FileText className="w-4 h-4" /><input type="file" ref={fileInputRef} onChange={handleImportExcel} className="hidden" accept=".csv, .xlsx, .xls" /></label>
          <label className="bg-indigo-600 text-white p-2 rounded-xl shadow-sm hover:bg-indigo-700 transition cursor-pointer" title="Leer Ticket Z con IA"><Camera className="w-4 h-4" /><input type="file" ref={iaInputRef} onChange={handleUploadIA} className="hidden" accept=".pdf, image/*" /></label>
        </div>
      </div>

      {/* 🚀 VISTAS INTERCAMBIABLES (MÁS DENSAS) */}
      <AnimatePresence mode="wait">
        
        {/* PANEL FINANCIERO */}
        {viewTab === 'financials' && (
          <motion.div key="fin" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-4 flex items-center gap-1.5"><Receipt className="w-4 h-4 text-indigo-500"/> Análisis de Consumo</h3>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Inv. Inicial (€)</label><input type="number" value={invInicial || ''} onChange={e => setInvInicial(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 p-2 rounded-lg text-sm font-bold outline-none focus:border-indigo-400" /></div>
                <div><label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Inv. Final (€)</label><input type="number" value={invFinal || ''} onChange={e => setInvFinal(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 p-2 rounded-lg text-sm font-bold outline-none focus:border-indigo-400" /></div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
                <div className="flex justify-between text-[11px] font-semibold text-slate-500"><span>+ Inventario Inicial</span><span>{Num.fmt(invInicial)}</span></div>
                <div className="flex justify-between text-[11px] font-semibold text-slate-500"><span>+ Compras Albaranes</span><span>{Num.fmt(data.global.totalComprasNetas)}</span></div>
                <div className="flex justify-between text-[11px] font-semibold text-slate-500"><span>- Inventario Final</span><span className="text-rose-500">-{Num.fmt(invFinal)}</span></div>
                <div className="border-t border-slate-200 pt-2 flex justify-between items-center mt-2">
                  <span className="text-[10px] font-bold uppercase text-slate-800">Consumo Real</span>
                  <span className="text-base font-black text-slate-900">{Num.fmt(data.global.consumoReal)}</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 p-5 rounded-[2rem] text-white shadow-xl">
              <h3 className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-4 flex items-center gap-1.5"><TrendingUp className="w-4 h-4"/> Punto de Equilibrio</h3>
              <div className="mb-4">
                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Costes Fijos Mensuales (€)</label>
                <input type="number" value={costesFijos} onChange={e => setCostesFijos(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 p-2.5 rounded-xl text-sm font-black text-white outline-none focus:border-amber-500" />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-[11px] text-slate-400 font-semibold uppercase">Margen Contribución</span>
                  <span className="text-base font-bold">{Num.round2(data.global.mcPct * 100)}%</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-[11px] text-slate-400 font-semibold uppercase">Ventas Necesarias (P.E.)</span>
                  <span className="text-base font-bold text-emerald-400">{Num.fmt(data.global.breakEvenVentas)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-slate-400 font-semibold uppercase">Clientes Necesarios</span>
                  <span className="text-base font-bold text-indigo-400">{Math.ceil(data.global.breakEvenClientes)} pax</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* MATRIZ BCG COMPACTA */}
        {viewTab === 'matrix' && (
          <motion.div key="matrix" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {Object.entries(data.familiasData).map(([familia, fData]: any) => (
              <div key={familia} className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3 pl-1">{familia}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {renderQuad('⭐ Estrellas', 'Alta Vta / Alto Bº', 'emerald', fData.stars)}
                  {renderQuad('🐴 Vacas', 'Alta Vta / Bajo Bº', 'amber', fData.horses)}
                  {renderQuad('❓ Puzzles', 'Baja Vta / Alto Bº', 'indigo', fData.puzzles)}
                  {renderQuad('🐶 Perros', 'Baja Vta / Bajo Bº', 'rose', fData.dogs)}
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* TABLA MIX DE VENTAS */}
        {viewTab === 'table' && (
          <motion.div key="table" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-2">Rentabilidad</p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-600 uppercase">FC% Objetivo:</span>
                  <input type="number" value={targetFC} onChange={e => setTargetFC(Number(e.target.value))} className="w-14 p-1 text-center text-xs font-bold bg-white border border-slate-300 rounded outline-none" />
                </div>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="p-3">Plato</th><th className="p-3 text-center">Uds</th><th className="p-3 text-center">Mix %</th>
                      <th className="p-3 text-right">PVP Neto</th><th className="p-3 text-right">Coste MP</th>
                      <th className="p-3 text-center">FC % Real</th>
                      <th className="p-3 text-right text-indigo-600 bg-indigo-50/50">PVP Bruto Ideal</th>
                      <th className="p-3 text-right">Bº Ud.</th><th className="p-3 text-right text-emerald-600">Total Bº</th>
                    </tr>
                  </thead>
                  <tbody className="text-[11px] font-semibold text-slate-700 divide-y divide-slate-100">
                    {data.mixTable.map(p => (
                      <tr key={p.id} onClick={() => setEditingPlato(p)} className="hover:bg-indigo-50/50 cursor-pointer transition-colors">
                        <td className="p-3 text-slate-900 flex items-center gap-1.5">{p.name} {p.fcUnitario > targetFC && <AlertTriangle className="w-3 h-3 text-rose-500" />}</td>
                        <td className="p-3 text-center text-slate-900 font-bold">{p.qty}</td>
                        <td className="p-3 text-center text-slate-500">{Num.round2(p.mixPct)}%</td>
                        <td className="p-3 text-right">{Num.fmt(p.precioNeto)}</td>
                        <td className="p-3 text-right text-rose-500">{Num.fmt(p.costeRealEscandallo)}</td>
                        <td className="p-3 text-center"><span className={cn("px-1.5 py-0.5 rounded", p.fcUnitario > targetFC ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600")}>{Num.round2(p.fcUnitario)}%</span></td>
                        <td className="p-3 text-right text-indigo-600 bg-indigo-50/50 font-bold">{Num.fmt(p.precioIdeal)}</td>
                        <td className="p-3 text-right">{Num.fmt(p.margenUnitario)}</td>
                        <td className="p-3 text-right text-emerald-600 font-bold">{Num.fmt(p.totalBeneficioLinea)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {data.mixTable.length > 0 && (
                    <tfoot className="bg-slate-900 text-white font-bold text-xs">
                      <tr>
                        <td className="p-3">TOTALES</td>
                        <td className="p-3 text-center">{data.mixTable.reduce((acc, p) => acc + p.qty, 0)}</td>
                        <td className="p-3 text-center">100%</td>
                        <td className="p-3" colSpan={4}></td>
                        <td className="p-3 text-right text-indigo-400">{Num.fmt(data.global.totalBeneficioBruto)}</td>
                        <td className="p-3 text-right text-emerald-400">{Num.fmt(data.global.totalTeoricoNeto)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* OMNES COMPACTO */}
        {viewTab === 'omnes' && (
          <motion.div key="omnes" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
             {Object.entries(data.familiasData).map(([familia, fData]: any) => (
               <div key={familia} className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2"><Target className="w-4 h-4 text-indigo-500"/> {familia}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">P. Medio Ofertado</p>
                      <p className="text-xl font-bold text-slate-800">{Num.fmt(fData.omnes.pMedioOfertado)}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">P. Medio Demandado</p>
                      <p className="text-xl font-bold text-indigo-600">{Num.fmt(fData.omnes.pMedioDemandado)}</p>
                    </div>
                    <div className={cn("p-4 rounded-2xl border text-center", fData.omnes.ratio >= 0.9 && fData.omnes.ratio <= 1 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Ratio Omnes</p>
                      <p className={cn("text-2xl font-black", fData.omnes.ratio >= 0.9 && fData.omnes.ratio <= 1 ? "text-emerald-600" : "text-amber-600")}>{Num.round2(fData.omnes.ratio)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className={cn("p-4 rounded-2xl border shadow-sm", fData.omnes.cumple1 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Principio 1: Dispersión</p>
                      <p className="text-[11px] font-semibold text-slate-800">Baja: {fData.omnes.grupos.bajo} | Media: {fData.omnes.grupos.medio} | Alta: {fData.omnes.grupos.alto}</p>
                    </div>
                    <div className={cn("p-4 rounded-2xl border shadow-sm", fData.omnes.cumple2 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Principio 2: Amplitud Gama</p>
                      <p className="text-[11px] font-semibold text-slate-800">Amplitud actual: {Num.round2(fData.omnes.amplitud)} (Máx {fData.omnes.max} / Mín {fData.omnes.min})</p>
                    </div>
                  </div>
               </div>
             ))}
          </motion.div>
        )}

        {/* SIMULADOR COMPACTO */}
        {viewTab === 'simulator' && (
          <motion.div key="sim" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="bg-slate-900 rounded-[2.5rem] p-6 shadow-xl text-white">
            <div className="mb-4 flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-amber-400 flex items-center gap-2"><Calculator className="w-5 h-5" /> Simulador de Precios</h3>
              </div>
              <button onClick={() => setSimulatedPlatos(JSON.parse(JSON.stringify(data.mixTable)))} className="bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-700 transition">Resetear</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              <div className="bg-slate-800 p-4 rounded-2xl">
                <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Proyección Beneficio Bruto</p>
                <p className="text-2xl font-black text-emerald-400">
                  {Num.fmt(simulatedPlatos.reduce((acc, p) => acc + ((p.price / (1 + getIva(p.category))) - p.costeRealEscandallo) * p.qty, 0))}
                </p>
              </div>
              <div className="bg-slate-800 p-4 rounded-2xl">
                <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Proyección Food Cost %</p>
                <p className="text-2xl font-black text-amber-400">
                  {Num.round2(
                    (simulatedPlatos.reduce((acc, p) => acc + (p.costeRealEscandallo * p.qty), 0) / 
                    (simulatedPlatos.reduce((acc, p) => acc + ((p.price / (1 + getIva(p.category))) * p.qty), 0) || 1)) * 100
                  )}%
                </p>
              </div>
            </div>

            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
              {simulatedPlatos.map((p, i) => {
                const iva = getIva(p.category);
                const pvpNeto = p.price / (1 + iva);
                const pFC = pvpNeto > 0 ? (p.costeRealEscandallo / pvpNeto) * 100 : 0;
                
                return (
                  <div key={p.id} className="flex flex-col md:flex-row items-center justify-between bg-slate-800/50 p-3 rounded-xl gap-3 border border-slate-700">
                    <div className="flex-1 min-w-0 w-full"><p className="font-semibold text-xs truncate text-white">{p.name}</p><p className="text-[9px] text-slate-400">Vendidos: {p.qty}</p></div>
                    <div className="flex items-center gap-3 w-full md:w-auto">
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase block mb-0.5">Coste (Mermado)</label>
                        <input type="number" step="0.01" value={p.costeRealEscandallo} onChange={(e) => { const n = [...simulatedPlatos]; n[i].costeRealEscandallo = Number(e.target.value); setSimulatedPlatos(n); }} className="w-20 bg-slate-900 border border-slate-700 rounded-lg p-1.5 text-rose-400 font-bold text-center text-sm outline-none focus:border-indigo-500" />
                      </div>
                      <div>
                        <label className="text-[8px] text-slate-500 uppercase block mb-0.5">PVP Bruto</label>
                        <input type="number" step="0.01" value={p.price} onChange={(e) => { const n = [...simulatedPlatos]; n[i].price = Number(e.target.value); setSimulatedPlatos(n); }} className="w-20 bg-slate-900 border border-slate-700 rounded-lg p-1.5 text-emerald-400 font-bold text-center text-sm outline-none focus:border-indigo-500" />
                      </div>
                      <div className="text-right w-12">
                        <label className="text-[8px] text-slate-500 uppercase block mb-0.5">Nuevo FC</label>
                        <span className={cn("font-bold text-xs", pFC > targetFC ? "text-rose-500" : "text-emerald-500")}>
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

      {/* MODAL EDICIÓN PLATO (+ MERMAS) PROTEGIDO Y COMPACTO */}
      <AnimatePresence>
        {editingPlato && (
          <div className="fixed inset-0 z-[9999] flex justify-center items-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingPlato(null)} className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="bg-white p-6 rounded-[2rem] shadow-2xl w-full max-w-sm relative z-10">
              <h3 className="font-bold text-slate-800 text-lg mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                <ChefHat className="w-5 h-5 text-indigo-500" /> {db.platos?.some(p => p.id === editingPlato.id) ? 'Editar' : 'Nuevo'} Plato
              </h3>
              <form onSubmit={handleSavePlato} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase ml-1 block mb-1">Nombre del Plato</label>
                  <input value={editingPlato.name} onChange={(e) => setEditingPlato({ ...editingPlato, name: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:border-indigo-400" required />
                </div>
                
                <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[9px] font-bold text-rose-500 uppercase ml-1 block mb-1">Coste Bruto (€)</label>
                      <input type="number" step="0.01" value={editingPlato.cost} onChange={(e) => setEditingPlato({ ...editingPlato, cost: Number(e.target.value) })} className="w-full p-2.5 bg-white rounded-lg text-sm font-bold text-rose-600 border border-rose-200 outline-none focus:border-rose-400" required />
                    </div>
                    <div className="w-20">
                      <label className="text-[9px] font-bold text-rose-500 uppercase ml-1 block mb-1">% Merma</label>
                      <input type="number" step="1" max="99" min="0" value={editingPlato.merma || 0} onChange={(e) => setEditingPlato({ ...editingPlato, merma: Number(e.target.value) })} className="w-full p-2.5 bg-white rounded-lg text-sm font-bold text-rose-600 border border-rose-200 outline-none focus:border-rose-400" />
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[10px] px-1 pt-1">
                    <span className="font-semibold text-rose-800">Coste Real Escandallo:</span>
                    <span className="font-black text-rose-600 text-sm">
                      {Num.fmt((Num.parse(editingPlato.cost) || 0) / (1 - ((Num.parse(editingPlato.merma) || 0) / 100)))}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1 block mb-1">PVP Bruto (€)</label>
                    <input type="number" step="0.01" value={editingPlato.price} onChange={(e) => setEditingPlato({ ...editingPlato, price: Number(e.target.value) })} className="w-full p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm font-bold text-emerald-700 outline-none focus:border-emerald-400" required />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1 block mb-1">Familia</label>
                    <select value={editingPlato.category} onChange={(e) => setEditingPlato({ ...editingPlato, category: e.target.value as any })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-indigo-400">
                      {['Entrantes', 'Principal', 'Postre', 'Bebidas', 'Alcohol', 'General'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                
                <div className="pt-2 flex gap-2">
                  {db.platos?.some(p => p.id === editingPlato.id) && (
                    <button type="button" onClick={() => handleDeletePlato(editingPlato.id)} className="p-3 text-rose-500 bg-rose-50 border border-rose-100 font-bold rounded-xl hover:bg-rose-100 transition" title="Eliminar Plato">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                  <button type="submit" className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold uppercase tracking-widest hover:bg-indigo-700 transition">Guardar</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
