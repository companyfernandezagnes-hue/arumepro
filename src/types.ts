// ==========================================
// 📄 src/types.ts (El Diccionario de Datos Blindado)
// ==========================================
export type BusinessUnit = 'REST' | 'DLV' | 'SHOP' | 'CORP';

// ✅ Tipo utilitario: los campos numéricos en Supabase pueden llegar como string
// desde datos legacy. enforceSchema en supabase.ts los normaliza a number al leer,
// pero los tipos aceptan ambos para compatibilidad con datos legacy y drafts.
export type NumericValue = number | string;

export interface AppConfig {
  saldoInicial?: number;
  objetivoMensual?: number;
  empresa?: string;
  nif?: string;
  iban?: string;
  sufijo?: string;
  appUrl?: string;
  driveUrl?: string;
  repartoDeliveryCocinero?: number;
  repartoDeliveryAdmin?: number;
  reparto?: {
    sociedadPrincipal: { nombre: string; porcentaje: number }[];
    acuerdosB2B: { nombre: string; porcentaje: number }[];
  };
  n8nUrlBanco?: string;
  n8nUrlIA?: string;
  n8nUrlAlbaranes?: string;
  telegramToken?: string;
  telegramChatId?: string;
  supabaseInboxUrl?: string;
  supabaseInboxKey?: string;
  supabasePersonalUrl?: string;
  supabasePersonalKey?: string;
  // Permite llaves extra sin romper el tipado (config evolutivo)
  [key: string]: unknown;
}

// ✅ Tipado estricto para las líneas de compra
export interface LineItem {
  q: number;
  n: string;
  u?: string;
  unit?: string;
  unitPrice?: number;
  rate?: number;
  base?: number;
  tax?: number;
  /** Canónico: total por línea. Legacy usa `total`. Leer como: li.t ?? li.total */
  t: number;
  total?: number;
  [key: string]: unknown;
}

export interface Albaran {
  id: string;
  date: string;
  prov?: string;
  socio?: string;
  num: string;
  total: NumericValue;
  base?: NumericValue;
  taxes?: NumericValue;
  iva?: NumericValue;
  items?: LineItem[];
  notes?: string;
  source?: string;
  unitId?: BusinessUnit;
  unidad_negocio?: BusinessUnit;
  invoiced?: boolean;
  reconciled?: boolean;
  paid?: boolean;
  status?: string;
  dueDate?: string;
  creditDays?: number;
  by_rate?: Record<string, { base: number; tax: number; total: number }>;
  currency?: string;        // Divisa original (EUR por defecto)
  exchangeRate?: number;    // Tipo de cambio a EUR en fecha del albarán
  totalEUR?: NumericValue;  // Total convertido a EUR
  // ── Abonos / rectificativos ──
  tipo_rectificativo?: boolean;
  factura_original_id?: string;
  factura_original_num?: string;
  // ── Descuentos ──
  descuento_global_pct?: number;
  descuento_global_euros?: number;
  descuento_motivo?: string;
  // ── Notas manuscritas / revisión ──
  notas_manuscritas?: string;
  needs_review?: boolean;
  reviewed?: boolean;
  [key: string]: unknown;
}

export interface Factura {
  id: string;
  tipo: 'compra' | 'venta' | 'caja';
  num: string;
  date: string;
  prov?: string;
  cliente?: string;
  total: NumericValue;
  base?: NumericValue;
  tax?: NumericValue;
  paid: boolean;
  reconciled: boolean;
  unidad_negocio?: BusinessUnit;
  source?: 'manual' | 'email-ia' | 'manual-group' | 'banco' | 'gmail-sync' | 'dropzone' | 'ia-auto' | 'auto-agrupacion-banco';
  status?: 'ingested' | 'parsed' | 'draft' | 'approved' | 'paid' | 'reconciled' | 'mismatch';
  file_base64?: string;
  albaranIdsArr?: string[];
  albaranIds?: string;
  fecha_pago?: string;
  irpfPct?: number;       // % retención IRPF (ej: 15, 7)
  irpfAmount?: NumericValue; // importe retención IRPF
  uploaded_gestoria?: boolean; // marcada como subida a Bilky/gestoría
  fecha_upload_gestoria?: string; // fecha en que se marcó como subida
  needs_review?: boolean;      // usuaria marcó al importar: IA leyó mal, revisar
  reviewed?: boolean;          // ya revisada y corregida manualmente
  // ── Abonos (facturas rectificativas) ──
  tipo_rectificativo?: boolean;        // true = es un abono (total negativo)
  factura_original_id?: string;        // factura original que rectifica
  factura_original_num?: string;       // número legible de la factura original
  // ── Descuentos ──
  descuento_global_pct?: number;       // % descuento global (0-100)
  descuento_global_euros?: number;     // descuento absoluto en €
  descuento_motivo?: string;           // 'pronto pago', 'volumen', etc.
  // ── Notas manuscritas ──
  notas_manuscritas?: string;          // texto que la usuaria añade al revisar
}

