import React, { useState, useMemo, useRef } from 'react';
import { 
  ChevronLeft, ChevronRight, CreditCard, Banknote, Truck, 
  Trash2, CheckCircle2, AlertTriangle, RefreshCw, Image as ImageIcon, 
  Building2, ShoppingBag, Layers, SplitSquareHorizontal, Mic, Square, Plus, Download, XCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'framer-motion';
import { AppData, Cierre } from '../types';
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

export const CashView = ({ data, onSave }: CashViewProps) => {
  // --- ESTADOS ---
  const [currentFilterDate, setCurrentFilterDate] = useState(new Date().toISOString().slice(0, 7));
  const [selectedUnit, setSelectedUnit] = useState<CashBusinessUnit | 'ALL'>('ALL'); 
  const [scanStatus, setScanStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [images, setImages] = useState<{ img1: string | null, img2: string | null }>({ img1: null, img2: null });
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [exportQuarter, setExportQuarter] = useState(1);
  const [exportYear, setExportYear] = useState(new Date().getFullYear());

  const [form, setForm] = useState({
    date: DateUtil.today(),
    efectivo: '', tpv1: '', tpv2: '', amex: '', glovo: '', uber: '', madisa: '', apperStreet: '',
    cajaFisica: '', tienda: '', notas: ''
  });

  const [fondoCaja, setFondoCaja] = useState<number>(300);
  const [gastosCaja, setGastosCaja] = useState<any[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // --- CÁLCULOS ---
  const totalTarjetas = useMemo(() => Num.parse(form.tpv1) + Num.parse(form.tpv2) + Num.parse(form.amex), [form.tpv1, form.tpv2, form.amex]);
  const appsBrutas = useMemo(() => Num.parse(form.glovo) + Num.parse(form.uber) + Num.parse(form.madisa) + Num.parse(form.apperStreet), [form.glovo, form.uber, form.madisa, form.apperStreet]);
  const totalCalculadoBruto = useMemo(() => Num.parse(form.efectivo) + totalTarjetas + appsBrutas, [form.efectivo, totalTarjetas, appsBrutas]);
  const totalRestauranteNeto = useMemo(() => totalCalculadoBruto - Num.parse(form.tienda), [totalCalculadoBruto, form.tienda]);

  const descuadreVivo = useMemo(() => {
    if (form.cajaFisica === '' || form.efectivo === '') return null;
    return Num.round2(Num.parse(form.cajaFisica) - (Num.parse(form.efectivo) + fondoCaja));
  }, [form.cajaFisica, form.efectivo, fondoCaja]);

  const kpis = useMemo(() => {
    const cierresMes = (data.cierres || []).filter(c => c.date.startsWith(currentFilterDate));
    const total = cierresMes.reduce((acc, c) => acc + (Num.parse(c.totalVenta) || 0), 0);
    return { total, cierresMes, tarj: cierresMes.reduce((a,c)=>a+Num.parse(c.tarjeta),0), efec: cierresMes.reduce((a,c)=>a+Num.parse(c.efectivo),0), apps: cierresMes.reduce((a,c)=>a+Num.parse(c.apps),0) };
  }, [data.cierres, currentFilterDate]);

  // --- FUNCIONES ---
  const handleSaveCierre = async () => {
    setIsSaving(true);
    const newData = { ...data };
    const cierreId = `ZR-${form.date.replace(/-/g, '')}`;
    
    const nuevoCierre: Cierre = {
      id: cierreId, date: form.date, totalVenta: totalRestauranteNeto,
      efectivo: Num.parse(form.efectivo), tarjeta: totalTarjetas, apps: appsBrutas,
      descuadre: descuadreVivo || 0, notas: form.notas, unitId: 'REST'
    };

    if (!newData.cierres) newData.cierres = [];
    const idx = newData.cierres.findIndex(c => c.id === cierreId);
    if (idx >= 0) newData.cierres[idx] = nuevoCierre; else newData.cierres.unshift(nuevoCierre);

    // Lógica de Tienda
    if (Num.parse(form.tienda) > 0) {
      const shopId = `ZS-${form.date.replace(/-/g, '')}`;
      newData.cierres.unshift({ id: shopId, date: form.date, totalVenta: Num.parse(form.tienda), efectivo: 0, tarjeta: 0, apps: 0, descuadre: 0, notas: 'Venta Tienda', unitId: 'SHOP' });
    }

    await onSave(newData);
    setIsSaving(false);
    alert("✅ Cierre guardado con éxito");
  };

  const handleExportGestoria = () => {
    const rows = (data.cierres || []).map(c => ({ 'FECHA': c.date, 'VENTA': c.totalVenta, 'EFECTIVO': c.efectivo, 'TARJETAS': c.tarjeta }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cierres");
    XLSX.writeFile(wb, `Cierres_Arume.xlsx`);
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* HEADER */}
      <header className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
        <h2 className="text-xl font-black text-slate-800">Caja Unificada</h2>
        <div className="flex gap-2">
           <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="p-2 bg-slate-100 rounded-xl font-bold text-sm outline-none"/>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100">
            <div className="flex justify-between items-center mb-6">
               <h3 className="font-black text-slate-700">Entrada Z</h3>
               <button onClick={() => setIsRecording(!isRecording)} className={cn("px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2", isRecording ? "bg-red-500 text-white" : "bg-slate-900 text-white")}>
                  <Mic className="w-3 h-3"/> {isRecording ? "DETENER" : "DICTAR IA"}
               </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="bg-emerald-50 p-4 rounded-2xl">
                  <label className="text-[9px] font-black text-emerald-600 block mb-1 uppercase">Efectivo Cajón</label>
                  <input type="number" value={form.efectivo} onChange={e => setForm({...form, efectivo: e.target.value})} className="w-full bg-transparent text-2xl font-black outline-none text-emerald-700"/>
               </div>
               <div className="bg-indigo-50 p-4 rounded-2xl">
                  <label className="text-[9px] font-black text-indigo-600 block mb-1 uppercase">Total Tarjetas (TPVs)</label>
                  <input type="number" value={totalTarjetas} readOnly className="w-full bg-transparent text-2xl font-black outline-none text-indigo-700"/>
               </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4">
               <input placeholder="TPV 1" value={form.tpv1} onChange={e=>setForm({...form, tpv1:e.target.value})} className="p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none"/>
               <input placeholder="TPV 2" value={form.tpv2} onChange={e=>setForm({...form, tpv2:e.target.value})} className="p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none"/>
               <input placeholder="AMEX" value={form.amex} onChange={e=>setForm({...form, amex:e.target.value})} className="p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none"/>
            </div>

            <div className="mt-6 p-4 bg-orange-50 rounded-2xl border border-orange-100">
               <label className="text-[9px] font-black text-orange-600 block mb-2 uppercase">Desvío Tienda Sake</label>
               <input type="number" value={form.tienda} onChange={e => setForm({...form, tienda: e.target.value})} className="w-full bg-transparent text-xl font-black outline-none text-orange-700" placeholder="0.00"/>
            </div>

            <div className="mt-6">
               <textarea value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl text-xs min-h-[100px] outline-none" placeholder="Notas de la jornada..."/>
            </div>

            <button onClick={handleSaveCierre} disabled={isSaving} className="w-full mt-6 py-5 bg-slate-900 text-white rounded-2xl font-black shadow-xl hover:bg-indigo-600 transition">
               {isSaving ? "GUARDANDO..." : `GUARDAR CIERRE (${totalRestauranteNeto.toFixed(2)}€)`}
            </button>
          </div>
        </div>

        <div className="space-y-6">
           <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white">
              <p className="text-[10px] font-bold opacity-50 uppercase tracking-widest">Facturación Mes</p>
              <p className="text-4xl font-black">{kpis.total.toLocaleString()}€</p>
           </div>
           
           <button onClick={() => setIsExportModalOpen(true)} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-black text-[10px] flex items-center justify-center gap-2">
              <Download className="w-4 h-4"/> EXPORTAR GESTORÍA
           </button>

           <CashHistoryList cierresMes={kpis.cierresMes} cashUnits={CASH_UNITS} onDelete={() => {}} />
        </div>
      </div>
      
      {/* Modal Exportación Simple */}
      <AnimatePresence>
        {isExportModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <div className="bg-white p-8 rounded-[2.5rem] w-full max-w-xs">
              <h3 className="font-black mb-4">Exportar Datos</h3>
              <button onClick={handleExportGestoria} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black">DESCARGAR EXCEL</button>
              <button onClick={() => setIsExportModalOpen(false)} className="w-full mt-2 text-xs font-bold text-slate-400">Cerrar</button>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
