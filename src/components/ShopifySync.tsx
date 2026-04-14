// ==========================================
// 🛒 ShopifySync.tsx — Sincronización Shopify ↔ Arume PRO
// ==========================================
import React, { useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Package, ShoppingCart, TrendingUp, AlertCircle,
  CheckCircle2, Clock, Download, ExternalLink, Link2, Unlink,
  ArrowRight, Save, X, Loader2, Settings, Webhook, Info,
  Store, Layers, ArrowDownToLine, ArrowUpFromLine, Search,
  ChevronDown, ChevronUp, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData } from '../types';
import { Num, DateUtil } from '../services/engine';
import { cn } from '../lib/utils';
import { toast } from '../hooks/useToast';

// ── Tipos internos ──────────────────────────────────────────────────────────

interface ShopifyConfig {
  storeDomain: string;     // ej: arume-sake.myshopify.com
  accessToken: string;     // Admin API access token
  syncEnabled: boolean;
  lastSyncProducts?: string;
  lastSyncOrders?: string;
  lastSyncInventory?: string;
}

interface ShopifyProduct {
  id: string;
  shopifyId: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  price: number;
  compareAtPrice?: number;
  sku: string;
  inventoryQty: number;
  imageUrl?: string;
  status: 'active' | 'draft' | 'archived';
  linkedIngId?: string;   // ID del ingrediente SHOP vinculado
  syncedAt: string;
}

interface ShopifyOrder {
  id: string;
  shopifyId: string;
  orderNumber: string;
  createdAt: string;
  customer: string;
  email: string;
  total: number;
  subtotal: number;
  shipping: number;
  taxes: number;
  status: 'open' | 'closed' | 'cancelled';
  fulfillment: 'unfulfilled' | 'partial' | 'fulfilled';
  items: { title: string; qty: number; price: number; sku: string }[];
  importedAsPedido?: boolean;
  pedidoId?: string;
}

interface Props {
  data: AppData;
  onSave: (d: AppData) => Promise<void>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const getConfig = (data: AppData): ShopifyConfig => ({
  storeDomain: (data as any).config?.shopifyDomain || '',
  accessToken: (data as any).config?.shopifyToken || '',
  syncEnabled: (data as any).config?.shopifySyncEnabled || false,
  lastSyncProducts: (data as any).config?.shopifyLastSyncProducts,
  lastSyncOrders: (data as any).config?.shopifyLastSyncOrders,
  lastSyncInventory: (data as any).config?.shopifyLastSyncInventory,
});

const getProducts = (data: AppData): ShopifyProduct[] => (data as any).shopify_products || [];
const getOrders = (data: AppData): ShopifyOrder[] => (data as any).shopify_orders || [];

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  draft: 'bg-amber-100 text-amber-700',
  archived: 'bg-gray-100 text-gray-500',
  open: 'bg-blue-100 text-blue-700',
  closed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
};

const FULFILL_COLORS: Record<string, string> = {
  unfulfilled: 'bg-amber-100 text-amber-700',
  partial: 'bg-blue-100 text-blue-700',
  fulfilled: 'bg-emerald-100 text-emerald-700',
};

// ── Función proxy para llamadas a Shopify vía Backend Proxy ─────────────────
// Shopify Admin API no permite llamadas directas desde el browser (CORS).
// Usamos un backend proxy: enviamos { action, storeDomain, accessToken, ...params }
// y el proxy hace la llamada real a Shopify.
async function shopifyProxy(
  webhookUrl: string,
  action: string,
  config: ShopifyConfig,
  params?: Record<string, any>,
): Promise<any> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      storeDomain: config.storeDomain,
      accessToken: config.accessToken,
      ...params,
    }),
  });
  if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Componente principal ────────────────────────────────────────────────────

