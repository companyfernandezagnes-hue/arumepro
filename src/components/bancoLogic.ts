import { AppData, BankMovement, FacturaExtended, Albaran } from '../types';
import { Num, DateUtil } from '../services/engine';
import { linkAlbaranesToFactura, recomputeFacturaFromAlbaranes } from '../services/invoicing';

// -----------------------------------------
// CONSTANTES Y CONFIGURACIÓN
// -----------------------------------------
const CFG = {
  TOLERANCIA_FIJA: 1.05, // € de tolerancia universal
  MAX_COMISION_TPV: 0.03, // 3% máximo de comisión
  MAX_DIAS_TPV: 5,
  MAX_DIAS_FACT_VENTA: 45,
  MAX_DIAS_ALB_COMPRA: 20,
};

// -----------------------------------------
// FUNCIONES DE NORMALIZACIÓN
// -----------------------------------------
export function normalizeDesc(s = '') {
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u00A0\u202F\s]+/g, ' ').trim();
}

export function fingerprint(date: string, amount: number | string, desc: string) {
  return `${date}|${Number(amount || 0).toFixed(2)}|${normalizeDesc(desc)}`;
}

export function daysBetween(a: string, b: string) {
  if (!a || !b) return 999;
  const A = new Date(a).getTime(), B = new Date(b).getTime();
  return Math.abs(A - B) / 86400000;
}

const SUSP_PATTERNS = ['COMISION', 'FEE', 'INTERES', 'INTERESES', 'CARGO', 'GASTO BANCO', 'RETENCION', 'ANULACION', 'AJUSTE'];

export function isSuspicious(desc: string) {
  const d = normalizeDesc(desc);
  return SUSP_PATTERNS.some(p => d.includes(p));
}

// 🧠 FUZZY SCORING: Calcula parecido entre textos
export function similarityScore(a: string, b: string) {
  const normA = normalizeDesc(a);
  const normB = normalizeDesc(b);
  if (normA.includes(normB) || normB.includes(normA)) return 100;
  
  const wordsA = normA.split(' ').filter(w => w.length > 2);
  const wordsB = normB.split(' ').filter(w => w.length > 2);
  let matches = 0;
  
  wordsA.forEach(wa => {
    if (wordsB.some(wb => wa === wb || wa.startsWith(wb) || wb.startsWith(wa))) matches++;
  });
  
  const maxWords = Math.max(wordsA.length, wordsB.length);
  return maxWords === 0 ? 0 : (matches / maxWords) * 100;
}

