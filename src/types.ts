// 🚀 TIPO BASE: UNIDADES DE NEGOCIO B2B
export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

export interface AppConfig {
  objetivoMensual: number;
  empresa?: string;
  n8nUrlBanco?: string;
  n8nUrlIA?: string;
  telegramToken?: string;
  telegramChatId?: string;
  saldoInicial?: number;
  // 🚀 REGLAS DE REPARTO DE BENEFICIOS (Ej: Delivery)
  repartoDeliveryCocinero?: number;
  repartoDeliveryAdmin?: number;
  [key: string]: any;
}

export interface BankMovement {
  id: string;
  date: string;
  desc: string;
  amount: number;
  status: 'matched' | 'pending';
  linkType?: 'FACTURA' | 'ALBARAN' | 'CIERRE';
  linkId?: string;
  hash?: string;
  source?: string;
  category?: string;
  reviewed?: boolean;
  unitId?: BusinessUnit;
  flags?: {
    duplicate?: boolean;
    suspicious?: boolean;
    unmatched?: boolean;
  };
  link?: {
    type: 'ALBARAN' | 'FACTURA';
    id: string;
  };
}

export interface User {
  n: string;
  id: string;
  pin: string;
  role: 'admin' | 'staff';
}

// 🚀 NUEVA INTERFAZ: Socios de la empresa
export interface Socio {
  id: string;
  n: string;
  email?: string;
  active?: boolean;
  rol?: string; 
}

export interface KardexEntry {
  n: string;
  id: string;
  ts: number;
  qty: number;
  date: string;
  type: 'IN' | 'OUT' | 'ADJ' | 'RESET';
  unit: string;
  user?: string;
  ingId: string;
  price: number;
  reason: string;
  unidad_negocio?: BusinessUnit; // Trazabilidad de inventario
}

export interface Cierre {
  id: string;
  apps: number;
  date: string;
  notas: string;
  tarjeta: number;
  efectivo: number;
  descuadre: number;
  totalVenta: number;
  tickets?: number;
  conciliado_banco?: boolean;
  unitId?: BusinessUnit; // Cajas separadas
}

export interface Receta {
  n: string;
  id: string;
  pvp: number;
  time: number;
  unit: string;
  items: any[];
  yield: number;
  inst?: string;
}

export interface Factura {
  id: string;
  num?: string;
  date: string;
  paid: boolean;
  fecha_pago?: string; // 🚀 Añadido para el control de pagos
  file_base64?: string; // 🚀 Añadido para guardar el PDF original
  prov: string;
  cliente?: string;
  total: string | number;
  base?: string | number;
  tax?: string | number;
  taxes?: number;
  dueDate?: string;
  reconciled?: boolean;
  albaranIds?: string;
  albaranIdsArr?: string[];
  status?: 'draft' | 'approved' | 'rejected' | 'paid';
  source?: 'email-ia' | 'manual-group' | 'direct' | 'manual';
  unidad_negocio?: BusinessUnit; // 🚀 Facturación B2B (Hoteles)
}

export interface Albaran {
  id: string;
  company_id?: string;
  uid?: string;
  num?: string;
  date: string;
  prov: string;
  socio?: string;
  total: string | number;
  items: any[];
  invoiced?: boolean;
  paid?: boolean;
  status?: 'pending' | 'ok';
  notes?: string;
  link_foto?: string;
  reconciled?: boolean;
  base?: string | number;
  taxes?: string | number;
  dueDate?: string;
  creditDays?: number;
  category?: string;
  unitId?: BusinessUnit; // Gastos asignados a unidad
}

export interface GastoFijo {
  id: string;
  name: string;
  amount: string | number;
  freq: 'mensual' | 'trimestral' | 'semestral' | 'anual' | 'bimensual' | 'semanal';
  cat: string;
  active: boolean;
  dia_pago: number;
  notes?: string;
  unitId?: BusinessUnit; // Costes fijos separados
}

export interface Plato {
  id: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  sold?: number;
}

export interface VentaMenu {
  date: string;
  id: string;
  qty: number;
}

export interface Activo {
  id: string;
  nombre: string;
  importe: number;
  fecha_compra: string;
  vida_util_meses: number;
}

export interface Ingrediente {
  n: string;
  id: string;
  fam: string;
  min: number;
  cost: number;
  unit: string;
  stock: number;
  tax?: number;
  lastCost?: number;
  lastProv?: string;
  aller?: string[];
  unidad_negocio?: BusinessUnit; // Ingredientes de tienda vs cocina
}

export interface CierreMensual {
  id: string;
  mes: number;
  anio: number;
  fecha_cierre: string;
  snapshot: {
    ventas: number;
    compras: number;
    fijos: number;
    amortizaciones: number;
    resultado: number;
  };
}

// 🚀 NUEVA INTERFAZ: Liquidación de Socios (El 20% y 10%)
export interface PartnerSettlement {
  id: string;
  date: string;        // Fecha en la que se hizo el cálculo
  month: number;       // Mes liquidado
  year: number;        // Año liquidado
  unitId: BusinessUnit; // Qué bloque se está liquidando (Ej: DLV)
  totalIncome: number;
  totalExpenses: number;
  totalProfit: number;
  partners: {
    name: string;
    role: string; // Ej: 'Cocinero', 'Administrador'
    percentage: number;
    amountToPay: number;
  }[];
  companyProfit: number; // Lo que queda para la sociedad
  notes?: string;
}

export interface AppData {
  lastSync?: number;
  config: AppConfig;
  banco: BankMovement[];
  users: User[];
  socios?: Socio[]; // 🚀 Añadida la tabla real de Socios
  kardex: KardexEntry[];
  cierres: Cierre[];
  facturas: Factura[];
  albaranes: Albaran[];
  ingredientes: Ingrediente[];
  proveedores: any[];
  gastos_fijos: GastoFijo[];
  activos: Activo[];
  recetas: Receta[];
  platos: Plato[];
  ventas_menu: VentaMenu[];
  cierres_mensuales: CierreMensual[];
  liquidaciones: PartnerSettlement[]; 
  diario: any[];
  priceHistory: Record<string, number[]>;
  sales_history: any[];
  [key: string]: any;
}
