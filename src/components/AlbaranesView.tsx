import React, { useState, useMemo, useEffect } from 'react';
import { 
  Truck, 
  Search, 
  Plus, 
  Camera, 
  Zap, 
  RefreshCw, 
  Download, 
  Trash2, 
  AlertTriangle,
  FileText,
  CheckCircle2,
  Clock,
  ExternalLink,
  MoreVertical,
  Filter,
  ArrowRight,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Albaran } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';

interface AlbaranesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

const REAL_PARTNERS = ['PAU', 'JERONI', 'AGNES', 'ONLY ONE', 'TIENDA DE SAKES'];

export const AlbaranesView = ({ data, onSave }: AlbaranesViewProps) => {
  const [activeFilter, setActiveFilter] = useState<'Todos' | 'Arume' | 'Socios'>('Todos');
  const [searchQ, setSearchQ] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Form State
  const [form, setForm] = useState({
    prov: '',
    date: new Date().toISOString().split('T')[0],
    num: '',
    socio: 'Arume',
    notes: '',
    text: '',
    paid: false,
    forceDup: false
  });

  // Modal State
  const [editingAlbaran, setEditingAlbaran] = useState<Albaran | null>(null);

  // --- HELPERS ---
  const norm = (s: string) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const parseSmartLine = (line: string) => {
    let clean = line.replace(/[€$]/g, '').replace(/,/g, '.').trim();
    if (!clean || clean.length < 5) return null;

    let rate = 10; 
    if (clean.match(/\b21\s?%/)) rate = 21;
    else if (clean.match(/\b4\s?%/)) rate = 4;
    
    const upper = clean.toUpperCase();
    if (upper.includes("ALCOHOL") || upper.includes("GINEBRA") || upper.includes("SERV")) rate = 21;
    if (upper.includes("PAN ") || upper.includes("HUEVO") || upper.includes("LECHE")) rate = 4;

    const numbers = [...clean.matchAll(/(\d+\.\d{2})/g)].map(m => parseFloat(m[1]));
    if (numbers.length === 0) return null;

    const totalLine = numbers[numbers.length - 1]; 
    
    let qty = 1;
    const qtyMatch = clean.match(/^(\d+(\.\d{1,3})?)\s*(kg|uds|x|\*)/i);
    if (qtyMatch) qty = parseFloat(qtyMatch[1]);

    let name = clean.replace(totalLine.toString(), '').replace(/\d+(\.\d{1,3})?\s*(kg|uds|x|\*)/i, '').replace(/\b(4|10|21)\s?%/, '').replace(/\.{2,}/g, '').trim();
    if (name.length < 2) name = "Varios Indefinido";

    const unitPrice = qty > 0 ? totalLine / qty : totalLine;
    const baseLine = totalLine / (1 + rate / 100);
    const taxLine = totalLine - baseLine;

    return { q: qty, n: name, t: totalLine, rate, base: baseLine, tax: taxLine, unit: unitPrice };
  };

  const analyzedItems = useMemo(() => {
    return form.text.split('\n').map(parseSmartLine).filter(Boolean);
  }, [form.text]);

  const liveTotals = useMemo(() => {
    const taxes: Record<number, { b: number; i: number }> = { 4: { b: 0, i: 0 }, 10: { b: 0, i: 0 }, 21: { b: 0, i: 0 } };
    let grandTotal = 0;

    analyzedItems.forEach(it => {
      if (it) {
        if (!taxes[it.rate]) taxes[it.rate] = { b: 0, i: 0 };
        taxes[it.rate].b += it.base;
        taxes[it.rate].i += it.tax;
        grandTotal += it.t;
      }
    });

    return { grandTotal, taxes };
  }, [analyzedItems]);

  // --- ACTIONS ---
  const handleN8NScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64Image = reader.result;
       const n8nWebhookURL = "https://n8n.permatunnelopen.org/webhook/albaranes-ai";
        const data = await proxyFetch(n8nWebhookURL, {
          method: 'POST',
          body: { image: base64Image, fileName: file.name }
        });
        
        setForm(prev => ({
          ...prev,
          prov: data.proveedor || prev.prov,
          date: data.fecha ? data.fecha.split('T')[0] : prev.date,
          text: data.lineasTexto || prev.text
        }));
      };
    } catch (err) {
      console.error(err);
      alert("Error de conexión con IA. Revisa que el túnel esté activo.");
    } finally {
      setIsAnalyzing(false);
      e.target.value = '';
    }
  };

  const handleSaveAlbaran = async () => {
    if (liveTotals.grandTotal <= 0 || !form.prov) {
      return alert("Faltan datos (Proveedor o Importe).");
    }

    const newData = { ...data };
    if (!newData.albaranes) newData.albaranes = [];

    // --- INTELIGENCIA DE AGRUPACIÓN ---
    // Buscamos si ya existe un albarán para este proveedor, fecha y socio hoy
    const existingIdx = newData.albaranes.findIndex(a => 
      !a.invoiced && // Solo agrupamos si no está facturado
      norm(a.prov) === norm(form.prov) && 
      a.date === form.date && 
      a.socio === form.socio
    );

    if (existingIdx !== -1 && !form.forceDup) {
      // Agrupamos en el existente
      const existing = newData.albaranes[existingIdx];
      
      // Evitamos duplicar exactamente el mismo producto si ya existe en este albarán
      const newItems = analyzedItems.filter(newItem => 
        !(existing.items || []).some((oldItem: any) => 
          norm(oldItem.n) === norm(newItem.n) && 
          Math.abs(oldItem.t - newItem.t) < 0.01
        )
      );

      if (newItems.length > 0) {
        existing.items = [...(existing.items || []), ...newItems];
        existing.total = (Num.parse(existing.total) || 0) + newItems.reduce((acc, it) => acc + it.t, 0);
        existing.base = (Num.parse(existing.base) || 0) + newItems.reduce((acc, it) => acc + it.base, 0);
        existing.taxes = (Num.parse(existing.taxes) || 0) + newItems.reduce((acc, it) => acc + (it.tax || 0), 0);
        existing.notes = existing.notes ? `${existing.notes} | ${form.notes}` : form.notes;
        existing.paid = existing.paid || form.paid;
      }
    } else {
      // Creamos uno nuevo
      const taxesArray = Object.values(liveTotals.taxes) as { b: number; i: number }[];
      const newAlbaran: Albaran = {
        id: Date.now().toString(),
        prov: form.prov,
        date: form.date,
        num: form.num || "S/N",
        socio: form.socio,
        notes: form.notes,
        items: analyzedItems,
        total: liveTotals.grandTotal,
        base: taxesArray.reduce((acc, t) => acc + t.b, 0),
        taxes: taxesArray.reduce((acc, t) => acc + t.i, 0),
        invoiced: false,
        paid: form.paid,
        status: 'ok',
        reconciled: false
      };
      newData.albaranes.push(newAlbaran);
    }

    await onSave(newData);

    setForm({
      prov: '',
      date: new Date().toISOString().split('T')[0],
      num: '',
      socio: 'Arume',
      notes: '',
      text: '',
      paid: false,
      forceDup: false
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar gasto permanentemente?")) return;
    const newData = { ...data };
    newData.albaranes = newData.albaranes.filter(a => a.id !== id);
    await onSave(newData);
    setEditingAlbaran(null);
  };

  // --- KPI CALCULATIONS ---
  const kpis = useMemo(() => {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const añoActual = hoy.getFullYear();
    const trimActual = Math.floor(mesActual / 3) + 1;

    let totalGlobal = 0, totalMes = 0, totalTrim = 0;

    (data.albaranes || []).forEach(a => {
      const val = Num.parse(a.total);
      totalGlobal += val;
      const d = new Date(a.date);
      if (d.getFullYear() === añoActual) {
        if (d.getMonth() === mesActual) totalMes += val;
        if ((Math.floor(d.getMonth() / 3) + 1) === trimActual) totalTrim += val;
      }
    });

    return { totalGlobal, totalMes, totalTrim };
  }, [data.albaranes]);

  const filteredAlbaranes = useMemo(() => {
    return (data.albaranes || []).filter(a => {
      const esSocio = a.socio && a.socio !== 'Arume';
      if (activeFilter === 'Arume' && esSocio) return false;
      if (activeFilter === 'Socios' && !esSocio) return false;
      
      const term = searchQ.toLowerCase();
      return (a.prov || '').toLowerCase().includes(term) || (a.num || '').toLowerCase().includes(term);
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.albaranes, activeFilter, searchQ]);

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tighter">Albaranes & Gastos</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Control Financiero v12.4</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap justify-center">
          <button 
            onClick={async () => {
              if (!confirm("¿Agrupar albaranes fragmentados? Esto unirá gastos del mismo día/proveedor.")) return;
              const newData = { ...data };
              const grouped: Record<string, Albaran> = {};
              
              (newData.albaranes || []).forEach(a => {
                const targetKey = Object.keys(grouped).find(k => 
                  !grouped[k].invoiced && 
                  norm(grouped[k].prov) === norm(a.prov) && 
                  grouped[k].date === a.date && 
                  norm(grouped[k].socio || 'Arume') === norm(a.socio || 'Arume')
                );
                
                if (targetKey && !a.invoiced) {
                  // Agrupamos
                  grouped[targetKey].items = [...(grouped[targetKey].items || []), ...(a.items || [])];
                  grouped[targetKey].total = (Num.parse(grouped[targetKey].total) || 0) + (Num.parse(a.total) || 0);
                  grouped[targetKey].base = (Num.parse(grouped[targetKey].base) || 0) + (Num.parse(a.base) || 0);
                  grouped[targetKey].taxes = (Num.parse(grouped[targetKey].taxes) || 0) + (Num.parse(a.taxes) || 0);
                  grouped[targetKey].notes = grouped[targetKey].notes ? `${grouped[targetKey].notes} | ${a.notes}` : a.notes;
                } else {
                  // No hay match o está facturado, lo añadimos como nuevo en el mapa
                  grouped[a.id] = { ...a };
                }
              });
              
              newData.albaranes = Object.values(grouped);
              await onSave(newData);
              alert("¡Albaranes agrupados con éxito!");
            }}
            className="bg-rose-50 text-rose-500 px-4 py-3 rounded-2xl text-[10px] font-black hover:bg-rose-100 transition shadow-sm flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" /> AGRUPAR
          </button>
          <label className="bg-gradient-to-r from-emerald-400 to-teal-500 text-white px-5 py-3 rounded-2xl text-[10px] font-black hover:shadow-lg hover:scale-105 transition cursor-pointer shadow-md flex items-center gap-2">
            <Zap className="w-4 h-4" />
            <span>IA (n8n)</span>
            <input type="file" onChange={handleN8NScan} className="hidden" accept="image/*, application/pdf" />
          </label>
          <button className="bg-slate-800 text-white px-5 py-3 rounded-2xl text-[10px] font-black shadow-md transition flex items-center gap-2">
            <Download className="w-4 h-4" />
            <span>CSV</span>
          </button>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white px-6 py-5 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col justify-center items-start">
          <span className="text-[10px] font-black text-slate-400 uppercase mb-1">Gasto Histórico Total</span>
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
        {/* Form Column */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border-2 border-indigo-50 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500"></div>
            
            {isAnalyzing && (
              <div className="absolute inset-0 bg-white/95 z-20 flex flex-col items-center justify-center text-center p-4 backdrop-blur-sm">
                <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin mb-3" />
                <p className="text-xs font-black text-indigo-600 animate-pulse uppercase tracking-widest">Analizando Factura...</p>
              </div>
            )}

            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-500" /> Nueva Compra
            </h3>

            <div className="space-y-3 mb-4">
              <input 
                value={form.prov}
                onChange={(e) => setForm({ ...form, prov: e.target.value })}
                type="text" 
                placeholder="Proveedor (ej: Makro)" 
                className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
              <div className="flex gap-2">
                <input 
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  type="date" 
                  className="flex-1 p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none"
                />
                <input 
                  value={form.num}
                  onChange={(e) => setForm({ ...form, num: e.target.value })}
                  type="text" 
                  placeholder="Ref." 
                  className="w-1/3 p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none"
                />
              </div>
              <select 
                value={form.socio}
                onChange={(e) => setForm({ ...form, socio: e.target.value })}
                className="w-full p-3 bg-slate-50 rounded-xl text-xs font-bold border-0 outline-none bg-indigo-50 text-indigo-800"
              >
                <option value="Arume">🏢 Gasto: Restaurante (Arume)</option>
                {REAL_PARTNERS.map(s => <option key={s} value={s}>👤 Gasto Socio: {s}</option>)}
              </select>
              <input 
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                type="text" 
                placeholder="Notas (opcional)..." 
                className="w-full p-3 bg-slate-50 rounded-xl text-xs border-0 outline-none"
              />
            </div>

            <textarea 
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              placeholder="Escribe aquí o escanea con IA...&#10;Ej:&#10;5 kg Salmón 150.00&#10;10 Cajas Cerveza 80.50" 
              className="w-full h-32 bg-slate-50 rounded-2xl p-4 text-xs font-mono border-0 outline-none resize-none mb-3 shadow-inner focus:bg-white transition"
            />
            
            <div className="mt-3 space-y-1 max-h-52 overflow-y-auto custom-scrollbar px-1 bg-slate-50/50 rounded-xl p-2 min-h-[50px]">
              {analyzedItems.length > 0 ? analyzedItems.map((it, idx) => (
                <div key={idx} className="flex flex-col border-b border-slate-200 py-2 last:border-0">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="truncate pr-2 font-bold text-slate-700"><b>{it?.q}x</b> {it?.n}</span>
                    <span className="font-black text-slate-900 whitespace-nowrap">{Num.fmt(it?.t || 0)}</span>
                  </div>
                </div>
              )) : (
                <p className="text-[10px] text-slate-300 text-center italic py-2">Escribe líneas para ver desglose...</p>
              )}
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
                <input 
                  type="checkbox" 
                  id="inPaid" 
                  checked={form.paid}
                  onChange={(e) => setForm({ ...form, paid: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 cursor-pointer" 
                />
                <label htmlFor="inPaid" className="text-xs font-bold text-slate-600 cursor-pointer">Pagado</label>
              </div>
            </div>

            <button 
              onClick={handleSaveAlbaran}
              className="w-full mt-4 bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-indigo-700 transition active:scale-95"
            >
              GUARDAR ALBARÁN
            </button>
          </div>
        </div>

        {/* List Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-2 rounded-full shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center px-4 gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                type="text" 
                placeholder="Buscar proveedor..." 
                className="bg-transparent text-sm font-bold outline-none w-full text-slate-600 pl-6" 
              />
            </div>
            <div className="flex gap-1">
              {(['Todos', 'Arume', 'Socios'] as const).map(f => (
                <button 
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[9px] font-black uppercase transition-all",
                    activeFilter === f ? "bg-slate-900 text-white shadow-md" : "bg-slate-100 text-slate-400 hover:bg-white"
                  )}
                >
                  {f === 'Arume' ? 'Rest.' : f}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 pb-20">
            {filteredAlbaranes.length > 0 ? filteredAlbaranes.map(a => (
              <div 
                key={a.id}
                onClick={() => setEditingAlbaran(a)}
                className={cn(
                  "bg-white p-5 rounded-3xl border border-slate-100 flex justify-between items-center shadow-sm hover:bg-slate-50 transition cursor-pointer",
                  a.reconciled && "ring-2 ring-emerald-400/50"
                )}
              >
                <div>
                  <h4 className="font-black text-slate-800 flex items-center gap-2">
                    {a.prov}
                    {a.socio && a.socio !== 'Arume' && (
                      <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-black">
                        {a.socio}
                      </span>
                    )}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[10px] text-slate-400 font-bold">{a.date}</p>
                    {a.notes && <span className="text-[9px] text-indigo-400 bg-indigo-50 px-1.5 rounded font-bold">📝 Nota</span>}
                    {a.reconciled && <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 rounded font-black">🔗 Conciliado</span>}
                    {a.invoiced && <span className="text-[9px] text-blue-600 bg-blue-50 px-1.5 rounded font-black">📄 Facturado</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-black text-slate-900 text-lg">{Num.fmt(a.total)}</p>
                  <span className={cn(
                    "text-[8px] font-black uppercase",
                    a.paid ? 'text-emerald-500' : 'text-rose-500'
                  )}>
                    {a.paid ? 'Pagado' : 'Pendiente'}
                  </span>
                </div>
              </div>
            )) : (
              <div className="py-20 text-center opacity-50">
                <Truck className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-slate-500 font-bold text-sm">Sin registros.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingAlbaran && (
          <div className="fixed inset-0 z-[200] flex justify-center items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingAlbaran(null)}
              className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl relative z-10 flex flex-col max-h-[90vh]"
            >
              <button onClick={() => setEditingAlbaran(null)} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500 text-2xl transition">✕</button>
              
              <div className="border-b border-slate-100 pb-4 mb-6">
                <h3 className="text-2xl font-black text-slate-800 tracking-tighter">Detalle del Gasto</h3>
                <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1">Ref: {editingAlbaran.num}</p>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Proveedor</p>
                    <p className="text-sm font-black text-slate-800">{editingAlbaran.prov}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Fecha</p>
                    <p className="text-sm font-black text-slate-800">{editingAlbaran.date}</p>
                  </div>
                </div>

                <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
                  <p className="text-[9px] font-black text-indigo-400 uppercase mb-1">Asignado a</p>
                  <p className="text-sm font-black text-indigo-900">{editingAlbaran.socio === 'Arume' ? '🏢 Restaurante (Arume)' : `👤 Socio: ${editingAlbaran.socio}`}</p>
                </div>

                {editingAlbaran.notes && (
                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                    <p className="text-[9px] font-black text-amber-600 uppercase mb-1">Notas</p>
                    <p className="text-xs font-bold text-amber-900">{editingAlbaran.notes}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-[9px] font-black text-slate-400 uppercase ml-2">Desglose de productos</p>
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2">
                    {editingAlbaran.items?.map((it, i) => (
                      <div key={i} className="flex justify-between items-center text-xs border-b border-slate-200 last:border-0 pb-2 last:pb-0 pt-2 first:pt-0">
                        <span className="font-bold text-slate-700"><b>{it.q}x</b> {it.n}</span>
                        <span className="font-black text-slate-900">{Num.fmt(it.t)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between items-center bg-slate-900 p-6 rounded-[2rem] text-white shadow-xl">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase">Total Importe</p>
                    <p className="text-3xl font-black text-emerald-400">{Num.fmt(editingAlbaran.total)}</p>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-black uppercase inline-block",
                      editingAlbaran.paid ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                    )}>
                      {editingAlbaran.paid ? 'Pagado' : 'Pendiente'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => handleDelete(editingAlbaran.id)}
                  className="flex-1 bg-rose-50 text-rose-500 py-4 rounded-2xl font-black text-xs hover:bg-rose-100 transition flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> ELIMINAR
                </button>
                <button 
                  onClick={() => setEditingAlbaran(null)}
                  className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-black text-xs hover:bg-slate-200 transition"
                >
                  CERRAR
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