export const ShopifySync: React.FC<Props> = ({ data, onSave }) => {
  const [tab, setTab] = useState<'config' | 'productos' | 'pedidos' | 'inventario'>('config');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  const config = useMemo(() => getConfig(data), [data]);
  const products = useMemo(() => getProducts(data), [data]);
  const orders = useMemo(() => getOrders(data), [data]);
  const webhookUrl = (data as any).config?.shopifyWebhook || '';

  const ingredientesSHOP = useMemo(() =>
    (data.ingredientes || []).filter((i: any) => (i.unidad_negocio || 'SHOP') === 'SHOP'),
    [data.ingredientes]
  );

  // ── KPIs ──
  const kpis = useMemo(() => {
    const activeProducts = products.filter(p => p.status === 'active').length;
    const linkedProducts = products.filter(p => p.linkedIngId).length;
    const openOrders = orders.filter(o => o.status === 'open').length;
    const totalRevenue = orders.filter(o => o.status !== 'cancelled')
      .reduce((s, o) => s + o.total, 0);
    const unfulfilledOrders = orders.filter(o => o.fulfillment === 'unfulfilled' && o.status === 'open').length;
    const importedOrders = orders.filter(o => o.importedAsPedido).length;
    return { activeProducts, linkedProducts, openOrders, totalRevenue, unfulfilledOrders, importedOrders, totalProducts: products.length, totalOrders: orders.length };
  }, [products, orders]);

  // ── Config form state ──
  const [formDomain, setFormDomain] = useState(config.storeDomain);
  const [formToken, setFormToken] = useState(config.accessToken);
  const [formWebhook, setFormWebhook] = useState(webhookUrl);
  const [formEnabled, setFormEnabled] = useState(config.syncEnabled);

  // ── Guardar config ──
  const handleSaveConfig = useCallback(async () => {
    const newData = JSON.parse(JSON.stringify(data));
    newData.config = {
      ...newData.config,
      shopifyDomain: formDomain,
      shopifyToken: formToken,
      shopifyWebhook: formWebhook,
      shopifySyncEnabled: formEnabled,
    };
    await onSave(newData);
    toast.success('Configuración Shopify guardada');
  }, [data, onSave, formDomain, formToken, formWebhook, formEnabled]);

  // ── Sync productos ──
  const handleSyncProducts = useCallback(async () => {
    if (!webhookUrl) { toast.error('Configura la URL del webhook primero'); return; }
    setSyncing('products');
    try {
      const result = await shopifyProxy(webhookUrl, 'sync_products', config);
      const shopProducts: ShopifyProduct[] = (result.products || []).map((p: any) => {
        const variant = p.variants?.[0] || {};
        const existing = products.find(ep => ep.shopifyId === String(p.id));
        return {
          id: existing?.id || `sp-${Date.now()}-${p.id}`,
          shopifyId: String(p.id),
          title: p.title,
          handle: p.handle,
          vendor: p.vendor || '',
          productType: p.product_type || '',
          price: parseFloat(variant.price) || 0,
          compareAtPrice: variant.compare_at_price ? parseFloat(variant.compare_at_price) : undefined,
          sku: variant.sku || '',
          inventoryQty: variant.inventory_quantity || 0,
          imageUrl: p.image?.src || p.images?.[0]?.src,
          status: p.status || 'active',
          linkedIngId: existing?.linkedIngId,
          syncedAt: new Date().toISOString(),
        };
      });

      const newData = JSON.parse(JSON.stringify(data));
      newData.shopify_products = shopProducts;
      newData.config = { ...newData.config, shopifyLastSyncProducts: new Date().toISOString() };
      await onSave(newData);
      toast.success(`${shopProducts.length} productos sincronizados desde Shopify`);
    } catch (err: any) {
      toast.error(`Error sincronizando productos: ${err.message}`);
    } finally { setSyncing(null); }
  }, [webhookUrl, config, products, data, onSave]);

  // ── Sync pedidos ──
  const handleSyncOrders = useCallback(async () => {
    if (!webhookUrl) { toast.error('Configura la URL del webhook primero'); return; }
    setSyncing('orders');
    try {
      const result = await shopifyProxy(webhookUrl, 'sync_orders', config, { limit: 50 });
      const shopOrders: ShopifyOrder[] = (result.orders || []).map((o: any) => {
        const existing = orders.find(eo => eo.shopifyId === String(o.id));
        return {
          id: existing?.id || `so-${Date.now()}-${o.id}`,
          shopifyId: String(o.id),
          orderNumber: `#${o.order_number || o.name || o.id}`,
          createdAt: o.created_at?.split('T')[0] || DateUtil.today(),
          customer: o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : (o.email || 'Cliente'),
          email: o.email || o.customer?.email || '',
          total: parseFloat(o.total_price) || 0,
          subtotal: parseFloat(o.subtotal_price) || 0,
          shipping: o.total_shipping_price_set?.shop_money?.amount ? parseFloat(o.total_shipping_price_set.shop_money.amount) : 0,
          taxes: parseFloat(o.total_tax) || 0,
          status: o.cancelled_at ? 'cancelled' : (o.closed_at ? 'closed' : 'open'),
          fulfillment: o.fulfillment_status || 'unfulfilled',
          items: (o.line_items || []).map((li: any) => ({
            title: li.title,
            qty: li.quantity,
            price: parseFloat(li.price) || 0,
            sku: li.sku || '',
          })),
          importedAsPedido: existing?.importedAsPedido || false,
          pedidoId: existing?.pedidoId,
        };
      });

      const newData = JSON.parse(JSON.stringify(data));
      newData.shopify_orders = shopOrders;
      newData.config = { ...newData.config, shopifyLastSyncOrders: new Date().toISOString() };
      await onSave(newData);
      toast.success(`${shopOrders.length} pedidos sincronizados desde Shopify`);
    } catch (err: any) {
      toast.error(`Error sincronizando pedidos: ${err.message}`);
    } finally { setSyncing(null); }
  }, [webhookUrl, config, orders, data, onSave]);

  // ── Vincular producto Shopify → Ingrediente SHOP ──
  const handleLinkProduct = useCallback(async (shopifyProductId: string, ingId: string | null) => {
    const newData = JSON.parse(JSON.stringify(data));
    const prods: ShopifyProduct[] = newData.shopify_products || [];
    const idx = prods.findIndex(p => p.id === shopifyProductId);
    if (idx >= 0) {
      prods[idx].linkedIngId = ingId || undefined;
      newData.shopify_products = prods;
      await onSave(newData);
      toast.success(ingId ? 'Producto vinculado' : 'Producto desvinculado');
    }
  }, [data, onSave]);

  // ── Importar pedido Shopify → PedidoOnline ──
  const handleImportOrder = useCallback(async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.importedAsPedido) return;

    const newData = JSON.parse(JSON.stringify(data));
    if (!newData.pedidos_shop) newData.pedidos_shop = [];

    const existingPedidos = newData.pedidos_shop || [];
    const y = new Date().getFullYear();
    const seq = existingPedidos.filter((p: any) => p.num?.startsWith(`PED${y}`)).length + 1;

    const pedido = {
      id: `ped-shopify-${Date.now()}`,
      num: `PED${y}-${String(seq).padStart(4, '0')}`,
      fecha: order.createdAt,
      cliente: order.customer,
      email: order.email,
      canal: 'online',
      estado: order.fulfillment === 'fulfilled' ? 'entregado' : order.status === 'cancelled' ? 'cancelado' : 'pendiente',
      lineas: order.items.map(li => ({
        productoId: li.sku || `shopify-${li.title}`,
        nombre: li.title,
        qty: li.qty,
        precio: li.price,
      })),
      envio: order.shipping,
      notas: `Importado desde Shopify ${order.orderNumber}`,
      origen: 'shopify',
    };

    newData.pedidos_shop.push(pedido);

    // Marcar como importado
    const shopOrders: ShopifyOrder[] = newData.shopify_orders || [];
    const oIdx = shopOrders.findIndex(o => o.id === orderId);
    if (oIdx >= 0) {
      shopOrders[oIdx].importedAsPedido = true;
      shopOrders[oIdx].pedidoId = pedido.id;
    }
    newData.shopify_orders = shopOrders;

    await onSave(newData);
    toast.success(`Pedido ${order.orderNumber} importado como ${pedido.num}`);
  }, [data, orders, onSave]);

  // ── Sync inventario (actualizar stock ingredientes desde Shopify) ──
  const handleSyncInventory = useCallback(async () => {
    const linked = products.filter(p => p.linkedIngId);
    if (linked.length === 0) { toast.info('Vincula productos primero'); return; }

    setSyncing('inventory');
    try {
      const newData = JSON.parse(JSON.stringify(data));
      let updated = 0;

      linked.forEach(sp => {
        const ingIdx = (newData.ingredientes || []).findIndex((i: any) => i.id === sp.linkedIngId);
        if (ingIdx >= 0) {
          const oldStock = newData.ingredientes[ingIdx].stock;
          if (oldStock !== sp.inventoryQty) {
            // Crear entrada kardex
            if (!newData.kardex) newData.kardex = [];
            const diff = sp.inventoryQty - oldStock;
            newData.kardex.unshift({
              id: `kdk-shopify-${Date.now()}-${sp.id}`,
              n: newData.ingredientes[ingIdx].n,
              ingId: sp.linkedIngId,
              ts: Date.now(),
              date: DateUtil.today(),
              qty: Math.abs(diff),
              type: diff > 0 ? 'IN' : 'OUT',
              unit: newData.ingredientes[ingIdx].unit || 'uds',
              price: newData.ingredientes[ingIdx].cost,
              reason: `Sync Shopify (${sp.title})`,
              user: 'Shopify',
              unidad_negocio: 'SHOP',
            });
            newData.ingredientes[ingIdx].stock = sp.inventoryQty;
            updated++;
          }
        }
      });

      newData.config = { ...newData.config, shopifyLastSyncInventory: new Date().toISOString() };
      await onSave(newData);
      toast.success(`Stock actualizado: ${updated} productos modificados`);
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally { setSyncing(null); }
  }, [products, data, onSave]);

  // ── Import all unimported orders ──
  const handleImportAllOrders = useCallback(async () => {
    const unimported = orders.filter(o => !o.importedAsPedido && o.status !== 'cancelled');
    if (unimported.length === 0) { toast.info('Todos los pedidos ya están importados'); return; }
    for (const o of unimported) {
      await handleImportOrder(o.id);
    }
    toast.success(`${unimported.length} pedidos importados`);
  }, [orders, handleImportOrder]);

  // ── Tabs ──
  const TABS = [
    { key: 'config' as const,     label: 'Configuración', icon: Settings },
    { key: 'productos' as const,  label: `Productos (${products.length})`,  icon: Package },
    { key: 'pedidos' as const,    label: `Pedidos (${orders.length})`,    icon: ShoppingCart },
    { key: 'inventario' as const, label: 'Inventario',     icon: Layers },
  ];

  const isConfigured = config.storeDomain && config.accessToken && webhookUrl;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 p-6 rounded-[2.5rem] text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 opacity-10 scale-150 translate-x-12 -translate-y-6">
          <Store className="w-36 h-36" />
        </div>
        <div className="relative z-10">
          <h3 className="text-xl font-black tracking-tight flex items-center gap-2">
            <Zap className="w-5 h-5" /> Shopify Sync
          </h3>
          <p className="text-xs opacity-80 mt-1">Sincroniza productos, pedidos e inventario con tu tienda Shopify</p>
          <div className="flex gap-3 mt-3 flex-wrap">
            <span className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full">
              {kpis.activeProducts} productos activos
            </span>
            <span className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full">
              {kpis.openOrders} pedidos abiertos
            </span>
            <span className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full">
              Ingresos: {Num.fmt(kpis.totalRevenue)}
            </span>
            {!isConfigured && (
              <span className="text-[10px] font-black bg-amber-500 px-3 py-1 rounded-full animate-pulse">
                Pendiente configurar
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1.5 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap',
              tab === t.key ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-500 hover:bg-white')}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: CONFIGURACIÓN                                                  */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'config' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border p-6 space-y-5">
            <h4 className="font-bold text-gray-800 flex items-center gap-2">
              <Settings className="w-4 h-4 text-emerald-600" /> Credenciales Shopify
            </h4>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Dominio de la tienda</label>
                <input value={formDomain} onChange={e => setFormDomain(e.target.value)}
                  placeholder="tu-tienda.myshopify.com"
                  className="w-full border rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-emerald-300 focus:outline-none" />
                <p className="text-[10px] text-gray-400 mt-1">Solo el dominio, sin https://</p>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Access Token (Admin API)</label>
                <input value={formToken} onChange={e => setFormToken(e.target.value)}
                  type="password" placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full border rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-emerald-300 focus:outline-none" />
                <p className="text-[10px] text-gray-400 mt-1">
                  Shopify Admin → Configuración → Apps → Desarrollar apps → Crear app → Instalar → Access token
                </p>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase block mb-1">URL Backend Proxy</label>
                <input value={formWebhook} onChange={e => setFormWebhook(e.target.value)}
                  placeholder="https://tu-backend.com/webhook/shopify-proxy"
                  className="w-full border rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-emerald-300 focus:outline-none" />
                <p className="text-[10px] text-gray-400 mt-1">
                  Endpoint backend que hace de proxy a la Shopify Admin API (necesario por CORS)
                </p>
              </div>

              <label className="flex items-center gap-3 bg-gray-50 rounded-xl p-4 cursor-pointer">
                <input type="checkbox" checked={formEnabled} onChange={e => setFormEnabled(e.target.checked)}
                  className="w-5 h-5 rounded-lg accent-emerald-600" />
                <div>
                  <div className="text-sm font-bold">Activar sincronización</div>
                  <div className="text-xs text-gray-400">Permite importar productos y pedidos desde Shopify</div>
                </div>
              </label>

              <button onClick={handleSaveConfig}
                className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> Guardar Configuración
              </button>
            </div>
          </div>

          {/* Guía de setup proxy */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3">
            <h4 className="font-bold text-emerald-800 flex items-center gap-2 text-sm">
              <Info className="w-4 h-4" /> Cómo configurar el Backend Proxy
            </h4>
            <div className="text-xs text-emerald-700 space-y-2">
              <p><strong>1.</strong> Configura un endpoint (Edge Function, servidor propio, etc.) que acepte POST</p>
              <p><strong>2.</strong> El endpoint debe hacer la llamada a la Shopify Admin API:</p>
              <code className="block bg-white rounded-lg p-3 font-mono text-[10px] overflow-x-auto border">
                {`URL: https://{{storeDomain}}/admin/api/2024-01/{{endpoint}}.json`}<br />
                {`Header: X-Shopify-Access-Token: {{accessToken}}`}
              </code>
              <p><strong>3.</strong> El endpoint recibe <code>action</code> y enruta:</p>
              <ul className="list-disc ml-4 space-y-1 text-[10px]">
                <li><code>sync_products</code> → GET /products.json?limit=250</li>
                <li><code>sync_orders</code> → GET /orders.json?status=any&limit=50</li>
                <li><code>update_inventory</code> → POST /inventory_levels/set.json</li>
              </ul>
              <p><strong>4.</strong> Copia la URL del Webhook y pégala arriba.</p>
            </div>
          </div>

          {/* Estado de última sincronización */}
          <div className="bg-white rounded-2xl border p-5">
            <h4 className="font-bold text-gray-800 mb-4 text-sm">Estado de Sincronización</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Productos', last: config.lastSyncProducts, count: products.length },
                { label: 'Pedidos',   last: config.lastSyncOrders,   count: orders.length },
                { label: 'Inventario',last: config.lastSyncInventory, count: products.filter(p => p.linkedIngId).length },
              ].map(s => (
                <div key={s.label} className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs font-bold text-gray-500 uppercase">{s.label}</div>
                  <div className="text-lg font-black text-gray-800 mt-1">{s.count}</div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    {s.last ? `Última sync: ${new Date(s.last).toLocaleString('es-ES')}` : 'Nunca sincronizado'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: PRODUCTOS                                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'productos' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar producto..."
                className="w-full pl-10 pr-4 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-emerald-300" />
            </div>
            <button onClick={handleSyncProducts} disabled={!isConfigured || syncing === 'products'}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition',
                isConfigured ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed')}>
              {syncing === 'products' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sincronizar Productos
            </button>
          </div>

          {products.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-12 text-center">
              <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 font-bold">Sin productos de Shopify</p>
              <p className="text-sm text-gray-400 mt-2">Configura tus credenciales y pulsa "Sincronizar Productos"</p>
            </div>
          ) : (
            <div className="space-y-2">
              {products
                .filter(p => p.title.toLowerCase().includes(searchTerm.toLowerCase()))
                .map(p => {
                  const isExpanded = expandedProduct === p.id;
                  const linkedIng = ingredientesSHOP.find(i => i.id === p.linkedIngId);

                  return (
                    <div key={p.id} className="bg-white rounded-2xl border overflow-hidden">
                      <button onClick={() => setExpandedProduct(isExpanded ? null : p.id)}
                        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition text-left">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.title} className="w-12 h-12 rounded-xl object-cover" />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                              <Package className="w-5 h-5 text-emerald-600" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">{p.title}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full', STATUS_COLORS[p.status] || 'bg-gray-100')}>
                                {p.status}
                              </span>
                              {p.linkedIngId && (
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
                                  <Link2 className="w-2.5 h-2.5" /> Vinculado
                                </span>
                              )}
                              {p.sku && <span className="text-[10px] text-gray-400">SKU: {p.sku}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right">
                            <div className="font-bold text-emerald-700">{Num.fmt(p.price)}</div>
                            <div className="text-xs text-gray-400">{p.inventoryQty} uds</div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                        </div>
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                            <div className="px-4 pb-4 border-t space-y-3 pt-3">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                <div className="bg-gray-50 rounded-xl p-3">
                                  <div className="text-[10px] text-gray-400 uppercase font-bold">Vendor</div>
                                  <div className="font-semibold">{p.vendor || '—'}</div>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-3">
                                  <div className="text-[10px] text-gray-400 uppercase font-bold">Tipo</div>
                                  <div className="font-semibold">{p.productType || '—'}</div>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-3">
                                  <div className="text-[10px] text-gray-400 uppercase font-bold">Stock Shopify</div>
                                  <div className="font-semibold">{p.inventoryQty}</div>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-3">
                                  <div className="text-[10px] text-gray-400 uppercase font-bold">Última sync</div>
                                  <div className="font-semibold text-xs">{new Date(p.syncedAt).toLocaleDateString('es-ES')}</div>
                                </div>
                              </div>

                              {/* Vincular con ingrediente */}
                              <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                                <div className="text-xs font-bold text-emerald-700 mb-2 flex items-center gap-2">
                                  <Link2 className="w-3.5 h-3.5" />
                                  Vincular con Ingrediente SHOP
                                </div>
                                <div className="flex items-center gap-2">
                                  <select
                                    value={p.linkedIngId || ''}
                                    onChange={e => handleLinkProduct(p.id, e.target.value || null)}
                                    className="flex-1 border rounded-xl px-3 py-2 text-sm">
                                    <option value="">— Sin vincular —</option>
                                    {ingredientesSHOP.map(i => (
                                      <option key={i.id} value={i.id}>{i.n} ({i.stock} {i.unit || 'uds'})</option>
                                    ))}
                                  </select>
                                  {p.linkedIngId && (
                                    <button onClick={() => handleLinkProduct(p.id, null)}
                                      className="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition">
                                      <Unlink className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                                {linkedIng && (
                                  <div className="mt-2 text-xs text-emerald-600">
                                    Stock Arume: <strong>{linkedIng.stock} {linkedIng.unit || 'uds'}</strong>
                                    {linkedIng.stock !== p.inventoryQty && (
                                      <span className="text-amber-600 ml-2">
                                        (Shopify: {p.inventoryQty} — diferencia de {Math.abs(linkedIng.stock - p.inventoryQty)})
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: PEDIDOS                                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'pedidos' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <button onClick={handleSyncOrders} disabled={!isConfigured || syncing === 'orders'}
                className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition',
                  isConfigured ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed')}>
                {syncing === 'orders' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Sync Pedidos
              </button>
              <button onClick={handleImportAllOrders}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition">
                <ArrowDownToLine className="w-4 h-4" /> Importar Todos
              </button>
            </div>
            <div className="flex gap-3 text-xs text-gray-500">
              <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-lg font-bold">{kpis.openOrders} abiertos</span>
              <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-lg font-bold">{kpis.unfulfilledOrders} sin enviar</span>
              <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg font-bold">{kpis.importedOrders} importados</span>
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-12 text-center">
              <ShoppingCart className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 font-bold">Sin pedidos de Shopify</p>
              <p className="text-sm text-gray-400 mt-2">Sincroniza tus pedidos con el botón de arriba</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="text-left px-4 py-3 font-bold">Pedido</th>
                      <th className="text-left px-4 py-3 font-bold">Fecha</th>
                      <th className="text-left px-4 py-3 font-bold">Cliente</th>
                      <th className="text-center px-4 py-3 font-bold">Estado</th>
                      <th className="text-center px-4 py-3 font-bold">Envío</th>
                      <th className="text-right px-4 py-3 font-bold">Total</th>
                      <th className="text-center px-4 py-3 font-bold">Arume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                      .map(o => (
                      <tr key={o.id} className="border-t hover:bg-emerald-50/30 transition">
                        <td className="px-4 py-3 font-semibold text-gray-700">{o.orderNumber}</td>
                        <td className="px-4 py-3 text-gray-500">{o.createdAt}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-700">{o.customer}</div>
                          <div className="text-[10px] text-gray-400">{o.email}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full', STATUS_COLORS[o.status])}>
                            {o.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full', FULFILL_COLORS[o.fulfillment])}>
                            {o.fulfillment}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700">{Num.fmt(o.total)}</td>
                        <td className="px-4 py-3 text-center">
                          {o.importedAsPedido ? (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                              <CheckCircle2 className="w-3 h-3 inline mr-1" />Importado
                            </span>
                          ) : (
                            <button onClick={() => handleImportOrder(o.id)}
                              className="text-[9px] font-bold px-2 py-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition">
                              <ArrowDownToLine className="w-3 h-3 inline mr-1" />Importar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB: INVENTARIO                                                     */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === 'inventario' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-gray-900">Sincronización de Inventario</h3>
            <button onClick={handleSyncInventory} disabled={syncing === 'inventory'}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition">
              {syncing === 'inventory' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sync Inventario → Arume
            </button>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex gap-3">
            <Info className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-800">
              La sincronización actualiza el stock de los productos SHOP vinculados con los niveles de inventario de Shopify.
              Se crean automáticamente entradas en el <strong>Kardex</strong> para mantener la trazabilidad.
            </div>
          </div>

          {/* Tabla de productos vinculados */}
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="text-left px-4 py-3 font-bold">Producto Shopify</th>
                    <th className="text-left px-4 py-3 font-bold">Ingrediente Arume</th>
                    <th className="text-center px-4 py-3 font-bold">Stock Shopify</th>
                    <th className="text-center px-4 py-3 font-bold">Stock Arume</th>
                    <th className="text-center px-4 py-3 font-bold">Diferencia</th>
                    <th className="text-center px-4 py-3 font-bold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {products.filter(p => p.linkedIngId).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                        <Link2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        No hay productos vinculados. Ve a la pestaña Productos para vincular.
                      </td>
                    </tr>
                  ) : (
                    products.filter(p => p.linkedIngId).map(p => {
                      const ing = ingredientesSHOP.find(i => i.id === p.linkedIngId);
                      const arumeStock = ing?.stock || 0;
                      const diff = p.inventoryQty - arumeStock;
                      return (
                        <tr key={p.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{p.title}</td>
                          <td className="px-4 py-3 text-gray-600">{ing?.n || '—'}</td>
                          <td className="px-4 py-3 text-center font-mono">{p.inventoryQty}</td>
                          <td className="px-4 py-3 text-center font-mono">{arumeStock}</td>
                          <td className="px-4 py-3 text-center">
                            {diff === 0 ? (
                              <span className="text-emerald-600 font-bold">OK</span>
                            ) : (
                              <span className={cn('font-bold', diff > 0 ? 'text-blue-600' : 'text-rose-600')}>
                                {diff > 0 ? '+' : ''}{diff}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {diff === 0 ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-amber-500 mx-auto" />
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Productos no vinculados */}
          {products.filter(p => !p.linkedIngId && p.status === 'active').length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <h4 className="font-bold text-amber-800 text-sm mb-2 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {products.filter(p => !p.linkedIngId && p.status === 'active').length} productos activos sin vincular
              </h4>
              <div className="flex flex-wrap gap-2">
                {products.filter(p => !p.linkedIngId && p.status === 'active').slice(0, 10).map(p => (
                  <span key={p.id} className="text-xs bg-white rounded-lg px-3 py-1 border border-amber-200 text-amber-700">
                    {p.title}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export default ShopifySync;
