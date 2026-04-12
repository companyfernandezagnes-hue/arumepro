import { AppData, GastoFijo, Activo, Albaran, Factura, Cierre } from "../types";

/* ===========================
 * 🔢 NUMÉRICAS ROBUSTAS
  =========================== */
export const Num = {
  parse: (val: unknown): number => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === "number" && Number.isFinite(val)) return val;
    let s = String(val).trim();
    let isNegative = s.includes("-") || (s.startsWith("(") && s.endsWith(")"));
    s = s.replace(/[^\d.,]/g, "");
    if (!s) return 0;
    const lastDot   = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    let integerPart = s;
    let decimalPart = "00";
    if (lastDot > -1 && lastComma > -1) {
      const decimalSep = lastDot > lastComma ? lastDot : lastComma;
      integerPart = s.substring(0, decimalSep).replace(/[.,]/g, "");
      decimalPart = s.substring(decimalSep + 1).replace(/[.,]/g, "");
    } else if (lastDot > -1 || lastComma > -1) {
      const sepIndex = Math.max(lastDot, lastComma);
      const afterSep = s.substring(sepIndex + 1);
      if (afterSep.length === 3) {
        integerPart = s.replace(/[.,]/g, "");
        decimalPart = "00";
      } else {
        integerPart = s.substring(0, sepIndex).replace(/[.,]/g, "");
        decimalPart = afterSep;
      }
    }
    const finalNum = parseFloat(`${integerPart}.${decimalPart}`);
    const result   = isNaN(finalNum) ? 0 : finalNum;
    return isNegative ? -result : result;
  },
  fmt: (val: number | string | null | undefined): string => {
    const n = typeof val === 'number' && Number.isFinite(val) ? val : Num.parse(val);
    return new Intl.NumberFormat("es-ES", {
      style: "currency", currency: "EUR", minimumFractionDigits: 2, useGrouping: true,
    }).format(Number.isFinite(n) ? n : 0);
  },
  round2: (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100,
  pct: (part: number, total: number): number =>
    total > 0 ? Num.round2((part / total) * 100) : 0,
};

/* ===========================
 * 📅 FECHAS ROBUSTAS
  =========================== */
