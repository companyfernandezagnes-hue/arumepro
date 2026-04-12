/**
 * DailyBriefing.tsx
 * Widget "Resumen del Día" para el Dashboard de Arume PRO.
 * Muestra: pagos que vencen hoy/esta semana, facturas sin procesar,
 * stock crítico, días sin cierre de caja, y alertas IVA trimestral.
 */
import React, { useMemo, useState, useEffect } from 'react';
import {
  Bell, CheckCircle2, AlertTriangle, Clock, Wallet,
  Package, FileText, ChevronDown, ChevronUp, Zap,
  Calendar, TrendingDown, ShieldAlert, X, Send
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData } from '../types';
// NotificationService eliminado — ahora usa Telegram API directa

// ── Tipos ──────────────────────────────────────────────────────────────────
type Severity = 'critical' | 'warning' | 'info' | 'ok';

interface Alert {
  id       : string;
  severity : Severity;
  icon     : React.ElementType;
  title    : string;
  detail   : string;
  action  ?: string;
  tab     ?: string;
}

const SEV_STYLES: Record<Severity, { bg: string; border: string; text: string; dot: string }> = {
  critical: { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    dot: 'bg-rose-500'    },
  warning : { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
  info    : { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700',    dot: 'bg-blue-400'    },
  ok      : { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
};

// ── Helper: días entre dos fechas ──────────────────────────────────────────
const daysBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86_400_000);

// ── Helper: ¿vence este gasto fijo en los próximos N días? ────────────────
const dueInDays = (g: any, today: Date, horizon = 5): number | null => {
  if (!g || g.active === false) return null;
  const day = Number(g.dia_pago) || 1;
  const candidate = new Date(today.getFullYear(), today.getMonth(), day);
  if (candidate < today) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  const diff = daysBetween(today, candidate);
  return diff <= horizon ? diff : null;
};

// ── Trimestre IVA ──────────────────────────────────────────────────────────
const nextIVADeadline = (today: Date): { label: string; days: number } | null => {
  const deadlines = [
    new Date(today.getFullYear(), 0, 20),
    new Date(today.getFullYear(), 3, 20),
    new Date(today.getFullYear(), 6, 20),
    new Date(today.getFullYear(), 9, 20),
    new Date(today.getFullYear() + 1, 0, 20),
  ];
  const next = deadlines.find(d => d >= today);
  if (!next) return null;
  const days = daysBetween(today, next);
  if (days > 30) return null;
  const labels = ['Ene', 'Abr', 'Jul', 'Oct', 'Ene'];
  const idx = deadlines.indexOf(next);
  const label = `Modelo 303 T${Math.floor(next.getMonth() / 3) + 1} (${labels[idx]})`;
  return { label, days };
};

// ══════════════════════════════════════════════════════════════════════════════
export const DailyBriefing: React.FC<{ data: AppData; onNavigate?: (tab: string) => void }> = ({
  data,
  onNavigate,
}) => {
  const [expanded,  setExpanded]  = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ── Calcular alertas ──────────────────────────────────────────────────────
  const alerts = useMemo((): Alert[] => {
    const list: Alert[] = [];
    const safe = data || {};

    // ── 1. PAGOS QUE VENCEN HOY O EN LOS PRÓXIMOS 5 DÍAS ─────────────────
    const gastosFijos    = Array.isArray(safe.gastos_fijos) ? safe.gastos_fijos : [];
    const controlPagos   = (safe as any).control_pagos || {};
    const monthKey       = `pagos_${today.getFullYear()}_${today.getMonth() + 1}`;
    const pagadosEsteMes = (controlPagos as any)[monthKey] || [];

    const proximosPagos = gastosFijos.filter((g: any) => {
      if (g.active === false) return false;
      if (pagadosEsteMes.includes(g.id)) return false;
      if (g.type === 'income' || g.type === 'grant') return false;
      const freq = String(g.freq || 'mensual').toLowerCase();
      if (freq === 'once' || freq === 'anual' || freq === 'semestral') return false;
      return dueInDays(g, today, 5) !== null;
    });

    if (proximosPagos.length > 0) {
      const total    = proximosPagos.reduce((s: number, g: any) => s + Num.parse(g.amount || 0), 0);
      const hoyMismo = proximosPagos.filter((g: any) => dueInDays(g, today, 0) === 0);
      list.push({
        id      : 'pagos-proximos',
        severity: hoyMismo.length > 0 ? 'critical' : 'warning',
        icon    : Clock,
        title   : hoyMismo.length > 0
          ? `${hoyMismo.length} pago${hoyMismo.length > 1 ? 's' : ''} vence${hoyMismo.length > 1 ? 'n' : ''} HOY`
          : `${proximosPagos.length} pago${proximosPagos.length > 1 ? 's' : ''} en los próximos 5 días`,
        detail  : `Total: ${Num.fmt(total)} — ${proximosPagos.slice(0, 2).map((g: any) => g.name || g.concepto || '?').join(', ')}${proximosPagos.length > 2 ? '...' : ''}`,
        action  : 'Ver Gastos Fijos',
        tab     : 'fixed',
      });
    }

    // ── 2. DÍAS SIN CIERRE DE CAJA ────────────────────────────────────────
    const cierres = Array.isArray(safe.cierres) ? safe.cierres : [];
    let diasSinCierre = 0;
    for (let i = 1; i <= 7; i++) {
      const check = new Date(today);
      check.setDate(today.getDate() - i);
      const iso = `${check.getFullYear()}-${String(check.getMonth() + 1).padStart(2, '0')}-${String(check.getDate()).padStart(2, '0')}`;
      const hasCierre = cierres.some((c: any) => c.date === iso);
      if (!hasCierre) diasSinCierre++;
      else break;
    }
    if (diasSinCierre >= 1) {
      list.push({
        id      : 'dias-sin-cierre',
        severity: diasSinCierre >= 3 ? 'critical' : 'warning',
        icon    : Calendar,
        title   : diasSinCierre === 1
          ? 'Ayer no hay cierre de caja'
          : `${diasSinCierre} días consecutivos sin cierre`,
        detail  : 'Abre la Caja Diaria y registra los cierres pendientes',
        action  : 'Ir a Caja',
        tab     : 'diario',
      });
    }

    // ── 3. FACTURAS / COBROS B2B VENCIDOS ────────────────────────────────
    const cobrosB2B = Array.isArray((safe as any).cobros_b2b) ? (safe as any).cobros_b2b : [];
    const hoyISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const cobrosVencidos = cobrosB2B.filter((c: any) => !c.paid && c.vencimiento && c.vencimiento <= hoyISO);
    if (cobrosVencidos.length > 0) {
      const totalCobrar = cobrosVencidos.reduce((s: number, c: any) => s + (c.total || 0), 0);
      list.push({
        id      : 'cobros-vencidos',
        severity: 'critical',
        icon    : Wallet,
        title   : `${cobrosVencidos.length} cobro${cobrosVencidos.length > 1 ? 's' : ''} B2B vencido${cobrosVencidos.length > 1 ? 's' : ''}`,
        detail  : `${Num.fmt(totalCobrar)} pendientes de cobrar`,
        action  : 'Ver Tesorería',
        tab     : 'tesoreria',
      });
    }

    // ── 4. ALBARANES VENCIDOS SIN PAGAR ──────────────────────────────────
    const albaranes = Array.isArray(safe.albaranes) ? safe.albaranes : [];
    const albsVencidos = albaranes.filter((a: any) => {
      if (a.paid) return false;
      const due = (a as any).dueDate || '';
      return due && due <= hoyISO;
    });
    if (albsVencidos.length > 0) {
      const totalPagar = albsVencidos.reduce((s: number, a: any) => s + Num.parse(a.total || 0), 0);
      list.push({
        id      : 'albs-vencidos',
        severity: 'warning',
        icon    : TrendingDown,
        title   : `${albsVencidos.length} albarán${albsVencidos.length > 1 ? 'es' : ''} vencido${albsVencidos.length > 1 ? 's' : ''}`,
        detail  : `${Num.fmt(totalPagar)} por pagar a proveedores`,
        action  : 'Ver Tesorería',
        tab     : 'tesoreria',
      });
    }

    // ── 5. STOCK CRÍTICO ──────────────────────────────────────────────────
    const ingredientes = Array.isArray(safe.ingredientes) ? safe.ingredientes : [];
    const stockCritico = ingredientes.filter((i: any) =>
      Num.parse(i?.stock ?? i?.stockActual ?? 0) <= Num.parse(i?.min ?? i?.stockMinimo ?? 0)
    );
    if (stockCritico.length > 0) {
      list.push({
        id      : 'stock-critico',
        severity: stockCritico.length >= 5 ? 'critical' : 'warning',
        icon    : Package,
        title   : `${stockCritico.length} producto${stockCritico.length > 1 ? 's' : ''} en stock mínimo`,
        detail  : stockCritico.slice(0, 3).map((i: any) => i.n || i.nombre || '?').join(', ') + (stockCritico.length > 3 ? '...' : ''),
        action  : 'Ver Stock',
        tab     : 'stock',
      });
    }

    // ── 6. IVA TRIMESTRAL ─────────────────────────────────────────────────
    const ivaAlert = nextIVADeadline(today);
    if (ivaAlert) {
      list.push({
        id      : 'iva-trimestral',
        severity: ivaAlert.days <= 7 ? 'critical' : 'warning',
        icon    : ShieldAlert,
        title   : `${ivaAlert.label} — vence en ${ivaAlert.days} día${ivaAlert.days !== 1 ? 's' : ''}`,
        detail  : 'Prepara el resumen de IVA soportado y repercutido para tu gestoría',
        action  : 'Ver Informes',
        tab     : 'informes',
      });
    }

    // ── 7. MOVIMIENTOS BANCARIOS SIN CONCILIAR ────────────────────────────
    const banco        = Array.isArray((safe as any).banco) ? (safe as any).banco : [];
    const sinConciliar = banco.filter((b: any) => b.status === 'pending' || b.status === 'unmatched');
    if (sinConciliar.length >= 10) {
      list.push({
        id      : 'banco-pendiente',
        severity: 'info',
        icon    : Zap,
        title   : `${sinConciliar.length} movimientos bancarios sin conciliar`,
        detail  : 'Usa el modo automático del Banco para asignarlos en segundos',
        action  : 'Ir al Banco',
        tab     : 'banco',
      });
    }

    // ── 8. FACTURAS DE COMPRA VENCIDAS (no pagadas con fecha vencimiento pasada)
    const facturas = Array.isArray(safe.facturas) ? safe.facturas : [];
    const facturasVencidas = facturas.filter((f: any) =>
      f.tipo === 'compra' && !f.paid && f.dueDate && f.dueDate <= hoyISO
    );
    if (facturasVencidas.length > 0) {
      const totalPagar = facturasVencidas.reduce((s: number, f: any) => s + Num.parse(f.total || 0), 0);
      list.push({
        id      : 'facturas-vencidas',
        severity: 'critical',
        icon    : FileText,
        title   : `${facturasVencidas.length} factura${facturasVencidas.length > 1 ? 's' : ''} de compra vencida${facturasVencidas.length > 1 ? 's' : ''}`,
        detail  : `${Num.fmt(totalPagar)} pendientes — ${facturasVencidas.slice(0, 2).map((f: any) => f.prov || 'Prov.').join(', ')}${facturasVencidas.length > 2 ? '...' : ''}`,
        action  : 'Ver Compras',
        tab     : 'compras',
      });
    }

    // ── 9. FACTURAS SIN PAGAR > 30 DÍAS (riesgo de morosidad) ────────────
    const hace30d = new Date(today);
    hace30d.setDate(hace30d.getDate() - 30);
    const hace30ISO = `${hace30d.getFullYear()}-${String(hace30d.getMonth() + 1).padStart(2, '0')}-${String(hace30d.getDate()).padStart(2, '0')}`;
    const morosas = facturas.filter((f: any) =>
      f.tipo === 'compra' && !f.paid && f.date && f.date <= hace30ISO
    );
    if (morosas.length > 0 && facturasVencidas.length === 0) {
      list.push({
        id      : 'facturas-morosas',
        severity: 'warning',
        icon    : ShieldAlert,
        title   : `${morosas.length} factura${morosas.length > 1 ? 's' : ''} sin pagar > 30 días`,
        detail  : 'Revisa si están pendientes de pago o simplemente no marcadas como pagadas',
        action  : 'Ver Compras',
        tab     : 'compras',
      });
    }

    // ── 10. PRESUPUESTOS PRÓXIMOS A CADUCAR ──────────────────────────────
    const presupuestos = Array.isArray((safe as any).presupuestos) ? (safe as any).presupuestos : [];
    const presupACaducar = presupuestos.filter((p: any) => {
      if (p.estado !== 'enviado' && p.estado !== 'borrador') return false;
      const validez = Number(p.validezDias) || 30;
      const fechaLimite = new Date(p.fecha || p.creadoEn || '');
      fechaLimite.setDate(fechaLimite.getDate() + validez);
      const diasRestantes = daysBetween(today, fechaLimite);
      return diasRestantes >= 0 && diasRestantes <= 5;
    });
    if (presupACaducar.length > 0) {
      list.push({
        id      : 'presup-caducar',
        severity: 'warning',
        icon    : FileText,
        title   : `${presupACaducar.length} presupuesto${presupACaducar.length > 1 ? 's' : ''} a punto de caducar`,
        detail  : presupACaducar.slice(0, 2).map((p: any) => p.cliente || p.num || '?').join(', '),
        action  : 'Ver Presupuestos',
        tab     : 'presupuestos',
      });
    }

    // ── TODO OK ───────────────────────────────────────────────────────────
    if (list.length === 0) {
      list.push({
        id      : 'todo-ok',
        severity: 'ok',
        icon    : CheckCircle2,
        title   : '¡Todo al día!',
        detail  : 'Sin alertas pendientes. Buen trabajo.',
      });
    }

    return list;
  }, [data, today]);

  // ── Enviar briefing a Telegram automáticamente (1x/día) ──────────────
  const [telegramSent, setTelegramSent] = useState(false);
  useEffect(() => {
    if (telegramSent) return;
    if (alerts.length === 0) return;
    if (alerts.length === 1 && alerts[0].id === 'todo-ok') return;
    // Solo enviar 1 vez al día
    const todayKey = `briefing_sent_${today.toISOString().slice(0, 10)}`;
    if (sessionStorage.getItem(todayKey)) return;
    // Solo enviar si hay Telegram configurado (directo, sin n8n)
    const token = data?.config?.telegramToken;
    const chatId = data?.config?.telegramChatId;
    if (!token || !chatId) return;

    const critCount = alerts.filter(a => a.severity === 'critical').length;
    const warnCount = alerts.filter(a => a.severity === 'warning').length;
    const emoji = critCount > 0 ? '🔴' : warnCount > 0 ? '🟡' : '🟢';

    const msg = `${emoji} *BRIEFING DIARIO — ${today.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' })}*\n\n` +
      alerts
        .filter(a => a.id !== 'todo-ok')
        .map(a => {
          const sev = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '⚠️' : 'ℹ️';
          return `${sev} *${a.title}*\n   ${a.detail}`;
        })
        .join('\n\n') +
      '\n\n_Abre la app para más detalles._';

    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
    })
      .then(() => sessionStorage.setItem(todayKey, '1'))
      .catch(() => {});
    setTelegramSent(true);
  }, [alerts, data, today, telegramSent]);

  const visible   = alerts.filter(a => !dismissed.has(a.id));
  const criticals = visible.filter(a => a.severity === 'critical').length;
  const warnings  = visible.filter(a => a.severity === 'warning').length;

  if (visible.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">

      {/* ── CABECERA ─────────────────────────────────────────────────────── */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            'p-1.5 rounded-lg',
            criticals > 0 ? 'bg-rose-100' : warnings > 0 ? 'bg-amber-100' : 'bg-emerald-100'
          )}>
            <Bell className={cn(
              'w-4 h-4',
              criticals > 0 ? 'text-rose-600' : warnings > 0 ? 'text-amber-600' : 'text-emerald-600'
            )}/>
          </div>
          <div className="text-left">
            <p className="text-xs font-black text-slate-800 uppercase tracking-widest">
              Resumen del Día
            </p>
            <p className="text-[10px] font-bold text-slate-400">
              {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          {(criticals > 0 || warnings > 0) && (
            <div className="flex gap-1.5 ml-2">
              {criticals > 0 && (
                <span className="text-[9px] font-black bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full uppercase tracking-widest">
                  {criticals} urgente{criticals > 1 ? 's' : ''}
                </span>
              )}
              {warnings > 0 && (
                <span className="text-[9px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-widest">
                  {warnings} aviso{warnings > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-slate-400"/>
          : <ChevronDown className="w-4 h-4 text-slate-400"/>
        }
      </button>

      {/* ── ALERTAS ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={cn(
              'grid gap-2 px-4 pb-4',
              visible.length === 1 ? 'grid-cols-1' :
              visible.length === 2 ? 'grid-cols-1 sm:grid-cols-2' :
              'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
            )}>
              {visible.map(alert => {
                const s = SEV_STYLES[alert.severity];
                return (
                  <motion.div
                    key={alert.id}
                    layout
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={cn(
                      'relative flex items-start gap-3 p-3 rounded-lg border',
                      s.bg, s.border
                    )}
                  >
                    {/* Icono */}
                    <div className={cn('p-1.5 rounded-md shrink-0', s.bg)}>
                      <alert.icon className={cn('w-4 h-4', s.text)}/>
                    </div>

                    {/* Contenido */}
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-[11px] font-black leading-tight', s.text)}>
                        {alert.title}
                      </p>
                      <p className="text-[10px] font-medium text-slate-500 mt-0.5 leading-snug">
                        {alert.detail}
                      </p>

                      {/* 🔑 BOTÓN DE ACCIÓN — ahora con onClick conectado a onNavigate */}
                      {alert.action && alert.tab && (
                        <button
                          onClick={() => onNavigate?.(alert.tab!)}
                          className={cn(
                            'mt-1.5 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded transition-colors',
                            alert.severity === 'critical'
                              ? 'bg-rose-600 text-white hover:bg-rose-700'
                              : alert.severity === 'warning'
                              ? 'bg-amber-500 text-white hover:bg-amber-600'
                              : 'bg-blue-500 text-white hover:bg-blue-600'
                          )}
                        >
                          {alert.action} →
                        </button>
                      )}
                    </div>

                    {/* Dismiss */}
                    {alert.severity !== 'ok' && (
                      <button
                        onClick={() => setDismissed(d => new Set(d).add(alert.id))}
                        className="shrink-0 p-0.5 text-slate-300 hover:text-slate-500 transition-colors"
                      >
                        <X className="w-3 h-3"/>
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
