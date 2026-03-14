import { AppData, BankMovement } from '../types';
import { Num } from './engine';

// 1. UTILIDADES BÁSICAS
export function normalizeDesc(s = '') {
  return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u00A0\u202F\s]+/g, ' ').trim();
}

export function fingerprint(date: string, amount: number, desc: string) {
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

// 🧠 1.5. FUZZY SCORING: Calcula qué tan parecidos son dos textos
function similarityScore(a: string, b: string) {
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

// 2. EL MATCHING INTELIGENTE (Ahora con Multi-Match y Scoring)
export function findMatches(item: BankMovement, data: AppData) {
  if (!item) return [];
  const rawAmt = Num.parse(item.amount);
  const amt = Math.abs(rawAmt);
  const isIncome = rawAmt > 0;
  const descNorm = normalizeDesc(item.desc);
  const bankDate = item.date;
  const results: any[] = [];
  
  const TOLERANCIA_FIJA = 1.05; // Margen de céntimos tolerado universal
  const MAX_COMISION_TPV = 0.03; // 3% máximo

  // ==========================================
  // 🟢 ESCENARIO INGRESOS (CAJA Y CLIENTES)
  // ==========================================
  if (isIncome) {
    
    // 1. Cierres de TPV (Admite comisiones ocultas)
    data.cierres?.forEach((c: any) => {
      if (c.conciliado_banco) return;
      const tpvDeclarado = Num.parse(c.tarjeta);
      const diferencia = tpvDeclarado - amt; 
      const porcentajeDiferencia = tpvDeclarado > 0 ? diferencia / tpvDeclarado : 0;
      const dDays = daysBetween(bankDate, c.date);

      if (diferencia >= -0.5 && porcentajeDiferencia <= MAX_COMISION_TPV && dDays <= 5) {
        let score = 100 - (dDays * 5); // Penaliza si el ingreso tarda muchos días
        if (diferencia !== 0) score -= 10; // Penaliza levemente si no es exacto
        
        results.push({ 
          type: 'TPV CAJA', id: c.id, date: c.date, 
          title: `Cierre ${c.date} (Comisión: ${Num.fmt(diferencia)})`, 
          amount: tpvDeclarado, realAmount: amt, comision: diferencia, color: 'emerald',
          score: Math.round(score), diff: diferencia
        });
      }
    });

    // 2. Facturas de Clientes (Exactas o por Nombre)
    data.facturas?.forEach((f: any) => {
      if (f.tipo !== 'venta' || f.reconciled) return;
      
      const total = Math.abs(Num.parse(f.total));
      const diff = Math.abs(total - amt);
      const textMatch = similarityScore(descNorm, f.cliente || '');
      const dDays = daysBetween(bankDate, f.date);

      if (diff <= TOLERANCIA_FIJA || (textMatch > 50 && diff <= 50)) { // Flexibilidad si el nombre cuadra
        let score = 0;
        if (diff <= TOLERANCIA_FIJA) score += 60; // El importe es el rey
        score += (textMatch * 0.4); // El nombre ayuda hasta 40 pts
        if (dDays > 30) score -= 20; // Penalización por fecha muy lejana

        results.push({ 
          type: 'FACTURA CLIENTE', id: f.id, date: f.date, 
          title: `Fac ${f.num} (${f.cliente})`, 
          amount: total, color: 'teal', score: Math.round(score), diff 
        });
      }
    });

  // ==========================================
  // 🔴 ESCENARIO GASTOS (PROVEEDORES Y ALBARANES)
  // ==========================================
  } else {
    
    // 1. Albaranes Sueltos Individuales
    const albaranesPendientes = (data.albaranes || []).filter((a:any) => !a.reconciled && !a.invoiced && Num.parse(a.total) > 0);
    
    albaranesPendientes.forEach((a: any) => {
      const total = Math.abs(Num.parse(a.total));
      const diff = Math.abs(total - amt);
      const textMatch = similarityScore(descNorm, a.prov || '');
      const dDays = daysBetween(bankDate, a.date);

      if (diff <= TOLERANCIA_FIJA || (textMatch > 60 && diff <= 10)) {
        let score = 0;
        if (diff <= TOLERANCIA_FIJA) score += 60;
        score += (textMatch * 0.4);
        if (dDays > 15) score -= 10;

        results.push({ 
          type: 'ALBARÁN SUELTO', id: a.id, date: a.date, 
          title: `${a.prov} (${a.num})`, 
          amount: total, color: 'indigo', score: Math.round(score), diff 
        });
      }
    });

    // 🌟 INNOVACIÓN: Búsqueda Multi-Albarán (Combinatoria simple)
    // Agrupamos albaranes pendientes por proveedor
    const albaranesPorProv = albaranesPendientes.reduce((acc: any, a: any) => {
      const provNorm = normalizeDesc(a.prov);
      if (!acc[provNorm]) acc[provNorm] = [];
      acc[provNorm].push(a);
      return acc;
    }, {});

    // Para cada proveedor, buscamos si la suma de 2 o 3 albaranes cuadra con el banco
    for (const prov in albaranesPorProv) {
      const lista = albaranesPorProv[prov];
      if (lista.length < 2) continue; // Necesitamos al menos 2 para combinar

      // Evaluamos pares (A + B)
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          const sum = Math.abs(Num.parse(lista[i].total)) + Math.abs(Num.parse(lista[j].total));
          const diff = Math.abs(sum - amt);
          
          if (diff <= TOLERANCIA_FIJA) {
            const textMatch = similarityScore(descNorm, prov);
            let score = 70 + (textMatch * 0.3); // Mayor base porque cuadra la suma exacta
            
            results.push({
              type: 'MULTI-ALBARÁN', 
              id: `${lista[i].id},${lista[j].id}`, // Mandamos ambos IDs separados por coma
              date: lista[j].date, // Fecha del más reciente
              title: `${lista[i].prov} (Agrupación de 2 Albaranes)`, 
              amount: sum, color: 'purple', score: Math.round(score), diff
            });
          }
        }
      }
    }

    // 2. Facturas de Proveedores
    data.facturas?.forEach((f: any) => {
      if (f.tipo !== 'compra' || f.reconciled) return;
      
      const total = Math.abs(Num.parse(f.total));
      const diff = Math.abs(total - amt);
      const textMatch = similarityScore(descNorm, f.prov || '');
      
      if (diff <= TOLERANCIA_FIJA || (textMatch > 50 && diff <= 10)) {
        let score = 0;
        if (diff <= TOLERANCIA_FIJA) score += 60;
        score += (textMatch * 0.4);
        
        results.push({ 
          type: 'FACTURA PROV', id: f.id, date: f.date, 
          title: `Fac ${f.num} (${f.prov})`, 
          amount: total, color: 'rose', score: Math.round(score), diff 
        });
      }
    });

    // 3. Gastos Fijos y Nóminas
    data.gastos_fijos?.forEach((g: any) => {
      if (g.active === false) return;
      const total = Math.abs(Num.parse(g.amount));
      const diff = Math.abs(total - amt);
      const textMatch = similarityScore(descNorm, g.name);

      if (diff <= TOLERANCIA_FIJA || textMatch > 70) {
        let score = 0;
        if (diff <= TOLERANCIA_FIJA) score += 50;
        score += (textMatch * 0.5);

        results.push({ 
          type: 'GASTO FIJO/NÓMINA', id: g.id, date: bankDate, 
          title: g.name, 
          amount: total, color: 'amber', score: Math.round(score), diff 
        });
      }
    });
  }

  // Ordenamos por "Score" (El más probable arriba del todo)
  return results.sort((a, b) => b.score - a.score).filter(r => r.score > 30); // Descartamos la basura
}

