// ============================================
// Tests para invoicing.ts — normalización de proveedores + vinculación
// ============================================
import { describe, it, expect, beforeEach } from 'vitest';
import { basicNorm, getOfficialProvName, matchAlbaranesToFactura, recomputeFacturaFromAlbaranes, linkAlbaranesToFactura, unlinkAlbaranFromFactura } from '../services/invoicing';
import { AppData, Albaran, FacturaExtended } from '../types';

// ── NORMALIZACIÓN DE PROVEEDORES ────────────────────────────────────

describe('basicNorm — normalizar nombres de proveedor', () => {
  it('convierte a minúsculas sin tildes', () => {
    expect(basicNorm('Cerdà Obrador')).toBe('cerdaobrador');
  });

  it('elimina sufijos legales (SL, SA, SCP...)', () => {
    expect(basicNorm('Frutas Daniel S.L.')).toBe('frutasdaniel');
    expect(basicNorm('Pescados Galicia S.A.')).toBe('pescadosgalicia');
  });

  it('elimina "distribuciones", "hermanos", etc', () => {
    expect(basicNorm('Distribuciones Cerdà')).toBe('cerda');
    expect(basicNorm('Hnos. García')).toBe('garcia');
  });

  it('null/undefined → "desconocido"', () => {
    expect(basicNorm(null)).toBe('desconocido');
    expect(basicNorm(undefined)).toBe('desconocido');
    expect(basicNorm('')).toBe('desconocido');
  });

  it('string solo con sufijos legales → "desconocido"', () => {
    // "S.L." normalizado queda vacío
    expect(basicNorm('S.L.')).toBe('desconocido');
  });
});

describe('getOfficialProvName', () => {
  it('devuelve el nombre en mayúsculas si no hay alias', () => {
    expect(getOfficialProvName('makro cash')).toBe('MAKRO CASH');
  });

  it('null → DESCONOCIDO', () => {
    expect(getOfficialProvName(null)).toBe('DESCONOCIDO');
  });
});

// ── MATCH ALBARANES ↔ FACTURA ───────────────────────────────────────

describe('matchAlbaranesToFactura', () => {
  const makeAlb = (id: string, prov: string, total: number, date: string, invoiced = false): Albaran => ({
    id, prov, total: String(total), date, num: `ALB-${id}`, socio: 'Arume', unitId: 'REST', items: [], invoiced,
  });

  const makeFac = (total: number, date: string, albaranIdsArr: string[] = []): FacturaExtended => ({
    id: 'fac-1', prov: 'TEST', total: String(total), date, num: 'FAC-1',
    base: '0', tax: '0', albaranIdsArr,
    reconciled: false, source: '',
  } as FacturaExtended);

  it('prioridad 1: match por IDs explícitos', () => {
    const albs = [makeAlb('a1', 'MAKRO', 100, '2025-03-01'), makeAlb('a2', 'MAKRO', 200, '2025-03-02')];
    const fac = makeFac(300, '2025-03-31', ['a1', 'a2']);
    const result = matchAlbaranesToFactura(fac, albs, 'makro');
    expect(result.candidatos.length).toBe(2);
    expect(result.sumaAlbaranes).toBe(300);
    expect(result.cuadraPerfecto).toBe(true);
  });

  it('prioridad 3: búsqueda semántica por proveedor + mes', () => {
    const albs = [
      makeAlb('a1', 'MAKRO', 100, '2025-03-05'),
      makeAlb('a2', 'MAKRO', 200, '2025-03-10'),
      makeAlb('a3', 'FRUTAS', 50, '2025-03-01'),   // otro proveedor
      makeAlb('a4', 'MAKRO', 80, '2025-02-28'),      // otro mes
      makeAlb('a5', 'MAKRO', 150, '2025-03-15', true), // ya facturado
    ];
    const fac = makeFac(300, '2025-03-31');
    const result = matchAlbaranesToFactura(fac, albs, basicNorm('MAKRO'));
    // Solo a1 y a2 deberían ser candidatos (mismo prov, mismo mes, no facturados)
    expect(result.candidatos.length).toBe(2);
    expect(result.candidatos.map(c => c.id).sort()).toEqual(['a1', 'a2']);
  });

  it('cuadra perfecto con tolerancia', () => {
    const albs = [makeAlb('a1', 'X', 100.20, '2025-03-01')];
    const fac = makeFac(100.50, '2025-03-31', ['a1']);
    const result = matchAlbaranesToFactura(fac, albs, 'x');
    // Diferencia 0.30 < tolerancia max(0.50, 100.50*0.005=0.50)
    expect(result.cuadraPerfecto).toBe(true);
  });

  it('no cuadra si diferencia grande', () => {
    const albs = [makeAlb('a1', 'X', 100, '2025-03-01')];
    const fac = makeFac(200, '2025-03-31', ['a1']);
    const result = matchAlbaranesToFactura(fac, albs, 'x');
    expect(result.cuadraPerfecto).toBe(false);
    expect(result.diferencia).toBe(100);
  });

  it('factura nula → resultado vacío', () => {
    const result = matchAlbaranesToFactura(null as any, [], '');
    expect(result.candidatos).toEqual([]);
    expect(result.cuadraPerfecto).toBe(false);
  });
});

// ── VINCULACIÓN ────────────────────────────────────────────────────

describe('linkAlbaranesToFactura + unlinkAlbaranFromFactura', () => {
  const makeData = (): AppData => ({
    albaranes: [
      { id: 'a1', prov: 'MAKRO', total: '100', date: '2025-03-01', num: 'A1', socio: 'Arume', unitId: 'REST', items: [], invoiced: false },
      { id: 'a2', prov: 'MAKRO', total: '200', date: '2025-03-02', num: 'A2', socio: 'Arume', unitId: 'REST', items: [], invoiced: false },
    ],
    facturas: [
      { id: 'f1', prov: 'MAKRO', total: '0', base: '0', tax: '0', date: '2025-03-31', num: 'F1', albaranIdsArr: [], reconciled: false, source: '' },
    ],
    priceHistory: [],
    gastosFijos: [],
    activos: [],
    cierres: [],
  } as unknown as AppData);

  it('link marca albaranes como invoiced y recalcula total', () => {
    const data = makeData();
    linkAlbaranesToFactura(data, 'f1', ['a1', 'a2']);
    expect(data.albaranes[0].invoiced).toBe(true);
    expect(data.albaranes[1].invoiced).toBe(true);
    expect(data.facturas[0].albaranIdsArr).toEqual(['a1', 'a2']);
    expect(Number(data.facturas[0].total)).toBe(300);
  });

  it('unlink desmarca albarán y recalcula', () => {
    const data = makeData();
    linkAlbaranesToFactura(data, 'f1', ['a1', 'a2']);
    unlinkAlbaranFromFactura(data, 'f1', 'a1');
    expect(data.albaranes[0].invoiced).toBe(false);
    expect(data.albaranes[1].invoiced).toBe(true);
    expect(Number(data.facturas[0].total)).toBe(200);
  });

  it('unlink último albarán de factura auto → elimina factura', () => {
    const data = makeData();
    data.facturas[0].source = 'auto-group';
    linkAlbaranesToFactura(data, 'f1', ['a1']);
    unlinkAlbaranFromFactura(data, 'f1', 'a1');
    // Factura auto sin albaranes se elimina
    expect(data.facturas.length).toBe(0);
  });
});