export interface FacturaExtended extends Factura {
  attachmentSha?: string;
  dueDate?: string;
  candidatos?: Albaran[];
  sumaAlbaranes?: number;
  diferencia?: number;
  cuadraPerfecto?: boolean;
  emailMeta?: Record<string, unknown>;
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
  n: string;
  active: boolean;
  email?: string;
  /**
   * Roles:
   * - socio_fundador: participa en el reparto de beneficios de la sociedad principal (REST+SHOP+CORP)
   * - comisionista_b2b: cobra un % de los cobros B2B netos (DLV) — NO participa en beneficios de la sociedad principal
   * - operativo: empleado/colaborador (sus gastos suplidos se reembolsan a base sin IVA)
   */
  role?: 'socio_fundador' | 'comisionista_b2b' | 'operativo';
  /** Porcentaje de reparto. Para fundadores: % del beneficio principal. Para comisionistas: % sobre neto B2B. */
  porcentaje?: number;
  [key: string]: unknown;
}

export interface BankMovement {
  id: string;
  date: string;
  amount: NumericValue;
  desc: string;
  status: 'pending' | 'matched';
  hash?: string;
  link?: { type: string; id: string };
  category?: string;
  flags?: Record<string, unknown>;
  reviewed?: boolean;
}

// ✅ Registro histórico para el Inspector de Precios
export interface PriceHistoryItem {
  id: string;
  prov: string;
  item: string;
  unitPrice: number;
  date: string;
  albaranId?: string;
}

// ✅ Tipos para datos operacionales de restaurante
export interface Plato {
  id: string;
  /** Canónico: leer como p.nombre ?? p.name */
  nombre?: string;
  name?: string;
  categoria?: string;
  category?: string;
  precio?: number;
  price?: number;
  cost?: number;
  iva?: number;
  activo?: boolean;
  [key: string]: unknown;
}

// ✅ FIX 3: Ingrediente — campos canónicos explícitos, aliases legacy marcados
export interface Ingrediente {
  id: string;
  /** Nombre canónico (campo principal). Legacy usa `nombre`. */
  n: string;
  nombre?: string;           // @legacy — leer siempre como: g.n ?? g.nombre
  /** Unidad canónica ('uds' | 'kg' | 'l'). Legacy usa `unidad`. */
  unit?: string;
  unidad?: string;           // @legacy — leer siempre como: g.unit ?? g.unidad
  /** Stock actual. Legacy usa `stockActual`. */
  stock: number;
  stockActual?: number;      // @legacy — leer siempre como: g.stock ?? g.stockActual
  /** Stock mínimo. Legacy usa `stockMinimo`. */
  min: number;
  stockMinimo?: number;      // @legacy — leer siempre como: g.min ?? g.stockMinimo
  cost?: number;
  fam?: string;
  unidad_negocio?: BusinessUnit;
  [key: string]: unknown;
}

// ✅ NUEVO: Entrada del Kardex de stock (historial de movimientos)
export interface KardexEntry {
  id: string;
  n: string;
  ingId: string;
  ts: number;
  date: string;
  qty: number;
  type: 'IN' | 'OUT';
  unit: string;
  price?: number;
  reason: string;
  user?: string;
  unidad_negocio?: BusinessUnit;
  [key: string]: unknown;
}

