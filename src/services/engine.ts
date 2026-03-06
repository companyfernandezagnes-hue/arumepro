import { AppData, GastoFijo, Activo } from "../types";

export const Num = {
  parse: (val: any): number => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    
    // Convertimos a string por seguridad
    let strVal = val.toString().trim();
    
    // Si tiene formato europeo (ej: 1.000,45), quitamos puntos y cambiamos coma por punto
    if (strVal.includes(',') && strVal.indexOf(',') > strVal.lastIndexOf('.')) {
      strVal = strVal.replace(/\./g, '').replace(',', '.');
    } else {
      // Si tiene formato internacional o ya es un float en string (ej: 1000.45), 
      // quitamos comas de miles si las hubiera, manteniendo el punto decimal.
      strVal = strVal.replace(/,/g, '');
    }

    return parseFloat(strVal) || 0;
  },
  
  fmt: (val: number): string => 
    new Intl.NumberFormat('es-ES', { 
      style: 'currency', 
      currency: 'EUR', 
      minimumFractionDigits: 2, // 🚀 FIX: Forzamos que siempre haya 2 decimales
      maximumFractionDigits: 2  // 🚀 FIX: Evitamos que redondee a enteros
    }).format(val || 0)
};

export const DateUtil = {
  today: () => new Date().toISOString().split('T')[0],
  getMonthBounds: (month: number, year: number) => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return { start, end };
  },
  parse: (d: any): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (typeof d === 'string' && d.includes('/')) {
      const [dia, mes, anio] = d.split('/');
      return new Date(`${anio.length === 2 ? '20' + anio : anio}-${mes}-${dia}`);
    }
    return new Date(d);
  }
};

export function calcularAmortizacionMensual(activos: Activo[]): number {
  if (!activos || activos.length === 0) return 0;
  const hoy = new Date();
  let total = 0;
  activos.forEach(a => {
    if (!a.fecha_compra || !a.importe || !a.vida_util_meses) return;
    const vida = a.vida_util_meses;
    const fecha = new Date(a.fecha_compra);
    const meses = (hoy.getFullYear() - fecha.getFullYear()) * 12 + (hoy.getMonth() - fecha.getMonth());
    if (meses >= 0 && meses < vida) total += (a.importe / vida);
  });
  return total;
}

export const ArumeEngine = {
  getProfit: (data: AppData, month: number, year: number) => {
    const { start, end } = DateUtil.getMonthBounds(month, year);
    const sTime = start.getTime();
    const eTime = end.getTime();

    // A. INGRESOS
    let cajaZ = 0, facturasB2B = 0;
    (data.cierres || []).forEach(c => {
      const d = new Date(c.date).getTime();
      if (d >= sTime && d <= eTime) cajaZ += Num.parse(c.totalVenta);
    });

    (data.facturas || []).forEach(f => {
      const d = new Date(f.date).getTime();
      if (d >= sTime && d <= eTime && !String(f.num).toUpperCase().startsWith('Z')) {
        facturasB2B += Num.parse(f.total);
      }
    });

    const totalIngresos = cajaZ + facturasB2B;

    // B. GASTOS VARIABLES
    let gComida = 0, gBebida = 0, gOtros = 0;
    (data.albaranes || []).forEach(a => {
      const d = new Date(a.date).getTime();
      if (d >= sTime && d <= eTime) {
        const total = Num.parse(a.total);
        const p = (a.prov || '').toLowerCase();
        if (p.match(/fruta|carne|pesca|makro|mercadona|pan|huevo|verdu|aliment|chef|congelado|lidl|dia|eroski|assortiment|gourmet/)) gComida += total;
        else if (p.match(/estrella|mahou|coca|vino|bebida|licor|bodega|drinks|cerveza|agua|cafe|schweppes|pepsi/)) gBebida += total;
        else gOtros += total;
      }
    });

    // C. GASTOS FIJOS
    let gPersonal = 0, gEstructura = 0;
    (data.gastos_fijos || []).filter(g => g.active !== false).forEach(g => {
      let val = Num.parse(g.amount);
      if (g.freq === 'anual') val /= 12;
      else if (g.freq === 'semestral') val /= 6;
      else if (g.freq === 'trimestral') val /= 3;
      else if (g.freq === 'bimensual') val /= 2;
      else if (g.freq === 'semanal') val *= 4.33;

      if (g.cat === 'personal') gPersonal += val;
      else gEstructura += val;
    });

    // D. AMORTIZACIONES
    const gAmort = calcularAmortizacionMensual(data.activos);
    const totalGastos = gComida + gBebida + gOtros + gPersonal + gEstructura + gAmort;

    return {
      ingresos: { total: totalIngresos, caja: cajaZ, b2b: facturasB2B },
      gastos: { total: totalGastos, comida: gComida, bebida: gBebida, personal: gPersonal, otros: gOtros, estructura: gEstructura, amortizacion: gAmort },
      neto: totalIngresos - totalGastos,
      ratios: {
        foodCost: totalIngresos ? (gComida / totalIngresos) * 100 : 0,
        drinkCost: totalIngresos ? (gBebida / totalIngresos) * 100 : 0,
        staffCost: totalIngresos ? (gPersonal / totalIngresos) * 100 : 0,
        primeCost: totalIngresos ? ((gComida + gBebida + gPersonal) / totalIngresos) * 100 : 0
      }
    };
  }
};
