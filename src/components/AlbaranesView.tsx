import React, { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react';
import { 
  Search, Plus, Download, Package, AlertTriangle, Check, 
  Building2, ShoppingBag, ListPlus, Users, Hotel, Layers, 
  XCircle, LineChart as LineChartIcon, FileSpreadsheet, Mic, Square, Camera, Loader2, Smartphone,
  Calculator, Sparkles, ArrowUp, ArrowDown, ArrowUpDown // 1. Añadidos los iconos de flechas
} from 'lucide-react';
import { AppData, Albaran } from '../types';
import { Num, ArumeEngine, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { createClient } from '@supabase/supabase-js'; 

// 🚀 IMPORTAMOS DEL CEREBRO CENTRAL
import { basicNorm, TOLERANCIA as CENTRAL_TOLERANCIA } from '../services/invoicing';

// 🧩 COMPONENTES HIJOS
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

// 🔑 CREDENCIALES SUPABASE
const SUPABASE_URL = "https://bgtelulbiaugawyrhvwt.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_jagYegyG8gGMijzpLEY9BQ_iWfL1MU4";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const TOLERANCIA = CENTRAL_TOLERANCIA; 

const safeJSON = (str: string) => { try { const match = str.match(/\{[\s\S]*\}/); return match ? JSON.parse(match[0]) : {}; } catch { return {}; } };

const looksLikeDuplicate = (prov: string, num: string, date: string, albaranes: Albaran[]) => 
  albaranes.some(a => basicNorm(a.prov) === basicNorm(prov) && (a.num||'S/N') === (num||'S/N') && (a.date||'').slice(0,10) === (date||'').slice(0,10));

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
    case "g":  return Num.round2(unitPrice * 1000); 
    case "ml": return Num.round2(unitPrice * 1000); 
    default:   return Num.round2(unitPrice);
  }
};

/* =======================================================
 * 🚀 CEREBRO FACTURACIÓN: PROMOCIÓN AUTOMÁTICA
 * ======================================================= */
const groupKey = (alb: Albaran) => `${basicNorm(alb.prov)}__${(alb.date || DateUtil.today()).slice(0, 7)}`;

const findFacturaIdx = (data: AppData, alb: Albaran) => {
  const key = basicNorm(alb.prov);
  const yymm = (alb.date || DateUtil.today()).slice(0, 7);
  return (data.facturas || []).findIndex((f: any) =>
    f?.tipo === 'compra' &&
    basicNorm(f?.prov) === key &&
    (f?.date || '').startsWith(yymm) &&
    !f?.reconciled
  );
};

const facturaHasAlb = (f: any, albId: string) => Array.isArray(f?.albaranIdsArr) && f.albaranIdsArr.includes(albId);

function detachFromPreviousFacturaIfMoved(data: AppData, before: Albaran, after: Albaran) {
  if (groupKey(before) === groupKey(after)) return;

  const idx = (data.facturas || []).findIndex((f: any) =>
    Array.isArray(f.albaranIdsArr) && f.albaranIdsArr.includes(before.id)
  );
  if (idx < 0) return;

  const F = data.facturas[idx] as any;
  const tb = Num.parse(before.total) || 0;
  const bb = Num.parse(before.base)  || Num.round2(tb / 1.10);
  const ib = Num.parse(before.taxes) || Num.round2(tb - bb);

  F.total = Num.round2((Num.parse(F.total) || 0) - tb);
  F.base  = Num.round2((Num.parse(F.base)  || 0) - bb);
  F.tax   = Num.round2((Num.parse(F.tax)   || 0) - ib);
  F.albaranIdsArr = F.albaranIdsArr.filter((id: string) => id !== before.id);

  if ((F.albaranIdsArr || []).length === 0 && !F.reconciled) {
    data.facturas.splice(idx, 1);
  }
}

