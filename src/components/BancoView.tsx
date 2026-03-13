import React, { useState, useMemo, useRef, useEffect, useDeferredValue } from 'react';
import { 
  Building2, Search, Trash2, Clipboard, Upload, Zap, 
  CheckCircle2, ArrowRight, TrendingUp, TrendingDown, 
  Scale, Settings, RefreshCw, ShoppingCart, Eraser,
  AlertTriangle, Eye, EyeOff, Sparkles, Filter,
  History, Calendar, Info, BarChart3, PieChart,
  ArrowUpRight, ArrowDownLeft, Check, X as CloseIcon,
  Loader2, Landmark, ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppData, Albaran, FacturaExtended, BankMovement } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { proxyFetch } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';

// ============================================================================
// 🧠 BLOQUE 1: CEREBRO LÓGICO Y MOTOR DE BÚSQUEDA (INTEGRADO PARA EVITAR ERRORES)
// ============================================================================

function normalizeDesc(s = '') {
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u00A0\u202F\s]+/g, ' ').trim();
}

function fingerprint(date: string, amount: number, desc: string) {
  return `${date}|${Number(amount || 0).toFixed(2)}|${normalizeDesc(desc)}`;
}

function daysBetween(a: string, b: string) {
  const A = new Date(a).getTime(), B = new Date(b).getTime();
  return (B - A) / 86400000; // Devuelve días positivos si B es posterior a A
}

const SUSP_PATTERNS = ['COMISION', 'FEE', 'INTERES', 'INTERESES', 'CARGO', 'GASTO BANCO', 'RETENCION', 'ANULACION', 'AJUSTE'];

function isSuspicious(desc: string) {
  const d = normalizeDesc(desc);
  return SUSP_PATTERNS.some(p => d.includes(p));
}

// 🛡️ BÚSQUEDA MEJORADA: Ahora cruza fechas para evitar falsos positivos
function findMatches(item: BankMovement, data: AppData) {
  if (!item) return [];
  const amt = Math.abs(Num.parse(item.amount));
  const descNorm = normalizeDesc(item.desc);
  const bankDate = item.date; // Fecha del cargo/ingreso en banco
  const results: any[] = [];
  
  const TOLERANCIA_FIJA = 1.00; 
  const TOLERANCIA_NOMBRE = 10.00; 
  const MAX_COMISION_TPV = 0.035; 
  const MAX_DAYS_OLD = 90; // Solo busca facturas/albaranes de los últimos 90 días respecto al cargo

  if (Num.parse(item.amount) > 0) {
    // INGRESOS EN BANCO (Cierres TPV o Facturas a Clientes)
    data.cierres?.forEach((c: any) => {
      if (!c.conciliado_banco) {
        const tpvDeclarado = Num.parse(c.tarjeta);
        const diferencia = tpvDeclarado - amt; 
        const porcentajeDiferencia = tpvDeclarado > 0 ? diferencia / tpvDeclarado : 0;
        const daysPassed = daysBetween(c.date, bankDate);

        // El cierre debe ser del mismo día o anterior (hasta 7 días por si pilla puente de finde)
        if (daysPassed >= 0 && daysPassed <= 7 && diferencia >= -0.5 && porcentajeDiferencia <= MAX_COMISION_TPV) {
          results.push({ 
            type: 'TPV CAJA', id: c.id, date: c.date, 
            title: `Cierre ${c.date} (Comisión TPV: ${Num.fmt(diferencia)})`, 
            amount: tpvDeclarado, realAmount: amt, comision: diferencia, color: 'emerald' 
          });
        }
      }
    });

    data.facturas?.forEach((f: any) => {
      if (f.cliente !== "Z DIARIO" && !f.reconciled && Num.parse(f.total) > 0) {
        const daysPassed = daysBetween(f.date, bankDate);
        if (daysPassed >= -2 && daysPassed <= MAX_DAYS_OLD) { // Permite -2 por si la factura la emitiste un día tarde
          const matchImporte = Math.abs(Num.parse(f.total) - amt) <= TOLERANCIA_FIJA;
          const matchNombre = descNorm.includes(normalizeDesc(f.cliente));
          if (matchImporte || (matchNombre && Math.abs(Num.parse(f.total) - amt) <= TOLERANCIA_NOMBRE)) {
            results.push({ type: 'FACTURA CLIENTE', id: f.id, date: f.date, title: `Fac ${f.num} (${f.cliente})`, amount: Num.parse(f.total), color: 'teal' });
          }
        }
      }
    });
  } else {
    // GASTOS EN BANCO (Facturas de Prov, Albaranes sueltos o Gastos Fijos)
    data.albaranes?.forEach((a: any) => {
      if (!a.reconciled && Num.parse(a.total) > 0) {
        const daysPassed = daysBetween(a.date, bankDate);
        if (daysPassed >= 0 && daysPassed <= MAX_DAYS_OLD) {
          const matchImporte = Math.abs(Num.parse(a.total) - amt) <= TOLERANCIA_FIJA;
          const matchNombre = descNorm.includes(normalizeDesc(a.prov));
          if (matchImporte || (matchNombre && Math.abs(Num.parse(a.total) - amt) <= TOLERANCIA_NOMBRE)) {
            results.push({ type: 'ALBARÁN SUELTO', id: a.id, date: a.date, title: `${a.prov} (Ref: ${a.num || 'S/N'})`, amount: Num.parse(a.total), color: 'indigo' });
          }
        }
      }
    });

    data.facturas?.forEach((f: any) => {
      if (Num.parse(f.total) > 0 && !f.reconciled) {
        const daysPassed = daysBetween(f.date, bankDate);
        if (daysPassed >= 0 && daysPassed <= MAX_DAYS_OLD) {
          const matchImporte = Math.abs(Num.parse(f.total) - amt) <= TOLERANCIA_FIJA;
          const matchNombre = descNorm.includes(normalizeDesc(f.prov));
          if (matchImporte || (matchNombre && Math.abs(Num.parse(f.total) - amt) <= TOLERANCIA_NOMBRE)) {
            results.push({ type: 'FACTURA PROV', id: f.id, date: f.date, title: `Fac ${f.num} (${f.prov})`, amount: Num.parse(f.total), color: 'rose' });
          }
        }
      }
    });

    data.gastos_fijos?.forEach((g: any) => {
      if (g.active !== false && Math.abs(Num.parse(g.amount) - amt) <= TOLERANCIA_FIJA) {
        // No filtramos gastos fijos por fecha exacta porque suelen ser cargos recurrentes que varían de día
        results.push({ type: 'GASTO FIJO', id: g.id, date: item.date, title: g.name, amount: Num.parse(g.amount), color: 'amber' });
      }
    });
  }

  // Ordenamos por la diferencia de importe (los más exactos primero)
  return results.sort((a, b) => Math.abs(a.amount - amt) - Math.abs(b.amount - amt));
}