// 3. EJECUTAR EL ENLACE UNIVERSAL (Modificado para soportar MULTI-ALBARÁN)
export function executeLink(newData: AppData, bankId: string, matchType: string, docId: string, comision: number = 0) {
  const bItem: any = newData.banco?.find((b: any) => b.id === bankId);
  if (!bItem) return;

  if (matchType === 'MULTI-ALBARÁN') {
    // 🌟 Lógica Especial: Creamos una factura al vuelo con los albaranes seleccionados
    const idsToGroup = docId.split(',');
    const albs = newData.albaranes?.filter(a => idsToGroup.includes(a.id)) || [];
    
    if (albs.length > 0) {
      const newFacId = `fac-auto-agrup-${Date.now()}`;
      let totalSuma = 0; let baseSuma = 0; let taxSuma = 0;
      
      albs.forEach(a => {
        a.reconciled = true; a.paid = true; a.status = 'paid'; a.invoiced = true;
        totalSuma += Math.abs(Num.parse(a.total));
        baseSuma += Math.abs(Num.parse(a.base));
        taxSuma += Math.abs(Num.parse(a.taxes));
      });

      if (!newData.facturas) newData.facturas = [];
      newData.facturas.unshift({
        id: newFacId, tipo: 'compra', num: `AGRUP-${Date.now().toString().slice(-4)}`,
        date: albs[0].date, prov: albs[0].prov,
        total: String(totalSuma), base: String(baseSuma), tax: String(taxSuma),
        albaranIdsArr: idsToGroup,
        paid: true, reconciled: true, source: 'auto-agrupacion-banco', status: 'reconciled', unidad_negocio: albs[0].unitId || 'REST'
      } as any);

      bItem.link = { type: 'FACTURA', id: newFacId }; 
    }
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
          if (fac.albaranIdsArr.includes(a.id)) { a.reconciled = true; a.paid = true; }
        });
      }
    }
    bItem.link = { type: 'FACTURA', id: docId }; 
  } else if (matchType.includes('GASTO FIJO')) {
    const d = new Date(bItem.date);
    const monthKey = `pagos_${d.getFullYear()}_${d.getMonth() + 1}`;
    if (!newData.control_pagos) newData.control_pagos = {};
    if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
    if (!newData.control_pagos[monthKey].includes(docId)) newData.control_pagos[monthKey].push(docId);
    bItem.link = { type: 'FIXED_EXPENSE', id: docId };
  } else if (matchType === 'TPV CAJA') {
    const cierre = newData.cierres?.find((c: any) => c.id === docId);
    if (cierre) {
      cierre.conciliado_banco = true;
      if (comision > 0) {
        if (!newData.gastos_fijos) newData.gastos_fijos = [];
        const comisionId = 'gf-comision-' + Date.now();
        newData.gastos_fijos.push({
          id: comisionId, name: `Comisión TPV Cierre ${cierre.date}`, amount: comision, 
          freq: 'puntual', dia_pago: new Date(bItem.date).getDate(), cat: 'varios', active: false
        });
        const d = new Date(bItem.date);
        const monthKey = `pagos_${d.getFullYear()}_${d.getMonth() + 1}`;
        if (!newData.control_pagos) newData.control_pagos = {};
        if (!newData.control_pagos[monthKey]) newData.control_pagos[monthKey] = [];
        newData.control_pagos[monthKey].push(comisionId);
      }
    }
    bItem.link = { type: 'TPV', id: docId };
  }

  bItem.status = 'matched';
}
