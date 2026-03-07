import React, { useState, useMemo } from 'react';
import { 
  Calendar, ChevronLeft, ChevronRight, CreditCard, Banknote, 
  Truck, Sparkles, Plus, Trash2, CheckCircle2, Clock,
  AlertTriangle, RefreshCw, Image as ImageIcon, Scan, FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Cierre, Factura } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { NotificationService } from '../services/notifications';
import { GoogleGenAI } from "@google/genai";

interface CashViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const CashView = ({ data, onSave }: CashViewProps) => {
  const [currentFilterDate, setCurrentFilterDate] = useState(new Date().toISOString().slice(0, 7));
  const [scanStatus, setScanStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [images, setImages] = useState<{ img1: string | null, img2: string | null }>({ img1: null, img2: null });
  const [comparisonResult, setComparisonResult] = useState<{ match: boolean, diff?: string } | null>(null);

  // Form State
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    efectivo: '',
    tarjeta: '',
    glovo: '',
    uber: '',
    madisa: '',
    deliveroo: '',
    cajaFisica: '',
    notas: '',
    chkGastoCaja: false
  });

  const kpis = useMemo(() => {
    const cierresMes = (data.cierres || []).filter((c: any) => c.date && c.date.startsWith(currentFilterDate));
    const total = cierresMes.reduce((acc: number, c: any) => acc + (Num.parse(c.totalVenta) || 0), 0);
    const dias = cierresMes.length;
    const media = dias > 0 ? total / dias : 0;
    const efec = cierresMes.reduce((acc: number, c: any) => acc + (Num.parse(c.efectivo) || 0), 0);
    const tarj = cierresMes.reduce((acc: number, c: any) => acc + (Num.parse(c.tarjeta) || 0), 0);
    const apps = cierresMes.reduce((acc: number, c: any) => acc + (Num.parse(c.apps) || 0), 0);
    return { total, media, dias, efec, tarj, apps, cierresMes };
  }, [data.cierres, currentFilterDate]);

  const totalCalculado = useMemo(() => {
    return Num.parse(form.efectivo) + 
           Num.parse(form.tarjeta) + 
           Num.parse(form.glovo) + 
           Num.parse(form.uber) + 
           Num.parse(form.madisa) + 
           Num.parse(form.deliveroo);
  }, [form]);

  // 🚀 NUEVO: Descuadre en vivo antes de guardar
  const descuadreVivo = useMemo(() => {
    if (form.cajaFisica === '' || form.efectivo === '') return null;
    return Num.parse(form.cajaFisica) - (Num.parse(form.efectivo) + 300); // Asumiendo 300 de fondo
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
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImages(prev => ({ ...prev, [slot]: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const handleScan = async () => {
    if (!images.img1) return alert("Sube al menos la imagen del Ticket Z principal.");

    // 🚀 CORRECCIÓN: Leer la API key del localStorage como en el resto de la app
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      alert("⚠️ No tienes la clave de IA conectada. Ve a la configuración para añadirla.");
      return;
    }

    setScanStatus('loading');
    setComparisonResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const model = "gemini-2.5-flash"; // Usamos el estándar rápido y fiable

      const parts = [
        { text: `Analiza estas imágenes de tickets de cierre de caja. 
          Extrae los siguientes datos en formato JSON puro (sin markdown):
          {
            "fecha": "YYYY-MM-DD",
            "efectivo": 0.0,
            "tarjeta": 0.0,
            "glovo": 0.0,
            "uber": 0.0,
            "madisa": 0.0,
            "deliveroo": 0.0,
            "sobre_cash": 0.0,
            "gastos": 0.0,
            "comparacion_match": true/false,
            "diferencia_detalle": "explicación breve"
          }` 
        }
      ];

      if (images.img1) {
        parts.push({
          inlineData: {
            data: images.img1.split(',')[1],
            mimeType: "image/jpeg"
          }
        } as any);
      }

      if (images.img2) {
        parts.push({
          inlineData: {
            data: images.img2.split(',')[1],
            mimeType: "image/jpeg"
          }
        } as any);
      }

      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }]
      });

      const text = response.text?.replace(/```json/g, '').replace(/```/g, '').trim() || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const ia = JSON.parse(jsonMatch[0]);
        
        setForm(prev => ({
          ...prev,
          date: ia.fecha || prev.date,
          efectivo: ia.efectivo?.toString() || prev.efectivo,
          tarjeta: ia.tarjeta?.toString() || prev.tarjeta,
          glovo: ia.glovo?.toString() || "",
          uber: ia.uber?.toString() || "",
          madisa: ia.madisa?.toString() || "",
          deliveroo: ia.deliveroo?.toString() || "",
          cajaFisica: ia.sobre_cash ? (parseFloat(ia.sobre_cash) + 300).toFixed(2) : prev.cajaFisica,
          notas: ia.gastos > 0 ? `Gastos deducidos IA: ${ia.gastos}€. ${ia.diferencia_detalle || ''}` : (ia.diferencia_detalle || prev.notas),
          chkGastoCaja: ia.gastos > 0 ? true : prev.chkGastoCaja
        }));

        if (images.img2) {
          setComparisonResult({
            match: ia.comparacion_match,
            diff: ia.diferencia_detalle
          });
        }

        setScanStatus('success');
      } else {
        throw new Error("No se pudo parsear la respuesta de la IA");
      }
    } catch (error) {
      console.error("Error IA Scan:", error);
      setScanStatus('error');
      alert("⚠️ Error al analizar con IA. Revisa la calidad de la imagen.");
    } finally {
      setTimeout(() => setScanStatus('idle'), 5000);
    }
  };

  const handleSaveCierre = async () => {
    if (totalCalculado <= 0) return alert("El total calculado no puede ser cero.");
    if (form.efectivo !== '' && form.cajaFisica === '') return alert("Por favor, introduce el Dinero Real Físico para calcular el arqueo.");

    const newData = { ...data };
    const fechaSeleccionada = form.date;
    const descuadreFinal = descuadreVivo || 0;

    if (form.chkGastoCaja) {
      const concepto = prompt("¿Qué has pagado en efectivo hoy? (ej: Hielo, Pan):");
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
          reconciled: true, // Ya se cuenta como pagado y conciliado de la caja
          paid: true
        });
      }
    }

    const totalVentaVal = totalCalculado;
    const tarjetaVal = Num.parse(form.tarjeta);

    const cierreData: Cierre = {
      id: Date.now().toString(),
      date: fechaSeleccionada,
      totalVenta: totalVentaVal,
      efectivo: Num.parse(form.efectivo),
      tarjeta: tarjetaVal,
      apps: (Num.parse(form.glovo) + Num.parse(form.uber) + Num.parse(form.madisa) + Num.parse(form.deliveroo)),
      descuadre: descuadreFinal,
      notas: form.notas,
      conciliado_banco: false
    };

    if (!newData.cierres) newData.cierres = [];
    const idx = newData.cierres.findIndex((c: any) => c.date === fechaSeleccionada);
    if (idx >= 0) newData.cierres[idx] = cierreData;
    else newData.cierres.unshift(cierreData);

    // Notificar descuadre si es > 5€
    if (Math.abs(descuadreFinal) > 5) {
      await NotificationService.notifyCajaDescuadre(newData, fechaSeleccionada, descuadreFinal);
    }

    // Factura Z
    const zNum = `Z-${fechaSeleccionada.replace(/-/g, '')}`;
    if (!newData.facturas) newData.facturas = [];
    const fIdx = newData.facturas.findIndex((f: any) => f.num === zNum);

    const fZ: Factura = {
      id: fIdx >= 0 ? newData.facturas[fIdx].id : `z-${Date.now()}`,
      num: zNum,
      date: fechaSeleccionada,
      prov: "Z DIARIO",
      cliente: "Z DIARIO",
      total: totalVentaVal.toString(),
      base: Number((totalVentaVal / 1.10).toFixed(2)).toString(),
      tax: Number((totalVentaVal - (totalVentaVal / 1.10)).toFixed(2)).toString(),
      paid: fIdx >= 0 && newData.facturas[fIdx].reconciled ? true : false,
      reconciled: fIdx >= 0 && newData.facturas[fIdx].reconciled ? true : false
    };

    if (fIdx >= 0) newData.facturas[fIdx] = fZ;
    else newData.facturas.push(fZ);

    await onSave(newData);
    
    // Alerta a Telegram
    const msg = `💰 *CIERRE DE CAJA: ${fechaSeleccionada}*\n\n` +
      `📈 *Venta Total:* ${totalVentaVal.toFixed(2)}€\n` +
      `💳 Tarjeta: ${tarjetaVal.toFixed(2)}€\n` +
      `💵 Efectivo TPV: ${Num.parse(form.efectivo).toFixed(2)}€\n` +
      `⚖️ *Descuadre:* ${descuadreFinal > 0 ? '+' : ''}${descuadreFinal.toFixed(2)}€\n\n` +
      (form.notas ? `📝 _Notas: ${form.notas}_` : '');
    
    await NotificationService.sendAlert(newData, msg, 'INFO');
    
    // Limpiar formulario
    setForm({
        date: new Date().toISOString().split('T')[0],
        efectivo: '', tarjeta: '', glovo: '', uber: '', madisa: '', deliveroo: '',
        cajaFisica: '', notas: '', chkGastoCaja: false
    });
    setImages({ img1: null, img2: null });
    setComparisonResult(null);
  };

  const handleDeleteCierre = async (id: string) => {
    if (!confirm("¿Borrar cierre de caja y su Factura Z asociada?")) return;
    const newData = { ...data };
    const c = newData.cierres.find((x: any) => x.id === id);
    if (c) {
      const zNum = `Z-${c.date.replace(/-/g, '')}`;
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
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Control de Caja</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Vista Mensual</p>
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

      {/* Tarjetas KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Facturación {nombreMes}</p>
          <p className="text-4xl font-black mt-2">{kpis.total.toLocaleString('es-ES', {minimumFractionDigits: 0})}€</p>
          <p className="text-[10px] text-emerald-400 mt-1 font-bold">Media diaria: {kpis.media.toFixed(0)}€ ({kpis.dias} días)</p>
        </div>

        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
            <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> Tarjeta</span> 
            <span>{kpis.tarj.toLocaleString()}€</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-indigo-500" style={{ width: `${kpis.total > 0 ? (kpis.tarj/kpis.total)*100 : 0}%` }}></div>
          </div>
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
            <span className="flex items-center gap-1"><Banknote className="w-3 h-3" /> Efectivo</span> 
            <span>{kpis.efec.toLocaleString()}€</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${kpis.total > 0 ? (kpis.efec/kpis.total)*100 : 0}%` }}></div>
          </div>
        </div>

        <div className="bg-orange-50 p-6 rounded-[2.5rem] border border-orange-100 shadow-sm">
          <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">Delivery</p>
          <p className="text-3xl font-black text-orange-600 mt-2">{kpis.apps.toLocaleString()}€</p>
        </div>
      </div>

      {/* Lista de Cierres del Mes */}
      <div className="space-y-4 mt-4">
        <div className="flex justify-between items-center px-6">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Cierres de {nombreMes}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {kpis.cierresMes.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((c: any) => {
            const zNum = `Z-${c.date.replace(/-/g,'')}`;
            const fZ = data.facturas?.find((f: any) => f.num === zNum);
            const isConciliado = fZ && fZ.reconciled;

            return (
              <div key={c.id} className={cn(
                "bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm flex justify-between items-center group relative hover:shadow-md transition",
                isConciliado ? 'ring-2 ring-emerald-400' : 'ring-2 ring-rose-100'
              )}>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest bg-indigo-50 px-2 py-1 rounded-lg w-fit">{c.date}</p>
                    {isConciliado ? (
                      <span className="text-[8px] bg-emerald-100 text-emerald-700 font-black px-2 py-1 rounded flex items-center gap-1">
                        <CheckCircle2 className="w-2 h-2" /> BANCO OK
                      </span>
                    ) : (
                      <span className="text-[8px] bg-rose-50 text-rose-500 font-black px-2 py-1 rounded flex items-center gap-1">
                        <Clock className="w-2 h-2" /> FALTA BANCO
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500 font-bold">
                    <span>💵 {Num.parse(c.efectivo).toFixed(2)}€</span>
                    <span>💳 {Num.parse(c.tarjeta).toFixed(2)}€</span>
                  </div>
                  {c.notas && <p className="text-[9px] text-slate-400 italic mt-1 border-l-2 border-slate-200 pl-2">"{c.notas}"</p>}
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-slate-800">{Num.parse(c.totalVenta).toFixed(2)}€</p>
                  <button 
                    onClick={() => handleDeleteCierre(c.id)} 
                    className="text-[8px] text-rose-300 font-bold uppercase hover:text-rose-500 opacity-0 group-hover:opacity-100 transition mt-1 flex items-center gap-1 ml-auto"
                  >
                    <Trash2 className="w-2 h-2" /> Borrar
                  </button>
                </div>
              </div>
            );
          })}
          {kpis.cierresMes.length === 0 && (
            <div className="col-span-full text-center py-10 text-slate-300 italic text-sm">No hay cierres este mes.</div>
          )}
        </div>
      </div>

      {/* Formulario Nuevo Cierre Z */}
      <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100 relative overflow-hidden mt-8">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-emerald-400"></div>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h3 className="text-xl font-black text-slate-800">Nuevo Cierre Z</h3>
          
          <button 
            onClick={handleScan}
            disabled={scanStatus === 'loading' || !images.img1}
            className={cn(
              "bg-indigo-600 text-white px-6 py-3 rounded-2xl text-xs font-black hover:scale-105 transition cursor-pointer shadow-lg flex items-center gap-2",
              (scanStatus === 'loading' || !images.img1) && "opacity-50 pointer-events-none"
            )}
          >
            {scanStatus === 'loading' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 
             scanStatus === 'success' ? <CheckCircle2 className="w-4 h-4" /> : 
             scanStatus === 'error' ? <AlertTriangle className="w-4 h-4" /> : <Scan className="w-4 h-4" />}
            <span>{scanStatus === 'loading' ? 'ANALIZANDO...' : 'COMPARAR Y ESCANEAR (IA)'}</span>
          </button>
        </div>

        {/* Cajas de Imágenes */}
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
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <ImageIcon className="w-6 h-6 text-slate-300 mb-2" />
                  <p className="text-[9px] font-black text-slate-400 uppercase">Ticket Z Principal</p>
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
                  <p className="text-[9px] font-black text-slate-400 uppercase">Ticket TPV / Sobre (Opcional)</p>
                </div>
              )}
              <input type="file" onChange={(e) => handleImageUpload(e, 'img2')} className="hidden" accept="image/*" capture="environment" />
            </label>
          </div>
        </div>

        {/* Resultado de Comparación Visual */}
        <AnimatePresence>
          {comparisonResult && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={cn(
                "mb-8 p-4 rounded-2xl border flex items-center gap-3",
                comparisonResult.match ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-rose-50 border-rose-100 text-rose-700"
              )}
            >
              {comparisonResult.match ? <CheckCircle2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest">Resultado de Comparación IA</p>
                <p className="text-sm font-bold mt-1">{comparisonResult.match ? "¡Los tickets coinciden perfectamente!" : comparisonResult.diff}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Entradas de Datos */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Fecha y Caja</h4>
            <input 
              type="date" 
              value={form.date} 
              onChange={(e) => setForm({...form, date: e.target.value})}
              className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none"
            />
            <input 
              type="number" 
              placeholder="Efectivo Ticket Z" 
              value={form.efectivo}
              onChange={(e) => setForm({...form, efectivo: e.target.value})}
              className="w-full p-4 bg-slate-50 rounded-2xl text-lg font-black outline-none"
            />
          </div>
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Bancos y Apps</h4>
            <input 
              type="number" 
              placeholder="Tarjeta TPV" 
              value={form.tarjeta}
              onChange={(e) => setForm({...form, tarjeta: e.target.value})}
              className="w-full p-4 bg-slate-50 rounded-2xl text-lg font-black outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <input 
                type="number" placeholder="Glovo" value={form.glovo}
                onChange={(e) => setForm({...form, glovo: e.target.value})}
                className="p-3 bg-orange-50/50 rounded-xl font-bold text-sm outline-none"
              />
              <input 
                type="number" placeholder="Uber" value={form.uber}
                onChange={(e) => setForm({...form, uber: e.target.value})}
                className="p-3 bg-indigo-50/50 rounded-xl font-bold text-sm outline-none"
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
          </div>
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">3. Arqueo Físico</h4>
            <div>
              <input 
                type="number" 
                placeholder="Dinero Físico en la Caja" 
                value={form.cajaFisica}
                onChange={(e) => setForm({...form, cajaFisica: e.target.value})}
                className={cn(
                  "w-full p-4 rounded-2xl text-2xl font-black outline-none transition-colors",
                  descuadreVivo !== null && descuadreVivo !== 0 ? "bg-rose-900 text-white" : "bg-slate-900 text-emerald-400"
                )}
              />
              {/* 🚀 INDICADOR DE DESCUADRE EN VIVO */}
              {descuadreVivo !== null && (
                <div className={cn(
                  "mt-2 text-xs font-black flex items-center gap-1",
                  descuadreVivo === 0 ? "text-emerald-500" : "text-rose-500"
                )}>
                  {descuadreVivo === 0 ? (
                    <><CheckCircle2 className="w-3 h-3" /> LA CAJA CUADRA PERFECTA</>
                  ) : descuadreVivo > 0 ? (
                    <><AlertTriangle className="w-3 h-3" /> SOBRAN {descuadreVivo.toFixed(2)}€</>
                  ) : (
                    <><AlertTriangle className="w-3 h-3" /> FALTAN {Math.abs(descuadreVivo).toFixed(2)}€</>
                  )}
                </div>
              )}
            </div>
            <input 
              type="text" 
              placeholder="Notas u observaciones..." 
              value={form.notas}
              onChange={(e) => setForm({...form, notas: e.target.value})}
              className="w-full p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none"
            />
            <div className="text-right">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Total Ingresos Calculado</span>
              <span className="text-3xl font-black text-indigo-600 tracking-tighter">{totalCalculado.toFixed(2)}€</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-6 border-t border-slate-100 pt-6">
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 rounded-2xl border border-amber-100 w-fit">
            <input 
              type="checkbox" 
              id="chkGastoCaja" 
              checked={form.chkGastoCaja}
              onChange={(e) => setForm({...form, chkGastoCaja: e.target.checked})}
              className="w-5 h-5 accent-amber-500 cursor-pointer"
            />
            <label htmlFor="chkGastoCaja" className="text-[10px] font-black text-amber-700 uppercase cursor-pointer">¿Pagos realizados con efectivo de la caja?</label>
          </div>
          <button 
            onClick={handleSaveCierre}
            className="w-full py-5 bg-slate-900 text-white rounded-[2rem] font-black text-sm shadow-2xl hover:bg-indigo-600 transition-all active:scale-95 flex justify-center items-center gap-2"
          >
            REGISTRAR CIERRE Z DEFINITIVO
          </button>
        </div>
      </div>
    </div>
  );
};
