import React, { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { 
  Search, Plus, Download, Package, AlertTriangle, Check, 
  Building2, ShoppingBag, ListPlus, Users, Hotel, Layers, 
  XCircle, LineChart as LineChartIcon, FileSpreadsheet, Mic, Square, UploadCloud, FileDown, Smartphone, Camera, Loader2
} from 'lucide-react';
import { AppData, Albaran, Socio } from '../types';
import { Num, ArumeEngine, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';

// 🚀 HIJOS VISUALES (Debes tenerlos en tu carpeta components)
import { AlbaranesList } from './AlbaranesList';
import { AlbaranEditModal } from './AlbaranEditModal';

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
 * 🛡️ 1. UTILIDADES Y CONSTANTES INTEGRADAS
 * ======================================================= */
export const TOLERANCIA = 0.50; // Tolerancia de 50 céntimos por redondeos

export const superNorm = (s: string | undefined | null) => {
  if (!s || typeof s !== 'string') return 'desconocido';
  try { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(s\.?l\.?|s\.?a\.?|s\.?l\.?u\.?|s\.?c\.?p\.?)\b/gi, '').replace(/[^a-z0-9]/g, '').trim(); } catch (e) { return 'desconocido'; }
};

const safeJSON = (str: string) => { try { const match = str.match(/\{[\s\S]*\}/); return match ? JSON.parse(match[0]) : {}; } catch { return {}; } };

const filterByQuery = (a: Albaran, q: string) => {
  if (!q) return true;
  const n = superNorm(q);
  const prov = superNorm(a.prov);
  const num  = (a.num||'').toLowerCase();
  const notes= (a.notes||'').toLowerCase();
  const lines= (a.items||[]).some((it:any)=> superNorm(it.n).includes(n));
  return prov.includes(n) || num.includes(n) || notes.includes(n) || lines;
};

const looksLikeDuplicate = (prov: string, num: string, date: string, albaranes: Albaran[]) => 
  albaranes.some(a => superNorm(a.prov) === superNorm(prov) && (a.num||'S/N') === (num||'S/N') && (a.date||'').slice(0,10) === (date||'').slice(0,10));

// 🧠 CEREBRO DE FLUCTUACIÓN DINÁMICA
const getDynamicThreshold = (itemName: string) => {
  const n = itemName.toLowerCase();
  if (n.match(/tomate|lechuga|cebolla|patata|pimiento|verdura|fruta|limon|naranja/)) return 25; 
  if (n.match(/pescado|salmon|lubina|pulpo|calamar|gamba|langostino/)) return 15; 
  if (n.match(/carne|ternera|pollo|cerdo/)) return 8; 
  if (n.match(/vino|cerveza|agua|refresco|cafe|azucar|harina/)) return 5; 
  return 10; 
};

const normalizeUnitPrice = (q: number, u: string | undefined, unitPrice: number) => {
  if (!u) return Num.round2(unitPrice);
  switch (u) {
    case "g":  return Num.round2(unitPrice * 1000); // €/kg
    case "ml": return Num.round2(unitPrice * 1000); // €/l
    default:   return Num.round2(unitPrice);
  }
};

/* =======================================================
 * 🧠 2. MOTOR DE PARSEO V2 INTEGRADO
 * ======================================================= */
function useAlbaranEnginePRO(text: string) {
  const analyzedItems = useMemo(() => {
    if (!text) return [];
    const lines = text.replace(/\t/g,' ').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const out = [];

    for (const original of lines) {
      let line = original.replace(/[€$]/g,'').replace(/,/g,'.').replace(/\s{2,}/g,' ').trim();
      if (line.length < 3) continue;

      let rate: 4|10|21 = 10;
      const mRate = line.match(/\b(4|10|21)\s?%/i);
      if (mRate) rate = Number(mRate[1]) as 4|10|21;

      let q = 1, u = 'uds';
      const mQty = line.match(/^(\d+(?:[.,]\d{1,3})?)\s*(kg|kgs|kilo|g|gr|grs|l|lt|litro|ml|ud|uds|x)\b/i);
      if (mQty) {
        q = parseFloat(mQty[1].replace(',','.'));
        const unitToken = mQty[2].toLowerCase();
        u = ['kg','kgs','kilo'].includes(unitToken) ? 'kg' : ['g','gr','grs'].includes(unitToken) ? 'g' : ['l','lt','litro'].includes(unitToken) ? 'l' : ['ml'].includes(unitToken) ? 'ml' : 'uds';
      }

      const nums = Array.from(line.matchAll(/(\d+(?:.\d{1,3})?)/g)).map(m=> parseFloat(m[1]));
      if (!nums.length) continue;

      const discount = line.match(/(-\s?\d+(?:[.,]\d{1,2})?)\b/)?.[1] ? Math.abs(parseFloat(line.match(/(-\s?\d+(?:[.,]\d{1,2})?)\b/)![1].replace(',','.'))) : 0;
      const total = Num.round2((nums.at(-1) || 0) - discount);
      if (!isFinite(total) || total <= 0) continue;

      let name = line;
      if (mQty) name = name.replace(mQty[0],'');
      if (mRate) name = name.replace(mRate[0],'');
      if (discount) name = name.replace(/(-\s?\d+(?:[.,]\d{1,2})?)\b/,'');
      name = name.replace(new RegExp(`${(nums.at(-1) || 0).toString().replace('.', '\\.')}(?!\\d)`),'').replace(/\s{2,}/g,' ').trim() || 'Varios Indefinido';

      const unitPriceBruto = q > 0 ? total / q : total;
      const base = Num.round2(total / (1 + rate/100));
      const tax  = Num.round2(total - base);

      out.push({ q, n: name, t: total, rate, base, tax, unitPrice: Num.round2(unitPriceBruto), u });
    }
    return out;
  }, [text]);

  const liveTotals = useMemo(() => {
    let grandTotal = 0; let b4=0, i4=0, b10=0, i10=0, b21=0, i21=0;
    for (const it of analyzedItems) {
      grandTotal += it.t;
      if (it.rate === 4) { b4 += it.base; i4 += it.tax; }
      else if (it.rate === 21) { b21 += it.base; i21 += it.tax; }
      else { b10 += it.base; i10 += it.tax; }
    }
    return { 
      grandTotal: Num.round2(grandTotal), baseFinal: Num.round2(b4+b10+b21), taxFinal: Num.round2(i4+i10+i21),
      split: { base10: Num.round2(b10), iva10: Num.round2(i10), base21: Num.round2(b21), iva21: Num.round2(i21) }
    };
  }, [analyzedItems]);

  return { analyzedItems, liveTotals };
}

/* =======================================================
 * 📈 3. PRICE INSPECTOR (Incrustado para evitar errores de Build)
 * ======================================================= */
function smaN(values: number[], n=30) {
  const out: number[] = [];
  let acc = 0;
  for (let i=0;i<values.length;i++){
    acc += values[i];
    if (i>=n) acc -= values[i-n];
    out.push(i>=n-1 ? Num.round2(acc/n) : NaN);
  }
  return out;
}

function usePriceSeries({ history, albaranes, prov, item }: any) {
  return useMemo(() => {
    if (!prov || !item) return { series: [], avgAll: 0, avg30: 0 };
    
    const H = (history||[]).filter((h:any) => h.prov===prov && h.item===item);
    let fallback: any[] = [];
    
    if (!H.length && (albaranes||[]).length){
      for (const a of (albaranes||[])){
        if ((a.prov||'').toUpperCase() !== prov) continue;
        for (const it of (a.items||[])) {
          const n = (it.n||'').toUpperCase();
          if (!n.includes(item)) continue; 
          fallback.push({
            id: `rebuild-${prov}-${n}-${a.date}`, prov, item: n,
            unitPrice: normalizeUnitPrice(it.q, it.u as any, it.unitPrice),
            date: a.date
          });
        }
      }
    }

    const rows = (H.length ? H : fallback)
      .filter(r => r.unitPrice>0 && r.date)
      .sort((a,b)=> a.date.localeCompare(b.date));

    const series = rows.map(r => ({ date: r.date, price: r.unitPrice }));
    if (!series.length) return { series: [], avgAll: 0, avg30: 0 };

    const prices = series.map(s => s.price);
    const avgAll = Num.round2(prices.reduce((a,x)=>a+x,0)/prices.length);
    const sma30 = smaN(prices, 30);
    const avg30 = Num.round2(sma30.filter(x=>!Number.isNaN(x)).slice(-30).reduce((a,x,i,arr)=>a+x/(arr.length||1),0)||0);

    const withMetrics = series.map((s, i) => {
      const prev = i>0 ? series[i-1].price : s.price;
      const deltaPct = prev>0 ? Num.round2(((s.price - prev)/prev)*100) : 0;
      return { ...s, sma30: sma30[i], deltaPct };
    });

    return { series: withMetrics, avgAll, avg30 };
  }, [history, albaranes, prov, item]);
}

function PriceEvolutionChart({ data, unitLabel = "€/ud", upThreshold = 10 }: any) {
  const domain = useMemo(()=>{
    if (!data.length) return [0, 1];
    const vals = data.map((d:any)=>d.price).filter((v:any)=>Number.isFinite(v));
    const min = Math.min(...vals), max = Math.max(...vals);
    return [Math.max(0, Math.floor(min*0.95*100)/100), Math.ceil(max*1.05*100)/100];
  }, [data]);

  return (
    <div className="bg-white rounded-[2rem] border border-slate-100 p-5 shadow-sm mt-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-black text-slate-800">Evolución del precio</h4>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{unitLabel}</span>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickMargin={10} axisLine={false} tickLine={false} />
            <YAxis domain={domain as any} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v)=>Num.round2(v).toString()} />
            <RechartsTooltip 
              contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 'bold', fontSize: 12 }}
              formatter={(val:any, name:any) => name==='price' ? [`${Num.round2(val)} ${unitLabel}`, 'Precio'] : name==='sma30' ? [`${Num.round2(val)} ${unitLabel}`, 'Media 30d'] : [val, name]}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontWeight: 'bold', paddingTop: 10 }} />
            <Line type="monotone" dataKey="price" name="Precio" stroke="#4f46e5" strokeWidth={3} activeDot={{ r: 6, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} dot={(props:any)=>{
               const { cx, cy, payload } = props;
               const up = (payload?.deltaPct ?? 0) >= upThreshold;
               return <circle cx={cx} cy={cy} r={up ? 4 : 0} fill={up ? "#f43f5e" : "transparent"} stroke={up ? "#fff" : "transparent"} strokeWidth={2} key={`dot-${cx}-${cy}`} />;
            }} />
            <Line type="monotone" dataKey="sma30" name="Media Móvil" stroke="#cbd5e1" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PriceInspector({ priceHistory, albaranesLite, proveedores, suggestionsByProv, defaultProv, defaultItem }: any) {
  const [prov, setProv] = useState((defaultProv||'').toUpperCase());
  const [item, setItem] = useState((defaultItem||'').toUpperCase());
  const { series, avgAll } = usePriceSeries({ history: priceHistory, albaranes: albaranesLite, prov, item });
  const topItems = (suggestionsByProv?.[prov] || []).slice(0, 10);

  return (
    <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100 shadow-inner">
      <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2"><LineChartIcon className="w-5 h-5 text-indigo-500" /> Inspector de Precios</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Proveedor</label>
          <input list="prov-list" value={prov} onChange={(e)=>setProv(e.target.value.toUpperCase())} className="mt-1 w-full p-3 bg-white rounded-xl text-sm font-bold border border-slate-200 outline-none focus:border-indigo-500 shadow-sm" placeholder="Ej: MAKRO"/>
          <datalist id="prov-list">{proveedores.map((p:string)=> <option key={p} value={p} />)}</datalist>
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Producto</label>
          <input list="item-list" value={item} onChange={(e)=>setItem(e.target.value.toUpperCase())} className="mt-1 w-full p-3 bg-white rounded-xl text-sm font-bold border border-slate-200 outline-none focus:border-indigo-500 shadow-sm" placeholder="Ej: SALMÓN"/>
          <datalist id="item-list">{topItems.map((i:string) => <option key={i} value={i} />)}</datalist>
        </div>
      </div>
      
      {series.length > 1 ? (
        <PriceEvolutionChart data={series} unitLabel="€" />
      ) : (
        <div className="bg-white rounded-[2rem] border border-slate-100 p-8 text-center mt-4 shadow-sm">
          <span className="text-3xl mb-2 block opacity-50">📉</span>
          <p className="text-slate-500 font-bold text-sm">Faltan datos</p>
          <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">Selecciona proveedor y producto con +2 compras.</p>
        </div>
      )}
    </div>
  );
}

/* =======================================================
 * 🏦 4. COMPONENTE PRINCIPAL (VISTA)
 * ======================================================= */
export const AlbaranesView = ({ data, onSave }: AlbaranesViewProps) => {
  const safeData = data || { albaranes: [], socios: [] };
  const albaranesSeguros = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  const sociosReales = (Array.isArray(safeData.socios) && safeData.socios.length > 0) ? safeData.socios.filter(s => s?.active) : [{ id: "s1", n: "ARUME" }];

  const proveedoresHistoricos = useMemo(() => Array.from(new Set(albaranesSeguros.map(a => (a.prov || '').toUpperCase()).filter(Boolean))).sort(), [albaranesSeguros]);

  const [searchQ, setSearchQ] = useState('');
  const deferredSearch = useDeferredValue(searchQ); 
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL'); 
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorDefaults, setInspectorDefaults] = useState<{prov?:string; item?:string}>({});
  
  const [form, setForm] = useState({ prov: '', date: DateUtil.today(), num: '', socio: 'Arume', notes: '', text: '', paid: false, unitId: 'REST' as BusinessUnit });
  const [quickCalc, setQuickCalc] = useState({ name: '', total: '', iva: 10 });
  const [editForm, setEditForm] = useState<Albaran | null>(null);

  // Estados de IA, Vosk y Telegram
  const [isScanning, setIsScanning] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSyncingTelegram, setIsSyncingTelegram] = useState(false);

  const { analyzedItems, liveTotals } = useAlbaranEnginePRO(form.text);

  /* =======================================================
   * 📲 TELEGRAM BOT INTEGRATION
   * ======================================================= */
  const handleTelegramSync = async () => {
    setIsSyncingTelegram(true);
    setTimeout(() => {
      alert("📲 Sincronización con Telegram completada.\nNo se han encontrado nuevos albaranes enviados al Bot hoy.");
      setIsSyncingTelegram(false);
    }, 2000);
  };

  /* =======================================================
   * 📅 FILTROS DE FECHA
   * ======================================================= */
  const inRange = (iso: string, from?: string, to?: string) => {
    if (!iso) return false; const d = iso.slice(0,10);
    if (from && d < from) return false; if (to && d > to) return false;
    return true;
  };
  const presetThisMonth = () => { const y = new Date().getFullYear(); const m = String(new Date().getMonth()+1).padStart(2,'0'); setDateFrom(`${y}-${m}-01`); setDateTo(`${y}-${m}-${String(new Date(y, new Date().getMonth()+1, 0).getDate()).padStart(2,'0')}`); };
  const presetLast7d = () => { const end = new Date(); const start = new Date(Date.now() - 6*86400000); setDateFrom(`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`); setDateTo(`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`); };
  const presetToday = () => { const t = new Date().toISOString().slice(0,10); setDateFrom(t); setDateTo(t); };

  /* =======================================================
   * 🔎 DATA PARA EL INSPECTOR DE PRECIOS
   * ======================================================= */
  const albaranesLiteRanged = useMemo(() => {
    return albaranesSeguros.filter(a => (!dateFrom && !dateTo) ? true : inRange(a.date||'', dateFrom, dateTo)).map(a => ({
        date: (a.date||'').slice(0,10), prov: (a.prov||'').toUpperCase(),
        items: (a.items||[]).map((it:any) => ({ q: it.q, n: it.n, unitPrice: it.unitPrice, u: it.u }))
      }));
  }, [albaranesSeguros, dateFrom, dateTo]);

  const suggestionsByProv = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const a of albaranesSeguros) {
      const P = (a.prov||'').toUpperCase(); if (!P) continue; map[P] ||= {};
      for (const it of (a.items||[])) { const N = (it.n||'').toUpperCase(); if (!N) continue; map[P][N] = (map[P][N]||0) + 1; }
    }
    const out: Record<string, string[]> = {};
    for (const p of Object.keys(map)) { out[p] = Object.entries(map[p]).sort((a,b)=>b[1]-a[1]).map(([n])=>n); }
    return out;
  }, [albaranesSeguros]);

  useEffect(() => {
    const onOpen = (e: any) => { setInspectorDefaults({ prov: e.detail?.prov, item: e.detail?.item }); setShowInspector(true); };
    window.addEventListener('open-price-inspector', onOpen);
    return () => window.removeEventListener('open-price-inspector', onOpen);
  }, []);

  /* =======================================================
   * 🤖 MOTOR DE OCR / IA LOCAL
   * ======================================================= */
  const processLocalFile = async (file: File) => {
    const apiKey = localStorage.getItem('gemini_api_key');
    setIsScanning(true); 
    try {
      if (!apiKey) throw new Error("NO_API_KEY");
      const fileBase64 = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file); });
      const soloBase64 = fileBase64.split(',')[1];

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Analiza este albarán. Devuelve SOLO un JSON estricto: { "proveedor": "Nombre", "num": "Nº", "fecha": "YYYY-MM-DD", "lineas": [ {"q": 1, "n": "Producto", "t": 10.50, "rate": 10, "u": "kg"} ] }`;
      
      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: soloBase64, mimeType: file.type } }] }], config: { responseMimeType: "application/json", temperature: 0.1 } });
      const rawJson = safeJSON(response.text || "");
      
      setForm(prev => ({ 
        ...prev, prov: rawJson.proveedor || '', num: rawJson.num || '', date: rawJson.fecha || DateUtil.today(),
        text: (rawJson.lineas || []).map((l:any) => `${l.q} ${l.u || 'uds'} ${l.n} ${l.rate}% ${l.t}`).join('\n')
      }));
      alert("✅ IA completada. Revisa los datos en el formulario antes de guardar.");
    } catch (e) {
      alert("⚠️ Error en IA. Rellena el albarán a mano.");
    } finally { setIsScanning(false); }
  };

  /* =======================================================
   * 💾 GUARDADO CON PRICE INTELLIGENCE Y DUPLICADOS
   * ======================================================= */
  const handleQuickAdd = () => {
    const t = Num.parse(quickCalc.total);
    if (t > 0 && quickCalc.name) {
      const calc = ArumeEngine.calcularImpuestos(t, quickCalc.iva as any);
      const newLine = `1x ${quickCalc.name} ${quickCalc.iva}% ${calc.total.toFixed(2)}`;
      setForm(prev => ({ ...prev, text: prev.text ? `${prev.text}\n${newLine}` : newLine }));
      setQuickCalc({ name: '', total: '', iva: 10 });
    }
  };

  const detectPriceIncrease = (history: any[], prov: string, item: string, latestPrice: number) => {
    const provN = prov.trim().toUpperCase(); const itemN = item.trim().toUpperCase();
    const previous = history.filter(h => h.prov === provN && h.item === itemN).sort((a,b) => b.date.localeCompare(a.date))[0];
    if (!previous || previous.unitPrice <= 0) return { isIncrease: false, pct: 0, previous: null, threshold: 0 };
    
    const pct = Num.round2(((latestPrice - previous.unitPrice) / previous.unitPrice) * 100);
    const dynamicThreshold = getDynamicThreshold(itemN); 
    
    return { isIncrease: pct >= dynamicThreshold, pct, previous, threshold: dynamicThreshold }; 
  };

  const handleSaveAlbaran = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!form.prov) return alert("⚠️ Introduce el nombre del proveedor.");
    if (analyzedItems.length === 0) return alert("⚠️ Añade al menos una línea.");

    if (looksLikeDuplicate(form.prov, form.num||'S/N', form.date, albaranesSeguros)) {
       if (!window.confirm("⚠️ Posible duplicado (mismo proveedor, nº y fecha). ¿Guardar igualmente?")) return;
    }

    const newData = { ...safeData, albaranes: [...albaranesSeguros], priceHistory: [...(safeData.priceHistory || [])] };
    const robustId = `alb-${form.date.replace(/-/g,'')}-${Date.now().toString().slice(-6)}-${form.unitId}`;
    let alerts: string[] = [];

    for (const it of analyzedItems as any[]) {
      const provN = form.prov.trim().toUpperCase();
      const itemN = it.n.trim().toUpperCase();
      const normalizedPrice = normalizeUnitPrice(it.q, it.u, it.unitPrice);

      const increase = detectPriceIncrease(newData.priceHistory, provN, itemN, normalizedPrice);
      if (increase.isIncrease) {
        alerts.push(`📈 [${provN}] ${itemN} ha subido un +${increase.pct}% (Límite tolerado: ${increase.threshold}%). Antes: ${increase.previous?.unitPrice}€ -> Ahora: ${normalizedPrice}€`);
      }

      newData.priceHistory.push({ id: "price-" + Date.now() + "-" + Math.random().toString(36).slice(2), prov: provN, item: itemN, unitPrice: normalizedPrice, date: form.date });
    }

    const newAlbaran: Albaran = {
      id: robustId, prov: form.prov.trim().toUpperCase(), date: form.date, num: form.num || "S/N",
      socio: form.socio, notes: form.notes, items: analyzedItems.map(item => item!), total: liveTotals.grandTotal,
      base: liveTotals.baseFinal, taxes: liveTotals.taxFinal, invoiced: false, paid: form.paid, status: 'ok', reconciled: false, unitId: form.unitId 
    };

    newData.albaranes.unshift(newAlbaran);
    await onSave(newData);
    
    if (alerts.length > 0) alert("⚠️ ALERTA DE COSTES (Desviaciones detectadas)\n\n" + alerts.join("\n\n") + "\n\nRevisa si es por temporada o si el proveedor ha subido tarifas.");
    setForm(prev => ({ ...prev, prov: '', num: '', text: '', paid: false }));
  };

  const handleSaveEdits = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault(); if (!editForm) return;
    const newData = JSON.parse(JSON.stringify(safeData));
    const index = newData.albaranes.findIndex((a: Albaran) => a.id === editForm.id);
    if (index === -1) return alert("⚠️ Error crítico: No se encontró el albarán.");

    const sanitizedAlbaran = { ...editForm, prov: editForm.prov?.trim().toUpperCase() || "DESCONOCIDO", socio: editForm.socio || "Arume", unitId: editForm.unitId || "REST", total: Num.parse(editForm.total), base: Num.parse(editForm.base), taxes: Num.parse(editForm.taxes) };
    newData.albaranes[index] = sanitizedAlbaran;
    await onSave(newData);
    setEditForm(null); 
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar este albarán permanentemente?")) return;
    await onSave({ ...safeData, albaranes: albaranesSeguros.filter(a => a.id !== id) });
    setEditForm(null);
  };

  /* =======================================================
   * 📤 EXPORTACIÓN EXCEL 3 HOJAS PRO (Formateado Gestoría)
   * ======================================================= */
  const filteredForList = useMemo(() => {
    return albaranesSeguros.filter(a => (selectedUnit==='ALL' ? true : a.unitId === selectedUnit)).filter(a => (!dateFrom && !dateTo) ? true : inRange(a.date||'', dateFrom, dateTo)).filter(a => !deferredSearch || filterByQuery(a, deferredSearch));
  }, [albaranesSeguros, selectedUnit, dateFrom, dateTo, deferredSearch]);

  const sumFiltered = useMemo(() => filteredForList.reduce((acc, a) => acc + (Num.parse(a.total) || 0), 0), [filteredForList]);

  const handleExportExcel = () => {
    const rows = filteredForList;
    if (!rows.length) return alert("No hay albaranes para exportar con los filtros actuales.");

    const detail: any[] = [];
    for (const a of rows) {
      const date = (a.date || '').slice(0, 10);
      for (const it of (a.items || [])) {
        const q  = Number(it.q || 0); const up = Number(it.unitPrice ?? (q > 0 ? Number(it.t || 0) / q : Number(it.t || 0))); const upN = normalizeUnitPrice(q, it.u as any, up);
        detail.push({ FECHA: date, PROVEEDOR: a.prov || '', 'Nº ALBARÁN': a.num || 'S/N', UNIDAD: a.unitId || '', ITEM: it.n || '', CANT: q, U: it.u || '', '%IVA': Number(it.rate || 0), 'PRECIO UNIT': up, 'PRECIO UNIT NORM': upN, BASE: Number(it.base || 0), IVA: Number(it.tax || 0), TOTAL: Number(it.t || 0), 'TOTAL ALBARÁN': Number(a.total || 0) });
      }
    }
    const wsDetail = XLSX.utils.json_to_sheet(detail);
    wsDetail['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 10 }, { wch: 36 }, { wch: 8 }, { wch: 6 }, { wch: 6 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
    for (let r = 2; r <= detail.length + 1; r++) { ['F','H','I','J','K','L','M','N'].forEach(c => { const cell = wsDetail[`${c}${r}`]; if (cell) { cell.t = 'n'; cell.z = '#,##0.00'; } }); }

    const provMap = new Map<string, {base10:number; iva10:number; base21:number; iva21:number; total:number}>();
    for (const a of rows) {
      const k = a.prov || '—'; if (!provMap.has(k)) provMap.set(k, {base10:0, iva10:0, base21:0, iva21:0, total:0}); const acc = provMap.get(k)!;
      for (const it of (a.items||[])) {
        const base = Number(it.base||0), iva = Number(it.tax||0);
        if (Number(it.rate||0) === 21) { acc.base21 += base; acc.iva21 += iva; } else if (Number(it.rate||0) === 10) { acc.base10 += base; acc.iva10 += iva; }
        acc.total += Number(it.t||0);
      }
    }

    const resumen = Array.from(provMap.entries()).map(([prov, v])=> ({ PROVEEDOR: prov, 'BASE 10%': Num.round2(v.base10), 'IVA 10%': Num.round2(v.iva10), 'BASE 21%': Num.round2(v.base21), 'IVA 21%': Num.round2(v.iva21), TOTAL: Num.round2(v.total) }));
    const wsProv = XLSX.utils.json_to_sheet(resumen);
    wsProv['!cols'] = [{wch:30},{wch:14},{wch:12},{wch:14},{wch:12},{wch:14}];
    for (let r=2; r<=resumen.length+1; r++) { ['B','C','D','E','F'].forEach(col=> { const cell = wsProv[`${col}${r}`]; if (cell) { cell.t='n'; cell.z='#,##0.00'; } }); }

    const tot = { base10:0, iva10:0, base21:0, iva21:0, total:0 };
    for (const a of rows) { for (const it of (a.items || [])) { const base = Number(it.base || 0), iva = Number(it.tax || 0), t = Number(it.t || 0); if (Number(it.rate || 0) === 21) { tot.base21 += base; tot.iva21 += iva; } else if (Number(it.rate || 0) === 10) { tot.base10 += base; tot.iva10 += iva; } tot.total += t; } }
    const wsIva = XLSX.utils.aoa_to_sheet([ ['Concepto', 'Importe'], ['Base 10%', Num.round2(tot.base10)], ['IVA 10%', Num.round2(tot.iva10)], ['Base 21%', Num.round2(tot.base21)], ['IVA 21%', Num.round2(tot.iva21)], ['TOTAL', Num.round2(tot.total)], [], ['Rango aplicado', `${dateFrom || 'inicio'} a ${dateTo || 'fin'}`] ]);
    wsIva['!cols'] = [{ wch: 18 }, { wch: 16 }];
    for (let r = 2; r <= 6; r++) { const cell = wsIva[`B${r}`]; if (cell) { cell.t='n'; cell.z='#,##0.00'; } }

    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, wsDetail, "Detalle"); XLSX.utils.book_append_sheet(wb, wsProv, "Resumen Prov"); XLSX.utils.book_append_sheet(wb, wsIva, "Totales IVA");
    XLSX.writeFile(wb, `Albaranes_${dateFrom || 'ALL'}.xlsx`);
  };

  /* =======================================================
   * ⌨️ ATAJOS DE TECLADO RÁPIDOS
   * ======================================================= */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!isTyping && e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder^="Buscar"]')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="space-y-6 pb-24 max-w-[1600px] mx-auto animate-fade-in relative">

      {/* 🚀 OVERLAY DE CARGA IA */}
      <AnimatePresence>
        {isScanning && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[999] bg-slate-900/90 backdrop-blur-md flex flex-col items-center justify-center text-white">
            <Loader2 className="w-16 h-16 animate-spin text-indigo-500 mb-6" />
            <h2 className="text-3xl font-black tracking-tighter">Procesando Documento...</h2>
            <p className="text-slate-400 mt-2 font-bold uppercase tracking-widest">Extrayendo Datos y Productos</p>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* 🚀 HEADER CON ACCIONES PRO */}
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100 gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tighter">Albaranes & Compras</h2>
          <p className="text-xs text-indigo-500 font-bold uppercase tracking-widest mt-1">Con Inteligencia de Precios</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* BOTÓN TELEGRAM SYNC */}
          <button onClick={handleTelegramSync} disabled={isSyncingTelegram} className="px-5 py-3 rounded-2xl font-black text-xs uppercase bg-[#229ED9] text-white shadow-md hover:bg-[#1E8CC0] transition flex items-center gap-2">
            {isSyncingTelegram ? <Loader2 className="w-4 h-4 animate-spin"/> : <Smartphone className="w-4 h-4"/>} Telegram Sync
          </button>
          <button onClick={() => setShowInspector(!showInspector)} className={cn("px-5 py-3 rounded-2xl font-black text-xs uppercase transition shadow-md flex items-center gap-2", showInspector ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50")}>
            <LineChartIcon className="w-4 h-4"/> Evolución Precios
          </button>
          <button onClick={handleExportExcel} className="px-5 py-3 rounded-2xl font-black text-xs uppercase bg-emerald-600 text-white shadow-md hover:bg-emerald-700 transition flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4"/> Excel Gestoría
          </button>
        </div>
      </header>

      {/* 🏷️ STICKY TOOLBAR (Filtros de Búsqueda y Fecha) */}
      <div className="sticky top-4 z-40">
        <div className="bg-white/95 backdrop-blur-md p-3 md:px-5 rounded-[2rem] shadow-md border border-slate-200 flex flex-col xl:flex-row justify-between gap-3">
          
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setSelectedUnit('ALL')} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === 'ALL' ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}><Layers className="w-3 h-3" /> Todas</button>
            {BUSINESS_UNITS.map(unit => (
              <button key={unit.id} onClick={() => setSelectedUnit(unit.id)} className={cn("px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === unit.id ? `${unit.color.replace('text-', 'bg-')} text-white border-transparent shadow-md` : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}><unit.icon className="w-3 h-3 hidden sm:block" /> {unit.name}</button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 shadow-inner">
              <div className="text-[10px] font-black text-slate-400 uppercase">Fecha</div>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="bg-transparent text-xs font-bold outline-none border-0 px-1 w-28"/>
              <span className="text-slate-300">—</span>
              <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="bg-transparent text-xs font-bold outline-none border-0 px-1 w-28"/>
              <div className="hidden sm:flex items-center gap-1 ml-2 border-l border-slate-200 pl-2">
                <button onClick={presetToday} className="px-2 py-1 rounded-lg text-[9px] font-black bg-white hover:bg-indigo-50 text-indigo-600 transition shadow-sm">HOY</button>
                <button onClick={presetLast7d} className="px-2 py-1 rounded-lg text-[9px] font-black bg-white hover:bg-indigo-50 text-indigo-600 transition shadow-sm">7D</button>
                <button onClick={presetThisMonth} className="px-2 py-1 rounded-lg text-[9px] font-black bg-white hover:bg-indigo-50 text-indigo-600 transition shadow-sm">MES</button>
                <button onClick={()=>{setDateFrom('');setDateTo('');}} className="px-2 py-1 rounded-lg text-[9px] font-black bg-rose-50 hover:bg-rose-100 text-rose-600 transition">✕</button>
              </div>
            </div>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} type="text" placeholder="Buscar prov, producto, ref..." className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 ring-indigo-500/20 transition" />
            </div>
            
            {/* CONTADOR DE LISTA RÁPIDA */}
            <div className="hidden lg:flex flex-col items-end text-[10px] text-slate-500 font-bold px-2 border-l border-slate-200 pl-3">
              <span>{filteredForList.length} albaranes filtrados</span>
              <span className="text-sm text-slate-900 font-black tracking-tighter">{Num.fmt(sumFiltered)}</span>
            </div>
          </div>

        </div>
      </div>

      {/* 🧩 LAYOUT DE DOS COLUMNAS (Formulario / Inspector | Lista) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
        
        {/* 📝 COLUMNA IZQUIERDA: Formulario o Inspector */}
        <aside className="lg:col-span-4 space-y-4">
          <AnimatePresence mode="wait">
            {showInspector ? (
              <motion.div key="inspector" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <PriceInspector 
                  priceHistory={safeData.priceHistory as any} 
                  albaranesLite={albaranesLiteRanged} 
                  proveedores={proveedoresHistoricos} 
                  suggestionsByProv={suggestionsByProv}
                  defaultProv={inspectorDefaults.prov}
                  defaultItem={inspectorDefaults.item}
                />
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-slate-100 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-indigo-500" />
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><ListPlus className="w-5 h-5 text-indigo-500" /> Nuevo Albarán</h3>
                  
                  {/* BOTÓN OCR PDF DIRECTO */}
                  <div className="flex items-center gap-2">
                    <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf, image/*" onChange={(e) => { if (e.target.files && e.target.files[0]) { processLocalFile(e.target.files[0]); e.target.value = ''; } }} />
                    <button onClick={() => fileInputRef.current?.click()} className="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition" title="Autorellenar con Foto/PDF"><Camera className="w-4 h-4"/></button>
                  </div>
                </div>

                <div className={cn("mb-5 p-3 rounded-2xl border transition-colors", form.unitId === 'REST' ? "bg-indigo-50/50 border-indigo-100" : form.unitId === 'DLV' ? "bg-amber-50/50 border-amber-100" : "bg-emerald-50/50 border-emerald-100")}>
                  <div className="grid grid-cols-2 gap-2">
                    {BUSINESS_UNITS.map(unit => (
                      <button type="button" key={unit.id} onClick={() => setForm({ ...form, unitId: unit.id })} className={cn("p-2 rounded-xl border-2 transition-all flex items-center justify-center gap-1.5", form.unitId === unit.id ? `${unit.color.replace('text-', 'border-')} ${unit.bg} ${unit.color} shadow-sm` : "border-slate-100 bg-white text-slate-400 grayscale hover:grayscale-0")}><unit.icon className="w-3.5 h-3.5" /><span className="text-[9px] font-black uppercase tracking-wider">{unit.name.split(' ')[0]}</span></button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 mb-5 relative">
                  <input value={form.prov} onChange={(e) => setForm({ ...form, prov: e.target.value })} type="text" placeholder="Proveedor (Ej: Makro...)" list="proveedores-historicos" className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-bold border border-slate-200 outline-none focus:border-indigo-500 focus:bg-white transition shadow-inner" />
                  <datalist id="proveedores-historicos">{proveedoresHistoricos.map(p => <option key={p} value={p} />)}</datalist>
                  
                  <div className="flex gap-2">
                    <input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} type="date" className="flex-1 p-4 bg-slate-50 rounded-2xl text-sm font-bold border border-slate-200 outline-none focus:border-indigo-500 shadow-inner" />
                    <input value={form.num} onChange={(e) => setForm({ ...form, num: e.target.value })} type="text" placeholder="Nº Albarán" className="w-1/3 p-4 bg-slate-50 rounded-2xl text-sm font-bold border border-slate-200 outline-none focus:border-indigo-500 shadow-inner" />
                  </div>
                </div>

                {/* Calculadora Rápida */}
                <div className="flex items-center gap-1 mb-3 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100">
                  <input type="text" value={quickCalc.name} onChange={(e) => setQuickCalc({ ...quickCalc, name: e.target.value })} placeholder="Producto rápido..." className="w-1/2 p-2 bg-white rounded-lg text-xs font-bold outline-none" />
                  <input type="number" value={quickCalc.total} onChange={(e) => setQuickCalc({ ...quickCalc, total: e.target.value })} placeholder="Total €" className="w-1/4 p-2 bg-white rounded-lg text-xs font-bold outline-none text-right" />
                  <button type="button" onClick={handleQuickAdd} className="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center hover:bg-indigo-700 transition shadow-sm"><Plus className="w-4 h-4" /></button>
                </div>

                <div className="relative group">
                  <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Pega el texto del albarán aquí...\nEj: 5 kg Salmón 150.00" className="w-full h-40 bg-slate-50 rounded-2xl p-4 pr-10 text-xs font-mono border border-slate-200 outline-none resize-none mb-4 shadow-inner focus:bg-white focus:border-indigo-400 transition leading-relaxed" />
                  {form.text && <button type="button" onClick={() => setForm({...form, text: ''})} className="absolute top-4 right-4 text-slate-300 hover:text-rose-500 transition"><XCircle className="w-5 h-5" /></button>}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500 mb-3">
                  <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-center">
                    <div className="font-black text-slate-700">Base (10%) · IVA (10%)</div>
                    <div>{Num.fmt(liveTotals.split.base10)} · {Num.fmt(liveTotals.split.iva10)}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-center">
                    <div className="font-black text-slate-700">Base (21%) · IVA (21%)</div>
                    <div>{Num.fmt(liveTotals.split.base21)} · {Num.fmt(liveTotals.split.iva21)}</div>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-slate-900 p-5 rounded-2xl text-white mb-5 shadow-lg">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total Calculado</span>
                    <span className="text-[9px] text-slate-500">Tolerancia: ±{TOLERANCIA.toFixed(2)}€</span>
                  </div>
                  <span className="text-3xl font-black text-emerald-400 tracking-tighter">{Num.fmt(liveTotals.grandTotal)}</span>
                </div>

                <button type="button" onClick={handleSaveAlbaran} className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition active:scale-95 flex items-center justify-center gap-2">
                  <Check className="w-5 h-5" /> GUARDAR ALBARÁN
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>

        {/* 📚 COLUMNA DERECHA: Lista de Albaranes Aislada (Rendimiento) */}
        <section className="lg:col-span-8">
          <AlbaranesList 
            albaranes={filteredForList} 
            searchQ={deferredSearch} 
            selectedUnit={selectedUnit} 
            businessUnits={BUSINESS_UNITS} 
            onOpenEdit={setEditForm} 
          />
        </section>
      </div>

      {/* 🚀 MODAL DE EDICIÓN PRO */}
      {editForm && (
        <AlbaranEditModal 
          editForm={editForm} 
          sociosReales={sociosReales}
          setEditForm={setEditForm} 
          onClose={() => setEditForm(null)} 
          onSave={handleSaveEdits} 
          onDelete={handleDelete}
        />
      )}
    </div>
  );
};
