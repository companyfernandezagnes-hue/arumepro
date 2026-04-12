import { AppData, BankMovement } from '../types';
import { Num, DateUtil } from '../services/engine';
import { linkAlbaranesToFactura } from '../services/invoicing';

// ────────────────────────────────────────────────────────────
// ⚙️ CONFIGURACIÓN
// ────────────────────────────────────────────────────────────
export const CFG = {
    TOLERANCIA_FIJA    : 1.50,
    TOLERANCIA_PCT_FAC : 0.05,
    MAX_COMISION_TPV   : 0.035,
    MAX_DIAS_TPV       : 5,
    MAX_DIAS_FACTURA   : 60,
} as const;

// ────────────────────────────────────────────────────────────
// 🔤 HELPERS DE TEXTO (exportados para BancoView)
// ────────────────────────────────────────────────────────────
function norm(s?: string | null): string {
    if (!s || typeof s !== 'string') return '';
    return s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '').trim();
}

// FIX 3: vocabulario ampliado con terminología real de extractos Banca March / SEPA
const BANK_NOISE = new Set([
    'recibo','transfer','transferencia','ab','neto','remesa','pago','ingreso',
    'sl','sa','slu','sll','de','la','el','los','las','por','en','con','del',
    'soc','cia','coop','fund','asoc',
    // añadidos:
    'orden','cargo','abono','comision','cuota','liquidacion','domiciliacion',
    'traspaso','adeudo','sepa','nif','cif','iban','concepto','referencia',
    'fecha','importe','beneficiario','ordenante','banco','march',
]);

// FIX 1: similarityScore bidireccional — también compara tokens del banco vs proveedor
export function similarityScore(a?: string | null, b?: string | null): number {
    const sa = norm(a);
    const sb = norm(b);
    if (!sa || !sb) return 0;
    if (sa === sb) return 100;

    const tokensBank = sa.split(/\s+/).filter(t => t.length > 2 && !/^\d+$/.test(t) && !BANK_NOISE.has(t));
    const tokensProv = sb.split(/\s+/).filter(t => t.length > 2 && !BANK_NOISE.has(t));

    if (!tokensBank.length || !tokensProv.length) return 0;

    // Dirección original: tokens proveedor encontrados en banco
    let matched = 0;
    for (const pt of tokensProv) {
        if (tokensBank.some(bt => bt.includes(pt) || pt.includes(bt))) matched++;
    }
    const scoreForward = matched / tokensProv.length;

    // FIX 1: dirección inversa — tokens banco encontrados en proveedor
    // útil cuando el extracto tiene más texto que el nombre del proveedor registrado
    const reverseMatched = tokensBank.filter(bt =>
        tokensProv.some(pt => pt.includes(bt) || bt.includes(pt))
    ).length;
    const scoreReverse = reverseMatched / Math.max(tokensBank.length, tokensProv.length);

    return Math.round(Math.max(scoreForward, scoreReverse) * 100);
}

// ✅ Exportado para BancoView
export function daysBetween(dateA: string, dateB: string): number {
    const dA = DateUtil.parse(dateA).getTime();
    const dB = DateUtil.parse(dateB).getTime();
    if (!dA || !dB) return 999;
    return Math.abs(Math.round((dA - dB) / 86_400_000));
}

// ✅ Exportado para BancoView
export function normalizeDesc(s?: string | null): string {
    return norm(s);
}

// ✅ Exportado para BancoView
export function isSuspicious(desc: string): boolean {
    if (!desc) return false;
    const d = norm(desc);
    return (
        d.includes('bizum')         ||
        d.includes('transferencia') ||
        d.includes('reintegro')     ||
        d.includes('cajero')        ||
        d.includes('devolucion')    ||
        d.includes('devoluc')
    );
}

// ✅ Exportado para BancoView
export function fingerprint(date: string, amount: number, desc: string): string {
    const d   = String(date   || '').trim();
    const a   = Number(amount || 0).toFixed(2);
    const des = norm(desc).slice(0, 30);
    return `${d}|${a}|${des}`;
}

// ────────────────────────────────────────────────────────────
// 🔍 AUTO-MATCH
// ────────────────────────────────────────────────────────────
export interface MatchCandidate {
    type      : string;
    id        : string;
    date      : string;
    title     : string;
    amount    : number;
    realAmount?: number;
    comision ?: number;
    color     : string;
    score     : number;
    diff      : number;
}

