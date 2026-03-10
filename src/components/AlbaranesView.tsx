import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, Plus, Download, Camera, AlertTriangle,
  Clock, Building2, ShoppingBag, 
  Users, Hotel, Layers, Mic, XCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { AppData, Albaran } from '../types';
import { Num, ArumeEngine, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { NotificationService } from '../services/notifications'; 
import { GoogleGenAI } from "@google/genai";

// IMPORTAMOS LOS NUEVOS COMPONENTES
import { AlbaranesList } from '../components/AlbaranesList';
import { AlbaranEditModal } from '../components/AlbaranEditModal';

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
type LineaIA = { qty: number; name: string; unit: string; unit_price: number; tax_rate: 4 | 10 | 21; total: number; };
type AlbaranIA = { proveedor: string; fecha: string; num: string; unidad?: 'REST' | 'SHOP' | 'DLV' | 'CORP'; lineas: LineaIA[]; sum_base?: number; sum_tax?: number; sum_total?: number; };

const TOL = 0.01;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const asNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const normalizeDate = (s?: string) => {
  const v = String(s ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : DateUtil.today();
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

  return {
    ...ai, lineas: lines, sum_base, sum_tax, sum_total: sum_total_calc,
  };
}

/* =======================================================
 * COMPONENTE PADRE
 * ======================================================= */
export const AlbaranesView = ({ data, onSave }: AlbaranesViewProps) => {
  const safeData = data || { albaranes: [], socios: [] };
  const albaranesSeguros = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  const sociosReales = Array.isArray(safeData.socios) ? safeData.socios.filter(s => s?.active) : [];

  const [searchQ, setSearchQ] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL'); 
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [priceAlerts, setPriceAlerts] = useState<{n: string, old: number, new: number}[]>([]);
  
  const [recordingMode, setRecordingMode] = useState<'new' | 'edit' | null>(null);
  const [liveTranscript, setLiveTranscript] = useState(''); 

  const [form, setForm] = useState({
    prov: '', date: DateUtil.today(), num: '', socio: 'Arume', notes: '', text: '',
    paid: false, forceDup: false, unitId: 'REST' as BusinessUnit 
  });
  
  const [quickCalc, setQuickCalc] = useState({ name: '', total: '', iva: 10 });

  // ESTADOS DEL MODAL
  const [editForm, setEditForm] = useState<Albaran | null>(null);

  // IA y Lector Dummy para que no de error la UI (Mantén aquí tu lógica completa si la necesitas)
  const handleDirectScan = () => alert("Sube tu archivo");
  const startVoiceRecording = () => alert("Inicia voz");

  const parseSmartLine = (line: string) => {
    let clean = line.replace(/[€$]/g, '').replace(/,/g, '.').trim();
    if (clean.length < 5) return null;
    let rate = 10; 
    if (clean.match(/\b21\s?%/)) rate = 21; else if (clean.match(/\b4\s?%/)) rate = 4;
    const numbers = [...clean.matchAll(/(\d+([.,]\d{1,3})?)/g)].map(m => parseFloat(m[1].replace(',','.')));
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
      if (it) { taxes[it.rate as 4|10|21].b += it.base; taxes[it.rate as 4|10|21].i += it.tax; grandTotal += it.t; }
    });
    return { grandTotal, taxes };
  }, [analyzedItems]);

  const handleQuickAdd = () => {
    const t = Num.parse(quickCalc.total);
    if (t > 0 && quickCalc.name) {
      const calc = ArumeEngine.calcularImpuestos(t, quickCalc.iva as any);
      const newLine = `1x ${quickCalc.name} ${quickCalc.iva}% ${calc.total.toFixed(2)}`;
      setForm(prev => ({ ...prev, text: prev.text ? `${prev.text}\n${newLine}` : newLine }));
      setQuickCalc({ name: '', total: '', iva: 10 });
    }
  };

  const handleSaveAlbaran = async () => {
    if (!form.prov) return alert("Por favor, introduce el nombre del proveedor.");
    const newData = { ...safeData, albaranes: [...albaranesSeguros] };
    const taxesArray = Object.values(liveTotals.taxes) as { b: number; i: number }[];
    const newAlbaran: Albaran = {
      id: `man-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      prov: form.prov, date: form.date, num: form.num || "S/N", socio: form.socio, notes: form.notes,
      items: analyzedItems.map(item => item!), total: Num.round2(liveTotals.grandTotal),
      base: Num.round2(taxesArray.reduce((acc, t) => acc + t.b, 0)), taxes: Num.round2(taxesArray.reduce((acc, t) => acc + t.i, 0)),
      invoiced: false, paid: form.paid, status: 'ok', reconciled: false, unitId: form.unitId 
    };
    newData.albaranes.push(newAlbaran);
    await onSave(newData);
    setForm({ prov: '', date: DateUtil.today(), num: '', socio: 'Arume', notes: '', text: '', paid: false, forceDup: false, unitId: 'REST' });
    alert("¡Albarán guardado!");
  };

  const handleExportList = () => {
    alert("Exportar Excel");
  };

  // FUNCIONES PARA EL MODAL DE EDICIÓN
  const openEditModal = (albaran: Albaran) => { 
    setEditForm(JSON.parse(JSON.stringify(albaran))); 
  };

  const handleSaveEdits = async () => {
    if (!editForm) return;
    const newData = { ...safeData, albaranes: [...albaranesSeguros] };
    const index = newData.albaranes.findIndex(a => a.id === editForm.id);
    if (index !== -1) {
      const al: AlbaranIA = {
        proveedor: editForm.prov, fecha: editForm.date, num: editForm.num || 'S/N', unidad: editForm.unitId,
        lineas: (editForm.items || []).map(it => ({ qty: it.q, name: it.n, unit: 'ud', unit_price: it.unitPrice || 0, tax_rate: (it.rate as 4|10|21) || 10, total: it.t }))
      };
      const rec = reconcileAlbaran(al);
      newData.albaranes[index] = {
        ...editForm,
        socio: editForm.socio || "Arume",
        unitId: editForm.unitId || "REST",
        items: rec.lineas.map(l => ({ q: l.qty, n: l.name, t: l.total, rate: l.tax_rate, base: l.base, tax: l.tax, unitPrice: l.unit_price })),
        total: rec.sum_total, base: rec.sum_base, taxes: rec.sum_tax
      };
      await onSave(newData);
      setEditForm(null);
      alert("✅ Albarán actualizado y recalculado con éxito.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar gasto permanentemente?")) return;
    const newData = { ...safeData, albaranes: albaranesSeguros.filter(a => a.id !== id) };
    await onSave(newData);
    setEditForm(null);
  };

  // KPIs
  const kpis = useMemo(() => {
    let totalGlobal = 0, totalMes = 0, totalTrim = 0;
    return { totalGlobal, totalMes, totalTrim };
  }, [albaranesSeguros, selectedUnit]);

  return (
    <div className="space-y-6 pb-24">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tighter">Compras & Gastos</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Arquitectura Holded Pro</p>
        </div>
      </header>

      {/* Selector de Unidad de Negocio */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-1">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSelectedUnit('ALL')} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === 'ALL' ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}><Layers className="w-3 h-3" /> Ver Todos</button>
          {BUSINESS_UNITS.map(unit => (
            <button key={unit.id} onClick={() => setSelectedUnit(unit.id)} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === unit.id ? `${unit.color.replace('text-', 'bg-')} text-white border-transparent shadow-md` : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}><unit.icon className="w-3 h-3" /> {unit.name}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Formulario Lateral (Nuevo Albarán) */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border-2 border-indigo-50 relative overflow-hidden">
            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center justify-between"><span className="flex items-center gap-2"><Plus className="w-4 h-4 text-indigo-500" /> Nueva Factura</span></h3>

            <div className={cn("mb-4 p-3 rounded-2xl border transition-colors", form.unitId === 'REST' ? "bg-indigo-50/50 border-indigo-100" : form.unitId === 'DLV' ? "bg-amber-50/50 border-amber-100" : "bg-emerald-50/50 border-emerald-100")}>
              <div className="grid grid-cols-2 gap-2">
                {BUSINESS_UNITS.map(unit => (
                  <button key={unit.id} onClick={() => setForm({ ...form, unitId: unit.id })} className={cn("p-2 rounded-xl border-2 transition-all flex items-center gap-1", form.unitId === unit.id ? `${unit.color.replace('text-', 'border-')} ${unit.bg} ${unit.color} shadow-sm` : "border-slate-100 bg-white text-slate-400 grayscale hover:grayscale-0")}><unit.icon className="w-3 h-3" /><span className="text-[9px] font-black uppercase">{unit.name}</span></button>
                ))}
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <input value={form.prov} onChange={(e) => setForm({ ...form, prov: e.target.value })} type="text" placeholder="Proveedor" className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none focus:ring-2 focus:ring-indigo-500 transition" />
              <div className="flex gap-2">
                <input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} type="date" className="flex-1 p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none" />
                <input value={form.num} onChange={(e) => setForm({ ...form, num: e.target.value })} type="text" placeholder="Ref." className="w-1/3 p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none" />
              </div>
            </div>

            <div className="flex items-center gap-1 mb-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
              <input type="text" value={quickCalc.name} onChange={(e) => setQuickCalc({ ...quickCalc, name: e.target.value })} placeholder="Producto..." className="w-1/2 p-2 bg-white rounded-lg text-xs font-bold outline-none" />
              <input type="number" value={quickCalc.total} onChange={(e) => setQuickCalc({ ...quickCalc, total: e.target.value })} placeholder="Total €" className="w-1/4 p-2 bg-white rounded-lg text-xs font-bold outline-none text-right" />
              <button onClick={handleQuickAdd} className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center hover:bg-indigo-200 transition"><Plus className="w-4 h-4" /></button>
            </div>

            <div className="relative group">
              <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Ej: 5 kg Salmón 150.00" className="w-full h-32 bg-slate-50 rounded-2xl p-4 pr-10 text-xs font-mono border-0 outline-none resize-none mb-3 shadow-inner focus:bg-white transition" />
              {form.text && (
                <button onClick={() => setForm({...form, text: ''})} className="absolute top-4 right-4 text-slate-300 hover:text-rose-500 transition">
                  <XCircle className="w-5 h-5" />
                </button>
              )}
            </div>

            <button onClick={handleSaveAlbaran} className="w-full mt-2 bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-indigo-700 transition active:scale-95">GUARDAR COMPRA</button>
          </div>
        </div>

        {/* Lista Central (IMPORTAMOS EL NUEVO COMPONENTE) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-2 rounded-full shadow-sm border border-slate-100 flex items-center px-4">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} type="text" placeholder="Buscar por proveedor o ref..." className="bg-transparent text-sm font-bold outline-none w-full text-slate-600 pl-3" />
          </div>

          <AlbaranesList 
            albaranes={albaranesSeguros} 
            searchQ={searchQ} 
            selectedUnit={selectedUnit} 
            businessUnits={BUSINESS_UNITS} 
            onOpenEdit={openEditModal} 
          />
        </div>
      </div>

      {/* MODAL DE EDICIÓN (IMPORTAMOS EL NUEVO COMPONENTE) */}
      {editForm && (
        <AlbaranEditModal 
          editForm={editForm} 
          sociosReales={sociosReales}
          setEditForm={setEditForm} 
          onClose={() => setEditForm(null)} 
          onSave={handleSaveEdits} 
          onDelete={handleDelete}
          recordingMode={recordingMode}
          startVoiceRecording={startVoiceRecording}
        />
      )}

    </div>
  );
};
