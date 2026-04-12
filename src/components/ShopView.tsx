/**
 * ShopView.tsx — Arume PRO / Celosos de Palma SL
 * Módulo de gestión de la Tienda de Saques (física + ecommerce)
 *
 * Tabs:
 *  📊 Dashboard  — KPIs ventas físico vs online, stock crítico
 *  📦 Pedidos    — gestión de pedidos online (manual + webhook Shopify)
 *  🛒 Catálogo   — productos SHOP sincronizados con StockView
 *  🌐 Ecommerce  — asesor IA, guía de plataformas, configuración webhook
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  ShoppingBag, Package, TrendingUp, TrendingDown, Plus,
  CheckCircle2, Clock, Truck, XCircle, AlertCircle,
  Sparkles, ChevronRight, Edit3, Save, X, Loader2,
  Globe, Webhook, Copy, ExternalLink, BarChart3,
  Store, Euro, ArrowUpRight, Download, Search,
  RefreshCw, Info, Star, Zap, BookOpen, ShoppingCart, Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { Num, DateUtil } from '../services/engine';
import { AppData } from '../types';
import { askAI } from '../services/aiProviders';
import { toast } from '../hooks/useToast';
import { confirm } from '../hooks/useConfirm';
import { ShopifySync } from './ShopifySync';

// ─── Tipos ────────────────────────────────────────────────────────────────
type EstadoPedido = 'pendiente' | 'preparando' | 'enviado' | 'entregado' | 'cancelado';
type CanalVenta  = 'fisico' | 'online' | 'whatsapp' | 'telefono';

export interface PedidoOnline {
  id         : string;
  num        : string;
  fecha      : string;
  cliente    : string;
  email     ?: string;
  telefono  ?: string;
  canal      : CanalVenta;
  estado     : EstadoPedido;
  lineas     : { productoId: string; nombre: string; qty: number; precio: number }[];
  envio      : number;
  notas     ?: string;
  tracking  ?: string;
  origen    ?: string; // 'shopify' | 'manual' | 'woocommerce'
}

interface Props {
  data  : AppData;
  onSave: (d: AppData) => Promise<void>;
}

// ─── Constantes ───────────────────────────────────────────────────────────
const ESTADO_PEDIDO: Record<EstadoPedido, { label:string; color:string; bg:string; border:string; icon:any }> = {
  pendiente:  { label:'Pendiente',  color:'text-amber-700',   bg:'bg-amber-50',   border:'border-amber-200',   icon:Clock        },
  preparando: { label:'Preparando', color:'text-indigo-700',  bg:'bg-indigo-50',  border:'border-indigo-200',  icon:Package      },
  enviado:    { label:'Enviado',    color:'text-blue-700',    bg:'bg-blue-50',    border:'border-blue-200',    icon:Truck        },
  entregado:  { label:'Entregado',  color:'text-emerald-700', bg:'bg-emerald-50', border:'border-emerald-200', icon:CheckCircle2 },
  cancelado:  { label:'Cancelado',  color:'text-rose-700',    bg:'bg-rose-50',    border:'border-rose-200',    icon:XCircle      },
};

const CANAL_META: Record<CanalVenta, { label:string; color:string }> = {
  fisico:    { label:'Tienda Física', color:'text-indigo-600' },
  online:    { label:'Online',        color:'text-emerald-600' },
  whatsapp:  { label:'WhatsApp',      color:'text-green-600'   },
  telefono:  { label:'Teléfono',      color:'text-amber-600'   },
};

const genNumPedido = (lista: PedidoOnline[]) => {
  const y   = new Date().getFullYear();
  const seq = lista.filter(p => p.num.startsWith(`PED${y}`)).length + 1;
  return `PED${y}-${String(seq).padStart(4,'0')}`;
};

const calcPedidoTotal = (p: PedidoOnline) =>
  Num.round2(p.lineas.reduce((s,l) => s + l.qty * l.precio, 0) + p.envio);

// ─── Guía plataformas ecommerce ───────────────────────────────────────────
const PLATAFORMAS = [
  {
    nombre: 'Shopify',
    precio: '~32€/mes',
    ideal: 'Tienda profesional con crecimiento',
    pros: ['Pasarela de pago nativa', 'App móvil para gestionar pedidos', 'SEO potente', 'Integración con redes sociales', 'Webhook automático con Arume PRO'],
    contras: ['Coste mensual', 'Comisión por venta en plan básico'],
    url: 'https://www.shopify.com/es',
    recomendado: true,
  },
  {
    nombre: 'WooCommerce',
    precio: 'Gratis (hosting ~10€/mes)',
    ideal: 'Control total, técnico',
    pros: ['Sin comisiones', 'Total personalización', 'WordPress ecosystem'],
    contras: ['Requiere gestión técnica', 'Hosting y SSL por cuenta propia'],
    url: 'https://woocommerce.com',
    recomendado: false,
  },
  {
    nombre: 'Instagram Shopping',
    precio: 'Gratis',
    ideal: 'Empezar sin inversión',
    pros: ['Cero coste', 'Audiencia ya en Instagram', 'Fácil de usar'],
    contras: ['Sin gestión de stock', 'Pago por Bizum/transferencia', 'No escalable'],
    url: 'https://business.instagram.com/shopping',
    recomendado: false,
  },
  {
    nombre: 'Sumup / Stripe Link',
    precio: '~1.75% por transacción',
    ideal: 'Ventas por WhatsApp o email',
    pros: ['Links de pago en segundos', 'Sin tienda necesaria', 'Funciona con WhatsApp Business'],
    contras: ['Sin catálogo visual', 'Manual para cada venta'],
    url: 'https://sumup.es',
    recomendado: false,
  },
];

// ─── Consejos envíos Baleares ─────────────────────────────────────────────
const CONSEJOS_ENVIO = [
  { titulo: 'Correos Express', detalle: 'Para envíos dentro de Baleares: tarifa plana de ~5€. Muy recomendable para isla.', tag: 'Local' },
  { titulo: 'MRW / SEUR', detalle: 'Envíos Península: 48h desde 6€ con cuenta empresa. Negocia volumen mínimo mensual.', tag: 'Península' },
  { titulo: 'Pack bien los saques', detalle: 'Botella de sake = frágil. Usa doble cartón + papel burbuja. Una rotura cuesta más que el envío.', tag: '⚠ Importante' },
  { titulo: 'Envío mínimo', detalle: 'Fija un pedido mínimo de 2 botellas. El margen de una botella sola no cubre el envío.', tag: 'Rentabilidad' },
  { titulo: 'IVA en ecommerce', detalle: 'Vendes a consumidor final → aplicas IVA 21% (bebidas alcohólicas). Incluye el precio con IVA en la web.', tag: 'Fiscal' },
  { titulo: 'Canarias / Ceuta / Melilla', detalle: 'No aplicas IVA español. Requiere declaración de exportación. Empieza sin enviar ahí.', tag: '⚠ Cuidado' },
];

// ════════════════════════════════════════════════════════════════════════════
export const ShopView: React.FC<Props> = ({ data, onSave }) => {

  const pedidos: PedidoOnline[] = useMemo(
    () => Array.isArray((data as any).pedidos_shop) ? (data as any).pedidos_shop : [],
    [data]
  );

  const [activeTab,    setActiveTab]    = useState<'dashboard'|'pedidos'|'catalogo'|'ecommerce'|'shopify'>('dashboard');
  const [showForm,     setShowForm]     = useState(false);
  const [selected,     setSelected]     = useState<PedidoOnline | null>(null);
  const [searchTerm,   setSearchTerm]   = useState('');
  const [filtroEstado, setFiltroEstado] = useState<EstadoPedido | 'todos'>('todos');
  const [saving,       setSaving]       = useState(false);
  const [aiLoading,    setAiLoading]    = useState(false);
  const [aiText,       setAiText]       = useState('');
  const [webhookUrl,   setWebhookUrl]   = useState((data as any).config?.shopifyWebhook || '');

  // ─── Productos SHOP desde ingredientes ────────────────────────────────
  const productosSHOP = useMemo(() =>
    (data.ingredientes || []).filter((i: any) =>
      (i.unidad_negocio || 'SHOP') === 'SHOP'
    ),
    [data.ingredientes]
  );

  // ─── KPIs ──────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const hoy   = DateUtil.today();
    const mesAct = hoy.slice(0, 7);

    const pedidosMes = pedidos.filter(p => p.fecha.startsWith(mesAct) && p.estado !== 'cancelado');
    const ventasMes  = pedidosMes.reduce((s,p) => s + calcPedidoTotal(p), 0);
    const pedidosHoy = pedidos.filter(p => p.fecha === hoy && p.estado !== 'cancelado');
    const ventasHoy  = pedidosHoy.reduce((s,p) => s + calcPedidoTotal(p), 0);

    const byCanal: Record<CanalVenta, number> = { fisico:0, online:0, whatsapp:0, telefono:0 };
    pedidosMes.forEach(p => { byCanal[p.canal] = (byCanal[p.canal] || 0) + calcPedidoTotal(p); });

    const ticketMedio = pedidosMes.length > 0 ? Num.round2(ventasMes / pedidosMes.length) : 0;
    const pendientes  = pedidos.filter(p => p.estado === 'pendiente' || p.estado === 'preparando').length;
    const stockCritico = productosSHOP.filter((i: any) => (i.stock || 0) <= (i.min || 0)).length;

    // Top productos vendidos este mes
    const conteo: Record<string, { nombre:string; qty:number; total:number }> = {};
    pedidosMes.forEach(p => {
      p.lineas.forEach(l => {
        if (!conteo[l.productoId]) conteo[l.productoId] = { nombre:l.nombre, qty:0, total:0 };
        conteo[l.productoId].qty   += l.qty;
        conteo[l.productoId].total += l.qty * l.precio;
      });
    });
    const topProductos = Object.values(conteo).sort((a,b) => b.total - a.total).slice(0,5);

    return { ventasMes: Num.round2(ventasMes), ventasHoy: Num.round2(ventasHoy), ticketMedio,
             pendientes, stockCritico, byCanal, topProductos,
             nPedidosMes: pedidosMes.length, nPedidosHoy: pedidosHoy.length };
  }, [pedidos, productosSHOP]);

  // ─── Contadores filtro ────────────────────────────────────────────────
  const counts = useMemo(() => {
    const r: any = { todos: pedidos.length };
    Object.keys(ESTADO_PEDIDO).forEach(k => { r[k] = pedidos.filter(p => p.estado === k).length; });
    return r;
  }, [pedidos]);

  // ─── Pedidos filtrados ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...pedidos].sort((a,b) => b.fecha.localeCompare(a.fecha));
    if (filtroEstado !== 'todos') list = list.filter(p => p.estado === filtroEstado);
    if (searchTerm) list = list.filter(p =>
      p.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.num.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return list;
  }, [pedidos, filtroEstado, searchTerm]);

  // ─── CRUD ─────────────────────────────────────────────────────────────
  const saveList = useCallback(async (list: PedidoOnline[]) => {
    setSaving(true);
    try {
      await onSave({ ...data, pedidos_shop: list } as any);
    } finally { setSaving(false); }
  }, [data, onSave]);

  const handleChangeEstado = async (id: string, estado: EstadoPedido) => {
    await saveList(pedidos.map(p => p.id === id ? { ...p, estado } : p));
    setSelected(prev => prev ? { ...prev, estado } : null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este pedido?')) return;
    await saveList(pedidos.filter(p => p.id !== id));
    setSelected(null);
  };

  const handleSaveWebhook = async () => {
    await onSave({ ...data, config: { ...(data as any).config, shopifyWebhook: webhookUrl } } as any);
    toast.info('✅ URL de webhook guardada.');
  };

  // ─── Export Excel pedidos ─────────────────────────────────────────────
  const handleExport = () => {
    const rows = pedidos.map(p => ({
      'Nº PEDIDO': p.num, 'FECHA': p.fecha, 'CLIENTE': p.cliente,
      'CANAL': CANAL_META[p.canal].label, 'ESTADO': ESTADO_PEDIDO[p.estado].label,
      'TOTAL': calcPedidoTotal(p), 'TRACKING': p.tracking || '—',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Pedidos');
    XLSX.writeFile(wb, `Pedidos_SHOP_${DateUtil.today().slice(0,7)}.xlsx`);
  };

  // ─── IA Asesor Ecommerce ──────────────────────────────────────────────
  const handleIAConsejo = async (pregunta: string) => {
    setAiLoading(true); setAiText('');
    try {
      const saques = productosSHOP.map((i:any) => i.n).slice(0,10).join(', ');
      const prompt = `Eres un experto en ecommerce de bebidas y gastronomía premium en España.
Negocio: Celosos de Palma SL, tienda de saques japoneses premium en Palma de Mallorca.
Productos en catálogo: ${saques || 'saques japoneses variados'}.
Ventas este mes: ${Num.fmt(kpis.ventasMes)}, ${kpis.nPedidosMes} pedidos.

Pregunta del gestor: "${pregunta}"

Responde de forma concreta, accionable y adaptada a una tienda pequeña española de producto premium.
Máximo 150 palabras. Sin preamble.`;
      const res = await askAI([{ role: 'user', content: prompt }]);
      setAiText(res.text || '');
    } catch (e) { setAiText(`Error: ${(e as Error).message}`); }
    finally { setAiLoading(false); }
  };

  // ─── Preguntas rápidas IA ─────────────────────────────────────────────
  const PREGUNTAS_RAPIDAS = [
    '¿Cómo fijo el precio de venta online para mis saques?',
    '¿Qué estrategia de envío gratis debo usar?',
    '¿Cómo consigo mis primeras ventas online?',
    '¿Qué fotos y copy necesito para la ficha de producto?',
    '¿Cómo gestiono los saques que tienen poca rotación?',
  ];

  // ─── RENDER ──────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6 pb-24 max-w-[1600px] mx-auto">

      {/* HEADER */}
      <header className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tighter flex items-center gap-2">
              <Store className="w-6 h-6 text-indigo-600"/> Celosos de Palma — Tienda de Saques
            </h2>
            <p className="text-[10px] font-black text-slate-400 uppercase mt-1">Canal físico · Online · WhatsApp</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-[10px] font-black hover:bg-emerald-100 transition border border-emerald-100">
              <Download className="w-3.5 h-3.5"/> Export
            </button>
            <button onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black hover:bg-indigo-600 transition shadow-md">
              <Plus className="w-3.5 h-3.5"/> Nuevo Pedido
            </button>
          </div>
        </div>

        {/* KPIs strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5 pt-5 border-t border-slate-100">
          {[
            { label:'Ventas hoy',     val: Num.fmt(kpis.ventasHoy),     icon:Euro,         color:'text-slate-700',   bg:'bg-slate-50'   },
            { label:'Ventas mes',     val: Num.fmt(kpis.ventasMes),     icon:TrendingUp,   color:'text-emerald-600', bg:'bg-emerald-50' },
            { label:'Ticket medio',   val: Num.fmt(kpis.ticketMedio),   icon:ShoppingCart, color:'text-indigo-600',  bg:'bg-indigo-50'  },
            { label:'Pedidos pdte.',  val: String(kpis.pendientes),     icon:Clock,        color:'text-amber-600',   bg:'bg-amber-50'   },
            { label:'Stock crítico',  val: String(kpis.stockCritico),   icon:AlertCircle,  color: kpis.stockCritico>0?'text-rose-600':'text-slate-400', bg: kpis.stockCritico>0?'bg-rose-50':'bg-slate-50' },
          ].map(k => {
            const Icon = k.icon;
            return (
              <div key={k.label} className={cn('flex items-center gap-2.5 p-3.5 rounded-2xl', k.bg)}>
                <Icon className={cn('w-5 h-5 flex-shrink-0', k.color)}/>
                <div>
                  <p className="font-black text-slate-800 text-base leading-tight tabular-nums">{k.val}</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest leading-tight">{k.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </header>

      {/* TABS */}
      <div className="flex flex-wrap gap-2">
        {([
          { key:'dashboard', label:'📊 Dashboard'   },
          { key:'pedidos',   label:'📦 Pedidos'      },
          { key:'catalogo',  label:'🍶 Catálogo'     },
          { key:'shopify',   label:'🛒 Shopify Sync' },
          { key:'ecommerce', label:'🌐 Ecommerce'    },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={cn('px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition border',
              activeTab === t.key
                ? 'bg-slate-900 text-white border-slate-900 shadow-lg'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ═══════════════════════════════════ DASHBOARD ══════════════════════════════════ */}
        {activeTab === 'dashboard' && (
          <motion.div key="dashboard" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-6">

            {/* Ventas por canal */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-500"/> Ventas por Canal · {new Date().toLocaleString('es-ES',{month:'long'}).toUpperCase()}
                </h3>
                {Object.entries(kpis.byCanal).filter(([,v]) => v > 0).length === 0 ? (
                  <p className="text-center text-xs text-slate-400 py-8">Sin ventas registradas aún</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(kpis.byCanal)
                      .filter(([,v]) => v > 0)
                      .sort((a,b) => b[1]-a[1])
                      .map(([canal, v]) => {
                        const meta    = CANAL_META[canal as CanalVenta];
                        const pct     = kpis.ventasMes > 0 ? (v / kpis.ventasMes) * 100 : 0;
                        return (
                          <div key={canal}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className={cn('font-black', meta.color)}>{meta.label}</span>
                              <span className="font-black text-slate-700">{Num.fmt(v)}</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500 transition-all duration-700 rounded-full" style={{ width:`${pct}%` }}/>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Top productos */}
              <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-500"/> Top Saques Vendidos
                </h3>
                {kpis.topProductos.length === 0 ? (
                  <p className="text-center text-xs text-slate-400 py-8">Sin datos de ventas aún</p>
                ) : (
                  <div className="space-y-2">
                    {kpis.topProductos.map((p, i) => (
                      <div key={p.nombre} className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition">
                        <span className={cn('w-6 h-6 rounded-full text-[9px] font-black flex items-center justify-center text-white flex-shrink-0',
                          i===0?'bg-amber-400':i===1?'bg-slate-400':'bg-amber-700/60')}>
                          {i+1}
                        </span>
                        <p className="text-xs font-bold text-slate-700 truncate flex-1">{p.nombre}</p>
                        <span className="text-xs font-black text-indigo-600 flex-shrink-0">{p.qty}ud · {Num.fmt(p.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Stock crítico SHOP */}
            {kpis.stockCritico > 0 && (
              <div className="bg-rose-50 border border-rose-200 rounded-[2rem] p-5 flex items-center gap-4">
                <AlertCircle className="w-8 h-8 text-rose-500 flex-shrink-0"/>
                <div className="flex-1">
                  <p className="font-black text-rose-800 text-sm">{kpis.stockCritico} producto{kpis.stockCritico>1?'s':''} bajo mínimo en la tienda</p>
                  <p className="text-[10px] text-rose-600 font-bold mt-0.5">
                    {productosSHOP.filter((i:any) => (i.stock||0) <= (i.min||0)).map((i:any) => i.n).join(' · ')}
                  </p>
                </div>
                <button onClick={() => setActiveTab('catalogo')}
                  className="flex-shrink-0 px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-black hover:bg-rose-700 transition">
                  Ver stock →
                </button>
              </div>
            )}

            {/* Pedidos recientes */}
            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-800">Últimos pedidos</h3>
                <button onClick={() => setActiveTab('pedidos')} className="text-xs font-black text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1">
                  Ver todos <ChevronRight className="w-3.5 h-3.5"/>
                </button>
              </div>
              {pedidos.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-10">Sin pedidos aún. Crea el primero.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {pedidos.slice(0,5).map(p => {
                    const m = ESTADO_PEDIDO[p.estado]; const Icon = m.icon;
                    return (
                      <div key={p.id} onClick={() => setSelected(p)}
                        className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 cursor-pointer transition">
                        <Icon className={cn('w-5 h-5 flex-shrink-0', m.color)}/>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-slate-700">{p.cliente}</p>
                          <p className="text-[10px] text-slate-400 font-bold">{p.num} · {p.fecha} · {CANAL_META[p.canal].label}</p>
                        </div>
                        <span className="font-black text-slate-800 tabular-nums">{Num.fmt(calcPedidoTotal(p))}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════════════════ PEDIDOS ════════════════════════════════════ */}
        {activeTab === 'pedidos' && (
          <motion.div key="pedidos" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-4">

            {/* Búsqueda + filtros */}
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex-1 min-w-[200px] bg-white border border-slate-200 rounded-2xl flex items-center gap-2 px-4 py-2.5 shadow-sm">
                <Search className="w-4 h-4 text-slate-400"/>
                <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Buscar cliente o nº pedido..."
                  className="flex-1 bg-transparent text-xs font-bold outline-none text-slate-600"/>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setFiltroEstado('todos')}
                  className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase border transition',
                    filtroEstado==='todos'?'bg-slate-900 text-white border-slate-900':'bg-white text-slate-500 border-slate-200')}>
                  Todos <span className="bg-white/20 rounded-full px-1.5">{counts.todos}</span>
                </button>
                {(Object.keys(ESTADO_PEDIDO) as EstadoPedido[]).map(e => {
                  const m = ESTADO_PEDIDO[e]; const Icon = m.icon;
                  return (
                    <button key={e} onClick={() => setFiltroEstado(e)}
                      className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase border transition',
                        filtroEstado===e ? `${m.bg} ${m.color} ${m.border}` : 'bg-white text-slate-500 border-slate-200')}>
                      <Icon className="w-3 h-3"/> {m.label}
                      <span className={cn('rounded-full px-1.5 text-[8px]', m.bg)}>{counts[e]||0}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lista pedidos */}
            {filtered.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-[2rem] p-16 text-center">
                <Package className="w-12 h-12 text-slate-300 mx-auto mb-4"/>
                <p className="text-sm font-black text-slate-500">Sin pedidos</p>
                <button onClick={() => setShowForm(true)}
                  className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase hover:bg-indigo-700 transition">
                  Crear Primer Pedido
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(p => {
                  const m = ESTADO_PEDIDO[p.estado]; const Icon = m.icon;
                  return (
                    <motion.div key={p.id} whileHover={{y:-2}}
                      className="bg-white rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden"
                      onClick={() => setSelected(p)}>
                      <div className={cn('px-4 py-2 flex items-center gap-2 border-b', m.bg, m.border)}>
                        <Icon className={cn('w-3.5 h-3.5', m.color)}/>
                        <span className={cn('text-[9px] font-black uppercase tracking-widest', m.color)}>{m.label}</span>
                        <span className="ml-auto text-[9px] font-bold text-slate-400">{CANAL_META[p.canal].label}</span>
                      </div>
                      <div className="p-5">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="text-[10px] font-black text-indigo-600 uppercase">{p.num}</p>
                            <p className="font-black text-slate-800">{p.cliente}</p>
                            <p className="text-[10px] text-slate-400 font-bold">{p.fecha}</p>
                          </div>
                          <p className="text-lg font-black text-slate-800 tabular-nums">{Num.fmt(calcPedidoTotal(p))}</p>
                        </div>
                        <div className="text-[10px] text-slate-400 space-y-0.5">
                          {p.lineas.slice(0,2).map(l => (
                            <p key={l.productoId} className="truncate">· {l.nombre} ×{l.qty}</p>
                          ))}
                          {p.lineas.length > 2 && <p className="text-indigo-400">+{p.lineas.length-2} más</p>}
                        </div>
                        {p.tracking && (
                          <p className="text-[9px] text-blue-600 font-black mt-2 flex items-center gap-1">
                            <Truck className="w-3 h-3"/> {p.tracking}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* ═══════════════════════════════════ CATÁLOGO ═══════════════════════════════════ */}
        {activeTab === 'catalogo' && (
          <motion.div key="catalogo" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-3 flex items-center gap-3">
              <Info className="w-4 h-4 text-indigo-500 flex-shrink-0"/>
              <p className="text-xs font-bold text-indigo-700">
                El catálogo se sincroniza con el módulo <strong>Stock → Boutique de Saques</strong>. Para añadir o editar productos, ve a Stock.
              </p>
            </div>

            {productosSHOP.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-[2rem] p-16 text-center">
                <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-4"/>
                <p className="text-sm font-black text-slate-500">Sin productos en el catálogo SHOP</p>
                <p className="text-xs text-slate-400 mt-1">Añade productos en Stock → Boutique de Saques</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {productosSHOP.map((ing: any) => {
                  const critico = (ing.stock || 0) <= (ing.min || 0);
                  // Estimación precio venta (+60% sobre coste es razonable para sake premium)
                  const precioVenta = ing.cost ? Num.round2(ing.cost * 1.60) : null;
                  return (
                    <div key={ing.id}
                      className={cn('bg-white rounded-[2rem] border p-5 shadow-sm',
                        critico ? 'border-rose-200 bg-rose-50/30' : 'border-slate-100')}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-black text-slate-800 truncate">{ing.n}</p>
                          <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">{ing.fam || 'Sake'}</p>
                        </div>
                        {critico && (
                          <span className="text-[8px] font-black text-rose-700 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded-full uppercase flex-shrink-0">
                            ⚠ Stock bajo
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-slate-50 rounded-xl p-2">
                          <p className="text-[9px] text-slate-400 font-bold uppercase">Stock</p>
                          <p className={cn('font-black text-sm', critico?'text-rose-600':'text-slate-700')}>{ing.stock || 0}</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-2">
                          <p className="text-[9px] text-slate-400 font-bold uppercase">Coste</p>
                          <p className="font-black text-sm text-slate-700">{ing.cost ? Num.fmt(ing.cost) : '—'}</p>
                        </div>
                        <div className="bg-indigo-50 rounded-xl p-2">
                          <p className="text-[9px] text-indigo-400 font-bold uppercase">PVP est.</p>
                          <p className="font-black text-sm text-indigo-700">{precioVenta ? Num.fmt(precioVenta) : '—'}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* ═══════════════════════════════════ SHOPIFY SYNC ═══════════════════════════════ */}
        {activeTab === 'shopify' && (
          <motion.div key="shopify" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}>
            <ShopifySync data={data} onSave={onSave} />
          </motion.div>
        )}

        {/* ═══════════════════════════════════ ECOMMERCE ══════════════════════════════════ */}
        {activeTab === 'ecommerce' && (
          <motion.div key="ecommerce" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} className="space-y-6">

            {/* Plataformas */}
            <div>
              <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-500"/> ¿Qué plataforma elegir?
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {PLATAFORMAS.map(p => (
                  <div key={p.nombre}
                    className={cn('bg-white rounded-[2rem] border p-5 shadow-sm relative overflow-hidden',
                      p.recomendado ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-100')}>
                    {p.recomendado && (
                      <div className="absolute top-3 right-3 bg-indigo-600 text-white text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                        ⭐ Recomendado
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-3 pr-20">
                      <p className="font-black text-slate-800">{p.nombre}</p>
                      <span className="text-[10px] font-bold text-slate-500">{p.precio}</span>
                    </div>
                    <p className="text-[10px] text-indigo-600 font-bold uppercase mb-3">{p.ideal}</p>
                    <div className="space-y-1 mb-3">
                      {p.pros.map(pr => <p key={pr} className="text-[10px] text-emerald-700 font-bold flex items-start gap-1"><span>✓</span>{pr}</p>)}
                      {p.contras.map(co => <p key={co} className="text-[10px] text-rose-600 font-bold flex items-start gap-1"><span>✗</span>{co}</p>)}
                    </div>
                    <a href={p.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[10px] font-black text-indigo-600 hover:text-indigo-800 transition">
                      <ExternalLink className="w-3 h-3"/> Ver plataforma
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {/* Consejos envío */}
            <div>
              <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Truck className="w-4 h-4 text-amber-500"/> Guía de Envíos para Saques
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {CONSEJOS_ENVIO.map(c => (
                  <div key={c.titulo} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={cn('text-[8px] font-black px-2 py-0.5 rounded-full border',
                        c.tag.includes('⚠') ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        c.tag === 'Fiscal'   ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                        'bg-slate-100 text-slate-600 border-slate-200')}>
                        {c.tag}
                      </span>
                    </div>
                    <p className="font-black text-slate-800 text-xs mb-1">{c.titulo}</p>
                    <p className="text-[10px] text-slate-500 leading-relaxed">{c.detalle}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Webhook Shopify */}
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
                <Webhook className="w-4 h-4 text-indigo-500"/> Conexión Shopify → Arume PRO
              </h3>
              <p className="text-xs text-slate-500">
                Si usas Shopify, configura un webhook en <strong>Shopify Admin → Configuración → Notificaciones → Webhooks</strong>.
                Cuando llegue un pedido nuevo, lo recibiremos aquí automáticamente.
              </p>
              <div className="flex gap-2">
                <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
                  placeholder="https://tu-n8n-o-endpoint.com/webhook/shopify"
                  className="flex-1 border border-slate-200 rounded-xl px-4 py-2 text-xs font-mono focus:outline-none focus:border-indigo-400"/>
                <button onClick={handleSaveWebhook}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition">
                  Guardar
                </button>
              </div>
              <p className="text-[10px] text-slate-400 flex items-start gap-1.5">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0"/>
                Si no tienes Shopify aún, puedes crear pedidos manualmente desde el botón "Nuevo Pedido".
              </p>
            </div>

            {/* IA Asesor */}
            <div className="bg-slate-900 rounded-[2.5rem] p-6 space-y-4 text-white">
              <h3 className="font-black flex items-center gap-2 text-sm">
                <Sparkles className="w-4 h-4 text-indigo-400"/> Asesor Ecommerce IA
              </h3>
              <div className="flex flex-wrap gap-2">
                {PREGUNTAS_RAPIDAS.map(q => (
                  <button key={q} onClick={() => handleIAConsejo(q)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-indigo-700 text-slate-300 hover:text-white rounded-xl text-[9px] font-bold border border-slate-700 hover:border-indigo-500 transition text-left">
                    {q}
                  </button>
                ))}
              </div>
              {aiLoading && (
                <div className="flex items-center gap-2 text-xs text-indigo-300">
                  <Loader2 className="w-4 h-4 animate-spin"/> Pensando...
                </div>
              )}
              {aiText && (
                <div className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700">
                  <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">{aiText}</p>
                  <button onClick={() => navigator.clipboard.writeText(aiText)}
                    className="mt-3 flex items-center gap-1 text-[9px] font-black text-indigo-400 hover:text-indigo-300 transition">
                    <Copy className="w-3 h-3"/> Copiar
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL DETALLE PEDIDO */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
            onClick={e => { if (e.target===e.currentTarget) setSelected(null); }}>
            <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
              className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
                <div>
                  <p className="text-[10px] font-black text-indigo-600 uppercase">{selected.num}</p>
                  <p className="font-black text-slate-800">{selected.cliente}</p>
                </div>
                <button onClick={() => setSelected(null)} className="p-2 hover:bg-slate-200 rounded-xl transition">
                  <X className="w-4 h-4 text-slate-500"/>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                {/* Líneas */}
                <div className="rounded-2xl overflow-hidden border border-slate-100">
                  {selected.lineas.map(l => (
                    <div key={l.productoId} className="flex justify-between items-center px-4 py-3 border-b border-slate-50 text-xs">
                      <span className="font-bold text-slate-700">{l.nombre}</span>
                      <span className="text-slate-400">×{l.qty}</span>
                      <span className="font-black text-slate-800">{Num.fmt(l.qty*l.precio)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between px-4 py-3 bg-slate-50 text-sm">
                    <span className="font-bold text-slate-600">Envío</span>
                    <span className="font-black text-slate-700">{Num.fmt(selected.envio)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 bg-slate-900 text-white text-sm">
                    <span className="font-black">TOTAL</span>
                    <span className="font-black tabular-nums">{Num.fmt(calcPedidoTotal(selected))}</span>
                  </div>
                </div>
                {/* Info */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { l:'Canal',   v: CANAL_META[selected.canal].label },
                    { l:'Fecha',   v: selected.fecha },
                    { l:'Teléfono',v: selected.telefono || '—' },
                    { l:'Tracking',v: selected.tracking || '—' },
                  ].map(f => (
                    <div key={f.l} className="bg-slate-50 rounded-xl p-3 text-xs">
                      <p className="text-[9px] text-slate-400 font-bold uppercase">{f.l}</p>
                      <p className="font-black text-slate-700 mt-0.5 truncate">{f.v}</p>
                    </div>
                  ))}
                </div>
                {/* Cambiar estado */}
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cambiar estado</p>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(ESTADO_PEDIDO) as EstadoPedido[]).filter(e => e !== selected.estado).map(e => {
                      const m = ESTADO_PEDIDO[e]; const Icon = m.icon;
                      return (
                        <button key={e} onClick={() => handleChangeEstado(selected.id, e)}
                          className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase border transition',
                            m.color, m.bg, m.border)}>
                          <Icon className="w-3.5 h-3.5"/> {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {selected.notas && (
                  <div className="bg-slate-50 rounded-2xl p-4 text-xs">
                    <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Notas</p>
                    <p className="text-slate-600">{selected.notas}</p>
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 p-4 flex gap-3 shrink-0">
                <button onClick={() => handleDelete(selected.id)}
                  className="px-4 py-2.5 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl font-black text-[10px] uppercase hover:bg-rose-100 transition">
                  <Trash2 className="w-3.5 h-3.5"/>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL NUEVO PEDIDO */}
      <AnimatePresence>
        {showForm && (
          <NuevoPedidoModal
            productos={productosSHOP}
            pedidos={pedidos}
            onClose={() => setShowForm(false)}
            onSave={async (p) => { await saveList([...pedidos, p]); setShowForm(false); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// MODAL NUEVO PEDIDO
// ════════════════════════════════════════════════════════════════════════════
const NuevoPedidoModal: React.FC<{
  productos: any[]; pedidos: PedidoOnline[];
  onClose:()=>void; onSave:(p:PedidoOnline)=>Promise<void>;
}> = ({ productos, pedidos, onClose, onSave }) => {
  const [form, setForm] = useState({
    cliente:'', email:'', telefono:'', canal:'online' as CanalVenta,
    fecha: DateUtil.today(), notas:'', tracking:'', envio: 0,
    lineas: [] as PedidoOnline['lineas'],
  });
  const [saving, setSaving] = useState(false);

  const addLinea = (ing: any) => {
    const existe = form.lineas.find(l => l.productoId === ing.id);
    if (existe) {
      setForm(f => ({ ...f, lineas: f.lineas.map(l => l.productoId===ing.id ? {...l,qty:l.qty+1} : l) }));
    } else {
      setForm(f => ({ ...f, lineas: [...f.lineas, { productoId:ing.id, nombre:ing.n, qty:1, precio: ing.cost ? Num.round2(ing.cost*1.6) : 0 }] }));
    }
  };

  const total = form.lineas.reduce((s,l) => s+l.qty*l.precio, 0) + form.envio;

  const handleSave = async () => {
    if (!form.cliente.trim()) return void toast.info('El cliente es obligatorio.');
    if (form.lineas.length === 0) return void toast.info('Añade al menos un producto.');
    setSaving(true);
    try {
      await onSave({
        ...form, id:`ped-${Date.now()}`, num: genNumPedido(pedidos),
        estado:'pendiente', origen:'manual',
      });
    } finally { setSaving(false); }
  };

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4"
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
        className="bg-white rounded-[2rem] w-full max-w-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-black text-slate-800">Nuevo Pedido</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition"><X className="w-4 h-4 text-slate-500"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {/* Datos cliente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {key:'cliente', label:'Cliente *', type:'text'},
              {key:'email',   label:'Email',     type:'email'},
              {key:'telefono',label:'Teléfono',  type:'tel'},
              {key:'fecha',   label:'Fecha',     type:'date'},
            ].map(f => (
              <div key={f.key}>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">{f.label}</label>
                <input type={f.type} value={(form as any)[f.key]} onChange={e => setForm(p => ({...p,[f.key]:e.target.value}))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400"/>
              </div>
            ))}
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Canal</label>
              <select value={form.canal} onChange={e => setForm(p => ({...p,canal:e.target.value as CanalVenta}))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400">
                {(Object.keys(CANAL_META) as CanalVenta[]).map(c => (
                  <option key={c} value={c}>{CANAL_META[c].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Envío (€)</label>
              <input type="number" min={0} step={0.5} value={form.envio}
                onChange={e => setForm(p => ({...p,envio:Number(e.target.value)}))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400"/>
            </div>
          </div>

          {/* Seleccionar productos del catálogo */}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Añadir productos del catálogo</label>
            {productos.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Sin productos en catálogo SHOP. Añade saques en Stock.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {productos.map((ing: any) => (
                  <button key={ing.id} onClick={() => addLinea(ing)}
                    className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 transition text-left">
                    <Plus className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0"/>
                    <span className="text-[10px] font-bold text-slate-700 truncate">{ing.n}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Líneas seleccionadas */}
          {form.lineas.length > 0 && (
            <div className="rounded-2xl overflow-hidden border border-slate-100">
              {form.lineas.map(l => (
                <div key={l.productoId} className="grid grid-cols-12 gap-2 items-center px-4 py-2.5 border-b border-slate-50 text-xs">
                  <span className="col-span-4 font-bold text-slate-700 truncate">{l.nombre}</span>
                  <input type="number" min={1} value={l.qty}
                    onChange={e => setForm(f => ({...f,lineas:f.lineas.map(x => x.productoId===l.productoId?{...x,qty:Number(e.target.value)}:x)}))}
                    className="col-span-2 border border-slate-200 rounded-lg px-2 py-1 text-center font-black focus:outline-none"/>
                  <span className="col-span-1 text-center text-slate-400">×</span>
                  <input type="number" min={0} step={0.01} value={l.precio}
                    onChange={e => setForm(f => ({...f,lineas:f.lineas.map(x => x.productoId===l.productoId?{...x,precio:Number(e.target.value)}:x)}))}
                    className="col-span-3 border border-slate-200 rounded-lg px-2 py-1 text-right font-black focus:outline-none"/>
                  <span className="col-span-1 text-right font-black text-slate-800 tabular-nums">{Num.fmt(l.qty*l.precio)}</span>
                  <button onClick={() => setForm(f => ({...f,lineas:f.lineas.filter(x=>x.productoId!==l.productoId)}))}
                    className="col-span-1 text-rose-300 hover:text-rose-500 flex justify-center"><X className="w-3.5 h-3.5"/></button>
                </div>
              ))}
              <div className="flex justify-between px-4 py-3 bg-slate-900 text-white text-sm">
                <span className="font-black">TOTAL</span>
                <span className="font-black tabular-nums">{Num.fmt(total)}</span>
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Notas</label>
            <textarea value={form.notas} rows={2} onChange={e => setForm(p=>({...p,notas:e.target.value}))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:border-indigo-400 resize-none"/>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase hover:bg-slate-200 transition">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase hover:bg-indigo-700 transition flex items-center justify-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>} Crear Pedido
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
