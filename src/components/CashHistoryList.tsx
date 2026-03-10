import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  ChevronLeft, ChevronRight, CreditCard, Banknote, Truck, Sparkles, 
  Trash2, CheckCircle2, Clock, AlertTriangle, RefreshCw, Image as ImageIcon, 
  Scan, Building2, ShoppingBag, Layers, SplitSquareHorizontal, Mic, Square, Plus, Download, XCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
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

// --- UTILIDADES INTERNAS REFORZADAS ---
const asNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const normalizeDate = (s?: string) => {
  const v = String(s ?? '').trim(); 
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : DateUtil.today(); 
};

const extractJSON = (rawText: string) => {
  try {
    const clean = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{'); const end = clean.lastIndexOf('}');
    return JSON.parse(clean.substring(start, end + 1));
  } catch (err) { return {}; }
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
 * 🏦 COMPONENTE PRINCIPAL
 * ======================================================= */
export const CashView = ({ data, onSave }: CashViewProps) => {
  const [currentFilterDate, setCurrentFilterDate] = useState(new Date().toISOString().slice(0, 7));
  const [selectedUnit, setSelectedUnit] = useState<CashBusinessUnit | 'ALL'>('ALL'); 
  const [scanStatus, setScanStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [images, setImages] = useState<{ img1: string | null }>({ img1: null });
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  
  // 🎙️ IA de Voz
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState(''); 
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechRecRef = useRef<any>(null);

  const [form, setForm] = useState({
    date: DateUtil.today(), efectivo: '', tpv1: '', tpv2: '', amex: '', 
    glovo: '', uber: '', madisa: '', apperStreet: '',
    cajaFisica: '', tienda: '', notas: ''
  });

  const [fondoCaja, setFondoCaja] = useState<number>(300);
  const [depositoBanco, setDepositoBanco] = useState<string>(''); 
  const [gastosCaja, setGastosCaja] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // 🧠 CÁLCULOS NETOS (Arume Logic)
  const totalTarjetas = useMemo(() => Num.parse(form.tpv1) + Num.parse(form.tpv2) + Num.parse(form.amex), [form.tpv1, form.tpv2, form.amex]);
  const appsBrutas = useMemo(() => Num.parse(form.glovo) + Num.parse(form.uber) + Num.parse(form.madisa) + Num.parse(form.apperStreet), [form.glovo, form.uber, form.madisa, form.apperStreet]);
  const appsNetas = useMemo(() => {
    const g = Num.parse(form.glovo) * (1 - COMISIONES.glovo);
    const u = Num.parse(form.uber) * (1 - COMISIONES.uber);
    return Num.round2(g + u + (Num.parse(form.madisa) + Num.parse(form.apperStreet)));
  }, [form.glovo, form.uber, form.madisa, form.apperStreet]);

  const totalCalculadoBruto = useMemo(() => Num.parse(form.efectivo) + totalTarjetas + appsBrutas, [form.efectivo, totalTarjetas, appsBrutas]);
  const totalRestauranteNeto = useMemo(() => (Num.parse(form.efectivo) + totalTarjetas + appsNetas) - Num.parse(form.tienda), [form.efectivo, totalTarjetas, appsNetas, form.tienda]);

  const descuadreVivo = useMemo(() => {
    if (form.cajaFisica === '' || form.efectivo === '') return null;
    return Num.round2(Num.parse(form.cajaFisica) - (Num.parse(form.efectivo) + fondoCaja));
  }, [form.cajaFisica, form.efectivo, fondoCaja]);

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

  // 🎙️ LÓGICA DE GRABACIÓN E IA
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      if (speechRecRef.current) speechRecRef.current.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'es-ES'; recognition.continuous = true; recognition.interimResults = true;
        recognition.onresult = (e: any) => { setLiveTranscript(Array.from(e.results).map((r: any) => r[0].transcript).join('')); };
        speechRecRef.current = recognition; recognition.start();
      }
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr; audioChunksRef.current = [];
      mr.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mr.mimeType });
        setForm(prev => ({ ...prev, notas: prev.notas + "\n🎤 " + liveTranscript }));
        await processAudioWithAI(audioBlob, mr.mimeType);
      };
      mr.start(); setIsRecording(true);
    } catch (err) { alert("Error acceso micro"); }
  };

  const processAudioWithAI = async (blob: Blob, mime: string) => {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return;
    setScanStatus('loading');
    try {
      const b64 = await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res((fr.result as string).split(',')[1]); fr.readAsDataURL(blob); });
      const ai = new GoogleGenAI(apiKey);
      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `Analiza este audio de caja y extrae: efectivo, tpv1, tpv2, amex, glovo, uber, tienda. Devuelve SOLO JSON.`;
      const result = await model.generateContent([{ inlineData: { data: b64, mimeType: mime.includes('webm') ? 'audio/webm' : 'audio/mp4' } }, { text: prompt }]);
      const dataIA = extractJSON(result.response.text());
      setForm(prev => ({ ...prev, efectivo: String(dataIA.efectivo || prev.efectivo), tpv1: String(dataIA.tpv1 || prev.tpv1), tienda: String(dataIA.tienda || prev.tienda) }));
      setScanStatus('success');
    } catch (e) { setScanStatus('error'); } finally { setTimeout(() => setScanStatus('idle'), 3000); }
  };

  // 📷 OCR DE TICKET
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("Conecta la IA en Ajustes.");
    setScanStatus('loading');
    try {
      const b64 = await compressImageToBase64(file);
      const ai = new GoogleGenAI(apiKey);
      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `Analiza este ticket Z de caja. Extrae fecha, efectivo total, tpv1, tpv2, amex y ventas de apps. Devuelve SOLO JSON.`;
      const response = await model.generateContent([{ inlineData: { data: b64, mimeType: "image/jpeg" } }, { text: prompt }]);
      const json = extractJSON(response.response.text());
      setForm(prev => ({ ...prev, date: json.fecha || prev.date, efectivo: String(json.efectivo || prev.efectivo), tpv1: String(json.tpv1 || prev.tpv1), amex: String(json.amex || prev.amex) }));
      setScanStatus('success');
    } catch (e) { setScanStatus('error'); } finally { setTimeout(() => setScanStatus('idle'), 3000); }
  };

  // 💾 GUARDADO BLINDADO (ERP Ready)
  const handleSaveCierre = async () => {
    if (isSaving || totalCalculadoBruto <= 0) return;
    setIsSaving(true);
    try {
      const newData = jsonSafeClone(data);
      const fecha = form.date;
      const cierreId = `ZR-${fecha.replace(/-/g, '')}`;

      // 1. Gastos de caja -> Facturas tipo 'caja'
      gastosCaja.forEach((g, idx) => {
        const imp = Num.parse(g.importe);
        const base = Num.round2(imp / 1.10);
        newData.facturas.unshift({
            id: `gc-${Date.now()}-${idx}`, tipo: 'caja', num: `GC-${fecha}-${idx}`,
            date: fecha, prov: g.concepto.toUpperCase(), total: imp, base, tax: imp - base,
            paid: true, reconciled: true, unidad_negocio: 'REST'
        });
      });

      // 2. Ingreso a banco
      if (Num.parse(depositoBanco) > 0) {
        newData.banco.unshift({ id: `dep-${Date.now()}`, date: fecha, desc: "Ingreso efectivo caja", amount: Num.parse(depositoBanco), status: "pending" });
      }

      // 3. Cierre Restaurante
      const cierreRest: Cierre = {
        id: cierreId, date: fecha, totalVenta: totalRestauranteNeto,
        efectivo: Num.parse(form.efectivo), tarjeta: totalTarjetas, apps: appsNetas,
        descuadre: descuadreVivo || 0, notas: form.notas, unitId: 'REST'
      };
      upsertFactura(newData.cierres, cierreRest, 'id');
      
      // Factura espejo para contabilidad
      upsertFactura(newData.facturas, { 
          id: `f-zr-${fecha}`, tipo: 'caja', num: cierreId, date: fecha, 
          prov: "Z DIARIO", total: totalRestauranteNeto, paid: false, reconciled: false, unidad_negocio: 'REST' 
      }, 'num');

      await onSave(newData);
      alert("✅ Cierre guardado y sincronizado.");
      setForm({ ...form, efectivo: '', tpv1: '', tpv2: '', amex: '', cajaFisica: '', tienda: '', notas: '' });
      setGastosCaja([]);
    } catch (e) { alert("Error crítico al guardar."); }
    finally { setIsSaving(false); }
  };

  const jsonSafeClone = (obj: any) => JSON.parse(JSON.stringify(obj));

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* OVERLAY VOZ */}
      <AnimatePresence>
        {isRecording && (
          <motion.div initial={{y:-50, opacity:0}} animate={{y:0, opacity:1}} exit={{y:-50, opacity:0}} className="fixed top-4 left-1/2 -translate-x-1/2 z-[500] bg-slate-900 text-white p-4 rounded-3xl shadow-2xl flex flex-col items-center border-2 border-indigo-500 w-11/12 max-w-md">
            <div className="flex items-center gap-2"><div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"/> <span className="text-[10px] font-black uppercase">Escuchando...</span></div>
            <p className="text-xs mt-2 opacity-70 italic text-center line-clamp-2">{liveTranscript || "Dicta los números de la caja..."}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
        <div>
           <h2 className="text-xl font-black text-slate-800">Caja Unificada</h2>
           <p className="text-[10px] text-indigo-500 font-bold uppercase flex items-center gap-1 mt-1"><SplitSquareHorizontal className="w-3 h-3" /> Inteligencia Arume Pro</p>
        </div>
        <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="p-3 bg-slate-100 rounded-2xl font-bold text-sm outline-none border-none"/>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-emerald-400" />
            
            <div className="flex justify-between items-center mb-8">
               <h3 className="font-black text-slate-700 flex items-center gap-2"><Scan className="w-5 h-5 text-indigo-500"/> Entrada de Datos</h3>
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
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Ventas Físicas</label>
                  <div className="bg-emerald-50 p-5 rounded-3xl border border-emerald-100">
                    <span className="text-[9px] font-bold text-emerald-600 block mb-1">EFECTIVO TICKET Z</span>
                    <input type="number" value={form.efectivo} onChange={e => setForm({...form, efectivo: e.target.value})} className="w-full bg-transparent text-3xl font-black outline-none text-emerald-700" placeholder="0.00"/>
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
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Arqueo de Cajón</label>
                  <div className="bg-slate-900 p-5 rounded-3xl shadow-lg">
                    <span className="text-[9px] font-bold text-slate-500 block mb-1">DINERO TOTAL EN CAJÓN</span>
                    <input type="number" value={form.cajaFisica} onChange={e => setForm({...form, cajaFisica: e.target.value})} className="w-full bg-transparent text-3xl font-black outline-none text-indigo-400" placeholder="0.00"/>
                  </div>
                  <AnimatePresence>
                  {descuadreVivo !== null && (
                    <motion.div initial={{opacity:0}} animate={{opacity:1}} className={cn("p-4 rounded-2xl text-[10px] font-black flex items-center justify-between", Math.abs(descuadreVivo) <= 2 ? "bg-emerald-500 text-white" : "bg-rose-500 text-white")}>
                      <span>DESCUADRE ACTUAL:</span>
                      <span className="text-lg">{descuadreVivo > 0 ? '+' : ''}{descuadreVivo}€</span>
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
                    <label className="text-[9px] font-black text-blue-600 block mb-1">INGRESO SOBRE A BANCO</label>
                    <input type="number" value={depositoBanco} onChange={e => setDepositoBanco(e.target.value)} className="w-full bg-transparent text-xl font-black outline-none text-blue-700" placeholder="0.00"/>
                </div>
            </div>

            <div className="mt-6">
              <p className="text-[10px] font-black text-amber-500 uppercase mb-3">3. Gastos Directos de Caja</p>
              <GastoCajaEditor gastos={gastosCaja} onAdd={(g) => setGastosCaja(prev => [...prev, g])} onDelete={(i) => setGastosCaja(prev => prev.filter((_,idx) => idx !== i))} />
            </div>

            <div className="mt-8 relative">
               <textarea value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} className="w-full p-5 bg-slate-50 rounded-[2rem] text-xs min-h-[120px] outline-none border border-slate-100 focus:bg-white transition-all" placeholder="Escribe o dicta notas del día..."/>
               {form.notas && <button onClick={() => setForm({...form, notas: ''})} className="absolute top-5 right-5 text-slate-300 hover:text-rose-500 transition-colors"><XCircle className="w-6 h-6"/></button>}
            </div>

            <button onClick={handleSaveCierre} disabled={isSaving} className="w-full mt-8 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-base shadow-2xl hover:bg-indigo-600 transition-all transform active:scale-95 disabled:opacity-50">
               {isSaving ? "PROCESANDO CIERRE..." : `GUARDAR CIERRE (${totalRestauranteNeto.toFixed(2)}€ NETOS)`}
            </button>
          </div>
        </div>

        <div className="space-y-6">
           <div className="bg-slate-900 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-500/10 rounded-full group-hover:scale-150 transition-transform duration-700" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">Ventas Netas Mes</p>
              <p className="text-5xl font-black tracking-tighter text-emerald-400">{kpis.total.toLocaleString()}€</p>
              <div className="mt-6 pt-6 border-t border-white/10 flex justify-between items-center">
                 <div><p className="text-[8px] text-slate-500 font-bold uppercase">Ticket Medio</p><p className="text-sm font-black">{(kpis.total / (kpis.cierresMes.length || 1)).toFixed(2)}€</p></div>
                 <button onClick={() => setIsExportModalOpen(true)} className="p-3 bg-white/10 rounded-2xl hover:bg-white/20 transition"><Download className="w-5 h-5 text-white"/></button>
              </div>
           </div>
           
           <CashHistoryList cierresMes={kpis.cierresMes} facturas={data.facturas || []} onDelete={() => {}} />
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
  const [row, setRow] = useState({ concepto: '', importe: '', iva: 10 as 4|10|21 });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input value={row.concepto} onChange={(e)=>setRow({...row, concepto: e.target.value})} placeholder="Ej: Pan, Hielo..." className="md:col-span-2 p-3 rounded-xl bg-slate-50 text-xs font-bold border-none outline-none focus:ring-2 ring-amber-200" />
        <input value={row.importe} onChange={(e)=>setRow({...row, importe: e.target.value})} placeholder="0.00 €" type="number" className="p-3 rounded-xl bg-slate-50 text-xs font-black border-none outline-none focus:ring-2 ring-amber-200" />
        <select value={row.iva} onChange={(e)=>setRow({...row, iva: Number(e.target.value) as 4|10|21})} className="p-3 rounded-xl bg-slate-50 text-xs font-bold border-none outline-none">
          <option value={4}>4%</option><option value={10}>10%</option><option value={21}>21%</option>
        </select>
        <button onClick={() => { if (!row.concepto || !row.importe) return; onAdd(row); setRow({ concepto: '', importe: '', iva: 10 }); }} className="p-3 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase hover:bg-amber-600 transition shadow-md flex items-center justify-center"><Plus className="w-5 h-5"/></button>
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
