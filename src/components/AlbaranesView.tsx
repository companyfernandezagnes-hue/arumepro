import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Truck, Search, Plus, Zap, Download, Trash2, Camera, AlertTriangle,
  CheckCircle2, Clock, FileSpreadsheet, Calculator, Building2, ShoppingBag, 
  Users, Hotel, Layers, Image as ImageIcon, Mic, Square, Edit3, Save, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Albaran } from '../types';
import { Num, ArumeEngine } from '../services/engine';
import { cn } from '../lib/utils';
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

/* =======================================================
 * 🛡️ MOTOR DE RECONCILIACIÓN Y VALIDACIÓN IA
 * ======================================================= */

type LineaIA = {
  qty: number; name: string; unit: string; unit_price: number;
  tax_rate: 4 | 10 | 21; total: number;
};

type AlbaranIA = {
  proveedor: string; fecha: string; num: string; unidad?: 'REST' | 'SHOP';
  lineas: LineaIA[]; sum_base?: number; sum_tax?: number; sum_total?: number;
};

const TOL = 0.01;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const asNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const normalizeDate = (s?: string) => {
  const v = String(s ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : new Date().toLocaleDateString('sv-SE');
};

const norm = (s: string) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function reconcileAlbaran(ai: AlbaranIA) {
  const lines = ai.lineas.map(l => {
    const rate = (l.tax_rate ?? 10) as 4|10|21;
    const total = round2(Number(l.total) || 0);
    const base  = round2(total / (1 + rate / 100));
    const tax   = round2(total - base);
    return { ...l, tax_rate: rate, total, base, tax };
  });

  const base4  = round2(lines.filter(l => l.tax_rate === 4).reduce((a, l) => a + l.base, 0));
  const base10 = round2(lines.filter(l => l.tax_rate === 10).reduce((a, l) => a + l.base, 0));
  const base21 = round2(lines.filter(l => l.tax_rate === 21).reduce((a, l) => a + l.base, 0));
  const tax4   = round2(lines.filter(l => l.tax_rate === 4).reduce((a, l) => a + l.tax, 0));
  const tax10  = round2(lines.filter(l => l.tax_rate === 10).reduce((a, l) => a + l.tax, 0));
  const tax21  = round2(lines.filter(l => l.tax_rate === 21).reduce((a, l) => a + l.tax, 0));

  const sum_base = round2(base4 + base10 + base21);
  const sum_tax  = round2(tax4 + tax10 + tax21);
  const sum_total_calc = round2(lines.reduce((a, l) => a + l.total, 0));

  const declared_total = Number(ai.sum_total ?? sum_total_calc);
  const diff = round2(sum_total_calc - declared_total);
  const cuadra = Math.abs(diff) <= TOL;

  return {
    ...ai, lineas: lines, sum_base, sum_tax, sum_total: sum_total_calc,
    by_rate: { 4: { base: base4, tax: tax4 }, 10: { base: base10, tax: tax10 }, 21: { base: base21, tax: tax21 } },
    diff, cuadra,
  };
}

const extractJSON = (rawText: string) => {
  try {
    if (!rawText) return {};
    const clean = rawText.replace(/(?:json)?/gi, '').replace(/\uFEFF/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) return {};
    return JSON.parse(clean.substring(start, end + 1));
  } catch { return {}; }
};

const cleanMime = (t: string) => {
  const base = (t || '').split(';')[0].trim().toLowerCase();
  const ok = ['audio/webm','audio/ogg','audio/mpeg','audio/mp3','audio/wav','audio/mp4'];
  return ok.includes(base) ? base : 'audio/webm';
};

// 🚀 COMPRESIÓN ULTRA RÁPIDA (Devuelve solo Base64, menos uso de memoria RAM)
const compressImageToBase64 = async (file: File | Blob): Promise<string> => {
  const MAX_W = 1200, MAX_H = 1200; 
  const Q1 = 0.72, Q2 = 0.6;
  const MAX_BYTES = 2.5 * 1024 * 1024; 

  const bmp = await createImageBitmap(file);
  let { width: w, height: h } = bmp;
  const r = Math.min(MAX_W / w, MAX_H / h, 1);
  w = Math.round(w * r); h = Math.round(h * r);

  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  cvs.getContext('2d', { alpha: false })!.drawImage(bmp, 0, 0, w, h);

  const toB64 = (q: number) => new Promise<string>(res => {
    cvs.toBlob(b => {
      const fr = new FileReader();
      fr.onload = () => res((fr.result as string).split(',')[1]);
      fr.readAsDataURL(b as Blob);
    }, 'image/jpeg', q);
  });

  let b64 = await toB64(Q1);
  const bytes = Math.floor(b64.length * 3 / 4);
  if (bytes > MAX_BYTES) b64 = await toB64(Q2);
  
  return b64; 
};

// Vista Ligera (Libera memoria)
const objectUrlFromFile = (f: File | Blob) => URL.createObjectURL(f);

const callGemini = async (apiKey: string, mimeType: string, base64Data: string, prompt: string) => {
  const genAI = new GoogleGenAI({ apiKey });
  const response = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType } }] }],
    config: { responseMimeType: "application/json", temperature: 0.1 }
  });
  const raw = response.text || "";
  return raw.includes('{') ? JSON.parse(raw) : extractJSON(raw);
};

