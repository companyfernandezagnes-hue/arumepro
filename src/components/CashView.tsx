import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  ChevronLeft, ChevronRight, CreditCard, Banknote, Truck, Sparkles, 
  Trash2, CheckCircle2, Clock, AlertTriangle, RefreshCw, Image as ImageIcon, 
  Scan, Building2, ShoppingBag, Layers, SplitSquareHorizontal, Mic, Square, Plus, Download, XCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'framer-motion';
import { AppData, Cierre, Factura } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { GoogleGenAI } from "@google/genai";
import { CashHistoryList } from '../components/CashHistoryList';

export type CashBusinessUnit = 'REST' | 'SHOP';

export const CASH_UNITS: { id: CashBusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' }
];

const COMISIONES = { glovo: 0.0, uber: 0.0, apperStreet: 0.0, madisa: 0.0 };

interface CashViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

// --- UTILIDADES ---
const asNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const normalizeDate = (s?: string) => {
  const v = String(s ?? '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : DateUtil.today(); 
};

const extractJSON = (rawText: string) => {
  try {
    if (!rawText) throw new Error("Respuesta vacía");
    const clean = rawText.replace(/(?:json)?/gi, '').replace(/\uFEFF/g, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{'); const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error("No se detectó JSON");
    return JSON.parse(clean.substring(start, end + 1));
  } catch (err) { return {}; }
};

const compressImageToBase64 = async (file: File | Blob): Promise<string> => {
  const MAX_W = 1200, MAX_H = 1200; const Q1 = 0.72, Q2 = 0.6; const MAX_BYTES = 2.5 * 1024 * 1024;
  const bmp = await createImageBitmap(file); let { width: w, height: h } = bmp;
  const r = Math.min(MAX_W / w, MAX_H / h, 1); w = Math.round(w * r); h = Math.round(h * r);
  const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h;
  cvs.getContext('2d', { alpha: false })!.drawImage(bmp, 0, 0, w, h);
  const toB64 = (q: number) => new Promise<string>(res => {
    cvs.toBlob(b => { const fr = new FileReader(); fr.onload = () => res((fr.result as string).split(',')[1]); fr.readAsDataURL(b as Blob); }, 'image/jpeg', q);
  });
  let b64 = await toB64(Q1); if (Math.floor(b64.length * 3 / 4) > MAX_BYTES) b64 = await toB64(Q2); return b64;
};

function upsertFactura(list: any[], item: any, key: string = 'num') {
  const idx = list.findIndex(x => x[key] === item[key]);
  if (idx >= 0) list[idx] = { ...list[idx], ...item }; else list.push(item);
}

export const CashView = ({ data, onSave }: CashViewProps) => {
  const [currentFilterDate, setCurrentFilterDate] = useState(new Date().toISOString().slice(0, 7));
  const [selectedUnit, setSelectedUnit] = useState<CashBusinessUnit | 'ALL'>('ALL'); 
  const [scanStatus, setScanStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [images, setImages] = useState<{ img1: string | null, img2: string | null }>({ img1: null, img2: null });
  
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportQuarter, setExportQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [exportYear, setExportYear] = useState(new Date().getFullYear());

  // 🎙️ Estados Grabación
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState(''); 
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const nativeTranscriptRef = useRef<string>('');
  const speechRecRef = useRef<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [form, setForm] = useState({
    date: DateUtil.today(),
    efectivo: '', tpv1: '', tpv2: '', amex: '', glovo: '', uber: '', madisa: '', apperStreet: '',
    cajaFisica: '', tienda: '', notas: ''
  });

  const [fondoCaja, setFondoCaja] = useState<number>(300);
  const [depositoBanco, setDepositoBanco] = useState<string>(''); 
  const [gastosCaja, setGastosCaja] = useState<{ concepto: string; importe: string; iva: 4|10|21; unidad: CashBusinessUnit }[]>([]);

  // 🧠 CÁLCULOS NETOS
  const totalTarjetas = useMemo(() => Num.parse(form.tpv1) + Num.parse(form.tpv2) + Num.parse(form.amex), [form.tpv1, form.tpv2, form.amex]);
  const appsBrutas = useMemo(() => Num.parse(form.glovo) + Num.parse(form.uber) + Num.parse(form.madisa) + Num.parse(form.apperStreet), [form.glovo, form.uber, form.madisa, form.apperStreet]);
  const appsNetas = useMemo(() => {
    const g = Num.parse(form.glovo) * (1 - COMISIONES.glovo); const u = Num.parse(form.uber) * (1 - COMISIONES.uber);
    const m = Num.parse(form.madisa) * (1 - COMISIONES.madisa); const a = Num.parse(form.apperStreet) * (1 - COMISIONES.apperStreet);
    return Num.round2(g + u + m + a);
  }, [form.glovo, form.uber, form.madisa, form.apperStreet]);

  const totalCalculadoBruto = useMemo(() => Num.parse(form.efectivo) + totalTarjetas + appsBrutas, [form.efectivo, totalTarjetas, appsBrutas]);
  const totalTienda = useMemo(() => Num.parse(form.tienda), [form.tienda]);
  const totalRestauranteNeto = useMemo(() => (Num.parse(form.efectivo) + totalTarjetas + appsNetas) - totalTienda, [form.efectivo, totalTarjetas, appsNetas, totalTienda]);

  const descuadreVivo = useMemo(() => {
    const cajaF = Num.parse(form.cajaFisica); const efec = Num.parse(form.efectivo);
    if (form.cajaFisica === '' || form.efectivo === '') return null;
    return Num.round2(cajaF - (efec + fondoCaja));
  }, [form.cajaFisica, form.efectivo, fondoCaja]);

  const kpis = useMemo(() => {
    const cierresMes = (data.cierres || []).filter(c => {
      if (!c.date || !c.date.startsWith(currentFilterDate)) return false;
      if (selectedUnit !== 'ALL' && (c.unitId || 'REST') !== selectedUnit) return false;
      return true;
    });
    const total = cierresMes.reduce((acc, c) => acc + (Num.parse(c.totalVenta) || 0), 0);
    const dias = new Set(cierresMes.map(c => c.date)).size;
    const media = dias > 0 ? total / dias : 0;
    const efec = cierresMes.reduce((acc, c) => acc + (Num.parse(c.efectivo) || 0), 0);
    const tarj = cierresMes.reduce((acc, c) => acc + (Num.parse(c.tarjeta) || 0), 0);
    const apps = cierresMes.reduce((acc, c) => acc + (Num.parse(c.apps) || 0), 0);
    return { total, media, dias, efec, tarj, apps, cierresMes };
  }, [data.cierres, currentFilterDate, selectedUnit]);

  const handleMonthChange = (offset: number) => {
    let [y, m] = currentFilterDate.split('-').map(Number); m += offset;
    if (m === 0) { m = 12; y--; } if (m === 13) { m = 1; y++; }
    setCurrentFilterDate(`${y}-${String(m).padStart(2, '0')}`);
  };

  // 📷 PROCESAMIENTO DE IMÁGENES (OCR)
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, slot: 'img1' | 'img2') => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''; await processImageWithAI(file, slot);
  };

  const processImageWithAI = async (file: File | Blob, slot: 'img1' | 'img2' = 'img1') => {
    const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("⚠️ No tienes la clave de IA conectada.");
    setScanStatus('loading');
    try {
      const objUrl = URL.createObjectURL(file); setImages(prev => ({ ...prev, [slot]: objUrl }));
      const base64Data = await compressImageToBase64(file); const ai = new GoogleGenAI({ apiKey });
      const prompt = `Analiza este ticket de cierre de caja. Devuelve SOLO JSON con: {"fecha":"YYYY-MM-DD", "efectivo":0, "tpv1":0, "tpv2":0, "amex":0, "glovo":0, "uber":0, "sobre_cash":0, "gastos":0, "venta_tienda":0, "notas":""}`;
      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType: "image/jpeg" } }] }], config: { responseMimeType: "application/json", temperature: 0.1 } });
      const rawJson = extractJSON(response.text || ""); actualizarFormConIA(rawJson, "Imagen"); setScanStatus('success');
    } catch (error: any) { setScanStatus('error'); alert(`⚠️ Problema procesando la imagen.`); } finally { setTimeout(() => setScanStatus('idle'), 4000); }
  };

  // 🎙️ GRABACIÓN PARALELA (TEXTO EN VIVO)
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop(); if (speechRecRef.current) { try { speechRecRef.current.stop(); } catch(e){} }
      const textoHablado = nativeTranscriptRef.current.trim();
      if (textoHablado) { setForm(prev => ({ ...prev, notas: (prev.notas ? prev.notas + "\n" : "") + "🎤 " + textoHablado })); }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      nativeTranscriptRef.current = ''; setLiveTranscript('');
      try {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition(); recognition.lang = 'es-ES'; recognition.continuous = true; recognition.interimResults = true; 
          recognition.onresult = (event: any) => { let text = ''; for (let i = 0; i < event.results.length; ++i) { text += event.results[i][0].transcript + ' '; } nativeTranscriptRef.current = text; setLiveTranscript(text); };
          speechRecRef.current = recognition; recognition.start();
        }
      } catch (speechErr) { console.warn("⚠️ El dictado nativo no es compatible con este navegador."); }

      const supports = (type: string) => MediaRecorder.isTypeSupported(type); let mimePref = '';
      if (supports('audio/webm;codecs=opus')) mimePref = 'audio/webm;codecs=opus'; else if (supports('audio/mp4')) mimePref = 'audio/mp4'; else if (supports('audio/webm')) mimePref = 'audio/webm';
      const options = mimePref ? { mimeType: mimePref, audioBitsPerSecond: 24_000 } : undefined;
      const mr = new MediaRecorder(stream, options); mediaRecorderRef.current = mr; audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => { const finalMime = mr.mimeType || 'audio/webm'; const audioBlob = new Blob(audioChunksRef.current, { type: finalMime }); stream.getTracks().forEach(t => t.stop()); setIsRecording(false); await processAudioWithAI(audioBlob, finalMime); };
      mr.start(); setIsRecording(true); setTimeout(() => { if (mr.state === 'recording') toggleRecording(); }, 60000); 
    } catch (err: any) { alert(`⚠️ No podemos acceder al micro. Comprueba permisos.`); }
  };

  const processAudioWithAI = async (audioBlob: Blob, mimeType: string) => {
    const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key'); setScanStatus('loading');
    try {
      if (!apiKey) throw new Error("No API Key");
      const base64Audio = await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve((fr.result as string).split(',')[1]); fr.readAsDataURL(audioBlob); });
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Transcribe y extrae los datos de caja. Devuelve SOLO JSON con: { "efectivo":0, "tpv1":0, "tpv2":0, "amex":0, "glovo":0, "uber":0, "apperStreet":0, "sobre_cash":0, "gastos":0, "venta_tienda":0, "notas":"" }`;
      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Audio, mimeType } }] }], config: { responseMimeType: "application/json", temperature: 0.1 } });
      const rawJson = extractJSON(response.text || ""); actualizarFormConIA(rawJson, "IA"); setScanStatus('success');
    } catch (error: any) { setScanStatus('error'); alert("⚠️ Gemini no pudo procesar los números, revisa las notas."); } finally { setTimeout(() => setScanStatus('idle'), 4000); }
  };

  const actualizarFormConIA = (rawJson: any, origen: string = "IA") => {
    setForm(prev => ({
      ...prev, date: rawJson.fecha ? normalizeDate(rawJson.fecha) : prev.date,
      efectivo: String(asNum(rawJson.efectivo) || prev.efectivo), tpv1: String(asNum(rawJson.tpv1) || prev.tpv1),
      tpv2: String(asNum(rawJson.tpv2) || prev.tpv2), amex: String(asNum(rawJson.amex) || prev.amex),
      glovo: String(asNum(rawJson.glovo) || prev.glovo), uber: String(asNum(rawJson.uber) || prev.uber),
      apperStreet: String(asNum(rawJson.apperStreet) || prev.apperStreet), tienda: String(asNum(rawJson.venta_tienda) || prev.tienda),
      cajaFisica: asNum(rawJson.sobre_cash) > 0 ? (asNum(rawJson.sobre_cash) + fondoCaja).toFixed(2) : prev.cajaFisica,
      notas: prev.notas + (rawJson.gastos ? `\n[Gastos IA]: ${rawJson.gastos}€` : "")
    }));
  };

  // 💾 GUARDADO 
  const handleSaveCierre = async () => {
    if (isSaving) return;
    if (totalCalculadoBruto <= 0) return alert("Introduce algún importe para guardar la caja.");
    if (totalRestauranteNeto < 0) return alert("La venta de la tienda no puede ser mayor que el total de la caja.");
    setIsSaving(true);
    try {
      const newData = JSON.parse(JSON.stringify(data)); 
      const fechaSeleccionada = form.date;
      const descuadreFinal = descuadreVivo || 0;

      if (!newData.cierres) newData.cierres = []; if (!newData.facturas) newData.facturas = []; if (!newData.banco) newData.banco = [];

      if (gastosCaja.length > 0) {
        gastosCaja.forEach((g, idx) => {
          const imp = Num.parse(g.importe); const base = Num.round2(imp / (1 + g.iva / 100)); const tax  = Num.round2(imp - base); const num  = `GC-${fechaSeleccionada.replace(/-/g,'')}-${idx+1}`;
          // 🚀 FIX TIPO ERP
          newData.facturas.unshift({ id: `gc-${Date.now()}-${idx}`, tipo: 'caja', num, date: fechaSeleccionada, prov: g.concepto.toUpperCase(), cliente: "GASTO CAJA", total: imp, base, tax, paid: true, reconciled: true, unidad_negocio: g.unidad });
        });
      }

      const dep = Num.parse(depositoBanco);
      if (dep > 0) newData.banco.unshift({ id: `bank-dep-${Date.now()}`, date: fechaSeleccionada, desc: "Ingreso sobre a banco", amount: dep, status: "pending" });

      const cierreRestId = `ZR-${fechaSeleccionada.replace(/-/g, '')}`;
      const infoTarjetas = `[Tarjetas -> TPV1: ${form.tpv1||0}€ | TPV2: ${form.tpv2||0}€ | AMEX: ${form.amex||0}€]`;

      const cierreRest: Cierre = { id: cierreRestId, date: fechaSeleccionada, totalVenta: totalRestauranteNeto, efectivo: Num.parse(form.efectivo), tarjeta: totalTarjetas, apps: appsNetas, descuadre: descuadreFinal, notas: `${infoTarjetas} [Bruto Ticket Apps: ${appsBrutas.toFixed(2)}€]\n${form.notas}`.trim(), conciliado_banco: false, unitId: 'REST' };
      upsertFactura(newData.cierres, cierreRest, 'id');

      const baseR = Num.round2(totalRestauranteNeto / 1.10); const taxR  = Num.round2(totalRestauranteNeto - baseR);
      const fIdxRest = newData.facturas.findIndex((f: any) => f.num === cierreRestId);
      // 🚀 FIX TIPO ERP
      upsertFactura(newData.facturas, { id: fIdxRest >= 0 ? newData.facturas[fIdxRest].id : `f-zr-${Date.now()}`, tipo: 'caja', num: cierreRestId, date: fechaSeleccionada, prov: "Z DIARIO", cliente: "Z DIARIO", total: totalRestauranteNeto, base: baseR, tax: taxR, paid: fIdxRest >= 0 ? newData.facturas[fIdxRest].paid : false, reconciled: fIdxRest >= 0 ? newData.facturas[fIdxRest].reconciled : false, unidad_negocio: 'REST' }, 'num');

      if (totalTienda > 0) {
        const cierreShopId = `ZS-${fechaSeleccionada.replace(/-/g, '')}`;
        upsertFactura(newData.cierres, { id: cierreShopId, date: fechaSeleccionada, totalVenta: Num.round2(totalTienda), efectivo: 0, tarjeta: 0, apps: 0, descuadre: 0, notas: 'Venta separada de caja general', conciliado_banco: false, unitId: 'SHOP' }, 'id');
        const baseS = Num.round2(totalTienda / 1.21); const taxS  = Num.round2(totalTienda - baseS);
        const fIdxShop = newData.facturas.findIndex((f: any) => f.num === cierreShopId);
        // 🚀 FIX TIPO ERP
        upsertFactura(newData.facturas, { id: fIdxShop >= 0 ? newData.facturas[fIdxShop].id : `f-zs-${Date.now()}`, tipo: 'caja', num: cierreShopId, date: fechaSeleccionada, prov: "Z DIARIO", cliente: "Z DIARIO", total: Num.round2(totalTienda), base: baseS, tax: taxS, paid: fIdxShop >= 0 ? newData.facturas[fIdxShop].paid : false, reconciled: fIdxShop >= 0 ? newData.facturas[fIdxShop].reconciled : false, unidad_negocio: 'SHOP' }, 'num');
      }

      await onSave(newData);
      setForm({ date: DateUtil.today(), efectivo: '', tpv1: '', tpv2: '', amex: '', glovo: '', uber: '', madisa: '', apperStreet: '', cajaFisica: '', tienda: '', notas: '' });
      setImages({ img1: null, img2: null }); setGastosCaja([]); setDepositoBanco('');
      if (images.img1) URL.revokeObjectURL(images.img1); if (images.img2) URL.revokeObjectURL(images.img2);
      alert("✅ ¡Cierre guardado con éxito!");
    } catch (e: any) { alert('❌ Hubo un error al guardar los datos.'); } finally { setIsSaving(false); }
  };

  const handleDeleteCierre = async (id: string) => {
    if (!window.confirm("¿Borrar este cierre?")) return;
    const newData = { ...data }; const c = newData.cierres.find((x: any) => x.id === id);
    if (c) { newData.facturas = newData.facturas.filter((f: any) => f.num !== c.id); newData.cierres = newData.cierres.filter((x: any) => x.id !== id); await onSave(newData); }
  };

  const handleExportGestoria = () => {
    const q = exportQuarter; const y = exportYear; const startMonth = (q - 1) * 3 + 1; const endMonth = q * 3;
    const filtered = (data.cierres || []).filter(c => { if (selectedUnit !== 'ALL' && c.unitId !== selectedUnit) return false; const [cYear, cMonth] = c.date.split('-').map(Number); return cYear === y && cMonth >= startMonth && cMonth <= endMonth; });
    if (filtered.length === 0) return alert("No hay Cierres de Caja en este periodo.");
    const rows = filtered.map(c => ({ 'FECHA': c.date, 'UNIDAD': CASH_UNITS.find(u => u.id === (c.unitId || 'REST'))?.name || 'Restaurante', 'TOTAL VENTA NETO': Num.fmt(c.totalVenta), 'EFECTIVO CAJÓN': Num.fmt(c.efectivo), 'TOTAL TARJETAS': Num.fmt(c.tarjeta), 'APPS (NETO)': Num.fmt(c.apps), 'DESCUADRE FISICO': Num.fmt(c.descuadre), 'NOTAS / DESGLOSE': c.notas || '' }));
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Cierres_Caja"); XLSX.writeFile(wb, `Cierres_Gestoria_Arume_${y}_Q${q}_${selectedUnit}.xlsx`); setIsExportModalOpen(false);
  };

  const [yearStr, monthStr] = currentFilterDate.split('-');
  const nombreMes = new Date(Number(yearStr), Number(monthStr) - 1).toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();

  return (
    <div className={cn("animate-fade-in space-y-6 pb-24", scanStatus === 'loading' && "transition-none")}>
      
      {/* 🚀 OVERLAY GRABACIÓN CON TRANSCRIPCIÓN EN VIVO */}
      <AnimatePresence>
        {isRecording && (
          <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }} className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] w-11/12 max-w-md bg-slate-900 text-white p-4 rounded-3xl shadow-2xl border-2 border-indigo-500 cursor-pointer flex flex-col items-center gap-2" onClick={toggleRecording}>
            <div className="flex items-center gap-3"><div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse"></div><span className="text-xs font-black uppercase tracking-widest">Escuchando... (Toca para parar)</span></div>
            <p className="text-xs text-slate-300 text-center italic line-clamp-3 w-full">{liveTranscript || "Habla despacio y verás tu texto aquí..."}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER */}
      <header className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
        <div>
           <h2 className="text-xl font-black text-slate-800">Caja Unificada</h2>
           <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1 flex items-center gap-1"><SplitSquareHorizontal className="w-3 h-3" /> Separación Inteligente PRO</p>
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
          <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100">
            <div className="flex justify-between items-center mb-6">
               <h3 className="font-black text-slate-700">Entrada Z</h3>
               <div className="flex gap-2">
                 <button onClick={toggleRecording} className={cn("px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2", isRecording ? "bg-rose-500 text-white" : "bg-slate-900 text-white")}><Mic className="w-3 h-3"/> {isRecording ? "DETENER" : "DICTAR IA"}</button>
               </div>
            </div>

            {/* 📷 OCR: Subir Fotos */}
            <div className="mb-6 border-2 border-dashed border-slate-200 rounded-[2rem] p-4 bg-slate-50 hover:bg-slate-100 transition relative cursor-pointer">
              <label className="flex flex-col items-center justify-center h-20 w-full cursor-pointer">
                {images.img1 ? (
                  <div className="flex items-center justify-between w-full px-4"><span className="text-emerald-600 font-bold text-xs flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Imagen Cargada</span><button onClick={(e) => { e.preventDefault(); setImages({img1: null, img2: null}); }} className="text-rose-500 hover:text-rose-700"><Trash2 className="w-4 h-4"/></button></div>
                ) : (
                  <><ImageIcon className="w-6 h-6 text-slate-400 mb-2"/><span className="text-[10px] font-black text-slate-500 uppercase">Subir Foto Ticket Z (IA)</span></>
                )}
                <input type="file" onChange={(e) => handleImageUpload(e, 'img1')} className="hidden" accept="image/*" />
              </label>
              {scanStatus === 'loading' && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-[2rem]"><RefreshCw className="w-6 h-6 text-indigo-500 animate-spin" /></div>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="bg-emerald-50 p-4 rounded-2xl">
                  <label className="text-[9px] font-black text-emerald-600 block mb-1 uppercase">Efectivo Cajón</label>
                  <input type="number" value={form.efectivo} onChange={e => setForm({...form, efectivo: e.target.value})} className="w-full bg-transparent text-2xl font-black outline-none text-emerald-700"/>
               </div>
               <div className="bg-indigo-50 p-4 rounded-2xl">
                  <label className="text-[9px] font-black text-indigo-600 block mb-1 uppercase">Total Tarjetas (TPVs)</label>
                  <input type="number" value={totalTarjetas} readOnly className="w-full bg-transparent text-2xl font-black outline-none text-indigo-700"/>
               </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4">
               <input placeholder="TPV 1" value={form.tpv1} onChange={e=>setForm({...form, tpv1:e.target.value})} className="p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none"/>
               <input placeholder="TPV 2" value={form.tpv2} onChange={e=>setForm({...form, tpv2:e.target.value})} className="p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none"/>
               <input placeholder="AMEX" value={form.amex} onChange={e=>setForm({...form, amex:e.target.value})} className="p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none"/>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <input type="number" placeholder="Glovo" value={form.glovo} onChange={e=>setForm({...form, glovo:e.target.value})} className="p-3 bg-orange-50 rounded-xl text-xs font-bold outline-none text-orange-700"/>
              <input type="number" placeholder="Uber" value={form.uber} onChange={e=>setForm({...form, uber:e.target.value})} className="p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none"/>
            </div>

            <div className="mt-4 p-4 bg-slate-900 rounded-2xl">
              <label className="text-[9px] font-black text-slate-400 block mb-2 uppercase">Arqueo Físico (Sobres)</label>
              <input type="number" value={form.cajaFisica} onChange={e => setForm({...form, cajaFisica: e.target.value})} className="w-full bg-transparent text-2xl font-black outline-none text-emerald-400" placeholder="0.00" />
              {descuadreVivo !== null && (
                 <p className={cn("text-xs font-black mt-2", Math.abs(descuadreVivo) <= 2 ? "text-emerald-500" : "text-rose-500")}>
                   {Math.abs(descuadreVivo) <= 2 ? "✅ CAJA CUADRADA" : `⚠️ DESCUADRE: ${descuadreVivo}€`}
                 </p>
              )}
            </div>

            <div className="mt-6 p-4 bg-orange-50 rounded-2xl border border-orange-100">
               <label className="text-[9px] font-black text-orange-600 block mb-2 uppercase">Desvío Tienda Sake</label>
               <input type="number" value={form.tienda} onChange={e => setForm({...form, tienda: e.target.value})} className="w-full bg-transparent text-xl font-black outline-none text-orange-700" placeholder="0.00"/>
            </div>

            <div className="mt-6 relative">
               <textarea value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl text-xs min-h-[100px] outline-none" placeholder="Notas de la jornada o Transcripción de IA..."/>
               {form.notas && <button onClick={() => setForm({...form, notas: ''})} className="absolute top-4 right-4 text-slate-400 hover:text-rose-500"><XCircle className="w-4 h-4"/></button>}
            </div>

            {/* Componente de Gastos Múltiples */}
            <div className="mt-6 border-t border-slate-100 pt-6">
              <p className="text-[10px] font-black text-amber-500 uppercase mb-3">Gastos de Caja Menuda</p>
              <GastoCajaEditor gastos={gastosCaja} onAdd={(g) => setGastosCaja(prev => [...prev, g])} onDelete={(i) => setGastosCaja(prev => prev.filter((_,idx) => idx !== i))} />
            </div>

            <button onClick={handleSaveCierre} disabled={isSaving} className="w-full mt-8 py-5 bg-slate-900 text-white rounded-2xl font-black shadow-xl hover:bg-indigo-600 transition">
               {isSaving ? "GUARDANDO..." : `GUARDAR CIERRE (${totalRestauranteNeto.toFixed(2)}€)`}
            </button>
          </div>
        </div>

        <div className="space-y-6">
           <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white">
              <p className="text-[10px] font-bold opacity-50 uppercase tracking-widest">Facturación Mes</p>
              <p className="text-4xl font-black">{kpis.total.toLocaleString()}€</p>
           </div>
           
           <CashHistoryList cierresMes={kpis.cierresMes} facturas={data.facturas || []} onDelete={handleDeleteCierre} />
        </div>
      </div>
      
      {/* Modal Exportación Simple */}
      <AnimatePresence>
        {isExportModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <motion.div initial={{ y: 20 }} animate={{ y: 0 }} className="bg-white p-8 rounded-[2.5rem] w-full max-w-sm">
              <h3 className="font-black text-xl mb-4">Exportar Datos</h3>
              <p className="text-xs text-slate-500 mb-6">Genera el listado de cajas para el contable.</p>
              <button onClick={handleExportGestoria} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black">DESCARGAR EXCEL</button>
              <button onClick={() => setIsExportModalOpen(false)} className="w-full mt-2 py-3 text-xs font-bold text-slate-400 hover:text-slate-600">Cerrar</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* =======================================================
 * COMPONENTE EDITOR DE GASTOS MÚLTIPLES
 * ======================================================= */
function GastoCajaEditor({ gastos, onAdd, onDelete }: { gastos: any[]; onAdd: (g: any) => void; onDelete: (i: number) => void; }) {
  const [row, setRow] = useState({ concepto: '', importe: '', iva: 10 as 4|10|21, unidad: 'REST' as CashBusinessUnit });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input value={row.concepto} onChange={(e)=>setRow({...row, concepto: e.target.value})} placeholder="Ej: Pan" className="md:col-span-2 p-3 rounded-xl bg-slate-50 text-xs font-bold border border-slate-100 outline-none" />
        <input value={row.importe} onChange={(e)=>setRow({...row, importe: e.target.value})} placeholder="€" type="number" className="p-3 rounded-xl bg-slate-50 text-xs font-bold border border-slate-100 outline-none" />
        <select value={row.iva} onChange={(e)=>setRow({...row, iva: Number(e.target.value) as 4|10|21})} className="p-3 rounded-xl bg-slate-50 text-xs font-bold border border-slate-100 outline-none">
          <option value={4}>IVA 4%</option><option value={10}>IVA 10%</option><option value={21}>IVA 21%</option>
        </select>
        <button onClick={() => { if (!row.concepto || !row.importe) return; onAdd(row); setRow({ concepto: '', importe: '', iva: 10, unidad: 'REST' }); }} className="p-3 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase hover:bg-amber-600 transition"><Plus className="w-4 h-4 mx-auto"/></button>
      </div>
      
      {gastos.length > 0 && (
        <div className="space-y-2">
          {gastos.map((g,i)=>(
            <div key={i} className="text-xs flex justify-between items-center bg-white rounded-lg px-3 py-2 border border-slate-200">
              <span className="font-bold text-slate-700">{g.concepto} ({g.iva}%)</span>
              <div className="flex items-center gap-4">
                <span className="font-black text-amber-600">{Number(g.importe).toFixed(2)}€</span>
                <button onClick={()=>onDelete(i)} className="text-rose-400 hover:text-rose-600"><Trash2 className="w-3 h-3"/></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
