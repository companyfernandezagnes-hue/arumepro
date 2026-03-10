import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, Plus, Download, Camera, AlertTriangle, Check,
  Clock, Building2, ShoppingBag, ListPlus,
  Users, Hotel, Layers, Mic, XCircle
} from 'lucide-react';
import { AppData, Albaran } from '../types';
import { Num, ArumeEngine, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
// 🚀 Si tienes el NotificationService o Gemini listos para implementar, 
// puedes importarlos de nuevo. Aquí preparamos la estructura limpia.

// IMPORTAMOS LOS NUEVOS COMPONENTES
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
 * 🧠 HOOK: MOTOR CONTABLE DE ALBARANES (Lógica aislada)
 * Maneja el parseo de texto, cálculo de IVA y normalización.
 * ======================================================= */
function useAlbaranEngine(text: string) {
  // 🚀 Memoizamos el parseo para que no se ejecute si el texto no cambia (Punto #1.1 de Auditoría)
  const analyzedItems = useMemo(() => {
    if (!text) return [];
    
    return text.split('\n').map(line => {
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
      const baseLine = Num.round2(totalLine / (1 + rate / 100));
      const taxLine = Num.round2(totalLine - baseLine);
      
      return { q: qty, n: name, t: totalLine, rate, base: baseLine, tax: taxLine, unitPrice };
    }).filter(Boolean);
  }, [text]);

  const liveTotals = useMemo(() => {
    let grandTotal = 0;
    let b4 = 0, i4 = 0, b10 = 0, i10 = 0, b21 = 0, i21 = 0;
    
    analyzedItems.forEach(it => {
      if (!it) return;
      grandTotal += it.t;
      if (it.rate === 4) { b4 += it.base; i4 += it.tax; }
      else if (it.rate === 21) { b21 += it.base; i21 += it.tax; }
      else { b10 += it.base; i10 += it.tax; }
    });
    
    const baseFinal = Num.round2(b4 + b10 + b21);
    const taxFinal = Num.round2(i4 + i10 + i21);
    
    return { grandTotal: Num.round2(grandTotal), baseFinal, taxFinal };
  }, [analyzedItems]);

  return { analyzedItems, liveTotals };
}


/* =======================================================
 * 🏦 COMPONENTE PADRE
 * ======================================================= */
export const AlbaranesView = ({ data, onSave }: AlbaranesViewProps) => {
  const safeData = data || { albaranes: [], socios: [] };
  const albaranesSeguros = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  
  // 🛡️ Socios Seguros
  const fallbackSocios = [{ id: "s1", n: "PAU" }, { id: "s2", n: "JERONI" }, { id: "s3", n: "AGNES" }, { id: "s4", n: "ONLY ONE" }, { id: "s5", n: "TIENDA DE SAKES" }];
  const sociosReales = (Array.isArray(safeData.socios) && safeData.socios.length > 0) ? safeData.socios.filter(s => s?.active) : fallbackSocios;

  // 🧠 MEMORIA INTELIGENTE DE PROVEEDORES (Para autocompletado y evitar duplicados lógicos)
  const proveedoresHistoricos = useMemo(() => {
    const provs = albaranesSeguros.map(a => a.prov).filter(Boolean);
    return Array.from(new Set(provs)).sort(); // Devuelve lista única y ordenada
  }, [albaranesSeguros]);

  // ESTADOS DE UI
  const [searchQ, setSearchQ] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL'); 
  const [recordingMode, setRecordingMode] = useState<'new' | 'edit' | null>(null);
  
  // ESTADOS DE FORMULARIO
  const [form, setForm] = useState({
    prov: '', date: DateUtil.today(), num: '', socio: 'Arume', notes: '', text: '',
    paid: false, unitId: 'REST' as BusinessUnit 
  });
  const [quickCalc, setQuickCalc] = useState({ name: '', total: '', iva: 10 });
  const [editForm, setEditForm] = useState<Albaran | null>(null);

  // 🚀 CONECTAMOS EL MOTOR CONTABLE AL FORMULARIO PRINCIPAL
  const { analyzedItems, liveTotals } = useAlbaranEngine(form.text);

  // 💡 AUTOCOMPLETAR PROVEEDOR
  const handleProvSelect = (nombreProv: string) => {
    setForm(prev => ({ ...prev, prov: nombreProv }));
  };

  const handleQuickAdd = () => {
    const t = Num.parse(quickCalc.total);
    if (t > 0 && quickCalc.name) {
      const calc = ArumeEngine.calcularImpuestos(t, quickCalc.iva as any);
      const newLine = `1x ${quickCalc.name} ${quickCalc.iva}% ${calc.total.toFixed(2)}`;
      setForm(prev => ({ ...prev, text: prev.text ? `${prev.text}\n${newLine}` : newLine }));
      setQuickCalc({ name: '', total: '', iva: 10 });
    }
  };

  // 💾 GUARDADO DEL NUEVO ALBARÁN (Crea un ID único e inmutable)
  const handleSaveAlbaran = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!form.prov) return alert("⚠️ Por favor, introduce el nombre del proveedor.");
    if (analyzedItems.length === 0) return alert("⚠️ Debes añadir al menos una línea de producto.");

    const newData = { ...safeData, albaranes: [...albaranesSeguros] };
    
    // Generación de ID robusto: alb-[fecha]-[timestamp corto]-[unidad]
    const robustId = `alb-${form.date.replace(/-/g,'')}-${Date.now().toString().slice(-6)}-${form.unitId}`;

    const newAlbaran: Albaran = {
      id: robustId,
      prov: form.prov.trim().toUpperCase(), // Normalizamos para la memoria
      date: form.date, 
      num: form.num || "S/N", 
      socio: form.socio, 
      notes: form.notes,
      items: analyzedItems.map(item => item!), 
      total: liveTotals.grandTotal,
      base: liveTotals.baseFinal, 
      taxes: liveTotals.taxFinal,
      invoiced: false, 
      paid: form.paid, 
      status: 'ok', 
      reconciled: false, 
      unitId: form.unitId 
    };

    newData.albaranes.unshift(newAlbaran); // Añadimos al principio
    await onSave(newData);
    
    // Reset del formulario (mantenemos fecha para meter varios del mismo día)
    setForm(prev => ({ ...prev, prov: '', num: '', text: '', paid: false }));
  };

  // 🛡️ GUARDADO DEL MODAL DE EDICIÓN
  const handleSaveEdits = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    try {
      if (!editForm) return;
      const newData = JSON.parse(JSON.stringify(safeData)); // Copia profunda segura
      if (!newData.albaranes) newData.albaranes = [];
      
      const index = newData.albaranes.findIndex((a: Albaran) => a.id === editForm.id);
      if (index === -1) {
        alert("⚠️ Error crítico: No se encontró el albarán en la base de datos.");
        return;
      }

      // Aseguramos que los tipos internos sean correctos (por si editForm trae algo raro)
      const sanitizedAlbaran = {
        ...editForm,
        prov: editForm.prov?.trim().toUpperCase() || "DESCONOCIDO",
        socio: editForm.socio || "Arume",
        unitId: editForm.unitId || "REST",
        // Los totales ya vienen recalculados por el Modal, pero nos aseguramos que son números
        total: Num.parse(editForm.total),
        base: Num.parse(editForm.base),
        taxes: Num.parse(editForm.taxes)
      };

      newData.albaranes[index] = sanitizedAlbaran;
      await onSave(newData);
      setEditForm(null); 
    } catch (error) {
      alert("⚠️ Hubo un error al guardar la edición.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar este albarán permanentemente?")) return;
    const newData = { ...safeData, albaranes: albaranesSeguros.filter(a => a.id !== id) };
    await onSave(newData);
    setEditForm(null);
  };

  return (
    <div className="space-y-6 pb-24">
      {/* 🚀 HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tighter">Entrada Rápida Albaranes</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1">Con Inteligencia de Memoria</p>
        </div>
      </header>

      {/* 🏷️ FILTRO DE UNIDAD */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-1">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSelectedUnit('ALL')} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === 'ALL' ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}><Layers className="w-3 h-3" /> Ver Todos</button>
          {BUSINESS_UNITS.map(unit => (
            <button key={unit.id} onClick={() => setSelectedUnit(unit.id)} className={cn("px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all border flex items-center gap-1.5", selectedUnit === unit.id ? `${unit.color.replace('text-', 'bg-')} text-white border-transparent shadow-md` : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50")}><unit.icon className="w-3 h-3" /> {unit.name}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 📝 FORMULARIO LATERAL (NUEVO ALBARÁN) */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-slate-100 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500" />
            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2"><ListPlus className="w-4 h-4 text-indigo-500" /> Ingreso Manual</h3>

            <div className={cn("mb-4 p-3 rounded-2xl border transition-colors", form.unitId === 'REST' ? "bg-indigo-50/50 border-indigo-100" : form.unitId === 'DLV' ? "bg-amber-50/50 border-amber-100" : "bg-emerald-50/50 border-emerald-100")}>
              <div className="grid grid-cols-2 gap-2">
                {BUSINESS_UNITS.map(unit => (
                  <button type="button" key={unit.id} onClick={() => setForm({ ...form, unitId: unit.id })} className={cn("p-2 rounded-xl border-2 transition-all flex items-center gap-1", form.unitId === unit.id ? `${unit.color.replace('text-', 'border-')} ${unit.bg} ${unit.color} shadow-sm` : "border-slate-100 bg-white text-slate-400 grayscale hover:grayscale-0")}><unit.icon className="w-3 h-3" /><span className="text-[9px] font-black uppercase">{unit.name}</span></button>
                ))}
              </div>
            </div>

            <div className="space-y-3 mb-4 relative">
              {/* Sugerencias de Proveedores (Memoria) */}
              <input value={form.prov} onChange={(e) => setForm({ ...form, prov: e.target.value })} type="text" placeholder="Proveedor (Ej: Makro, Pescados...)" list="proveedores-historicos" className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold border border-slate-200 outline-none focus:border-indigo-500 transition" />
              <datalist id="proveedores-historicos">
                {proveedoresHistoricos.map(p => <option key={p} value={p} />)}
              </datalist>
              
              <div className="flex gap-2">
                <input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} type="date" className="flex-1 p-3 bg-slate-50 rounded-xl text-sm font-bold border border-slate-200 outline-none focus:border-indigo-500" />
                <input value={form.num} onChange={(e) => setForm({ ...form, num: e.target.value })} type="text" placeholder="Nº Albarán" className="w-1/3 p-3 bg-slate-50 rounded-xl text-sm font-bold border border-slate-200 outline-none focus:border-indigo-500" />
              </div>
            </div>

            {/* Smart Input (Calculadora Rápida) */}
            <div className="flex items-center gap-1 mb-2 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100">
              <input type="text" value={quickCalc.name} onChange={(e) => setQuickCalc({ ...quickCalc, name: e.target.value })} placeholder="Producto rápido..." className="w-1/2 p-2 bg-white rounded-lg text-xs font-bold outline-none" />
              <input type="number" value={quickCalc.total} onChange={(e) => setQuickCalc({ ...quickCalc, total: e.target.value })} placeholder="Total €" className="w-1/4 p-2 bg-white rounded-lg text-xs font-bold outline-none text-right" />
              <button type="button" onClick={handleQuickAdd} className="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center hover:bg-indigo-700 transition shadow-sm"><Plus className="w-4 h-4" /></button>
            </div>

            <div className="relative group">
              <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="O pega el texto del albarán aquí...\nEj: 5 kg Salmón 150.00" className="w-full h-32 bg-slate-50 rounded-2xl p-4 pr-10 text-xs font-mono border border-slate-200 outline-none resize-none mb-3 shadow-inner focus:bg-white focus:border-indigo-400 transition" />
              {form.text && (
                <button type="button" onClick={() => setForm({...form, text: ''})} className="absolute top-4 right-4 text-slate-300 hover:text-rose-500 transition">
                  <XCircle className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="flex justify-between items-center bg-slate-900 p-4 rounded-2xl text-white mb-4">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total Calculado</span>
              <span className="text-2xl font-black text-emerald-400">{Num.fmt(liveTotals.grandTotal)}</span>
            </div>

            <button type="button" onClick={handleSaveAlbaran} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition active:scale-95 flex items-center justify-center gap-2">
              <Check className="w-4 h-4" /> GUARDAR EN SISTEMA
            </button>
          </div>
        </div>

        {/* 📚 LISTA CENTRAL (Componente Aislado) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 flex items-center px-4 focus-within:ring-2 ring-indigo-500/20 transition-all">
            <Search className="w-5 h-5 text-slate-300 shrink-0" />
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} type="text" placeholder="Buscar por proveedor, ref o producto..." className="bg-transparent text-sm font-bold outline-none w-full text-slate-700 pl-3 py-2" />
          </div>

          <AlbaranesList 
            albaranes={albaranesSeguros} 
            searchQ={searchQ} 
            selectedUnit={selectedUnit} 
            businessUnits={BUSINESS_UNITS} 
            onOpenEdit={setEditForm} 
          />
        </div>
      </div>

      {/* 🚀 MODAL DE EDICIÓN */}
      {editForm && (
        <AlbaranEditModal 
          editForm={editForm} 
          sociosReales={sociosReales}
          setEditForm={setEditForm} 
          onClose={() => setEditForm(null)} 
          onSave={handleSaveEdits} 
          onDelete={handleDelete}
          recordingMode={recordingMode}
          startVoiceRecording={() => alert("Módulo VOSK de voz en desarrollo")} // Dejamos el conector listo
        />
      )}
    </div>
  );
};
