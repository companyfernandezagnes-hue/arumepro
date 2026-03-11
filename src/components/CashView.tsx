import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { 
  ChevronLeft, ChevronRight, CreditCard, Banknote, Truck, Sparkles, 
  Trash2, CheckCircle2, Clock, AlertTriangle, RefreshCw, Image as ImageIcon, 
  Scan, Building2, ShoppingBag, Layers, SplitSquareHorizontal, Mic, Square, Plus, Download, XCircle, FileArchive
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { AppData, Cierre, Factura } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { GoogleGenAI } from "@google/genai";
import { CashHistoryList } from './CashHistoryList';

export type CashBusinessUnit = 'REST' | 'SHOP';

export const CASH_UNITS: { id: CashBusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' }
];

/* =======================================================
 * 🛡️ CONFIGURACIÓN DE COMISIONES (Actualizado)
 * ======================================================= */
const COMISIONES = { 
  glovo: 0.30,       // 30%
  uber: 0.30,        // 30%
  apperStreet: 0.0,  // 0%
  madisa: 0.0        // 0%
};

interface CashViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

/* =======================================================
 * 🛡️ UTILIDADES SEGURAS (Mejoras Auditoría)
 * ======================================================= */
const asNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const getSafeDate = () => new Date().toLocaleDateString('sv-SE');

const safeJSON = (str: string) => {
  try {
    const match = str.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch {
    return {};
  }
};

const compressImageToBase64 = async (file: File | Blob): Promise<string> => {
  const bmp = await createImageBitmap(file);
  const cvs = document.createElement('canvas');
  const r = Math.min(1200 / bmp.width, 1200 / bmp.height, 1);
  cvs.width = bmp.width * r; cvs.height = bmp.height * r;
  cvs.getContext('2d')?.drawImage(bmp, 0, 0, cvs.width, cvs.height);
  return cvs.toDataURL('image/jpeg', 0.75).split(',')[1];
};

function upsertFactura(list: any[], item: any, key: string = 'num') {
  const idx = list.findIndex(x => x[key] === item[key]);
  if (idx >= 0) list[idx] = { ...list[idx], ...item }; else list.push(item);
}

/* =======================================================
 * 🧠 HOOK: CÁLCULOS FINANCIEROS NETOS
 * ======================================================= */
function useCashCalculations(form: any, fondoCaja: number) {
  const totalTarjetas = useMemo(() => Num.parse(form.tpv1) + Num.parse(form.tpv2) + Num.parse(form.amex), [form.tpv1, form.tpv2, form.amex]);
  
  const appsBrutas = useMemo(() => Num.parse(form.glovo) + Num.parse(form.uber) + Num.parse(form.madisa) + Num.parse(form.apperStreet), [form.glovo, form.uber, form.madisa, form.apperStreet]);
  
  const appsNetas = useMemo(() => {
    const g = Num.parse(form.glovo) * (1 - COMISIONES.glovo);
    const u = Num.parse(form.uber) * (1 - COMISIONES.uber);
    const m = Num.parse(form.madisa) * (1 - COMISIONES.madisa);
    const a = Num.parse(form.apperStreet) * (1 - COMISIONES.apperStreet);
    return Num.round2(g + u + m + a);
  }, [form.glovo, form.uber, form.madisa, form.apperStreet]);

  const totalCalculadoBruto = useMemo(() => Num.parse(form.efectivo) + totalTarjetas + appsBrutas, [form.efectivo, totalTarjetas, appsBrutas]);
  const totalTienda = useMemo(() => Num.parse(form.tienda), [form.tienda]);
  const totalRestauranteNeto = useMemo(() => (Num.parse(form.efectivo) + totalTarjetas + appsNetas) - totalTienda, [form.efectivo, totalTarjetas, appsNetas, totalTienda]);

  const descuadreVivo = useMemo(() => {
    if (form.cajaFisica === '' || form.efectivo === '') return null;
    return Num.round2(Num.parse(form.cajaFisica) - (Num.parse(form.efectivo) + fondoCaja));
  }, [form.cajaFisica, form.efectivo, fondoCaja]);

  return { totalTarjetas, appsBrutas, appsNetas, totalCalculadoBruto, totalRestauranteNeto, descuadreVivo };
}

/* =======================================================
 * 🏦 COMPONENTE PRINCIPAL: CASH VIEW
 * ======================================================= */
export const CashView = ({ data, onSave }: CashViewProps) => {
  const [currentFilterDate, setCurrentFilterDate] = useState(getSafeDate().slice(0, 7));
  const [selectedUnit, setSelectedUnit] = useState<CashBusinessUnit | 'ALL'>('ALL'); 
  const [scanStatus, setScanStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [images, setImages] = useState<{ img1: string | null }>({ img1: null });
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportQuarter, setExportQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [exportYear, setExportYear] = useState(new Date().getFullYear());

  const [form, setForm] = useState({
    date: getSafeDate(), efectivo: '', tpv1: '', tpv2: '', amex: '', 
    glovo: '', uber: '', madisa: '', apperStreet: '',
    cajaFisica: '', tienda: '', notas: ''
  });

  const [fondoCaja, setFondoCaja] = useState<number>(300); // El cambio fijo del sobre
  const [depositoBanco, setDepositoBanco] = useState<string>(''); 
  const [gastosCaja, setGastosCaja] = useState<{ concepto: string; importe: string; iva: 4|10|21; unidad: CashBusinessUnit }[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const calc = useCashCalculations(form, fondoCaja);

  // 🎙️ ESTADOS IA VOZ Y VOSK
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState(''); 
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechRecRef = useRef<any>(null);
  const nativeTranscriptRef = useRef<string>('');

  const kpis = useMemo(() => {
    const cierresMes = (data.cierres || []).filter(c => c.date.startsWith(currentFilterDate));
    const total = cierresMes.reduce((acc, c) => acc + (Num.parse(c.totalVenta) || 0), 0);
    return { 
        total, cierresMes, 
        tarj: cierresMes.reduce((a,c)=>a+Num.parse(c.tarjeta), 0), 
        efec: cierresMes.reduce((a,c)=>a+Num.parse(c.efectivo), 0),
        apps: cierresMes.reduce((a,c)=>a+Num.parse(c.apps), 0)
    };
  }, [data.cierres, currentFilterDate]);

  const handleMonthChange = (offset: number) => {
    let [y, m] = currentFilterDate.split('-').map(Number); m += offset;
    if (m === 0) { m = 12; y--; } if (m === 13) { m = 1; y++; }
    setCurrentFilterDate(`${y}-${String(m).padStart(2, '0')}`);
  };

  /* =======================================================
   * 🤖 MOTOR DE IA DUAL + COMANDOS DE VOZ EN VIVO
   * ======================================================= */
  
  // Extrae números basándose en una palabra clave ("efectivo 300" -> 300)
  const extractVoiceCommand = (text: string, keyword: string) => {
    const regex = new RegExp(`${keyword}\\s*(\\d+(?:[,.]\\d+)?)`, 'i');
    const match = text.match(regex);
    return match ? match[1].replace(',', '.') : null;
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      if (speechRecRef.current) speechRecRef.current.stop();
      setIsRecording(false);
      const textoHablado = nativeTranscriptRef.current.trim();
      if (textoHablado) {
        setForm(prev => ({ ...prev, notas: prev.notas + "\n🎤 " + textoHablado }));
      }
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      nativeTranscriptRef.current = ''; setLiveTranscript('');
      
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'es-ES'; recognition.continuous = true; recognition.interimResults = true;
        recognition.onresult = (e: any) => { 
          const text = Array.from(e.results).map((r: any) => r[0].transcript).join('');
          nativeTranscriptRef.current = text;
          setLiveTranscript(text); 

          // 🔥 MAGIA: Autocompletado en Vivo
          const efec = extractVoiceCommand(text, 'efectivo');
          const tpv1 = extractVoiceCommand(text, 'tpv 1|tpv uno|datáfono uno');
          const glovo = extractVoiceCommand(text, 'glovo');
          const uber = extractVoiceCommand(text, 'uber');
          const fisico = extractVoiceCommand(text, 'caja física|físico|sobre');

          setForm(prev => ({
            ...prev,
            efectivo: efec || prev.efectivo,
            tpv1: tpv1 || prev.tpv1,
            glovo: glovo || prev.glovo,
            uber: uber || prev.uber,
            cajaFisica: fisico || prev.cajaFisica
          }));
        };
        speechRecRef.current = recognition; recognition.start();
      }

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr; audioChunksRef.current = [];
      mr.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mr.mimeType });
        stream.getTracks().forEach(t => t.stop());
        await processAudioWithAI(audioBlob, mr.mimeType);
      };
      mr.start(); setIsRecording(true);
      setTimeout(() => { if (mr.state === 'recording') toggleRecording(); }, 60000); // 1 min max
    } catch (err) { alert("Error al acceder al micrófono."); }
  };

  const processAudioWithAI = async (blob: Blob, mime: string) => {
    setScanStatus('loading');
    const apiKey = localStorage.getItem('gemini_api_key');
    
    try {
      if (!apiKey) throw new Error("No API Key");
      
      const b64 = await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res((fr.result as string).split(',')[1]); fr.readAsDataURL(blob); });
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Transcribe y extrae. Devuelve SOLO JSON estricto: { "efectivo":0, "tpv1":0, "tpv2":0, "amex":0, "glovo":0, "uber":0, "apperStreet":0, "sobre_cash":0, "tienda":0 }`;
      
      const response = await ai.models.generateContent({ 
        model: "gemini-2.5-flash", 
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: b64, mimeType: mime.includes('webm') ? 'audio/webm' : 'audio/mp4' } }] }], 
        config: { responseMimeType: "application/json", temperature: 0.1 } 
      });
      
      const dataIA = safeJSON(response.text || "");
      actualizarFormConIA(dataIA);
      setScanStatus('success');

    } catch (e) {
      console.warn("⚠️ Gemini Falló. Activando VOSK Local...");
      try {
        const formData = new FormData();
        formData.append("file", blob, "audio.webm");
        const voskUrl = "http://localhost:2700/transcribe"; 
        const voskRes = await fetch(voskUrl, { method: "POST", body: formData });
        if (!voskRes.ok) throw new Error("Vosk no responde");
        
        const voskData = await voskRes.json();
        setForm(prev => ({ ...prev, notas: prev.notas + "\n🤖 [VOSK]: " + (voskData.text || "") }));
        setScanStatus('success');
      } catch (voskErr) {
        setScanStatus('error');
      }
    } finally { setTimeout(() => setScanStatus('idle'), 4000); }
  };

  // 📷 OCR DE TICKET Z
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("Conecta la IA en Ajustes.");
    setScanStatus('loading');
    try {
      const objUrl = URL.createObjectURL(file); setImages({ img1: objUrl });
      const b64 = await compressImageToBase64(file);
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Extrae este ticket Z. Devuelve SOLO JSON: {"fecha":"YYYY-MM-DD", "efectivo":0, "tpv1":0, "tpv2":0, "amex":0}`;
      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: b64, mimeType: "image/jpeg" } }] }], config: { responseMimeType: "application/json", temperature: 0.1 } });
      const json = safeJSON(response.text || "");
      actualizarFormConIA(json);
      setScanStatus('success');
    } catch (e) { setScanStatus('error'); } finally { setTimeout(() => setScanStatus('idle'), 3000); }
  };

  const actualizarFormConIA = useCallback((rawJson: any) => {
    setForm(prev => ({
      ...prev, 
      date: rawJson.fecha ? rawJson.fecha : prev.date,
      efectivo: String(asNum(rawJson.efectivo) || prev.efectivo), 
      tpv1: String(asNum(rawJson.tpv1) || prev.tpv1),
      tpv2: String(asNum(rawJson.tpv2) || prev.tpv2), 
      amex: String(asNum(rawJson.amex) || prev.amex),
      glovo: String(asNum(rawJson.glovo) || prev.glovo), 
      uber: String(asNum(rawJson.uber) || prev.uber),
      apperStreet: String(asNum(rawJson.apperStreet) || prev.apperStreet), 
      tienda: String(asNum(rawJson.venta_tienda || rawJson.tienda) || prev.tienda),
      cajaFisica: asNum(rawJson.sobre_cash) > 0 ? (asNum(rawJson.sobre_cash) + fondoCaja).toFixed(2) : prev.cajaFisica
    }));
  }, [fondoCaja]);

  // 💾 GUARDADO BLINDADO
  const handleSaveCierre = async () => {
    if (isSaving) return;
    if (calc.totalCalculadoBruto <= 0) return alert("Introduce algún importe para guardar la caja.");
    setIsSaving(true);
    try {
      const newData = JSON.parse(JSON.stringify(data)); 
      const fecha = form.date;
      const cierreId = `ZR-${fecha.replace(/-/g, '')}`;

      if (!newData.cierres) newData.cierres = []; 
      if (!newData.facturas) newData.facturas = []; 
      if (!newData.banco) newData.banco = [];

      // 1. Gastos de caja
      gastosCaja.forEach((g, idx) => {
        const imp = Num.parse(g.importe); const base = Num.round2(imp / (1 + g.iva / 100));
        newData.facturas.unshift({
            id: `gc-${Date.now()}-${idx}`, tipo: 'caja', num: `GC-${fecha}-${idx}`,
            date: fecha, prov: g.concepto.toUpperCase(), total: imp, base, tax: imp - base,
            paid: true, reconciled: true, unidad_negocio: g.unidad
        });
      });

      // 2. Ingreso a banco
      if (Num.parse(depositoBanco) > 0) {
        newData.banco.unshift({ id: `dep-${Date.now()}`, date: fecha, desc: "Ingreso efectivo caja", amount: Num.parse(depositoBanco), status: "pending" });
      }

      // 3. Cierre Restaurante (El Z)
      const cierreRest: Cierre = {
        id: cierreId, date: fecha, totalVenta: calc.totalRestauranteNeto,
        efectivo: Num.parse(form.efectivo), tarjeta: calc.totalTarjetas, apps: calc.appsNetas,
        descuadre: calc.descuadreVivo || 0, notas: form.notas, unitId: 'REST'
      };
      upsertFactura(newData.cierres, cierreRest, 'id');
      
      upsertFactura(newData.facturas, { 
          id: `f-zr-${fecha}`, tipo: 'caja', num: cierreId, date: fecha, 
          prov: "Z DIARIO", total: calc.totalRestauranteNeto, paid: false, reconciled: false, unidad_negocio: 'REST' 
      }, 'num');

      // 4. Cierre Tienda Sake
      if (Num.parse(form.tienda) > 0) {
        const shopId = `ZS-${fecha.replace(/-/g, '')}`;
        upsertFactura(newData.cierres, { id: shopId, date: fecha, totalVenta: Num.parse(form.tienda), efectivo: 0, tarjeta: 0, apps: 0, descuadre: 0, notas: 'Venta separada', unitId: 'SHOP' }, 'id');
        upsertFactura(newData.facturas, { id: `f-zs-${fecha}`, tipo: 'caja', num: shopId, date: fecha, prov: "Z DIARIO", total: Num.parse(form.tienda), paid: false, reconciled: false, unidad_negocio: 'SHOP' }, 'num');
      }

      await onSave(newData);
      alert("✅ Caja de hoy comprobada y cerrada con éxito.");
      setForm({ date: getSafeDate(), efectivo: '', tpv1: '', tpv2: '', amex: '', glovo: '', uber: '', madisa: '', apperStreet: '', cajaFisica: '', tienda: '', notas: '' });
      setImages({ img1: null }); setGastosCaja([]); setDepositoBanco('');
    } catch (e) { alert("Error crítico al guardar."); }
    finally { setIsSaving(false); }
  };

  const handleDeleteCierre = async (id: string) => {
    if (!window.confirm("¿Borrar permanentemente este cierre?")) return;
    const newData = { ...data }; 
    newData.facturas = (newData.facturas || []).filter((f: any) => f.num !== id); 
    newData.cierres = (newData.cierres || []).filter((x: any) => x.id !== id); 
    await onSave(newData); 
  };

  const handleExportGestoria = () => {
    const rows = (data.cierres || []).filter(c => c.date.startsWith(exportYear.toString())).map(c => ({ 
      'FECHA': c.date, 'UNIDAD': c.unitId, 'TOTAL VENTA NETO': Num.fmt(c.totalVenta), 
      'EFECTIVO TICKET': Num.fmt(c.efectivo), 'DESCUADRE FISICO SOBRE': Num.fmt(c.descuadre) 
    }));
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); 
    XLSX.utils.book_append_sheet(wb, ws, "Cierres_Caja"); XLSX.writeFile(wb, `Cierres_Arume_${exportYear}.xlsx`); 
    setIsExportModalOpen(false);
  };

  const [yearStr, monthStr] = currentFilterDate.split('-');
  const nombreMes = new Date(Number(yearStr), Number(monthStr) - 1).toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();

  return (
    <div className={cn("animate-fade-in space-y-6 pb-24", scanStatus === 'loading' && "transition-none")}>
      
      {/* 🚀 OVERLAY GRABACIÓN VOZ EN VIVO */}
      <AnimatePresence>
        {isRecording && (
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }} className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] w-11/12 max-w-md bg-slate-900 text-white p-4 rounded-3xl shadow-2xl border-2 border-indigo-500 cursor-pointer flex flex-col items-center gap-2" onClick={toggleRecording}>
            <div className="flex items-center gap-3"><div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse"></div><span className="text-xs font-black uppercase tracking-widest">Escuchando... (Toca para parar)</span></div>
            <p className="text-xs text-slate-300 text-center italic line-clamp-3 w-full">{liveTranscript || "Di 'Efectivo 300' o 'Glovo 50'..."}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
        <div>
           <h2 className="text-xl font-black text-slate-800">Caja y Arqueo (Sobres)</h2>
           <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1 flex items-center gap-1"><SplitSquareHorizontal className="w-3 h-3" /> Inteligencia Arume Pro</p>
        </div>
        <div className="flex gap-2 bg-slate-100 p-1.5 rounded-2xl">
           <button onClick={() => handleMonthChange(-1)} className="p-2 hover:bg-white rounded-xl transition text-slate-600"><ChevronLeft className="w-5 h-5"/></button>
           <input type="month" value={currentFilterDate} onChange={e => setCurrentFilterDate(e.target.value)} className="bg-transparent font-bold text-sm outline-none w-32 text-center"/>
           <button onClick={() => handleMonthChange(1)} className="p-2 hover:bg-white rounded-xl transition text-slate-600"><ChevronRight className="w-5 h-5"/></button>
        </div>
      </header>

      {/* KPIs & EXPORT */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSelectedUnit('ALL')} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase border flex gap-1.5 items-center", selectedUnit === 'ALL' ? "bg-slate-900 text-white" : "bg-white text-slate-400")}><Layers className="w-3 h-3"/> Consolidado</button>
          {CASH_UNITS.map(u => <button key={u.id} onClick={() => setSelectedUnit(u.id)} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase border flex gap-1.5 items-center", selectedUnit === u.id ? "bg-indigo-600 text-white" : "bg-white text-slate-400")}><u.icon className="w-3 h-3"/> {u.name}</button>)}
        </div>
        <button onClick={() => setIsExportModalOpen(true)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:bg-emerald-700 transition flex items-center gap-2"><Download className="w-4 h-4"/> EXPORTAR GESTORÍA</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl"><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Facturación {nombreMes}</p><p className="text-4xl font-black mt-2">{kpis.total.toLocaleString()}€</p></div>
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1"><span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> Tarjeta</span> <span>{kpis.tarj.toLocaleString()}€</span></div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-2"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${kpis.total > 0 ? (kpis.tarj/kpis.total)*100 : 0}%` }}></div></div>
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1"><span className="flex items-center gap-1"><Banknote className="w-3 h-3" /> Efectivo</span> <span>{kpis.efec.toLocaleString()}€</span></div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${kpis.total > 0 ? (kpis.efec/kpis.total)*100 : 0}%` }}></div></div>
        </div>
        <div className="bg-orange-50 p-6 rounded-[2.5rem] border border-orange-100 shadow-sm flex flex-col justify-center items-start"><Truck className="w-6 h-6 text-orange-300 mb-2" /><p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">Apps Delivery</p><p className="text-3xl font-black text-orange-600 mt-1">{kpis.apps.toLocaleString()}€</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-emerald-400" />
            
            <div className="flex justify-between items-center mb-8">
               <h3 className="font-black text-slate-700 flex items-center gap-2"><Scan className="w-5 h-5 text-indigo-500"/> Comprobación del Sobre</h3>
               <div className="flex gap-2">
                  <label className="cursor-pointer bg-slate-100 p-2.5 rounded-xl hover:bg-indigo-50 transition border border-slate-200">
                    {scanStatus === 'loading' ? <RefreshCw className="w-4 h-4 animate-spin text-indigo-600"/> : <ImageIcon className="w-4 h-4 text-slate-600"/>}
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                  </label>
                  <button onClick={toggleRecording} className={cn("px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 transition shadow-md", isRecording ? "bg-red-500 text-white" : "bg-slate-900 text-white")}>
                    {isRecording ? <Square className="w-3 h-3"/> : <Mic className="w-3 h-3"/>} {isRecording ? "PARAR" : "DICTAR IA"}
                  </button>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Efectivo Marcado por TPV</label>
                  <div className="bg-slate-50 p-5 rounded-3xl border border-slate-200">
                    <span className="text-[9px] font-bold text-slate-500 block mb-1">EFECTIVO TICKET Z</span>
                    <input type="number" value={form.efectivo} onChange={e => setForm({...form, efectivo: e.target.value})} className="w-full bg-transparent text-3xl font-black outline-none text-slate-700" placeholder="0.00"/>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                     <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <span className="text-[8px] font-bold text-slate-400 block mb-1">TPV 1</span>
                        <input type="number" value={form.tpv1} onChange={e=>setForm({...form, tpv1:e.target.value})} className="w-full bg-transparent font-black text-slate-700 outline-none" />
                     </div>
                     <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <span className="text-[8px] font-bold text-slate-400 block mb-1">TPV 2</span>
                        <input type="number" value={form.tpv2} onChange={e=>setForm({...form, tpv2:e.target.value})} className="w-full bg-transparent font-black text-slate-700 outline-none" />
                     </div>
                  </div>
               </div>

               <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Efectivo Real en Sobre</label>
                  <div className="bg-slate-900 p-5 rounded-3xl shadow-lg">
                    <span className="text-[9px] font-bold text-slate-500 block mb-1">DINERO TOTAL (Billetes y Monedas)</span>
                    <input type="number" value={form.cajaFisica} onChange={e => setForm({...form, cajaFisica: e.target.value})} className="w-full bg-transparent text-3xl font-black outline-none text-emerald-400" placeholder="0.00"/>
                  </div>
                  <AnimatePresence>
                  {calc.descuadreVivo !== null && (
                    <motion.div initial={{opacity:0}} animate={{opacity:1}} className={cn("p-4 rounded-2xl text-[10px] font-black flex items-center justify-between", Math.abs(calc.descuadreVivo) <= 2 ? "bg-emerald-500 text-white" : "bg-rose-500 text-white")}>
                      <span>DESCUADRE (Fondo {fondoCaja}€):</span>
                      <span className="text-lg">{calc.descuadreVivo > 0 ? '+' : ''}{calc.descuadreVivo}€</span>
                    </motion.div>
                  )}
                  </AnimatePresence>
               </div>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-orange-50 rounded-2xl border border-orange-100">
                    <label className="text-[9px] font-black text-orange-600 block mb-1">DESVÍO TIENDA SAKE</label>
                    <input type="number" value={form.tienda} onChange={e => setForm({...form, tienda: e.target.value})} className="w-full bg-transparent text-xl font-black outline-none text-orange-700" placeholder="0.00"/>
                </div>
                <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                    <label className="text-[9px] font-black text-blue-600 block mb-1">INGRESO A BANCO DESDE SOBRE</label>
                    <input type="number" value={depositoBanco} onChange={e => setDepositoBanco(e.target.value)} className="w-full bg-transparent text-xl font-black outline-none text-blue-700" placeholder="0.00"/>
                </div>
            </div>

            {/* SECCIÓN DELIVERIES */}
            <div className="mt-6 border-t border-slate-100 pt-6">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">3. Apps Delivery (Cálculo Neto)</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-orange-50/50 p-2 rounded-xl border border-orange-100">
                  <span className="text-[8px] font-bold text-orange-400 block mb-1">GLOVO (-30%)</span>
                  <input type="number" value={form.glovo} onChange={e=>setForm({...form, glovo:e.target.value})} className="w-full bg-transparent font-black text-orange-700 outline-none" placeholder="Bruto" />
                </div>
                <div className="bg-indigo-50/50 p-2 rounded-xl border border-indigo-100">
                  <span className="text-[8px] font-bold text-indigo-400 block mb-1">UBER (-30%)</span>
                  <input type="number" value={form.uber} onChange={e=>setForm({...form, uber:e.target.value})} className="w-full bg-transparent font-black text-indigo-700 outline-none" placeholder="Bruto" />
                </div>
                <div className="bg-teal-50/50 p-2 rounded-xl border border-teal-100">
                  <span className="text-[8px] font-bold text-teal-400 block mb-1">APPERSTREET (-0%)</span>
                  <input type="number" value={form.apperStreet} onChange={e=>setForm({...form, apperStreet:e.target.value})} className="w-full bg-transparent font-black text-teal-700 outline-none" placeholder="Bruto" />
                </div>
                <div className="bg-rose-50/50 p-2 rounded-xl border border-rose-100">
                  <span className="text-[8px] font-bold text-rose-400 block mb-1">MADISA (-0%)</span>
                  <input type="number" value={form.madisa} onChange={e=>setForm({...form, madisa:e.target.value})} className="w-full bg-transparent font-black text-rose-700 outline-none" placeholder="Bruto" />
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-6">
              <p className="text-[10px] font-black text-amber-500 uppercase mb-3">4. Gastos Pagados con Dinero del Sobre</p>
              <GastoCajaEditor gastos={gastosCaja} onAdd={(g) => setGastosCaja(prev => [...prev, g])} onDelete={(i) => setGastosCaja(prev => prev.filter((_,idx) => idx !== i))} />
            </div>

            <div className="mt-8 relative">
               <textarea value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} className="w-full p-5 bg-slate-50 rounded-[2rem] text-xs min-h-[120px] outline-none border border-slate-100 focus:bg-white transition-all" placeholder="Escribe o dicta notas del día..."/>
               {form.notas && <button onClick={() => setForm({...form, notas: ''})} className="absolute top-5 right-5 text-slate-300 hover:text-rose-500 transition-colors"><XCircle className="w-6 h-6"/></button>}
            </div>

            <button onClick={handleSaveCierre} disabled={isSaving} className="w-full mt-8 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-base shadow-2xl hover:bg-indigo-600 transition-all transform active:scale-95 disabled:opacity-50">
               {isSaving ? "PROCESANDO CIERRE..." : `CUADRAR CAJA (${calc.totalRestauranteNeto.toFixed(2)}€ NETOS)`}
            </button>
          </div>
        </div>

        <div className="space-y-6">
           <CashHistoryList 
             cierres={kpis.cierresMes} 
             onDelete={handleDeleteCierre} 
           />
        </div>
      </div>
      
      {/* MODAL EXPORT GESTORÍA */}
      <AnimatePresence>
        {isExportModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white p-10 rounded-[3rem] w-full max-w-xs text-center">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6"><FileArchive className="w-8 h-8"/></div>
              <h3 className="font-black text-2xl mb-2 text-slate-800">Exportar Excel</h3>
              <p className="text-xs text-slate-400 mb-8 font-bold uppercase tracking-widest">Listado para Gestoría</p>
              <button onClick={handleExportGestoria} className="w-full py-5 bg-emerald-600 text-white rounded-2xl font-black shadow-xl hover:bg-emerald-700 transition active:scale-95">DESCARGAR AHORA</button>
              <button onClick={() => setIsExportModalOpen(false)} className="w-full mt-4 text-xs font-black text-slate-300 hover:text-slate-500 transition uppercase tracking-widest">Cerrar</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// EDITOR DE GASTOS SECUNDARIO
function GastoCajaEditor({ gastos, onAdd, onDelete }: { gastos: any[]; onAdd: (g: any) => void; onDelete: (i: number) => void; }) {
  const [row, setRow] = useState({ concepto: '', importe: '', iva: 10 as 4|10|21, unidad: 'REST' as CashBusinessUnit });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input value={row.concepto} onChange={(e)=>setRow({...row, concepto: e.target.value})} placeholder="Ej: Pan, Hielo..." className="md:col-span-2 p-3 rounded-xl bg-slate-50 text-xs font-bold border-none outline-none focus:ring-2 ring-amber-200" />
        <input value={row.importe} onChange={(e)=>setRow({...row, importe: e.target.value})} placeholder="0.00 €" type="number" className="p-3 rounded-xl bg-slate-50 text-xs font-black border-none outline-none focus:ring-2 ring-amber-200" />
        <select value={row.iva} onChange={(e)=>setRow({...row, iva: Number(e.target.value) as 4|10|21})} className="p-3 rounded-xl bg-slate-50 text-xs font-bold border-none outline-none">
          <option value={4}>4%</option><option value={10}>10%</option><option value={21}>21%</option>
        </select>
        <button onClick={() => { if (!row.concepto || !row.importe) return; onAdd(row); setRow({ concepto: '', importe: '', iva: 10, unidad: 'REST' }); }} className="p-3 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase hover:bg-amber-600 transition shadow-md flex items-center justify-center"><Plus className="w-5 h-5"/></button>
      </div>
      {gastos.length > 0 && (
        <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
          {gastos.map((g,i)=>(
            <motion.div initial={{x:-10, opacity:0}} animate={{x:0, opacity:1}} key={i} className="text-xs flex justify-between items-center bg-white rounded-xl px-4 py-3 border border-amber-100 shadow-sm">
              <span className="font-bold text-slate-600 uppercase text-[10px]">{g.concepto} <span className="text-slate-300 ml-2">({g.iva}%)</span></span>
              <div className="flex items-center gap-4">
                <span className="font-black text-amber-600">{Number(g.importe).toFixed(2)}€</span>
                <button onClick={()=>onDelete(i)} className="text-rose-300 hover:text-rose-500"><Trash2 className="w-4 h-4"/></button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
