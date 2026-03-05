export interface BankMovement {
  id: string;
  date: string;
  desc: string;
  amount: number;
  status: 'matched' | 'pending';
  linkType?: 'FACTURA' | 'ALBARAN';
  linkId?: string;
  hash?: string;
  source?: string;
}

export interface User {
  n: string;
  id: string;
  pin: string;
  role: 'admin' | 'staff';
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
  prov: string;
  cliente?: string;
  total: number;
  base?: number;
  tax?: number;
  dueDate?: string;
  reconciled?: boolean;
  albaranIds?: string;
  albaranIdsArr?: string[];
  status?: 'draft' | 'approved';
  source?: 'email-ia' | 'manual-group' | 'direct';
}

export interface Albaran {
  id: string;
  uid?: string;
  num?: string;
  date: string;
  prov: string;
  socio?: string;
  total: number;
  items: any[];
  invoiced?: boolean;
  paid?: boolean;
  status?: 'pending' | 'ok';
  notes?: string;
  link_foto?: string;
  reconciled?: boolean;
  base?: number;
  taxes?: number;
  dueDate?: string;
  creditDays?: number;
  category?: string;
}

export interface GastoFijo {
  id: string;
  name: string;
  amount: number;
  freq: 'mensual' | 'trimestral' | 'semestral' | 'anual' | 'bimensual' | 'semanal';
  cat: string;
  active: boolean;
  dia_pago: number;
  notes?: string;
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

export interface AppData {
  lastSync?: number;
  config: {
    objetivoMensual: number;
    empresa?: string;
    n8nUrlBanco?: string;
    n8nUrlIA?: string;
    telegramToken?: string;
    telegramChatId?: string;
    [key: string]: any;
  };
  banco: BankMovement[];
  users: User[];
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
  diario: any[];
  priceHistory: Record<string, number[]>;
  sales_history: any[];
  [key: string]: any;
}