export interface Receta {
  id: string;
  platoId?: string;
  n?: string;
  ingredientes?: { ingredienteId: string; cantidad: number }[];
  [key: string]: unknown;
}

export interface VentaMenu {
  id: string;
  date: string;
  platoId?: string;
  /** Canónico (qty). Legacy usa cantidad. */
  qty?: number;
  cantidad?: number;
  total?: number;
  [key: string]: unknown;
}

// ✅ FIX 4: Cierre diario de caja — campo canónico: totalVenta
// Los 5 aliases anteriores (totalVentas, total_calculado, total_real, total)
// se conservan SOLO para compatibilidad con datos legacy ya guardados en Supabase.
// En código nuevo usar SIEMPRE: c.totalVenta ?? c.totalVentas ?? 0
export interface Cierre {
  id: string;
  date: string;
  /** Campo canónico. Leer como: c.totalVenta ?? c.totalVentas ?? 0 */
  totalVenta?: number;
  /** @legacy */ totalVentas?: number;
  /** @legacy */ total_calculado?: number;
  /** @legacy */ total_real?: number;
  efectivo?: number;
  tarjeta?: number;
  apps?: number;
  descuadre?: number;
  notas?: string;
  unitId?: BusinessUnit;
  unidad_negocio?: BusinessUnit;
  conciliado_banco?: boolean;
  [key: string]: unknown;
}

// ✅ FIX 3: GastoFijo — campos canónicos explícitos, aliases legacy marcados
export interface GastoFijo {
  id: string;
  /** Nombre canónico. Legacy usa `concepto`. Leer como: g.name ?? g.concepto */
  name?: string;
  /** @legacy */ concepto?: string;
  /** Importe canónico. Legacy usa `importe`. Leer como: g.amount ?? g.importe */
  amount?: number;
  /** @legacy */ importe?: number;
  /** Frecuencia canónica. Legacy usa `periodicidad`. */
  freq?: 'once' | 'semanal' | 'mensual' | 'bimensual' | 'trimestral' | 'semestral' | 'anual';
  /** @legacy */ periodicidad?: 'mensual' | 'trimestral' | 'anual';
  type?: 'expense' | 'income' | 'payroll' | 'tax' | 'grant' | 'debt' | 'maintenance' | 'fine';
  cat?: string;
  dia_pago?: number;
  unitId?: BusinessUnit;
  activo?: boolean;
  active?: boolean;
  startDate?: string;
  endDate?: string;
  notes?: string;
  file_base64?: string;             // PDF/imagen adjunto (nómina, recibo SS, etc.)
  uploaded_gestoria?: boolean;      // marcada como subida a Bilky/gestoría
  fecha_upload_gestoria?: string;   // fecha en que se marcó como subida
  [key: string]: unknown;
}

// ✅ NUEVO: Activo inmovilizado para amortizaciones
export interface Activo {
  id: string;
  nombre: string;
  importe: number;
  fecha_compra: string;
  vida_util_meses: number;
  activo?: boolean;
}

// ✅ NUEVO: Snapshot de cierre mensual contable
export interface CierreMensualSnapshot {
  ventas: number;
  compras: number;
  fijos: number;
  personal: number;
  suministros: number;
  otrosFijos: number;
  amortizaciones: number;
  resultado: number;
}

// ✅ NUEVO: Cierre mensual contable (P&L congelado)
export interface CierreMensual {
  id: string;
  mes: number;
  anio: number;
  fecha_cierre: string;
  snapshot: CierreMensualSnapshot;
}

export interface Proveedor {
  id: string;
  n: string;
  fam: string;
  tel?: string;
  email?: string;
  contacto?: string;
  direccion?: string;
  iban?: string;
  nif?: string;
  notas?: string;
  active?: boolean;
  unitId?: string;
  currency?: string;   // Divisa por defecto (EUR, JPY, USD, GBP)
  country?: string;    // País del proveedor
}

/** Mapa de pagos: key = "YYYY-MM", value = array de IDs de gastos_fijos pagados ese mes */
export type ControlPago = Record<string, string[]>;

