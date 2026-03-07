import React, { useState, useMemo, useEffect } from 'react';
import { 
  Truck, Search, Plus, Zap, Download, Trash2, Camera, AlertTriangle,
  CheckCircle2, Clock, FileSpreadsheet, Calculator, Building2, ShoppingBag, Users, Hotel, Layers, Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Albaran } from '../types';
import { Num, ArumeEngine } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { NotificationService } from '../services/notifications'; 
import { GoogleGenAI } from "@google/genai";

interface AlbaranesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'DLV', name: 'Catering Hoteles', icon: Hotel, color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'CORP', name: 'Socios / Corp', icon: Users, color: 'text-slate-600', bg: 'bg-slate-100' },
];

const REAL_PARTNERS = ['PAU', 'JERONI', 'AGNES', 'ONLY ONE', 'TIENDA DE SAKES'];

export const AlbaranesView = ({ data, onSave }: AlbaranesViewProps) => {
  const [searchQ, setSearchQ] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL'); 
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [priceAlerts, setPriceAlerts] = useState<{n: string, old: number, new: number}[]>([]);
  
  // 🚀 NUEVO: Previsualización de la imagen pegada desde WhatsApp
  const [scannedImage, setScannedImage] = useState<string | null>(null);
  
  const [form, setForm] = useState({
    prov: '',
    date: new Date().toISOString().split('T')[0],
    num: '',
    socio: 'Arume',
    notes: '',
    text: '',
    paid: false,
    forceDup: false,
    unitId: 'REST' as BusinessUnit 
  });

  const [quickCalc, setQuickCalc] = useState({ name: '', total: '', iva: 10 });
  const [editingAlbaran, setEditingAlbaran] = useState<Albaran | null>(null);

  const norm = (s: string) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const uniqueProviders = useMemo(() => {
    const provs = (data.albaranes || []).map(a => a.prov).filter(Boolean);
    return Array.from(new Set(provs)).sort();
  }, [data.albaranes]);

  const parseSmartLine = (line: string) => {
    let clean = line.replace(/[€$]/g, '').replace(/,/g, '.').trim();
    if (!clean || clean.length < 5) return null;

    let rate = 10; 
    if (clean.match(/\b21\s?%/)) rate = 21;
    else if (clean.match(/\b4\s?%/)) rate = 4;
    
    const upper = clean.toUpperCase();
    if (upper.includes("ALCOHOL") || upper.includes("GINEBRA") || upper.includes("SERV") || upper.includes("VINO") || upper.includes("SAKE")) rate = 21;
    if (upper.includes("PAN ") || upper.includes("HUEVO") || upper.includes("LECHE") || upper.includes("FRUTA")) rate = 4;

    const numbers = [...clean.matchAll(/(\d+\.\d{2})/g)].map(m => parseFloat(m[1]));
    if (numbers.length === 0) return null;

    const totalLine = numbers[numbers.length - 1]; 
    
    let qty = 1;
    const qtyMatch = clean.match(/^(\d+(\.\d{1,3})?)\s*(kg|uds|x|\*|l|gr)/i);
    if (qtyMatch) qty = parseFloat(qtyMatch[1]);

    let name = clean.replace(totalLine.toString(), '').replace(/\d+(\.\d{1,3})?\s*(kg|uds|x|\*|l|gr)/i, '').replace(/\b(4|10|21)\s?%/, '').replace(/\.{2,}/g, '').trim();
    if (name.length < 2) name = "Varios Indefinido";

    const unitPrice = qty > 0 ? totalLine / qty : totalLine;
    const baseLine = totalLine / (1 + rate / 100);
    const taxLine = totalLine - baseLine;

    return { q: qty, n: name, t: totalLine, rate, base: baseLine, tax: taxLine, unit: unitPrice };
  };

  const analyzedItems = useMemo(() => {
    return form.text.split('\n').map(parseSmartLine).filter(Boolean);
  }, [form.text]);

  const liveTotals = useMemo(() => {
    const taxes: Record<number, { b: number; i: number }> = { 4: { b: 0, i: 0 }, 10: { b: 0, i: 0 }, 21: { b: 0, i: 0 } };
    let grandTotal = 0;

    analyzedItems.forEach(it => {
      if (it) {
        if (!taxes[it.rate]) taxes[it.rate] = { b: 0, i: 0 };
        taxes[it.rate].b += it.base;
        taxes[it.rate].i += it.tax;
        grandTotal += it.t;
      }
    });

    return { grandTotal, taxes };
  }, [analyzedItems]);

  const handleQuickAdd = () => {
    const t = Num.parse(quickCalc.total);
    if (t > 0 && quickCalc.name) {
      const calc = ArumeEngine.calcularImpuestos(t, quickCalc.iva as any);
      const newLine = `1x ${quickCalc.name} ${quickCalc.iva}% ${calc.total.toFixed(2)}`;
      setForm(prev => ({ ...prev, text: prev.text ? `${prev.text}\n${newLine}` : newLine }));
      setQuickCalc({ name: '', total: '', iva: 10 });
    }
  };

  // 🚀 NÚCLEO DE IA AISLADO (Sirve para archivos subidos y para pegar de WhatsApp)
  const processImageWithAI = async (file: File) => {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      alert("⚠️ Conecta tu IA primero en la pestaña 'IA' (Menú inferior).");
      return;
    }

    setIsAnalyzing(true);
    setPriceAlerts([]);
    
    try {
      // 1. Mostrar la imagen en pantalla para control visual
      const reader = new FileReader();
      reader.onload = (e) => setScannedImage(e.target?.result as string);
      reader.readAsDataURL(file);

      // 2. Preparar archivo para la IA
      const buffer = await file.arrayBuffer();
      const base64String = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      const prompt = `Analiza esta factura o ticket de compra de un grupo hostelero. Extrae los siguientes datos y responde EXCLUSIVAMENTE en formato JSON:
      1. proveedor: Nombre del proveedor
      2. fecha: Fecha en formato YYYY-MM-DD
      3. lineas: Desglose de productos en texto puro, cada producto en una línea nueva con el formato exacto: 'Cantidad Nombre PrecioTotal'. (Ejemplo: '5 kg Salmón 150.00').
      4. unidad: ¡REGLA DE NEGOCIO CRÍTICA! Analiza la DIRECCIÓN de entrega en la factura y el TIPO DE PRODUCTOS para decidir a qué bloque va:
         - Si la dirección es "Calle Catalunya" (o Catalunya):
             * Si los productos son mayoritariamente bebidas (Sakes, vinos) -> el valor debe ser "SHOP" (Tienda).
             * Si los productos son comida, frescos o envases -> el valor debe ser "DLV" (Catering Hoteles).
         - Si la dirección es "Avenida Argentina" (o Av. Argentina) -> el valor debe ser "REST" (Restaurante).
         - Si no pone dirección, adivina por el proveedor: proveedores de alcohol="SHOP", proveedores de comida generales="REST".`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [
            { inlineData: { data: base64String, mimeType: file.type } },
            { text: prompt }
        ]}],
      });

      const textRes = response.text?.replace(/```json/g, '').replace(/```/g, '').trim();
      const res = JSON.parse(textRes || '{}');
        
      const newLines = (res.lineas || '').split('\n').map(parseSmartLine).filter(Boolean);
      const alerts: any[] = [];
      
      newLines.forEach((nl: any) => {
        const history = data.albaranes?.flatMap(a => a.items || [])
          .filter(i => norm(i.n) === norm(nl.n))
          .sort((a, b) => 0); 
        
        const lastPrice = history && history.length > 0 ? history[history.length - 1].unit : null;
        if (lastPrice && nl.unit > lastPrice * 1.05) { 
          alerts.push({ n: nl.n, old: lastPrice, new: nl.unit });
        }
      });

      setPriceAlerts(alerts);
      
      // La IA rellena, pero tú tienes la última palabra
      setForm(prev => ({
        ...prev,
        prov: res.proveedor || prev.prov,
        date: res.fecha || prev.date,
        text: res.lineas || prev.text,
        unitId: (res.unidad as BusinessUnit) || 'REST' 
      }));

    } catch (err) {
      console.error(err);
      alert("Error leyendo el ticket con IA. Verifica que la imagen sea nítida.");
      setScannedImage(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDirectScan = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageWithAI(file);
    e.target.value = '';
  };

  // 🚀 MAGIA DE WHATSAPP: Pegar imagen (Ctrl+V) en cualquier parte de la pantalla
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            processImageWithAI(blob);
            break; // Solo procesamos la primera imagen que encuentre
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [data]);

  const handleSaveAlbaran = async () => {
    if (!form.prov) return alert("Por favor, introduce el nombre del proveedor.");

    const newData = { ...data };
    if (!newData.albaranes) newData.albaranes = [];

    const existingIdx = newData.albaranes.findIndex(a => 
      !a.invoiced && 
      norm(a.prov) === norm(form.prov) && 
      a.date === form.date && 
      a.socio === form.socio &&
      a.unitId === form.unitId
    );

    if (existingIdx !== -1 && !form.forceDup) {
      const existing = newData.albaranes[existingIdx];
      
      const newItems = analyzedItems.filter(newItem => 
        !(existing.items || []).some((oldItem: any) => 
          norm(oldItem.n) === norm(newItem?.n || '') && 
          Math.abs((oldItem.t || 0) - (newItem?.t || 0)) < 0.01
        )
      );

      if (newItems.length > 0) {
        existing.items = [...(existing.items || []), ...newItems.map(item => item!)];
        existing.total = Num.round2((Num.parse(existing.total) || 0) + newItems.reduce((acc, it) => acc + (it?.t || 0), 0));
        existing.base = Num.round2((Num.parse(existing.base) || 0) + newItems.reduce((acc, it) => acc + (it?.base || 0), 0));
        existing.taxes = Num.round2((Num.parse(existing.taxes) || 0) + newItems.reduce((acc, it) => acc + (it?.tax || 0), 0));
        existing.notes = existing.notes ? `${existing.notes} | ${form.notes}` : form.notes;
        existing.paid = existing.paid || form.paid;
      }
    } else {
      const taxesArray = Object.values(liveTotals.taxes) as { b: number; i: number }[];
      const newAlbaran: Albaran = {
        id: `man-${Date.now()}-${Math.random().toString(36).substring(2)}`,
        prov: form.prov,
        date: form.date,
        num: form.num || "S/N",
        socio: form.socio,
        notes: form.notes,
        items: analyzedItems.map(item => item!), 
        total: Num.round2(liveTotals.grandTotal),
        base: Num.round2(taxesArray.reduce((acc, t) => acc + t.b, 0)),
        taxes: Num.round2(taxesArray.reduce((acc, t) => acc + t.i, 0)),
        invoiced: false,
        paid: form.paid,
        status: 'ok',
        reconciled: false,
        unitId: form.unitId 
      };
      newData.albaranes.push(newAlbaran);
    }

    await onSave(newData);
    
    if (NotificationService && NotificationService.checkCriticalStock) {
       NotificationService.checkCriticalStock(newData).catch(e => console.error("Error stock:", e));
    }

    setForm({ prov: '', date: new Date().toISOString().split('T')[0], num: '', socio: 'Arume', notes: '', text: '', paid: false, forceDup: false, unitId: 'REST' });
    setPriceAlerts([]);
    setScannedImage(null); // Limpiamos la imagen tras guardar
    alert("¡Albarán guardado correctamente en su bloque!");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar gasto permanentemente?")) return;
    const newData = { ...data };
    newData.albaranes = newData.albaranes.filter(a => a.id !== id);
    await onSave(newData);
    setEditingAlbaran(null);
  };

  const kpis = useMemo(() => {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const añoActual = hoy.getFullYear();
    const trimActual = Math.floor(mesActual / 3) + 1;

    let totalGlobal = 0, totalMes = 0, totalTrim = 0;

    (data.albaranes || []).forEach(a => {
      if (selectedUnit !== 'ALL' && (a.unitId || 'REST') !== selectedUnit) return;

      const val = Num.parse(a.total);
      totalGlobal += val;
      const d = new Date(a.date);
      if (d.getFullYear() === añoActual) {
        if (d.getMonth() === mesActual) totalMes += val;
        if ((Math.floor(d.getMonth() / 3) + 1) === trimActual) totalTrim += val;
      }
    });

    return { totalGlobal, totalMes, totalTrim };
  }, [data.albaranes, selectedUnit]);

  const filteredAlbaranes = useMemo(() => {
    return (data.albaranes || []).filter(a => {
      const itemUnit = a.unitId || 'REST';
      if (selectedUnit !== 'ALL' && itemUnit !== selectedUnit) return false;

      const term = searchQ.toLowerCase();
      return (a.prov || '').toLowerCase().includes(term) || (a.num || '').toLowerCase().includes(term);
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.albaranes, searchQ, selectedUnit]);

  // EL RESTO DEL CÓDIGO (La interfaz HTML) se mantiene exactamente igual, solo añadimos la previsualización de la foto

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      <datalist id="providers-list">
        {uniqueProviders.map(p => <option key={p} value={p} />)}
      </datalist>

      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tighter">Compras & Gastos</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Multi-Local IA Activa</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap justify-center">
          
          <button 
            onClick={async () => {
              if (!confirm("¿Agrupar albaranes fragmentados? Esto unirá gastos del mismo día, proveedor y bloque.")) return;
              const newData = { ...data };
              const grouped: Record<string, Albaran> = {};
              
              (newData.albaranes || []).forEach(a => {
                const targetKey = Object.keys(grouped).find(k => 
                  !grouped[k].invoiced && 
                  norm(grouped[k].prov) === norm(a.prov) && 
                  grouped[k].date === a.date && 
                  (grouped[k].unitId || 'REST') === (a.unitId || 'REST') 
                );
                
                if (targetKey && !a.invoiced) {
                  grouped[targetKey].items = [...(grouped[targetKey].items || []), ...(a.items || [])];
                  grouped[targetKey].total = Num.round2(Num.parse(grouped[targetKey].total) + Num.parse(a.total));
                  grouped[targetKey].base = Num.round2(Num.parse(grouped[targetKey].base) + Num.parse(a.base));
                  grouped[targetKey].taxes = Num.round2(Num.parse(grouped[targetKey].taxes) + Num.parse(a.taxes));
                } else {
                  grouped[a.id] = { ...a };
                }
              });
              
              newData.albaranes = Object.values(grouped);
              await onSave(newData);
              alert("¡Albaranes agrupados con éxito!");
            }}
            className="bg-slate-100 text-slate-500 px-4 py-3 rounded-2xl text-[10px] font-black hover:bg-slate-200 transition shadow-sm flex items-center gap-1"
          >
            <Layers className="w-4 h-4" /> AGRUPAR
          </button>

          {/* 🚀 BOTÓN IA Y AVISO DE PORTAPAPELES */}
          <label className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-5 py-3 rounded-2xl text-[10px] font-black hover:shadow-lg hover:scale-105 transition cursor-pointer shadow-md flex items-center gap-2">
            <Camera className="w-4 h-4" />
            <span>SUBIR IMAGEN O (Ctrl+V)</span>
            <input type="file" onChange={handleDirectScan} className="hidden" accept="image/*, application/pdf" />
          </label>
        </div>
      </header>

      {/* Selector Multi-Bloque Global */}
      <div className="flex flex-wrap gap-2 px-1">
        <button
          onClick={() => setSelectedUnit('ALL')}
          className={cn(
            "px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5",
            selectedUnit === 'ALL' ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
          )}
        >
          <Layers className="w-3 h-3" /> Ver Todos
        </button>
        {BUSINESS_UNITS.map(unit => (
          <button
            key={unit.id}
            onClick={() => setSelectedUnit(unit.id)}
            className={cn(
              "px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5",
              selectedUnit === unit.id 
                ? `${unit.color.replace('text-', 'bg-')} text-white border-transparent shadow-md` 
                : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
            )}
          >
            <unit.icon className="w-3 h-3" />
            {unit.name}
          </button>
        ))}
      </div>

      {/* KPIs Dinámicos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white px-6 py-5 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-center items-start">
          <span className="text-[10px] font-black text-slate-400 uppercase mb-1">Gasto Histórico</span>
          <span className="text-2xl font-black text-slate-800">{Num.fmt(kpis.totalGlobal)}</span>
        </div>
        <div className="bg-indigo-50 px-6 py-5 rounded-[2rem] border border-indigo-100 shadow-sm flex flex-col justify-center items-start relative overflow-hidden">
          <Clock className="absolute -right-4 -top-4 w-24 h-24 opacity-10 text-indigo-500" />
          <span className="text-[10px] font-black text-indigo-500 uppercase mb-1">Este Trimestre</span>
          <span className="text-3xl font-black text-indigo-900">{Num.fmt(kpis.totalTrim)}</span>
        </div>
        <div className="bg-emerald-50 px-6 py-5 rounded-[2rem] border border-emerald-100 shadow-sm flex flex-col justify-center items-start relative overflow-hidden">
          <CheckCircle2 className="absolute -right-4 -top-4 w-24 h-24 opacity-10 text-emerald-500" />
          <span className="text-[10px] font-black text-emerald-600 uppercase mb-1">Este Mes</span>
          <span className="text-3xl font-black text-emerald-900">{Num.fmt(kpis.totalMes)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Column */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border-2 border-indigo-50 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500"></div>
            
            {isAnalyzing && (
              <div className="absolute inset-0 bg-white/95 z-20 flex flex-col items-center justify-center text-center p-4 backdrop-blur-sm">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                <p className="text-xs font-black text-indigo-600 animate-pulse uppercase tracking-widest">IA analizando origen...</p>
              </div>
            )}

            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><Plus className="w-4 h-4 text-indigo-500" /> Nueva Factura</span>
              <span className="text-[9px] text-slate-400 font-bold bg-slate-100 px-2 py-1 rounded">Soporta Ctrl+V 📋</span>
            </h3>

            {/* 🚀 PANEL DE CONTROL VISUAL (IMAGEN DEL TICKET) */}
            <AnimatePresence>
              {scannedImage && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-4">
                  <div className="relative w-full h-32 bg-slate-100 rounded-2xl overflow-hidden border border-slate-200">
                    <img src={scannedImage} alt="Ticket Scaneado" className="w-full h-full object-cover opacity-80" />
                    <button 
                      onClick={() => setScannedImage(null)} 
                      className="absolute top-2 right-2 bg-slate-900/50 text-white p-1.5 rounded-lg hover:bg-rose-500 transition"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <div className="absolute bottom-2 left-2 bg-indigo-600 text-white text-[8px] font-black px-2 py-1 rounded shadow-lg uppercase">
                      Ticket Base
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* SELECTOR VISUAL DE UNIDAD DE NEGOCIO AL CREAR ALBARÁN */}
            <div className={cn(
              "mb-4 p-3 rounded-2xl border transition-colors",
              form.unitId === 'REST' ? "bg-indigo-50/50 border-indigo-100" :
              form.unitId === 'DLV' ? "bg-amber-50/50 border-amber-100" : "bg-emerald-50/50 border-emerald-100"
            )}>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 text-center flex justify-center items-center gap-1">
                {scannedImage && <Sparkles className="w-3 h-3 text-indigo-500" />} Asignar a Bloque:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {BUSINESS_UNITS.map(unit => (
                  <button
                    key={unit.id}
                    onClick={() => setForm({ ...form, unitId: unit.id })}
                    className={cn(
                      "p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1.5",
                      form.unitId === unit.id 
                        ? `${unit.color.replace('text-', 'border-')} ${unit.bg} ${unit.color} shadow-sm` 
                        : "border-slate-100 bg-white text-slate-400 grayscale hover:grayscale-0"
                    )}
                  >
                    <unit.icon className="w-4 h-4" />
                    <span className="text-[8px] font-black uppercase text-center leading-tight">{unit.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {priceAlerts.length > 0 && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-2xl space-y-2 animate-bounce-subtle">
                <p className="text-[10px] font-black text-rose-600 uppercase flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> ¡Alerta de Precios!
                </p>
                {priceAlerts.map((alt, i) => (
                  <p key={i} className="text-[9px] text-rose-500 font-bold">
                    {alt.n}: Costaba {Num.fmt(alt.old)} → <span className="font-black underline">{Num.fmt(alt.new)}</span>
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-3 mb-4">
              <input 
                value={form.prov}
                onChange={(e) => setForm({ ...form, prov: e.target.value })}
                list="providers-list"
                type="text" 
                placeholder="Proveedor (ej: Makro)" 
                className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
              <div className="flex gap-2">
                <input 
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  type="date" 
                  className="flex-1 p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none"
                />
                <input 
                  value={form.num}
                  onChange={(e) => setForm({ ...form, num: e.target.value })}
                  type="text" 
                  placeholder="Ref." 
                  className="w-1/3 p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none"
                />
              </div>
              <input 
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                type="text" 
                placeholder="Notas (opcional)..." 
                className="w-full p-3 bg-slate-50 rounded-xl text-xs border-0 outline-none"
              />
            </div>

            <textarea 
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              placeholder="Escribe líneas o pega la imagen...&#10;Ej: 5 kg Salmón 150.00" 
              className="w-full h-32 bg-slate-50 rounded-2xl p-4 text-xs font-mono border-0 outline-none resize-none mb-3 shadow-inner focus:bg-white transition"
            />
            
            <div className="mt-3 space-y-1 max-h-52 overflow-y-auto custom-scrollbar px-1 bg-slate-50/50 rounded-xl p-2 min-h-[50px]">
              {analyzedItems.length > 0 ? analyzedItems.map((it, idx) => it && (
                <div key={idx} className="flex justify-between items-center text-[10px] border-b border-slate-200 py-2 last:border-0">
                  <span className="truncate pr-2 font-bold text-slate-700"><b>{it.q}x</b> {it.n} <span className="text-[8px] text-slate-400">({it.rate}%)</span></span>
                  <span className="font-black text-slate-900 whitespace-nowrap">{Num.fmt(it.t)}</span>
                </div>
              )) : (
                <p className="text-[10px] text-slate-300 text-center italic py-2">Sin productos detectados...</p>
              )}
            </div>

            <div className="mt-4 p-4 bg-slate-900 rounded-2xl shadow-lg space-y-2">
              {(Object.entries(liveTotals.taxes) as [string, { b: number; i: number }][]).map(([r, t]) => t.b > 0 && (
                <div key={r} className="flex justify-between text-[10px] text-slate-400">
                  <span className="font-bold w-12 uppercase">IVA {r}%</span>
                  <span className="flex-1 text-right pr-4">Base: {Num.fmt(t.b)}</span>
                  <span className="text-emerald-400 font-black">+{Num.fmt(t.i)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-2 border-t border-slate-700 mt-2">
                <span className="text-xs font-black text-white uppercase">TOTAL</span>
                <span className="text-2xl font-black text-white">{Num.fmt(liveTotals.grandTotal)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4 px-2">
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="inPaid" 
                  checked={form.paid}
                  onChange={(e) => setForm({ ...form, paid: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 cursor-pointer" 
                />
                <label htmlFor="inPaid" className="text-xs font-bold text-slate-600 cursor-pointer">Pagado Contado</label>
              </div>
            </div>

            <button 
              onClick={handleSaveAlbaran}
              className="w-full mt-4 bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-indigo-700 transition active:scale-95"
            >
              GUARDAR COMPRA
            </button>
          </div>
        </div>

        {/* List Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-2 rounded-full shadow-sm border border-slate-100 flex items-center px-4">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input 
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              type="text" 
              placeholder="Buscar por proveedor o referencia..." 
              className="bg-transparent text-sm font-bold outline-none w-full text-slate-600 pl-3" 
            />
          </div>

          <div className="space-y-3 pb-20">
            {filteredAlbaranes.length > 0 ? filteredAlbaranes.map(a => {
              const unitConfig = BUSINESS_UNITS.find(u => u.id === (a.unitId || 'REST'));
              
              return (
                <div 
                  key={a.id}
                  onClick={() => setEditingAlbaran(a)}
                  className={cn(
                    "bg-white p-5 rounded-3xl border border-slate-100 flex justify-between items-center shadow-sm hover:shadow-md transition cursor-pointer",
                    a.reconciled && "ring-2 ring-emerald-400/50"
                  )}
                >
                  <div>
                    <h4 className="font-black text-slate-800 flex items-center gap-2 flex-wrap">
                      {a.prov}
                      {unitConfig && (
                        <span className={cn(
                          "text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1",
                          unitConfig.color, unitConfig.bg
                        )}>
                          <unitConfig.icon className="w-3 h-3" />
                          {unitConfig.name}
                        </span>
                      )}
                    </h4>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-[10px] text-slate-400 font-bold">{a.date}</p>
                      {a.notes && <span className="text-[9px] text-indigo-400 bg-indigo-50 px-1.5 rounded font-bold">📝 Nota</span>}
                      {a.reconciled && <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 rounded font-black">🔗 Conciliado</span>}
                      {a.invoiced && <span className="text-[9px] text-blue-600 bg-blue-50 px-1.5 rounded font-black">📄 Facturado</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-slate-900 text-lg">{Num.fmt(a.total)}</p>
                    <span className={cn(
                      "text-[8px] font-black uppercase",
                      a.paid ? 'text-emerald-500' : 'text-rose-500'
                    )}>
                      {a.paid ? 'Pagado' : 'Pendiente'}
                    </span>
                  </div>
                </div>
              );
            }) : (
              <div className="py-20 text-center opacity-50 bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200">
                <Truck className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-slate-500 font-bold text-sm">Sin registros en este bloque.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingAlbaran && (
          <div className="fixed inset-0 z-[200] flex justify-center items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setEditingAlbaran(null)}
              className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl relative z-10 flex flex-col max-h-[90vh]"
            >
              <button onClick={() => setEditingAlbaran(null)} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500 text-2xl transition">✕</button>
              
              <div className="border-b border-slate-100 pb-4 mb-6">
                <h3 className="text-2xl font-black text-slate-800 tracking-tighter">Detalle del Gasto</h3>
                <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1">Ref: {editingAlbaran.num}</p>
                {editingAlbaran.link_foto && (
                  <a href={editingAlbaran.link_foto} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline inline-block mt-2">
                    📸 Ver Ticket en Drive
                  </a>
                )}
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Proveedor</p>
                    <p className="text-sm font-black text-slate-800">{editingAlbaran.prov}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Fecha</p>
                    <p className="text-sm font-black text-slate-800">{editingAlbaran.date}</p>
                  </div>
                </div>

                <div className={cn("p-4 rounded-2xl border flex items-center gap-3", 
                  BUSINESS_UNITS.find(u => u.id === (editingAlbaran.unitId || 'REST'))?.bg,
                  BUSINESS_UNITS.find(u => u.id === (editingAlbaran.unitId || 'REST'))?.color
                )}>
                   <Layers className="w-5 h-5 opacity-50" />
                   <div>
                     <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Unidad de Negocio</p>
                     <p className="text-sm font-black">{BUSINESS_UNITS.find(u => u.id === (editingAlbaran.unitId || 'REST'))?.name}</p>
                   </div>
                </div>

                {editingAlbaran.notes && (
                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                    <p className="text-[9px] font-black text-amber-600 uppercase mb-1">Notas</p>
                    <p className="text-xs font-bold text-amber-900">{editingAlbaran.notes}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-[9px] font-black text-slate-400 uppercase ml-2">Desglose de productos</p>
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2">
                    {editingAlbaran.items?.map((it, i) => (
                      <div key={i} className="flex justify-between items-center text-xs border-b border-slate-200 last:border-0 pb-2 last:pb-0 pt-2 first:pt-0">
                        <span className="font-bold text-slate-700"><b>{it.q}x</b> {it.n}</span>
                        <span className="font-black text-slate-900">{Num.fmt(it.t)}</span>
                      </div>
                    ))}
                    
                    <div className="mt-4 pt-2 border-t border-slate-300 border-dashed flex justify-between text-[10px] text-slate-500 font-bold">
                      <span>Base: {Num.fmt(editingAlbaran.base || 0)}</span>
                      <span>IVA: {Num.fmt(editingAlbaran.taxes || 0)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase">Total Importe</p>
                    <p className="text-3xl font-black text-emerald-400">{Num.fmt(editingAlbaran.total)}</p>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-black uppercase inline-block",
                      editingAlbaran.paid ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                    )}>
                      {editingAlbaran.paid ? 'Pagado' : 'Pendiente'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-100 flex gap-3">
                <button onClick={() => handleDelete(editingAlbaran.id)} className="flex-1 bg-rose-50 text-rose-500 py-4 rounded-2xl font-black text-xs hover:bg-rose-100 flex justify-center items-center gap-2">
                  <Trash2 className="w-4 h-4" /> ELIMINAR
                </button>
                <button onClick={() => setEditingAlbaran(null)} className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-black text-xs hover:bg-slate-200">
                  CERRAR
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