// -----------------------------------------
// MOTOR DE BÚSQUEDA DE COINCIDENCIAS (MATCHING)
// -----------------------------------------
export function findMatches(item: BankMovement, data: AppData) {
  if (!item) return [];
  const rawAmt = Num.parse(item.amount);
  const amt = Math.abs(rawAmt);
  const isIncome = rawAmt > 0;
  const descNorm = normalizeDesc(item.desc);
  const bankDate = item.date;
  const results: any[] = [];
  
  if (amt === 0 || !bankDate) return results;

  // ==========================================
  // 🟢 ESCENARIO INGRESOS (CAJA Y CLIENTES)
  // ==========================================
  if (isIncome) {
    // 1. Cierres TPV
    data.cierres?.forEach((c: any) => {
      if (c.conciliado_banco) return;
      const tpvDeclarado = Num.parse(c.tarjeta);
      const diferencia = tpvDeclarado - amt; 
      const porcentajeDiferencia = tpvDeclarado > 0 ? diferencia / tpvDeclarado : 0;
      const dDays = daysBetween(bankDate, c.date);

      if (diferencia >= -0.5 && porcentajeDiferencia <= CFG.MAX_COMISION_TPV && dDays <= CFG.MAX_DIAS_TPV) {
        let score = 100 - (dDays * 5);
        if (diferencia !== 0) score -= 10;
        results.push({ 
          type: 'TPV CAJA', id: c.id, date: c.date, 
          title: `Cierre ${c.date} (Comisión: ${Num.fmt(diferencia)})`, 
          amount: tpvDeclarado, realAmount: amt, comision: diferencia, color: 'emerald',
          score: Math.round(score), diff: diferencia
        });
      }
    });

    // 2. Facturas de Clientes
    data.facturas?.forEach((f: any) => {
      if (f.tipo !== 'venta' || f.reconciled) return;
      const total = Math.abs(Num.parse(f.total));
      const diff = Math.abs(total - amt);
      const textMatch = similarityScore(descNorm, f.cliente || '');
      const dDays = daysBetween(bankDate, f.date);

      if (diff <= CFG.TOLERANCIA_FIJA || (textMatch > 50 && diff <= 50)) {
        let score = 0;
        if (diff <= CFG.TOLERANCIA_FIJA) score += 60;
        score += (textMatch * 0.4);
        if (dDays > 30) score -= 20;
        results.push({ 
          type: 'FACTURA CLIENTE', id: f.id, date: f.date, 
          title: `Fac ${f.num || 'S/N'} (${f.cliente})`, 
          amount: total, color: 'teal', score: Math.round(score), diff 
        });
      }
    });

  // ==========================================
  // 🔴 ESCENARIO GASTOS (PROVEEDORES Y ALBARANES)
  // ==========================================
  } else {
    // 1. Facturas de Compra (Proveedores)
    data.facturas?.forEach((f: any) => {
      if (f.tipo !== 'compra' || f.reconciled) return;
      const total = Math.abs(Num.parse(f.total));
      const diff = Math.abs(total - amt);
      const textMatch = similarityScore(descNorm, f.prov || '');
      
      if (diff <= CFG.TOLERANCIA_FIJA || (textMatch > 50 && diff <= 10)) {
        let score = 0;
        if (diff <= CFG.TOLERANCIA_FIJA) score += 60;
        score += (textMatch * 0.4);
        results.push({ 
          type: 'FACTURA PROV', id: f.id, date: f.date, 
          title: `Fac ${f.num || 'S/N'} (${f.prov})`, 
          amount: total, color: 'rose', score: Math.round(score), diff 
        });
      }
    });

    // 2. Albaranes Sueltos y Agrupaciones
    const albaranesPendientes = (data.albaranes || []).filter((a:any) => !a.reconciled && !a.invoiced && Num.parse(a.total) > 0);
    const byProv: Record<string, any[]> = {};
    
    albaranesPendientes.forEach((a: any) => {
      const p = normalizeDesc(a.prov || 'desconocido');
      if (!byProv[p]) byProv[p] = [];
      byProv[p].push(a);
      
      const total = Math.abs(Num.parse(a.total));
      const diff = Math.abs(total - amt);
      const dDays = daysBetween(bankDate, a.date);

      if (diff <= CFG.TOLERANCIA_FIJA && dDays <= CFG.MAX_DIAS_ALB_COMPRA) {
        const textMatch = similarityScore(descNorm, p);
        const score = Math.round(60 + textMatch * 0.4);
        results.push({ 
          type: 'ALBARÁN SUELTO', id: a.id, date: a.date, 
          title: `${a.prov} (Ref: ${a.num || 'S/N'})`, 
          amount: total, color: 'amber', score, diff 
        });
      }
    });

    // Combinatoria Multi-Albarán (2 documentos)
    for (const [prov, lista] of Object.entries(byProv)) {
      if (lista.length < 2) continue;
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          const sum = Math.abs(Num.parse(lista[i].total)) + Math.abs(Num.parse(lista[j].total));
          const diff = Math.abs(sum - amt);
          if (diff <= CFG.TOLERANCIA_FIJA) {
            const textMatch = similarityScore(descNorm, prov);
            const score = Math.round(75 + textMatch * 0.25);
            results.push({
              type: 'MULTI-ALBARÁN', 
              id: `${lista[i].id},${lista[j].id}`, 
              date: lista[j].date, 
              title: `${lista[i].prov} (Agrup. 2 Albs)`, 
              amount: sum, color: 'purple', score, diff
            });
          }
        }
      }
    }

    // Combinatoria Multi-Albarán (3 documentos) - INNOVACIÓN
    for (const [prov, lista] of Object.entries(byProv)) {
      if (lista.length < 3) continue;
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          for (let k = j + 1; k < lista.length; k++) {
            const sum = Math.abs(Num.parse(lista[i].total)) + Math.abs(Num.parse(lista[j].total)) + Math.abs(Num.parse(lista[k].total));
            const diff = Math.abs(sum - amt);
            if (diff <= CFG.TOLERANCIA_FIJA) {
              const textMatch = similarityScore(descNorm, prov);
              const score = Math.round(80 + textMatch * 0.20);
              results.push({
                type: 'MULTI-ALBARÁN', 
                id: `${lista[i].id},${lista[j].id},${lista[k].id}`, 
                date: lista[k].date, 
                title: `${lista[i].prov} (Agrup. 3 Albs)`, 
                amount: sum, color: 'purple', score, diff
              });
            }
          }
        }
      }
    }

    // 3. Gastos Fijos y Nóminas
    data.gastos_fijos?.forEach((g: any) => {
      if (g.active === false) return;
      const total = Math.abs(Num.parse(g.amount));
      const diff = Math.abs(total - amt);
      const textMatch = similarityScore(descNorm, g.name);

      if (diff <= CFG.TOLERANCIA_FIJA || textMatch > 70) {
        let score = 0;
        if (diff <= CFG.TOLERANCIA_FIJA) score += 50;
        score += (textMatch * 0.5);
        results.push({ 
          type: 'GASTO FIJO', id: g.id, date: bankDate, 
          title: `Cuota Fija: ${g.name}`, 
          amount: total, color: 'rose', score: Math.round(score), diff 
        });
      }
    });
  }

  // Ordenamos por "Score" y filtramos la basura
  return results.sort((a, b) => b.score - a.score).filter(r => r.score > 30);
}

