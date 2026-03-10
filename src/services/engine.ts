import { AppData, GastoFijo, Activo, Albaran, Factura, Cierre } from "../types";

/* ===========================
 * 🔢 NUMÉRICAS ROBUSTAS 
 * =========================== */
export const Num = {
  parse: (val: unknown): number => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === "number" && Number.isFinite(val)) return val;

    let s = String(val).trim();

    // Soporte para paréntesis contables (100) -> -100
    let negative = false;
    if (s.startsWith("(") && s.endsWith(")")) {
      negative = true;
      s = s.slice(1, -1);
    }

    // Limpieza de caracteres no numéricos
    s = s.replace(/[^\d.,\-+]/g, "").replace(/[\s']/g, "");

    const sign = s.includes("-") ? -1 : 1;
    s = s.replace(/[+-]/g, "");

    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    let decimalSep: "." | "," | null = null;

    if (lastDot >= 0 || lastComma >= 0) {
      if (lastDot > lastComma) decimalSep = ".";
      else if (lastComma > lastDot) decimalSep = ",";
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
    }).format(Number.isFinite(val) ? val : 0),

  round2: (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100,
};

/* ===========================
 * 📅 FECHAS ROBUSTAS
 * =========================== */
export const DateUtil = {
  today: (): string => new Date().toISOString().split("T")[0],

  getMonthBounds: (month: number, year: number) => {
    // month viene de 1 a 12
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    return { start, end };
  },

  parse: (d: any): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    const s = String(d).trim();
    // Soporte ISO y formato DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
      const [dd, mm, yyyy] = s.split("/");
      return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    }
    const date = new Date(s);
    return isNaN(date.getTime()) ? new Date() : date;
  },
};

/* ===========================
 * 📈 CÁLCULOS ERP
 * =========================== */
export function calcularAmortizacionMensual(activos: Activo[] = []): number {
  const hoy = new Date();
  let total = 0;
  for (const a of activos) {
    const importe = Num.parse(a.importe);
    const vida = Number(a.vida_util_meses) || 0;
    const fCompra = DateUtil.parse(a.fecha_compra);

    if (importe <= 0 || vida <= 0) continue;

    const mesesTranscurridos = (hoy.getFullYear() - fCompra.getFullYear()) * 12 + (hoy.getMonth() - fCompra.getMonth());
    if (mesesTranscurridos >= 0 && mesesTranscurridos < vida) {
      total += importe / vida;
    }
  }
  return Num.round2(total);
}

export const ArumeEngine = {
  calcularImpuestos: (totalConIva: number, tipoIva: 4 | 10 | 21 = 10) => {
    const total = Num.parse(totalConIva);
    const base = total / (1 + (tipoIva / 100));
    return { 
      base: Num.round2(base), 
      cuota: Num.round2(total - base), 
      total: Num.round2(total) 
    };
  },

  getProfit: (data: AppData, month: number, year: number) => {
    const { start, end } = DateUtil.getMonthBounds(month, year);
    const sMs = start.getTime();
    const eMs = end.getTime();

    const unitBreakdown: Record<string, { income: number; expenses: number; profit: number }> = {
      REST: { income: 0, expenses: 0, profit: 0 },
      DLV: { income: 0, expenses: 0, profit: 0 },
      SHOP: { income: 0, expenses: 0, profit: 0 },
      CORP: { income: 0, expenses: 0, profit: 0 },
    };

    // 1. INGRESOS (Z + Facturas)
    let cajaZ = 0, facturasB2B = 0;

    (data.cierres || []).forEach(c => {
      const d = DateUtil.parse(c.date).getTime();
      if (d >= sMs && d <= eMs) {
        const val = Num.parse(c.totalVenta);
        cajaZ += val;
        const u = c.unitId || 'REST';
        if (unitBreakdown[u]) unitBreakdown[u].income += val;
      }
    });

    (data.facturas || []).forEach(f => {
      const d = DateUtil.parse(f.date).getTime();
      if (d < sMs || d > eMs) return;
      const val = Num.parse(f.total);
      const isZ = String(f.num || "").toUpperCase().startsWith("Z");
      const u = (f as any).unidad_negocio || 'REST';

      if (!isZ && f.cliente !== 'Z DIARIO') {
        if (u === 'DLV') facturasB2B += val;
        if (unitBreakdown[u]) unitBreakdown[u].income += val;
      }
    });

    // 2. GASTOS (Albaranes)
    let gComida = 0, gBebida = 0, gOtros = 0;
    (data.albaranes || []).forEach(a => {
      const d = DateUtil.parse(a.date).getTime();
      if (d < sMs || d > eMs) return;

      const total = Num.parse(a.total);
      const prov = String(a.prov || "").toLowerCase();
      const cat = String((a as any).category || "").toLowerCase();
      const u = a.unitId || 'REST';

      if (cat === 'comida' || prov.match(/fruta|carne|pesca|makro|pan|huevo|aliment|chef|gourmet/)) {
        gComida += total;
      } else if (cat === 'bebida' || prov.match(/estrella|mahou|coca|vino|licor|bodega|cervez|sake/)) {
        gBebida += total;
      } else {
        gOtros += total;
      }
      if (unitBreakdown[u]) unitBreakdown[u].expenses += total;
    });

    // 3. GASTOS FIJOS Y AMORTIZACIÓN
    let gPersonal = 0, gEstructura = 0;
    (data.gastos_fijos || []).forEach(g => {
      if (g.active === false) return;
      let val = Num.parse(g.amount);
      const freq = String(g.freq || "").toLowerCase();
      if (freq === 'anual') val /= 12;
      else if (freq === 'trimestral') val /= 3;
      else if (freq === 'semanal') val *= 4.33;

      if (g.cat === 'personal') gPersonal += val;
      else gEstructura += val;

      const u = g.unitId || 'REST';
      if (unitBreakdown[u]) unitBreakdown[u].expenses += val;
    });

    const gAmort = calcularAmortizacionMensual(data.activos);
    unitBreakdown['CORP'].expenses += gAmort;

    const totalIngresos = Num.round2(cajaZ + facturasB2B);
    const totalGastos = Num.round2(gComida + gBebida + gOtros + gPersonal + gEstructura + gAmort);

    // 4. RATIOS Y FINALIZACIÓN
    Object.keys(unitBreakdown).forEach(k => {
      unitBreakdown[k].profit = Num.round2(unitBreakdown[k].income - unitBreakdown[k].expenses);
    });

    const safeDiv = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

    return {
      ingresos: { total: totalIngresos, caja: Num.round2(cajaZ), b2b: Num.round2(facturasB2B) },
      gastos: { total: totalGastos, comida: gComida, bebida: gBebida, personal: gPersonal, estructura: gEstructura, amortizacion: gAmort },
      neto: Num.round2(totalIngresos - totalGastos),
      unitBreakdown,
      ratios: {
        foodCost: Num.round2(safeDiv(gComida, totalIngresos)),
        staffCost: Num.round2(safeDiv(gPersonal, totalIngresos)),
        primeCost: Num.round2(safeDiv(gComida + gBebida + gPersonal, totalIngresos))
      }
    };
  }
};
