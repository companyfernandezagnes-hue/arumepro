// ==========================================
// 📱 pushNotifications.ts — Notificaciones Push Nativas
// ==========================================

import { AppData } from '../types';
import { Num } from './engine';

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface NotificationPrefs {
  enabled: boolean;
  stockBajo: boolean;
  pagosPendientes: boolean;
  cierreDiario: boolean;
  pedidosNuevos: boolean;
  tesoreriaAlerta: boolean;
  recordatorioFiscal: boolean;
  quietHoursStart: number;  // 0-23
  quietHoursEnd: number;    // 0-23
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'critical' | 'success';
  category: string;
  timestamp: number;
  read: boolean;
  actionUrl?: string;
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: false,
  stockBajo: true,
  pagosPendientes: true,
  cierreDiario: true,
  pedidosNuevos: true,
  tesoreriaAlerta: true,
  recordatorioFiscal: true,
  quietHoursStart: 23,
  quietHoursEnd: 8,
};

const STORAGE_KEY = 'arume_notification_prefs';
const HISTORY_KEY = 'arume_notification_history';

// ── Servicio Principal ──────────────────────────────────────────────────────

export class PushService {

  // ── Preferencias ──

  static getPrefs(): NotificationPrefs {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
    } catch { /* ignore */ }
    return { ...DEFAULT_PREFS };
  }

  static savePrefs(prefs: NotificationPrefs): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }

  // ── Historial ──

  static getHistory(): AppNotification[] {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return [];
  }

  static addToHistory(notif: AppNotification): void {
    const history = PushService.getHistory();
    history.unshift(notif);
    // Mantener máximo 100 notificaciones
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
  }

  static markAsRead(id: string): void {
    const history = PushService.getHistory();
    const idx = history.findIndex(n => n.id === id);
    if (idx >= 0) {
      history[idx].read = true;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }
  }

  static markAllAsRead(): void {
    const history = PushService.getHistory().map(n => ({ ...n, read: true }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  static getUnreadCount(): number {
    return PushService.getHistory().filter(n => !n.read).length;
  }

  static clearHistory(): void {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([]));
  }

  // ── Service Worker ──

  static async registerSW(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('✅ Service Worker registrado:', reg.scope);
      return reg;
    } catch (err) {
      console.warn('⚠️ Error registrando SW:', err);
      return null;
    }
  }

  // ── Permisos ──

  static async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  static getPermissionStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  // ── Enviar notificación nativa ──

  static async sendNative(title: string, body: string, options?: {
    type?: AppNotification['type'];
    category?: string;
    tag?: string;
    actionUrl?: string;
  }): Promise<void> {
    const prefs = PushService.getPrefs();
    if (!prefs.enabled) return;

    // Check quiet hours
    const hour = new Date().getHours();
    if (prefs.quietHoursStart > prefs.quietHoursEnd) {
      // e.g., 23-8 wraps around midnight
      if (hour >= prefs.quietHoursStart || hour < prefs.quietHoursEnd) return;
    } else {
      if (hour >= prefs.quietHoursStart && hour < prefs.quietHoursEnd) return;
    }

    // Save to history
    const notif: AppNotification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      body,
      type: options?.type || 'info',
      category: options?.category || 'general',
      timestamp: Date.now(),
      read: false,
      actionUrl: options?.actionUrl,
    };
    PushService.addToHistory(notif);

    // Try native notification (con check de soporte del navegador)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) {
          await reg.showNotification(title, {
            body,
            icon: '/arumepro/icon-192x192.png',
            badge: '/arumepro/icon-192x192.png',
            tag: options?.tag || options?.category || 'arume',
            data: { url: options?.actionUrl || '/' },
          } as NotificationOptions);
        } else if (typeof Notification !== 'undefined') {
          new Notification(title, {
            body,
            icon: '/arumepro/icon-192x192.png',
            tag: options?.tag || 'arume',
          });
        }
      } catch {
        // Silent fallback — solo si Notification está disponible
        try { if (typeof Notification !== 'undefined') new Notification(title, { body }); } catch { /* noop */ }
      }
    }
  }

  // ── Smart Checks (ejecutar periódicamente) ──

  /**
   * Smart checks ahora delegados a ArumeAgent para evitar duplicación.
   * PushService solo se encarga de enviar notificaciones, no de lógica de negocio.
   * Mantenemos este método para compatibilidad pero solo hace un check rápido
   * de permisos y registra el Service Worker.
   */
  static async runSmartChecks(_data: AppData): Promise<void> {
    // Solo asegurar que tenemos permiso de notificaciones
    const prefs = PushService.getPrefs();
    if (!prefs.enabled) return;

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      // Pedir permiso la primera vez silenciosamente (sin molestar)
      // El usuario puede activarlo desde NotificacionesView
    }
    // La lógica real (stock, pagos, cierre, saldo, fiscal) la ejecuta ArumeAgent.runScheduled()
  }
}