function upsertFacturaFromAlbaran(data: AppData, alb: Albaran) {
  if (!Array.isArray(data.facturas)) data.facturas = [];
  const idx = findFacturaIdx(data, alb);

  const t = Num.parse(alb.total) || 0;
  const b = Num.parse(alb.base)  || Num.round2(t / 1.10);
  const i = Num.parse(alb.taxes) || Num.round2(t - b);

  if (idx >= 0) {
    const F = data.facturas[idx] as any;
    if (!facturaHasAlb(F, alb.id)) {
      F.total = Num.round2((Num.parse(F.total) || 0) + t);
      F.base  = Num.round2((Num.parse(F.base)  || 0) + b);
      F.tax   = Num.round2((Num.parse(F.tax)   || 0) + i);
      F.albaranIdsArr = Array.from(new Set([...(F.albaranIdsArr || []), alb.id]));
    }
  } else {
    const newF = {
      id: `fac-auto-${Date.now()}`,
      tipo: 'compra',
      num: `AUTO-${alb.num || 'SN'}`,
      date: alb.date || DateUtil.today(),
      prov: alb.prov,
      total: t, base: b, tax: i,
      paid: false,
      reconciled: false,
      status: 'approved',
      unidad_negocio: alb.unitId || 'REST',
      albaranIdsArr: [alb.id],
      source: 'auto-from-albaran',
    } as any;
    data.facturas.unshift(newF);
  }

  const ai = (data.albaranes || []).findIndex(a => a.id === alb.id);
  if (ai >= 0) data.albaranes[ai] = { ...data.albaranes[ai], invoiced: true };
}

/* =======================================================
 * 🧠 2. MOTOR DE PARSEO V2 INTEGRADO CON MODO DUAL DE IVA
 * ======================================================= */
type IvaMode = 'AUTO' | 'INC' | 'EXC';

function useAlbaranEnginePRO(text: string, expectedTotal: number | null, ivaMode: IvaMode) {
  const { analyzedItems, liveTotals, decidedMode, roundingAdjustment } = useMemo(() => {
    if (!text) return { analyzedItems: [], liveTotals: { grandTotal: 0, baseFinal: 0, taxFinal: 0, split: { base10: 0, iva10: 0, base21: 0, iva21: 0 } }, decidedMode: ivaMode, roundingAdjustment: 0 };
    
    const lines = text.replace(/\t/g,' ').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const rawData = [];

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

      const nums = Array.from(line.matchAll(/(\d+(?:\.\d{1,3})?)/g)).map(m=> parseFloat(m[1]));
      if (!nums.length) continue;

      const discount = line.match(/(-\s?\d+(?:[.,]\d{1,2})?)\b/)?.[1] ? Math.abs(parseFloat(line.match(/(-\s?\d+(?:[.,]\d{1,2})?)\b/)![1].replace(',','.'))) : 0;
      const rawNumber = Num.round2((nums.at(-1) || 0) - discount);
      if (!isFinite(rawNumber) || rawNumber <= 0) continue;

      let name = line;
      if (mQty) name = name.replace(mQty[0],'');
      if (mRate) name = name.replace(mRate[0],'');
      if (discount) name = name.replace(/(-\s?\d+(?:[.,]\d{1,2})?)\b/,'');
      name = name.replace(new RegExp(`${(nums.at(-1) || 0).toString().replace('.', '\\.')}(?!\\d)`),'').replace(/\s{2,}/g,' ').trim() || 'Varios Indefinido';

      rawData.push({ q, name, rawNumber, rate, u });
    }

    const buildLines = (isIvaIncluded: boolean) => {
      const out = [];
      let grandTotal = 0, b4=0, i4=0, b10=0, i10=0, b21=0, i21=0;

      for (const raw of rawData) {
        let total, base, tax, unitPriceBruto;

        if (isIvaIncluded) {
          total = raw.rawNumber;
          base = Num.round2(total / (1 + raw.rate/100));
          tax = Num.round2(total - base);
          unitPriceBruto = raw.q > 0 ? total / raw.q : total;
        } else {
          base = raw.rawNumber; 
          tax = Num.round2(base * (raw.rate/100));
          total = Num.round2(base + tax);
          unitPriceBruto = raw.q > 0 ? base / raw.q : base; 
        }

        grandTotal += total;
        if (raw.rate === 4) { b4 += base; i4 += tax; }
        else if (raw.rate === 21) { b21 += base; i21 += tax; }
        else { b10 += base; i10 += tax; }

        out.push({ q: raw.q, n: raw.name, t: Num.round2(total), rate: raw.rate, base: Num.round2(base), tax: Num.round2(tax), unitPrice: Num.round2(unitPriceBruto), u: raw.u });
      }

      return { 
        lines: out, 
        sumTotal: Num.round2(grandTotal), 
        totals: {
          grandTotal: Num.round2(grandTotal), baseFinal: Num.round2(b4+b10+b21), taxFinal: Num.round2(i4+i10+i21),
          split: { base10: Num.round2(b10), iva10: Num.round2(i10), base21: Num.round2(b21), iva21: Num.round2(i21) }
        }
      };
    };

    let calcInc = buildLines(true);
    let calcExc = buildLines(false);
    
    let chosenCalc = calcInc;
    let finalMode: 'INC' | 'EXC' = 'INC';

    if (ivaMode === 'INC') { chosenCalc = calcInc; finalMode = 'INC'; }
    else if (ivaMode === 'EXC') { chosenCalc = calcExc; finalMode = 'EXC'; }
    else if (expectedTotal && expectedTotal > 0) {
      const diffInc = Math.abs(calcInc.sumTotal - expectedTotal);
      const diffExc = Math.abs(calcExc.sumTotal - expectedTotal);
      
      if (diffExc < diffInc && diffExc < 5) {
        chosenCalc = calcExc; finalMode = 'EXC';
      }
    }

    let rounding = 0;
    if (expectedTotal && expectedTotal > 0) {
       const diff = Num.round2(expectedTotal - chosenCalc.sumTotal);
       if (diff !== 0 && Math.abs(diff) <= 0.05) {
          rounding = diff;
          chosenCalc.totals.grandTotal = Num.round2(chosenCalc.totals.grandTotal + rounding);
       }
    }

    return { analyzedItems: chosenCalc.lines, liveTotals: chosenCalc.totals, decidedMode: finalMode, roundingAdjustment: rounding };
  }, [text, expectedTotal, ivaMode]);

  return { analyzedItems, liveTotals, decidedMode, roundingAdjustment };
}

