import { AppData, GastoFijo, Activo } from "../types";

/* ===========================
 * NUMÉRICAS ROBUSTAS (A prueba de bombas)
 * =========================== */
export const Num = {
  parse: (val: unknown): number => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === "number" && Number.isFinite(val)) return val;

    let s = String(val).trim();

    // Paréntesis contables -> negativo (Ej: (100) -> -100)
    let negative = false;
    if (s.startsWith("(") && s.endsWith(")")) {
      negative = true;
      s = s.slice(1, -1);
    }

    // Quitar moneda y signos no numéricos (excepto . , -)
    s = s.replace(/[^\d.,\-+]/g, "").replace(/[\u00A0\u202F\s']/g, "");

    const sign = s.includes("-") ? -1 : 1;
    s = s.replace(/[+-]/g, "");

    // Detección de separador decimal automático
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    let decimalSep: "." | "," | null = null;

    if (lastDot >= 0 || lastComma >= 0) {
      if (lastDot > lastComma) decimalSep = ".";
      else if (lastComma > lastDot) decimalSep = ",";
      else decimalSep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    }

    if (decimalSep === ",") {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (decimalSep === ".") {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(/[.,]/g, "");
    }

    const n = parseFloat(s);
    const final = (negative ? -1 : 1) * sign * (Number.isFinite(n) ? n : 0);
    return isNaN(final) ? 0 : final;
  },

  fmt: (val: number): string =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(val) ? val : 0),

  round2: (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100,
};

/* ===========================
 * FECHAS ROBUSTAS
 * =========================== */
export const DateUtil = {
  today: (): string => new Date().toISOString().split("T")[0],

  getMonthBounds: (month: number, year: number) => {
    const m = month >= 1 && month <= 12 ? month - 1 : month; // normalizar
    const start = new Date(year, m, 1);
    const end = new Date(year, m + 1, 0);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  },

  parse: (d: any): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (typeof d === "number") return new Date(d);

    const s = String(d).trim();
    const mEU = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
    const mISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

    let y = 0, m = 0, day = 0;
    if (mEU.test(s)) {
      const [, dd, mm, yyyy] = s.match(mEU)!;
      y = Number(yyyy.length === 2 ? "20" + yyyy : yyyy);
      m = Number(mm) - 1;
      day = Number(dd);
      return new Date(y, m, day);
    }
    if (mISO.test(s)) {
      const [, yyyy, mm, dd] = s.match(mISO)!;
      y = Number(yyyy);
      m = Number(mm) - 1;
      day = Number(dd);
      return new Date(y, m, day);
    }
    return new Date(s);
  },
};

export function calcularAmortizacionMensual(activos: Activo[]): number {
  if (!activos || activos.length === 0) return 0;
  let total = 0;
  const hoy = new Date();
  for (const a of activos) {
    const importe = Num.parse(a?.importe);
    const vida = Number(a?.vida_util_meses);
    const fCompra = DateUtil.parse(a?.fecha_compra);

    if (!(importe > 0) || !(vida > 0) || isNaN(fCompra.getTime())) continue;

    const meses = (hoy.getFullYear() - fCompra.getFullYear()) * 12 + (hoy.getMonth() - fCompra.getMonth());
    if (meses >= 0 && meses < vida) {
      total += importe / vida;
    }
  }
  return Num.round2(total);
}

/* ===========================
 * MOTOR PRINCIPAL (ARUME MULTI-LOCAL ENGINE)
 * =========================== */