export function findCandidates(
    data     : AppData,
    bankItem : BankMovement,
): MatchCandidate[] {
    if (!bankItem || !data) return [];

    const amt      = Math.abs(Num.parse(bankItem.amount));
    const bankDate = String(bankItem.date || '');
    const descNorm = norm(bankItem.desc);
    const isCredit = Num.parse(bankItem.amount) > 0;

    const results: MatchCandidate[] = [];

    if (isCredit) {

        // ── TPV / CIERRE DE CAJA ─────────────────────────────
        for (const c of (data.cierres || [])) {
            if (!c || (c as any).conciliado_banco) continue;
            const tpvDeclarado = Num.parse((c as any).tarjeta);
            const diferencia   = tpvDeclarado - amt;
            const pct          = tpvDeclarado > 0 ? diferencia / tpvDeclarado : 0;
            const dDays        = daysBetween(bankDate, String(c.date || ''));
            if (diferencia >= -0.5 && pct <= CFG.MAX_COMISION_TPV && dDays <= CFG.MAX_DIAS_TPV) {
                results.push({
                    type      : 'TPV CAJA',
                    id        : String(c.id),
                    date      : String(c.date || ''),
                    title     : `Cierre ${c.date} (Comisión: ${Num.fmt(diferencia)})`,
                    amount    : tpvDeclarado,
                    realAmount: amt,
                    comision  : diferencia,
                    color     : 'emerald',
                    score     : Math.max(0, Math.round(100 - dDays * 5 - (diferencia !== 0 ? 10 : 0))),
                    diff      : diferencia,
                });
            }
        }

        // ── FACTURAS DE VENTA ────────────────────────────────
        for (const f of (data.facturas || [])) {
            if (!f || f.tipo !== 'venta' || f.reconciled) continue;
            const total     = Math.abs(Num.parse(f.total));
            const diff      = Math.abs(total - amt);
            const textMatch = similarityScore(descNorm, f.cliente);
            const dDays     = daysBetween(bankDate, String(f.date || ''));
            const pctDiff   = amt > 0 ? diff / amt : 1;
            if (diff <= CFG.TOLERANCIA_FIJA || (textMatch > 50 && (diff <= 50 || pctDiff <= CFG.TOLERANCIA_PCT_FAC))) {
                let score = 0;
                if (diff <= CFG.TOLERANCIA_FIJA) score += 60;
                score += textMatch * 0.4;
                if (dDays > 30) score -= 20;
                results.push({
                    type  : 'FACTURA CLIENTE',
                    id    : String(f.id),
                    date  : String(f.date || ''),
                    title : `Fac ${f.num || 'S/N'} (${f.cliente || '?'})`,
                    amount: total,
                    color : 'teal',
                    score : Math.max(0, Math.round(score)),
                    diff,
                });
            }
        }

    } else {

        // ── FACTURAS DE COMPRA ───────────────────────────────
        for (const f of (data.facturas || [])) {
            if (!f || f.tipo !== 'compra' || f.reconciled) continue;
            const total     = Math.abs(Num.parse(f.total));
            const diff      = Math.abs(total - amt);
            const textMatch = similarityScore(descNorm, f.prov);
            const pctDiff   = amt > 0 ? diff / amt : 1;
            if (diff <= CFG.TOLERANCIA_FIJA || (textMatch > 50 && (diff <= 50 || pctDiff <= CFG.TOLERANCIA_PCT_FAC))) {
                let score = 0;
                if (diff <= CFG.TOLERANCIA_FIJA) score += 60;
                score += textMatch * 0.4;
                results.push({
                    type  : 'FACTURA PROV',
                    id    : String(f.id),
                    date  : String(f.date || ''),
                    title : `Fac ${f.num || 'S/N'} (${f.prov || '?'})`,
                    amount: total,
                    color : 'rose',
                    score : Math.max(0, Math.round(score)),
                    diff,
                });
            }
        }

        // ── ALBARANES SUELTOS ────────────────────────────────
        for (const a of (data.albaranes || [])) {
            if (!a || a.reconciled || a.invoiced) continue;
            const total     = Math.abs(Num.parse(a.total));
            const diff      = Math.abs(total - amt);
            const textMatch = similarityScore(descNorm, a.prov);
            const pctDiff   = amt > 0 ? diff / amt : 1;
            if (diff <= CFG.TOLERANCIA_FIJA || (textMatch > 50 && (diff <= 50 || pctDiff <= CFG.TOLERANCIA_PCT_FAC))) {
                let score = 0;
                if (diff <= CFG.TOLERANCIA_FIJA) score += 60;
                score += textMatch * 0.4;
                // FIX 2: penalización por antigüedad — evita que un albarán viejo
                // con mismo importe gane a uno reciente
                const dDays = daysBetween(bankDate, String(a.date || ''));
                score -= Math.min(30, dDays * 0.5);
                results.push({
                    type  : 'ALBARÁN SUELTO',
                    id    : String(a.id),
                    date  : String(a.date || ''),
                    title : `Alb ${a.num || 'S/N'} (${a.prov || '?'})`,
                    amount: total,
                    color : 'amber',
                    score : Math.max(0, Math.round(score)),
                    diff,
                });
            }
        }

        // ── GASTOS FIJOS ─────────────────────────────────────
        for (const g of (data.gastos_fijos || [])) {
            if (!g) continue;
            const amount    = Num.parse((g as any).amount ?? (g as any).importe ?? 0);
            const diff      = Math.abs(amount - amt);
            const textMatch = similarityScore(descNorm, (g as any).name ?? (g as any).concepto);
            if (diff <= CFG.TOLERANCIA_FIJA || (textMatch > 60 && diff <= 5)) {
                results.push({
                    type  : 'GASTO FIJO',
                    id    : String((g as any).id),
                    date  : DateUtil.today(),
                    title : `${(g as any).name || (g as any).concepto || 'Gasto Fijo'} (${Num.fmt(amount)})`,
                    amount,
                    color : 'purple',
                    score : Math.max(0, Math.round(textMatch * 0.8 - diff)),
                    diff,
                });
            }
        }
    }

    return results.sort((a, b) => b.score - a.score);
}

