import React, { useState, useMemo, useEffect } from 'react';
import { 
  FileText, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Zap, 
  Users, 
  Building2, 
  Package, 
  Wallet, 
  CheckCircle2, 
  Clock, 
  Trash2, 
  AlertCircle,
  Link as LinkIcon,
  Mail,
  ArrowRight,
  X,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Factura, Albaran } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { NotificationService } from '../services/notifications';
import { Bell } from 'lucide-react';

interface InvoicesViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

const REAL_PARTNERS = ['PAU', 'JERONI', 'AGNES', 'ONLY ONE', 'TIENDA DE SAKES'];

export const InvoicesView = ({ data, onSave }: InvoicesViewProps) => {
  const [activeTab, setActiveTab] = useState<'pend' | 'hist'>('pend');
  const [mode, setMode] = useState<'proveedor' | 'socio'>('proveedor');
  const [year, setYear] = useState(new Date().getFullYear());
  const [searchQ, setSearchQ] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid' | 'reconciled'>('all');
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Modal State
  const [selectedGroup, setSelectedGroup] = useState<{ label: string; ids: string[] } | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Factura | null>(null);
  const [modalForm, setModalForm] = useState({ num: '', date: new Date().toISOString().split('T')[0], selectedAlbs: [] as string[] });

  const norm = (s: string) => s ? s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : '';

  // --- IA AUDIT ENGINE ---
  const draftsIA = useMemo(() => {
    return (data.facturas || []).filter(f => f.status === 'draft').map(draft => {
      const mesDraft = draft.date.substring(0, 7);
      const provDraft = norm(draft.prov);
      
      const albaranesCandidatos = (data.albaranes || []).filter(a => 
        !a.invoiced && 
        norm(a.prov) === provDraft && 
        a.date.startsWith(mesDraft)
      );

      const sumaAlbaranes = albaranesCandidatos.reduce((acc, a) => acc + (Num.parse(a.total) || 0), 0);
      const diferencia = Math.abs(sumaAlbaranes - Math.abs(draft.total));
      const cuadraPerfecto = diferencia < 0.05 && albaranesCandidatos.length > 0;

      return {
        ...draft,
        candidatos: albaranesCandidatos,
        sumaAlbaranes,
        diferencia,
        cuadraPerfecto
      };
    });
  }, [data.facturas, data.albaranes]);

  const handleSyncIA = async () => {
    setIsSyncing(true);
    try {
      const webhookN8N = "https://ia.permatunnelopen.org/webhook/forzar-facturas";
      await proxyFetch(webhookN8N, { method: "POST" });
    } catch (err) {
      alert("Error conectando con la IA. ¿Está el túnel activo?");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConfirmAuditoriaIA = async (draftId: string) => {
    const newData = { ...data };
    const draftIdx = newData.facturas.findIndex(f => f.id === draftId);
    const audit = draftsIA.find(d => d.id === draftId);
    
    if (draftIdx === -1 || !audit) return;

    if (audit.candidatos.length > 0) {
      const idsVincular = audit.candidatos.map(a => a.id);
      newData.albaranes = newData.albaranes.map(a => 
        idsVincular.includes(a.id) ? { ...a, invoiced: true } : a
      );
      newData.facturas[draftIdx].albaranIdsArr = idsVincular;
      newData.facturas[draftIdx].albaranIds = idsVincular.join(',');
    }

    newData.facturas[draftIdx].status = 'approved';
    newData.facturas[draftIdx].source = 'email-ia';
    await onSave(newData);
  };

  const handleDiscardDraftIA = async (id: string) => {
    if (!confirm("¿Eliminar factura leída por IA?")) return;
    const newData = { ...data };
    newData.facturas = newData.facturas.filter(f => f.id !== id);
    await onSave(newData);
  };

  // --- MANUAL GROUPING ---
  const pendingGroups = useMemo(() => {
    const albs = (data.albaranes || []).filter(a => {
      if (a.invoiced || !a.date.startsWith(year.toString())) return false;
      const owner = norm(mode === 'proveedor' ? a.prov : a.socio || 'Arume');
      if (searchQ && !owner.includes(norm(searchQ)) && !norm(a.num || '').includes(norm(searchQ))) return false;
      return true;
    });

    const byMonth: Record<string, { name: string; groups: Record<string, any> }> = {};
    
    albs.forEach(a => {
      const mk = a.date.substring(0, 7);
      if (!byMonth[mk]) {
        const [y, m] = mk.split('-');
        const names = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
        byMonth[mk] = { name: `${names[parseInt(m)]} ${y}`, groups: {} };
      }

      const rawOwner = (mode === 'proveedor') ? (a.prov || 'Sin Proveedor') : (a.socio || 'PENDIENTE');
      const ownerKey = String(rawOwner).trim().toUpperCase();
      
      // En modo socio, si no es uno de los reales y no es PENDIENTE, lo ignoramos o lo agrupamos
      if (mode === 'socio' && ownerKey !== 'PENDIENTE' && !REAL_PARTNERS.includes(ownerKey)) {
        return;
      }

      if (!byMonth[mk].groups[ownerKey]) {
        byMonth[mk].groups[ownerKey] = { label: rawOwner, t: 0, ids: [], count: 0 };
      }
      
      byMonth[mk].groups[ownerKey].t += (Num.parse(a.total) || 0);
      byMonth[mk].groups[ownerKey].count += 1;
      byMonth[mk].groups[ownerKey].ids.push(a.id);
    });

    return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
  }, [data.albaranes, year, mode, searchQ]);

  const handleOpenGroup = (label: string, ids: string[]) => {
    setSelectedGroup({ label, ids });
    setModalForm({
      num: '',
      date: new Date().toISOString().split('T')[0],
      selectedAlbs: [...ids]
    });
  };

  const handleConfirmManualInvoice = async () => {
    if (!modalForm.num.trim()) return alert("Por favor, introduce el número de factura oficial.");
    if (modalForm.selectedAlbs.length === 0) return alert("Debes seleccionar al menos un albarán.");

    const newData = { ...data };
    const ownerLabel = selectedGroup?.label || '';

    const existe = newData.facturas.some(f => 
      f.status !== 'draft' && 
      norm(f.num || '') === norm(modalForm.num) && 
      norm(f.prov || f.cliente || '') === norm(ownerLabel)
    );
    if (existe) return alert(`⚠️ Ya existe una factura con el número "${modalForm.num}" para este proveedor.`);

    let totalFactura = 0;
    newData.albaranes = newData.albaranes.map(a => {
      if (modalForm.selectedAlbs.includes(a.id)) {
        totalFactura += Num.parse(a.total);
        return { ...a, invoiced: true };
      }
      return a;
    });

    newData.facturas.push({
      id: 'fac-' + Date.now() + Math.random().toString(36).slice(2,5),
      num: modalForm.num,
      date: modalForm.date,
      prov: mode === 'proveedor' ? ownerLabel : 'Varios',
      cliente: mode === 'socio' ? ownerLabel : 'Arume',
      total: Math.abs(Math.round(totalFactura * 100) / 100),
      albaranIdsArr: modalForm.selectedAlbs,
      paid: false,
      reconciled: false,
      source: 'manual-group',
      status: 'approved' 
    });

    await onSave(newData);
    setSelectedGroup(null);
  };

  // --- HISTORY ---
  const historyList = useMemo(() => {
    return (data.facturas || []).filter(f => {
      if (f.status === 'draft') return false;
      if (!f.date.startsWith(year.toString())) return false;
      
      const clienteNorm = norm(f.cliente || '');
      const provNorm = norm(f.prov || '');

      // Filter by mode
      if (mode === 'proveedor') {
        // En modo proveedor, ignoramos las que son claramente de socios
        if (REAL_PARTNERS.includes(clienteNorm.toUpperCase())) return false;
        if (f.cliente && f.cliente !== 'Arume' && f.cliente !== 'Z DIARIO') return false;
      } else {
        // En modo socio, solo mostramos las que pertenecen a un socio real
        const isSocio = REAL_PARTNERS.includes(clienteNorm.toUpperCase()) || REAL_PARTNERS.includes(provNorm.toUpperCase());
        if (!isSocio) return false;
      }

      if (filterStatus === 'pending' && f.paid) return false;
      if (filterStatus === 'paid' && !f.paid) return false;
      if (filterStatus === 'reconciled' && !f.reconciled) return false;

      if (searchQ) {
        const owner = norm(f.prov || f.cliente || '');
        if (!owner.includes(norm(searchQ)) && !norm(f.num || '').includes(norm(searchQ))) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.facturas, year, filterStatus, searchQ]);

  const handleTogglePago = async (id: string) => {
    const newData = { ...data };
    const idx = newData.facturas.findIndex(f => f.id === id);
    if (idx !== -1) {
      newData.facturas[idx].paid = !newData.facturas[idx].paid;
      await onSave(newData);
    }
  };

  const handleDeleteFactura = async (id: string) => {
    const fac = data.facturas.find(f => f.id === id);
    if (!fac) return;
    if (fac.reconciled) return alert("⚠️ No puedes borrar una factura que ya ha pasado por el Banco.");
    if (!confirm(`¿Borrar la factura ${fac.num} y liberar sus albaranes?`)) return;

    const newData = { ...data };
    const ids = fac.albaranIdsArr || [];
    newData.albaranes = newData.albaranes.map(a => ids.includes(a.id) ? { ...a, invoiced: false } : a);
    newData.facturas = newData.facturas.filter(f => f.id !== id);
    await onSave(newData);
  };

  const notifyOverdue = async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const overdue = (data.facturas || []).filter(f => 
      !f.paid && 
      f.dueDate && 
      f.dueDate < todayStr && 
      f.status !== 'draft'
    );

    if (overdue.length > 0) {
      const msg = `🔔 *FACTURAS VENCIDAS*\n\nHay ${overdue.length} facturas pendientes de pago pasadas de fecha:\n` +
        overdue.slice(0, 5).map(f => `- ${f.prov}: ${Num.fmt(f.total)} (Venció: ${f.dueDate})`).join('\n') +
        (overdue.length > 5 ? `\n...y ${overdue.length - 5} más.` : '');
      
      await NotificationService.sendAlert(data, msg, 'WARNING');
      alert("Alerta de vencimientos enviada a Telegram.");
    } else {
      alert("No hay facturas vencidas hoy.");
    }
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      {/* IA Audit Section */}
      <AnimatePresence>
        {draftsIA.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-slate-900 p-6 rounded-[2.5rem] shadow-2xl border border-slate-800 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-500"></div>
            <h3 className="text-white text-lg font-black flex items-center gap-2 mb-4">
              <Mail className="w-5 h-5 text-purple-400 animate-bounce" /> 
              Auditoría de Facturas Email 
              <span className="bg-purple-600 text-xs px-2 py-0.5 rounded-full">{draftsIA.length}</span>
            </h3>
            
            <div className="space-y-4">
              {draftsIA.map(d => (
                <div key={d.id} className={cn(
                  "bg-slate-800/50 p-5 rounded-3xl border transition-colors",
                  d.cuadraPerfecto ? 'border-emerald-500/50' : 'border-amber-500/50'
                )}>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex-1">
                      <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-1">Leído en el PDF</p>
                      <h4 className="text-white font-black text-xl">{d.prov}</h4>
                      <p className="text-slate-400 text-xs font-mono">Ref: {d.num} | Fecha: {d.date}</p>
                      <p className="text-3xl font-black text-white mt-2">{Num.fmt(Math.abs(d.total))}</p>
                    </div>

                    <div className="flex-1 bg-slate-900 p-4 rounded-2xl w-full">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-slate-400 font-bold uppercase">Tus Albaranes ({d.candidatos.length})</span>
                        <span className="text-sm font-black text-white">{Num.fmt(d.sumaAlbaranes)}</span>
                      </div>
                      {d.candidatos.length > 0 ? (
                        <div className="space-y-1 max-h-24 overflow-y-auto custom-scrollbar pr-2">
                          {d.candidatos.map(c => (
                            <div key={c.id} className="flex justify-between text-[10px] text-slate-500 border-b border-slate-800 pb-1">
                              <span>📅 {c.date} - {c.num}</span>
                              <span className="text-slate-300 font-bold">{Num.fmt(c.total)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-rose-400 text-[10px] font-bold italic py-2">⚠️ No hay albaranes pendientes este mes.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-700 flex flex-wrap gap-2 items-center justify-between">
                    <div>
                      {d.cuadraPerfecto ? (
                        <span className="bg-emerald-500/20 text-emerald-400 text-xs font-black px-3 py-1 rounded-lg">✅ CUADRA PERFECTO</span>
                      ) : (
                        <span className="bg-amber-500/20 text-amber-400 text-xs font-black px-3 py-1 rounded-lg">⚠️ DESCUADRE: {Num.fmt(d.diferencia)}</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleConfirmAuditoriaIA(d.id)}
                        className={cn(
                          "text-white text-xs px-5 py-2.5 rounded-xl font-black shadow-lg transition active:scale-95",
                          d.cuadraPerfecto ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-500 hover:bg-amber-600'
                        )}
                      >
                        {d.cuadraPerfecto ? 'VINCULAR Y CERRAR MES' : 'CERRAR IGNORANDO DIFERENCIA'}
                      </button>
                      <button 
                        onClick={() => handleDiscardDraftIA(d.id)}
                        className="bg-slate-700 hover:bg-rose-500 text-white text-xs p-2.5 rounded-xl font-black transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Section */}
      <section className="p-6 bg-white rounded-[2.5rem] shadow-sm border border-slate-100">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-black text-slate-800 mb-1">Cierre de Facturas</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Control total y conciliación bancaria</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleSyncIA}
              disabled={isSyncing}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-black hover:shadow-lg hover:scale-105 transition flex items-center gap-2 disabled:opacity-50"
            >
              {isSyncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <span>⚡</span>}
              FORZAR LECTURA EMAILS
            </button>
            <button 
              onClick={notifyOverdue}
              className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-xs font-black hover:bg-slate-50 transition flex items-center gap-2 shadow-sm"
            >
              <Bell className="w-4 h-4 text-rose-500" />
              AVISAR VENCIMIENTOS
            </button>
            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-full border border-slate-200">
              <button 
                onClick={() => setMode('proveedor')}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all",
                  mode === 'proveedor' ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600"
                )}
              >
                Proveedores
              </button>
              <button 
                onClick={() => setMode('socio')}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all",
                  mode === 'socio' ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600"
                )}
              >
                Socios
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-2xl mb-6">
          <button 
            onClick={() => setActiveTab('pend')}
            className={cn(
              "flex-1 py-3 rounded-xl font-black text-xs transition",
              activeTab === 'pend' ? "bg-white shadow text-indigo-600" : "text-slate-400 hover:bg-slate-200"
            )}
          >
            📦 ALBARANES SUELTOS
          </button>
          <button 
            onClick={() => setActiveTab('hist')}
            className={cn(
              "flex-1 py-3 rounded-xl font-black text-xs transition",
              activeTab === 'hist' ? "bg-white shadow text-indigo-600" : "text-slate-400 hover:bg-slate-200"
            )}
          >
            💰 FACTURAS CERRADAS
          </button>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 bg-white border px-3 py-1 rounded-2xl shadow-sm w-full md:w-auto justify-center">
            <button onClick={() => setYear(year - 1)} className="text-indigo-600 font-bold p-1 hover:scale-110 transition">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-black text-slate-700 w-10 text-center">{year}</span>
            <button onClick={() => setYear(year + 1)} className="text-indigo-600 font-bold p-1 hover:scale-110 transition">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="🔍 Buscar proveedor o ref..." 
              className="w-full p-2 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 transition shadow-inner"
            />
          </div>
        </div>

        {activeTab === 'hist' && (
          <div className="flex flex-wrap gap-2 mb-6">
            {[
              { id: 'all', label: 'Todas', color: 'text-slate-500' },
              { id: 'pending', label: '⏳ Pendientes', color: 'text-slate-500' },
              { id: 'paid', label: '✔️ Pagadas Efectivo', color: 'text-emerald-600' },
              { id: 'reconciled', label: '🔗 Pagadas Banco', color: 'text-blue-600' }
            ].map(chip => (
              <button 
                key={chip.id}
                onClick={() => setFilterStatus(chip.id as any)}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-bold border transition-all",
                  filterStatus === chip.id 
                    ? "bg-indigo-600 text-white border-indigo-600" 
                    : cn("bg-white border-slate-200 hover:bg-slate-50", chip.color)
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-4">
          {activeTab === 'pend' ? (
            pendingGroups.length > 0 ? (
              pendingGroups.map(([mk, data]) => (
                <div key={mk} className="mb-8 animate-fade-in">
                  <h3 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-3 px-2 border-b border-indigo-100 pb-2">{data.name}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.values(data.groups).map((g: any) => (
                      <div 
                        key={g.label}
                        onClick={() => handleOpenGroup(g.label, g.ids)}
                        className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition cursor-pointer group"
                      >
                        <div>
                          <p className="font-black text-slate-800 group-hover:text-indigo-600 transition">{g.label}</p>
                          <span className="inline-block mt-1 px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-[9px] font-bold uppercase">{g.count} Albaranes</span>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-slate-900 text-lg">{Num.fmt(g.t)}</p>
                          <p className="text-[9px] font-bold text-indigo-400 group-hover:underline mt-1 flex items-center gap-1">
                            CERRAR MANUAL <ArrowRight className="w-2 h-2" />
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-20 flex flex-col items-center justify-center opacity-50">
                <Package className="w-12 h-12 mb-3 text-slate-300" />
                <p className="text-slate-500 font-bold text-sm">No hay albaranes sueltos.</p>
              </div>
            )
          ) : (
            historyList.length > 0 ? (
              <div className="space-y-3">
                {historyList.map(f => (
                  <div key={f.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition">
                    <div className="flex-1 cursor-pointer" onClick={() => setSelectedInvoice(f)}>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded uppercase">{f.date}</span>
                        {f.source === 'email-ia' ? (
                          <span className="text-[9px] font-black text-purple-600 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">🤖 AUDITADA IA</span>
                        ) : (
                          <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">📦 CERRADA MANUAL</span>
                        )}
                        {f.reconciled ? (
                          <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">🔗 BANCO OK</span>
                        ) : (
                          <span className="text-[9px] font-black text-rose-500 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">ESPERANDO BANCO</span>
                        )}
                      </div>
                      <p className="font-black text-slate-800 text-base">
                        {mode === 'socio' ? (f.cliente || f.prov || '—') : (f.prov || f.cliente || '—')}
                      </p>
                      <p className="text-xs text-indigo-500 font-bold">Nº: {f.num}</p>
                    </div>
                    
                    <div className="flex items-center justify-between md:justify-end gap-6 md:w-auto w-full border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                      <div className="text-left md:text-right">
                        <p className="font-black text-slate-900 text-xl">{Num.fmt(Math.abs(f.total))}</p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleTogglePago(f.id)}
                          className={cn(
                            "px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all shadow-sm",
                            f.paid ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          )}
                        >
                          {f.paid ? '✔️ CASH OK' : '⏳ PENDIENTE'}
                        </button>
                        <button 
                          onClick={() => handleDeleteFactura(f.id)}
                          className="w-8 h-8 flex items-center justify-center bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition shadow-sm"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-20 flex flex-col items-center justify-center opacity-50">
                <FileText className="w-12 h-12 mb-3 text-slate-300" />
                <p className="text-slate-500 font-bold text-sm">No hay facturas cerradas.</p>
              </div>
            )
          )}
        </div>
      </section>

      {/* Group Modal */}
      <AnimatePresence>
        {selectedGroup && (
          <div className="fixed inset-0 z-[100] flex justify-center items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedGroup(null)}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl relative z-10 flex flex-col max-h-[90vh]"
            >
              <button onClick={() => setSelectedGroup(null)} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500 text-2xl transition">✕</button>
              
              <div className="border-b border-slate-100 pb-4 mb-4">
                <h3 className="text-2xl font-black text-slate-800">{selectedGroup.label}</h3>
                <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest mt-1">Cierre de mes manual</p>
              </div>
              
              <div className="space-y-2 flex-1 overflow-y-auto pr-2 custom-scrollbar bg-slate-50 rounded-2xl p-4 border border-slate-100">
                {(data.albaranes || []).filter(a => selectedGroup.ids.includes(a.id)).map(a => (
                  <label key={a.id} className="flex justify-between items-center py-3 border-b border-slate-200 last:border-0 cursor-pointer hover:bg-slate-100 px-2 rounded-xl transition">
                    <div className="flex items-center gap-3">
                      <input 
                        type="checkbox" 
                        checked={modalForm.selectedAlbs.includes(a.id)}
                        onChange={(e) => {
                          const newSelected = e.target.checked 
                            ? [...modalForm.selectedAlbs, a.id]
                            : modalForm.selectedAlbs.filter(id => id !== a.id);
                          setModalForm({ ...modalForm, selectedAlbs: newSelected });
                        }}
                        className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer" 
                      />
                      <div>
                        <p className="font-bold text-slate-700 text-sm">{a.date}</p>
                        <p className="text-[9px] font-mono text-slate-400">Ref: {a.num || 'S/N'}</p>
                      </div>
                    </div>
                    <p className="font-black text-slate-900">{Num.fmt(a.total)}</p>
                  </label>
                ))}
              </div>
              
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between bg-slate-900 p-4 rounded-2xl text-white shadow-lg">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">Suma Seleccionada</span>
                  <span className="text-3xl font-black text-emerald-400">
                    {Num.fmt(modalForm.selectedAlbs.reduce((acc, id) => {
                      const alb = data.albaranes.find(a => a.id === id);
                      return acc + (Num.parse(alb?.total) || 0);
                    }, 0))}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mode === 'socio' ? (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Seleccionar Socio</label>
                      <select 
                        value={modalForm.num.startsWith('SOCIO-') ? modalForm.num.split('-')[1] : ''}
                        onChange={(e) => {
                          const socio = e.target.value;
                          setModalForm({ 
                            ...modalForm, 
                            num: `LIQ-${socio}-${modalForm.date.replace(/-/g,'')}`,
                          });
                          // Actualizamos el label del grupo temporalmente para el guardado
                          setSelectedGroup(prev => prev ? { ...prev, label: socio } : null);
                        }}
                        className="w-full p-4 bg-white border-2 border-indigo-100 rounded-xl font-bold text-slate-800 outline-none focus:border-indigo-500 transition shadow-sm"
                      >
                        <option value="">-- Selecciona Socio --</option>
                        {REAL_PARTNERS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Nº Factura Oficial</label>
                      <input 
                        type="text" 
                        value={modalForm.num}
                        onChange={(e) => setModalForm({ ...modalForm, num: e.target.value })}
                        placeholder="Ej: F-2026/012" 
                        className="w-full p-4 bg-white border-2 border-indigo-100 rounded-xl font-bold text-slate-800 outline-none focus:border-indigo-500 transition shadow-sm"
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase ml-2 block mb-1">Fecha Emisión</label>
                    <input 
                      type="date" 
                      value={modalForm.date}
                      onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })}
                      className="w-full p-4 bg-white border-2 border-indigo-100 rounded-xl font-bold text-slate-800 outline-none focus:border-indigo-500 transition shadow-sm"
                    />
                  </div>
                </div>

                <button 
                  onClick={handleConfirmManualInvoice}
                  className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-indigo-700 active:scale-95 transition"
                >
                  GUARDAR FACTURA OFICIAL
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedInvoice && (
          <div className="fixed inset-0 z-[100] flex justify-center items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedInvoice(null)}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl relative z-10"
            >
              <button onClick={() => setSelectedInvoice(null)} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500 text-2xl transition">✕</button>
              
              <h3 className="text-xl font-black text-slate-800">
                {mode === 'socio' ? (selectedInvoice.cliente || selectedInvoice.prov) : (selectedInvoice.prov || selectedInvoice.cliente)}
              </h3>
              <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest mt-1 mb-6">Factura: {selectedInvoice.num}</p>

              <div className="space-y-2 mb-6 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                {selectedInvoice.albaranIdsArr && selectedInvoice.albaranIdsArr.length > 0 ? (
                  <>
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Albaranes Incluidos ({selectedInvoice.albaranIdsArr.length}):</p>
                    {selectedInvoice.albaranIdsArr.map(id => {
                      const alb = data.albaranes.find(a => a.id === id);
                      return alb ? (
                        <div key={id} className="flex justify-between text-xs border-b border-slate-100 py-1 text-slate-600 font-bold">
                          <span>{alb.date}</span>
                          <span>{Num.fmt(alb.total)}</span>
                        </div>
                      ) : null;
                    })}
                  </>
                ) : (
                  <p className="text-xs text-slate-400 italic">No hay albaranes vinculados. Es un gasto directo.</p>
                )}
              </div>

              <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-xs font-black text-slate-500 uppercase">Total Factura</span>
                <span className="text-2xl font-black text-slate-900">{Num.fmt(Math.abs(selectedInvoice.total))}</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
