// ==========================================
// 🤖 arumeAgent.ts — Motor de Automatizaciones Nativo
// Ejecuta flujos directamente desde la app
// ==========================================

import { AppData, BankMovement, Ingrediente, KardexEntry } from '../types';
import { Num, DateUtil } from './engine';
import { PushService } from './pushNotifications';
import { GmailDirectSync } from './gmailDirectSync';

// ── Tipos ───────────────────────────────────────────────────────────────────

export type FlowStatus = 'idle' | 'running' | 'success' | 'error' | 'disabled';

export interface FlowRun {
  id: string;
  flowId: string;
  startedAt: number;
  finishedAt?: number;
  status: 'success' | 'error';
  message: string;
  details?: string;
}

export interface FlowDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'alertas' | 'sync' | 'fiscal' | 'operaciones';
  enabled: boolean;
  schedule: 'manual' | '5min' | '15min' | '30min' | '1h' | '6h' | 'daily';
  lastRun?: number;
  lastStatus?: FlowStatus;
  lastMessage?: string;
  /** Para flujos que necesitan config extra */
  config?: Record<string, any>;
}

export interface AgentState {
  flows: FlowDef[];
  history: FlowRun[];
  globalEnabled: boolean;
}

// ── Defaults ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'arume_agent_state';
const MAX_HISTORY = 200;

const DEFAULT_FLOWS: FlowDef[] = [
  // ── Alertas ──
  {
    id: 'stock_bajo',
    name: 'Alerta Stock Bajo',
    description: 'Detecta ingredientes bajo mínimos y envía notificación push + Telegram',
    icon: '📦',
    category: 'alertas',
    enabled: true,
    schedule: '1h',
  },
  {
    id: 'pagos_proximos',
    name: 'Pagos Próximos',
    description: 'Avisa de gastos fijos que vencen en los próximos 3 días',
    icon: '💳',
    category: 'alertas',
    enabled: true,
    schedule: '6h',
  },
  {
    id: 'cierre_pendiente',
    name: 'Cierre de Caja Pendiente',
    description: 'Recuerda hacer el cierre si son >17h y no hay cierre de hoy',
    icon: '🔐',
    category: 'alertas',
    enabled: true,
    schedule: '1h',
  },
  {
    id: 'saldo_bajo',
    name: 'Saldo Bancario Bajo',
    description: 'Alerta si el saldo bancario baja de 3.000€',
    icon: '🏦',
    category: 'alertas',
    enabled: true,
    schedule: '6h',
  },
  {
    id: 'descuadre_caja',
    name: 'Descuadre de Caja',
    description: 'Detecta descuadres >5€ en cierres y notifica',
    icon: '⚠️',
    category: 'alertas',
    enabled: true,
    schedule: '30min',
  },
  // ── Sync ──
  {
    id: 'telegram_directo',
    name: 'Telegram Directo',
    description: 'Envía alertas a Telegram via API directa del bot',
    icon: '✈️',
    category: 'sync',
    enabled: true,
    schedule: 'manual',
  },
  {
    id: 'shopify_sync',
    name: 'Shopify Sync',
    description: 'Sincroniza productos y pedidos con Shopify (requiere config en Tienda)',
    icon: '🛒',
    category: 'sync',
    enabled: false,  // Desactivado hasta que se configure
    schedule: '30min',
    config: { storeDomain: '', accessToken: '' },
  },
  {
    id: 'gmail_sync',
    name: 'Gmail → Facturas',
    description: 'Lee PDFs de factura nuevos de Gmail y los mete en la bandeja de auditoría (Gmail API directa)',
    icon: '📧',
    category: 'sync',
    enabled: true,
    schedule: '15min',
  },
  {
    id: 'backup_auto',
    name: 'Backup Automático',
    description: 'Guarda snapshot de datos en localStorage como red de seguridad',
    icon: '💾',
    category: 'sync',
    enabled: true,
    schedule: '1h',
  },
  // ── Sync banco ──
  {
    id: 'recordatorio_extracto',
    name: 'Recordatorio Extracto',
    description: 'Avisa si llevas más de 3 días sin importar extracto bancario',
    icon: '🏦',
    category: 'sync',
    enabled: true,
    schedule: 'daily',
  },
  // ── Fiscal ──
  {
    id: 'recordatorio_fiscal',
    name: 'Recordatorio Fiscal',
    description: 'Avisa de obligaciones trimestrales AEAT (303, 111, 202)',
    icon: '📋',
    category: 'fiscal',
    enabled: true,
    schedule: 'daily',
  },
  {
    id: 'control_iva',
    name: 'Control IVA Mensual',
    description: 'Calcula IVA soportado vs repercutido del mes y alerta diferencias',
    icon: '🧾',
    category: 'fiscal',
    enabled: true,
    schedule: 'daily',
  },
  // ── Operaciones ──
  {
    id: 'precios_anomalos',
    name: 'Detector Precios Anómalos',
    description: 'Compara precios de últimos albaranes y detecta subidas >15%',
    icon: '📈',
    category: 'operaciones',
    enabled: true,
    schedule: '6h',
  },
  {
    id: 'albaranes_sin_factura',
    name: 'Albaranes sin Facturar',
    description: 'Detecta albaranes de >30 días sin factura asociada',
    icon: '📄',
    category: 'operaciones',
    enabled: true,
    schedule: 'daily',
  },
  {
    id: 'resumen_diario',
    name: 'Briefing Matutino (9h)',
    description: 'Cada mañana a las 9h: ventas de ayer, saldo, facturas por pagar, stock, precios anómalos',
    icon: '☀️',
    category: 'operaciones',
    enabled: true,
    schedule: 'daily',
  },
];

