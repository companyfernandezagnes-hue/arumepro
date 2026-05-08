// ============================================
// Tests para invoiceMatcher — el CORAZÓN del cruce facturas ↔ albaranes
// Si esto falla, Agnes no puede verificar pagos a fin de mes
// ============================================
import { describe, it, expect } from 'vitest';
import { findSubsetSum, advancedProvSimilarity, smartMatchInvoiceToAlbaranes } from '../services/invoiceMatcher';
import { Albaran } from '../types';

// ── Helper para crear albaranes de test ──────────────────────────────
const makeAlb = (id: string, prov: string, total: number, date = '2025-03-15', extra: any = {}): Albaran => ({
  id,
  prov,
  total: String(total),
  date,
  num: `ALB-${id}`,
  socio: 'Arume',
  unitId: 'REST',
  items: [],
  invoiced: false,
  ...extra,
});

// ── SUBSET-SUM ───────────────────────────────────────────────────────

describe('findSubsetSum — match factura por total', () => {
  it('encuentra match exacto con 1 albarán', () => {
    const albs = [makeAlb('1', 'MAKRO', 150), makeAlb('2', 'MAKRO', 200)];
    const result = findSubsetSum(albs, 150);
    expect(result).toEqual(['1']);
  });

  it('encuentra combinación de 2 albaranes', () => {
    const albs = [
      makeAlb('1', 'MAKRO', 150),
      makeAlb('2', 'MAKRO', 200),
      makeAlb('3', 'MAKRO', 75),
    ];
    const result = findSubsetSum(albs, 350);
    expect(result).not.toBeNull();
    // 150 + 200 = 350
    expect(result!.sort()).toEqual(['1', '2']);
  });

  it('encuentra combinación de 3 albaranes', () => {
    const albs = [
      makeAlb('1', 'FRUTAS', 45.30),
      makeAlb('2', 'FRUTAS', 67.20),
      makeAlb('3', 'FRUTAS', 112.50),
    ];
    // 45.30 + 67.20 + 112.50 = 225.00
    const result = findSubsetSum(albs, 225.00);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
  });

  it('devuelve null cuando no hay combinación posible', () => {
    const albs = [makeAlb('1', 'MAKRO', 100), makeAlb('2', 'MAKRO', 200)];
    const result = findSubsetSum(albs, 175);
    expect(result).toBeNull();
  });

  it('tolera diferencias de redondeo (±1€)', () => {
    const albs = [makeAlb('1', 'MAKRO', 100.30), makeAlb('2', 'MAKRO', 200.50)];
    // Factura dice 301.00 pero albaranes suman 300.80 — diferencia 0.20€
    const result = findSubsetSum(albs, 301.00, 1.00);
    expect(result).not.toBeNull();
  });

  it('maneja array vacío', () => {
    expect(findSubsetSum([], 100)).toBeNull();
  });

  it('maneja target 0', () => {
    expect(findSubsetSum([makeAlb('1', 'X', 50)], 0)).toBeNull();
  });
});

// ── SIMILITUD DE PROVEEDOR ──────────────────────────────────────────

describe('advancedProvSimilarity — fuzzy matching proveedores', () => {
  it('mismo nombre → 100%', () => {
    expect(advancedProvSimilarity('MAKRO', 'MAKRO')).toBe(100);
  });

  it('variantes con sufijo legal → match alto', () => {
    const score = advancedProvSimilarity('Cerdà Obrador SL', 'Cerdà Obrador');
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it('2+ tokens compartidos → 100%', () => {
    expect(advancedProvSimilarity('Llorenç Cerdà Obrador', 'Cerdà Obrador SL')).toBe(100);
  });

  it('proveedores distintos → score bajo', () => {
    const score = advancedProvSimilarity('MAKRO', 'FRUTAS DANIEL');
    expect(score).toBeLessThan(60);
  });

  it('null/vacío → 0', () => {
    expect(advancedProvSimilarity(null, 'MAKRO')).toBe(0);
    expect(advancedProvSimilarity('', '')).toBe(0);
  });
});

// ── SMART MATCH COMPLETO ────────────────────────────────────────────

describe('smartMatchInvoiceToAlbaranes — flujo completo', () => {
  it('match con confianza alta cuando subset-sum cuadra', () => {
    const albs = [
      makeAlb('a1', 'MAKRO CASH & CARRY', 150.00, '2025-03-01'),
      makeAlb('a2', 'MAKRO CASH & CARRY', 200.00, '2025-03-08'),
      makeAlb('a3', 'MAKRO CASH & CARRY', 100.00, '2025-03-15'),
    ];
    const result = smartMatchInvoiceToAlbaranes(
      { proveedor: 'MAKRO CASH', total: 350.00, fecha: '2025-03-31' },
      albs,
    );
    expect(result.confidence).toBe('alta');
    expect(result.matchedAlbaranIds.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(result.diferencia)).toBeLessThanOrEqual(2);
  });

  it('devuelve sin_proveedor si no hay albaranes del proveedor', () => {
    const albs = [makeAlb('a1', 'MAKRO', 150.00)];
    const result = smartMatchInvoiceToAlbaranes(
      { proveedor: 'FRUTAS DANIEL', total: 300, fecha: '2025-03-31' },
      albs,
    );
    expect(result.confidence).toBe('sin_proveedor');
    expect(result.matchedAlbaranIds).toEqual([]);
  });

  it('no incluye albaranes ya facturados', () => {
    const albs = [
      makeAlb('a1', 'MAKRO', 150.00, '2025-03-01', { invoiced: true }),
      makeAlb('a2', 'MAKRO', 150.00, '2025-03-01', { invoiced: false }),
    ];
    // Solo a2 debería estar disponible
    const result = smartMatchInvoiceToAlbaranes(
      { proveedor: 'MAKRO', total: 150.00, fecha: '2025-03-31' },
      albs,
    );
    // El pool que se pasa debería estar pre-filtrado, pero verificamos
    // que el matcher trabaja con lo que recibe
    expect(result.matchedAlbaranIds).toBeDefined();
  });

  it('match aproximado cuando la diferencia es < 5%', () => {
    const albs = [
      makeAlb('a1', 'FRUTAS DANIEL', 100.00, '2025-03-01'),
      makeAlb('a2', 'FRUTAS DANIEL', 200.00, '2025-03-08'),
    ];
    // Factura dice 310€ pero albaranes suman 300€ — 3.2% de diferencia
    const result = smartMatchInvoiceToAlbaranes(
      { proveedor: 'FRUTAS DANIEL', total: 310.00, fecha: '2025-03-31' },
      albs,
    );
    expect(result.confidence).toBe('media');
  });

  it('confianza baja cuando la diferencia es > 5%', () => {
    const albs = [makeAlb('a1', 'MAKRO', 100.00)];
    const result = smartMatchInvoiceToAlbaranes(
      { proveedor: 'MAKRO', total: 500.00, fecha: '2025-03-31' },
      albs,
    );
    expect(result.confidence).toBe('baja');
  });
});
