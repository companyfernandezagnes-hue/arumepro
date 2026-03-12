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
  const A = new Date(a).getTime(), B = new Date(b).getTime();
  return Math.abs(A - B) / 86400000;
}

const SUSP_PATTERNS = ['COMISION', 'FEE', 'INTERES', 'INTERESES', 'CARGO', 'GASTO BANCO', 'RETENCION', 'ANULACION', 'AJUSTE'];

export function isSuspicious(desc: string) {
  const d = normalizeDesc(desc);
  return SUSP_PATTERNS.some(p => d.includes(p));
}

// 2. EL MATCHING INTELIGENTE (Con tolerancia para Comisiones de TPV/Stripe)
export function findMatches(item: BankMovement, data: AppData) {
  if (!item) return [];
  const amt = Math.abs(Num.parse(item.amount));
  const descNorm = normalizeDesc(item.desc);
  const results: any[] = [];
  
  const TOLERANCIA_FIJA = 1.00; // 1€ para facturas y albaranes
  const TOLERANCIA_NOMBRE = 10.00; // Si el nombre coincide, toleramos 10€
  const MAX_COMISION_TPV = 0.03; // 3% máximo de comisión permitida para TPV/Glovo/Stripe

  if (Num.parse(item.amount) > 0) {
    // INGRESOS: Buscar en Cierres de Caja (Soportando la comisión del banco)
    data.cierres?.forEach((c: any) => {
      if (!c.conciliado_banco) {
        const tpvDeclarado = Num.parse(c.tarjeta);
        const diferencia = tpvDeclarado - amt; // Lo que falta (la comisión)
        const porcentajeDiferencia = tpvDeclarado > 0 ? diferencia / tpvDeclarado : 0;

        // Si el ingreso es exacto o tiene una comisión de hasta el 3%
        if (diferencia >= -0.5 && porcentajeDiferencia <= MAX_COMISION_TPV) {
          results.push({ 
            type: 'TPV CAJA', id: c.id, date: c.date, 
            title: `Cierre ${c.date} (Comisión: ${Num.fmt(diferencia)})`, 
            amount: tpvDeclarado, realAmount: amt, comision: diferencia, color: 'emerald' 
          });
        }
      }
    });

    // INGRESOS: Buscar en Facturas a Clientes
    data.facturas?.forEach((f: any) => {
      if (f.cliente !== "Z DIARIO" && !f.reconciled && Num.parse(f.total) > 0) {
        const matchImporte = Math.abs(Num.parse(f.total) - amt) <= TOLERANCIA_FIJA;
        const matchNombre = descNorm.includes(normalizeDesc(f.cliente));
        if (matchImporte || (matchNombre && Math.abs(Num.parse(f.total) - amt) <= TOLERANCIA_NOMBRE)) {
          results.push({ type: 'FACTURA CLIENTE', id: f.id, date: f.date, title: `Fac ${f.num} (${f.cliente})`, amount: Num.parse(f.total), color: 'teal' });
        }
      }
    });

  } else {
    // GASTOS: Albaranes
    data.albaranes?.forEach((a: any) => {
      if (!a.reconciled && Num.parse(a.total) > 0) {
        const matchImporte = Math.abs(Num.parse(a.total) - amt) <= TOLERANCIA_FIJA;
        const matchNombre = descNorm.includes(normalizeDesc(a.prov));
        if (matchImporte || (matchNombre && Math.abs(Num.parse(a.total) - amt) <= TOLERANCIA_NOMBRE)) {
          results.push({ type: 'ALBARÁN SUELTO', id: a.id, date: a.date, title: `${a.prov} (${a.num})`, amount: Num.parse(a.total), color: 'indigo' });
        }
      }
    });

    // GASTOS: Facturas de Proveedores
    data.facturas?.forEach((f: any) => {
      if (Num.parse(f.total) > 0 && !f.reconciled) {
        const matchImporte = Math.abs(Num.parse(f.total) - amt) <= TOLERANCIA_FIJA;
        const matchNombre = descNorm.includes(normalizeDesc(f.prov));
        if (matchImporte || (matchNombre && Math.abs(Num.parse(f.total) - amt) <= TOLERANCIA_NOMBRE)) {
          results.push({ type: 'FACTURA PROV', id: f.id, date: f.date, title: `Fac ${f.num} (${f.prov})`, amount: Num.parse(f.total), color: 'rose' });
        }
      }
    });

    // GASTOS: Gastos Fijos y Nóminas
    data.gastos_fijos?.forEach((g: any) => {
      if (g.active !== false && Math.abs(Num.parse(g.amount) - amt) <= TOLERANCIA_FIJA) {
        results.push({ type: 'GASTO FIJO/NÓMINA', id: g.id, date: item.date, title: g.name, amount: Num.parse(g.amount), color: 'amber' });
      }
    });
  }

  return results.sort((a, b) => Math.abs(a.amount - amt) - Math.abs(b.amount - amt));
}

// 3. EJECUTAR EL ENLACE UNIVERSAL (Registra la comisión si es necesario)
export function executeLink(newData: AppData, bankId: string, matchType: string, docId: string, comision: number = 0) {
  const bItem: any = newData.banco?.find((b: any) => b.id === bankId);
  if (!bItem) return;

  if (matchType.includes('ALBARÁN')) {
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
      // SI HAY COMISIÓN DEL BANCO, LA REGISTRAMOS COMO GASTO FIJO AUTOMÁTICO
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