/* =======================================================
 * 📈 3. PRICE INSPECTOR (Incrustado)
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
  
  const deferredProv = useDeferredValue(prov);
  const deferredItem = useDeferredValue(item);

  const { series, avgAll } = usePriceSeries({ history: priceHistory, albaranes: albaranesLite, prov: deferredProv, item: deferredItem });
  
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
          <p className="text-slate-500 font-bold text-sm">Faltan datos o buscando...</p>
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
  const safeData = data || { albaranes: [], facturas: [], socios: [] };
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
  
  // 🆕 ESTADO DE ORDENACIÓN
  const [sortConfig, setSortConfig] = useState<{ key: 'date' | 'prov' | 'total', asc: boolean }>({ key: 'date', asc: false });
  
  const [form, setForm] = useState({ prov: '', date: DateUtil.today(), num: '', socio: 'Arume', notes: '', text: '', paid: false, unitId: 'REST' as BusinessUnit, expectedTotal: null as number | null });
  const [ivaMode, setIvaMode] = useState<IvaMode>('AUTO');
  
  const [quickCalc, setQuickCalc] = useState({ name: '', total: '', iva: 10 });
  const [editForm, setEditForm] = useState<Albaran | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSyncingTelegram, setIsSyncingTelegram] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { analyzedItems, liveTotals, decidedMode, roundingAdjustment } = useAlbaranEnginePRO(form.text, form.expectedTotal, ivaMode);
  const isTotalMatching = form.expectedTotal ? Math.abs(liveTotals.grandTotal - form.expectedTotal) <= TOLERANCIA : true;

  const inRange = (iso: string, from?: string, to?: string) => {
    if (!iso) return false; const d = iso.slice(0,10);
    if (from && d < from) return false; if (to && d > to) return false;
    return true;
  };

  const presetThisMonth = () => { const y = new Date().getFullYear(); const m = String(new Date().getMonth()+1).padStart(2,'0'); setDateFrom(`${y}-${m}-01`); setDateTo(`${y}-${m}-${String(new Date(y, new Date().getMonth()+1, 0).getDate()).padStart(2,'0')}`); };
  const presetLast7d = () => { const end = new Date(); const start = new Date(Date.now() - 6*86400000); setDateFrom(`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`); setDateTo(`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`); };
  const presetToday = () => { const t = new Date().toISOString().slice(0,10); setDateFrom(t); setDateTo(t); };

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

  const handleTelegramSync = async () => {
    setIsSyncingTelegram(true);
    try {
      const { data: correos, error } = await supabase
        .from('inbox_general')
        .select('*')
        .ilike('remitente', '📸%')
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (correos && correos.length > 0) {
        const doc = correos[0];
        const provMatch = doc.remitente.match(/📸\s*(.*?)\s*\(/);
        const prov = provMatch ? provMatch[1].trim() : "Desconocido";
        const dateMatch = doc.asunto.match(/Fecha:\s*([\d-]+)/);
        const dateStr = dateMatch ? dateMatch[1] : DateUtil.today();
        const totalMatch = doc.asunto.match(/Importe:\s*([\d.]+)/);
        const totalNum = totalMatch ? parseFloat(totalMatch[1]) : 0;

        setForm(prev => ({
          ...prev, prov: prov.toUpperCase(), date: dateStr, num: `TG-${Date.now().toString().slice(-4)}`,
          expectedTotal: totalNum,
          text: `1x GASTOS VARIOS ${prov} 10% ${totalNum}` 
        }));

        await supabase.from('inbox_general').delete().eq('id', doc.id);
        alert("✅ Ticket importado desde Telegram. Revisa el formulario de la izquierda.");
      } else {
        alert("ℹ️ No hay nuevos tickets pendientes enviados desde Telegram.");
      }
    } catch (e) {
      alert("⚠️ Error al conectar con Telegram.");
    } finally {
      setIsSyncingTelegram(false);
    }
  };

  const processLocalFile = async (file: File) => {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return alert("⚠️ Configura tu clave de Gemini API en los ajustes primero.");
    
    setIsScanning(true); 
    try {
      const fileBase64 = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file); });
      const soloBase64 = fileBase64.split(',')[1];

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Analiza este albarán. Devuelve SOLO un JSON estricto: { "proveedor": "Nombre", "num": "Nº", "fecha": "YYYY-MM-DD", "total_factura": 0, "lineas": [ {"q": 1, "n": "Producto", "t": 10.50, "rate": 10, "u": "kg"} ] }`;
      
      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: soloBase64, mimeType: file.type } }] }], config: { responseMimeType: "application/json", temperature: 0.1 } });
      const rawJson = safeJSON(response.text || "");
      
      setForm(prev => ({ 
        ...prev, 
        prov: rawJson.proveedor || '', 
        num: rawJson.num || '', 
        date: rawJson.fecha || DateUtil.today(),
        expectedTotal: rawJson.total_factura || null,
        text: (rawJson.lineas || []).map((l:any) => `${l.q} ${l.u || 'uds'} ${l.n} ${l.rate}% ${l.t}`).join('\n')
      }));
      alert("✅ IA completada. He auto-detectado el modo de IVA según el total del documento.");
    } catch (e) {
      alert("⚠️ Error en IA. Rellena el albarán a mano.");
    } finally { setIsScanning(false); }
  };

  const toggleRecording = async () => {
    if (isRecording) { mediaRecorderRef.current?.stop(); setIsRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mr; audioChunksRef.current = [];
      mr.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        await processAudioWithVosk(audioBlob);
      };
      mr.start(); setIsRecording(true);
      setTimeout(() => { if (mr.state === 'recording') toggleRecording(); }, 30000); 
    } catch (err) { alert("⚠️ Necesitas dar permiso al micrófono."); }
  };

  const processAudioWithVosk = async (blob: Blob) => {
    setIsScanning(true); 
    try {
      const formData = new FormData(); formData.append("file", blob, "albaran.webm");
      const voskRes = await fetch("http://localhost:2700/transcribe", { method: "POST", body: formData });
      if (!voskRes.ok) throw new Error("Vosk no responde");
      const voskData = await voskRes.json();
      const txt = voskData.text || "";
      setForm(prev => ({ ...prev, text: prev.text ? `${prev.text}\n${txt}` : txt }));
    } catch (e) { alert("⚠️ Error conectando con servidor VOSK local."); } 
    finally { setIsScanning(false); }
  };

  const handleQuickAdd = () => {
    const t = Num.parse(quickCalc.total);
    if (t > 0 && quickCalc.name) {
      const newLine = `1x ${quickCalc.name} ${quickCalc.iva}% ${t.toFixed(2)}`;
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
    if (isSaving) return;
    if (!form.prov) return alert("⚠️ Introduce el nombre del proveedor.");
    if (analyzedItems.length === 0) return alert("⚠️ Añade al menos una línea.");

    if (looksLikeDuplicate(form.prov, form.num||'S/N', form.date, albaranesSeguros)) {
       if (!window.confirm("⚠️ Posible duplicado (mismo proveedor, nº y fecha). ¿Guardar igualmente?")) return;
    }

    setIsSaving(true);
    try {
        const newData = JSON.parse(JSON.stringify(data)) as AppData;
        if (!newData.facturas) newData.facturas = [];
        if (!newData.priceHistory) newData.priceHistory = [];
        if (!newData.albaranes) newData.albaranes = [];

        const robustId = `alb-${form.date.replace(/-/g,'')}-${Date.now().toString().slice(-6)}-${form.unitId}`;
        let alerts: string[] = [];
        
        const finalItems = [...analyzedItems];
        if (roundingAdjustment !== 0) {
            finalItems.push({ q: 1, n: "AJUSTE REDONDEO IA", t: roundingAdjustment, rate: 0, base: roundingAdjustment, tax: 0, unitPrice: roundingAdjustment, u: 'uds' } as any);
        }

        for (const it of finalItems as any[]) {
          if (it.n === "AJUSTE REDONDEO IA") continue; 

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
          socio: form.socio, notes: form.notes, items: finalItems as any[], total: String(liveTotals.grandTotal),
          base: String(liveTotals.baseFinal), taxes: String(liveTotals.taxFinal), invoiced: false, paid: form.paid, status: 'ok', reconciled: false, unitId: form.unitId 
        };

        newData.albaranes.unshift(newAlbaran);
        upsertFacturaFromAlbaran(newData, newAlbaran);

        await onSave(newData);
        
        if (alerts.length > 0) alert("⚠️ ALERTA DE COSTES (Desviaciones detectadas)\n\n" + alerts.join("\n\n") + "\n\nRevisa si es por temporada o si el proveedor ha subido tarifas.");
        setForm(prev => ({ ...prev, prov: '', num: '', text: '', paid: false, expectedTotal: null }));
    } finally {
        setIsSaving(false);
    }
  };

  const handleSaveEdits = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault(); if (!editForm || isSaving) return;
    setIsSaving(true);
    
    try {
        const newData = JSON.parse(JSON.stringify(data)) as AppData;
        if (!newData.albaranes) newData.albaranes = [];
        if (!newData.facturas) newData.facturas = [];

        const index = newData.albaranes.findIndex((a: Albaran) => a.id === editForm.id);
        if (index === -1) return alert("⚠️ Error crítico: No se encontró el albarán.");

        const before = JSON.parse(JSON.stringify(newData.albaranes[index])) as Albaran;
        const sanitizedAlbaran = { 
          ...editForm, prov: editForm.prov?.trim().toUpperCase() || "DESCONOCIDO", socio: editForm.socio || "Arume", unitId: editForm.unitId || "REST", 
          total: String(Num.parse(editForm.total)), base: String(Num.parse(editForm.base)), taxes: String(Num.parse(editForm.taxes)) 
        };

        newData.albaranes[index] = sanitizedAlbaran;
        detachFromPreviousFacturaIfMoved(newData, before, sanitizedAlbaran);
        upsertFacturaFromAlbaran(newData, sanitizedAlbaran);

        // 🛠️ TRUCO REACT: Clonar el array principal para forzar a la tabla a re-dibujarse sí o sí
        newData.albaranes = [...newData.albaranes]; 

        await onSave(newData);
        setEditForm(null); 
    } finally {
        setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar este albarán permanentemente?")) return;
    setIsSaving(true);
    try {
        const newData = JSON.parse(JSON.stringify(data)) as AppData;
        const albaranToDelete = newData.albaranes?.find(a => a.id === id);
        
        if (albaranToDelete) {
           detachFromPreviousFacturaIfMoved(newData, albaranToDelete, { ...albaranToDelete, prov: 'DELETED_MOCK', date: '1970-01-01' } as any);
        }
        
        newData.albaranes = (newData.albaranes || []).filter(a => a.id !== id);
        await onSave(newData);
        setEditForm(null);
    } finally {
        setIsSaving(false);
    }
  };

  // 🧠 CEREBRO DE FILTRADO Y ORDENACIÓN APLICADO
  const filteredForList = useMemo(() => {
    // 1. Primero filtramos como siempre
    let result = albaranesSeguros
      .filter(a => (selectedUnit === 'ALL' ? true : a.unitId === selectedUnit))
      .filter(a => (!dateFrom && !dateTo) ? true : inRange(a.date || '', dateFrom, dateTo))
      .filter(a => !deferredSearch || filterByQuery(a, deferredSearch));

    // 2. Luego ORDENAMOS la lista final según las flechas
    result.sort((a, b) => {
      let valA: any, valB: any;

      if (sortConfig.key === 'date') {
        valA = a.date || '';
        valB = b.date || '';
      } else if (sortConfig.key === 'prov') {
        valA = (a.prov || '').toLowerCase();
        valB = (b.prov || '').toLowerCase();
      } else if (sortConfig.key === 'total') {
        valA = Num.parse(a.total) || 0;
        valB = Num.parse(b.total) || 0;
      }

      if (valA < valB) return sortConfig.asc ? -1 : 1;
      if (valA > valB) return sortConfig.asc ? 1 : -1;
      return 0;
    });

    return result;
  }, [albaranesSeguros, selectedUnit, dateFrom, dateTo, deferredSearch, sortConfig]);

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

  function filterByQuery(a: Albaran, q: string) {
    const term = basicNorm(q);
    if (basicNorm(a.prov).includes(term)) return true;
    if (basicNorm(a.num || '').includes(term)) return true;
    return (a.items || []).some(it => basicNorm(it.n).includes(term));
  }

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
      <header className="bg-white p-6 md:p-8 rounded-[3rem] shadow-sm border border-slate-100 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tighter">Albaranes & Compras</h2>
          <p className="text-xs text-indigo-500 font-bold uppercase tracking-widest mt-1">Recepción y Análisis</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
            
            <div className="hidden lg:flex flex-col items-end text-[10px] text-slate-500 font-bold px-2 border-l border-slate-200 pl-3">
              <span>{filteredForList.length} albaranes filtrados</span>
              <span className="text-sm text-slate-900 font-black tracking-tighter">{Num.fmt(sumFiltered)}</span>
            </div>
          </div>

        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
        
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
                  
                  {/* BOTÓN OCR PDF DIRECTO Y VOSK RESTAURADO */}
                  <div className="flex items-center gap-2">
                    <button onClick={toggleRecording} className={cn("p-2 rounded-xl transition", isRecording ? "bg-rose-100 text-rose-600 animate-pulse" : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100")} title="Dictar Albarán (Vosk)">
                      {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
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

                {/* MEJORA: Panel de Control de IVA y Total Escaneado */}
                <div className="mb-5 p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-amber-500" /> Control de IVA en Líneas</span>
                    <select value={ivaMode} onChange={(e) => setIvaMode(e.target.value as any)} className="bg-white border border-slate-200 rounded-lg text-[10px] font-bold px-2 py-1 outline-none text-slate-700">
                      <option value="AUTO">🤖 Auto-Detectar</option>
                      <option value="INC">✅ Líneas CON Iva</option>
                      <option value="EXC">❌ Líneas SIN Iva</option>
                    </select>
                  </div>
                  
                  <div className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Escaneado (Referencia)</label>
                    <div className="relative w-24">
                      <input type="number" step="0.01" value={form.expectedTotal || ''} onChange={(e) => setForm({...form, expectedTotal: e.target.value ? parseFloat(e.target.value) : null})} placeholder="0.00" className="w-full text-right bg-transparent text-sm font-black text-slate-700 outline-none" />
                      <span className="absolute right-0 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none opacity-0">€</span>
                    </div>
                  </div>

                  {decidedMode && ivaMode === 'AUTO' && form.expectedTotal && (
                    <p className="text-[9px] font-bold text-indigo-600 bg-indigo-50 p-1.5 rounded text-center">
                      IA Asignó: {decidedMode === 'INC' ? 'Precios Finales (Con IVA)' : 'Bases Imponibles (Sin IVA)'}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 mb-3 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100">
                  <input type="text" value={quickCalc.name} onChange={(e) => setQuickCalc({ ...quickCalc, name: e.target.value })} placeholder="Añadir a mano..." className="w-1/2 p-2 bg-white rounded-lg text-xs font-bold outline-none" />
                  <input type="number" value={quickCalc.total} onChange={(e) => setQuickCalc({ ...quickCalc, total: e.target.value })} placeholder="Precio €" className="w-1/4 p-2 bg-white rounded-lg text-xs font-bold outline-none text-right" />
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

                {/* TARJETA DE TOTALES CON FEEDBACK VISUAL DE CUADRE */}
                <div className={cn("flex justify-between items-center p-5 rounded-2xl text-white mb-5 shadow-lg transition-colors", 
                  !form.expectedTotal ? "bg-slate-900" : isTotalMatching ? "bg-emerald-600" : "bg-amber-600"
                )}>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-white/70 tracking-widest">Total Calculado</span>
                    {roundingAdjustment !== 0 && (
                      <span className="text-[9px] text-white/90 font-bold bg-white/20 px-1.5 py-0.5 rounded mt-1">
                        Ajuste auto: {roundingAdjustment > 0 ? '+' : ''}{roundingAdjustment}€
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-black tracking-tighter">{Num.fmt(liveTotals.grandTotal)}</span>
                    {form.expectedTotal && !isTotalMatching && (
                      <p className="text-[9px] font-bold text-white/80 mt-1">Ref: {Num.fmt(form.expectedTotal)} (Dif: {Num.fmt(Math.abs(liveTotals.grandTotal - form.expectedTotal))})</p>
                    )}
                  </div>
                </div>

                <button type="button" disabled={isSaving} onClick={handleSaveAlbaran} className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50">
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} GUARDAR ALBARÁN
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>

        <section className="lg:col-span-8">
          
          {/* 🆕 BARRA DE ORDENACIÓN VISUAL */}
          <div className="flex items-center gap-2 mb-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm overflow-x-auto custom-scrollbar">
            <span className="text-[10px] font-black uppercase text-slate-400 ml-2 tracking-widest flex items-center gap-1 shrink-0">
              <ArrowUpDown className="w-3 h-3" /> Ordenar por:
            </span>
            
            <button 
              onClick={() => setSortConfig({ key: 'date', asc: sortConfig.key === 'date' ? !sortConfig.asc : false })}
              className={cn("px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0", sortConfig.key === 'date' ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50")}
            >
              Fecha {sortConfig.key === 'date' && (sortConfig.asc ? <ArrowUp className="w-3 h-3"/> : <ArrowDown className="w-3 h-3"/>)}
            </button>

            <button 
              onClick={() => setSortConfig({ key: 'prov', asc: sortConfig.key === 'prov' ? !sortConfig.asc : true })}
              className={cn("px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0", sortConfig.key === 'prov' ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50")}
            >
              Proveedor {sortConfig.key === 'prov' && (sortConfig.asc ? <ArrowUp className="w-3 h-3"/> : <ArrowDown className="w-3 h-3"/>)}
            </button>

            <button 
              onClick={() => setSortConfig({ key: 'total', asc: sortConfig.key === 'total' ? !sortConfig.asc : false })}
              className={cn("px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0", sortConfig.key === 'total' ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50")}
            >
              Total {sortConfig.key === 'total' && (sortConfig.asc ? <ArrowUp className="w-3 h-3"/> : <ArrowDown className="w-3 h-3"/>)}
            </button>
          </div>

          {/* 🧩 LLAMAMOS A LA LISTA ORDENADA */}
          <AlbaranesList 
            albaranes={filteredForList} 
            searchQ={deferredSearch} 
            selectedUnit={selectedUnit} 
            businessUnits={BUSINESS_UNITS} 
            onOpenEdit={setEditForm} 
          />
        </section>
      </div>

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
