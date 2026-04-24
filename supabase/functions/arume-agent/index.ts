// =============================================================================
// 🤖 Arume Agent — Supabase Edge Function (Deno runtime)
// Se ejecuta cada 30 minutos via pg_cron. Revisa la data de Arume PRO en
// Supabase y envía alertas a Telegram si hay algo urgente.
//
// Despliegue:
//   supabase functions deploy arume-agent --project-ref <PROJECT_REF>
//
// Cron (ejecutar en SQL editor de Supabase):
//   select cron.schedule('arume-agent-30min', '*/30 * * * *',
//     $$select net.http_post('https://<PROJECT_REF>.supabase.co/functions/v1/arume-agent',
//       '{}', 'application/json', ARRAY[
//         http_header('Authorization', 'Bearer ' || current_setting('vault.arume_service_key'))
//       ]);$$);
// =============================================================================

// @ts-expect-error -- Supabase Edge usa Deno std imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface AppData {
  config?: any;
  facturas?: any[];
  albaranes?: any[];
  banco?: any[];
  ingredientes?: any[];
  cierres?: any[];
  gastos_fijos?: any[];
  modelos_aeat?: any[];
  priceHistory?: any[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const parseNum = (v: any): number => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.,-]/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  return 0;
};

const fmtEUR = (n: number): string =>
  (Math.round(n * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const todayISO = (): string => new Date().toISOString().slice(0, 10);

// ─── Enviar Telegram ─────────────────────────────────────────────────────────
async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🍶 *Arume PRO · Agente Auto*\n\n${text}`,
        parse_mode: 'Markdown',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Checks ──────────────────────────────────────────────────────────────────

function checkStockBajo(data: AppData): string | null {
  const lows = (data.ingredientes || []).filter((i: any) =>
    parseNum(i?.stock ?? i?.stockActual ?? 0) <= parseNum(i?.min ?? i?.stockMinimo ?? 0) &&
    parseNum(i?.min ?? i?.stockMinimo ?? 0) > 0
  );
  if (lows.length === 0) return null;
  const nombres = lows.slice(0, 5).map((i: any) => i.n || i.nombre || 'ref').join(', ');
  return `📦 *Stock bajo · ${lows.length} productos*\n${nombres}${lows.length > 5 ? ` y ${lows.length - 5} más` : ''}`;
}

function checkFacturasVencidas(data: AppData): string | null {
  const hoy = todayISO();
  const vencidas = (data.facturas || []).filter((f: any) => {
    if (f.paid || f.tipo === 'caja') return false;
    const due = f.dueDate || f.date;
    return due && due <= hoy;
  });
  if (vencidas.length === 0) return null;
  const total = vencidas.reduce((s, f: any) => s + parseNum(f.total), 0);
  return `💸 *Pagos vencidos · ${vencidas.length}*\nTotal: ${fmtEUR(total)}`;
}

function checkSaldoBanco(data: AppData): string | null {
  const saldoInicial = parseNum(data.config?.saldoInicial || 0);
  const movs = data.banco || [];
  const saldo = saldoInicial + movs.reduce((s: number, m: any) => s + parseNum(m.amount || 0), 0);
  if (saldo < 0) return `🚨 *Saldo negativo · ${fmtEUR(saldo)}*\nUrgente — revisar banco.`;
  if (saldo < 1000) return `⚠️ *Saldo ajustado · ${fmtEUR(saldo)}*\nMenos de 1.000€ en banco.`;
  return null;
}

function checkFacturasDuplicadas(data: AppData): string | null {
  const facts = (data.facturas || []).filter((f: any) => f.tipo !== 'caja');
  const groups: Record<string, any[]> = {};
  for (const f of facts) {
    const prov = String(f.prov || f.cliente || '').trim().toLowerCase();
    const num = String(f.num || '').trim().toLowerCase();
    const total = parseNum(f.total).toFixed(2);
    if (!prov || !num) continue;
    const key = `${prov}__${num}__${total}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }
  const dups = Object.values(groups).filter(g => g.length > 1);
  if (dups.length === 0) return null;
  return `⚠️ *${dups.length} factura${dups.length > 1 ? 's' : ''} duplicada${dups.length > 1 ? 's' : ''}*\nRevisa en Facturas.`;
}

function checkPreciosAnomalos(data: AppData): string | null {
  const history = data.priceHistory || [];
  if (history.length < 2) return null;
  const grouped: Record<string, any[]> = {};
  for (const h of history) {
    const k = `${h.item}__${h.prov}`;
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push({ unitPrice: parseNum(h.unitPrice), date: h.date });
  }
  let subidas = 0;
  for (const entries of Object.values(grouped)) {
    if (entries.length < 2) continue;
    entries.sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    const ult = entries[entries.length - 1].unitPrice;
    const ant = entries[entries.length - 2].unitPrice;
    if (ant > 0 && ((ult - ant) / ant) * 100 > 15) subidas++;
  }
  if (subidas === 0) return null;
  return `📈 *${subidas} subida${subidas > 1 ? 's' : ''} de precio >15%*\nRevisa en Proveedores.`;
}

