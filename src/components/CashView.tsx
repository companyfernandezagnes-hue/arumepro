import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  ChevronLeft, ChevronRight, CreditCard, Banknote, Truck, Sparkles, 
  Trash2, CheckCircle2, Clock, AlertTriangle, RefreshCw, Image as ImageIcon, 
  Scan, Building2, ShoppingBag, Layers, SplitSquareHorizontal, Mic, Square, Plus, Download, XCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { AppData, Cierre, Factura } from '../types';
import { Num } from '../services/engine';
import { cn } from '../lib/utils';
import { GoogleGenAI } from "@google/genai";

// 🚀 IMPORTAMOS LA LISTA SUPER RÁPIDA
import { CashHistoryList } from '../components/CashHistoryList';

// Fallback de animaciones
let motion: any = { div: 'div' };
let AnimatePresence: any = React.Fragment;
try {
  const fm = require('motion/react');
  motion = fm.motion;
  AnimatePresence = fm.AnimatePresence;
} catch(e) {}

export type CashBusinessUnit = 'REST' | 'SHOP';

export const CASH_UNITS: { id: CashBusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante', icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'SHOP', name: 'Tienda Sake', icon: ShoppingBag, color: 'text-emerald-600', bg: 'bg-emerald-50' }
];

const COMISIONES = {
  glovo: 0.0,        
  uber: 0.0,        
  apperStreet: 0.0, 
  madisa: 0.0        
};

interface CashViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

const asNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const normalizeDate = (s?: string) => {
  const v = String(s ?? '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : new Date().toLocaleDateString('sv-SE'); 
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
  const [currentFilterDate, setCurrentFilterDate] = useState(new Date().toLocaleDateString('sv-SE').slice(0, 7));
  const [selectedUnit, setSelectedUnit] = useState<CashBusinessUnit | 'ALL'>('ALL'); 
  const [scanStatus, setScanStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [images, setImages] = useState<{ img1: string | null, img2: string | null }>({ img1: null, img2: null });
  
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportQuarter, setExportQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [exportYear, setExportYear] = useState(new Date().getFullYear());

  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const nativeTranscriptRef = useRef<string>('');
  const speechRecRef = useRef<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [form, setForm] = useState({
    date: new Date().toLocaleDateString('sv-SE'),
    efectivo: '', tpv1: '', tpv2: '', amex: '', glovo: '', uber: '', madisa: '', apperStreet: '',
    cajaFisica: '', tienda: '', notas: ''
  });

  const [fondoCaja, setFondoCaja] = useState<number>(300);
  const [depositoBanco, setDepositoBanco] = useState<string>(''); 
  const [gastosCaja, setGastosCaja] = useState<{ concepto: string; importe: string; iva: 4|10|21; unidad: CashBusinessUnit }[]>([]);

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
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType: "image/jpeg" } }] }], config: { responseMimeType: "application/json", temperature: 0.1 }
      });
      const rawJson = extractJSON(response.text || ""); actualizarFormConIA(rawJson, "Imagen"); setScanStatus('success');
    } catch (error: any) { setScanStatus('error'); alert(`⚠️ Problema procesando la imagen.`); } finally { setTimeout(() => setScanStatus('idle'), 4000); }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop(); if (speechRecRef.current) { try { speechRecRef.current.stop(); } catch(e){} }
      const textoHablado = nativeTranscriptRef.current.trim();
      if (textoHablado) { setForm(prev => ({ ...prev, notas: (prev.notas ? prev.notas + "\n" : "") + "🎤 " + textoHablado })); }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); nativeTranscriptRef.current = ''; setLiveTranscript('');
      try {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition(); recognition.lang = 'es-ES'; recognition.continuous = true; recognition.interimResults = true; 
          recognition.onresult = (event: any) => {
            let text = ''; for (let i = 0; i < event.results.length; ++i) { text += event.results[i][0].transcript + ' '; }
            nativeTranscriptRef.current = text; setLiveTranscript(text); 
          };
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
    } catch (err: any) { alert(`⚠️ No podemos acceder al micro. Comprueba el candado de la barra de direcciones de tu navegador.`); }
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
    } catch (error: any) { setScanStatus('error'); alert("⚠️ Gemini no pudo procesar los números, pero tienes tu texto guardado en las notas."); } finally { setTimeout(() => setScanStatus('idle'), 4000); }
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

  // ==========================================
  // 💾 GUARDADO (CON EL TIPO 'CAJA' PARA EL ERP)
  // ==========================================
  const handleSaveCierre = async () => {
    if (isSaving) return;
    if (totalCalculadoBruto <= 0) return alert("Introduce algún importe para guardar la caja.");
    if (totalRestauranteNeto < 0) return alert("La venta de la tienda no puede ser mayor que el total de la caja.");

    setIsSaving(true);

    try {
      const newData = JSON.parse(JSON.stringify(data)); 
      const fechaSeleccionada = form.date;
      const descuadreFinal = descuadreVivo || 0;

      if (!newData.cierres) newData.cierres = [];
      if (!newData.facturas) newData.facturas = [];
      if (!newData.banco) newData.banco = [];

      // 🚀 FIX ERP: GASTOS PAGADOS CON EFECTIVO DE CAJA -> tipo: 'caja'
      if (gastosCaja.length > 0) {
        gastosCaja.forEach((g, idx) => {
          const imp = Num.parse(g.importe);
          const base = Num.round2(imp / (1 + g.iva / 100));
          const tax  = Num.round2(imp - base);
          const num  = `GC-${fechaSeleccionada.replace(/-/g,'')}-${idx+1}`;

          newData.facturas.unshift({
            id: `gc-${Date.now()}-${idx}`,
            tipo: 'caja', // <--- ESTO ES LO QUE ARREGLA TU ERP
            num, date: fechaSeleccionada, prov: g.concepto.toUpperCase(),
            cliente: "GASTO CAJA", total: imp, base, tax, 
            paid: true, reconciled: true, unidad_negocio: g.unidad
          });
        });
      }

      const dep = Num.parse(depositoBanco);
      if (dep > 0) {
        newData.banco.unshift({
          id: `bank-dep-${Date.now()}`,
          date: fechaSeleccionada, desc: "Ingreso sobre a banco",
          amount: dep, status: "pending"
        });
      }

      // 🚀 FIX ERP: TICKET Z DIARIO -> tipo: 'caja'
      const cierreRestId = `ZR-${fechaSeleccionada.replace(/-/g, '')}`;
      const infoTarjetas = `[Tarjetas -> TPV1: ${form.tpv1||0}€ | TPV2: ${form.tpv2||0}€ | AMEX: ${form.amex||0}€]`;

      const cierreRest: Cierre = {
        id: cierreRestId, date: fechaSeleccionada, totalVenta: totalRestauranteNeto, 
        efectivo: Num.parse(form.efectivo), tarjeta: totalTarjetas, apps: appsNetas, 
        descuadre: descuadreFinal, notas: `${infoTarjetas} [Bruto Ticket Apps: ${appsBrutas.toFixed(2)}€]\n${form.notas}`.trim(), 
        conciliado_banco: false, unitId: 'REST'
      };
      upsertFactura(newData.cierres, cierreRest, 'id');

      const fIdxRest = newData.facturas.findIndex((f: any) => f.num === cierreRestId);
      const baseR = Num.round2(totalRestauranteNeto / 1.10);
      const taxR  = Num.round2(totalRestauranteNeto - baseR);
      
      upsertFactura(newData.facturas, {
        id: fIdxRest >= 0 ? newData.facturas[fIdxRest].id : `f-zr-${Date.now()}`,
        tipo: 'caja', // <--- ESTO ES LO QUE ARREGLA TU ERP
        num: cierreRestId, date: fechaSeleccionada, prov: "Z DIARIO", cliente: "Z DIARIO",
        total: totalRestauranteNeto, base: baseR, tax: taxR,
        paid: fIdxRest >= 0 ? newData.facturas[fIdxRest].paid : false,
        reconciled: fIdxRest >= 0 ? newData.facturas[fIdxRest].reconciled : false,
        unidad_negocio: 'REST'
      }, 'num');

      // 🚀 FIX ERP: Z DIARIO TIENDA SAKE -> tipo: 'caja'
      if (totalTienda > 0) {
        const cierreShopId = `ZS-${fechaSeleccionada.replace(/-/g, '')}`;
        const cierreShop: Cierre = {
          id: cierreShopId, date: fechaSeleccionada, totalVenta: Num.round2(totalTienda),
          efectivo: 0, tarjeta: 0, apps: 0, descuadre: 0, notas: 'Venta separada de caja general',
          conciliado_banco: false, unitId: 'SHOP'
        };
        upsertFactura(newData.cierres, cierreShop, 'id');

        const fIdxShop = newData.facturas.findIndex((f: any) => f.num === cierreShopId);
        const baseS = Num.round2(totalTienda / 1.21);
        const taxS  = Num.round2(totalTienda - baseS);
        
        upsertFactura(newData.facturas, {
          id: fIdxShop >= 0 ? newData.facturas[fIdxShop].id : `f-zs-${Date.now()}`,
          tipo: 'caja', // <--- ESTO ES LO QUE ARREGLA TU ERP
          num: cierreShopId, date: fechaSeleccionada, prov: "Z DIARIO", cliente: "Z DIARIO",
          total: Num.round2(totalTienda), base: baseS, tax: taxS,
          paid: fIdxShop >= 0 ? newData.facturas[fIdxShop].paid : false,
          reconciled: fIdxShop >= 0 ? newData.facturas[fIdxShop].reconciled : false,
          unidad_negocio: 'SHOP'
        }, 'num');
      }

      await onSave(newData);

      setForm({ date: DateUtil.today(), efectivo: '', tpv1: '', tpv2: '', amex: '', glovo: '', uber: '', madisa: '', apperStreet: '', cajaFisica: '', tienda: '', notas: '' });
      setImages({ img1: null, img2: null });
      setGastosCaja([]);
      setDepositoBanco('');
      if (images.img1) URL.revokeObjectURL(images.img1);
      if (images.img2) URL.revokeObjectURL(images.img2);
      
      alert("✅ ¡Cierre guardado con éxito! (Netos aplicados correctamente)");

    } catch (e: any) {
      console.error('Guardar cierre falló:', e);
      alert('❌ Hubo un error al guardar los datos.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCierre = async (id: string) => {
    if (!window.confirm("¿Borrar este cierre?")) return;
    const newData = { ...data };
    const c = newData.cierres.find((x: any) => x.id === id);
    if (c) {
      newData.facturas = newData.facturas.filter((f: any) => f.num !== c.id);
      newData.cierres = newData.cierres.filter((x: any) => x.id !== id);
      await onSave(newData);
    }
  };

  const handleExportGestoria = () => {
    const q = exportQuarter; const y = exportYear; const startMonth = (q - 1) * 3 + 1; const endMonth = q * 3;
    const filtered = (data.cierres || []).filter(c => {
      if (selectedUnit !== 'ALL' && c.unitId !== selectedUnit) return false;
      const [cYear, cMonth] = c.date.split('-').map(Number);
      return cYear === y && cMonth >= startMonth && cMonth <= endMonth;
    });

    if (filtered.length === 0) return alert("No hay Cierres de Caja en este periodo para exportar.");

    const rows = filtered.map(c => ({
      'FECHA': c.date,
      'UNIDAD': CASH_UNITS.find(u => u.id === (c.unitId || 'REST'))?.name || 'Restaurante',
      'TOTAL VENTA NETO': Num.fmt(c.totalVenta),
      'EFECTIVO CAJÓN': Num.fmt(c.efectivo),
      'TOTAL TARJETAS': Num.fmt(c.tarjeta),
      'APPS (NETO)': Num.fmt(c.apps),
      'DESCUADRE FISICO': Num.fmt(c.descuadre),
      'NOTAS / DESGLOSE': c.notas || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cierres_Caja");
    XLSX.writeFile(wb, `Cierres_Gestoria_Arume_${y}_Q${q}_${selectedUnit}.xlsx`);
    setIsExportModalOpen(false);
  };

  const [yearStr, monthStr] = currentFilterDate.split('-');
  const nombreMes = new Date(Number(yearStr), Number(monthStr) - 1).toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();

  return (
    <div className={cn("animate-fade-in space-y-6 pb-24", scanStatus === 'loading' && "transition-none")}>
      
      {/* 🚀 OVERLAY GRABACIÓN CON TRANSCRIPCIÓN EN VIVO */}
      {isRecording && (
        <div 
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] w-11/12 max-w-md bg-slate-900 text-white p-4 rounded-3xl shadow-2xl border-2 border-indigo-500 cursor-pointer flex flex-col items-center gap-2" 
          onClick={toggleRecording}
        >
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse"></div>
            <span className="text-xs font-black uppercase tracking-widest">Escuchando... (Toca para parar)</span>
          </div>
          <p className="text-xs text-slate-300 text-center italic line-clamp-3 w-full">
            {liveTranscript || "Habla despacio y verás tu texto aquí..."}
          </p>
        </div>
      )}

      {/* Header y Selector de Bloques */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Control de Caja Unificada</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest flex items-center gap-1 mt-1">
            <SplitSquareHorizontal className="w-3 h-3" /> Separación Inteligente PRO
          </p>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
          <button onClick={() => handleMonthChange(-1)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl text-slate-600 shadow-sm hover:bg-indigo-50 transition font-bold text-lg"><ChevronLeft className="w-5 h-5" /></button>
          <input type="month" value={currentFilterDate} onChange={(e) => setCurrentFilterDate(e.target.value)} className="bg-transparent border-0 text-sm font-black text-slate-700 uppercase outline-none text-center w-36 cursor-pointer" />
          <button onClick={() => handleMonthChange(1)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl text-slate-600 shadow-sm hover:bg-indigo-50 transition font-bold text-lg"><ChevronRight className="w-5 h-5" /></button>
        </div>
      </header>

      {/* Selectores y Acciones */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-1">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSelectedUnit('ALL')} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === 'ALL' ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}><Layers className="w-3 h-3" /> Consolidado</button>
          {CASH_UNITS.map(unit => (
            <button key={unit.id} onClick={() => setSelectedUnit(unit.id)} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === unit.id ? `${unit.color.replace('text-', 'bg-')} text-white border-transparent shadow-md` : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}>
              <unit.icon className="w-3 h-3" /> {unit.name}
            </button>
          ))}
        </div>
        
        <button 
          onClick={() => setIsExportModalOpen(true)}
          className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm w-full md:w-auto justify-center"
        >
          <Download className="w-4 h-4" /> EXPORTAR EXCEL GESTORÍA
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Facturación {nombreMes}</p>
          <p className="text-4xl font-black mt-2">{kpis.total.toLocaleString('es-ES', {minimumFractionDigits: 0})}€</p>
        </div>
        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1"><span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> Tarjeta</span> <span>{kpis.tarj.toLocaleString()}€</span></div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-2"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${kpis.total > 0 ? (kpis.tarj/kpis.total)*100 : 0}%` }}></div></div>
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1"><span className="flex items-center gap-1"><Banknote className="w-3 h-3" /> Efectivo</span> <span>{kpis.efec.toLocaleString()}€</span></div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${kpis.total > 0 ? (kpis.efec/kpis.total)*100 : 0}%` }}></div></div>
        </div>
        <div className="bg-orange-50 p-6 rounded-[2.5rem] border border-orange-100 shadow-sm flex flex-col justify-center items-start">
          <Truck className="w-6 h-6 text-orange-300 mb-2" />
          <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">Apps Delivery</p>
          <p className="text-3xl font-black text-orange-600 mt-1">{kpis.apps.toLocaleString()}€</p>
        </div>
      </div>

      {/* Formulario Cierre Z */}
      <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100 relative overflow-hidden mt-8">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-emerald-400"></div>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h3 className="text-xl font-black text-slate-800">Nuevo Cierre Z</h3>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={toggleRecording} 
              disabled={scanStatus === 'loading' || isSaving} 
              className={cn("px-6 py-2 rounded-xl text-[10px] font-black transition shadow-lg flex items-center gap-2", isRecording ? "bg-rose-500 text-white" : "bg-slate-900 text-white hover:bg-slate-800", (scanStatus === 'loading' || isSaving) && "opacity-50 cursor-not-allowed")}
            >
              {isRecording ? <Square className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
              <span>{isRecording ? "DETENER GRABACIÓN" : "DICTAR VOZ (IA)"}</span>
            </button>
          </div>
        </div>

        {/* Cajas de Imágenes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="relative group">
            <label className={cn("flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-[2rem] cursor-pointer transition-all overflow-hidden", images.img1 ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-slate-50 hover:bg-slate-100", (scanStatus === 'loading' || isSaving) && "pointer-events-none")}>
              {images.img1 ? (
                <div className="relative w-full h-full p-2">
                  <img src={images.img1} className="w-full h-full object-cover rounded-2xl" alt="Ticket Principal" />
                  <button onClick={(e) => { e.preventDefault(); URL.revokeObjectURL(images.img1!); setImages(prev => ({...prev, img1: null})); }} className="absolute top-4 right-4 bg-rose-500 text-white p-1.5 rounded-full shadow-lg hover:bg-rose-600 transition"><Trash2 className="w-4 h-4" /></button>
                  {scanStatus === 'loading' && <div className="absolute inset-0 bg-slate-900/60 rounded-2xl flex flex-col items-center justify-center backdrop-blur-sm"><RefreshCw className="w-8 h-8 text-white animate-spin mb-2" /></div>}
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <ImageIcon className="w-6 h-6 text-slate-300 mb-2" />
                  <p className="text-[9px] font-black text-slate-400 uppercase text-center">Subir Ticket Z Principal</p>
                </div>
              )}
              <input type="file" onChange={(e) => handleImageUpload(e, 'img1')} className="hidden" accept="image/*" capture="environment" />
            </label>
          </div>
        </div>
        
        {/* Entradas */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Fecha y Totales Caja</h4>
            <input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none focus:ring-2 ring-indigo-500/20" />
            
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <label className="text-[10px] font-black text-slate-500 uppercase mb-2 block">Efectivo (Billetes/Monedas)</label>
              <input type="number" placeholder="Efectivo Ticket Z" value={form.efectivo} onChange={(e) => setForm({...form, efectivo: e.target.value})} className="w-full p-3 bg-white rounded-xl text-lg font-black outline-none focus:ring-2 ring-emerald-500/20" />
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <label className="text-[10px] font-black text-slate-500 uppercase mb-2 block">Tarjetas TPV y Amex</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input type="number" placeholder="TPV 1" value={form.tpv1} onChange={(e) => setForm({...form, tpv1: e.target.value})} className="w-full p-3 bg-white rounded-xl font-bold outline-none focus:ring-2 ring-indigo-500/20" />
                <input type="number" placeholder="TPV 2" value={form.tpv2} onChange={(e) => setForm({...form, tpv2: e.target.value})} className="w-full p-3 bg-white rounded-xl font-bold outline-none focus:ring-2 ring-indigo-500/20" />
              </div>
              <input type="number" placeholder="AMEX" value={form.amex} onChange={(e) => setForm({...form, amex: e.target.value})} className="w-full p-3 bg-blue-50 rounded-xl font-bold outline-none focus:ring-2 ring-blue-500/20 text-blue-700" />
            </div>
          </div>
          
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Software y Apps (Bruto)</h4>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" placeholder="Glovo" value={form.glovo} onChange={(e) => setForm({...form, glovo: e.target.value})} className="p-3 bg-orange-50/50 rounded-xl font-bold text-sm outline-none" />
              <input type="number" placeholder="Uber" value={form.uber} onChange={(e) => setForm({...form, uber: e.target.value})} className="p-3 bg-indigo-50/50 rounded-xl font-bold text-sm outline-none" />
              <input type="number" placeholder="Madisa" value={form.madisa} onChange={(e) => setForm({...form, madisa: e.target.value})} className="p-3 bg-rose-50/50 rounded-xl font-bold text-sm outline-none" />
              <input type="number" placeholder="ApperStreet" value={form.apperStreet} onChange={(e) => setForm({...form, apperStreet: e.target.value})} className="p-3 bg-teal-50/50 rounded-xl font-bold text-sm outline-none" />
            </div>
            
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
               <div className="flex justify-between items-center text-[9px] font-black text-slate-400 uppercase">
                  <span>Bruto Ticket: {appsBrutas.toFixed(2)}€</span>
                  <span className="text-orange-500">NETO REAL: {appsNetas.toFixed(2)}€</span>
               </div>
            </div>

            <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 relative mt-4">
              <label className="text-[9px] font-black text-emerald-700 uppercase block mb-2">Desvío a Tienda Sakes</label>
              <input type="number" placeholder="0.00" value={form.tienda} onChange={(e) => setForm({...form, tienda: e.target.value})} className="w-full p-3 bg-white rounded-xl text-lg font-black outline-none focus:ring-2 ring-emerald-500/30 text-emerald-700" />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">3. Arqueo y Balance</h4>
            <div>
              <input type="number" placeholder="Dinero Físico en Cajón" value={form.cajaFisica} onChange={(e) => setForm({...form, cajaFisica: e.target.value})} className={cn("w-full p-4 rounded-2xl text-2xl font-black outline-none transition-colors", descuadreVivo !== null && Math.abs(descuadreVivo) > 2 ? "bg-rose-900 text-white shadow-[0_0_15px_rgba(225,29,72,0.3)] ring-2 ring-rose-500" : "bg-slate-900 text-emerald-400")} />
              
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                  <label className="text-[8px] font-black text-slate-500 uppercase block mb-1">Fondo Fijo Sobre</label>
                  <input type="number" value={fondoCaja} onChange={(e) => setFondoCaja(Num.parse(e.target.value))} className="w-full bg-transparent text-sm font-bold outline-none text-slate-700" />
                </div>
                <div className="bg-indigo-50 p-2 rounded-xl border border-indigo-100">
                  <label className="text-[8px] font-black text-indigo-500 uppercase block mb-1">Ingreso a Banco</label>
                  <input type="number" placeholder="0.00" value={depositoBanco} onChange={(e) => setDepositoBanco(e.target.value)} className="w-full bg-transparent text-sm font-bold outline-none text-indigo-700" />
                </div>
              </div>

              <AnimatePresence>
                {descuadreVivo !== null && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className={cn("mt-3 text-xs font-black flex items-center gap-1.5 p-2 rounded-xl", Math.abs(descuadreVivo) <= 2 ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50 border border-rose-200")}>
                    {Math.abs(descuadreVivo) <= 2 ? <><CheckCircle2 className="w-4 h-4" /> CAJA PERFECTA</> : descuadreVivo > 0 ? <><AlertTriangle className="w-4 h-4" /> SOBRAN {descuadreVivo.toFixed(2)}€</> : <><AlertTriangle className="w-4 h-4" /> FALTAN {Math.abs(descuadreVivo).toFixed(2)}€</>}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
            <div className="pt-4 border-t border-slate-100 flex justify-between items-end">
               <div>
                  <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block mb-0.5">Restaurante Neto</span>
                  <span className="text-xl font-black text-indigo-600">{totalRestauranteNeto.toFixed(2)}€</span>
               </div>
               <div className="text-right">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Caja Bruta Total</span>
                  <span className="text-3xl font-black text-slate-800 tracking-tighter">{totalCalculadoBruto.toFixed(2)}€</span>
               </div>
            </div>
          </div>
        </div>

        {/* CAJA DE NOTAS AMPLIADA PARA VER TU TEXTO Y PODER BORRARLO */}
        <div className="mt-8 relative group">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Notas de Caja / Transcripción</label>
          <textarea 
            value={form.notas} 
            onChange={(e) => setForm({...form, notas: e.target.value})} 
            placeholder="Lo que dictes por voz se escribirá aquí..."
            className="w-full p-4 pr-10 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-medium outline-none min-h-[100px] resize-y focus:border-indigo-300 transition-colors"
          ></textarea>
          {form.notas.length > 0 && (
             <button 
               onClick={() => setForm({...form, notas: ''})} 
               className="absolute top-8 right-4 text-slate-300 hover:text-rose-500 transition-colors"
               title="Borrar todas las notas"
             >
               <XCircle className="w-5 h-5" />
             </button>
          )}
        </div>

        <div className="mt-6 p-6 border border-amber-100 bg-amber-50/50 rounded-[2rem]">
          <div className="flex items-center gap-2 mb-4">
            <Banknote className="w-4 h-4 text-amber-500" />
            <p className="text-xs font-black text-amber-700 uppercase tracking-widest">Gastos Pagados con Efectivo de Caja</p>
          </div>
          <GastoCajaEditor gastos={gastosCaja} onAdd={(g) => setGastosCaja(prev => [...prev, g])} onDelete={(i) => setGastosCaja(prev => prev.filter((_,idx) => idx !== i))} />
        </div>

        <div className="mt-6 border-t border-slate-100 pt-6">
          <button onClick={handleSaveCierre} disabled={isSaving || scanStatus === 'loading'} className="w-full py-5 bg-slate-900 text-white rounded-[2rem] font-black text-sm shadow-2xl hover:bg-indigo-600 transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSaving ? "GUARDANDO..." : `GUARDAR CIERRE (${totalRestauranteNeto.toFixed(2)}€ REALES)`}
          </button>
        </div>
      </div>

      {/* 🚀 HISTORIAL MEJORADO (LLAMA AL NUEVO COMPONENTE DE RENDIMIENTO) */}
      <div className="space-y-4 mt-12">
        <div className="flex justify-between items-center px-6">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Historial de Cierres</h3>
        </div>
        
        <CashHistoryList 
          cierresMes={kpis.cierresMes} 
          cashUnits={CASH_UNITS} 
          facturas={data.facturas || []} 
          onDelete={handleDeleteCierre} 
        />
      </div>

      {/* MODAL DE EXPORTACIÓN GESTORÍA */}
      <AnimatePresence>
        {isExportModalOpen && (
          <motion.div 
            key="export-modal"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex justify-center items-center p-4"
          >
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setIsExportModalOpen(false)} />
            <motion.div 
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative z-10"
            >
              <h3 className="text-xl font-black text-slate-800 mb-2">Exportar Cierres Z</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">Generar Excel para Gestoría</p>
              
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Año Fiscal</label>
                  <input 
                    type="number" value={exportYear} onChange={(e) => setExportYear(Number(e.target.value))}
                    className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-black border-0 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Trimestre</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map(q => (
                      <button
                        key={q} onClick={() => setExportQuarter(q)}
                        className={cn(
                          "py-3 rounded-xl text-xs font-black transition",
                          exportQuarter === q ? "bg-emerald-600 text-white shadow-lg" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                        )}
                      >
                        Q{q}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="pt-4">
                  <button onClick={handleExportGestoria} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-slate-800 active:scale-95 transition flex justify-center items-center gap-2">
                    <Download className="w-4 h-4" /> DESCARGAR EXCEL
                  </button>
                  <button onClick={() => setIsExportModalOpen(false)} className="w-full text-slate-400 text-xs font-bold py-3 hover:text-slate-600 mt-2">
                    Cancelar
                  </button>
                </div>
              </div>
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
        <input value={row.concepto} onChange={(e)=>setRow({...row, concepto: e.target.value})} placeholder="Concepto (ej: Pan)" className="md:col-span-2 p-3 rounded-xl bg-white text-xs font-bold border border-amber-200 outline-none focus:border-amber-400" />
        <input value={row.importe} onChange={(e)=>setRow({...row, importe: e.target.value})} placeholder="Importe total €" type="number" className="p-3 rounded-xl bg-white text-xs font-bold border border-amber-200 outline-none focus:border-amber-400" />
        <select value={row.iva} onChange={(e)=>setRow({...row, iva: Number(e.target.value) as 4|10|21})} className="p-3 rounded-xl bg-white text-xs font-bold border border-amber-200 outline-none">
          <option value={4}>IVA 4%</option><option value={10}>IVA 10%</option><option value={21}>IVA 21%</option>
        </select>
        <button onClick={() => { if (!row.concepto || !row.importe) return; onAdd(row); setRow({ concepto: '', importe: '', iva: 10, unidad: 'REST' }); }} className="p-3 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase hover:bg-amber-600 transition flex items-center justify-center gap-1">
          <Plus className="w-3 h-3"/> Añadir
        </button>
      </div>
      
      {gastos.length > 0 && (
        <div className="mt-4 space-y-2 bg-white/50 p-3 rounded-xl">
          {gastos.map((g,i)=>(
            <div key={i} className="text-xs flex justify-between items-center bg-white rounded-lg px-3 py-2 shadow-sm border border-amber-100">
              <span className="font-bold text-slate-700">{g.concepto} <span className="text-slate-400 font-normal ml-2">({g.iva}%)</span></span>
              <div className="flex items-center gap-4">
                <span className="font-black text-amber-600">{Number(g.importe).toFixed(2)}€</span>
                <button onClick={()=>onDelete(i)} className="text-rose-400 hover:text-rose-600"><Trash2 className="w-4 h-4"/></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