// 🛡️ ENLACE SEGURO (Cascada de pagos)
function executeLink(newData: AppData, bankId: string, matchType: string, docId: string, comision: number = 0) {
  const bItem: any = newData.banco?.find((b: any) => b.id === bankId);
  if (!bItem) return;

  if (matchType.includes('ALBARÁN')) {
    const alb = newData.albaranes?.find((a: any) => a.id === docId);
    if (alb) { 
      alb.reconciled = true; 
      alb.paid = true; 
      alb.status = 'paid'; 
    }
    bItem.link = { type: 'ALBARAN', id: docId }; 
  } else if (matchType.includes('FACTURA')) {
    const fac = newData.facturas?.find((f: any) => f.id === docId);
    if (fac) { 
      fac.reconciled = true; 
      fac.paid = true; 
      fac.status = 'reconciled';
      
      // 💡 FIX: Cascada de pagos. Si pagamos la factura, pagamos sus albaranes.
      if (fac.albaranIdsArr && fac.albaranIdsArr.length > 0) {
        newData.albaranes?.forEach((a: any) => {
          if (fac.albaranIdsArr!.includes(a.id)) { 
            a.reconciled = true; 
            a.paid = true;
            a.status = 'paid';
          }
        });
      }
    }
    bItem.link = { type: 'FACTURA', id: docId }; 
  } else if (matchType.includes('GASTO FIJO')) {
    const d = new Date(bItem.date);
    const monthKey = `pagos_${d.getFullYear()}_${d.getMonth() + 1}`;
    if (!newData.control_pagos) newData.control_pagos = {};
    if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
    if (!newData.control_pagos[monthKey].includes(docId)) newData.control_pagos[monthKey].push(docId);
    bItem.link = { type: 'FIXED_EXPENSE', id: docId };
  } else if (matchType.includes('TPV CAJA')) {
    const cierre = newData.cierres?.find((c: any) => c.id === docId);
    if (cierre) {
      cierre.conciliado_banco = true;
      if (comision > 0) {
        if (!newData.gastos_fijos) newData.gastos_fijos = [];
        const comisionId = 'gf-comision-' + Date.now();
        newData.gastos_fijos.push({
          id: comisionId, name: `Comisión TPV (${cierre.date})`, amount: Num.round2(comision), 
          freq: 'puntual', dia_pago: new Date(bItem.date).getDate(), cat: 'varios', active: false
        });
        const d = new Date(bItem.date);
        const monthKey = `pagos_${d.getFullYear()}_${d.getMonth() + 1}`;
        if (!newData.control_pagos) newData.control_pagos = {};
        if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
        newData.control_pagos[monthKey].push(comisionId);
      }
      const zNum = `Z-${cierre.date.replace(/-/g, '')}`;
      const fZ = newData.facturas?.find((f: any) => f.num === zNum);
      if (fZ) { fZ.reconciled = true; fZ.paid = true; fZ.status = 'reconciled'; }
    }
    bItem.link = { type: 'TPV', id: docId };
  }

  bItem.status = 'matched';
}

/* =======================================================
 * 🎨 COMPONENTE: Rayo de Energía (Para SwipeReconciler)
 * ======================================================= */