/**
 * Pagos de socios (reparto de beneficios + comisiones B2B)
 * key = "YYYY-MM_<socioId>", value = { importe, fecha, notas }
 */
export interface PagoSocio {
  importe: number;
  fecha: string;   // ISO
  notas?: string;
}
export type PagosSocios = Record<string, PagoSocio>;

/**
 * Cuentas internas familiares — librito privado para saber
 * qué debe cada familiar a la empresa y viceversa.
 * key = "<socioId>_<YYYY-MM-DD>_<N>", value = movimiento
 */
export interface MovimientoInterno {
  id: string;
  socio: string;       // nombre del familiar
  fecha: string;       // ISO
  concepto: string;
  importe: number;     // positivo: la empresa le debe; negativo: él debe a la empresa
  origen: 'albaran' | 'manual' | 'devolucion';
  albaranId?: string;
  saldado: boolean;
  fechaSaldado?: string;
  notas?: string;
}

// ✅ FIX 2: Presupuestos B2B — tipos movidos desde PresupuestosView.tsx
export type EstadoPresupuesto = 'borrador' | 'enviado' | 'aceptado' | 'rechazado' | 'caducado';

export interface LineaPresupuesto {
  id:      string;
  concepto: string;
  qty:     number;
  precio:  number;  // precio unitario sin IVA
  iva:     10 | 21;
}

export interface Presupuesto {
  id:           string;
  num:          string;       // P2025-001
  cliente:      string;
  contacto?:    string;
  email?:       string;
  fecha:        string;       // ISO YYYY-MM-DD
  fechaEvento?: string;
  validezDias:  number;
  estado:       EstadoPresupuesto;
  lineas:       LineaPresupuesto[];
  notas?:       string;
  unidad:       string;       // REST | DLV | CORP
  convertidoId?: string;
  creadoEn:     string;       // ISO
  irpfPct?:     number;       // % retención IRPF (0, 7, 15)
}

// ✅ Modelos fiscales AEAT presentados
export type ModeloAEATId = '303' | '111' | '115' | '390' | '190' | '130' | '131' | '200';

export interface ModeloAEAT {
  id: string;                      // único ej: 'aeat-2026-Q1-303'
  modelo: ModeloAEATId;             // '303', '111', etc.
  periodo: string;                  // '2026-Q1', '2026-01', '2026' (anuales)
  anio: number;
  trimestre?: 1 | 2 | 3 | 4;         // solo para trimestrales
  mes?: number;                     // solo para mensuales
  fecha_vencimiento: string;        // ISO YYYY-MM-DD
  fecha_presentacion?: string;      // ISO — cuando la marcas como presentada
  importe_pagado?: number;          // lo que saliste pagando (o devolución si negativo)
  justificante_base64?: string;     // PDF del justificante de AEAT
  justificante_nombre?: string;     // nombre del archivo original
  nrc?: string;                     // Número de Referencia Completa (código banco AEAT)
  notas?: string;
  presentada: boolean;              // true cuando ya la marcaste presentada
}

export interface AppData {
  config?: AppConfig;
  socios?: Socio[];
  facturas?: FacturaExtended[];
  albaranes?: Albaran[];
  banco?: BankMovement[];
  cierres?: Cierre[];
  cierres_mensuales?: CierreMensual[];    // ✅ P&L congelados
  modelos_aeat?: ModeloAEAT[];            // ✅ Modelos fiscales presentados
  gastos_fijos?: GastoFijo[];
  activos?: Activo[];                     // ✅ Inmovilizado
  ventas_menu?: VentaMenu[];
  platos?: Plato[];
  recetas?: Receta[];
  ingredientes?: Ingrediente[];
  kardex?: KardexEntry[];                 // ✅ Historial de movimientos de stock
  proveedores?: Proveedor[];
  presupuestos?: Presupuesto[];           // ✅ FIX 2: tipado estricto (antes any[])
  control_pagos?: ControlPago;
  pagos_socios?: PagosSocios;            // ✅ reparto beneficios + comisiones B2B
  cuentas_internas?: MovimientoInterno[]; // ✅ librito privado familiar
  priceHistory?: PriceHistoryItem[];
  lastSync?: number;
}
