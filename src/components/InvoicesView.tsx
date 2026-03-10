import React, { useState, useMemo } from 'react';
import { 
  Search, Plus, Building2, ShoppingBag, 
  Users, Hotel, Layers, XCircle 
} from 'lucide-react';
import { AppData, Albaran } from '../types'; // Asumimos que usa la misma base que albaranes
import { Num, DateUtil, ArumeEngine } from '../services/engine';
import { cn } from '../lib/utils';

// IMPORTAMOS LOS COMPONENTES NECESARIOS
import { AlbaranesList } from '../components/AlbaranesList';
import { AlbaranEditModal } from '../components/AlbaranEditModal';

interface InvoicesViewProps {
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

// --- FUNCIONES DE APOYO (RECONCILIACIÓN) ---
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function reconcileInvoice(ai: any) {
  const lines = ai.lineas.map((l: any) => {
    const rate = (l.tax_rate ?? 10);
    const total = round2(Number(l.total) || 0);
    const base = round2(total / (1 + rate / 100));
    const tax = round2(total - base);
    return { ...l, tax_rate: rate, total, base, tax };
  });

  return {
    ...ai,
    lineas: lines,
    sum_base: round2(lines.reduce((a: any, l: any) => a + l.base, 0)),
    sum_tax: round2(lines.reduce((a: any, l: any) => a + l.tax, 0)),
    sum_total: round2(lines.reduce((a: any, l: any) => a + l.total, 0)),
  };
}

/* =======================================================
 * 📄 COMPONENTE PRINCIPAL: InvoicesView
 * ======================================================= */
export const InvoicesView = ({ data, onSave }: InvoicesViewProps) => {
  const safeData = data || { albaranes: [], socios: [] };
  const albaranesSeguros = Array.isArray(safeData.albaranes) ? safeData.albaranes : [];
  
  const fallbackSocios = [{ id: "s1", n: "PAU" }, { id: "s2", n: "JERONI" }];
  const sociosReales = (Array.isArray(safeData.socios) && safeData.socios.length > 0) ? safeData.socios.filter(s => s?.active) : fallbackSocios;

  const [searchQ, setSearchQ] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<BusinessUnit | 'ALL'>('ALL'); 
  const [editForm, setEditForm] = useState<Albaran | null>(null);

  const [form, setForm] = useState({
    prov: '', date: DateUtil.today(), num: '', socio: 'Arume', notes: '', text: '',
    paid: false, unitId: 'REST' as BusinessUnit 
  });

  // Lógica de procesamiento de texto (Smart Lines)
  const parseSmartLine = (line: string) => {
    let clean = line.replace(/[€$]/g, '').replace(/,/g, '.').trim();
    if (clean.length < 5) return null;
    let rate = 10; 
    if (clean.match(/\b21\s?%/)) rate = 21; else if (clean.match(/\b4\s?%/)) rate = 4;
    const numbers = [...clean.matchAll(/(\d+([.,]\d{1,3})?)/g)].map(m => parseFloat(m[1].replace(',','.')));
    if (numbers.length === 0) return null;
    const totalLine = numbers[numbers.length - 1]; 
    const baseLine = totalLine / (1 + rate / 100);
    return { q: 1, n: "Línea Factura", t: totalLine, rate, base: baseLine, tax: totalLine - baseLine, unit: totalLine };
  };

  const analyzedItems = useMemo(() => form.text.split('\n').map(parseSmartLine).filter(Boolean), [form.text]);

  const handleSaveInvoice = async () => {
    if (!form.prov) return alert("Introduce proveedor");
    const total = analyzedItems.reduce((acc, it) => acc + (it?.t || 0), 0);
    
    const newInvoice: Albaran = {
      id: `inv-${Date.now()}`,
      prov: form.prov, date: form.date, num: form.num || "S/N", socio: form.socio,
      items: analyzedItems.map(it => it!), total: Num.round2(total),
      base: 0, taxes: 0, invoiced: true, paid: form.paid, status: 'ok', unitId: form.unitId 
    };

    const newData = { ...safeData, albaranes: [...albaranesSeguros, newInvoice] };
    await onSave(newData);
    setForm({ prov: '', date: DateUtil.today(), num: '', socio: 'Arume', notes: '', text: '', paid: false, unitId: 'REST' });
    alert("Factura guardada");
  };

  return (
    <div className="space-y-6 pb-24">
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
        <h2 className="text-xl font-black text-slate-800 tracking-tighter">Gestión de Facturas</h2>
        <p className="text-[10px] text-indigo-500 font-bold uppercase">Módulo de Facturación</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          {/* Formulario simplificado para Invoices */}
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border-2 border-indigo-50">
             <h3 className="text-sm font-black mb-4">Nueva Factura</h3>
             <input value={form.prov} onChange={e => setForm({...form, prov: e.target.value})} placeholder="Proveedor" className="w-full p-3 bg-slate-50 rounded-xl mb-2 text-sm font-bold outline-none"/>
             <textarea value={form.text} onChange={e => setForm({...form, text: e.target.value})} placeholder="Líneas de factura..." className="w-full h-32 bg-slate-50 rounded-2xl p-4 text-xs font-mono outline-none mb-4" />
             <button onClick={handleSaveInvoice} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black">GUARDAR FACTURA</button>
          </div>
        </div>

        <div className="lg:col-span-2">
           <AlbaranesList 
            albaranes={albaranesSeguros} 
            searchQ={searchQ} 
            selectedUnit={selectedUnit} 
            businessUnits={BUSINESS_UNITS} 
            onOpenEdit={(alb) => setEditForm(alb)} 
          />
        </div>
      </div>
    </div>
  );
};
