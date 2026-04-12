// ==========================================
// 🤖 AutomatizacionesView.tsx — Panel de Control del Agente
// Reemplaza n8n: gestión visual de flujos nativos
// ==========================================

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bot, Play, Pause, RefreshCw, Trash2, CheckCircle, XCircle,
  Clock, Zap, ChevronRight, ToggleLeft, ToggleRight, AlertTriangle,
  Activity, Settings, History, TrendingUp, Shield
} from 'lucide-react';
import { AppData } from '../types';
import { ArumeAgent, FlowDef, FlowRun, AgentState } from '../services/arumeAgent';
import { GmailDirectSync } from '../services/gmailDirectSync';

// ── Tipos ───────────────────────────────────────────────────────────────────

interface Props {
  data: AppData;
  onSave: (d: AppData) => Promise<void>;
}

type Tab = 'flows' | 'history' | 'stats';

const CATEGORY_LABELS: Record<string, string> = {
  alertas: '🚨 Alertas',
  sync: '🔄 Sincronización',
  fiscal: '📋 Fiscal',
  operaciones: '⚙️ Operaciones',
};

const SCHEDULE_LABELS: Record<string, string> = {
  manual: 'Manual',
  '5min': 'Cada 5 min',
  '15min': 'Cada 15 min',
  '30min': 'Cada 30 min',
  '1h': 'Cada hora',
  '6h': 'Cada 6 horas',
  daily: 'Diario',
};

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: any }> = {
  success: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle },
  error: { bg: 'bg-rose-50', text: 'text-rose-700', icon: XCircle },
  idle: { bg: 'bg-slate-50', text: 'text-slate-500', icon: Clock },
  running: { bg: 'bg-blue-50', text: 'text-blue-600', icon: RefreshCw },
  disabled: { bg: 'bg-slate-100', text: 'text-slate-400', icon: Pause },
};

// ── Componente Principal ────────────────────────────────────────────────────

