// ==========================================
// 📄 src/types.ts (El Diccionario de Datos Blindado)
// ==========================================

export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

export interface AppConfig {
  saldoInicial?: number;
  objetivoMensual?: number;
  empresa?: string;
  nif?: string;
  repartoDeliveryCocinero?: number;
  repartoDeliveryAdmin?: number;
  
  // 🔗 Webhooks de n8n
  n8nUrlBanco?: string;
  n8nUrlIA?: string;
  n8nUrlAlbaranes?: string;
  
  // 🤖 Telegram Bot
  telegramToken?: string;
  telegramChatId?: string;
  
  // 📧 Correos IMAP
  emailFacturas?: string;
  emailGeneral?: string;
}

// 🚀 INNOVACIÓN 1: Tipado estricto para las líneas de compra (Evita pérdida de datos del OCR)
export interface LineItem {
  q: number;         // Cantidad
  n: string;         // Nombre / Concepto
  u?: string;        // Unidad (ud, kg, l)
  unitPrice?: number;// Precio unitario limpio
  rate?: number;     // % IVA (4, 10, 21)
  base?: number;     // Base Imponible de la línea
  tax?: number;      // Cuota de IVA de la línea
  t: number;         // Total de la línea
}

export interface Albaran {
  id: string;
  date: string;
  prov?: string;
  socio?: string;
  num: string;
  total: number | string;
  base?: number | string;  // 🛡️ Antes faltaba
  taxes?: number | string; // 🛡️ Antes faltaba
  items?: LineItem[];      // 🛡️ FUNDAMENTAL: Aquí se guardan los platos/productos
  notes?: string;          // Para warnings de la IA
  unitId?: BusinessUnit;
  invoiced: boolean;
  reconciled?: boolean;
  paid?: boolean;
  status?: string;
  by_rate?: any;           // Desglose de IVA automático
}

export interface Factura {
  id: string;
  tipo: 'compra' | 'venta' | 'caja';
  num: string;
  date: string;
  prov?: string;
  cliente?: string;
  total: number | string;
  base?: number | string;
  tax?: number | string;
  paid: boolean;
  reconciled: boolean;
  unidad_negocio?: BusinessUnit;
  source?: 'manual' | 'email-ia' | 'manual-group' | 'banco' | 'gmail-sync' | 'dropzone' | 'ia-auto' | 'auto-agrupacion-banco';
  status?: 'ingested' | 'parsed' | 'draft' | 'approved' | 'paid' | 'reconciled' | 'mismatch';
  file_base64?: string;
  albaranIdsArr?: string[];
  albaranIds?: string;
  fecha_pago?: string;
}

export interface FacturaExtended extends Factura {
  attachmentSha?: string; 
  dueDate?: string;
  candidatos?: Albaran[]; 
  sumaAlbaranes?: number;
  diferencia?: number;
  cuadraPerfecto?: boolean;
  emailMeta?: any; 
}

export interface EmailDraft {
  id: string;
  from: string;
  subject: string;
  date: string;
  hasAttachment: boolean;
  status: 'new' | 'parsed';
  fileBase64?: string;
  fileName?: string;
}

export interface Socio {
  id?: string;
  n: string; // nombre del socio
  active: boolean;
}

export interface BankMovement {
  id: string;
  date: string;
  amount: number | string;
  desc: string;
  status: 'pending' | 'matched';
  hash?: string;
  link?: { type: string; id: string };
  category?: string;
  flags?: any;
  reviewed?: boolean;
}

// 🚀 INNOVACIÓN 2: Registro histórico para el Inspector de Precios
export interface PriceHistoryItem {
  id: string;
  prov: string;
  item: string;
  unitPrice: number;
  date: string;
}

export interface AppData {
  config?: AppConfig;
  socios?: Socio[];
  facturas?: FacturaExtended[]; 
  albaranes?: Albaran[];
  banco?: BankMovement[];
  cierres?: any[];
  gastos_fijos?: any[];
  ventas_menu?: any[];
  platos?: any[];
  recetas?: any[];
  ingredientes?: any[];
  control_pagos?: any;
  priceHistory?: PriceHistoryItem[]; // 🛡️ FUNDAMENTAL: Evita que el gráfico de precios se borre al guardar
}