// ── Schedules en ms ─────────────────────────────────────────────────────────

const SCHEDULE_MS: Record<string, number> = {
  '5min': 5 * 60_000,
  '15min': 15 * 60_000,
  '30min': 30 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  'daily': 24 * 60 * 60_000,
};

// ── Service Principal ──────────────────────────────────────────────────────

export class ArumeAgent {

  // ── Estado ──

  static getState(): AgentState {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge con defaults para nuevos flows
        const existingIds = new Set((parsed.flows || []).map((f: FlowDef) => f.id));
        const merged = [
          ...(parsed.flows || []),
          ...DEFAULT_FLOWS.filter(d => !existingIds.has(d.id)),
        ];
        return { ...parsed, flows: merged };
      }
    } catch { /* ignore */ }
    return { flows: [...DEFAULT_FLOWS], history: [], globalEnabled: true };
  }

  static saveState(state: AgentState): void {
    // Trim history
    if (state.history.length > MAX_HISTORY) {
      state.history = state.history.slice(0, MAX_HISTORY);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  static updateFlow(flowId: string, updates: Partial<FlowDef>): void {
    const state = ArumeAgent.getState();
    const idx = state.flows.findIndex(f => f.id === flowId);
    if (idx >= 0) {
      state.flows[idx] = { ...state.flows[idx], ...updates };
      ArumeAgent.saveState(state);
    }
  }

  static toggleFlow(flowId: string): void {
    const state = ArumeAgent.getState();
    const flow = state.flows.find(f => f.id === flowId);
    if (flow) {
      flow.enabled = !flow.enabled;
      ArumeAgent.saveState(state);
    }
  }

  static toggleGlobal(): void {
    const state = ArumeAgent.getState();
    state.globalEnabled = !state.globalEnabled;
    ArumeAgent.saveState(state);
  }

  static clearHistory(): void {
    const state = ArumeAgent.getState();
    state.history = [];
    ArumeAgent.saveState(state);
  }

  // ── Log run ──

  private static logRun(flowId: string, status: 'success' | 'error', message: string, details?: string): void {
    const state = ArumeAgent.getState();
    const run: FlowRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      flowId,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      status,
      message,
      details,
    };
    state.history.unshift(run);

    // Update flow status
    const flow = state.flows.find(f => f.id === flowId);
    if (flow) {
      flow.lastRun = Date.now();
      flow.lastStatus = status;
      flow.lastMessage = message;
    }

    ArumeAgent.saveState(state);
  }

  // ── Motor principal: ejecutar todos los flows pendientes ──

  static async runScheduled(data: AppData): Promise<number> {
    const state = ArumeAgent.getState();
    if (!state.globalEnabled) return 0;

    let executed = 0;
    const now = Date.now();

    for (const flow of state.flows) {
      if (!flow.enabled || flow.schedule === 'manual') continue;

      const interval = SCHEDULE_MS[flow.schedule] || 60 * 60_000;
      const lastRun = flow.lastRun || 0;

      if (now - lastRun < interval) continue;

      try {
        await ArumeAgent.executeFlow(flow.id, data);
        executed++;
      } catch (err) {
        console.warn(`[ArumeAgent] Error en flow ${flow.id}:`, err);
      }
    }

    return executed;
  }

  // ── Ejecutar un flow específico ──

  static async executeFlow(flowId: string, data: AppData): Promise<FlowRun | null> {
    const state = ArumeAgent.getState();
    const flow = state.flows.find(f => f.id === flowId);
    if (!flow) return null;

    try {
      switch (flowId) {
        case 'stock_bajo':
          return await ArumeAgent._checkStockBajo(data);
        case 'pagos_proximos':
          return await ArumeAgent._checkPagosProximos(data);
        case 'cierre_pendiente':
          return await ArumeAgent._checkCierrePendiente(data);
        case 'saldo_bajo':
          return await ArumeAgent._checkSaldoBajo(data);
        case 'descuadre_caja':
          return await ArumeAgent._checkDescuadreCaja(data);
        case 'telegram_directo':
          return await ArumeAgent._testTelegram(data);
        case 'gmail_sync':
          return await ArumeAgent._syncGmail(data);
        case 'shopify_sync':
          return await ArumeAgent._syncShopify(data);
        case 'backup_auto':
          return await ArumeAgent._backupAuto(data);
        case 'recordatorio_extracto':
          return await ArumeAgent._checkExtracto(data);
        case 'recordatorio_fiscal':
          return await ArumeAgent._checkFiscal(data);
        case 'control_iva':
          return await ArumeAgent._checkIVA(data);
        case 'precios_anomalos':
          return await ArumeAgent._checkPrecios(data);
        case 'albaranes_sin_factura':
          return await ArumeAgent._checkAlbaranesSinFactura(data);
        case 'resumen_diario':
          return await ArumeAgent._resumenDiario(data);
        default:
          ArumeAgent.logRun(flowId, 'error', 'Flow no implementado');
          return null;
      }
    } catch (err: any) {
      const msg = err?.message || 'Error desconocido';
      ArumeAgent.logRun(flowId, 'error', msg);
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // IMPLEMENTACIONES DE FLUJOS
  // ══════════════════════════════════════════════════════════════════════════

  // ── 1. Stock Bajo ──

  private static async _checkStockBajo(data: AppData): Promise<FlowRun | null> {
    const critical = (data.ingredientes || []).filter(i => i.stock <= i.min);

    if (critical.length === 0) {
      ArumeAgent.logRun('stock_bajo', 'success', 'Todo OK — sin stock bajo');
      return null;
    }

    const detalle = critical.slice(0, 5).map(i => `${i.n}: ${i.stock} ${i.unit || 'uds'} (mín: ${i.min})`).join('\n');
    const msg = `🚨 ${critical.length} productos bajo mínimos`;

    // Push nativa
    await PushService.sendNative(msg, detalle, { type: 'warning', category: 'stock', tag: 'stock-bajo' });

    // Telegram directo
    await ArumeAgent._sendTelegram(data, `${msg}\n\n${detalle}`);

    ArumeAgent.logRun('stock_bajo', 'success', msg, detalle);
    return null;
  }

  // ── 2. Pagos Próximos ──

  private static async _checkPagosProximos(data: AppData): Promise<FlowRun | null> {
    const hoy = new Date();
    const mesKey = `pagos_${hoy.getFullYear()}_${hoy.getMonth() + 1}`;
    const pagados = (data.control_pagos || {})[mesKey] || [];
    const gastosFijos = (data.gastos_fijos || []).filter((g: any) => g.active !== false && g.type !== 'income' && g.type !== 'grant');

    const pendientes = gastosFijos.filter((g: any) => {
      if (pagados.includes(g.id)) return false;
      const diaPago = g.dia_pago || 1;
      // Usar aritmética de Date para manejar fin de mes correctamente
      const fechaPago = new Date(hoy.getFullYear(), hoy.getMonth(), diaPago);
      const en3Dias = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 3);
      return fechaPago >= hoy && fechaPago <= en3Dias;
    });

    if (pendientes.length === 0) {
      ArumeAgent.logRun('pagos_proximos', 'success', 'Sin pagos pendientes próximos');
      return null;
    }

    const total = pendientes.reduce((s: number, g: any) => s + Math.abs(Num.parse(g.amount || g.importe || 0)), 0);
    const msg = `💳 ${pendientes.length} pagos en próximos 3 días: ${Num.fmt(total)}`;
    const detalle = pendientes.map((g: any) => `- ${g.name || g.concepto}: ${Num.fmt(Math.abs(Num.parse(g.amount || g.importe || 0)))} (día ${g.dia_pago})`).join('\n');

    await PushService.sendNative(msg, detalle, { type: 'warning', category: 'pagos', tag: 'pagos-proximos' });
    await ArumeAgent._sendTelegram(data, `${msg}\n\n${detalle}`);

    ArumeAgent.logRun('pagos_proximos', 'success', msg, detalle);
    return null;
  }

  // ── 3. Cierre Pendiente ──

  private static async _checkCierrePendiente(data: AppData): Promise<FlowRun | null> {
    const hora = new Date().getHours();
    if (hora < 17) {
      ArumeAgent.logRun('cierre_pendiente', 'success', 'Antes de las 17h — sin verificar');
      return null;
    }

    const hoy = new Date().toISOString().split('T')[0];
    const cierreHoy = (data.cierres || []).find(c => c.date === hoy);

    if (cierreHoy) {
      ArumeAgent.logRun('cierre_pendiente', 'success', `Cierre de ${hoy} ya registrado ✓`);
      return null;
    }

    const msg = `🔐 Cierre de caja pendiente (${hoy})`;
    await PushService.sendNative(msg, 'Recuerda hacer el cierre antes de cerrar', { type: 'info', category: 'cierre', tag: 'cierre-diario' });
    await ArumeAgent._sendTelegram(data, msg);

    ArumeAgent.logRun('cierre_pendiente', 'success', msg);
    return null;
  }

  // ── 4. Saldo Bajo ──

  private static async _checkSaldoBajo(data: AppData): Promise<FlowRun | null> {
    const saldoInicial = (data.config as any)?.saldoInicial || 0;
    const saldo = (data.banco || []).reduce((s, m: any) => s + Num.parse(m.amount), saldoInicial);

    if (saldo >= 3000) {
      ArumeAgent.logRun('saldo_bajo', 'success', `Saldo OK: ${Num.fmt(saldo)}`);
      return null;
    }

    const msg = `🏦 Saldo bancario bajo: ${Num.fmt(saldo)}`;
    await PushService.sendNative(msg, 'Revisa la tesorería', { type: 'critical', category: 'tesoreria', tag: 'saldo-bajo' });
    await ArumeAgent._sendTelegram(data, msg);

    ArumeAgent.logRun('saldo_bajo', 'success', msg);
    return null;
  }

  // ── 5. Descuadre Caja ──

  private static async _checkDescuadreCaja(data: AppData): Promise<FlowRun | null> {
    const hoy = new Date().toISOString().split('T')[0];
    const cierreHoy = (data.cierres || []).find(c => c.date === hoy);

    if (!cierreHoy || !cierreHoy.descuadre || Math.abs(cierreHoy.descuadre) <= 5) {
      ArumeAgent.logRun('descuadre_caja', 'success', 'Sin descuadres significativos');
      return null;
    }

    const icon = cierreHoy.descuadre > 0 ? '🟢' : '🔴';
    const msg = `${icon} Descuadre de caja: ${cierreHoy.descuadre > 0 ? '+' : ''}${Num.fmt(cierreHoy.descuadre)}`;
    await PushService.sendNative(msg, `Cierre del ${hoy}`, { type: 'warning', category: 'caja', tag: 'descuadre' });
    await ArumeAgent._sendTelegram(data, msg);

    ArumeAgent.logRun('descuadre_caja', 'success', msg);
    return null;
  }

  // ── 6. Telegram Directo (API Bot) ──

  private static async _sendTelegram(data: AppData, text: string): Promise<boolean> {
    const token = data.config?.telegramToken;
    const chatId = data.config?.telegramChatId;
    if (!token || !chatId) return false;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🍶 *Arume PRO*\n\n${text}`,
          parse_mode: 'Markdown',
          disable_notification: false,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('[ArumeAgent] Telegram error:', err);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[ArumeAgent] Telegram fetch error:', err);
      return false;
    }
  }

  private static async _testTelegram(data: AppData): Promise<FlowRun | null> {
    const ok = await ArumeAgent._sendTelegram(data, '✅ Test: conexión directa funcionando');
    if (ok) {
      ArumeAgent.logRun('telegram_directo', 'success', 'Mensaje de test enviado ✓');
    } else {
      ArumeAgent.logRun('telegram_directo', 'error', 'No se pudo enviar — verifica token y chatId');
    }
    return null;
  }

  // ── 6b. Gmail → Facturas (sync directo via Gmail API) ──

  private static async _syncGmail(data: AppData): Promise<FlowRun | null> {
    if (!GmailDirectSync.isAuthenticated()) {
      ArumeAgent.logRun('gmail_sync', 'error', 'Gmail no autorizado — pulsa "Conectar Gmail" en el panel del Agente');
      return null;
    }

    try {
      const result = await GmailDirectSync.fetchNewEmails(15);

      if (result.error) {
        ArumeAgent.logRun('gmail_sync', 'error', result.error);
        return null;
      }

      if (result.total === 0) {
        ArumeAgent.logRun('gmail_sync', 'success', 'Sin emails nuevos con PDFs');
        return null;
      }

      // Convertir a formato EmailDraft compatible con InvoicesView
      const drafts = GmailDirectSync.toEmailDrafts(result.emails);

      // Guardar en localStorage para que InvoicesView los recoja
      const existing = JSON.parse(localStorage.getItem('arume_gmail_inbox') || '[]');
      const existingIds = new Set(existing.map((e: any) => e.id));
      const nuevos = drafts.filter(d => !existingIds.has(d.id));

      if (nuevos.length > 0) {
        localStorage.setItem('arume_gmail_inbox', JSON.stringify([...nuevos, ...existing].slice(0, 100)));

        // Marcar como leídos en Gmail
        for (const msg of result.emails) {
          await GmailDirectSync.markAsRead(msg.id);
        }

        const msg = `📧 ${nuevos.length} PDFs nuevos descargados de Gmail`;
        await PushService.sendNative(msg, `De: ${result.emails.map(e => e.from.split('<')[0].trim()).join(', ')}`, {
          type: 'info', category: 'email', tag: 'gmail-sync',
        });
        await ArumeAgent._sendTelegram(data, msg);
        ArumeAgent.logRun('gmail_sync', 'success', msg, `Emails: ${result.emails.map(e => e.subject).join(', ')}`);
      } else {
        ArumeAgent.logRun('gmail_sync', 'success', `${result.total} emails revisados — ya procesados anteriormente`);
      }
    } catch (err: any) {
      ArumeAgent.logRun('gmail_sync', 'error', `Error: ${err?.message}`);
    }
    return null;
  }

  // ── 7. Shopify Sync (via Supabase Edge Function o directo) ──

  private static async _syncShopify(data: AppData): Promise<FlowRun | null> {
    const cfg = (data.config as any);
    const supaUrl = cfg?.supabasePersonalUrl || cfg?.supabaseInboxUrl;
    const supaKey = cfg?.supabasePersonalKey || cfg?.supabaseInboxKey;
    const shopDomain = cfg?.shopifyDomain;
    const shopToken = cfg?.shopifyAccessToken;

    if (!shopDomain || !shopToken) {
      ArumeAgent.logRun('shopify_sync', 'error', 'Shopify no configurado (falta dominio o token)');
      return null;
    }

    // Si tenemos Supabase, usamos Edge Function como proxy (evita CORS)
    if (supaUrl && supaKey) {
      try {
        const res = await fetch(`${supaUrl}/functions/v1/shopify-proxy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supaKey}`,
          },
          body: JSON.stringify({
            action: 'sync_products',
            storeDomain: shopDomain,
            accessToken: shopToken,
          }),
        });

        if (res.ok) {
          const result = await res.json();
          const count = result?.products?.length || 0;
          ArumeAgent.logRun('shopify_sync', 'success', `Sincronizados ${count} productos`);
        } else {
          ArumeAgent.logRun('shopify_sync', 'error', `Error HTTP ${res.status}`);
        }
      } catch (err: any) {
        ArumeAgent.logRun('shopify_sync', 'error', `Error: ${err?.message}`);
      }
    } else {
      ArumeAgent.logRun('shopify_sync', 'error', 'Necesitas Supabase Edge Function para evitar CORS con Shopify');
    }

    return null;
  }

  // ── 8. Backup Auto ──

  private static async _backupAuto(data: AppData): Promise<FlowRun | null> {
    try {
      const snapshot = {
        timestamp: Date.now(),
        date: new Date().toISOString(),
        stats: {
          albaranes: (data.albaranes || []).length,
          facturas: (data.facturas || []).length,
          cierres: (data.cierres || []).length,
          ingredientes: (data.ingredientes || []).length,
          banco: (data.banco || []).length,
        },
        // Guardar datos comprimidos (solo últimos 30 días para no saturar localStorage)
        recentCierres: (data.cierres || []).slice(-30),
        recentBanco: (data.banco || []).slice(-50),
      };

      localStorage.setItem('arume_agent_backup', JSON.stringify(snapshot));
      const size = JSON.stringify(snapshot).length;
      ArumeAgent.logRun('backup_auto', 'success', `Backup OK (${(size / 1024).toFixed(1)}KB)`);
    } catch (err: any) {
      ArumeAgent.logRun('backup_auto', 'error', `Error: ${err?.message}`);
    }
    return null;
  }

  // ── 8b. Recordatorio Extracto Bancario ──

  private static async _checkExtracto(data: AppData): Promise<FlowRun | null> {
    const banco = data.banco || [];
    if (banco.length === 0) {
      ArumeAgent.logRun('recordatorio_extracto', 'success', 'Sin datos bancarios aún');
      return null;
    }

    // Buscar la fecha del último movimiento
    const fechas = banco.map((b: any) => b.date).filter(Boolean).sort();
    const ultimaFecha = fechas[fechas.length - 1];
    if (!ultimaFecha) {
      ArumeAgent.logRun('recordatorio_extracto', 'success', 'Sin fechas en movimientos');
      return null;
    }

    const dias = Math.floor((Date.now() - new Date(ultimaFecha).getTime()) / 86400000);

    if (dias <= 3) {
      ArumeAgent.logRun('recordatorio_extracto', 'success', `Último mov: ${ultimaFecha} (hace ${dias}d) — OK`);
      return null;
    }

    const msg = `🏦 Llevas ${dias} días sin importar extracto bancario (último: ${ultimaFecha})`;
    await PushService.sendNative(msg, 'Entra en Banca March Online y exporta los movimientos', {
      type: 'warning', category: 'banco', tag: 'extracto-pendiente',
    });
    await ArumeAgent._sendTelegram(data, msg);
    ArumeAgent.logRun('recordatorio_extracto', 'success', msg);
    return null;
  }

  // ── 9. Recordatorio Fiscal ──

  private static async _checkFiscal(data: AppData): Promise<FlowRun | null> {
    const hoy = new Date();
    const mes = hoy.getMonth() + 1;
    const dia = hoy.getDate();

    const trimestres = [
      { mes: 1, label: 'T4 (Oct-Dic)', limite: 30 },
      { mes: 4, label: 'T1 (Ene-Mar)', limite: 20 },
      { mes: 7, label: 'T2 (Abr-Jun)', limite: 20 },
      { mes: 10, label: 'T3 (Jul-Sep)', limite: 20 },
    ];

    const trim = trimestres.find(t => t.mes === mes);
    if (!trim || dia > trim.limite) {
      ArumeAgent.logRun('recordatorio_fiscal', 'success', 'Sin obligaciones fiscales próximas');
      return null;
    }

    const diasRestantes = trim.limite - dia;
    const msg = `📋 Declaración trimestral ${trim.label} — ${diasRestantes} días para el límite (día ${trim.limite})`;
    const detalle = 'Modelos: IVA (303), IRPF (111), IS (202). Presentar en sede.agenciatributaria.gob.es';

    await PushService.sendNative(msg, detalle, { type: 'warning', category: 'fiscal', tag: 'fiscal-trimestral' });
    await ArumeAgent._sendTelegram(data, `${msg}\n${detalle}`);

    ArumeAgent.logRun('recordatorio_fiscal', 'success', msg, detalle);
    return null;
  }

  // ── 10. Control IVA Mensual ──

  private static async _checkIVA(data: AppData): Promise<FlowRun | null> {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();

    // IVA soportado (compras del mes)
    const albaranesMes = (data.albaranes || []).filter(a => {
      const d = new Date(a.date);
      return d.getMonth() === mesActual && d.getFullYear() === anioActual;
    });
    const ivaSoportado = albaranesMes.reduce((s, a) => s + Num.parse(a.taxes || a.iva || 0), 0);

    // IVA repercutido (ventas del mes — estimado de cierres)
    const cierresMes = (data.cierres || []).filter(c => {
      const d = new Date(c.date);
      return d.getMonth() === mesActual && d.getFullYear() === anioActual;
    });
    const totalVentas = cierresMes.reduce((s, c) => s + Num.parse((c as any).totalVenta || (c as any).totalVentas || 0), 0);
    const ivaRepercutido = totalVentas * 0.10 / 1.10; // Estimación IVA 10% hostelería

    const diferencia = ivaRepercutido - ivaSoportado;

    const msg = `🧾 IVA mes ${mesActual + 1}/${anioActual}: Soportado ${Num.fmt(ivaSoportado)} | Repercutido ~${Num.fmt(ivaRepercutido)} | Diferencia ${Num.fmt(diferencia)}`;

    ArumeAgent.logRun('control_iva', 'success', msg);
    return null;
  }

  // ── 11. Precios Anómalos ──

  private static async _checkPrecios(data: AppData): Promise<FlowRun | null> {
    const history = data.priceHistory || [];
    if (history.length < 2) {
      ArumeAgent.logRun('precios_anomalos', 'success', 'Historial insuficiente para comparar');
      return null;
    }

    // Agrupar por item + proveedor y ORDENAR por fecha
    // Guardamos también albaranId para enriquecer el aviso con contexto
    const grouped: Record<string, { unitPrice: number; date: string; albaranId?: string }[]> = {};
    for (const h of history) {
      const key = `${h.item}__${h.prov}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ unitPrice: h.unitPrice, date: h.date, albaranId: h.albaranId });
    }

    // Para resolver albaranId → número de albarán legible
    const albaranes = data.albaranes || [];
    const albaranById: Record<string, any> = {};
    for (const a of albaranes) albaranById[a.id] = a;

    const fmtFecha = (iso?: string) => {
      if (!iso) return '';
      try {
        const d = new Date(iso);
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      } catch { return iso; }
    };

    const anomalias: string[] = [];
    for (const [key, entries] of Object.entries(grouped)) {
      if (entries.length < 2) continue;
      // Ordenar cronológicamente para comparar correctamente
      entries.sort((a, b) => a.date.localeCompare(b.date));
      const last = entries[entries.length - 1];
      const prev = entries[entries.length - 2];
      if (prev.unitPrice > 0) {
        const cambio = ((last.unitPrice - prev.unitPrice) / prev.unitPrice) * 100;
        if (cambio > 15) {
          const [item, prov] = key.split('__');
          const alb = last.albaranId ? albaranById[last.albaranId] : null;
          const albNum = alb?.num ? `${alb.num}` : '';
          const fecha = fmtFecha(last.date);

          // Mensaje estructurado, legible en Telegram
          const lineas = [
            `🛒 ${item}`,
            `📦 Proveedor: ${prov}`,
            `📈 +${cambio.toFixed(0)}% (${Num.fmt(prev.unitPrice)} → ${Num.fmt(last.unitPrice)})`,
          ];
          if (albNum || fecha) {
            lineas.push(`🧾 Albarán${albNum ? ' ' + albNum : ''}${fecha ? ' · ' + fecha : ''}`);
          }
          anomalias.push(lineas.join('\n'));
        }
      }
    }

    if (anomalias.length === 0) {
      ArumeAgent.logRun('precios_anomalos', 'success', 'Sin anomalías de precios detectadas');
      return null;
    }

    const msg = `📈 ${anomalias.length} subida${anomalias.length > 1 ? 's' : ''} de precio >15% detectada${anomalias.length > 1 ? 's' : ''}`;
    const detalle = anomalias.slice(0, 10).join('\n\n');

    await PushService.sendNative(msg, detalle, { type: 'warning', category: 'precios', tag: 'precios-anomalos' });
    await ArumeAgent._sendTelegram(data, `${msg}\n\n${detalle}`);

    ArumeAgent.logRun('precios_anomalos', 'success', msg, detalle);
    return null;
  }

  // ── 12. Albaranes sin Factura ──

  private static async _checkAlbaranesSinFactura(data: AppData): Promise<FlowRun | null> {
    const hace30dias = new Date();
    hace30dias.setDate(hace30dias.getDate() - 30);

    const sinFactura = (data.albaranes || []).filter(a => {
      if (a.invoiced) return false;
      const d = new Date(a.date);
      return d < hace30dias;
    });

    if (sinFactura.length === 0) {
      ArumeAgent.logRun('albaranes_sin_factura', 'success', 'Todos los albaranes >30d están facturados');
      return null;
    }

    const provs = [...new Set(sinFactura.map(a => a.prov || 'Sin proveedor'))];
    const total = sinFactura.reduce((s, a) => s + Num.parse(a.total), 0);
    const msg = `📄 ${sinFactura.length} albaranes sin factura (>30 días): ${Num.fmt(total)}`;
    const detalle = `Proveedores: ${provs.slice(0, 5).join(', ')}${provs.length > 5 ? ` y ${provs.length - 5} más` : ''}`;

    await PushService.sendNative(msg, detalle, { type: 'info', category: 'facturas', tag: 'albaranes-pendientes' });

    ArumeAgent.logRun('albaranes_sin_factura', 'success', msg, detalle);
    return null;
  }

  // ── 13. Briefing Matutino (9h) ──

  private static async _resumenDiario(data: AppData): Promise<FlowRun | null> {
    const now = new Date();
    const hora = now.getHours();
    // Se envía entre las 9h y las 10h de la mañana
    if (hora < 9 || hora >= 10) {
      ArumeAgent.logRun('resumen_diario', 'success', 'El briefing se envía entre las 9h y 10h');
      return null;
    }

    const hoy = now.toISOString().split('T')[0];
    const ayer = new Date(now); ayer.setDate(now.getDate() - 1);
    const ayerStr = ayer.toISOString().split('T')[0];
    const diaFmt = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

    // Cierre de ayer
    const cierreAyer = (data.cierres || []).find(c => c.date === ayerStr);
    const ventaAyer = cierreAyer ? Num.parse((cierreAyer as any).totalVenta || (cierreAyer as any).totalVentas || 0) : 0;

    // Saldo banco
    const saldoInicial = (data.config as any)?.saldoInicial || 0;
    const saldo = (data.banco || []).reduce((s, m: any) => s + Num.parse(m.amount), saldoInicial);

    // Stock crítico
    const stockCritico = (data.ingredientes || []).filter(i => i.stock <= i.min);

    // Facturas a pagar hoy o vencidas
    const facturasPendientes = (data.facturas || []).filter((f: any) => {
      if (f.paid) return false;
      const due = f.dueDate || f.date;
      return due && due <= hoy;
    });
    const totalPendiente = facturasPendientes.reduce((s, f: any) => s + Num.parse(f.total), 0);

    // Albaranes sin factura (>30 días)
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
    const hace30Str = hace30.toISOString().split('T')[0];
    const albSinFact = (data.albaranes || []).filter((a: any) => !a.invoiced && a.date < hace30Str);

    // Subidas de precio (reutilizamos la misma lógica, inline)
    const history = data.priceHistory || [];
    const grouped: Record<string, { unitPrice: number; date: string }[]> = {};
    for (const h of history) {
      const k = `${h.item}__${h.prov}`;
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push({ unitPrice: h.unitPrice, date: h.date });
    }
    let subidas = 0;
    for (const entries of Object.values(grouped)) {
      if (entries.length < 2) continue;
      entries.sort((a, b) => a.date.localeCompare(b.date));
      const ult = entries[entries.length - 1].unitPrice;
      const ant = entries[entries.length - 2].unitPrice;
      if (ant > 0 && ((ult - ant) / ant) * 100 > 15) subidas++;
    }

    const lines = [
      `☀️ *Buenos días — ${diaFmt}*`,
      '',
      `💰 Ventas ayer: ${ventaAyer > 0 ? Num.fmt(ventaAyer) : 'Sin cierre'}`,
      `🏦 Saldo banco: ${Num.fmt(saldo)}`,
    ];

    if (totalPendiente > 0) {
      lines.push(`💳 Por pagar hoy: ${Num.fmt(totalPendiente)} (${facturasPendientes.length} facturas)`);
    }
    if (stockCritico.length > 0) {
      const nombres = stockCritico.slice(0, 3).map((i: any) => i.n || i.nombre).join(', ');
      lines.push(`📦 Stock bajo: ${stockCritico.length} productos${stockCritico.length <= 3 ? ` (${nombres})` : ` (${nombres}…)`}`);
    }
    if (subidas > 0) {
      lines.push(`📈 ${subidas} subida${subidas > 1 ? 's' : ''} de precio >15% — revisa en Proveedores`);
    }
    if (albSinFact.length > 0) {
      lines.push(`📄 ${albSinFact.length} albaranes >30 días sin factura`);
    }

    if (cierreAyer?.descuadre && Math.abs(cierreAyer.descuadre) > 5) {
      lines.push(`⚠️ Descuadre caja ayer: ${Num.fmt(cierreAyer.descuadre)}`);
    }

    lines.push('');
    lines.push(`¡A por el día! 💪`);

    const msg = lines.join('\n');
    await ArumeAgent._sendTelegram(data, msg);
    await PushService.sendNative('Buenos días ☀️', `Ventas ayer: ${Num.fmt(ventaAyer)} | Saldo: ${Num.fmt(saldo)}`, {
      type: 'info', category: 'resumen', tag: 'briefing-matutino',
    });

    ArumeAgent.logRun('resumen_diario', 'success', `Briefing matutino enviado — Ventas ayer: ${Num.fmt(ventaAyer)}`);
    return null;
  }

  // ── Stats ──

  static getStats(state?: AgentState): { total: number; enabled: number; errores: number; ultimaEjecucion: number } {
    const s = state || ArumeAgent.getState();
    return {
      total: s.flows.length,
      enabled: s.flows.filter(f => f.enabled).length,
      errores: s.history.filter(h => h.status === 'error').slice(0, 20).length,
      ultimaEjecucion: Math.max(...s.flows.map(f => f.lastRun || 0), 0),
    };
  }
}