function checkAEAT(data: AppData): string | null {
  const hoy = new Date();
  const trim = Math.floor(hoy.getMonth() / 3) + 1;
  const anio = hoy.getFullYear();
  const presentados = new Set(
    (data.modelos_aeat || [])
      .filter((m: any) => m.presentada)
      .map((m: any) => `${m.modelo}__${m.anio}__${m.trimestre ?? ''}`)
  );

  // Modelos trimestrales vencen día 20 del mes tras el trimestre (Q1 → 20 abril)
  const trimAnterior = trim === 1 ? 4 : trim - 1;
  const anioTrim = trim === 1 ? anio - 1 : anio;
  const vencTrim = trimAnterior === 4
    ? new Date(anioTrim + 1, 0, 30)
    : new Date(anioTrim, trimAnterior * 3, 20);
  const diasRestantes = Math.ceil((vencTrim.getTime() - hoy.getTime()) / 86_400_000);

  // Alerta si faltan <15 días o ya está vencido
  if (diasRestantes > 15 || diasRestantes < -30) return null;

  const pendientes: string[] = [];
  for (const mod of ['303', '111', '115']) {
    const key = `${mod}__${anioTrim}__${trimAnterior}`;
    if (!presentados.has(key)) pendientes.push(`Modelo ${mod}`);
  }
  if (pendientes.length === 0) return null;

  const icon = diasRestantes < 0 ? '🚨' : diasRestantes <= 3 ? '🔥' : '📋';
  const status = diasRestantes < 0 ? `VENCIDO ${Math.abs(diasRestantes)}d`
    : diasRestantes === 0 ? 'VENCE HOY'
    : `${diasRestantes} días`;
  return `${icon} *AEAT Q${trimAnterior} ${anioTrim} · ${status}*\nPendiente: ${pendientes.join(', ')}`;
}

// ─── Handler principal ───────────────────────────────────────────────────────
// @ts-expect-error -- Deno global
Deno.serve(async (req: Request) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // @ts-expect-error -- Deno global
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    // @ts-expect-error -- Deno global
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Leer data de Arume
    const { data: row, error } = await sb
      .from('arume_data')
      .select('data')
      .limit(1)
      .single();

    if (error || !row) {
      return new Response(JSON.stringify({ ok: false, error: error?.message || 'No hay data' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const data: AppData = row.data || {};
    const telegramToken = data.config?.telegramToken;
    const telegramChatId = data.config?.telegramChatId;

    if (!telegramToken || !telegramChatId) {
      return new Response(JSON.stringify({ ok: false, error: 'Telegram sin configurar' }), {
        status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Horario de silencio (23:00 - 07:30 hora España)
    const now = new Date();
    const spanishHour = now.getUTCHours() + (now.getUTCMonth() >= 2 && now.getUTCMonth() <= 9 ? 2 : 1); // DST
    if (spanishHour >= 23 || spanishHour < 7) {
      return new Response(JSON.stringify({ ok: true, skipped: 'quiet-hours' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Ejecutar todos los checks
    const alerts: string[] = [];
    const checks = [checkStockBajo, checkFacturasVencidas, checkSaldoBanco, checkFacturasDuplicadas, checkPreciosAnomalos, checkAEAT];
    for (const check of checks) {
      const msg = check(data);
      if (msg) alerts.push(msg);
    }

    // Briefing matutino (8:30-9:30 España)
    const isMorningBriefing = spanishHour === 8 || spanishHour === 9;
    let sent = 0;

    if (alerts.length > 0) {
      // Combinar alertas en 1 mensaje si son pocas, separar si son muchas
      if (alerts.length <= 3) {
        const combined = alerts.join('\n\n');
        if (await sendTelegram(telegramToken, telegramChatId, combined)) sent++;
      } else {
        for (const alert of alerts) {
          if (await sendTelegram(telegramToken, telegramChatId, alert)) sent++;
          await new Promise(r => setTimeout(r, 500)); // rate limit
        }
      }
    } else if (isMorningBriefing) {
      // Briefing "todo OK" por la mañana
      const saldoInicial = parseNum(data.config?.saldoInicial || 0);
      const saldo = saldoInicial + (data.banco || []).reduce((s: number, m: any) => s + parseNum(m.amount || 0), 0);
      const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const cierreAyer = (data.cierres || []).find((c: any) => c.date === ayer);
      const ventaAyer = cierreAyer ? parseNum(cierreAyer.totalVenta || cierreAyer.totalVentas || 0) : 0;

      const msg = `☀️ *Buenos días*\n\n` +
        `💰 Ventas ayer: ${ventaAyer > 0 ? fmtEUR(ventaAyer) : 'sin cierre'}\n` +
        `🏦 Saldo banco: ${fmtEUR(saldo)}\n\n` +
        `Todo en orden — no hay alertas urgentes. ✅`;
      if (await sendTelegram(telegramToken, telegramChatId, msg)) sent++;
    }

    return new Response(JSON.stringify({
      ok: true,
      alerts: alerts.length,
      sent,
      timestamp: new Date().toISOString(),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
