import { AppData } from "./types";

export const INITIAL_DATA: AppData = {
  banco: [
    { id: "bank-1771315590661", date: "2026-01-12", desc: "Sin concepto", amount: 3.26, status: "matched" },
    { id: "bm-1771318103165", date: "2026-01-01", desc: "LIQUID.PROPIA CUENTA", amount: -10, status: "matched" },
    { id: "bm-1771318103166", date: "2026-01-02", desc: "TARJETA CREDITO 87526020 0126", amount: -27.2, status: "matched" },
    { id: "bm-1771318103167", date: "2026-01-04", desc: "TRANSFER. DIAMBOR ALQUILER MENSUAL", amount: -2705.09, status: "matched" },
    { id: "bm-1771318103168", date: "2026-01-02", desc: "AB.TR.SEPA 00073210456 STRIPE TECHNOLOGY", amount: 98.25, status: "pending" }
  ],
  config: {
    objetivoMensual: 40000,
    nif: "B-12345678",
    iban: "ESXX XXXX XXXX XXXX XXXX",
    sufijo: "000",
    empresa: "Arume Sake Bar (Celoso de Palma SL)",
    saldoInicial: 0,
    // ð ENLACES Y AUTOMATIZACIONES
    n8nUrlBanco: "https://ia.permatunnelopen.org/webhook/1085406f-324c-42f7-b50f-22f211f445cd",
    n8nUrlIA: "https://n8n.permatunnelopen.org/webhook/alertas-erp",
    appUrl: "https://tu-erp-inteligente.app", 
    telegramToken: "",
    telegramChatId: "",
    // ð NUEVAS REGLAS B2B (REPARTO BENEFICIOS DELIVERY)
    repartoDeliveryCocinero: 20, // 20%
    repartoDeliveryAdmin: 10     // 10%
  },
  kardex: [
    { n: "DEWASAKURA DEWASANSAN -JG 1800ML", id: "b8nomd05t", ts: 1766941460235, qty: 2, date: "2025-12-28", type: "IN", unit: "ud", user: "Gerencia", ingId: "fbp98qges", price: 50.94, reason: "Alb: Solo de vinos", unidad_negocio: "SHOP" },
    { n: "TEDORIGAYA U YOSHIDAGURA J. MUROKA", id: "dkgtw7lwi", ts: 1766941460236, qty: 2, date: "2025-12-28", type: "IN", unit: "ud", user: "Gerencia", ingId: "ddj964f3w", price: 26.55, reason: "Alb: Solo de vinos", unidad_negocio: "SHOP" }
  ],
  cierres: [
    { id: "migrated-1", apps: 0, date: "2025-12-09", notas: "", tarjeta: 0, efectivo: 0, descuadre: 0, totalVenta: 1445.75, unitId: "REST" },
    { id: "migrated-2", apps: 192, date: "2025-12-10", notas: "", tarjeta: 0, efectivo: 0, descuadre: 0, totalVenta: 1759.35, unitId: "REST" },
    { id: "migrated-3", apps: 60, date: "2025-12-11", notas: "Venta Tienda separada", tarjeta: 0, efectivo: 0, descuadre: 0, totalVenta: 350.00, conciliado_banco: true, unitId: "SHOP" }
  ],
  recetas: [
    { n: "4 Maki Atun", id: "ol796akpg", pvp: 5, time: 0, unit: "ud", items: [], yield: 1 },
    { n: "Edamame", id: "lxrfdeywd", pvp: 6, inst: "SE INTRODUCEN EN EL HERVIDOR", time: 3, unit: "rac", items: [{ q: 100, id: "6526p7zun", type: "ing", unit: "g", merma: 0 }], yield: 1 }
  ],
  facturas: [
    { id: "rocx2goz2", tipo: "compra", num: "F-25/001", date: "2025-12-23", paid: true, prov: "Makro", total: 100, dueDate: "2026-01-22", reconciled: true, unidad_negocio: "REST" },
    { id: "6glygcggo", tipo: "compra", num: "F-25/002", date: "2025-12-28", paid: true, prov: "Distribuidora Rotger S.L.", total: 209.6, dueDate: "2026-01-27", reconciled: false, unidad_negocio: "SHOP" }
  ],
  ingredientes: [
    { n: "AGUACATE", id: "4or4ti24t", fam: "Verdura", min: 5, cost: 4.97, unit: "kg", stock: 14.2, unidad_negocio: "REST" },
    { n: "SALMON", id: "wqjpfh3ej", fam: "Pescado", min: 10, cost: 12.54, unit: "kg", stock: 40.09, unidad_negocio: "DLV" },
    { n: "DEWASAKURA DEWASANSAN", id: "fbp98qges", fam: "Junmai", min: 2, cost: 50.94, unit: "ud", stock: 5, unidad_negocio: "SHOP" }
  ],
  proveedores: [
    { n: "Makro", id: "prov0", fam: "General", tel: "" },
    { n: "Distribuidora Rotger S.L.", id: "prov4", fam: "General", tel: "674 12 00 99" }
  ],
  gastos_fijos: [
    { name: "Alquiler local", id: "dvt9qwg4q", dia_pago: 9, freq: "mensual", amount: 2705.09, cat: "local", active: true, unitId: "REST" },
    { name: "Cuota Autónomos Socios", id: "aut-1", dia_pago: 30, freq: "mensual", amount: 600.00, cat: "impuestos", active: true, unitId: "CORP" }
  ],
  // 🎯 SECCIÓN PROFESIONAL PARA SOCIOS AÑADIDA
  socios: [
    { id: "socio-1", n: "PAU", email: "", active: true },
    { id: "socio-2", n: "JERONI", email: "", active: true },
    { id: "socio-3", n: "AGNES", email: "", active: true },
    { id: "socio-4", n: "ONLY ONE", email: "", active: true },
    { id: "socio-5", n: "TIENDA DE SAKES", email: "", active: true }
  ],
  platos: [],
  ventas_menu: [],
  cierres_mensuales: [],
  albaranes: [],
  activos: [],
  diario: [],
  priceHistory: [],
  control_pagos: {}
};