const EnergyBeam = ({ sourceId, targetId, isActive }: { sourceId: string, targetId: string, isActive: boolean }) => {
  const [coords, setCoords] = useState<{x1: number, y1: number, x2: number, y2: number} | null>(null);

  useEffect(() => {
    const update = () => {
      const el1 = document.getElementById(sourceId);
      const el2 = document.getElementById(targetId);
      if (el1 && el2) {
        const r1 = el1.getBoundingClientRect();
        const r2 = el2.getBoundingClientRect();
        setCoords({
          x1: r1.left + r1.width / 2,
          y1: r1.bottom,
          x2: r2.left + r2.width / 2,
          y2: r2.top
        });
      }
    };
    const t = setTimeout(update, 200);
    window.addEventListener('resize', update);
    return () => { clearTimeout(t); window.removeEventListener('resize', update); };
  }, [sourceId, targetId]);

  if (!coords) return null;

  return (
    <svg className="absolute inset-0 pointer-events-none z-0 w-full h-full" style={{ overflow: 'visible' }}>
      <motion.path
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: isActive ? 1 : 0.3 }}
        d={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1 + 50}, ${coords.x2} ${coords.y2 - 50}, ${coords.x2} ${coords.y2}`}
        stroke={isActive ? "#10b981" : "#818cf8"} // Emerald en hover, Indigo por defecto
        strokeWidth={isActive ? "4" : "2"}
        fill="none"
        strokeDasharray={isActive ? "none" : "4 4"}
        className="transition-all duration-300"
        style={{ filter: isActive ? "drop-shadow(0 0 8px #34d399)" : "none" }}
      />
      {isActive && (
        <circle r="6" fill="#34d399" style={{ filter: "drop-shadow(0 0 10px #10b981)" }}>
          <animateMotion dur="0.8s" repeatCount="1" path={`M ${coords.x1} ${coords.y1} C ${coords.x1} ${coords.y1 + 50}, ${coords.x2} ${coords.y2 - 50}, ${coords.x2} ${coords.y2}`} />
        </circle>
      )}
    </svg>
  );
};


// ============================================================================
// 🏦 BLOQUE 2: VISTA PRINCIPAL DEL BANCO
// ============================================================================

interface BancoViewProps {
  data: AppData;
  onSave: (newData: AppData) => Promise<void>;
}

export const BancoView = ({ data, onSave }: BancoViewProps) => {
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearch = useDeferredValue(searchTerm); 
  
  const [isMagicLoading, setIsMagicLoading] = useState(false);
  const [isApiSyncing, setIsApiSyncing] = useState(false);
  const [isSwipeMode, setIsSwipeMode] = useState(false);
  
  type BankFilter = 'all' | 'pending' | 'unmatched' | 'suspicious' | 'duplicate' | 'reviewed';
  const [viewFilter, setViewFilter] = useState<BankFilter>('pending');
  const [activeTab, setActiveTab] = useState<'list' | 'insights'>('list');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const n8nUrl = data.config?.n8nUrlBanco || "https://ia.permatunnelopen.org/webhook/1085406f-324c-42f7-b50f-22f211f445cd";

  const cashFlowData = useMemo(() => {
    const days = 30; const result = []; const now = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(); d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayMovs = (data.banco || []).filter((m: any) => m.date === dateStr);
      const income = dayMovs.filter((m: any) => Num.parse(m.amount) > 0).reduce((acc: number, m: any) => acc + Num.parse(m.amount), 0);
      const expense = Math.abs(dayMovs.filter((m: any) => Num.parse(m.amount) < 0).reduce((acc: number, m: any) => acc + Num.parse(m.amount), 0));
      result.push({ name: d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }), ingresos: income, gastos: expense, balance: income - expense });
    }
    return result;
  }, [data.banco]);

  const pendingCajas = useMemo(() => {
    return (data.cierres || []).filter((c: any) => {
      const isCardMatched = (data.banco || []).some((b: any) => 
        b.status === 'matched' && b.link?.type === 'FACTURA' && 
        data.facturas?.find((f: any) => f.id === b.link?.id)?.num === `Z-${c.date.replace(/-/g, '')}`
      );
      return !isCardMatched && Num.parse(c.tarjeta) > 0;
    }).slice(0, 5);
  }, [data.cierres, data.banco, data.facturas]);

  const stats = useMemo(() => {
    const movements = data.banco || [];
    const sumaMovs = movements.reduce((acc: number, b: any) => acc + (Num.parse(b.amount) || 0), 0);
    const saldo = (Num.parse(data.config?.saldoInicial) || 0) + sumaMovs;
    const pending = movements.filter((b: any) => b.status === 'pending');
    const matched = movements.length - pending.length;
    const percent = movements.length > 0 ? Math.round((matched / movements.length) * 100) : 0;
    const trend = movements.slice(-10).map((m: any) => Num.parse(m.amount));
    return { saldo, percent, pending: pending.length, total: movements.length, matched, trend };
  }, [data.banco, data.config?.saldoInicial]);

  const prevPagos = useMemo(() => {
    const now = new Date(); const target = new Date(now); target.setDate(now.getDate() + 7);
    const items = (data.gastos_fijos || []).filter((g: any) => g.active !== false && g.freq && g.dia_pago).map((g: any) => {
        const due = new Date(now.getFullYear(), now.getMonth(), Number(g.dia_pago) || 1);
        if (due < now) due.setMonth(due.getMonth() + 1);
        return { amount: Num.parse(g.amount), within: due <= target };
    }).filter((x: any) => x.within);
    return items.reduce((acc: number, x: any) => acc + x.amount, 0);
  }, [data.gastos_fijos]);

  const filteredMovements = useMemo(() => {
    const base = (data.banco || []).filter((b: any) => 
      b.desc.toLowerCase().includes(deferredSearch.toLowerCase()) || b.amount.toString().includes(deferredSearch)
    );
    return base.filter((b: any) => {
      if (viewFilter === 'all') return true;
      if (viewFilter === 'pending') return b.status === 'pending';
      if (viewFilter === 'unmatched') return b.flags?.unmatched === true;
      if (viewFilter === 'suspicious') return b.flags?.suspicious === true;
      if (viewFilter === 'duplicate') return b.flags?.duplicate === true;
      if (viewFilter === 'reviewed') return b.reviewed === true;
      return true;
    }).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.banco, deferredSearch, viewFilter]);

  const selectedItem = useMemo(() => data.banco?.find((b: any) => b.id === selectedBankId), [data.banco, selectedBankId]);

  const matches = useMemo(() => {
    if (!selectedItem) return [];
    return findMatches(selectedItem, data);
  }, [selectedItem, data]);

  // 🔥 NUEVA LÓGICA DE SINCRONIZACIÓN REAL CON N8N
  const handleApiSync = async () => {
    setIsApiSyncing(true);
    try {
      const result = await proxyFetch(n8nUrl, { 
        method: 'POST', 
        body: { action: 'sync_banca_march' } 
      });

      if (result && result.movements) {
        const newData = JSON.parse(JSON.stringify(data));
        if (!newData.banco) newData.banco = [];
        let addedCount = 0;

        result.movements.forEach((m: any) => {
          const fp = fingerprint(m.date, Num.parse(m.amount), m.desc);
          if (!newData.banco.some((b: any) => b.hash === fp)) {
            newData.banco.push({ 
              id: 'march-' + Date.now() + Math.random().toString(36).slice(2, 7), 
              date: m.date, 
              amount: Num.parse(m.amount), 
              desc: m.desc, 
              status: 'pending', 
              hash: fp 
            });
            addedCount++;
          }
        });

        await onSave(newData); 
        alert(`✅ Sincronizado: ${addedCount} movimientos nuevos descargados.`);
      } else {
        alert("✅ Sincronización completada (sin datos nuevos).");
      }
    } catch (err) {
      console.error(err);
      alert("❌ Error conectando con la API del Banco mediante n8n.");
    } finally { 
      setIsApiSyncing(false); 
    }
  };

  const handleAnalyze = async () => {
    const newData = JSON.parse(JSON.stringify(data)); 
    const seen: any[] = [];
    newData.banco = (newData.banco || []).map((m: any) => {
      const n = { ...m };
      const fp = fingerprint(n.date, Num.parse(n.amount), n.desc || '');
      if (!n.hash) n.hash = fp;
      let duplicate = false;
      for (const prev of seen) {
        if (Math.abs(Num.parse(prev.amount) - Num.parse(n.amount)) < 0.005) {
          if (normalizeDesc(prev.desc) === normalizeDesc(n.desc) && daysBetween(prev.date, n.date) <= 2) { duplicate = true; break; }
        }
      }
      seen.push({ date: n.date, amount: Num.parse(n.amount), desc: n.desc });
      n.flags = { duplicate, suspicious: isSuspicious(n.desc || ''), unmatched: n.status === 'pending' && !n.link?.id };
      if (n.reviewed === undefined) n.reviewed = false;
      return n;
    });
    await onSave(newData); alert('📊 Análisis completado: Sospechosos y duplicados detectados.');
  };

  const toggleReviewed = async (id: string, val: boolean) => {
    const newData = { ...data };
    const it: any = newData.banco?.find((b: any) => b.id === id);
    if (!it) return;
    it.reviewed = val;
    await onSave(newData);
  };

  const handleReviewAll = async () => {
    if (!confirm(`¿Marcar los ${filteredMovements.length} movimientos visibles como REVISADOS?`)) return;
    const newData = { ...data };
    const visibleIds = new Set(filteredMovements.map((m: any) => m.id));
    newData.banco = newData.banco.map((b: any) => { if (visibleIds.has(b.id)) return { ...b, reviewed: true }; return b; });
    await onSave(newData);
  };

  const handleLink = async (bankId: string, matchType: string, docId: string, comision: number = 0) => {
    const newData = JSON.parse(JSON.stringify(data));
    executeLink(newData, bankId, matchType, docId, comision); 
    await onSave(newData);
    setSelectedBankId(null);
  };

  const handleQuickAction = async (bankId: string, label: string, type: 'ALBARAN' | 'FIXED_EXPENSE' | 'TPV' | 'CASH' | 'INCOME') => {
    const newData = JSON.parse(JSON.stringify(data));
    const item = newData.banco.find((b: any) => b.id === bankId);
    if (!item) return;

    const amtRaw = Num.parse(item.amount);
    const amt = Math.abs(amtRaw);

    if (type === 'FIXED_EXPENSE') {
      const d = new Date(item.date);
      const monthKey = `pagos_${d.getFullYear()}_${d.getMonth() + 1}`;
      if (!newData.control_pagos) newData.control_pagos = {};
      if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
      const isPersonal = label.includes('Personal') || label.includes('Nómina');
      
      const pendingFixed = (newData.gastos_fijos || []).find((g: any) => 
        g.active !== false && g.cat === (isPersonal ? 'personal' : 'varios') &&
        !newData.control_pagos[monthKey].includes(g.id) && Math.abs(Num.parse(g.amount) - amt) < 50 
      );

      if (pendingFixed) {
        newData.control_pagos[monthKey].push(pendingFixed.id);
      } else { 
        const newFixedId = 'gf-' + Date.now();
        if (!newData.gastos_fijos) newData.gastos_fijos = [];
        newData.gastos_fijos.push({ id: newFixedId, name: `${label} (Detectado Auto)`, amount: amt, freq: 'mensual', dia_pago: d.getDate(), cat: isPersonal ? 'personal' : 'varios', active: true });
        newData.control_pagos[monthKey].push(newFixedId);
      }
    } else if (type === 'TPV') {
      const zMatch = newData.cierres?.find((c: any) => !c.conciliado_banco && Math.abs(Num.parse(c.tarjeta) - amt) <= 5);
      if (zMatch) {
        zMatch.conciliado_banco = true;
        const zNum = `Z-${zMatch.date.replace(/-/g, '')}`;
        const fZ = newData.facturas?.find((f: any) => f.num === zNum);
        if (fZ) { fZ.reconciled = true; fZ.paid = true; fZ.status = 'reconciled'; }
      }
    } else if (type === 'CASH') {
      const cMatch = newData.cierres?.find((c: any) => !c.conciliado_banco && Math.abs(Num.parse(c.efectivo) - amt) <= 50);
      if (cMatch) cMatch.conciliado_banco = true;
    }

    item.status = 'matched'; item.category = label;
    await onSave(newData);
    setSelectedBankId(null);
  };

  const handleMagicMatch = async () => {
    const pendings = filteredMovements.slice(0, 25);
    if (pendings.length === 0) return alert("No hay movimientos pendientes.");
    setIsMagicLoading(true);
    try {
      const result = await proxyFetch(n8nUrl, { method: 'POST', body: { movimientos: pendings.map((m: any) => ({ ...m, descOriginal: m.desc })), saldoInicial: data.config?.saldoInicial } });
      if (result && result.movimientos) {
        const newData = JSON.parse(JSON.stringify(data));
        let count = 0;
        for (const mov of result.movimientos) {
          const item = newData.banco.find((b: any) => b.id === mov.id);
          if (!item) continue;
          const amtRaw = Num.parse(item.amount);

          if (amtRaw > 0) {
            if (mov.esCierreTPV) {
              const zMatch = newData.cierres?.find((c: any) => !c.conciliado_banco && Math.abs(Num.parse(c.tarjeta) - Math.abs(amtRaw)) <= 5);
              if (zMatch) {
                zMatch.conciliado_banco = true;
                const fZ = newData.facturas?.find((f: any) => f.num === `Z-${zMatch.date.replace(/-/g, '')}`);
                if (fZ) { fZ.reconciled = true; fZ.paid = true; fZ.status = 'reconciled'; }
              }
            }
          } else {
            if (mov.categoriaAsignada && mov.confidence >= 0.7) {
              const catLower = mov.categoriaAsignada.toLowerCase();
              if (catLower.includes('personal') || catLower.includes('nómina') || catLower.includes('alquiler')) {
                 const d = new Date(item.date);
                 const monthKey = `pagos_${d.getFullYear()}_${d.getMonth() + 1}`;
                 if (!newData.control_pagos) newData.control_pagos = {};
                 if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
                 
                 const newFixedId = 'gf-ia-' + Date.now();
                 if (!newData.gastos_fijos) newData.gastos_fijos = [];
                 newData.gastos_fijos.push({ id: newFixedId, name: mov.categoriaAsignada, amount: Math.abs(amtRaw), freq: 'mensual', dia_pago: d.getDate(), cat: catLower.includes('personal') ? 'personal' : 'varios', active: true });
                 newData.control_pagos[monthKey].push(newFixedId);
              }
            }
          }
          item.status = 'matched'; item.category = mov.categoriaAsignada || 'IA';
          count++;
        }
        await onSave(newData); alert(`✨ IA ha conciliado ${count} movimientos.`);
      }
    } catch (err) { alert("Error conectando con la IA."); } finally { setIsMagicLoading(false); }
  };

  const handleAutoCleanup = async () => {
    if (!confirm("⚠️ ¿LIMPIEZA AUTOMÁTICA?")) return;
    const newData = JSON.parse(JSON.stringify(data));
    let eliminados = 0;
    const initialAlbs = (newData.albaranes || []).length;
    newData.albaranes = (newData.albaranes || []).filter((a: any) => !(a.id.startsWith('auto-') || a.id.startsWith('ia-') || a.prov === 'BANCO' || a.prov?.includes('(IA)')));
    eliminados += (initialAlbs - newData.albaranes.length);
    const initialFacs = (newData.facturas || []).length;
    newData.facturas = (newData.facturas || []).filter((f: any) => !(f.id.startsWith('auto-fac') || f.id.startsWith('fac-ia-') || f.id.startsWith('fac-z-auto') || f.cliente === 'Z DIARIO AUTO' || f.cliente === 'Ingreso Banco'));
    eliminados += (initialFacs - newData.facturas.length);
    await onSave(newData); alert(`✨ Limpieza exitosa: ${eliminados} documentos eliminados.`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const newData = JSON.parse(JSON.stringify(data));
      if (!newData.banco) newData.banco = [];
      let imported = 0;

      rows.forEach(row => {
        const date = row.Fecha || row.Date || row.date;
        const amount = row.Importe || row.Amount || row.amount;
        const desc = row.Concepto || row.Description || row.desc;

        if (date && amount) {
          let dateISO = String(date);
          if (typeof date === 'number') {
            dateISO = new Date(new Date(1899, 11, 30).getTime() + date * 86400000).toISOString().split('T')[0];
          } else if (date.includes('/')) {
            const parts = date.split('/');
            if (parts[2].length === 4) dateISO = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
          const fp = fingerprint(dateISO, Num.parse(amount), String(desc));
          if (!newData.banco.some((b: any) => b.hash === fp)) {
            newData.banco.push({ id: 'imp-' + Date.now() + Math.random().toString(36).slice(2, 7), date: dateISO, amount: Num.parse(amount), desc: desc || 'Importado', status: 'pending', hash: fp });
            imported++;
          }
        }
      });
      await onSave(newData); alert(`📥 ${imported} movimientos importados.`);
    };
    reader.readAsBinaryString(file);
  };

  const handleNuke = async () => {
    if (!confirm("🛑 PELIGRO: ¿Borrar todos los movimientos ya conciliados para hacer espacio?")) return;
    const newData = JSON.parse(JSON.stringify(data));
    newData.banco = newData.banco.filter((b: any) => b.status === 'pending');
    await onSave(newData);
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="flex justify-between items-start relative z-10">
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter flex items-center gap-2">
               <Landmark className="w-6 h-6 text-indigo-600" /> Banco Inteligente
            </h2>
            <p className="text-[10px] font-black text-slate-400 uppercase mt-1">Conciliación Financiera y Cierres</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Saldo Actual</p>
            <span className="text-3xl font-black text-slate-800">{Num.fmt(stats.saldo)}</span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="bg-slate-900 text-white px-5 py-3 rounded-2xl text-[10px] font-black hover:scale-105 transition flex items-center gap-2 shadow-lg">
            <Upload className="w-4 h-4" /> SUBIR EXCEL
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx,.xls,.csv" />
          </button>
          {/* BOTON CONECTADO A N8N PARA BANCA MARCH */}
          <button onClick={handleApiSync} disabled={isApiSyncing} className="bg-indigo-600 text-white px-5 py-3 rounded-2xl text-[10px] font-black hover:bg-indigo-700 transition shadow-lg flex items-center gap-2">
            {isApiSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} SYNC PSD2
          </button>
          
          <button onClick={handleAnalyze} className="bg-amber-50 text-amber-700 px-5 py-3 rounded-2xl text-[10px] font-black hover:bg-amber-100 transition shadow-sm flex items-center gap-2">
            <Filter className="w-4 h-4" /> ANALIZAR BANDERAS
          </button>
          
          <button onClick={handleMagicMatch} disabled={isMagicLoading} className="bg-emerald-50 text-emerald-700 px-5 py-3 rounded-2xl text-[10px] font-black hover:bg-emerald-100 transition shadow-sm flex items-center gap-2">
             {isMagicLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} IA MATCH
          </button>

          <button onClick={() => setIsSwipeMode(true)} className="bg-slate-100 text-slate-700 px-5 py-3 rounded-2xl text-[10px] font-black hover:bg-slate-200 transition shadow-sm flex items-center gap-2 ml-auto">
            <ArrowRight className="w-4 h-4" /> MODO SWIPE
          </button>
          
          <button onClick={handleAutoCleanup} className="bg-slate-100 text-slate-400 hover:text-rose-500 px-3 py-3 rounded-2xl transition shadow-sm flex items-center">
            <Eraser className="w-4 h-4" />
          </button>
          <button onClick={handleNuke} className="bg-slate-100 text-slate-400 hover:text-red-600 px-3 py-3 rounded-2xl transition shadow-sm flex items-center">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-2 rounded-[2rem] border border-slate-100 flex items-center gap-2 shadow-sm sticky top-0 z-10">
            <Search className="w-4 h-4 text-slate-400 ml-3" />
            <input type="text" placeholder="Buscar movimiento..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-transparent text-xs font-bold outline-none text-slate-600 h-10 px-2" />
          </div>

          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {filteredMovements.map((b: any) => (
              <motion.div key={b.id} layoutId={b.id} onClick={() => setSelectedBankId(b.id)} className={cn("group relative bg-white p-5 rounded-[2rem] border-2 transition cursor-pointer", selectedBankId === b.id ? "border-indigo-200 bg-indigo-50/50 shadow-md" : "border-slate-100 hover:border-indigo-100")}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-slate-800 text-sm truncate uppercase tracking-tight">{b.desc}</p>
                    <p className="text-[10px] text-slate-400 font-bold mt-1 tracking-widest">{b.date}</p>
                    {b.status === 'matched' && <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full mt-3 inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> CONCILIADO</span>}
                  </div>
                  <span className={cn("font-black text-lg whitespace-nowrap tracking-tighter", Num.parse(b.amount) < 0 ? "text-slate-900" : "text-emerald-500")}>
                    {Num.parse(b.amount) > 0 ? '+' : ''}{Num.fmt(b.amount)}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="bg-white p-10 rounded-[3rem] border border-slate-100 h-[680px] flex flex-col shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
            <AnimatePresence mode="wait">
              {selectedItem ? (
                <motion.div key={selectedItem.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 flex flex-col">
                  <div className="border-b border-slate-100 pb-8 mb-8 relative">
                    <span className={cn("text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest", Num.parse(selectedItem.amount) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                      {Num.parse(selectedItem.amount) > 0 ? 'INGRESO DETECTADO' : 'GASTO DETECTADO'}
                    </span>
                    <h3 className="font-black text-3xl mt-5 leading-tight text-slate-800 tracking-tighter">{selectedItem.desc}</h3>
                    <p id={`bank-preview-${selectedItem.id}`} className={cn("text-5xl font-black mt-3 tracking-tighter inline-block", Num.parse(selectedItem.amount) > 0 ? "text-emerald-500" : "text-slate-900")}>
                      {Num.fmt(selectedItem.amount)}
                    </p>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 mb-6">
                    {matches.length > 0 && selectedItem.status === 'pending' ? (
                      <div className="space-y-4">
                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-indigo-500" /> Sugerencias Inteligentes
                        </p>
                        {matches.map((m: any, idx: number) => (
                          <div key={idx} id={`match-preview-${m.id}`} className={cn("flex justify-between items-center p-5 rounded-[2rem] border-2 hover:shadow-lg transition-all", m.color === 'emerald' ? "bg-emerald-50 border-emerald-100" : m.color === 'amber' ? "bg-amber-50 border-amber-100" : "bg-indigo-50 border-indigo-100")}>
                            <div className="text-left">
                              <span className="text-[9px] font-black uppercase tracking-widest opacity-70">{m.type}</span>
                              <p className="text-sm font-black text-slate-800 mt-1">{m.title}</p>
                            </div>
                            <div className="flex items-center gap-5">
                              <span className="font-black text-lg text-slate-900 tracking-tighter">{Num.fmt(m.amount)}</span>
                              <button onClick={() => handleLink(selectedItem.id, m.type, m.id, m.comision || 0)} className="bg-slate-900 text-white px-5 py-3 rounded-2xl text-[10px] font-black hover:scale-105 transition shadow-lg">
                                ENLAZAR
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      selectedItem.status !== 'pending' ? (
                        <div className="flex flex-col items-center justify-center py-12 bg-emerald-50 rounded-[3rem] border-2 border-emerald-100">
                          <ShieldCheck className="w-16 h-16 text-emerald-400 mb-4" />
                          <p className="text-emerald-700 font-black uppercase tracking-widest text-sm">Conciliado Correctamente</p>
                        </div>
                      ) : (
                        <div className="text-center opacity-40 py-12"><Search className="w-12 h-12 mx-auto mb-3 text-slate-400" /><p className="text-xs font-black uppercase tracking-widest">No hay sugerencias exactas</p></div>
                      )
                    )}

                    {selectedItem.status === 'pending' && (
                      <div className="mt-10">
                        <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                          <Zap className="w-4 h-4 text-indigo-500" /> Creación Rápida Manual
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          {(Num.parse(selectedItem.amount) > 0 ? [
                            { label: 'Cierre TPV (Tarjetas)', icon: TrendingUp, type: 'TPV' as const },
                            { label: 'Ingreso Efectivo', icon: Building2, type: 'CASH' as const }
                          ] : [
                            { label: 'Gasto Fijo', icon: Zap, type: 'FIXED_EXPENSE' as const },
                            { label: 'Comisión Bancaria', icon: Building2, type: 'FIXED_EXPENSE' as const },
                            { label: 'Personal / Nómina', icon: TrendingDown, type: 'FIXED_EXPENSE' as const }
                          ]).map(cat => (
                            <button key={cat.label} onClick={() => handleQuickAction(selectedItem.id, cat.label, cat.type)} className="p-5 border-2 border-slate-100 rounded-[2rem] hover:bg-slate-50 hover:border-indigo-100 text-left transition-all group cursor-pointer">
                              <cat.icon className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 mb-3 transition-colors" />
                              <p className="text-[11px] font-black text-slate-600 uppercase tracking-tight">{cat.label}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : (
                <div className="flex-1 flex flex-col justify-center items-center text-center opacity-40"><Building2 className="w-16 h-16 mb-5" /><p className="text-xs font-black uppercase tracking-widest">Selecciona un movimiento</p></div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* 🚀 MODAL SWIPE INTEGRADO */}
      <AnimatePresence>
        {isSwipeMode && (
          <SwipeReconciler 
            data={data} 
            onSave={onSave} 
            onClose={() => setIsSwipeMode(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// 👆 BLOQUE 3: SWIPE RECONCILER (El "Tinder" Bancario integrado)
// ============================================================================

const SwipeReconciler: React.FC<SwipeReconcilerProps> = ({ data, onSave, onClose }) => {
  const pendingMovements = useMemo(() => {
    return (data.banco || []).filter((b: any) => b.status === 'pending');
  }, [data.banco]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [hoveredMatch, setHoveredMatch] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && !isLinking) next();
      if (e.key === 'Escape' && !isLinking) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, pendingMovements.length, isLinking]);

  const next = () => setCurrentIndex(prev => prev + 1);

  if (pendingMovements.length === 0 || currentIndex >= pendingMovements.length) {
    return (
      <div className="fixed inset-0 z-[1000] flex justify-center items-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/95 backdrop-blur-xl" />
        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative z-10 flex flex-col items-center text-center">
          <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center mb-6 shadow-[0_0_60px_-10px_rgba(16,185,129,0.5)]">
            <CheckCircle2 className="w-12 h-12 text-white" />
          </div>
          <h2 className="text-4xl font-black text-white tracking-tighter mb-2">¡Todo al día!</h2>
          <p className="text-emerald-400 font-bold uppercase tracking-widest mb-8">No hay más movimientos pendientes</p>
          <button onClick={onClose} className="bg-white text-slate-900 px-8 py-4 rounded-full font-black text-sm hover:scale-105 transition shadow-xl">
            VOLVER AL PANEL
          </button>
        </motion.div>
      </div>
    );
  }

  const currentItem = pendingMovements[currentIndex];

  const matches = useMemo(() => {
    return findMatches(currentItem, data);
  }, [currentItem, data]);

  const handleLinkLocal = async (matchType: string, docId: string, comision: number = 0) => {
    if (isLinking) return;
    setIsLinking(true);
    setHoveredMatch(docId);

    // Damos tiempo a ver la animación del rayo verde
    await new Promise(r => setTimeout(r, 600));

    try {
      const newData = JSON.parse(JSON.stringify(data));
      executeLink(newData, currentItem.id, matchType, docId, comision); 
      await onSave(newData);
      next();
    } catch (e) {
      alert("Error al enlazar");
    } finally {
      setIsLinking(false);
      setHoveredMatch(null);
    }
  };

  const progressPercent = Math.round((currentIndex / pendingMovements.length) * 100);

  return (
    <div className="fixed inset-0 z-[1000] flex justify-center items-center p-4 overflow-hidden">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !isLinking && onClose()} className="absolute inset-0 bg-slate-900/95 backdrop-blur-xl" />
      
      <div className="relative z-10 w-full max-w-lg flex flex-col items-center">
        <div className="w-full flex justify-between items-center mb-6 px-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg"><Sparkles className="w-6 h-6 text-white" /></div>
            <div>
              <h3 className="text-white font-black text-xl leading-none">Swipe Mode</h3>
              <p className="text-indigo-400 text-[11px] font-black uppercase tracking-widest mt-1">{pendingMovements.length - currentIndex} RESTANTES</p>
            </div>
          </div>
          <button onClick={onClose} disabled={isLinking} className="text-white/40 hover:text-white hover:rotate-90 transition-all disabled:opacity-0"><CloseIcon className="w-8 h-8" /></button>
        </div>

        <AnimatePresence mode="popLayout">
          <motion.div 
            key={currentItem.id}
            initial={{ scale: 0.9, opacity: 0, y: 50 }} 
            animate={{ scale: isLinking ? 1.05 : 1, opacity: isLinking ? 0 : 1, y: isLinking ? -100 : 0, x: 0, rotate: 0 }} 
            exit={{ scale: 0.9, opacity: 0, x: -200, rotate: -10 }} 
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            drag={!isLinking ? "x" : false} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.7}
            onDragEnd={(e, { offset, velocity }) => { if (offset.x < -50 || velocity.x < -500) next(); }}
            className={cn("w-full rounded-[3rem] p-10 shadow-2xl flex flex-col min-h-[550px] relative overflow-hidden", isLinking ? "bg-emerald-50 border-4 border-emerald-400" : "bg-white cursor-grab active:cursor-grabbing")}
          >
            {isLinking && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.2 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-emerald-400 z-0 pointer-events-none" />
            )}

            <div className="text-center mb-8 pointer-events-none relative z-10">
              <span className={cn("text-[11px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest mb-5 inline-flex items-center gap-1", Num.parse(currentItem.amount) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                {isLinking && <Zap className="w-3 h-3 animate-pulse" />}
                {Num.parse(currentItem.amount) > 0 ? 'Ingreso en Banco' : 'Cargo en Banco'}
              </span>
              <h2 className="text-3xl font-black text-slate-800 leading-tight mb-3 line-clamp-2 tracking-tighter">{currentItem.desc}</h2>
              <p id={`bank-amount-${currentItem.id}`} className="text-6xl font-black text-slate-900 tracking-tighter inline-block relative">
                {Num.fmt(currentItem.amount)}
              </p>
              <p className="text-[11px] text-slate-400 font-bold mt-4 uppercase tracking-widest bg-slate-50 inline-block px-4 py-1.5 rounded-full">Fecha: {currentItem.date}</p>
            </div>

            <div className="flex-1 overflow-visible relative z-10">
              {matches.length > 0 ? (
                <div className="space-y-4 relative">
                  <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4 text-center">Coincidencias (Tap para enlazar)</p>
                  {matches.map((m: any, idx: number) => {
                    const matchIdStr = `match-card-${m.id}`;
                    const isHovered = hoveredMatch === m.id;
                    
                    return (
                      <div key={idx} className="relative">
                        <EnergyBeam sourceId={`bank-amount-${currentItem.id}`} targetId={matchIdStr} isActive={isHovered} />
                        <motion.div 
                          id={matchIdStr}
                          onHoverStart={() => !isLinking && setHoveredMatch(m.id)}
                          onHoverEnd={() => !isLinking && setHoveredMatch(null)}
                          whileHover={!isLinking ? { scale: 1.03, y: -2 } : {}} 
                          whileTap={!isLinking ? { scale: 0.98 } : {}}
                          onClick={() => handleLinkLocal(m.type, m.id, m.comision || 0)}
                          className={cn("flex justify-between items-center p-5 rounded-[2rem] border-2 cursor-pointer transition-all shadow-sm relative z-20 bg-white",
                            isHovered ? "border-emerald-400 shadow-emerald-200/50 shadow-lg" : "border-slate-200 hover:border-indigo-300"
                          )}
                        >
                          <div className="text-left">
                            <span className={cn("text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded",
                              m.color === 'emerald' ? "bg-emerald-50 text-emerald-700" : m.color === 'teal' ? "bg-teal-50 text-teal-700" :
                              m.color === 'amber' ? "bg-amber-50 text-amber-700" : m.color === 'indigo' ? "bg-indigo-50 text-indigo-700" : "bg-rose-50 text-rose-700"
                            )}>{m.type}</span>
                            <p className="text-sm font-black text-slate-800 mt-2">{m.title}</p>
                          </div>
                          <div className="text-right">
                            <p className={cn("font-black text-lg", isHovered ? "text-emerald-600" : "text-slate-800")}>{Num.fmt(m.amount)}</p>
                          </div>
                        </motion.div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-40 py-10 pointer-events-none">
                  <Search className="w-14 h-14 mb-4" />
                  <p className="text-xs font-black uppercase tracking-widest">Sin coincidencias</p>
                  <p className="text-[11px] font-bold mt-2">Sáltalo deslizando</p>
                </div>
              )}
            </div>

            <div className="flex gap-4 mt-auto pt-6 relative z-10">
              <button disabled={isLinking} onClick={next} className="flex-1 bg-slate-100 text-slate-500 py-6 rounded-[2.5rem] font-black text-xs uppercase tracking-widest hover:bg-slate-200 hover:text-slate-800 transition flex items-center justify-center gap-2 disabled:opacity-50">
                <ArrowDownLeft className="w-5 h-5 rotate-45" /> SALTAR MOVIMIENTO
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 w-full px-8">
          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${progressPercent}%` }} className="h-full bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]" />
          </div>
        </div>
      </div>
    </div>
  );
};
