import { AppData } from "./types";

export const INITIAL_DATA: AppData = {
  "logs": [
    { "ts": 1771341702997, "date": "2026-02-17T15:21:42.997Z", "action": "match", "details": "Conciliado TRANSFER. ASSORTIMENT,S.L. FACT NUM 196.990 con Assortiment" },
    { "ts": 1771341729030, "date": "2026-02-17T15:22:09.030Z", "action": "create_expense", "details": "Creado gasto Gestoría desde banco" }
  ],
  "banco": [
    { "id": "bank-17713155906610.6794747319730929", "date": "12/01/26", "desc": "Sin concepto", "amount": 3.26063, "status": "matched" },
    { "id": "bm-17713181031650.9038551444742684", "date": "2026-01-01", "desc": "LIQUID.PROPIA CUENTA", "amount": -10, "status": "matched" },
    { "id": "bm-17713181031650.995624168142895", "date": "2026-01-02", "desc": "TARJETA CREDITO 87526020 0126", "amount": -27.2, "status": "matched" },
    { "id": "bm-17713181031660.331893651906647", "date": "2026-01-02", "desc": "TARJETA CREDITO 87529024 0126", "amount": -1211.68, "status": "matched" },
    { "id": "bm-17713181031660.5314840992831252", "date": "2026-01-04", "desc": "TRANSFER. DIAMBOR ALQUILER MENSUAL", "amount": -2705.09, "status": "matched" },
    { "id": "bm-17713181031660.45758134909093506", "date": "2026-01-02", "desc": "AB.TR.SEPA 00073210456 STRIPE TECHNOLOGY STRIPE R5Y0J6", "amount": 98.25, "status": "pending" }
  ],
  "users": [
    { "n": "Gerencia", "id": "u1", "pin": "MDE1MA==", "role": "admin" },
    { "n": "Equipo", "id": "u2", "pin": "MTExMQ==", "role": "staff" }
  ],
  "config": {
    "objetivoMensual": 40000,
    "nif": "",
    "iban": "",
    "sufijo": "000",
    "empresa": "Arume Sake Bar",
    "n8nUrlBanco": "",
    "saldoInicial": 0,
    "n8nUrlIA": "https://n8n.permatunnelopen.org/webhook/alertas-erp", // 🚀 AQUÍ ESTÁ TU WEBHOOK DE ALERTAS
    "appUrl": "https://tu-erp-inteligente.app", // Cambia esto por la URL real de tu app cuando la subas
    "telegramToken": "",
    "telegramChatId": ""
  },
  "kardex": [
    { "n": "DEWASAKURA DEWASANSAN -JG 1800ML", "id": "b8nomd05t", "ts": 1766941460235, "qty": 2, "date": "28/12/2025, 18:04:20", "type": "IN", "unit": "ud", "user": "Gerencia", "ingId": "fbp98qges", "price": 50.94, "reason": "Alb: Solo de vinos" },
    { "n": "TEDORIGAYA U YOSHIDAGURA J. MUROKA", "id": "dkgtw7lwi", "ts": 1766941460236, "qty": 2, "date": "28/12/2025, 18:04:20", "type": "IN", "unit": "ud", "user": "Gerencia", "ingId": "ddj964f3w", "price": 26.55, "reason": "Alb: Solo de vinos" }
  ],
  "cierres": [
    { "id": "migrated-1771341546981-0.8702915025005313", "apps": 0, "date": "2025-12-09", "notas": "", "tarjeta": 0, "efectivo": 0, "descuadre": 0, "totalVenta": 1445.75 },
    { "id": "migrated-1771341546981-0.05529058050057156", "apps": 192, "date": "2025-12-10", "notas": "", "tarjeta": 0, "efectivo": 0, "descuadre": 0, "totalVenta": 1759.35 },
    { "id": "migrated-1771341546981-0.9532910880241191", "apps": 60, "date": "2025-12-11", "notas": "", "tarjeta": 0, "efectivo": 0, "descuadre": 0, "totalVenta": 1528.79, "conciliado_banco": true }
  ],
  "recetas": [
    { "n": "4 Maki Atun", "id": "ol796akpg", "pvp": 5, "time": 0, "unit": "ud", "items": [], "yield": 1 },
    { "n": "Edamame", "id": "lxrfdeywd", "pvp": 6, "inst": "SE INTRODUCEN EN EL HERVIDOR", "time": 3, "unit": "rac", "items": [{ "q": 100, "id": "6526p7zun", "type": "ing", "unit": "g", "merma": 0 }], "yield": 1 }
  ],
  "facturas": [
    { "id": "rocx2goz2", "date": "2025-12-23", "paid": true, "prov": "Makro", "total": 1, "dueDate": "2026-01-22", "reconciled": true },
    { "id": "6glygcggo", "date": "2025-12-28", "paid": true, "prov": "Distribuidora Rotger S.L.", "total": 209.6, "dueDate": "2026-01-27" }
  ],
  "ingredientes": [
    { "n": "AGUACATE", "id": "4or4ti24t", "fam": "Verdura", "min": 0, "cost": 4.979, "unit": "kg", "stock": 14.2 },
    { "n": "SALMON", "id": "wqjpfh3ej", "fam": "Pescado", "min": 0, "cost": 12.54, "unit": "kg", "stock": 40.09 }
  ],
  "proveedores": [
    { "n": "Makro", "id": "prov0", "fam": "General", "tel": "" },
    { "n": "Distribuidora Rotger S.L.", "id": "prov4", "fam": "General", "tel": "674 12 00 99" }
  ],
  "gastos_fijos": [
    { "name": "Alquiler local", "id": "dvt9qwg4q", "dia_pago": 9, "freq": "mensual", "amount": 2705.09, "cat": "local", "active": true }
  ],
  "platos": [],
  "ventas_menu": [],
  "cierres_mensuales": [],
  "albaranes": [],
  "activos": [],
  "diario": [],
  "priceHistory": {},
  "sales_history": []
};
