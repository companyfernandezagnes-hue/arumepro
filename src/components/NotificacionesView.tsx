// ==========================================
// 📱 NotificacionesView.tsx — Centro de Notificaciones
// ==========================================
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Bell, BellOff, BellRing, Settings, Trash2, CheckCircle2,
  AlertCircle, AlertTriangle, Info, Clock, Package,
  Wallet, Calendar, ShoppingCart, Landmark, Shield,
  Eye, EyeOff, Volume2, VolumeX, Moon, RefreshCw,
  X, Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData } from '../types';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';
import {
  PushService,
  type NotificationPrefs,
  type AppNotification,
} from '../services/pushNotifications';

interface Props {
  data: AppData;
  onSave: (d: AppData) => Promise<void>;
}

const TYPE_STYLES: Record<string, { icon: any; color: string; bg: string }> = {
  info:     { icon: Info,          color: 'text-blue-600',    bg: 'bg-blue-50' },
  warning:  { icon: AlertTriangle, color: 'text-amber-600',   bg: 'bg-amber-50' },
  critical: { icon: AlertCircle,   color: 'text-rose-600',    bg: 'bg-rose-50' },
  success:  { icon: CheckCircle2,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
};

const CATEGORY_ICONS: Record<string, any> = {
  stock: Package,
  pagos: Wallet,
  cierre: Calendar,
  pedidos: ShoppingCart,
  tesoreria: Landmark,
  fiscal: Shield,
  general: Bell,
};

const PREF_ITEMS: { key: keyof NotificationPrefs; label: string; desc: string; icon: any }[] = [
  { key: 'stockBajo',         label: 'Stock bajo mínimos',          desc: 'Alerta cuando un producto cae bajo el stock mínimo',       icon: Package },
  { key: 'pagosPendientes',   label: 'Pagos pendientes',            desc: 'Aviso de compromisos próximos a vencer',                    icon: Wallet },
  { key: 'cierreDiario',      label: 'Cierre de caja',              desc: 'Recordatorio si no se ha hecho el cierre del día (17h)',    icon: Calendar },
  { key: 'pedidosNuevos',     label: 'Pedidos nuevos',              desc: 'Notificación al recibir un pedido de la tienda',            icon: ShoppingCart },
  { key: 'tesoreriaAlerta',   label: 'Saldo bancario bajo',         desc: 'Alerta si el saldo baja de 3.000€',                        icon: Landmark },
  { key: 'recordatorioFiscal',label: 'Recordatorio fiscal',         desc: 'Aviso de declaraciones trimestrales AEAT',                  icon: Shield },
];

export const NotificacionesView: React.FC<Props> = ({ data, onSave }) => {
  const [tab, setTab] = useState<'historial' | 'config'>('historial');
  const [prefs, setPrefs] = useState<NotificationPrefs>(PushService.getPrefs());
  const [history, setHistory] = useState<AppNotification[]>(PushService.getHistory());
  const [permStatus, setPermStatus] = useState(PushService.getPermissionStatus());
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  // Refresh history periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setHistory(PushService.getHistory());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const unreadCount = useMemo(() => history.filter(n => !n.read).length, [history]);

  const filtered = useMemo(() => {
    let list = [...history];
    if (filter === 'unread') list = list.filter(n => !n.read);
    return list;
  }, [history, filter]);

  // ── Activar notificaciones ──
  const handleEnable = useCallback(async () => {
    const granted = await PushService.requestPermission();
    setPermStatus(PushService.getPermissionStatus());

    if (granted) {
      await PushService.registerSW();
      const newPrefs = { ...prefs, enabled: true };
      PushService.savePrefs(newPrefs);
      setPrefs(newPrefs);
      toast.success('Notificaciones activadas');

      // Enviar notificación de prueba
      await PushService.sendNative(
        'Arume PRO',
        'Las notificaciones push están activadas correctamente.',
        { type: 'success', category: 'general' }
      );
      setHistory(PushService.getHistory());
    } else {
      toast.error('Permiso de notificaciones denegado. Actívalo en los ajustes del navegador.');
    }
  }, [prefs]);

  // ── Desactivar ──
  const handleDisable = useCallback(() => {
    const newPrefs = { ...prefs, enabled: false };
    PushService.savePrefs(newPrefs);
    setPrefs(newPrefs);
    toast.info('Notificaciones desactivadas');
  }, [prefs]);

  // ── Toggle preferencia ──
  const handleTogglePref = useCallback((key: keyof NotificationPrefs) => {
    const newPrefs = { ...prefs, [key]: !prefs[key] };
    PushService.savePrefs(newPrefs);
    setPrefs(newPrefs);
  }, [prefs]);

  // ── Cambiar horas de silencio ──
  const handleQuietHours = useCallback((field: 'quietHoursStart' | 'quietHoursEnd', value: number) => {
    const newPrefs = { ...prefs, [field]: value };
    PushService.savePrefs(newPrefs);
    setPrefs(newPrefs);
  }, [prefs]);

  // ── Marcar como leída ──
  const handleMarkRead = useCallback((id: string) => {
    PushService.markAsRead(id);
    setHistory(PushService.getHistory());
  }, []);

  // ── Marcar todas como leídas ──
  const handleMarkAllRead = useCallback(() => {
    PushService.markAllAsRead();
    setHistory(PushService.getHistory());
    toast.info('Todas marcadas como leídas');
  }, []);

  // ── Limpiar historial ──
  const handleClear = useCallback(() => {
    PushService.clearHistory();
    setHistory([]);
    toast.info('Historial limpiado');
  }, []);

  // ── Ejecutar checks manualmente ──
  const handleRunChecks = useCallback(async () => {
    // Reset timer to force check
    localStorage.removeItem('arume_last_push_check');
    await PushService.runSmartChecks(data);
    setHistory(PushService.getHistory());
    toast.success('Checks ejecutados');
  }, [data]);

  // ── Enviar test ──
  const handleSendTest = useCallback(async () => {
    await PushService.sendNative(
      'Notificación de prueba',
      'Si ves esto, las notificaciones push funcionan correctamente en tu dispositivo.',
      { type: 'info', category: 'general' }
    );
    setHistory(PushService.getHistory());
  }, []);

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Ahora';
    if (diff < 3600000) return `Hace ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `Hace ${Math.floor(diff / 3600000)}h`;
    return new Date(ts).toLocaleDateString('es-ES');
  };

  return (
    <div className="animate-fade-in space-y-6 pb-24">

      {/* ── Header ── */}
      <header className="relative overflow-hidden bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] p-6 md:p-8 rounded-2xl">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[color:var(--arume-gold)]/80"/>
        <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-[color:var(--arume-gold)]/5 pointer-events-none"/>
        <div className="relative z-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[color:var(--arume-gold)]">Sistema</p>
          <h2 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight mt-2 flex items-center gap-3">
            <BellRing className="w-7 h-7 text-[color:var(--arume-gold)]" /> Centro de notificaciones
          </h2>
          <p className="text-sm text-white/60 mt-1">Alertas inteligentes · push nativo</p>
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <span className={cn('text-[10px] font-black px-3 py-1 rounded-full',
              prefs.enabled ? 'bg-emerald-500' : 'bg-white/20')}>
              {prefs.enabled ? 'ACTIVO' : 'DESACTIVADO'}
            </span>
            {unreadCount > 0 && (
              <span className="text-[10px] font-black bg-rose-500 px-3 py-1 rounded-full animate-pulse">
                {unreadCount} sin leer
              </span>
            )}
            <span className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full">
              {history.length} notificaciones
            </span>
            <span className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full">
              Permiso: {permStatus}
            </span>
          </div>
        </div>
      </header>

      {/* ── Tabs ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-2xl p-1.5">
          {[
            { key: 'historial' as const, label: 'Historial', icon: Clock },
            { key: 'config' as const,    label: 'Configuración', icon: Settings },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all',
                tab === t.key ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-500 hover:bg-white')}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={handleRunChecks}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold hover:bg-indigo-200 transition">
            <RefreshCw className="w-3.5 h-3.5" /> Comprobar ahora
          </button>
          <button onClick={handleSendTest}
            className="flex items-center gap-2 px-3 py-2 bg-violet-100 text-violet-700 rounded-xl text-xs font-bold hover:bg-violet-200 transition">
            <Bell className="w-3.5 h-3.5" /> Test
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: HISTORIAL                                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'historial' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button onClick={() => setFilter('all')}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition',
                  filter === 'all' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400')}>
                Todas ({history.length})
              </button>
              <button onClick={() => setFilter('unread')}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition',
                  filter === 'unread' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400')}>
                Sin leer ({unreadCount})
              </button>
            </div>
            <div className="flex gap-2">
              {unreadCount > 0 && (
                <button onClick={handleMarkAllRead}
                  className="text-xs text-indigo-600 font-bold flex items-center gap-1 hover:underline">
                  <Check className="w-3 h-3" /> Marcar todas leídas
                </button>
              )}
              {history.length > 0 && (
                <button onClick={handleClear}
                  className="text-xs text-gray-400 font-bold flex items-center gap-1 hover:text-rose-500">
                  <Trash2 className="w-3 h-3" /> Limpiar
                </button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-12 text-center">
              <BellOff className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 font-bold">
                {filter === 'unread' ? 'No hay notificaciones sin leer' : 'Sin notificaciones'}
              </p>
              <p className="text-sm text-gray-400 mt-2">
                Las alertas inteligentes aparecerán aquí cuando se detecten eventos importantes
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {filtered.map(n => {
                  const style = TYPE_STYLES[n.type] || TYPE_STYLES.info;
                  const Icon = style.icon;
                  const CatIcon = CATEGORY_ICONS[n.category] || Bell;

                  return (
                    <motion.div key={n.id} layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -50 }}
                      className={cn(
                        'bg-white rounded-2xl border p-4 flex items-start gap-3 transition-all',
                        !n.read && 'border-indigo-200 shadow-sm bg-indigo-50/30'
                      )}>
                      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', style.bg)}>
                        <Icon className={cn('w-5 h-5', style.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm text-gray-800">{n.title}</span>
                          <CatIcon className="w-3 h-3 text-gray-300" />
                          {!n.read && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">{n.body}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] text-gray-400">{timeAgo(n.timestamp)}</span>
                          <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full', style.bg, style.color)}>
                            {n.type}
                          </span>
                        </div>
                      </div>
                      {!n.read && (
                        <button onClick={() => handleMarkRead(n.id)}
                          className="p-2 text-gray-300 hover:text-indigo-600 transition shrink-0">
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: CONFIGURACIÓN                                                  */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'config' && (
        <div className="space-y-6">

          {/* Estado principal */}
          <div className={cn(
            'rounded-2xl p-6 border flex items-center justify-between',
            prefs.enabled ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'
          )}>
            <div className="flex items-center gap-4">
              {prefs.enabled ? (
                <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg">
                  <BellRing className="w-7 h-7 text-white" />
                </div>
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-gray-300 flex items-center justify-center">
                  <BellOff className="w-7 h-7 text-white" />
                </div>
              )}
              <div>
                <div className="font-bold text-lg">
                  {prefs.enabled ? 'Notificaciones activadas' : 'Notificaciones desactivadas'}
                </div>
                <div className="text-sm text-gray-500">
                  {prefs.enabled
                    ? 'Recibirás alertas nativas en tu dispositivo'
                    : 'Activa para recibir alertas de stock, pagos, cierres y más'}
                </div>
                {permStatus === 'denied' && (
                  <div className="text-xs text-rose-600 font-bold mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Permiso denegado — actívalo en los ajustes del navegador
                  </div>
                )}
              </div>
            </div>
            <button onClick={prefs.enabled ? handleDisable : handleEnable}
              className={cn('px-6 py-3 rounded-xl font-bold text-sm transition',
                prefs.enabled
                  ? 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg')}>
              {prefs.enabled ? 'Desactivar' : 'Activar'}
            </button>
          </div>

          {/* Preferencias individuales */}
          <div className="bg-white rounded-2xl border p-6">
            <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-600" /> Tipos de Alerta
            </h4>
            <div className="space-y-3">
              {PREF_ITEMS.map(item => {
                const Icon = item.icon;
                const isOn = prefs[item.key] as boolean;
                return (
                  <label key={item.key}
                    className={cn(
                      'flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all',
                      isOn ? 'bg-indigo-50/50 border-indigo-200' : 'bg-gray-50 border-gray-100',
                      !prefs.enabled && 'opacity-50 pointer-events-none'
                    )}>
                    <div className="flex items-center gap-3">
                      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center',
                        isOn ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-400')}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{item.label}</div>
                        <div className="text-xs text-gray-400">{item.desc}</div>
                      </div>
                    </div>
                    <div className={cn(
                      'w-12 h-7 rounded-full p-1 transition-colors',
                      isOn ? 'bg-indigo-600' : 'bg-gray-300'
                    )} onClick={() => handleTogglePref(item.key)}>
                      <div className={cn(
                        'w-5 h-5 bg-white rounded-full shadow transition-transform',
                        isOn ? 'translate-x-5' : 'translate-x-0'
                      )} />
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Horas de silencio */}
          <div className="bg-white rounded-2xl border p-6">
            <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Moon className="w-4 h-4 text-violet-600" /> Horas de Silencio
            </h4>
            <p className="text-sm text-gray-500 mb-4">
              No recibirás notificaciones durante estas horas. Ideal para no molestar por la noche.
            </p>
            <div className="flex items-center gap-4">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Desde</label>
                <select value={prefs.quietHoursStart}
                  onChange={e => handleQuietHours('quietHoursStart', Number(e.target.value))}
                  disabled={!prefs.enabled}
                  className="border rounded-xl px-3 py-2 text-sm font-bold">
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
              <span className="text-gray-400 font-bold mt-5">→</span>
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Hasta</label>
                <select value={prefs.quietHoursEnd}
                  onChange={e => handleQuietHours('quietHoursEnd', Number(e.target.value))}
                  disabled={!prefs.enabled}
                  className="border rounded-xl px-3 py-2 text-sm font-bold">
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 bg-violet-50 rounded-xl px-4 py-2 mt-5 text-xs text-violet-700 font-bold">
                <VolumeX className="w-4 h-4" />
                {prefs.quietHoursStart}:00 — {prefs.quietHoursEnd}:00
              </div>
            </div>
          </div>

          {/* Info técnica */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex gap-3">
            <Info className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
            <div className="text-sm text-indigo-800">
              <strong>Cómo funciona:</strong> Las notificaciones push usan la API nativa del navegador y un Service Worker.
              Funcionan incluso con la app cerrada si tienes el navegador abierto en segundo plano.
              En iOS, necesitas añadir la app a la pantalla de inicio (PWA) para recibir push.
              Las alertas también se envían a <strong>Telegram</strong> vía la API directa del bot si lo tienes configurado.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificacionesView;