// ────────────────────────────────────────────────────────────
// ✅ ALIASES compatibilidad BancoView.tsx
// ────────────────────────────────────────────────────────────
export const findMatches = (bankItem: BankMovement, data: AppData) => findCandidates(data, bankItem);
export const executeLink = (
    newData  : AppData,
    bankId   : string,
    matchType: string,
    docId    : string,
    _comision: number = 0,
) => applyLink(newData, bankId, matchType, docId);

// ────────────────────────────────────────────────────────────
// 🔗 APPLY LINK
// ────────────────────────────────────────────────────────────
export function applyLink(
    newData  : AppData,
    bankId   : string,
    matchType: string,
    docId    : string,
): void {
    if (!newData?.banco) return;
    const bItem = newData.banco.find((b: any) => b && String(b.id) === String(bankId)) as any;
    if (!bItem) return;

    const mt = String(matchType || '').toUpperCase();

    if (mt.includes('TPV')) {
        const cierre = (newData.cierres || []).find((c: any) => c && String(c.id) === String(docId)) as any;
        if (cierre) {
            cierre.conciliado_banco = true;
            const comision = Math.abs(Num.parse(bItem.amount)) - Math.abs(Num.parse(cierre.tarjeta || 0));
            if (comision > 0.01) {
                if (!newData.facturas) newData.facturas = [];
                newData.facturas.unshift({
                    id        : `tpv-com-${Date.now()}`,
                    tipo      : 'compra',
                    num       : `TPV-${cierre.date}`,
                    date      : String(bItem.date || cierre.date),
                    prov      : 'COMISIÓN BANCARIA TPV',
                    total     : String(Num.round2(comision)),
                    base      : String(Num.round2(comision / 1.21)),
                    tax       : String(Num.round2(comision - comision / 1.21)),
                    paid      : true,
                    reconciled: true,
                    cat       : 'gastos_bancarios',
                    status    : 'reconciled',
                    source    : 'banco',
                } as any);
            }
        }
        bItem.link = { type: 'TPV', id: docId };

    } else if (mt === 'MULTI-ALBARÁN' || mt === 'MULTI-ALBARAN') {
        const idsToGroup = String(docId).split(',').map(s => s.trim()).filter(Boolean);
        const albs = (newData.albaranes || []).filter((a: any) => idsToGroup.includes(String(a?.id)));
        if (albs.length === 0) return;
        const first    = albs[0] as any;
        const newFacId = `fac-auto-agrup-${Date.now()}`;
        if (!newData.facturas) newData.facturas = [];
        newData.facturas.unshift({
            id            : newFacId,
            tipo          : 'compra',
            num           : `AGRUP-${String(Date.now()).slice(-4)}`,
            date          : first.date,
            prov          : first.prov,
            total         : '0',
            base          : '0',
            tax           : '0',
            albaranIdsArr : [],
            paid          : true,
            reconciled    : true,
            source        : 'auto-agrupacion-banco',
            status        : 'reconciled',
            unidad_negocio: first.unitId || 'REST',
        } as any);
        linkAlbaranesToFactura(newData, newFacId, idsToGroup, { strategy: 'useAlbTotals' });
        albs.forEach((a: any) => { a.reconciled = true; a.paid = true; a.status = 'paid'; });
        bItem.link = { type: 'FACTURA', id: newFacId };

    } else if (mt.includes('ALBARÁN') || mt.includes('ALBARAN')) {
        const alb = (newData.albaranes || []).find((a: any) => a && String(a.id) === String(docId)) as any;
        if (alb) { alb.reconciled = true; alb.paid = true; alb.status = 'paid'; }
        bItem.link = { type: 'ALBARAN', id: docId };

    } else if (mt.includes('FACTURA')) {
        const fac = (newData.facturas || []).find((f: any) => f && String(f.id) === String(docId)) as any;
        if (fac) {
            fac.reconciled = true;
            fac.paid       = true;
            fac.status     = 'reconciled';
            for (const albId of (fac.albaranIdsArr || [])) {
                const alb = (newData.albaranes || []).find((a: any) => a && String(a.id) === String(albId)) as any;
                if (alb) { alb.reconciled = true; alb.paid = true; }
            }
        }
        bItem.link = { type: 'FACTURA', id: docId };

    } else if (mt.includes('GASTO')) {
        const gasto = (newData.gastos_fijos || []).find((g: any) => g && String(g.id) === String(docId));
        if (gasto) {
            if (!newData.control_pagos || typeof newData.control_pagos !== 'object')
                (newData as any).control_pagos = {};
            if (!Array.isArray((newData.control_pagos as any).__banco_pagos__))
                (newData.control_pagos as any).__banco_pagos__ = [];
            const yaRegistrado = ((newData.control_pagos as any).__banco_pagos__ as any[]).some(
                (cp: any) => cp?.gasto_id === docId && cp?.date === bItem.date
            );
            if (!yaRegistrado) {
                ((newData.control_pagos as any).__banco_pagos__ as any[]).push({
                    id      : `cp-${Date.now()}`,
                    gasto_id: docId,
                    date    : String(bItem.date || ''),
                    amount  : Math.abs(Num.parse(bItem.amount)),
                    status  : 'paid',
                    note    : 'Conciliado auto banco',
                });
            }
        }
        bItem.link = { type: 'GASTO_FIJO', id: docId };

    // FIX 4: rama COBRO_B2B — TesoreriaView registra movimientos con este linkType
    // Sin esta rama caía en el warn final y el movimiento quedaba en estado inconsistente
    } else if (mt.includes('COBRO_B2B') || mt.includes('COBRO B2B')) {
        // El cobro ya fue marcado como paid desde TesoreriaView,
        // aquí solo vinculamos el movimiento bancario correctamente
        bItem.link = { type: 'COBRO_B2B', id: docId };

    } else {
        console.warn(`[bancoLogic] applyLink: matchType no reconocido "${matchType}".`);
        bItem.link = { type: matchType, id: docId };
    }

    bItem.status    = 'matched';
    bItem.matchedAt = new Date().toISOString();
}