export function AutomatizacionesView({ data, onSave }: Props) {
  const [tab, setTab] = useState<Tab>('flows');
  const [state, setState] = useState<AgentState>(ArumeAgent.getState());
  const [runningFlow, setRunningFlow] = useState<string | null>(null);
  const [runAllLoading, setRunAllLoading] = useState(false);
  const [expandedFlow, setExpandedFlow] = useState<string | null>(null);

  const refresh = useCallback(() => setState(ArumeAgent.getState()), []);

  // ── Ejecutar flow ──
  const handleRunFlow = useCallback(async (flowId: string) => {
    setRunningFlow(flowId);
    try {
      await ArumeAgent.executeFlow(flowId, data);
    } catch { /* logged internally */ }
    setRunningFlow(null);
    refresh();
  }, [data, refresh]);

  // ── Ejecutar todos ──
  const handleRunAll = useCallback(async () => {
    setRunAllLoading(true);
    const count = await ArumeAgent.runScheduled(data);
    setRunAllLoading(false);
    refresh();
  }, [data, refresh]);

  // ── Toggle ──
  const handleToggle = useCallback((flowId: string) => {
    ArumeAgent.toggleFlow(flowId);
    refresh();
  }, [refresh]);

  const handleGlobalToggle = useCallback(() => {
    ArumeAgent.toggleGlobal();
    refresh();
  }, [refresh]);

  const handleClearHistory = useCallback(() => {
    ArumeAgent.clearHistory();
    refresh();
  }, [refresh]);

  // ── Cambiar schedule ──
  const handleScheduleChange = useCallback((flowId: string, schedule: string) => {
    ArumeAgent.updateFlow(flowId, { schedule: schedule as FlowDef['schedule'] });
    refresh();
  }, [refresh]);

  // ── Stats ──
  const stats = ArumeAgent.getStats(state);
  const flowsByCategory = state.flows.reduce((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category].push(f);
    return acc;
  }, {} as Record<string, FlowDef[]>);

  return (
    <div className="space-y-4 pb-32">
      {/* Header */}
      <div className="bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 rounded-2xl p-5 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 right-4 w-32 h-32 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-8 w-24 h-24 bg-white rounded-full blur-2xl" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bot className="w-6 h-6" />
              <h1 className="text-lg font-black">Arume Agent</h1>
              <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">v1.0</span>
            </div>
            <button
              onClick={handleGlobalToggle}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
                state.globalEnabled
                  ? 'bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30'
                  : 'bg-rose-400/20 text-rose-200 hover:bg-rose-400/30'
              }`}
            >
              {state.globalEnabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
              {state.globalEnabled ? 'Activo' : 'Pausado'}
            </button>
          </div>

          <p className="text-white/70 text-xs mb-4">
            Motor de automatizaciones nativo — sin n8n, sin fallos externos.
            Ejecuta alertas, sincronizaciones y controles directamente desde tu app.
          </p>

          {/* Quick Stats */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Flujos', value: stats.total, icon: Zap },
              { label: 'Activos', value: stats.enabled, icon: Activity },
              { label: 'Errores', value: stats.errores, icon: AlertTriangle },
              { label: 'Última', value: stats.ultimaEjecucion > 0 ? timeAgo(stats.ultimaEjecucion) : '—', icon: Clock },
            ].map((s, i) => (
              <div key={i} className="bg-white/10 rounded-xl p-2.5 text-center backdrop-blur-sm">
                <s.icon className="w-3.5 h-3.5 mx-auto mb-1 opacity-70" />
                <p className="text-base font-black">{s.value}</p>
                <p className="text-[9px] opacity-60">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {([
          { id: 'flows' as Tab, label: 'Flujos', icon: Zap },
          { id: 'history' as Tab, label: 'Historial', icon: History },
          { id: 'stats' as Tab, label: 'Estado', icon: TrendingUp },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition ${
              tab === t.id ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Run All Button */}
      {tab === 'flows' && (
        <button
          onClick={handleRunAll}
          disabled={runAllLoading || !state.globalEnabled}
          className="w-full flex items-center justify-center gap-2 py-3 bg-violet-600 text-white rounded-xl text-xs font-bold hover:bg-violet-700 transition disabled:opacity-50"
        >
          {runAllLoading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {runAllLoading ? 'Ejecutando flujos...' : 'Ejecutar todos los pendientes'}
        </button>
      )}

      {/* Content */}
      <AnimatePresence mode="wait">
        {tab === 'flows' && (
          <motion.div
            key="flows"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {Object.entries(flowsByCategory).map(([cat, flows]) => (
              <div key={cat}>
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2 px-1">
                  {CATEGORY_LABELS[cat] || cat}
                </h3>
                <div className="space-y-2">
                  {flows.map(flow => (
                    <FlowCard
                      key={flow.id}
                      flow={flow}
                      isRunning={runningFlow === flow.id}
                      isExpanded={expandedFlow === flow.id}
                      onToggle={() => handleToggle(flow.id)}
                      onRun={() => handleRunFlow(flow.id)}
                      onExpand={() => setExpandedFlow(expandedFlow === flow.id ? null : flow.id)}
                      onScheduleChange={(s) => handleScheduleChange(flow.id, s)}
                      globalEnabled={state.globalEnabled}
                    />
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {tab === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-2"
          >
            {state.history.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-rose-500 transition ml-auto"
              >
                <Trash2 className="w-3 h-3" /> Limpiar historial
              </button>
            )}

            {state.history.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-xs font-bold">Sin ejecuciones todavía</p>
                <p className="text-[10px]">Ejecuta un flujo para ver el historial aquí</p>
              </div>
            ) : (
              state.history.slice(0, 50).map(run => {
                const flow = state.flows.find(f => f.id === run.flowId);
                const style = STATUS_STYLES[run.status] || STATUS_STYLES.idle;
                const Icon = style.icon;
                return (
                  <div key={run.id} className={`${style.bg} rounded-xl p-3 border border-slate-100`}>
                    <div className="flex items-start gap-2">
                      <Icon className={`w-4 h-4 mt-0.5 ${style.text}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-bold text-slate-800">
                            {flow?.icon || '⚡'} {flow?.name || run.flowId}
                          </span>
                          <span className="text-[9px] text-slate-400">{timeAgo(run.startedAt)}</span>
                        </div>
                        <p className="text-[11px] text-slate-600 truncate">{run.message}</p>
                        {run.details && (
                          <p className="text-[10px] text-slate-400 mt-1 whitespace-pre-wrap line-clamp-3">{run.details}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </motion.div>
        )}

        {tab === 'stats' && (
          <motion.div
            key="stats"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-3"
          >
            {/* Status general */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h3 className="text-xs font-black text-slate-700 mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-violet-500" />
                Estado del Agente
              </h3>
              <div className="space-y-2">
                <StatusRow label="Motor global" value={state.globalEnabled ? '✅ Activo' : '⏸ Pausado'} />
                <StatusRow label="Flujos totales" value={String(stats.total)} />
                <StatusRow label="Flujos activos" value={`${stats.enabled} de ${stats.total}`} />
                <StatusRow label="Ejecuciones registradas" value={String(state.history.length)} />
                <StatusRow label="Errores recientes" value={String(stats.errores)} highlight={stats.errores > 0} />
                <StatusRow
                  label="Última ejecución"
                  value={stats.ultimaEjecucion > 0 ? new Date(stats.ultimaEjecucion).toLocaleString('es-ES') : 'Nunca'}
                />
              </div>
            </div>

            {/* Telegram status */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h3 className="text-xs font-black text-slate-700 mb-3">✈️ Conexión Telegram</h3>
              <div className="space-y-2">
                <StatusRow label="Bot Token" value={data.config?.telegramToken ? '✅ Configurado' : '❌ No configurado'} />
                <StatusRow label="Chat ID" value={data.config?.telegramChatId || '—'} />
                <StatusRow label="Modo" value="API directa (sin n8n)" />
              </div>
              {data.config?.telegramToken && (
                <button
                  onClick={() => handleRunFlow('telegram_directo')}
                  disabled={runningFlow === 'telegram_directo'}
                  className="mt-3 w-full py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 transition"
                >
                  {runningFlow === 'telegram_directo' ? '⏳ Enviando...' : '📤 Enviar test a Telegram'}
                </button>
              )}
            </div>

            {/* Gmail Direct */}
            <GmailConnectCard onRefresh={refresh} />

            {/* N8N Migration status */}
            <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-xl p-4">
              <h3 className="text-xs font-black text-violet-700 mb-2">🔀 Migración desde n8n</h3>
              <p className="text-[10px] text-violet-600 mb-3">
                Arume Agent reemplaza n8n ejecutando todo localmente. Ya no necesitas webhooks externos.
              </p>
              <div className="space-y-1.5">
                <MigrationRow label="Alertas de stock" from="n8nUrlIA → Telegram" status="migrado" />
                <MigrationRow label="Alertas de caja" from="n8nUrlIA → Telegram" status="migrado" />
                <MigrationRow label="Telegram" from="n8n proxy → API directa" status="migrado" />
                <MigrationRow label="Recordatorios fiscales" from="n8n cron → Agent scheduler" status="migrado" />
                <MigrationRow label="Resumen diario" from="n8n flow → Agent nativo" status="migrado" />
                <MigrationRow label="Gmail → Facturas" from="n8n IMAP → Gmail API directa" status="migrado" />
                <MigrationRow label="Shopify sync" from="n8n proxy → Supabase Edge Fn" status="edge_fn" />
                <MigrationRow label="Bank sync (PSD2)" from="n8nUrlBanco → requiere backend" status="pendiente" />
              </div>
            </div>

            {/* Nota sobre Bank sync */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-[10px] text-amber-700">
                <strong>💡 Nota:</strong> La sincronización bancaria PSD2 requiere un backend con certificados
                (Supabase Edge Function o servidor propio). No se puede hacer desde el navegador por seguridad.
                El resto de automatizaciones ya funcionan 100% sin n8n.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── FlowCard ────────────────────────────────────────────────────────────────

function FlowCard({ flow, isRunning, isExpanded, globalEnabled, onToggle, onRun, onExpand, onScheduleChange }: {
  flow: FlowDef;
  isRunning: boolean;
  isExpanded: boolean;
  globalEnabled: boolean;
  onToggle: () => void;
  onRun: () => void;
  onExpand: () => void;
  onScheduleChange: (s: string) => void;
}) {
  const statusKey = !globalEnabled || !flow.enabled ? 'disabled' : (flow.lastStatus || 'idle');
  const style = STATUS_STYLES[statusKey] || STATUS_STYLES.idle;
  const StatusIcon = style.icon;

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition ${
      flow.enabled && globalEnabled ? 'border-slate-200' : 'border-slate-100 opacity-60'
    }`}>
      {/* Main row */}
      <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={onExpand}>
        <span className="text-lg">{flow.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800">{flow.name}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${style.bg} ${style.text}`}>
              {statusKey === 'success' ? '✓ OK' : statusKey === 'error' ? '✗ Error' : statusKey === 'disabled' ? 'Off' : 'Pendiente'}
            </span>
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {SCHEDULE_LABELS[flow.schedule]}
            {flow.lastRun ? ` · ${timeAgo(flow.lastRun)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onRun(); }}
            disabled={isRunning || !globalEnabled}
            className="p-1.5 hover:bg-violet-50 rounded-lg transition disabled:opacity-30"
            title="Ejecutar ahora"
          >
            {isRunning ? (
              <RefreshCw className="w-4 h-4 text-violet-500 animate-spin" />
            ) : (
              <Play className="w-4 h-4 text-violet-500" />
            )}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="p-1.5 hover:bg-slate-50 rounded-lg transition"
            title={flow.enabled ? 'Desactivar' : 'Activar'}
          >
            {flow.enabled ? (
              <ToggleRight className="w-5 h-5 text-emerald-500" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-slate-300" />
            )}
          </button>
          <ChevronRight className={`w-4 h-4 text-slate-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-0 border-t border-slate-50">
              <p className="text-[10px] text-slate-500 mt-2 mb-3">{flow.description}</p>

              {/* Schedule selector */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold text-slate-500">Frecuencia:</span>
                <select
                  value={flow.schedule}
                  onChange={(e) => onScheduleChange(e.target.value)}
                  className="text-[10px] border border-slate-200 rounded-lg px-2 py-1 bg-white"
                  onClick={(e) => e.stopPropagation()}
                >
                  {Object.entries(SCHEDULE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {/* Last message */}
              {flow.lastMessage && (
                <div className={`text-[10px] p-2 rounded-lg ${style.bg} ${style.text}`}>
                  <StatusIcon className="w-3 h-3 inline mr-1" />
                  {flow.lastMessage}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// ── Gmail Connect Card ──────────────────────────────────────────────────────

function GmailConnectCard({ onRefresh }: { onRefresh: () => void }) {
  const [clientId, setClientId] = useState(GmailDirectSync.getClientId());
  const [isAuth, setIsAuth] = useState(GmailDirectSync.isAuthenticated());
  const [token, setToken] = useState(GmailDirectSync.getToken());
  const [connecting, setConnecting] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const handleSaveClientId = () => {
    GmailDirectSync.setClientId(clientId);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const tok = await GmailDirectSync.authorize();
      if (tok) {
        setIsAuth(true);
        setToken(tok);
        onRefresh();
      }
    } catch (err: any) {
      if (err?.message === 'NO_CLIENT_ID') {
        setShowSetup(true);
      }
    }
    setConnecting(false);
  };

  const handleDisconnect = () => {
    GmailDirectSync.clearToken();
    setIsAuth(false);
    setToken(null);
    onRefresh();
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h3 className="text-xs font-black text-slate-700 mb-3">📧 Conexión Gmail Directa</h3>

      {isAuth ? (
        <>
          <div className="space-y-2 mb-3">
            <StatusRow label="Estado" value="✅ Conectado" />
            <StatusRow label="Cuenta" value={token?.email || '(cargando...)'} />
            <StatusRow label="Expira" value={token?.expires_at ? new Date(token.expires_at).toLocaleString('es-ES') : '—'} />
            <StatusRow label="Modo" value="API directa (sin n8n, sin IMAP)" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConnect}
              className="flex-1 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 transition"
            >
              🔄 Renovar token
            </button>
            <button
              onClick={handleDisconnect}
              className="px-3 py-2 bg-rose-50 text-rose-600 rounded-lg text-xs font-bold hover:bg-rose-100 transition"
            >
              Desconectar
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[10px] text-slate-500 mb-3">
            Conecta tu Gmail para que el Agente descargue automáticamente PDFs de facturas sin n8n.
          </p>

          {showSetup || !clientId ? (
            <div className="space-y-2 mb-3">
              <p className="text-[10px] text-amber-600 font-bold">
                ⚠️ Necesitas un Google Cloud Client ID (gratis):
              </p>
              <ol className="text-[9px] text-slate-500 space-y-1 pl-3 list-decimal">
                <li>Ve a <span className="font-mono text-violet-600">console.cloud.google.com</span></li>
                <li>Crea un proyecto → APIs → Habilita "Gmail API"</li>
                <li>Credenciales → Crear ID de cliente OAuth → Aplicación web</li>
                <li>En "Orígenes autorizados de JS" añade: <span className="font-mono text-violet-600">{window.location.origin}</span></li>
                <li>En "URIs de redirección" añade: <span className="font-mono text-violet-600">{window.location.origin}</span></li>
                <li>Copia el Client ID y pégalo aquí</li>
              </ol>
              <input
                type="text"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                placeholder="123456789.apps.googleusercontent.com"
                className="w-full text-[10px] border border-slate-200 rounded-lg px-3 py-2 font-mono"
              />
              <button
                onClick={() => { handleSaveClientId(); setShowSetup(false); }}
                disabled={!clientId.includes('.apps.googleusercontent.com')}
                className="w-full py-2 bg-violet-600 text-white rounded-lg text-xs font-bold hover:bg-violet-700 transition disabled:opacity-30"
              >
                Guardar Client ID
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-xs font-bold hover:from-blue-700 hover:to-indigo-700 transition flex items-center justify-center gap-2"
              >
                {connecting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <span>📧</span>
                )}
                {connecting ? 'Conectando...' : 'Conectar Gmail'}
              </button>
              <button
                onClick={() => setShowSetup(true)}
                className="w-full py-1.5 text-[10px] text-slate-400 hover:text-slate-600 transition"
              >
                ⚙️ Cambiar Client ID
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function StatusRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`text-[10px] font-bold ${highlight ? 'text-rose-600' : 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

function MigrationRow({ label, from, status }: { label: string; from: string; status: 'migrado' | 'edge_fn' | 'pendiente' }) {
  const styles = {
    migrado: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: '✅ Migrado' },
    edge_fn: { bg: 'bg-blue-100', text: 'text-blue-700', label: '🔧 Edge Fn' },
    pendiente: { bg: 'bg-amber-100', text: 'text-amber-700', label: '⏳ Pendiente' },
  };
  const s = styles[status];
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-[10px] font-bold text-slate-700">{label}</span>
        <span className="text-[9px] text-slate-400 ml-1">({from})</span>
      </div>
      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${s.bg} ${s.text}`}>
        {s.label}
      </span>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'ahora';
  if (diff < 3600_000) return `hace ${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `hace ${Math.floor(diff / 3600_000)}h`;
  return `hace ${Math.floor(diff / 86400_000)}d`;
}