// -----------------------------------------
// EJECUTOR DE VÍNCULOS (LA MAGIA DE UNIR PUNTOS)
// -----------------------------------------
export function executeLink(newData: AppData, bankId: string, matchType: string, docId: string, comision: number = 0) {
  const bItem: any = newData.banco?.find((b: any) => b.id === bankId);
  if (!bItem) return;
  
  // 🛡️ IDEMPOTENCIA: No machacamos dos veces
  if (bItem.status === 'matched') return; 

  if (matchType.includes('TPV')) {
    const cierre = newData.cierres?.find((c: any) => c.id === docId);
    if (cierre) {
      cierre.conciliado_banco = true;
      if (comision > 0) {
        // 🚀 INNOVACIÓN: Comisiones a gastos puntuales
        if (!newData.gastos) newData.gastos = [];
        newData.gastos.push({
          id: 'gb-fee-' + Date.now(),
          date: bItem.date,
          prov: 'COMISIÓN BANCARIA TPV',
          num: `TPV-${cierre.date}`,
          total: String(Num.round2(comision)),
          base: String(Num.round2(comision)), 
          tax: "0",
          cat: 'gastos_bancarios',
          status: 'posted'
        } as any);
      }
    }
    bItem.link = { type: matchType, id: docId };

  } else if (matchType === 'MULTI-ALBARÁN') {
    const idsToGroup = docId.split(',').map(s => s.trim()).filter(Boolean);
    const albs = newData.albaranes?.filter(a => idsToGroup.includes(a.id)) || [];
    if (albs.length === 0) return;

    const first = albs[0];
    const newFacId = `fac-auto-agrup-${Date.now()}`;

    if (!newData.facturas) newData.facturas = [];
    
    // ✅ Crea factura NUMÉRICA y delega en el motor central
    newData.facturas.unshift({
      id: newFacId,
      tipo: 'compra',
      num: `AGRUP-${Date.now().toString().slice(-4)}`,
      date: first.date,
      prov: first.prov,
      total: "0", base: "0", tax: "0", 
      albaranIdsArr: [],
      paid: true, reconciled: true,
      source: 'auto-agrupacion-banco',
      status: 'reconciled',
      unidad_negocio: first.unitId || 'REST'
    } as any);

    linkAlbaranesToFactura(newData, newFacId, idsToGroup, { strategy: 'useAlbTotals' });
    
    // Cerramos los albaranes
    albs.forEach(a => { a.reconciled = true; a.paid = true; a.status = 'paid'; });

    bItem.link = { type: 'FACTURA', id: newFacId }; 

  } else if (matchType.includes('ALBARÁN')) {
    const alb = newData.albaranes?.find((a: any) => a.id === docId);
    if (alb) { alb.reconciled = true; alb.paid = true; alb.status = 'paid'; }
    bItem.link = { type: 'ALBARAN', id: docId }; 

  } else if (matchType.includes('FACTURA')) {
    const fac = newData.facturas?.find((f: any) => f.id === docId);
    if (fac) { 
      fac.reconciled = true; fac.paid = true; fac.status = 'reconciled';
      if (fac.albaranIdsArr?.length) {
        newData.albaranes?.forEach((a: any) => {
          if (fac.albaranIdsArr!.includes(a.id)) { a.reconciled = true; a.paid = true; }
        });
      }
    }
    bItem.link = { type: 'FACTURA', id: docId }; 

  } else if (matchType.includes('GASTO FIJO')) {
    const fijo = newData.gastos_fijos?.find((f: any) => f.id === docId);
    if (fijo) {
      if (!Array.isArray(newData.control_pagos)) newData.control_pagos = [];
      newData.control_pagos.push({
        id: `cp-${Date.now()}`,
        gasto_id: docId,
        date: bItem.date,
        amount: Math.abs(Num.parse(bItem.amount)),
        status: 'paid',
        note: 'Conciliado auto banco'
      } as any);
    }
    bItem.link = { type: 'GASTO_FIJO', id: docId };
  }

  // 🛡️ TRAZABILIDAD
  bItem.status = 'matched';
  bItem.matchedAt = new Date().toISOString(); 
}

