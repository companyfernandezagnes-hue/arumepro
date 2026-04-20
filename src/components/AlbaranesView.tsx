import React, { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react';
import { 
  Search, Plus, Download, Package, AlertTriangle, Check, 
  Building2, ShoppingBag, ListPlus, Users, Hotel, Layers, 
  XCircle, LineChart as LineChartIcon,
  FileText,
  Mic, Square, Camera, Loader2, Smartphone,
  Calculator, Sparkles,
  ChevronLeft, ChevronRight, RefreshCw, Gift, Percent
} from 'lucide-react';

// ✅ FIX: FileSpreadsheet no existe en lucide-react → alias seguro
const FileSpreadsheet = FileText;

import { AppData, Albaran, PriceHistoryItem } from '../types';
import { Num, ArumeEngine, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { scanDocument } from '../services/aiProviders';

import { supabase } from '../services/supabase'; 
import { basicNorm, TOLERANCIA as CENTRAL_TOLERANCIA, linkAlbaranesToFactura, unlinkAlbaranFromFactura } from '../services/invoicing';

import { AlbaranesList } from './AlbaranesList';
import { AlbaranEditModal } from './AlbaranEditModal';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm'; import { useVoiceInput } from '../hooks/useVoiceInput';

interface AlbaranesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

const BUSINESS_UNITS: { id: BusinessUnit; name: string; icon: any; color: string; bg: string }[] = [
  { id: 'REST', name: 'Restaurante',      icon: Building2,  color: 'text-indigo-600', bg: 'bg-indigo-50'  },
  { id: 'DLV',  name: 'Catering Hoteles', icon: Hotel,      color: 'text-amber-600',  bg: 'bg-amber-50'   },
  { id: 'SHOP', name: 'Tienda Sake',      icon: ShoppingBag,color: 'text-emerald-600',bg: 'bg-emerald-50' },
  { id: 'CORP', name: 'Socios / Corp',    icon: Users,      color: 'text-slate-600',  bg: 'bg-slate-100'  },
];

export const TOLERANCIA = CENTRAL_TOLERANCIA;

/**
 * Detecta el socio actual a partir de la sesión Google guardada por AuthScreen.
 * Se usa para auto-asignar el campo `socio` al crear un albarán nuevo, evitando
 * que el usuario tenga que escribirlo manualmente y garantizando trazabilidad
 * en el librito familiar (CuentasFamiliaresView).
 */
const getCurrentSocioFromSession = (): string => {
  try {
    const raw = sessionStorage.getItem('arume_google_session');
    if (!raw) return 'Agnès';
    const session = JSON.parse(raw) as { email?: string; name?: string };
    const email = (session.email || '').toLowerCase();
    // Las dos cuentas permitidas son ambas de Agnès
    if (email.includes('agnes') || email.includes('arumesakebar') || email.includes('companyfernandez')) return 'Agnès';
    if (email.includes('pau') || email.includes('onlyone')) return 'Pau';
    if (email.includes('jeroni')) return 'Jerónimo';
    if (email.includes('pedro')) return 'Pedro';
    return session.name || 'Agnès';
  } catch {
    return 'Agnès';
  }
};

const safeJSON = (str: string) => {
  try { const match = str.match(/\{[\s\S]*\}/); return match ? JSON.parse(match[0]) : {}; }
  catch { return {}; }
};

const singularize = (word: string) => {
  if (!word) return '';
  let w = basicNorm(word);
  if (w.endsWith('es')) return w.slice(0, -2);
  if (w.endsWith('s'))  return w.slice(0, -1);
  return w;
};

const looksLikeDuplicate = (prov: string, num: string, date: string, albaranes: Albaran[]) => 
  albaranes.some(a =>
    basicNorm(a.prov || '') === basicNorm(prov || '') &&
    (a.num  || 'S/N') === (num  || 'S/N') &&
    (a.date || '').slice(0, 10) === (date || '').slice(0, 10)
  );

const getDynamicThreshold = (itemName: string) => {
  if (!itemName) return 10;
  const n = basicNorm(itemName);
  if (n.match(/tomate|lechuga|cebolla|patata|pimiento|verdura|fruta|limon|naranja/)) return 25; 
  if (n.match(/pescado|salmon|lubina|pulpo|calamar|gamba|langostino/))               return 15; 
  if (n.match(/carne|ternera|pollo|cerdo/))                                           return 8; 
  if (n.match(/vino|cerveza|agua|refresco|cafe|azucar|harina/))                      return 5; 
  return 10; 
};

const normalizeUnitPrice = (q: number, u: string | undefined, unitPrice: number) => {
  if (!u) return Num.round2(unitPrice);
  switch (u.toLowerCase()) {
    case 'g': case 'gr': case 'grs': return Num.round2(unitPrice * 1000); 
    case 'ml':                        return Num.round2(unitPrice * 1000); 
    default:                          return Num.round2(unitPrice);
  }
};

/* =======================================================
 * CEREBRO FACTURACIÓN: PROMOCIÓN AUTOMÁTICA
 * ======================================================= */
const groupKey = (alb: Albaran) =>
  `${basicNorm(alb.prov || '')}__${(alb.date || DateUtil.today()).slice(0, 7)}`;

const findFacturaIdx = (data: AppData, alb: Albaran) => {
  const key  = basicNorm(alb.prov || '');
  const yymm = (alb.date || DateUtil.today()).slice(0, 7);
  return (data.facturas || []).findIndex((f: any) =>
    f?.tipo === 'compra' &&
    basicNorm(f?.prov || '') === key &&
    (f?.date || '').startsWith(yymm) &&
    !f?.reconciled
  );
};

const facturaHasAlb = (f: any, albId: string) =>
  Array.isArray(f?.albaranIdsArr) && f.albaranIdsArr.includes(albId);

function detachFromPreviousFacturaIfMoved(data: AppData, before: Albaran, after: Albaran) {
  if (groupKey(before) === groupKey(after)) return;
  const prevFac = (data.facturas || []).find((f: any) =>
    Array.isArray(f.albaranIdsArr) && f.albaranIdsArr.includes(before.id)
  );
  if (!prevFac) return;
  unlinkAlbaranFromFactura(data, prevFac.id, before.id);
}

function upsertFacturaFromAlbaran(data: AppData, alb: Albaran) {
  if (!Array.isArray(data.facturas)) data.facturas = [];
  const existingIdx = findFacturaIdx(data, alb);
  if (existingIdx < 0) {
    data.facturas.unshift({
      id: `fac-auto-${Date.now()}`,
      tipo: 'compra',
      num: `AUTO-${alb.num || 'SN'}`,
      date: alb.date || DateUtil.today(),
      prov: alb.prov,
      total: '0', base: '0', tax: '0',
      paid: false, reconciled: false, status: 'approved',
      unidad_negocio: alb.unitId || 'REST',
      albaranIdsArr: [],
      source: 'ia-auto',
    } as any);
  }
  const idx = findFacturaIdx(data, alb);
  if (idx < 0) return;
  const factura = data.facturas[idx] as any;
  linkAlbaranesToFactura(data, factura.id, [alb.id]);
}

/* =======================================================
 * MOTOR DE PARSEO V2
 * ======================================================= */
type IvaMode = 'AUTO' | 'INC' | 'EXC';

function useAlbaranEnginePRO(text: string, expectedTotal: number | null, ivaMode: IvaMode) {
  const result = useMemo(() => {
    const empty = {
      analyzedItems: [],
      liveTotals: { grandTotal: 0, baseFinal: 0, taxFinal: 0,
        split: { base4:0, iva4:0, base10:0, iva10:0, base21:0, iva21:0 } },
      decidedMode: ivaMode, roundingAdjustment: 0,
    };
    if (!text) return empty;

    const lines = text.replace(/\t/g, ' ').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const rawData: any[] = [];

    for (const original of lines) {
      let line = original.replace(/[€$]/g, '').replace(/,/g, '.').replace(/\s{2,}/g, ' ').trim();
      if (line.length < 3) continue;

      let rate: 0|4|10|21 = 10;
      const mRate = line.match(/\b(0|4|10|21)\s?%/i);
      if (mRate) rate = Number(mRate[1]) as 0|4|10|21;

      let q = 1, u = 'uds';
      const mQty = line.match(/^(\d+(?:[.,]\d{1,3})?)\s*(kg|kgs|kilo|g|gr|grs|l|lt|litro|ml|ud|uds|x)\b/i);
      if (mQty) {
        q = parseFloat(mQty[1].replace(',', '.'));
        const ut = mQty[2].toLowerCase();
        u = ['kg','kgs','kilo'].includes(ut) ? 'kg'
          : ['g','gr','grs'].includes(ut)   ? 'g'
          : ['l','lt','litro'].includes(ut)  ? 'l'
          : ut === 'ml'                      ? 'ml' : 'uds';
      }

      const isGift             = /regalo|sin cargo|promocion|bonificaci|muestra/i.test(line);
      const isExplicitDiscount = /descuento|dto|rappel/i.test(line);
      const mNeg               = line.match(/(-\s*\d+(?:\.\d{1,3})?)(?:\s*[€$])?$/);

      let rawNumber = 0;
      if (mNeg) {
        rawNumber = parseFloat(mNeg[1].replace(/\s/g, ''));
      } else {
        const nums = Array.from(line.matchAll(/(\d+(?:\.\d{1,3})?)/g)).map(m => parseFloat(m[1]));
        if (!nums.length && !isGift) continue;
        const lastNum      = nums.length ? nums[nums.length - 1] : 0;
        const mDisc        = line.match(/(-\s?\d+(?:\.\d{1,2})?)\b/)?.[1];
        const discountVal  = mDisc ? Math.abs(parseFloat(mDisc.replace(/\s/g, ''))) : 0;
        rawNumber          = Num.round2(lastNum - discountVal);
      }
      if (isGift) rawNumber = 0;
      if (isExplicitDiscount && rawNumber > 0 && !line.includes('-')) rawNumber = -rawNumber;
      if (!isFinite(rawNumber)) continue;

      let name = line;
      if (mQty)  name = name.replace(mQty[0], '');
      if (mRate) name = name.replace(mRate[0], '');
      name = name.replace(/(-\s?\d+(?:\.\d{1,2})?)\b/g, '');
      name = name.replace(new RegExp(`${Math.abs(rawNumber).toString().replace('.', '\\.')}(?!\\d)`), '');
      name = name.replace(/[€$]/g, '').replace(/\s{2,}/g, ' ').trim()
        || (rawNumber < 0 ? 'Descuento / Abono' : rawNumber === 0 ? 'Artículo de Regalo' : 'Varios Indefinido');

      rawData.push({ q, name, rawNumber, rate, u });
    }

    const buildLines = (isInc: boolean) => {
      let grandTotal = 0, b4=0,i4=0,b10=0,i10=0,b21=0,i21=0;
      const out: any[] = [];
      for (const raw of rawData) {
        let total, base, tax, unitPriceBruto;
        if (isInc) {
          total          = raw.rawNumber;
          base           = Num.round2(total / (1 + raw.rate/100));
          tax            = Num.round2(total - base);
          unitPriceBruto = raw.q > 0 ? total / raw.q : total;
        } else {
          base           = raw.rawNumber;
          tax            = Num.round2(base * (raw.rate/100));
          total          = Num.round2(base + tax);
          unitPriceBruto = raw.q > 0 ? base / raw.q : base;
        }
        grandTotal += total;
        if (raw.rate === 4 || raw.rate === 0) { b4 += base; i4 += tax; }
        else if (raw.rate === 21)              { b21+= base; i21+= tax; }
        else                                   { b10+= base; i10+= tax; }
        out.push({ q:raw.q, n:raw.name, t:Num.round2(total), total:Num.round2(total),
          rate:raw.rate, base:Num.round2(base), tax:Num.round2(tax),
          unitPrice:Num.round2(unitPriceBruto), u:raw.u });
      }
      return { lines:out, sumTotal:Num.round2(grandTotal), totals:{
        grandTotal:Num.round2(grandTotal), baseFinal:Num.round2(b4+b10+b21), taxFinal:Num.round2(i4+i10+i21),
        split:{ base4:Num.round2(b4),iva4:Num.round2(i4),base10:Num.round2(b10),
                iva10:Num.round2(i10),base21:Num.round2(b21),iva21:Num.round2(i21) }
      }};
    };

    const calcInc = buildLines(true);
    const calcExc = buildLines(false);
    let chosenCalc = calcInc;
    let finalMode: 'INC'|'EXC' = 'INC';

    if (ivaMode === 'INC')       { chosenCalc = calcInc; finalMode = 'INC'; }
    else if (ivaMode === 'EXC')  { chosenCalc = calcExc; finalMode = 'EXC'; }
    else if (expectedTotal && expectedTotal > 0) {
      const diffExc = Math.abs(calcExc.sumTotal - expectedTotal);
      const diffInc = Math.abs(calcInc.sumTotal - expectedTotal);
      if (diffExc < diffInc && diffExc < 5) { chosenCalc = calcExc; finalMode = 'EXC'; }
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

  return result;
}

/* =======================================================
 * PRICE INSPECTOR
 * ======================================================= */
interface PricePoint     { date:string; price:number; sma30:number; deltaPct:number; }
interface AlbaranLiteItem{ q:number; n:string; unitPrice?:number; u?:string; t:number|string; }
interface AlbaranLite    { date:string; prov:string; items:AlbaranLiteItem[]; }
interface PriceSeriesParams{ history:PriceHistoryItem[]; albaranes:AlbaranLite[]; prov:string; item:string; }
interface PriceSeriesResult{ series:PricePoint[]; avgAll:number; avg30:number; }
interface PriceInspectorProps{
  priceHistory:PriceHistoryItem[]; albaranesLite:AlbaranLite[];
  proveedores:string[]; suggestionsByProv:Record<string,string[]>;
  defaultProv?:string; defaultItem?:string;
}

function smaN(values: number[], n=30) {
  const out: number[] = []; let acc = 0;
  for (let i=0; i<values.length; i++) {
    acc += values[i];
    if (i >= n) acc -= values[i-n];
    out.push(i >= n-1 ? Num.round2(acc/n) : NaN);
  }
  return out;
}

function usePriceSeries({ history, albaranes, prov, item }: PriceSeriesParams): PriceSeriesResult {
  return useMemo(() => {
    if (!prov || !item) return { series:[], avgAll:0, avg30:0 };
    const pNorm = basicNorm(prov);
    const iNorm = singularize(item);
    const H     = (history||[]).filter(h => basicNorm(h.prov||'') === pNorm && basicNorm(h.item||'').includes(iNorm));
    let fallback: PriceHistoryItem[] = [];
    if (!H.length) {
      for (const a of (albaranes||[])) {
        if (basicNorm(a.prov||'') !== pNorm) continue;
        for (const it of (a.items||[])) {
          const nNorm = singularize(it.n||'');
          if (!nNorm.includes(iNorm) && !iNorm.includes(nNorm)) continue;
          let up = Number(it.unitPrice);
          if (!isFinite(up) || up <= 0) { const qt = Number(it.q) > 0 ? Number(it.q) : 1; up = Number(it.t) / qt; }
          if (!isFinite(up) || up <= 0) continue;
          fallback.push({ id:`rb-${prov}-${it.n}-${a.date}`, prov, item:it.n||'',
            unitPrice:normalizeUnitPrice(it.q,it.u,up), date:a.date||'' });
        }
      }
    }
    const rawRows = (H.length ? H : fallback).filter(r => r.unitPrice > 0 && r.date);
    const grouped = rawRows.reduce((acc:Record<string,{sum:number;count:number}>, curr) => {
      if (!curr.date) return acc;
      if (!acc[curr.date]) acc[curr.date] = { sum:0, count:0 };
      acc[curr.date].sum   += curr.unitPrice;
      acc[curr.date].count += 1;
      return acc;
    }, {});
    const rows = Object.keys(grouped).map(date => ({
      date, price: Num.round2(grouped[date].sum / grouped[date].count)
    })).sort((a,b) => (a.date||'').localeCompare(b.date||''));
    if (!rows.length) return { series:[], avgAll:0, avg30:0 };
    const prices = rows.map(s => s.price);
    const avgAll = Num.round2(prices.reduce((a,x)=>a+x,0)/prices.length);
    const sma30  = smaN(prices, 30);
    const avg30  = Num.round2(sma30.filter(x=>!Number.isNaN(x)).slice(-30).reduce((a,x,_,arr)=>a+x/(arr.length||1),0)||0);
    const withMetrics = rows.map((s,i) => {
      const prev = i>0 ? rows[i-1].price : s.price;
      const deltaPct = prev>0 ? Num.round2(((s.price-prev)/prev)*100) : 0;
      return { ...s, sma30:sma30[i], deltaPct };
    });
    return { series:withMetrics, avgAll, avg30 };
  }, [history, albaranes, prov, item]);
}

function PriceEvolutionChart({ data, unitLabel='€', upThreshold=10 }: { data:PricePoint[]; unitLabel?:string; upThreshold?:number }) {
  const domain = useMemo(() => {
    if (!data.length) return [0,1];
    const vals = data.map(d=>d.price).filter(v=>Number.isFinite(v));
    return [Math.max(0,Math.floor(Math.min(...vals)*0.95*100)/100), Math.ceil(Math.max(...vals)*1.05*100)/100];
  }, [data]);
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm mt-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-black text-slate-800">Evolución del precio</h4>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{unitLabel}</span>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%" minHeight={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize:9, fill:'#94a3b8' }} tickMargin={6} axisLine={false} tickLine={false} />
            <YAxis domain={domain as [number,number]} tick={{ fontSize:9, fill:'#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v=>Num.round2(v).toString()} />
            <RechartsTooltip contentStyle={{ borderRadius:8, border:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.1)', fontWeight:'bold', fontSize:11 }}
              formatter={(val:number,name:string) => name==='price' ? [`${Num.round2(val)} ${unitLabel}`,'Precio'] : name==='sma30' ? [`${Num.round2(val)} ${unitLabel}`,'Media 30d'] : [val,name]} />
            <Legend wrapperStyle={{ fontSize:9, fontWeight:'bold', paddingTop:6 }} />
            <Line type="monotone" dataKey="price" name="Precio" stroke="#4f46e5" strokeWidth={2.5} isAnimationActive={false}
              dot={(props:any) => { const {cx,cy,payload}=props; const up=(payload?.deltaPct??0)>=upThreshold;
                return <circle cx={cx} cy={cy} r={up?3.5:0} fill={up?'#f43f5e':'transparent'} stroke={up?'#fff':'transparent'} strokeWidth={2} key={`d-${cx}-${cy}`}/>; }} />
            <Line type="monotone" dataKey="sma30" name="Media Móvil" stroke="#cbd5e1" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PriceInspector({ priceHistory, albaranesLite, proveedores, suggestionsByProv, defaultProv, defaultItem }: PriceInspectorProps) {
  const [prov, setProv] = useState((defaultProv||'').toUpperCase());
  const [item, setItem] = useState((defaultItem||'').toUpperCase());
  const dProv = useDeferredValue(prov);
  const dItem = useDeferredValue(item);
  const { series } = usePriceSeries({ history:priceHistory, albaranes:albaranesLite, prov:dProv, item:dItem });
  const topItems = (suggestionsByProv?.[prov]||[]).slice(0,10);
  return (
    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-inner">
      <h3 className="text-xs font-black text-slate-800 mb-3 flex items-center gap-1.5"><LineChartIcon className="w-4 h-4 text-indigo-500"/> Inspector de Precios</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Proveedor</label>
          <input list="pi-prov" value={prov} onChange={e=>setProv(e.target.value.toUpperCase())} className="mt-1 w-full p-2 bg-white rounded-lg text-xs font-bold border border-slate-200 outline-none focus:border-indigo-500" placeholder="Ej: MAKRO"/>
          <datalist id="pi-prov">{proveedores.map(p=><option key={p} value={p}/>)}</datalist>
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Producto</label>
          <input list="pi-item" value={item} onChange={e=>setItem(e.target.value.toUpperCase())} className="mt-1 w-full p-2 bg-white rounded-lg text-xs font-bold border border-slate-200 outline-none focus:border-indigo-500" placeholder="Ej: SALMÓN"/>
          <datalist id="pi-item">{topItems.map(i=><option key={i} value={i}/>)}</datalist>
        </div>
      </div>
      {series.length > 1 ? (
        <PriceEvolutionChart data={series} unitLabel="€" />
      ) : (
        <div className="bg-white rounded-lg border border-slate-100 p-5 text-center mt-3">
          <p className="text-slate-500 font-bold text-xs">Faltan datos o buscando...</p>
          <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">Selecciona proveedor y producto con +2 compras.</p>
        </div>
      )}
    </div>
  );
}

/* =======================================================
 * COMPONENTE PRINCIPAL
 * ======================================================= */
export const AlbaranesView = ({ data, onSave }: AlbaranesViewProps) => {
  const safeData         = data || { albaranes:[], facturas:[], socios:[] };
  const albaranesSeguros = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  const sociosReales     = (Array.isArray(safeData.socios) && safeData.socios.length > 0)
    ? safeData.socios.filter(s => s?.active) : [{ id:'s1', n:'ARUME' }];

  const proveedoresHistoricos = useMemo(() =>
    Array.from(new Set(albaranesSeguros.map(a => (a.prov||'').toUpperCase()).filter(Boolean))).sort(),
  [albaranesSeguros]);

  const [searchQ,        setSearchQ]        = useState('');
  const deferredSearch                      = useDeferredValue(searchQ);
  const [selectedUnit,   setSelectedUnit]   = useState<BusinessUnit|'ALL'>('ALL');
  const [dateFrom,       setDateFrom]       = useState('');
  const [dateTo,         setDateTo]         = useState('');
  const [showInspector,  setShowInspector]  = useState(false);
  const [inspectorDefaults, setInspectorDefaults] = useState<{prov?:string;item?:string}>({});
  const [form,           setForm]           = useState({ prov:'', date:DateUtil.today(), num:'', socio:getCurrentSocioFromSession(), notes:'', text:'', paid:false, unitId:'REST' as BusinessUnit, expectedTotal:null as number|null });
  const [ivaMode,        setIvaMode]        = useState<IvaMode>('AUTO');
  const [quickCalc,      setQuickCalc]      = useState({ name:'', total:'', iva:10 });
  const [editForm,       setEditForm]       = useState<Albaran|null>(null);
  const [isScanning,     setIsScanning]     = useState(false);
  const { isRecording, toggleRecording } = useVoiceInput({
    onResult: (text) => setForm(prev => ({
      ...prev,
      text: prev.text ? `${prev.text}\n${text}` : text,
    })),
  });
  const fileInputRef     = useRef<HTMLInputElement>(null);
  const [isSyncingTelegram, setIsSyncingTelegram] = useState(false);
  const [isSaving,       setIsSaving]       = useState(false);

  useEffect(() => {
    const handle = (e:any) => { const {cmd,q}=e.detail||{}; if (cmd==='buscar'&&q) { setSearchQ(q); window.scrollTo({top:0,behavior:'smooth'}); } };
    window.addEventListener('arume-bot-command', handle);
    return () => window.removeEventListener('arume-bot-command', handle);
  }, []);

  const { analyzedItems, liveTotals, decidedMode, roundingAdjustment } = useAlbaranEnginePRO(form.text, form.expectedTotal, ivaMode);
  const isTotalMatching = form.expectedTotal ? Math.abs(liveTotals.grandTotal - form.expectedTotal) <= TOLERANCIA : true;
  const hasGifts     = analyzedItems.some(it => it.total === 0);
  const hasDiscounts = analyzedItems.some(it => it.total < 0);

  const inRange = (iso:string, from?:string, to?:string) => {
    if (!iso) return false; const d=iso.slice(0,10);
    if (from && d<from) return false; if (to && d>to) return false; return true;
  };
  const presetThisMonth = () => { const y=new Date().getFullYear(); const m=String(new Date().getMonth()+1).padStart(2,'0'); setDateFrom(`${y}-${m}-01`); setDateTo(`${y}-${m}-${String(new Date(y,new Date().getMonth()+1,0).getDate()).padStart(2,'0')}`); };
  const presetLast7d    = () => { const e=new Date(); const s=new Date(Date.now()-6*86400000); setDateFrom(`${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}`); setDateTo(`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,'0')}-${String(e.getDate()).padStart(2,'0')}`); };
  const presetToday     = () => { const t=new Date().toISOString().slice(0,10); setDateFrom(t); setDateTo(t); };

  const albaranesLiteRanged = useMemo(() =>
    albaranesSeguros
      .filter(a => (!dateFrom&&!dateTo) ? true : inRange(a.date||'',dateFrom,dateTo))
      .map(a => ({ date:(a.date||'').slice(0,10), prov:(a.prov||'').toUpperCase(),
        items:(a.items||[]).map((it:any) => ({ q:it.q, n:it.n, unitPrice:it.unitPrice, u:it.u, t:it.t })) })),
  [albaranesSeguros, dateFrom, dateTo]);

  const suggestionsByProv = useMemo(() => {
    const map:Record<string,Record<string,number>> = {};
    for (const a of albaranesSeguros) {
      const P=(a.prov||'').toUpperCase(); if (!P) continue; map[P]??={};
      for (const it of (a.items||[])) { const N=(it.n||'').toUpperCase(); if (!N) continue; map[P][N]=(map[P][N]||0)+1; }
    }
    const out:Record<string,string[]>={};
    for (const p of Object.keys(map)) { out[p]=Object.entries(map[p]).sort((a,b)=>b[1]-a[1]).map(([n])=>n); }
    return out;
  }, [albaranesSeguros]);

  const lastPurchaseFromProv = useMemo(() => {
    if (!form.prov || form.prov.length < 2) return null;
    const pn = basicNorm(form.prov);
    const matches = albaranesSeguros.filter(a => basicNorm(a.prov||'')===pn).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    return matches.length > 0 ? matches[0] : null;
  }, [form.prov, albaranesSeguros]);

  const handleLoadLastPurchase = () => {
    if (!lastPurchaseFromProv?.items) return;
    setForm(prev => ({ ...prev, text: lastPurchaseFromProv.items!.map((it:any)=>`${it.q} ${it.u||'uds'} ${it.n} ${it.rate||10}% ${it.t}`).join('\n') }));
  };

  // ── Sync Telegram ─────────────────────────────────────────────────────────
  const handleTelegramSync = async () => {
    setIsSyncingTelegram(true);
    try {
      const { data:correos, error } = await supabase.from('inbox_general').select('*').ilike('remitente','📸%').order('created_at',{ascending:false}).limit(1);
      if (error) throw error;
      if (correos && correos.length > 0) {
        const doc     = correos[0];
        const prov    = doc.remitente.match(/📸\s*(.*?)\s*\(/)?.[1]?.trim() ?? 'Desconocido';
        const dateStr = doc.asunto.match(/Fecha:\s*([\d-]+)/)?.[1] ?? DateUtil.today();
        const totalNum= parseFloat(doc.asunto.match(/Importe:\s*([\d.]+)/)?.[1] ?? '0') || 0;
        setForm(prev => ({ ...prev, prov:prov.toUpperCase(), date:dateStr, num:`TG-${Date.now().toString().slice(-4)}`, expectedTotal:totalNum, text:`1x GASTOS VARIOS ${prov} 10% ${totalNum}` }));
        await supabase.from('inbox_general').delete().eq('id', doc.id);
        // 🆕 FIX: toast.success en vez de toast.info (no existe)
        toast.success('Ticket importado desde Telegram. Revisa el formulario.');
      } else {
        // 🆕 FIX: toast.warning en vez de toast.info
        toast.warning('No hay nuevos tickets pendientes desde Telegram.');
      }
    } catch {
      // 🆕 FIX: toast.error en vez de toast.info
      toast.error('Error al conectar con Telegram. Comprueba la configuración.');
    } finally { setIsSyncingTelegram(false); }
  };

  // ── Escanear archivo con Gemini ────────────────────────────────────────────
  const processLocalFile = async (file: File) => {
    setIsScanning(true);
    try {
      const prompt = `Analiza este albarán. Devuelve SOLO JSON: { "proveedor":"Nombre","num":"Nº","fecha":"YYYY-MM-DD","total_factura":0,"lineas":[{"q":1,"n":"Producto","t":10.50,"rate":10,"u":"kg"}] }`;
      const result = await scanDocument(file, prompt);
      const raw: any = result.raw;
      setForm(prev => ({ ...prev, prov:raw.proveedor||'', num:raw.num||'', date:raw.fecha||DateUtil.today(), expectedTotal:raw.total_factura||null, text:(raw.lineas||[]).map((l:any)=>`${l.q} ${l.u||'uds'} ${l.n} ${l.rate}% ${l.t}`).join('\n') }));
      toast.success('IA completada. Revisa los campos antes de guardar.');
    } catch {
      toast.error('Error en IA. Rellena el albarán a mano.');
    } finally { setIsScanning(false); }
  };





  const handleQuickAdd = () => {
    const t = parseFloat(quickCalc.total);
    if (!isNaN(t) && quickCalc.name) {
      setForm(prev => ({ ...prev, text: prev.text ? `${prev.text}\n1x ${quickCalc.name} ${quickCalc.iva}% ${t.toFixed(2)}` : `1x ${quickCalc.name} ${quickCalc.iva}% ${t.toFixed(2)}` }));
      setQuickCalc({ name:'', total:'', iva:10 });
    }
  };

  const detectPriceIncrease = (history:any[], prov:string, item:string, latestPrice:number) => {
    const pNorm = basicNorm(prov||'');
    const iNorm = singularize(item||'');
    const prev  = [...history.filter(h => basicNorm(h.prov||'')===pNorm && singularize(h.item||'').includes(iNorm))].sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0] ?? null;
    if (!prev || prev.unitPrice <= 0) return { isIncrease:false, pct:0, previous:null, threshold:0 };
    const pct       = Num.round2(((latestPrice-prev.unitPrice)/prev.unitPrice)*100);
    const threshold = getDynamicThreshold(item);
    return { isIncrease:pct>=threshold, pct, previous:prev, threshold };
  };

  // ── Guardar albarán nuevo ─────────────────────────────────────────────────
  const handleSaveAlbaran = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isSaving) return;
    // 🆕 FIX: toast.warning en vez de toast.info
    if (!form.prov) return void toast.warning('Introduce el nombre del proveedor.');
    if (analyzedItems.length === 0) return void toast.warning('Añade al menos una línea.');
    if (looksLikeDuplicate(form.prov, form.num||'S/N', form.date, albaranesSeguros)) {
      if (!await confirm({ title:'¿Posible duplicado?', message:'Ya existe un albarán del mismo proveedor, número y fecha. ¿Guardar igualmente?', warning:true, confirmLabel:'Sí, guardar' })) return;
    }
    setIsSaving(true);
    try {
      const newData = JSON.parse(JSON.stringify(data)) as AppData;
      if (!newData.facturas)     newData.facturas     = [];
      if (!newData.priceHistory) newData.priceHistory = [];
      if (!newData.albaranes)    newData.albaranes    = [];
      const robustId  = `alb-${form.date.replace(/-/g,'')}-${Date.now().toString().slice(-6)}-${form.unitId}`;
      const finalItems= [...analyzedItems];
      let alerts: string[] = [];
      if (roundingAdjustment !== 0) finalItems.push({ q:1, n:'AJUSTE REDONDEO IA', t:roundingAdjustment, total:roundingAdjustment, rate:0, base:roundingAdjustment, tax:0, unitPrice:roundingAdjustment, u:'uds' } as any);
      for (const it of finalItems as any[]) {
        if (it.n === 'AJUSTE REDONDEO IA') continue;
        const provN = form.prov.trim().toUpperCase();
        const itemN = it.n.trim().toUpperCase();
        const np    = normalizeUnitPrice(it.q, it.u, it.unitPrice);
        if (np > 0) {
          const inc = detectPriceIncrease(newData.priceHistory, provN, itemN, np);
          if (inc.isIncrease) { const msg=`📈 [${provN}] ${itemN} +${inc.pct}% (lím:${inc.threshold}%). Antes:${inc.previous?.unitPrice}€ → Ahora:${np}€`; alerts.push(msg); window.dispatchEvent(new CustomEvent('arume-bot-alert',{detail:msg})); }
          newData.priceHistory.push({ id:`price-${Date.now()}-${Math.random().toString(36).slice(2)}`, prov:provN, item:itemN, unitPrice:np, date:form.date, albaranId:robustId } as any);
        }
      }
      const newAlbaran: Albaran = {
        id:robustId, prov:form.prov.trim().toUpperCase(), date:form.date, num:form.num||'S/N',
        socio:form.socio, notes:form.notes, items:finalItems as any[],
        total:String(Num.round2(liveTotals.grandTotal)), base:String(Num.round2(liveTotals.baseFinal)), taxes:String(Num.round2(liveTotals.taxFinal)),
        invoiced:false, paid:form.paid, status:'ok', reconciled:false, unitId:form.unitId,
      };
      newData.albaranes.unshift(newAlbaran);
      upsertFacturaFromAlbaran(newData, newAlbaran);
      await onSave(newData);
      // 🆕 FIX: toast.warning en vez de toast.info para alertas de costes
      if (alerts.length) toast.warning('⚠️ ALERTA DE COSTES\n\n'+alerts.join('\n\n'));
      // 🆕 Confirmación de guardado
      else toast.success('Albarán guardado correctamente.');
      setForm(prev => ({ ...prev, prov:'', num:'', text:'', paid:false, expectedTotal:null }));
    } finally { setIsSaving(false); }
  };

  // ── Guardar edición ───────────────────────────────────────────────────────
  const handleSaveEdits = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault(); if (!editForm||isSaving) return;
    setIsSaving(true);
    try {
      const newData = JSON.parse(JSON.stringify(data)) as AppData;
      if (!newData.albaranes) newData.albaranes = [];
      if (!newData.facturas)  newData.facturas  = [];
      const index = newData.albaranes.findIndex((a:Albaran) => a.id===editForm.id);
      // 🆕 FIX: toast.error en vez de toast.info
      if (index===-1) return void toast.error('Error crítico: No se encontró el albarán.');
      const before = JSON.parse(JSON.stringify(newData.albaranes[index])) as Albaran;
      const san    = { ...editForm, prov:editForm.prov?.trim().toUpperCase()||'DESCONOCIDO', socio:editForm.socio||'Arume', unitId:editForm.unitId||'REST',
        total:String(Num.parse(editForm.total)), base:String(Num.parse(editForm.base)), taxes:String(Num.parse(editForm.taxes)) };
      newData.albaranes[index] = san;
      detachFromPreviousFacturaIfMoved(newData, before, san);
      upsertFacturaFromAlbaran(newData, san);
      newData.priceHistory = (newData.priceHistory||[]).filter((h:any) => h.albaranId!==editForm.id);
      let alerts: string[] = [];
      for (const it of san.items||[]) {
        if (it.n==='AJUSTE REDONDEO IA') continue;
        const provN=san.prov.trim().toUpperCase(); const itemN=it.n.trim().toUpperCase();
        let up=Number(it.unitPrice); if (!isFinite(up)||up<=0) { const qt=Number(it.q)>0?Number(it.q):1; up=Number(it.t)/qt; } if (!isFinite(up)||up<0) up=0;
        const np=normalizeUnitPrice(Number(it.q),it.u,up);
        if (np>0) {
          const inc=detectPriceIncrease(newData.priceHistory,provN,itemN,np);
          if (inc.isIncrease) { const msg=`📈 [${provN}] ${itemN} +${inc.pct}%`; alerts.push(msg); window.dispatchEvent(new CustomEvent('arume-bot-alert',{detail:msg})); }
          newData.priceHistory.push({ id:`price-${Date.now()}-${Math.random().toString(36).slice(2)}`, prov:provN, item:itemN, unitPrice:np, date:san.date, albaranId:editForm.id } as any);
        }
      }
      newData.albaranes = [...newData.albaranes];
      await onSave(newData); setEditForm(null);
      // 🆕 FIX: toast.warning en vez de toast.info para alertas de costes
      if (alerts.length) toast.warning('⚠️ ALERTA DE COSTES al editar\n\n'+alerts.join('\n\n'));
      else toast.success('Albarán actualizado correctamente.');
    } finally { setIsSaving(false); }
  };

  // ── Eliminar albarán ──────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!await confirm({ title:'¿Eliminar albarán?', message:'Esta acción no se puede deshacer. El albarán se desvinculará de su factura.', danger:true, confirmLabel:'Eliminar' })) return;
    setIsSaving(true);
    try {
      const newData = JSON.parse(JSON.stringify(data)) as AppData;
      const alb     = newData.albaranes?.find(a => a.id===id);
      if (alb) detachFromPreviousFacturaIfMoved(newData, alb, { ...alb, prov:'DELETED_MOCK', date:'1970-01-01' } as any);
      newData.priceHistory = (newData.priceHistory||[]).filter((h:any) => h.albaranId!==id);
      newData.albaranes    = (newData.albaranes||[]).filter(a => a.id!==id);
      await onSave(newData); setEditForm(null);
      toast.success('Albarán eliminado.');
    } finally { setIsSaving(false); }
  };

  function filterByQuery(a: Albaran, q: string) {
    const t = basicNorm(q);
    return basicNorm(a.prov||'').includes(t) || basicNorm(a.num||'').includes(t) || (a.items||[]).some(it => basicNorm(it.n||'').includes(t));
  }

  const filteredForList = useMemo(() => {
    return albaranesSeguros
      .filter(a => selectedUnit==='ALL' || a.unitId===selectedUnit)
      .filter(a => (!dateFrom&&!dateTo) || inRange(a.date||'',dateFrom,dateTo))
      .filter(a => !deferredSearch || filterByQuery(a, deferredSearch));
  }, [albaranesSeguros, selectedUnit, dateFrom, dateTo, deferredSearch]);

  const sumFiltered = useMemo(() => filteredForList.reduce((acc,a) => {
    const t = Num.parse(a.total);
    const safe = t > 0 ? t : (a.items||[]).reduce((s,it) => s+Num.parse(it.t),0);
    return acc + safe;
  }, 0), [filteredForList]);

  // ── Export Excel ──────────────────────────────────────────────────────────
  const handleExportExcel = () => {
    // 🆕 FIX: toast.warning en vez de toast.info
    if (!filteredForList.length) return void toast.warning('No hay albaranes en la selección actual para exportar.');
    const detail: any[] = [];
    for (const a of filteredForList) {
      const date=(a.date||'').slice(0,10);
      for (const it of (a.items||[])) {
        const q=Number(it.q||0); const up=Number(it.unitPrice??(q>0?Number(it.t||0)/q:Number(it.t||0)));
        detail.push({ FECHA:date, PROVEEDOR:a.prov||'', 'Nº ALBARÁN':a.num||'S/N', UNIDAD:a.unitId||'', ITEM:it.n||'', CANT:q, U:it.u||'', '%IVA':Number(it.rate||0), 'PRECIO UNIT':up, 'PRECIO UNIT NORM':normalizeUnitPrice(q,it.u as any,up), BASE:Number(it.base||0), IVA:Number(it.tax||0), TOTAL:Number(it.t||0), 'TOTAL ALBARÁN':Number(a.total||0) });
      }
    }
    const wsD=XLSX.utils.json_to_sheet(detail); wsD['!cols']=[{wch:12},{wch:28},{wch:14},{wch:10},{wch:36},{wch:8},{wch:6},{wch:6},{wch:14},{wch:16},{wch:12},{wch:10},{wch:12},{wch:14}];
    const provMap=new Map<string,any>();
    for (const a of filteredForList) {
      const k=a.prov||'—'; if (!provMap.has(k)) provMap.set(k,{base4:0,iva4:0,base10:0,iva10:0,base21:0,iva21:0,total:0}); const acc=provMap.get(k);
      for (const it of (a.items||[])) {
        const base=Number(it.base||0),iva=Number(it.tax||0);
        if (Number(it.rate||0)===21){acc.base21+=base;acc.iva21+=iva;} else if(Number(it.rate||0)===10){acc.base10+=base;acc.iva10+=iva;} else if(Number(it.rate||0)===4){acc.base4+=base;acc.iva4+=iva;}
        acc.total+=Number(it.t||0);
      }
    }
    const resumen=Array.from(provMap.entries()).map(([prov,v])=>({ PROVEEDOR:prov,'BASE 4%':Num.round2(v.base4),'IVA 4%':Num.round2(v.iva4),'BASE 10%':Num.round2(v.base10),'IVA 10%':Num.round2(v.iva10),'BASE 21%':Num.round2(v.base21),'IVA 21%':Num.round2(v.iva21),TOTAL:Num.round2(v.total) }));
    const wsP=XLSX.utils.json_to_sheet(resumen); wsP['!cols']=[{wch:30},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:14}];
    const tot={base4:0,iva4:0,base10:0,iva10:0,base21:0,iva21:0,total:0};
    for (const a of filteredForList) { for (const it of (a.items||[])) { const base=Number(it.base||0),iva=Number(it.tax||0),t=Number(it.t||0); if(Number(it.rate||0)===21){tot.base21+=base;tot.iva21+=iva;}else if(Number(it.rate||0)===10){tot.base10+=base;tot.iva10+=iva;}else if(Number(it.rate||0)===4){tot.base4+=base;tot.iva4+=iva;} tot.total+=t; } }
    const wsI=XLSX.utils.aoa_to_sheet([['Concepto','Importe'],['Base 4%',Num.round2(tot.base4)],['IVA 4%',Num.round2(tot.iva4)],['Base 10%',Num.round2(tot.base10)],['IVA 10%',Num.round2(tot.iva10)],['Base 21%',Num.round2(tot.base21)],['IVA 21%',Num.round2(tot.iva21)],['TOTAL',Num.round2(tot.total)],[],['Rango',`${dateFrom||'inicio'} a ${dateTo||'fin'}`]]);
    wsI['!cols']=[{wch:18},{wch:16}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,wsD,'Detalle'); XLSX.utils.book_append_sheet(wb,wsP,'Resumen Prov'); XLSX.utils.book_append_sheet(wb,wsI,'Totales IVA');
    XLSX.writeFile(wb,`Albaranes_${dateFrom||'ALL'}.xlsx`);
    toast.success(`Excel exportado — ${filteredForList.length} albaranes.`);
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 pb-20 max-w-[1600px] mx-auto animate-fade-in relative">

      {/* Overlay IA */}
      <AnimatePresence>
        {isScanning && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-[999] bg-slate-900/90 backdrop-blur-md flex flex-col items-center justify-center text-white">
            <Loader2 className="w-12 h-12 animate-spin text-indigo-400 mb-4"/>
            <h2 className="text-lg font-black tracking-tight">Procesando Documento...</h2>
            <p className="text-slate-400 mt-1 text-xs font-bold uppercase tracking-widest">Extrayendo Datos y Productos</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-800 tracking-tight">Albaranes & Compras</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Recepción y Análisis</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={handleTelegramSync} disabled={isSyncingTelegram} className="px-3 py-1.5 rounded-lg font-black text-[10px] uppercase bg-[#229ED9] text-white hover:bg-[#1E8CC0] transition flex items-center gap-1.5 disabled:opacity-50">
            {isSyncingTelegram ? <Loader2 className="w-3 h-3 animate-spin"/> : <Smartphone className="w-3 h-3"/>} Telegram
          </button>
          <button onClick={()=>setShowInspector(!showInspector)} className={cn('px-3 py-1.5 rounded-lg font-black text-[10px] uppercase transition flex items-center gap-1.5', showInspector?'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)]':'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50')}>
            <LineChartIcon className="w-3 h-3"/> Precios
          </button>
          <button onClick={handleExportExcel} className="px-3 py-1.5 rounded-lg font-black text-[10px] uppercase bg-emerald-600 text-white hover:bg-emerald-700 transition flex items-center gap-1.5">
            <FileSpreadsheet className="w-3 h-3"/> Excel
          </button>
        </div>
      </header>

      {/* Toolbar filtros */}
      <div className="sticky top-2 z-40">
        <div className="bg-white/95 backdrop-blur-md px-3 py-2 rounded-xl shadow-md border border-slate-200 flex flex-col xl:flex-row justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={()=>setSelectedUnit('ALL')} className={cn('px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition border flex items-center gap-1', selectedUnit==='ALL'?'bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] border-slate-900':'bg-white text-slate-400 border-slate-200 hover:bg-slate-50')}><Layers className="w-3 h-3"/> Todas</button>
            {BUSINESS_UNITS.map(u=>(
              <button key={u.id} onClick={()=>setSelectedUnit(u.id)} className={cn('px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition border flex items-center gap-1', selectedUnit===u.id?`${u.bg} ${u.color} border-transparent`:'bg-white text-slate-400 border-slate-200 hover:bg-slate-50')}><u.icon className="w-3 h-3"/> {u.name.split(' ')[0]}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
              <span className="text-[10px] font-black text-slate-400">Fecha</span>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none w-24"/>
              <span className="text-slate-300 text-xs">—</span>
              <input type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)}   className="bg-transparent text-[10px] font-bold outline-none w-24"/>
              <div className="flex items-center gap-1 ml-1 border-l border-slate-200 pl-1">
                <button onClick={presetToday}     className="px-1.5 py-0.5 rounded text-[9px] font-black bg-white hover:bg-indigo-50 text-indigo-600 transition">HOY</button>
                <button onClick={presetLast7d}    className="px-1.5 py-0.5 rounded text-[9px] font-black bg-white hover:bg-indigo-50 text-indigo-600 transition">7D</button>
                <button onClick={presetThisMonth} className="px-1.5 py-0.5 rounded text-[9px] font-black bg-white hover:bg-indigo-50 text-indigo-600 transition">MES</button>
                <button onClick={()=>{setDateFrom('');setDateTo('');}} className="px-1.5 py-0.5 rounded text-[9px] font-black bg-rose-50 text-rose-600 transition">✕</button>
              </div>
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"/>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Buscar prov, producto, ref..." className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 ring-indigo-500/20 transition"/>
            </div>
            <div className="flex flex-col items-end text-[10px] text-slate-500 font-bold px-2 border-l border-slate-200 pl-2">
              <span>{filteredForList.length} albaranes</span>
              <span className="text-xs text-slate-900 font-black tabular-nums">{Num.fmt(sumFiltered)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cuerpo */}
      <div className="flex flex-col gap-8">

        <section className="w-full">
          <AlbaranesList albaranes={filteredForList} searchQ={deferredSearch} selectedUnit={selectedUnit} businessUnits={BUSINESS_UNITS} onOpenEdit={setEditForm}/>
        </section>

        <div className="w-full flex flex-col items-center opacity-30 my-2">
          <div className="w-px h-8 bg-slate-300"/><div className="w-2 h-2 rounded-full bg-slate-300 my-1"/><div className="w-px h-8 bg-slate-300"/>
        </div>

        {/* Formulario / Inspector */}
        <section className="w-full max-w-2xl mx-auto flex flex-col pb-8">
          <div className="text-center mb-4">
            <h3 className="text-sm font-black text-slate-800 flex items-center justify-center gap-1.5"><Plus className="w-4 h-4 text-indigo-500"/> Registro Manual e IA</h3>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Añade albaranes sueltos o consulta precios</p>
          </div>

          <AnimatePresence mode="wait">
            {showInspector ? (
              <motion.div key="inspector" initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-10}}>
                <PriceInspector priceHistory={safeData.priceHistory||[]} albaranesLite={albaranesLiteRanged} proveedores={proveedoresHistoricos} suggestionsByProv={suggestionsByProv} defaultProv={inspectorDefaults.prov} defaultItem={inspectorDefaults.item}/>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-10}} className="bg-white p-4 rounded-xl shadow-md border border-slate-100 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500"/>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xs font-black text-slate-800 flex items-center gap-1.5"><ListPlus className="w-4 h-4 text-indigo-500"/> Nuevo Albarán</h3>
                  <div className="flex items-center gap-1.5">
                    <button onClick={toggleRecording} className={cn('p-1.5 rounded-lg transition', isRecording?'bg-rose-100 text-rose-600 animate-pulse':'bg-indigo-50 text-indigo-600 hover:bg-indigo-100')}>
                      {isRecording ? <Square className="w-3.5 h-3.5"/> : <Mic className="w-3.5 h-3.5"/>}
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf,image/*" onChange={e=>{if(e.target.files?.[0]){processLocalFile(e.target.files[0]);e.target.value='';}}}/>
                    <button onClick={()=>fileInputRef.current?.click()} className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition"><Camera className="w-3.5 h-3.5"/></button>
                  </div>
                </div>

                {/* Selector unidad negocio */}
                <div className={cn('mb-4 p-2 rounded-lg border transition-colors', form.unitId==='REST'?'bg-indigo-50/50 border-indigo-100':form.unitId==='DLV'?'bg-amber-50/50 border-amber-100':'bg-emerald-50/50 border-emerald-100')}>
                  <div className="grid grid-cols-2 gap-1.5">
                    {BUSINESS_UNITS.map(u=>(
                      <button type="button" key={u.id} onClick={()=>setForm({...form,unitId:u.id})} className={cn('p-1.5 rounded-lg border-2 transition-all flex items-center justify-center gap-1', form.unitId===u.id?`${u.color.replace('text-','border-')} ${u.bg} ${u.color}`:'border-slate-100 bg-white text-slate-400 grayscale hover:grayscale-0')}>
                        <u.icon className="w-3 h-3"/><span className="text-[9px] font-black uppercase">{u.name.split(' ')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <input value={form.prov} onChange={e=>setForm({...form,prov:e.target.value})} list="provs-hist" placeholder="Proveedor (Ej: Makro...)" className="w-full p-2.5 bg-slate-50 rounded-lg text-xs font-bold border border-slate-200 outline-none focus:border-indigo-500 focus:bg-white transition"/>
                  <datalist id="provs-hist">{proveedoresHistoricos.map(p=><option key={p} value={p}/>)}</datalist>
                  <div className="flex gap-1.5">
                    <input value={form.date} onChange={e=>setForm({...form,date:e.target.value})} type="date" className="flex-1 p-2.5 bg-slate-50 rounded-lg text-xs font-bold border border-slate-200 outline-none focus:border-indigo-500"/>
                    <input value={form.num}  onChange={e=>setForm({...form,num:e.target.value})}  placeholder="Nº Albarán" className="w-1/3 p-2.5 bg-slate-50 rounded-lg text-xs font-bold border border-slate-200 outline-none focus:border-indigo-500"/>
                  </div>
                </div>

                {/* Control IVA */}
                <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1"><Sparkles className="w-3 h-3 text-amber-500"/> Control IVA</span>
                    <select value={ivaMode} onChange={e=>setIvaMode(e.target.value as any)} className="bg-white border border-slate-200 rounded-md text-[10px] font-bold px-2 py-1 outline-none">
                      <option value="AUTO">🤖 Auto (recomienda)</option>
                      <option value="INC">✅ Con IVA incluido</option>
                      <option value="EXC">❌ Sin IVA (bases)</option>
                    </select>
                  </div>
                  <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-100">
                    <label className="text-[10px] font-black uppercase text-slate-400">Total de referencia (opcional)</label>
                    <input type="number" step="0.01" value={form.expectedTotal||''} onChange={e=>setForm({...form,expectedTotal:e.target.value?parseFloat(e.target.value):null})} placeholder="0.00" className="w-24 text-right bg-transparent text-xs font-black text-slate-700 outline-none"/>
                  </div>
                  {decidedMode && ivaMode==='AUTO' && form.expectedTotal && (
                    <p className="text-[9px] font-bold text-indigo-600 bg-indigo-50 p-1 rounded text-center">
                      IA detectó: {decidedMode==='INC'?'Precios con IVA incluido':'Bases sin IVA (añadirá IVA)'}
                    </p>
                  )}
                </div>

                {/* QuickAdd */}
                <div className="flex items-center gap-1 mb-3 bg-indigo-50/50 p-2 rounded-lg border border-indigo-100">
                  <input type="text" value={quickCalc.name} onChange={e=>setQuickCalc({...quickCalc,name:e.target.value})} placeholder="Añadir línea rápida..." className="flex-1 p-1.5 bg-white rounded-md text-xs font-bold outline-none"/>
                  <input type="number" value={quickCalc.total} onChange={e=>setQuickCalc({...quickCalc,total:e.target.value})} placeholder="€" className="w-16 p-1.5 bg-white rounded-md text-xs font-bold outline-none text-right"/>
                  <button type="button" onClick={handleQuickAdd} className="w-7 h-7 bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] rounded-md flex items-center justify-center hover:bg-[color:var(--arume-gray-700)] transition"><Plus className="w-3.5 h-3.5"/></button>
                </div>

                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Líneas del Documento</label>
                  {lastPurchaseFromProv && !form.text && (
                    <button type="button" onClick={handleLoadLastPurchase} className="text-[9px] font-black bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md flex items-center gap-1 hover:bg-indigo-100 transition">
                      <RefreshCw className="w-2.5 h-2.5"/> Repetir última
                    </button>
                  )}
                </div>
                <div className="relative">
                  <textarea value={form.text} onChange={e=>setForm({...form,text:e.target.value})} placeholder="Pega el texto del albarán aquí..." className="w-full h-32 bg-slate-50 rounded-lg p-3 pr-8 text-xs font-mono border border-slate-200 outline-none resize-none mb-3 shadow-inner focus:bg-white focus:border-indigo-400 transition leading-relaxed"/>
                  {form.text && <button type="button" onClick={()=>setForm({...form,text:''})} className="absolute top-3 right-3 text-slate-300 hover:text-rose-500 transition"><XCircle className="w-4 h-4"/></button>}
                </div>

                {(hasGifts||hasDiscounts) && (
                  <div className="flex gap-1.5 mb-2">
                    {hasGifts    && <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black px-2 py-0.5 rounded flex items-center gap-1"><Gift className="w-3 h-3"/> REGALO (0€)</span>}
                    {hasDiscounts && <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded flex items-center gap-1"><Percent className="w-3 h-3"/> DESCUENTO</span>}
                  </div>
                )}

                {/* Desglose IVA */}
                <div className="grid grid-cols-3 gap-1.5 text-[10px] text-slate-500 mb-3">
                  {[{label:'IVA 4%',base:liveTotals.split.base4,iva:liveTotals.split.iva4},{label:'IVA 10%',base:liveTotals.split.base10,iva:liveTotals.split.iva10},{label:'IVA 21%',base:liveTotals.split.base21,iva:liveTotals.split.iva21}].map(({label,base,iva})=>(
                    <div key={label} className="bg-slate-50 border border-slate-200 p-1.5 rounded-lg text-center">
                      <div className="font-black text-slate-700 text-[9px]">{label}</div>
                      <div>B:{Num.fmt(base)}</div><div>I:{Num.fmt(iva)}</div>
                    </div>
                  ))}
                </div>

                {/* Total */}
                <div className={cn('flex justify-between items-center p-3 rounded-lg text-white mb-4 transition-colors', !form.expectedTotal?'bg-slate-900':isTotalMatching?'bg-emerald-600':'bg-amber-600')}>
                  <div>
                    <span className="text-[10px] font-black uppercase text-white/70 tracking-widest">Total Calculado</span>
                    {roundingAdjustment!==0 && <span className="block text-[9px] text-white/80 font-bold bg-white/20 px-1 py-0.5 rounded mt-0.5">Ajuste:{roundingAdjustment>0?'+':''}{roundingAdjustment}€</span>}
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black tabular-nums">{Num.fmt(liveTotals.grandTotal)}</span>
                    {form.expectedTotal && !isTotalMatching && <p className="text-[9px] font-bold text-white/80">Ref:{Num.fmt(form.expectedTotal)} (Dif:{Num.fmt(Math.abs(liveTotals.grandTotal-form.expectedTotal))})</p>}
                  </div>
                </div>

                <button type="button" disabled={isSaving} onClick={handleSaveAlbaran} className="w-full bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] py-3 rounded-lg font-black text-xs shadow-md hover:bg-[color:var(--arume-gray-700)] transition active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50">
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>} GUARDAR ALBARÁN
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      {editForm && (
        <AlbaranEditModal editForm={editForm} sociosReales={sociosReales} setEditForm={setEditForm} onClose={()=>setEditForm(null)} onSave={handleSaveEdits} onDelete={handleDelete}/>
      )}
    </div>
  );
};