export const DateUtil = {
  today: (): string => new Date().toISOString().split("T")[0],
  getMonthBounds: (month: number, year: number) => {
    // month es 1-12
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end   = new Date(year, month,     0, 23, 59, 59, 999);
    return { start, end };
  },
  parse: (d: any): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    const s = String(d).trim();
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
  =========================== */
export function calcularAmortizacionMensual(activos: Activo[] = []): number {
  if (!activos || !Array.isArray(activos)) return 0;
  const hoy   = new Date();
  let total   = 0;
  for (const a of activos) {
    const importe = Num.parse(a.importe);
    const vida    = Number(a.vida_util_meses) || 0;
    const fCompra = DateUtil.parse(a.fecha_compra);
    if (importe <= 0 || vida <= 0) continue;
    const meses = (hoy.getFullYear() - fCompra.getFullYear()) * 12 + (hoy.getMonth() - fCompra.getMonth());
    if (meses >= 0 && meses < vida) total += importe / vida;
  }
  return Num.round2(total);
}

/* ===========================
 * 🏷️ CLASIFICADOR DE GASTO FIJO
 * Helper centralizado — usado por engine, dashboard y cierre
  =========================== */
export function clasificarGastoFijo(g: any): 'personal' | 'estructura' {
  const gType = String(g?.type  || '').toLowerCase();
  const gCat  = String(g?.cat   || '').toLowerCase();
  const gName = String(g?.name  || g?.concepto || g?.categoria || '').toLowerCase();
  if (
    gType === 'payroll' ||
    gCat  === 'personal' ||
    gName.match(/nomina|nómina|seguridad social|irpf|sueldo|payroll|personal/)
  ) return 'personal';
  return 'estructura';
}

export const ArumeEngine = {
  calcularImpuestos: (totalConIva: number, tipoIva: 4 | 10 | 21 = 10) => {
    const total = Num.parse(totalConIva);
    const base  = total / (1 + tipoIva / 100);
    return {
      base  : Num.round2(base),
      cuota : Num.round2(total - base),
      total : Num.round2(total),
    };
  },

  getProfit: (data: AppData, month: number, year: number) => {
    const empty = {
      ingresos: { total: 0, caja: 0, b2b: 0 },
      gastos  : { total: 0, comida: 0, bebida: 0, personal: 0, estructura: 0, amortizacion: 0 },
      neto    : 0,
      unitBreakdown: {} as Record<string, { income: number; expenses: number; profit: number }>,
      ratios  : { foodCost: 0, staffCost: 0, primeCost: 0 },
    };
    if (!data) return empty;

    const { start, end } = DateUtil.getMonthBounds(month, year);
    const sMs = start.getTime();
    const eMs = end.getTime();

    const unitBreakdown: Record<string, { income: number; expenses: number; profit: number }> = {
      REST: { income: 0, expenses: 0, profit: 0 },
      DLV : { income: 0, expenses: 0, profit: 0 },
      SHOP: { income: 0, expenses: 0, profit: 0 },
      CORP: { income: 0, expenses: 0, profit: 0 },
    };

    // ── 1. INGRESOS ────────────────────────────────────────
    let cajaZ = 0, facturasB2B = 0;
    (data.cierres || []).forEach(c => {
      const d = DateUtil.parse(c.date).getTime();
      if (d < sMs || d > eMs) return;
      // ✅ FIX: lee todos los alias del campo de venta
      const val = Num.parse(
        (c as any).totalVenta ?? (c as any).totalVentas ??
        (c as any).total_calculado ?? (c as any).total_real ??
        (c as any).total ?? 0
      );
      cajaZ += val;
      const u = (c as any).unitId || (c as any).unidad_negocio || 'REST';
      if (unitBreakdown[u]) unitBreakdown[u].income += val;
    });

    (data.facturas || []).forEach(f => {
      const d = DateUtil.parse(f.date).getTime();
      if (d < sMs || d > eMs) return;
      const val  = Num.parse(f.total);
      const isZ  = String(f.num || "").toUpperCase().startsWith("Z");
      const u    = (f as any).unidad_negocio || 'REST';
      if (!isZ && f.cliente !== 'Z DIARIO' && f.tipo === 'venta') {
        if (u === 'DLV') facturasB2B += val;
        if (unitBreakdown[u]) unitBreakdown[u].income += val;
      }
    });

    // ── 2. GASTOS VARIABLES (Albaranes) ────────────────────
    let gComida = 0, gBebida = 0, gOtros = 0;
    (data.albaranes || []).forEach(a => {
      const d = DateUtil.parse(a.date).getTime();
      if (d < sMs || d > eMs) return;
      const total = Num.parse(a.total);
      const prov  = String(a.prov || "").toLowerCase();
      const cat   = String((a as any).category || "").toLowerCase();
      const u     = a.unitId || 'REST';
      if (cat === 'comida' || prov.match(/fruta|carne|pesca|makro|pan|huevo|aliment|chef|gourmet/))
        gComida += total;
      else if (cat === 'bebida' || prov.match(/estrella|mahou|coca|vino|licor|bodega|cervez|sake/))
        gBebida += total;
      else
        gOtros += total;
      if (unitBreakdown[u]) unitBreakdown[u].expenses += total;
    });

    // ── 3. GASTOS FIJOS + AMORTIZACIÓN ─────────────────────
    let gPersonal = 0, gEstructura = 0;
    (data.gastos_fijos || []).forEach(g => {
      if ((g as any).active === false) return;
      let val      = Num.parse((g as any).amount ?? (g as any).importe ?? 0);
      const freq   = String((g as any).freq || (g as any).periodicidad || "").toLowerCase();
      // Prorrateo por frecuencia
      if      (freq === 'anual')      val /= 12;
      else if (freq === 'semestral')  val /= 6;
      else if (freq === 'trimestral') val /= 3;
      else if (freq === 'bimensual')  val /= 2;
      else if (freq === 'semanal')    val *= 4.33;
      else if (freq === 'once')       val = 0; // puntual, no se prorratea
      // ✅ FIX: clasificación usando type y cat canónicos
      if (clasificarGastoFijo(g) === 'personal') gPersonal   += val;
      else                                        gEstructura += val;
      const u = (g as any).unitId || 'REST';
      if (unitBreakdown[u]) unitBreakdown[u].expenses += val;
    });

    const gAmort = calcularAmortizacionMensual(data.activos);
    if (unitBreakdown['CORP']) unitBreakdown['CORP'].expenses += gAmort;

    // ── 4. TOTALES Y RATIOS ────────────────────────────────
    const totalIngresos = Num.round2(cajaZ + facturasB2B);
    const totalGastos   = Num.round2(gComida + gBebida + gOtros + gPersonal + gEstructura + gAmort);

    Object.keys(unitBreakdown).forEach(k => {
      unitBreakdown[k].profit = Num.round2(unitBreakdown[k].income - unitBreakdown[k].expenses);
    });

    const safeDiv = (n: number, d: number) => d > 0 ? (n / d) * 100 : 0;

    return {
      ingresos: { total: totalIngresos, caja: Num.round2(cajaZ), b2b: Num.round2(facturasB2B) },
      gastos  : {
        total       : totalGastos,
        comida      : Num.round2(gComida),
        bebida      : Num.round2(gBebida),
        personal    : Num.round2(gPersonal),
        estructura  : Num.round2(gEstructura),
        amortizacion: Num.round2(gAmort),
      },
      neto         : Num.round2(totalIngresos - totalGastos),
      unitBreakdown,
      ratios: {
        foodCost  : Num.round2(safeDiv(gComida,                        totalIngresos)),
        staffCost : Num.round2(safeDiv(gPersonal,                      totalIngresos)),
        primeCost : Num.round2(safeDiv(gComida + gBebida + gPersonal,  totalIngresos)),
      },
    };
  },
};