const PROMPT_ALBARAN = `Analiza este albarán. Devuelve SOLO JSON estricto:
{
  "proveedor": "string", "fecha": "YYYY-MM-DD", "num": "string", "unidad": "REST" | "SHOP",
  "lineas": [ {"qty": 1, "name": "string", "unit": "ud|kg|l", "unit_price": 0, "tax_rate": 4|10|21, "total": 0} ],
  "sum_total": 0
}
REGLAS: "lineas[].total" es el total de la línea CON IVA. tax_rate solo 4, 10 o 21 (Alcohol 21). Dirección Av. Argentina="REST", Catalunya="SHOP".`;

const PROMPT_VOICE_NEW = `Transcribe el albarán dictado. Devuelve SOLO JSON con:
{
  "proveedor": "string", "fecha": "YYYY-MM-DD", "num": "string", "unidad": "REST",
  "lineas": [ {"qty": 1, "name": "string", "unit": "ud", "unit_price": 0, "tax_rate": 4|10|21, "total": 0} ],
  "sum_total": 0
}
REGLAS: tax_rate sólo 4, 10 o 21. Número como number con punto.`;


/* =======================================================
 * COMPONENTE PRINCIPAL
 * ======================================================= */
export const AlbaranesView = ({ data, onSave }: AlbaranesViewProps) => {
  const [searchQ, setSearchQ] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL'); 
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [priceAlerts, setPriceAlerts] = useState<{n: string, old: number, new: number}[]>([]);
  const [scannedImage, setScannedImage] = useState<string | null>(null);
  
  // Estados de Voz
  const [recordingMode, setRecordingMode] = useState<'new' | 'edit' | null>(null);
  const mediaRecRef = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Formularios Originales
  const [form, setForm] = useState({
    prov: '', date: new Date().toLocaleDateString('sv-SE'), num: '', socio: 'Arume', notes: '', text: '',
    paid: false, forceDup: false, unitId: 'REST' as BusinessUnit 
  });
  
  const [editingAlbaran, setEditingAlbaran] = useState<Albaran | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Albaran | null>(null);

  const uniqueProviders = useMemo(() => {
    return Array.from(new Set((data.albaranes || []).map(a => a.prov).filter(Boolean))).sort();
  }, [data.albaranes]);

  // 🚀 ALERTAS DE PRECIO O(1) (Ultra Rápido)
  const priceIndex = useMemo(() => {
    const m = new Map<string, number>();
    (data.albaranes || []).forEach(a => {
      (a.items || []).forEach(it => {
        const k = norm(it.n);
        m.set(k, it.unitPrice ?? (it.q ? Num.round2(it.t / it.q) : it.t));
      });
    });
    return m;
  }, [data.albaranes]);

  const parseSmartLine = (line: string) => {
    let clean = line.replace(/[€$]/g, '').replace(/,/g, '.').trim();
    if (clean.length < 5) return null;
    let rate = 10; 
    if (clean.match(/\b21\s?%/)) rate = 21; else if (clean.match(/\b4\s?%/)) rate = 4;
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

  const analyzedItems = useMemo(() => form.text.split('\n').map(parseSmartLine).filter(Boolean), [form.text]);
  const liveTotals = useMemo(() => {
    const taxes = { 4: { b: 0, i: 0 }, 10: { b: 0, i: 0 }, 21: { b: 0, i: 0 } };
    let grandTotal = 0;
    analyzedItems.forEach(it => {
      if (it) {
        taxes[it.rate as 4|10|21].b += it.base;
        taxes[it.rate as 4|10|21].i += it.tax;
        grandTotal += it.t;
      }
    });
    return { grandTotal, taxes };
  }, [analyzedItems]);


  // 🚀 1. LECTOR IMAGEN IA (Versión Rápida)
  const processImageWithAI = async (file: File | Blob) => {
    const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("⚠️ Conecta tu IA primero en Configuración.");

    setIsAnalyzing(true);
    setPriceAlerts([]);
    
    try {
      const objUrl = objectUrlFromFile(file);
      setScannedImage(objUrl);

      const base64Data = await compressImageToBase64(file);
      const datosIA = await callGemini(apiKey, "image/jpeg", base64Data, PROMPT_ALBARAN);

      const al: AlbaranIA = {
        proveedor: datosIA.proveedor || "Desconocido", fecha: normalizeDate(datosIA.fecha),
        num: datosIA.num || "S/N", unidad: (datosIA.unidad === 'SHOP' ? 'SHOP' : 'REST'),
        lineas: Array.isArray(datosIA.lineas) ? datosIA.lineas : [], sum_total: asNum(datosIA.sum_total),
      };

      const rec = reconcileAlbaran(al);
      
      const alerts: any[] = [];
      rec.lineas.forEach(nl => {
        const lastPrice = priceIndex.get(norm(nl.name));
        const currentUnit = nl.unit_price ?? (nl.qty ? round2(nl.total / nl.qty) : nl.total);
        if (lastPrice && currentUnit > lastPrice * 1.05) { 
          alerts.push({ n: nl.name, old: lastPrice, new: currentUnit });
        }
      });
      setPriceAlerts(alerts);
      
      setForm(prev => ({
        ...prev, prov: rec.proveedor, date: rec.fecha, num: rec.num, unitId: rec.unidad || 'REST',
        text: rec.lineas.map(l => `${l.qty}x ${l.name} ${l.total}`).join('\n') 
      }));

    } catch (err: any) {
      console.error(err);
      alert(`⚠️ Problema leyendo el ticket. Error: ${err.message}`);
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

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (isAnalyzing || recordingMode) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) { processImageWithAI(blob); break; }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [data, isAnalyzing, recordingMode]);


  // 🎙️ MAGIA DE VOZ LIGERA (NUEVO O EDICIÓN)
  const startVoiceRecording = async (mode: 'new' | 'edit') => {
    if (recordingMode) {
      mediaRecRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus', // Opus muy ligero
        audioBitsPerSecond: 24_000, 
      });
      
      mediaRecRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const mimeType = cleanMime(mr.mimeType);
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        stream.getTracks().forEach(t => t.stop());
        setRecordingMode(null);
        await processVoice(audioBlob, mimeType, mode);
      };

      mr.start();
      setRecordingMode(mode);
      setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, 60000);
    } catch {
      alert("No se pudo acceder al micrófono.");
    }
  };

  const processVoice = async (audioBlob: Blob, mimeType: string, mode: 'new' | 'edit') => {
    const apiKey = sessionStorage.getItem('gemini_api_key') || localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("Conecta tu IA primero.");

    setIsAnalyzing(true);
    try {
      const base64 = await new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve((fr.result as string).split(',')[1]);
        fr.readAsDataURL(audioBlob);
      });

      let prompt = "";
      if (mode === 'new') {
        prompt = PROMPT_VOICE_NEW;
      } else {
        prompt = `Aquí tienes el JSON de un albarán actual:
        ${JSON.stringify(editForm)}
        Escucha el audio y aplica las modificaciones solicitadas.
        Devuelve SOLO el JSON actualizado manteniendo la estructura original:
        { "proveedor": "string", "fecha": "YYYY-MM-DD", "num": "string", "unidad": "REST"|"SHOP", "lineas": [ {"qty": 1, "name": "string", "unit": "ud", "unit_price": 0, "tax_rate": 4|10|21, "total": 0} ] }
        REGLAS: tax_rate sólo 4, 10 o 21. "total" de línea es CON IVA.`;
      }

      const datosIA = await callGemini(apiKey, mimeType, base64, prompt);

      const al: AlbaranIA = {
        proveedor: datosIA.proveedor || "Desconocido", fecha: normalizeDate(datosIA.fecha),
        num: datosIA.num || "S/N", unidad: (datosIA.unidad === 'SHOP' ? 'SHOP' : 'REST'),
        lineas: Array.isArray(datosIA.lineas) ? datosIA.lineas : [], sum_total: asNum(datosIA.sum_total),
      };
      
      const rec = reconcileAlbaran(al);
      const itemsReconciliados = rec.lineas.map(l => ({
        q: l.qty, n: l.name, unit: l.unit, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax,
        unitPrice: l.unit_price ?? (l.qty ? round2(l.total / l.qty) : l.total),
      }));

      if (mode === 'new') {
        setForm(prev => ({
          ...prev, prov: rec.proveedor, date: rec.fecha, num: rec.num, unitId: rec.unidad || 'REST',
          text: itemsReconciliados.map(l => `${l.q}x ${l.n} ${l.t}`).join('\n')
        }));
      } else if (mode === 'edit' && editForm) {
        setEditForm({
          ...editForm, prov: rec.proveedor, date: rec.fecha, num: rec.num, unitId: rec.unidad || 'REST',
          items: itemsReconciliados, total: rec.sum_total, base: rec.sum_base, taxes: rec.sum_tax
        });
        alert("✨ ¡Albarán modificado por voz y recalculado!");
      }
    } catch (e: any) {
      alert("La IA no entendió el dictado o hubo un error.");
    } finally {
      setIsAnalyzing(false);
    }
  };


  // 🚀 TU FUNCIÓN ORIGINAL DE GUARDADO INTACTA
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

    setForm({ prov: '', date: new Date().toLocaleDateString('sv-SE'), num: '', socio: 'Arume', notes: '', text: '', paid: false, forceDup: false, unitId: 'REST' });
    setPriceAlerts([]);
    setScannedImage(null); 
    alert("¡Albarán guardado correctamente en su bloque!");
  };


  // 🚀 GESTIÓN DEL MODAL Y EDICIÓN MANUAL
  const openEditModal = (albaran: Albaran) => {
    setEditingAlbaran(albaran);
    setEditForm(albaran); 
    setIsEditMode(false);
  };

  const handleSaveEdits = async () => {
    if (!editForm) return;
    const newData = { ...data };
    const index = newData.albaranes.findIndex(a => a.id === editForm.id);
    if (index !== -1) {
      let total = 0, base = 0, taxes = 0;
      editForm.items?.forEach(it => { total += it.t; base += it.base; taxes += it.tax; });
      
      newData.albaranes[index] = { ...editForm, total: Num.round2(total), base: Num.round2(base), taxes: Num.round2(taxes) };
      await onSave(newData);
      setEditingAlbaran(newData.albaranes[index]);
      setIsEditMode(false);
      alert("Albarán actualizado.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar gasto permanentemente?")) return;
    const newData = { ...data };
    newData.albaranes = newData.albaranes.filter(a => a.id !== id);
    await onSave(newData);
    setEditingAlbaran(null);
  };

  const deleteItemFromEdit = (index: number) => {
    if (!editForm || !editForm.items) return;
    const newItems = [...editForm.items];
    newItems.splice(index, 1);
    setEditForm({ ...editForm, items: newItems });
  };
  
  const vaciarItems = () => {
    if (!editForm) return;
    setEditForm({ ...editForm, items: [] });
  };

  // KPIs y Filtros
  const kpis = useMemo(() => {
    const hoy = new Date(); const mesActual = hoy.getMonth(); const añoActual = hoy.getFullYear(); const trimActual = Math.floor(mesActual / 3) + 1;
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


  return (
    <div className={cn("animate-fade-in space-y-6 pb-24", isAnalyzing && "transition-none")}>
      <datalist id="providers-list">
        {uniqueProviders.map(p => <option key={p} value={p} />)}
      </datalist>

      {/* OVERLAY SUTIL DE VOZ (No bloquea la pantalla) */}
      {recordingMode && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[300] px-4 py-2 rounded-full bg-rose-600 text-white text-[10px] font-black shadow-lg animate-pulse flex items-center gap-2 cursor-pointer" onClick={() => startVoiceRecording(recordingMode)}>
          <Mic className="w-3 h-3" />
          🎙️ Grabando... Pulsa aquí para detener
        </div>
      )}

      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tighter">Compras & Gastos</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">IA Pro Reconciliación</p>
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

          {/* BOTÓN NUEVO POR VOZ */}
          <button 
            onClick={() => startVoiceRecording('new')}
            disabled={isAnalyzing}
            className={cn("px-4 py-3 rounded-2xl text-[10px] font-black uppercase transition-all shadow-md flex items-center justify-center gap-2", recordingMode === 'new' ? "bg-rose-500 text-white" : "bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50")}
          >
            <Mic className="w-4 h-4" />
            DICTAR ALBARÁN
          </button>

          <label className={cn("bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-5 py-3 rounded-2xl text-[10px] font-black transition shadow-md flex items-center gap-2", isAnalyzing ? "opacity-50 cursor-wait" : "hover:shadow-lg hover:scale-105 cursor-pointer")}>
            <Camera className="w-4 h-4" />
            <span>SUBIR IMAGEN (Ctrl+V)</span>
            <input type="file" disabled={isAnalyzing} onChange={handleDirectScan} className="hidden" accept="image/*, application/pdf" />
          </label>
        </div>
      </header>

      {/* Selector Multi-Bloque Global */}
      <div className="flex flex-wrap gap-2 px-1">
        <button onClick={() => setSelectedUnit('ALL')} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === 'ALL' ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}>
          <Layers className="w-3 h-3" /> Ver Todos
        </button>
        {BUSINESS_UNITS.map(unit => (
          <button key={unit.id} onClick={() => setSelectedUnit(unit.id)} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === unit.id ? `${unit.color.replace('text-', 'bg-')} text-white border-transparent shadow-md` : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}>
            <unit.icon className="w-3 h-3" /> {unit.name}
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
        {/* Formulario Lateral */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border-2 border-indigo-50 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500"></div>
            
            {isAnalyzing && !recordingMode && (
              <div className="absolute inset-0 bg-white/95 z-20 flex flex-col items-center justify-center text-center p-4 backdrop-blur-sm">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                <p className="text-xs font-black text-indigo-600 animate-pulse uppercase tracking-widest">Analizando...</p>
              </div>
            )}

            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><Plus className="w-4 h-4 text-indigo-500" /> Nueva Factura</span>
            </h3>

            {/* PREVIEW IMAGEN (Ligera, sin colgar RAM) */}
            <AnimatePresence>
              {scannedImage && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-4">
                  <div className="relative w-full h-32 bg-slate-100 rounded-2xl overflow-hidden border border-slate-200">
                    <img src={scannedImage} alt="Ticket Scaneado" className="w-full h-full object-cover opacity-80" />
                    <button onClick={() => { URL.revokeObjectURL(scannedImage); setScannedImage(null); }} className="absolute top-2 right-2 bg-slate-900/50 text-white p-1.5 rounded-lg hover:bg-rose-500 transition"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className={cn("mb-4 p-3 rounded-2xl border transition-colors", form.unitId === 'REST' ? "bg-indigo-50/50 border-indigo-100" : form.unitId === 'DLV' ? "bg-amber-50/50 border-amber-100" : "bg-emerald-50/50 border-emerald-100")}>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 text-center">Asignar a Bloque:</p>
              <div className="grid grid-cols-2 gap-2">
                {BUSINESS_UNITS.map(unit => (
                  <button key={unit.id} onClick={() => setForm({ ...form, unitId: unit.id })} className={cn("p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1.5", form.unitId === unit.id ? `${unit.color.replace('text-', 'border-')} ${unit.bg} ${unit.color} shadow-sm` : "border-slate-100 bg-white text-slate-400 grayscale hover:grayscale-0")}>
                    <unit.icon className="w-4 h-4" />
                    <span className="text-[8px] font-black uppercase text-center leading-tight">{unit.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {priceAlerts.length > 0 && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-2xl space-y-2 animate-bounce-subtle">
                <p className="text-[10px] font-black text-rose-600 uppercase flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> ¡Alerta de Precios!</p>
                {priceAlerts.map((alt, i) => <p key={i} className="text-[9px] text-rose-500 font-bold">{alt.n}: Costaba {Num.fmt(alt.old)} → <span className="font-black underline">{Num.fmt(alt.new)}</span></p>)}
              </div>
            )}

            <div className="space-y-3 mb-4">
              <input value={form.prov} onChange={(e) => setForm({ ...form, prov: e.target.value })} list="providers-list" type="text" placeholder="Proveedor" className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none focus:ring-2 focus:ring-indigo-500 transition" />
              <div className="flex gap-2">
                <input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} type="date" className="flex-1 p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none" />
                <input value={form.num} onChange={(e) => setForm({ ...form, num: e.target.value })} type="text" placeholder="Ref." className="w-1/3 p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none" />
              </div>
            </div>

            <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Ej: 5 kg Salmón 150.00" className="w-full h-32 bg-slate-50 rounded-2xl p-4 text-xs font-mono border-0 outline-none resize-none mb-3 shadow-inner focus:bg-white transition" />
            
            <div className="mt-3 space-y-1 max-h-52 overflow-y-auto custom-scrollbar px-1 bg-slate-50/50 rounded-xl p-2 min-h-[50px]">
              {analyzedItems.length > 0 ? analyzedItems.map((it, idx) => it && (
                <div key={idx} className="flex justify-between items-center text-[10px] border-b border-slate-200 py-2 last:border-0">
                  <span className="truncate pr-2 font-bold text-slate-700"><b>{it.q}x</b> {it.n} <span className="text-[8px] text-slate-400">({it.rate}%)</span></span>
                  <span className="font-black text-slate-900 whitespace-nowrap">{Num.fmt(it.t)}</span>
                </div>
              )) : <p className="text-[10px] text-slate-300 text-center italic py-2">Sin productos...</p>}
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
                <input type="checkbox" id="inPaid" checked={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.checked })} className="w-4 h-4 accent-indigo-600 cursor-pointer" />
                <label htmlFor="inPaid" className="text-xs font-bold text-slate-600 cursor-pointer">Pagado Contado</label>
              </div>
            </div>

            <button disabled={isAnalyzing} onClick={handleSaveAlbaran} className="w-full mt-4 bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-indigo-700 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">GUARDAR COMPRA</button>
          </div>
        </div>

        {/* Lista Central */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-2 rounded-full shadow-sm border border-slate-100 flex items-center px-4">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} type="text" placeholder="Buscar por proveedor o referencia..." className="bg-transparent text-sm font-bold outline-none w-full text-slate-600 pl-3" />
          </div>

          <div className="space-y-3 pb-20">
            {filteredAlbaranes.length > 0 ? filteredAlbaranes.map(a => {
              const unitConfig = BUSINESS_UNITS.find(u => u.id === (a.unitId || 'REST'));
              return (
                <div key={a.id} onClick={() => openEditModal(a)} className={cn("bg-white p-5 rounded-3xl border border-slate-100 flex justify-between items-center shadow-sm hover:shadow-md transition cursor-pointer", a.reconciled && "ring-2 ring-emerald-400/50")}>
                  <div>
                    <h4 className="font-black text-slate-800 flex items-center gap-2 flex-wrap">
                      {a.prov}
                      {unitConfig && <span className={cn("text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1", unitConfig.color, unitConfig.bg)}><unitConfig.icon className="w-3 h-3" />{unitConfig.name}</span>}
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
                    <span className={cn("text-[8px] font-black uppercase", a.paid ? 'text-emerald-500' : 'text-rose-500')}>{a.paid ? 'Pagado' : 'Pendiente'}</span>
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

      {/* 🚀 MODAL EDICIÓN Y VOZ (El nuevo centro de mando) */}
      <AnimatePresence>
        {editingAlbaran && editForm && (
          <div className="fixed inset-0 z-[200] flex justify-center items-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !recordingMode && setEditingAlbaran(null)} className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm" />
            
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="bg-white w-full max-w-xl rounded-[2.5rem] p-6 md:p-8 shadow-2xl relative z-10 flex flex-col max-h-[90vh]">
              <button disabled={recordingMode !== null} onClick={() => setEditingAlbaran(null)} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500 text-2xl transition disabled:opacity-0"><X className="w-6 h-6" /></button>
              
              <div className="border-b border-slate-100 pb-4 mb-6 flex justify-between items-end">
                <div>
                  <h3 className="text-2xl font-black text-slate-800 tracking-tighter">{isEditMode ? 'Editando Albarán' : 'Detalle del Gasto'}</h3>
                  <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1">Ref: {editForm.num}</p>
                </div>
                {!isEditMode && (
                  <button onClick={() => setIsEditMode(true)} className="bg-indigo-50 text-indigo-600 p-2 rounded-xl hover:bg-indigo-100 transition"><Edit3 className="w-5 h-5" /></button>
                )}
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6 relative">
                {/* Loader si edita por voz */}
                {recordingMode === 'edit' && (
                  <div className="absolute inset-0 bg-white/80 z-20 flex flex-col items-center justify-center backdrop-blur-sm rounded-2xl">
                    <Loader2 className="w-10 h-10 text-rose-500 animate-spin mb-4" />
                    <p className="text-xs font-black text-rose-600 animate-pulse uppercase tracking-widest">ESCUCHANDO Y RECALCULANDO...</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Proveedor</p>
                    {isEditMode ? <input value={editForm.prov} onChange={e => setEditForm({...editForm, prov: e.target.value})} className="w-full bg-white border border-slate-200 rounded p-1 text-sm font-bold" /> : <p className="text-sm font-black text-slate-800">{editForm.prov}</p>}
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Fecha</p>
                    {isEditMode ? <input type="date" value={editForm.date} onChange={e => setEditForm({...editForm, date: e.target.value})} className="w-full bg-white border border-slate-200 rounded p-1 text-sm font-bold" /> : <p className="text-sm font-black text-slate-800">{editForm.date}</p>}
                  </div>
                </div>

                <div className={cn("p-4 rounded-2xl border flex items-center gap-3", 
                  BUSINESS_UNITS.find(u => u.id === (editForm.unitId || 'REST'))?.bg,
                  BUSINESS_UNITS.find(u => u.id === (editForm.unitId || 'REST'))?.color
                )}>
                   <Layers className="w-5 h-5 opacity-50" />
                   <div>
                     <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Unidad de Negocio</p>
                     {isEditMode ? (
                       <select value={editForm.unitId || 'REST'} onChange={e => setEditForm({...editForm, unitId: e.target.value as BusinessUnit})} className="bg-transparent font-black text-sm outline-none">
                         {BUSINESS_UNITS.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                       </select>
                     ) : (
                       <p className="text-sm font-black">{BUSINESS_UNITS.find(u => u.id === (editForm.unitId || 'REST'))?.name}</p>
                     )}
                   </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center ml-2">
                    <p className="text-[9px] font-black text-slate-400 uppercase">Desglose de productos</p>
                    
                    {/* BOTONES DE EDICIÓN MÚLTIPLE */}
                    {isEditMode && (
                      <div className="flex gap-2">
                        <button 
                          onClick={vaciarItems}
                          className="bg-rose-50 text-rose-600 px-2 py-1.5 rounded-lg text-[9px] font-black uppercase hover:bg-rose-100 transition shadow-sm"
                        >
                          Vaciar Todo
                        </button>
                        <button 
                          onClick={() => startVoiceRecording('edit')}
                          className="bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 hover:bg-indigo-200 transition shadow-sm"
                        >
                          <Mic className="w-3 h-3" /> Dictar Cambios
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2">
                    {editForm.items?.map((it, i) => (
                      <div key={i} className="flex justify-between items-center text-xs border-b border-slate-200 last:border-0 pb-2 last:pb-0 pt-2 first:pt-0 group">
                        <span className="font-bold text-slate-700 flex-1"><b>{it.q}x</b> {it.n}</span>
                        <span className="font-black text-slate-900 mr-2">{Num.fmt(it.t)}</span>
                        {isEditMode && <button onClick={() => deleteItemFromEdit(i)} className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    ))}
                    <div className="mt-4 pt-2 border-t border-slate-300 border-dashed flex justify-between text-[10px] text-slate-500 font-bold">
                      <span>Base: {Num.fmt(editForm.base || 0)}</span>
                      <span>IVA: {Num.fmt(editForm.taxes || 0)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase">Total Importe</p>
                    <p className="text-3xl font-black text-emerald-400">{Num.fmt(editForm.total)}</p>
                  </div>
                  <div className="text-right">
                    {isEditMode ? (
                       <label className="flex items-center gap-2 cursor-pointer bg-slate-800 p-2 rounded-xl">
                         <input type="checkbox" checked={editForm.paid} onChange={e => setEditForm({...editForm, paid: e.target.checked})} className="w-4 h-4 accent-emerald-500" />
                         <span className="text-[10px] font-bold">PAGADO</span>
                       </label>
                    ) : (
                      <div className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase inline-block", editForm.paid ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400")}>
                        {editForm.paid ? 'Pagado' : 'Pendiente'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-100 flex gap-3">
                {isEditMode ? (
                  <>
                    <button onClick={() => setIsEditMode(false)} className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-black text-xs hover:bg-slate-200">CANCELAR</button>
                    <button onClick={handleSaveEdits} className="flex-[2] bg-indigo-600 text-white py-4 rounded-2xl font-black text-xs hover:bg-indigo-700 flex justify-center items-center gap-2 shadow-lg"><Save className="w-4 h-4" /> GUARDAR CAMBIOS</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleDelete(editingAlbaran.id)} className="flex-1 bg-rose-50 text-rose-500 py-4 rounded-2xl font-black text-xs hover:bg-rose-100 flex justify-center items-center gap-2"><Trash2 className="w-4 h-4" /> ELIMINAR</button>
                    <button onClick={() => setEditingAlbaran(null)} className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-black text-xs hover:bg-slate-200">CERRAR</button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
