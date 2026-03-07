import React, { useState, useMemo, useEffect } from 'react';
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  CreditCard, 
  Banknote, 
  Truck, 
  Sparkles, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Clock,
  AlertTriangle,
  RefreshCw,
  Image as ImageIcon,
  Scan,
  FileText,
  Building2,
  ShoppingBag,
  Layers,
  SplitSquareHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Cierre, Factura } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { NotificationService } from '../services/notifications';
import { GoogleGenAI } from "@google/genai";

export type CashBusinessUnit = 'REST' | 'SHOP';

const CASH_UNITS: { id: CashBusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' }
];

interface CashViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const CashView = ({ data, onSave }: CashViewProps) => {
  const [currentFilterDate, setCurrentFilterDate] = useState(new Date().toISOString().slice(0, 7));
  const [selectedUnit, setSelectedUnit] = useState<CashBusinessUnit | 'ALL'>('ALL'); 
  const [scanStatus, setScanStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [images, setImages] = useState<{ img1: string | null, img2: string | null }>({ img1: null, img2: null });

  // 🚀 Formulario optimizado para la CAJA ÚNICA con separación contable
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    efectivo: '',
    tarjeta: '',
    glovo: '',
    uber: '',
    madisa: '',
    deliveroo: '',
    cajaFisica: '',
    tienda: '', // 🚀 NUEVO: Lo que se facturó en Sakes
    notas: '',
    chkGastoCaja: false
  });

  const kpis = useMemo(() => {
    const cierresMes = (data.cierres || []).filter(c => {
      if (!c.date || !c.date.startsWith(currentFilterDate)) return false;
      if (selectedUnit !== 'ALL' && (c.unitId || 'REST') !== selectedUnit) return false;
      return true;
    });

    const total = cierresMes.reduce((acc, c) => acc + (Num.parse(c.totalVenta) || 0), 0);
    const dias = new Set(cierresMes.map(c => c.date)).size; // Días únicos
    const media = dias > 0 ? total / dias : 0;
    const efec = cierresMes.reduce((acc, c) => acc + (Num.parse(c.efectivo) || 0), 0);
    const tarj = cierresMes.reduce((acc, c) => acc + (Num.parse(c.tarjeta) || 0), 0);
    const apps = cierresMes.reduce((acc, c) => acc + (Num.parse(c.apps) || 0), 0);
    return { total, media, dias, efec, tarj, apps, cierresMes };
  }, [data.cierres, currentFilterDate, selectedUnit]);

  // 🚀 LÓGICA DE CÁLCULO SEPARADO
  const totalCalculado = useMemo(() => {
    return Num.parse(form.efectivo) + 
           Num.parse(form.tarjeta) + 
           Num.parse(form.glovo) + 
           Num.parse(form.uber) + 
           Num.parse(form.madisa) + 
           Num.parse(form.deliveroo);
  }, [form]);

  const totalTienda = useMemo(() => Num.parse(form.tienda), [form.tienda]);
  const totalRestaurante = useMemo(() => totalCalculado - totalTienda, [totalCalculado, totalTienda]);

  const descuadreVivo = useMemo(() => {
    if (form.cajaFisica === '' || form.efectivo === '') return null;
    return Num.round2(Num.parse(form.cajaFisica) - (Num.parse(form.efectivo) + 300)); 
  }, [form.cajaFisica, form.efectivo]);

  const handleMonthChange = (offset: number) => {
    let [y, m] = currentFilterDate.split('-').map(Number);
    m += offset;
    if (m === 0) { m = 12; y--; }
    if (m === 13) { m = 1; y++; }
    setCurrentFilterDate(`${y}-${String(m).padStart(2, '0')}`);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, slot: 'img1' | 'img2') => {
    const file = e.target.files?.[0];
    if (file) processImageWithAI(file, slot);
    e.target.value = '';
  };

  const processImageWithAI = async (file: File, slot: 'img1' | 'img2' = 'img1') => {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      alert("⚠️ No tienes la clave de IA conectada. Ve a la configuración para añadirla.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImages(prev => ({ ...prev, [slot]: reader.result as string }));
    };
    reader.readAsDataURL(file);

    setScanStatus('loading');

    try {
      const buffer = await file.arrayBuffer();
      const base64String = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      const promptText = `Analiza este ticket de cierre de caja. Extrae los datos en JSON puro:
      {
        "fecha": "YYYY-MM-DD",
        "efectivo": 0.0,
        "tarjeta": 0.0,
        "glovo": 0.0,
        "uber": 0.0,
        "sobre_cash": 0.0,
        "gastos": 0.0,
        "venta_tienda": 0.0,
        "notas": "explicación"
      }
      Busca la familia o sección 'Tienda', 'Sakes' o 'Boutique' y pon su valor en venta_tienda.`;

      const response = await ai.models.generateContent({ 
        model: "gemini-2.5-flash", 
        contents: [{ role: "user", parts: [{ text: promptText }, { inlineData: { data: base64String, mimeType: file.type } }] }] 
      });

      const text = response.text?.replace(/```json/g, '').replace(/```/g, '').trim() || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const ia = JSON.parse(jsonMatch[0]);
        
        setForm(prev => ({
          ...prev,
          date: ia.fecha || prev.date,
          efectivo: ia.efectivo !== undefined ? ia.efectivo.toString() : prev.efectivo,
          tarjeta: ia.tarjeta !== undefined ? ia.tarjeta.toString() : prev.tarjeta,
          glovo: ia.glovo !== undefined ? ia.glovo.toString() : prev.glovo,
          uber: ia.uber !== undefined ? ia.uber.toString() : prev.uber,
          cajaFisica: ia.sobre_cash ? (parseFloat(ia.sobre_cash) + 300).toFixed(2) : prev.cajaFisica,
          tienda: ia.venta_tienda !== undefined ? ia.venta_tienda.toString() : prev.tienda,
          notas: ia.gastos > 0 ? `Gastos IA: ${ia.gastos}€. ${ia.notas || ''}` : (ia.notas || prev.notas),
          chkGastoCaja: ia.gastos > 0 ? true : prev.chkGastoCaja
        }));
        setScanStatus('success');
      } else {
        throw new Error("JSON parse fail");
      }
    } catch (error) {
      console.error("Error IA Scan:", error);
      setScanStatus('error');
      alert("⚠️ Error al analizar con IA. Revisa la claridad de la foto.");
      setImages(prev => ({ ...prev, [slot]: null })); 
    } finally {
      setTimeout(() => setScanStatus('idle'), 4000);
    }
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const slot = !images.img1 ? 'img1' : 'img2';
            processImageWithAI(blob, slot);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [images]);

  // 🚀 EL CORAZÓN DE LA SEPARACIÓN B2B
  const handleSaveCierre = async () => {
    if (totalCalculado <= 0) return alert("Introduce algún importe para guardar la caja.");
    if (totalRestaurante < 0) return alert("La venta de la tienda no puede ser mayor que el total de la caja.");

    const newData = { ...data };
    const fechaSeleccionada = form.date;
    const descuadreFinal = descuadreVivo || 0;

    // Gasto apuntado a boli se asigna al restaurante por defecto
    if (form.chkGastoCaja) {
      const concepto = prompt("¿Qué has pagado con dinero de la caja hoy? (ej: Pan, Hielo):");
      const importe = prompt("¿Cuánto has pagado (€)?:");
      if (concepto && importe) {
        if (!newData.albaranes) newData.albaranes = [];
        newData.albaranes.push({
          id: 'cash-out-' + Date.now(),
          date: fechaSeleccionada,
          prov: concepto.toUpperCase(),
          num: "CAJA_EFECTIVO",
          total: parseFloat(importe),
          items: [],
          invoiced: true,
          reconciled: true, 
          paid: true,
          unitId: 'REST'
        });
      }
    }

    if (!newData.cierres) newData.cierres = [];
    if (!newData.facturas) newData.facturas = [];

    // --- 1. CIERRE Y FACTURA RESTAURANTE ---
    const cierreRest: Cierre = {
      id: Date.now().toString() + '-R',
      date: fechaSeleccionada,
      totalVenta: totalRestaurante,
      efectivo: Num.parse(form.efectivo), // El control físico se lo queda el restaurante
      tarjeta: Num.parse(form.tarjeta),
      apps: (Num.parse(form.glovo) + Num.parse(form.uber) + Num.parse(form.madisa) + Num.parse(form.deliveroo)),
      descuadre: descuadreFinal,
      notas: form.notas,
      conciliado_banco: false,
      unitId: 'REST' 
    };

    const idxRest = newData.cierres.findIndex(c => c.date === fechaSeleccionada && c.unitId === 'REST');
    if (idxRest >= 0) newData.cierres[idxRest] = cierreRest;
    else newData.cierres.unshift(cierreRest);

    const fIdxRest = newData.facturas.findIndex(f => f.num === `ZR-${fechaSeleccionada.replace(/-/g, '')}`);
    newData.facturas.push({
      id: fIdxRest >= 0 ? newData.facturas[fIdxRest].id : `zr-${Date.now()}`,
      num: `ZR-${fechaSeleccionada.replace(/-/g, '')}`,
      date: fechaSeleccionada,
      prov: "Z DIARIO",
      cliente: "Z DIARIO",
      total: totalRestaurante.toString(),
      base: Number((totalRestaurante / 1.10).toFixed(2)).toString(),
      tax: Number((totalRestaurante - (totalRestaurante / 1.10)).toFixed(2)).toString(),
      paid: fIdxRest >= 0 && newData.facturas[fIdxRest].reconciled ? true : false,
      reconciled: fIdxRest >= 0 && newData.facturas[fIdxRest].reconciled ? true : false,
      unidad_negocio: 'REST' 
    });

    // --- 2. CIERRE Y FACTURA TIENDA (Si hay ventas) ---
    if (totalTienda > 0) {
      const cierreShop: Cierre = {
        id: Date.now().toString() + '-S',
        date: fechaSeleccionada,
        totalVenta: totalTienda,
        efectivo: 0, tarjeta: 0, apps: 0, descuadre: 0,
        notas: 'Venta separada de la caja general',
        conciliado_banco: false,
        unitId: 'SHOP' 
      };

      const idxShop = newData.cierres.findIndex(c => c.date === fechaSeleccionada && c.unitId === 'SHOP');
      if (idxShop >= 0) newData.cierres[idxShop] = cierreShop;
      else newData.cierres.unshift(cierreShop);

      const fIdxShop = newData.facturas.findIndex(f => f.num === `ZS-${fechaSeleccionada.replace(/-/g, '')}`);
      newData.facturas.push({
        id: fIdxShop >= 0 ? newData.facturas[fIdxShop].id : `zs-${Date.now()}`,
        num: `ZS-${fechaSeleccionada.replace(/-/g, '')}`,
        date: fechaSeleccionada,
        prov: "Z DIARIO",
        cliente: "Z DIARIO",
        total: totalTienda.toString(),
        base: Number((totalTienda / 1.21).toFixed(2)).toString(), // Sakes al 21%
        tax: Number((totalTienda - (totalTienda / 1.21)).toFixed(2)).toString(),
        paid: fIdxShop >= 0 && newData.facturas[fIdxShop].reconciled ? true : false,
        reconciled: fIdxShop >= 0 && newData.facturas[fIdxShop].reconciled ? true : false,
        unidad_negocio: 'SHOP' 
      });
    }

    // Limpiamos facturas duplicadas antiguas por si acaso
    if (fIdxRest >= 0) newData.facturas.splice(fIdxRest, 1);
    const fIdxShopOld = newData.facturas.findIndex(f => f.num === `ZS-${fechaSeleccionada.replace(/-/g, '')}`);
    if (fIdxShopOld >= 0) newData.facturas.splice(fIdxShopOld, 1);

    await onSave(newData);
    
    // Alerta a Telegram
    if (Math.abs(descuadreFinal) > 5) {
      await NotificationService.notifyCajaDescuadre(newData, fechaSeleccionada, descuadreFinal);
    }
    
    const msg = `💰 *CIERRE CAJA GENERAL: ${fechaSeleccionada}*\n\n` +
      `📈 *TOTAL CAJA:* ${totalCalculado.toFixed(2)}€\n` +
      `   ├ 🏢 Rest: ${totalRestaurante.toFixed(2)}€\n` +
      `   └ 🍶 Tienda: ${totalTienda.toFixed(2)}€\n\n` +
      `💵 Efectivo: ${Num.parse(form.efectivo).toFixed(2)}€ | 💳 Tarj: ${Num.parse(form.tarjeta).toFixed(2)}€\n` +
      `⚖️ *Descuadre:* ${descuadreFinal > 0 ? '+' : ''}${descuadreFinal.toFixed(2)}€\n` +
      (form.notas ? `📝 _${form.notas}_` : '');
    
    await NotificationService.sendAlert(newData, msg, 'INFO');
    
    setForm({
        date: new Date().toISOString().split('T')[0],
        efectivo: '', tarjeta: '', glovo: '', uber: '', madisa: '', deliveroo: '',
        cajaFisica: '', tienda: '', notas: '', chkGastoCaja: false, unitId: 'REST'
    });
    setImages({ img1: null, img2: null });
  };

  const handleDeleteCierre = async (id: string) => {
    if (!confirm("¿Borrar este cierre?")) return;
    const newData = { ...data };
    const c = newData.cierres.find((x: any) => x.id === id);
    if (c) {
      const blockPrefix = c.unitId === 'SHOP' ? 'S' : 'R';
      const zNum = `Z${blockPrefix}-${c.date.replace(/-/g, '')}`;
      newData.facturas = newData.facturas.filter((f: any) => f.num !== zNum);
      newData.cierres = newData.cierres.filter((x: any) => x.id !== id);
      await onSave(newData);
    }
  };

  const [year, month] = currentFilterDate.split('-');
  const nombreMes = new Date(Number(year), Number(month) - 1).toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header y Navegación Mes */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Control de Caja Unificada</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest flex items-center gap-1 mt-1">
            <SplitSquareHorizontal className="w-3 h-3" /> Separación Automática
          </p>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
          <button onClick={() => handleMonthChange(-1)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl text-slate-600 shadow-sm hover:bg-indigo-50 transition font-bold text-lg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <input 
            type="month" 
            value={currentFilterDate} 
            onChange={(e) => setCurrentFilterDate(e.target.value)}
            className="bg-transparent border-0 text-sm font-black text-slate-700 uppercase outline-none text-center w-36 cursor-pointer"
          />
          <button onClick={() => handleMonthChange(1)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl text-slate-600 shadow-sm hover:bg-indigo-50 transition font-bold text-lg">
            <ChevronRight className="w-5 h-5" />
          </button>
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
          <Layers className="w-3 h-3" /> Consolidado
        </button>
        {CASH_UNITS.map(unit => (
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

      {/* Tarjetas KPI Filtradas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Facturación {nombreMes}</p>
          <p className="text-4xl font-black mt-2">{kpis.total.toLocaleString('es-ES', {minimumFractionDigits: 0})}€</p>
          <p className="text-[10px] text-indigo-300 mt-1 font-bold">Media diaria: {kpis.media.toFixed(0)}€</p>
        </div>

        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
            <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> Tarjeta</span> 
            <span>{kpis.tarj.toLocaleString()}€</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${kpis.total > 0 ? (kpis.tarj/kpis.total)*100 : 0}%` }}></div>
          </div>
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
            <span className="flex items-center gap-1"><Banknote className="w-3 h-3" /> Efectivo</span> 
            <span>{kpis.efec.toLocaleString()}€</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${kpis.total > 0 ? (kpis.efec/kpis.total)*100 : 0}%` }}></div>
          </div>
        </div>

        <div className="bg-orange-50 p-6 rounded-[2.5rem] border border-orange-100 shadow-sm flex flex-col justify-center items-start">
          <Truck className="w-6 h-6 text-orange-300 mb-2" />
          <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">Apps Delivery (Glovo/Uber)</p>
          <p className="text-3xl font-black text-orange-600 mt-1">{kpis.apps.toLocaleString()}€</p>
        </div>
      </div>

      {/* Formulario Nuevo Cierre Z */}
      <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100 relative overflow-hidden mt-8">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-emerald-400"></div>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h3 className="text-xl font-black text-slate-800">Nuevo Cierre Z (Caja Única)</h3>
            <p className="text-[10px] text-slate-400 font-bold mt-1">El sistema separará automáticamente Restaurante y Tienda.</p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => {
                if(!images.img1) return alert("Sube imagen primero");
                processImageWithAI(null as any, 'img1'); // Re-try scan
              }}
              disabled={scanStatus === 'loading'}
              className="bg-indigo-600 text-white px-6 py-2 rounded-xl text-[10px] font-black hover:scale-105 transition shadow-lg flex items-center gap-2"
            >
              {scanStatus === 'loading' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Scan className="w-3 h-3" />}
              <span>{scanStatus === 'loading' ? 'ANALIZANDO...' : 'ESCANEAR (IA)'}</span>
            </button>
          </div>
        </div>

        {/* Image Upload Slots */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="relative group">
            <label className={cn(
              "flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-[2rem] cursor-pointer transition-all",
              images.img1 ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
            )}>
              {images.img1 ? (
                <div className="relative w-full h-full p-2">
                  <img src={images.img1} className="w-full h-full object-cover rounded-2xl" alt="Ticket Principal" />
                  <button onClick={(e) => { e.preventDefault(); setImages(prev => ({...prev, img1: null})); }} className="absolute -top-2 -right-2 bg-rose-500 text-white p-1 rounded-full shadow-lg">
                    <Trash2 className="w-3 h-3" />
                  </button>
                  {scanStatus === 'loading' && (
                    <div className="absolute inset-0 bg-slate-900/50 rounded-2xl flex items-center justify-center">
                      <RefreshCw className="w-6 h-6 text-white animate-spin" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <ImageIcon className="w-6 h-6 text-slate-300 mb-2" />
                  <p className="text-[9px] font-black text-slate-400 uppercase text-center">Pegar (Ctrl+V) o Subir<br/>Ticket Z Principal</p>
                </div>
              )}
              <input type="file" onChange={(e) => handleImageUpload(e, 'img1')} className="hidden" accept="image/*" capture="environment" />
            </label>
          </div>

          <div className="relative group">
            <label className={cn(
              "flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-[2rem] cursor-pointer transition-all",
              images.img2 ? "border-indigo-200 bg-indigo-50/30" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
            )}>
              {images.img2 ? (
                <div className="relative w-full h-full p-2">
                  <img src={images.img2} className="w-full h-full object-cover rounded-2xl" alt="Sobre o TPV" />
                  <button onClick={(e) => { e.preventDefault(); setImages(prev => ({...prev, img2: null})); }} className="absolute -top-2 -right-2 bg-rose-500 text-white p-1 rounded-full shadow-lg">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Scan className="w-6 h-6 text-slate-300 mb-2" />
                  <p className="text-[9px] font-black text-slate-400 uppercase text-center">Ticket TPV (Opcional)</p>
                </div>
              )}
              <input type="file" onChange={(e) => handleImageUpload(e, 'img2')} className="hidden" accept="image/*" capture="environment" />
            </label>
          </div>
        </div>
        
        {/* Entradas de Datos */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Fecha y Totales Caja</h4>
            <input 
              type="date" 
              value={form.date} 
              onChange={(e) => setForm({...form, date: e.target.value})}
              className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none focus:ring-2 ring-indigo-500/20"
            />
            <input 
              type="number" 
              placeholder="Efectivo Ticket Z" 
              value={form.efectivo}
              onChange={(e) => setForm({...form, efectivo: e.target.value})}
              className="w-full p-4 bg-slate-50 rounded-2xl text-lg font-black outline-none focus:ring-2 ring-indigo-500/20"
            />
            <input 
              type="number" 
              placeholder="Tarjeta TPV" 
              value={form.tarjeta}
              onChange={(e) => setForm({...form, tarjeta: e.target.value})}
              className="w-full p-4 bg-slate-50 rounded-2xl text-lg font-black outline-none focus:ring-2 ring-indigo-500/20"
            />
          </div>
          
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Apps y Separación</h4>
            <div className="grid grid-cols-2 gap-2">
              <input 
                type="number" placeholder="Glovo" value={form.glovo}
                onChange={(e) => setForm({...form, glovo: e.target.value})}
                className="p-3 bg-orange-50/50 rounded-xl font-bold text-sm outline-none focus:ring-2 ring-orange-500/30"
              />
              <input 
                type="number" placeholder="Uber" value={form.uber}
                onChange={(e) => setForm({...form, uber: e.target.value})}
                className="p-3 bg-indigo-50/50 rounded-xl font-bold text-sm outline-none focus:ring-2 ring-indigo-500/30"
              />
              <input 
                type="number" placeholder="Madisa" value={form.madisa}
                onChange={(e) => setForm({...form, madisa: e.target.value})}
                className="p-3 bg-rose-50/50 rounded-xl font-bold text-sm outline-none"
              />
              <input 
                type="number" placeholder="Deliveroo" value={form.deliveroo}
                onChange={(e) => setForm({...form, deliveroo: e.target.value})}
                className="p-3 bg-teal-50/50 rounded-xl font-bold text-sm outline-none"
              />
            </div>
            
            {/* 🚀 EL CAMPO MÁGICO DE SEPARACIÓN */}
            <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 relative overflow-hidden mt-4">
              <ShoppingBag className="absolute -right-2 -top-2 w-12 h-12 text-emerald-500 opacity-10" />
              <label className="text-[9px] font-black text-emerald-700 uppercase block mb-2">Desvío a Tienda Sakes</label>
              <input 
                type="number" 
                placeholder="0.00" 
                value={form.tienda}
                onChange={(e) => setForm({...form, tienda: e.target.value})}
                className="w-full p-3 bg-white rounded-xl text-lg font-black outline-none focus:ring-2 ring-emerald-500/30 text-emerald-700"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">3. Arqueo y Balance</h4>
            <div>
              <input 
                type="number" 
                placeholder="Dinero Físico en la Caja" 
                value={form.cajaFisica}
                onChange={(e) => setForm({...form, cajaFisica: e.target.value})}
                className={cn(
                  "w-full p-4 rounded-2xl text-2xl font-black outline-none transition-colors",
                  descuadreVivo !== null && Math.abs(descuadreVivo) > 2 ? "bg-rose-900 text-white shadow-[0_0_15px_rgba(225,29,72,0.3)] ring-2 ring-rose-500" : "bg-slate-900 text-emerald-400"
                )}
              />
              <p className="text-[9px] text-slate-400 font-bold uppercase mt-1 ml-2">Fondo de caja: 300.00€</p>
              
              <AnimatePresence>
                {descuadreVivo !== null && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className={cn(
                    "mt-3 text-xs font-black flex items-center gap-1.5 p-2 rounded-xl",
                    Math.abs(descuadreVivo) <= 2 ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50 border border-rose-200"
                  )}>
                    {Math.abs(descuadreVivo) <= 2 ? (
                      <><CheckCircle2 className="w-4 h-4" /> CAJA PERFECTA</>
                    ) : descuadreVivo > 0 ? (
                      <><AlertTriangle className="w-4 h-4" /> SOBRAN {descuadreVivo.toFixed(2)}€</>
                    ) : (
                      <><AlertTriangle className="w-4 h-4" /> FALTAN {Math.abs(descuadreVivo).toFixed(2)}€</>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-between items-end">
               <div>
                  <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block mb-0.5">Restaurante</span>
                  <span className="text-xl font-black text-indigo-600">{totalRestaurante.toFixed(2)}€</span>
               </div>
               <div className="text-right">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Caja Total</span>
                 <span className="text-3xl font-black text-slate-800 tracking-tighter">{totalCalculado.toFixed(2)}€</span>
               </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-8 border-t border-slate-100 pt-6">
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 w-fit">
            <input 
              type="checkbox" 
              id="chkGastoCaja" 
              checked={form.chkGastoCaja}
              onChange={(e) => setForm({...form, chkGastoCaja: e.target.checked})}
              className="w-5 h-5 accent-indigo-600 cursor-pointer"
            />
            <label htmlFor="chkGastoCaja" className="text-[10px] font-black text-slate-600 uppercase cursor-pointer">¿Has pagado algo sacando efectivo hoy?</label>
          </div>
          <button 
            onClick={handleSaveCierre}
            className="w-full py-5 bg-slate-900 text-white rounded-[2rem] font-black text-sm shadow-2xl hover:bg-indigo-600 transition-all active:scale-95 flex justify-center items-center gap-2"
          >
            GUARDAR Y SEPARAR CUENTAS
          </button>
        </div>
      </div>

      {/* Lista de Cierres Históricos */}
      <div className="space-y-4 mt-12">
        <div className="flex justify-between items-center px-6">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Historial de Cierres</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kpis.cierresMes.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((c: any) => {
            const blockPrefix = c.unitId === 'SHOP' ? 'S' : 'R';
            const zNum = `Z${blockPrefix}-${c.date.replace(/-/g,'')}`;
            const fZ = data.facturas?.find((f: any) => f.num === zNum);
            const isConciliado = fZ && fZ.reconciled;
            const unitConfig = CASH_UNITS.find(u => u.id === (c.unitId || 'REST'));

            return (
              <div key={c.id} className={cn(
                "bg-white p-5 rounded-[2rem] border shadow-sm flex justify-between items-center group relative hover:shadow-md transition",
                isConciliado ? 'border-emerald-200' : 'border-slate-100'
              )}>
                <div>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest bg-slate-100 px-2 py-1 rounded-lg w-fit">{c.date}</p>
                    
                    {unitConfig && (
                      <span className={cn("text-[8px] font-black px-2 py-1 rounded uppercase flex items-center gap-1", unitConfig.bg, unitConfig.color)}>
                        <unitConfig.icon className="w-3 h-3" /> {unitConfig.name}
                      </span>
                    )}
                  </div>
                  
                  {c.unitId === 'REST' && (
                    <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 font-bold mt-2">
                      <span>💵 Ef: {Num.parse(c.efectivo).toFixed(0)}€</span>
                      <span>💳 Tj: {Num.parse(c.tarjeta).toFixed(0)}€</span>
                    </div>
                  )}
                  {c.descuadre !== 0 && c.unitId === 'REST' && (
                    <p className={cn("text-[9px] font-black uppercase mt-1", c.descuadre > 0 ? "text-emerald-500" : "text-rose-500")}>
                      Descuadre: {c.descuadre > 0 ? '+' : ''}{c.descuadre.toFixed(2)}€
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-black text-slate-900">{Num.parse(c.totalVenta).toFixed(2)}€</p>
                  <button 
                    onClick={() => handleDeleteCierre(c.id)} 
                    className="text-[8px] text-rose-400 font-bold uppercase hover:text-rose-600 opacity-0 group-hover:opacity-100 transition mt-2 flex items-center gap-1 ml-auto"
                  >
                    <Trash2 className="w-3 h-3" /> Borrar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