export const ArumeEngine = {
  // Calculadora de impuestos usada en Albaranes
  calcularImpuestos: (totalConIva: number, tipoIva: 4 | 10 | 21 = 10) => {
    const total = Num.parse(totalConIva);
    const base = total / (1 + (tipoIva / 100));
    const cuota = total - base;
    return { 
      base: Num.round2(base), 
      cuota: Num.round2(cuota), 
      total: Num.round2(total) 
    };
  },

  getProfit: (data: AppData, month: number, year: number) => {
    const { start, end } = DateUtil.getMonthBounds(month, year);
    const sMs = start.getTime();
    const eMs = end.getTime();

    // 🚀 ESTRUCTURA BASE MULTI-UNIDAD
    const unitBreakdown: Record<string, { income: number; expenses: number; profit: number }> = {
      REST: { income: 0, expenses: 0, profit: 0 },
      DLV: { income: 0, expenses: 0, profit: 0 },
      SHOP: { income: 0, expenses: 0, profit: 0 },
      CORP: { income: 0, expenses: 0, profit: 0 },
    };

    // A. INGRESOS (Cajas Z + Facturas de Catering)
    let cajaZ = 0, facturasB2B = 0;
    
    // 1. Cajas Z (Restaurante y Tienda)
    for (const c of (data.cierres || [])) {
      const d = DateUtil.parse(c.date).getTime();
      if (d >= sMs && d <= eMs) {
        const val = Num.parse(c.totalVenta);
        cajaZ += val;
        
        const u = c.unitId || 'REST';
        if (unitBreakdown[u] && u !== 'DLV') { // DLV no usa TPV
          unitBreakdown[u].income += val;
        }
      }
    }

    // 2. Facturas de Catering B2B (Solo suman los ingresos de la unidad DLV y clientes reales)
    for (const f of (data.facturas || [])) {
      const d = DateUtil.parse(f.date).getTime();
      if (d < sMs || d > eMs) continue;
      
      const val = Num.parse(f.total);
      const isZ = String(f.num ?? "").toUpperCase().startsWith("Z");
      const isIngreso = val > 0; // Evitamos facturas rectificativas si no aplican
      const u = (f as any).unidad_negocio || 'REST';

      if (!isZ && isIngreso && f.cliente !== 'Z DIARIO') {
        if (u === 'DLV') {
          facturasB2B += val;
        }
        if (unitBreakdown[u]) {
          unitBreakdown[u].income += val;
        }
      }
    }

    const totalIngresos = Num.round2(cajaZ + facturasB2B);

    // B. GASTOS VARIABLES (Albaranes)
    let gComida = 0, gBebida = 0, gOtros = 0;
    for (const a of (data.albaranes || [])) {
      const d = DateUtil.parse(a.date).getTime();
      if (d < sMs || d > eMs) continue;

      const total = Num.parse(a.total);
      const prov = String(a.prov || "").toLowerCase();
      const cat = String((a as any).category || "").toLowerCase();
      const u = a.unitId || 'REST'; // Si no tiene, por defecto a Restaurante

      if (cat === 'comida' || prov.match(/fruta|carne|pesca|makro|mercadona|pan|huevo|verdu|aliment|chef|congelad|lidl|dia|eroski|assortiment|gourmet/)) {
        gComida += total;
      } else if (cat === 'bebida' || prov.match(/estrella|mahou|coca|vino|bebida|licor|bodega|drinks|cervez|agua|cafe|schweppes|pepsi|sake/)) {
        gBebida += total;
      } else {
        gOtros += total;
      }

      // Sumamos al bloque correspondiente
      if (unitBreakdown[u]) {
        unitBreakdown[u].expenses += total;
      }
    }

    // C. GASTOS FIJOS (Se asumen devengados siempre para calcular rentabilidad real)
    let gPersonal = 0, gEstructura = 0;
    for (const g of (data.gastos_fijos || [])) {
      if (g.active === false) continue;

      let val = Num.parse(g.amount);
      const freq = String(g.freq || "").toLowerCase();
      
      if (freq === 'anual') val /= 12;
      else if (freq === 'semestral') val /= 6;
      else if (freq === 'trimestral') val /= 3;
      else if (freq === 'bimensual') val /= 2;
      else if (freq === 'semanal') val *= 4.33;

      if (g.cat === 'personal') gPersonal += val;
      else gEstructura += val;

      const u = g.unitId || 'REST';
      if (unitBreakdown[u]) {
        unitBreakdown[u].expenses += val;
      }
    }

    // D. AMORTIZACIONES (Se las solemos cargar al corporativo o divididas)
    const gAmort = calcularAmortizacionMensual(data.activos);
    unitBreakdown['CORP'].expenses += gAmort; // Por defecto al bloque Socios/Corporativo

    const totalGastos = Num.round2(gComida + gBebida + gOtros + gPersonal + gEstructura + gAmort);

    // E. CALCULAR BENEFICIOS NETOS POR BLOQUE
    Object.keys(unitBreakdown).forEach(k => {
      unitBreakdown[k].income = Num.round2(unitBreakdown[k].income);
      unitBreakdown[k].expenses = Num.round2(unitBreakdown[k].expenses);
      unitBreakdown[k].profit = Num.round2(unitBreakdown[k].income - unitBreakdown[k].expenses);
    });

    // Ratios
    const safeDiv = (num: number, den: number) => (den ? num / den : 0);
    
    return {
      ingresos: { total: totalIngresos, caja: Num.round2(cajaZ), b2b: Num.round2(facturasB2B) },
      gastos: { 
        total: totalGastos, comida: Num.round2(gComida), bebida: Num.round2(gBebida), 
        personal: Num.round2(gPersonal), otros: Num.round2(gOtros), 
        estructura: Num.round2(gEstructura), amortizacion: Num.round2(gAmort) 
      },
      neto: Num.round2(totalIngresos - totalGastos),
      unitBreakdown, // 🚀 AHORA EL DASHBOARD RECIBE ESTO PERFECTAMENTE CALCULADO
      ratios: {
        foodCost: Num.round2(safeDiv(gComida, totalIngresos) * 100),
        drinkCost: Num.round2(safeDiv(gBebida, totalIngresos) * 100),
        staffCost: Num.round2(safeDiv(gPersonal, totalIngresos) * 100),
        primeCost: Num.round2(safeDiv(gComida + gBebida + gPersonal, totalIngresos) * 100)
      }
    };
  }
};