// -----------------------------------------
// REVERSOR DE VÍNCULOS (UNDO LINK)
// -----------------------------------------
export function undoLink(newData: AppData, bankId: string) {
  const bItem: any = newData.banco?.find((b: any) => b.id === bankId);
  if (!bItem || !bItem.link) return;

  const { type, id } = bItem.link;

  if (type.includes('TPV')) {
    const cierre = newData.cierres?.find((c: any) => c.id === id);
    if (cierre) cierre.conciliado_banco = false;
    
    // Eliminamos el gasto puntual de comisión asociado
    if (newData.gastos) {
      const idx = newData.gastos.findIndex((g:any) => g.num === `TPV-${cierre?.date}` && g.prov === 'COMISIÓN BANCARIA TPV');
      if (idx !== -1) newData.gastos.splice(idx, 1);
    }
  } else if (type === 'FACTURA') {
    const fac = newData.facturas?.find((f: any) => f.id === id);
    if (fac) {
      fac.reconciled = false; 
      fac.status = fac.paid ? 'paid' : 'approved';
      if (fac.source === 'auto-agrupacion-banco') {
         // Destruimos la factura y liberamos albaranes
         if (fac.albaranIdsArr) {
            fac.albaranIdsArr.forEach((aId: string) => {
               const alb = newData.albaranes?.find((a:any) => a.id === aId);
               if (alb) { alb.reconciled = false; alb.paid = false; alb.status = 'warning'; alb.invoiced = false; }
            });
         }
         newData.facturas = newData.facturas.filter((f:any) => f.id !== id);
      }
    }
  } else if (type.includes('ALBARAN') || type === 'ALBARÁN' || type === 'ALBARÁN SUELTO') {
    const alb = newData.albaranes?.find((a: any) => a.id === id);
    if (alb) {
      alb.reconciled = false; alb.paid = false; alb.status = 'warning';
    }
  } else if (type === 'GASTO_FIJO' || type.includes('GASTO FIJO')) {
     if (Array.isArray(newData.control_pagos)) {
       const cpIdx = newData.control_pagos.findIndex((cp:any) => cp.gasto_id === id && cp.date === bItem.date && Math.abs(Num.parse(cp.amount)) === Math.abs(Num.parse(bItem.amount)));
       if (cpIdx !== -1) {
         newData.control_pagos.splice(cpIdx, 1);
       }
     }
  }

  // Liberamos el movimiento bancario
  bItem.status = 'pending';
  bItem.matchedAt = null;
  bItem.link = null;
}
