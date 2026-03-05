import React, { useState, useMemo } from 'react';
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  CreditCard, 
  Banknote, 
  Truck, 
  Sparkles, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Clock,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { motion } from 'motion/react';
import { AppData, Cierre, Factura } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { NotificationService } from '../services/notifications';

interface CashViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const CashView = ({ data, onSave }: CashViewProps) => {
  const [currentFilterDate, setCurrentFilterDate] = useState(new Date().toISOString().slice(0, 7));
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  // Form State
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    efectivo: '',
    tarjeta: '',
    glovo: '',
    uber: '',
    madisa: '',
    deliveroo: '',
    cajaFisica: '',
    notas: '',
    chkGastoCaja: false
  });

  const kpis = useMemo(() => {
    const cierresMes = (data.cierres || []).filter(c => c.date && c.date.startsWith(currentFilterDate));
    const total = cierresMes.reduce((acc, c) => acc + (Num.parse(c.totalVenta) || 0), 0);
    const dias = cierresMes.length;
    const media = dias > 0 ? total / dias : 0;
    const efec = cierresMes.reduce((acc, c) => acc + (Num.parse(c.efectivo) || 0), 0);
    const tarj = cierresMes.reduce((acc, c) => acc + (Num.parse(c.tarjeta) || 0), 0);
    const apps = cierresMes.reduce((acc, c) => acc + (Num.parse(c.apps) || 0), 0);
    return { total, media, dias, efec, tarj, apps, cierresMes };
  }, [data.cierres, currentFilterDate]);

  const totalCalculado = useMemo(() => {
    return Num.parse(form.efectivo) + 
           Num.parse(form.tarjeta) + 
           Num.parse(form.glovo) + 
           Num.parse(form.uber) + 
           Num.parse(form.madisa) + 
           Num.parse(form.deliveroo);
  }, [form]);

  const handleMonthChange = (offset: number) => {
    let [y, m] = currentFilterDate.split('-').map(Number);
    m += offset;
    if (m === 0) { m = 12; y--; }
    if (m === 13) { m = 1; y++; }
    setCurrentFilterDate(`${y}-${String(m).padStart(2, '0')}`);
  };

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanStatus('loading');
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const webhookUrl = "https://ia.permatunnelopen.org/webhook/cajas-ai-validator";
        const ia = await proxyFetch(webhookUrl, {
          method: "POST",
          body: { image_caja: reader.result }
        });

        setForm(prev => ({
          ...prev,
          efectivo: ia.ticket_efectivo?.toString() || "",
          tarjeta: ia.ticket_tarjeta?.toString() || "",
          glovo: ia.glovo?.toString() || "",
          uber: ia.uber?.toString() || "",
          madisa: ia.madisa?.toString() || "",
          deliveroo: ia.deliveroo?.toString() || "",
          cajaFisica: ia.sobre_cash ? (parseFloat(ia.sobre_cash) + 300).toFixed(2) : "",
          notas: ia.gastos > 0 ? `Gastos deducidos por IA: ${ia.gastos}€. Revisa albaranes.` : prev.notas,
          chkGastoCaja: ia.gastos > 0 ? true : prev.chkGastoCaja
        }));

        setScanStatus('success');
        setTimeout(() => setScanStatus('idle'), 3000);
      } catch (error) {
        console.error("Error OCR:", error);
        setScanStatus('error');
        alert("⚠️ No se pudo procesar la imagen. Verifica que el túnel de Cloudflare y n8n estén activos.");
        setTimeout(() => setScanStatus('idle'), 3000);
      }
    };
  };

  const handleSaveCierre = async () => {
    if (totalCalculado <= 0) return alert("Introduce algún importe.");

    const newData = { ...data };
    const fechaSeleccionada = form.date;

    if (form.chkGastoCaja) {
      const concepto = prompt("¿Qué has pagado? (ej: Hielo):");
      const importe = prompt("¿Cuánto has pagado (€)?:");
      if (concepto && importe) {
        newData.albaranes.push({
          id: 'cash-' + Date.now(),
          date: fechaSeleccionada,
          prov: concepto,
          num: "CAJA",
          total: parseFloat(importe),
          items: [],
          invoiced: true
        });
      }
    }

    const totalVentaVal = totalCalculado;
    const tarjetaVal = Num.parse(form.tarjeta);

    const cierreData: Cierre = {
      id: Date.now().toString(),
      date: fechaSeleccionada,
      totalVenta: totalVentaVal,
      efectivo: Num.parse(form.efectivo),
      tarjeta: tarjetaVal,
      apps: (Num.parse(form.glovo) + Num.parse(form.uber) + Num.parse(form.madisa) + Num.parse(form.deliveroo)),
      descuadre: (Num.parse(form.cajaFisica) - (Num.parse(form.efectivo) + 300)),
      notas: form.notas
    };

    const idx = newData.cierres.findIndex(c => c.date === fechaSeleccionada);
    if (idx >= 0) newData.cierres[idx] = cierreData;
    else newData.cierres.unshift(cierreData);

    // Notificar descuadre si es significativo (> 5€)
    if (Math.abs(cierreData.descuadre) > 5) {
      await NotificationService.notifyCajaDescuadre(newData, fechaSeleccionada, cierreData.descuadre);
    }

    // Factura Z
    const zNum = `Z-${fechaSeleccionada.replace(/-/g, '')}`;
    const fIdx = newData.facturas.findIndex(f => f.num === zNum);

    const fZ: Factura = {
      id: fIdx >= 0 ? newData.facturas[fIdx].id : `z-${Date.now()}`,
      num: zNum,
      date: fechaSeleccionada,
      prov: "Z DIARIO",
      cliente: "Z DIARIO",
      total: totalVentaVal,
      base: Number((totalVentaVal / 1.10).toFixed(2)),
      tax: Number((totalVentaVal - (totalVentaVal / 1.10)).toFixed(2)),
      paid: fIdx >= 0 && newData.facturas[fIdx].reconciled ? true : false,
      reconciled: fIdx >= 0 && newData.facturas[fIdx].reconciled ? true : false
    };

    if (fIdx >= 0) newData.facturas[fIdx] = fZ;
    else newData.facturas.push(fZ);

    await onSave(newData);
    
    // Reset form partially
    setForm(prev => ({
        ...prev,
        efectivo: '',
        tarjeta: '',
        glovo: '',
        uber: '',
        madisa: '',
        deliveroo: '',
        cajaFisica: '',
        notas: '',
        chkGastoCaja: false
    }));
  };

  const handleDeleteCierre = async (id: string) => {
    if (!confirm("¿Borrar cierre?")) return;
    const newData = { ...data };
    const c = newData.cierres.find(x => x.id === id);
    if (c) {
      const zNum = `Z-${c.date.replace(/-/g, '')}`;
      newData.facturas = newData.facturas.filter(f => f.num !== zNum);
      newData.cierres = newData.cierres.filter(x => x.id !== id);
      await onSave(newData);
    }
  };

  const [year, month] = currentFilterDate.split('-');
  const nombreMes = new Date(Number(year), Number(month) - 1).toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">Control de Caja</h2>
          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Vista Mensual</p>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
          <button onClick={() => handleMonthChange(-1)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl text-slate-600 shadow-sm hover:bg-indigo-50 transition font-bold text-lg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <input 
            type="month" 
            value={currentFilterDate} 
            onChange={(e) => setCurrentFilterDate(e.target.value)}
            className="bg-transparent border-0 text-sm font-black text-slate-700 uppercase outline-none text-center w-36 cursor-pointer"
          />
          <button onClick={() => handleMonthChange(1)} className="w-10 h-10 flex items-center justify-center bg-white rounded-xl text-slate-600 shadow-sm hover:bg-indigo-50 transition font-bold text-lg">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Facturación {nombreMes}</p>
          <p className="text-4xl font-black mt-2">{kpis.total.toLocaleString('es-ES', {minimumFractionDigits: 0})}€</p>
          <p className="text-[10px] text-emerald-400 mt-1 font-bold">Media diaria: {kpis.media.toFixed(0)}€ ({kpis.dias} días)</p>
        </div>

        <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
            <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> Tarjeta</span> 
            <span>{kpis.tarj.toLocaleString()}€</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-indigo-500" style={{ width: `${kpis.total > 0 ? (kpis.tarj/kpis.total)*100 : 0}%` }}></div>
          </div>
          <div className="flex justify-between text-[10px] font-bold text-slate-600 mb-1">
            <span className="flex items-center gap-1"><Banknote className="w-3 h-3" /> Efectivo</span> 
            <span>{kpis.efec.toLocaleString()}€</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${kpis.total > 0 ? (kpis.efec/kpis.total)*100 : 0}%` }}></div>
          </div>
        </div>

        <div className="bg-orange-50 p-6 rounded-[2.5rem] border border-orange-100 shadow-sm">
          <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">Delivery</p>
          <p className="text-3xl font-black text-orange-600 mt-2">{kpis.apps.toLocaleString()}€</p>
        </div>
      </div>

      {/* List */}
      <div className="space-y-4 mt-4">
        <div className="flex justify-between items-center px-6">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Cierres de {nombreMes}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {kpis.cierresMes.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(c => {
            const zNum = `Z-${c.date.replace(/-/g,'')}`;
            const fZ = data.facturas.find(f => f.num === zNum);
            const isConciliado = fZ && fZ.reconciled;

            return (
              <div key={c.id} className={cn(
                "bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm flex justify-between items-center group relative hover:shadow-md transition",
                isConciliado ? 'ring-2 ring-emerald-400' : 'ring-2 ring-rose-100'
              )}>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest bg-indigo-50 px-2 py-1 rounded-lg w-fit">{c.date}</p>
                    {isConciliado ? (
                      <span className="text-[8px] bg-emerald-100 text-emerald-700 font-black px-2 py-1 rounded flex items-center gap-1">
                        <CheckCircle2 className="w-2 h-2" /> BANCO OK
                      </span>
                    ) : (
                      <span className="text-[8px] bg-rose-50 text-rose-500 font-black px-2 py-1 rounded flex items-center gap-1">
                        <Clock className="w-2 h-2" /> FALTA BANCO
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500 font-bold">
                    <span>💵 {Num.parse(c.efectivo).toFixed(2)}€</span>
                    <span>💳 {Num.parse(c.tarjeta).toFixed(2)}€</span>
                  </div>
                  {c.notas && <p className="text-[9px] text-slate-400 italic mt-1 border-l-2 border-slate-200 pl-2">"{c.notas}"</p>}
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-slate-800">{Num.parse(c.totalVenta).toFixed(2)}€</p>
                  <button 
                    onClick={() => handleDeleteCierre(c.id)} 
                    className="text-[8px] text-rose-300 font-bold uppercase hover:text-rose-500 opacity-0 group-hover:opacity-100 transition mt-1 flex items-center gap-1 ml-auto"
                  >
                    <Trash2 className="w-2 h-2" /> Borrar
                  </button>
                </div>
              </div>
            );
          })}
          {kpis.cierresMes.length === 0 && (
            <div className="col-span-full text-center py-10 text-slate-300 italic text-sm">No hay cierres este mes.</div>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-100 relative overflow-hidden mt-8">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-emerald-400"></div>
        
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black text-slate-800">Nuevo Cierre Z</h3>
          <label className={cn(
            "bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black hover:scale-105 transition cursor-pointer shadow-lg flex items-center gap-2",
            scanStatus === 'loading' && "opacity-50 pointer-events-none"
          )}>
            {scanStatus === 'loading' ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : scanStatus === 'success' ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : scanStatus === 'error' ? (
              <AlertTriangle className="w-3 h-3" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            <span>{scanStatus === 'loading' ? 'ANALIZANDO...' : scanStatus === 'success' ? '¡LISTO!' : scanStatus === 'error' ? 'ERROR' : 'IA SCAN TICKET'}</span>
            <input type="file" onChange={handleScan} className="hidden" accept="image/*" capture="environment" />
          </label>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Fecha y Caja</h4>
            <input 
              type="date" 
              value={form.date} 
              onChange={(e) => setForm({...form, date: e.target.value})}
              className="w-full p-3 bg-slate-50 rounded-xl text-sm font-bold border-0 outline-none"
            />
            <input 
              type="number" 
              placeholder="Efectivo Z" 
              value={form.efectivo}
              onChange={(e) => setForm({...form, efectivo: e.target.value})}
              className="w-full p-4 bg-slate-50 rounded-2xl text-lg font-black outline-none"
            />
          </div>
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2. Bancos y Apps</h4>
            <input 
              type="number" 
              placeholder="Tarjeta TPV" 
              value={form.tarjeta}
              onChange={(e) => setForm({...form, tarjeta: e.target.value})}
              className="w-full p-4 bg-slate-50 rounded-2xl text-lg font-black outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <input 
                type="number" 
                placeholder="Glovo" 
                value={form.glovo}
                onChange={(e) => setForm({...form, glovo: e.target.value})}
                className="p-3 bg-orange-50/50 rounded-xl font-bold text-sm outline-none"
              />
              <input 
                type="number" 
                placeholder="Uber" 
                value={form.uber}
                onChange={(e) => setForm({...form, uber: e.target.value})}
                className="p-3 bg-indigo-50/50 rounded-xl font-bold text-sm outline-none"
              />
              <input 
                type="number" 
                placeholder="Madisa" 
                value={form.madisa}
                onChange={(e) => setForm({...form, madisa: e.target.value})}
                className="p-3 bg-rose-50/50 rounded-xl font-bold text-sm outline-none"
              />
              <input 
                type="number" 
                placeholder="Deliveroo" 
                value={form.deliveroo}
                onChange={(e) => setForm({...form, deliveroo: e.target.value})}
                className="p-3 bg-teal-50/50 rounded-xl font-bold text-sm outline-none"
              />
            </div>
          </div>
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">3. Arqueo y Notas</h4>
            <input 
              type="number" 
              placeholder="Dinero Real Caja" 
              value={form.cajaFisica}
              onChange={(e) => setForm({...form, cajaFisica: e.target.value})}
              className="w-full p-4 bg-slate-900 rounded-2xl text-2xl font-black text-emerald-400 outline-none"
            />
            <input 
              type="text" 
              placeholder="Notas..." 
              value={form.notas}
              onChange={(e) => setForm({...form, notas: e.target.value})}
              className="w-full p-3 bg-slate-50 rounded-xl text-xs font-bold outline-none"
            />
            <div className="text-right">
              <span className="text-3xl font-black text-indigo-600 tracking-tighter">{totalCalculado.toFixed(2)}€</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-6">
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 rounded-2xl border border-amber-100 mb-2">
            <input 
              type="checkbox" 
              id="chkGastoCaja" 
              checked={form.chkGastoCaja}
              onChange={(e) => setForm({...form, chkGastoCaja: e.target.checked})}
              className="w-5 h-5 accent-amber-500 cursor-pointer"
            />
            <label htmlFor="chkGastoCaja" className="text-[10px] font-black text-amber-700 uppercase cursor-pointer">¿Pagos con efectivo?</label>
          </div>
          <button 
            onClick={handleSaveCierre}
            className="w-full py-5 bg-slate-900 text-white rounded-[2rem] font-black text-sm shadow-2xl hover:bg-indigo-600 transition-all active:scale-95"
          >
            REGISTRAR CIERRE Z
          </button>
        </div>
      </div>
    </div>
  );
};
