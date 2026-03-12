// ==========================================
// 📄 src/types.ts (El Diccionario de Datos)
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
  source?: 'manual' | 'email-ia' | 'manual-group' | 'banco';
  status?: 'draft' | 'approved' | 'paid' | 'reconciled';
  file_base64?: string;
  albaranIdsArr?: string[];
  albaranIds?: string;
  fecha_pago?: string;
}

export interface Albaran {
  id: string;
  date: string;
  prov?: string;
  socio?: string;
  num: string;
  total: number | string;
  unitId?: BusinessUnit;
  invoiced: boolean;
  reconciled?: boolean;
  paid?: boolean;
  status?: string;
}

export interface Socio {
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

export interface AppData {
  config?: AppConfig;
  socios?: Socio[];
  facturas?: Factura[];
  albaranes?: Albaran[];
  banco?: BankMovement[];
  cierres?: any[];
  gastos_fijos?: any[];
  ventas_menu?: any[];
  platos?: any[];
  recetas?: any[];
  ingredientes?: any[];
  control_pagos?: any;
}