// ────────────────────────────────────────────────────────────
// ↩️ UNDO LINK
// ────────────────────────────────────────────────────────────
export function undoLink(newData: AppData, bankId: string): void {
    const bItem = (newData.banco || []).find((b: any) => b && String(b.id) === String(bankId)) as any;
    if (!bItem?.link) return;
    const { type, id } = bItem.link as { type: string; id: string };
    const t = String(type || '').toUpperCase();

    if (t.includes('TPV')) {
        const cierre = (newData.cierres || []).find((c: any) => c && String(c.id) === String(id)) as any;
        if (cierre) cierre.conciliado_banco = false;
        if (Array.isArray(newData.facturas) && cierre) {
            const idx = newData.facturas.findIndex(
                (f: any) => f?.prov === 'COMISIÓN BANCARIA TPV' && f?.num === `TPV-${cierre.date}`
            );
            if (idx !== -1) newData.facturas.splice(idx, 1);
        }
    } else if (t.includes('FACTURA')) {
        const fac = (newData.facturas || []).find((f: any) => f && String(f.id) === String(id)) as any;
        if (fac) {
            fac.reconciled = false;
            fac.status     = fac.paid ? 'paid' : 'approved';
            for (const albId of (fac.albaranIdsArr || [])) {
                const alb = (newData.albaranes || []).find((a: any) => a && String(a.id) === String(albId)) as any;
                if (alb) alb.reconciled = false;
            }
        }
    } else if (t.includes('ALBARAN')) {
        const alb = (newData.albaranes || []).find((a: any) => a && String(a.id) === String(id)) as any;
        if (alb) { alb.reconciled = false; alb.paid = false; alb.status = 'pending'; }

    } else if (t.includes('GASTO')) {
        if (newData.control_pagos && (newData.control_pagos as any).__banco_pagos__) {
            const lista = (newData.control_pagos as any).__banco_pagos__ as any[];
            const idx   = lista.findIndex(
                (cp: any) => cp?.gasto_id === id && cp?.date === bItem.date
            );
            if (idx !== -1) lista.splice(idx, 1);
        }

    // FIX 5: undo COBRO_B2B — revertir el cobro a pendiente en cobros_b2b
    } else if (t.includes('COBRO_B2B') || t.includes('COBRO B2B')) {
        const cobros = (newData as any).cobros_b2b;
        if (Array.isArray(cobros)) {
            const cobro = cobros.find((c: any) => c && String(c.id) === String(id));
            if (cobro) cobro.paid = false;
        }
    }

    delete bItem.link;
    delete bItem.matchedAt;
    bItem.status = 'pending';
}
