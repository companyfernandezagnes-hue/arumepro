// ============================================
// Tests para Num (parser numérico) y DateUtil
// — la base de TODOS los cálculos de la app
// ============================================
import { describe, it, expect } from 'vitest';
import { Num, DateUtil } from '../services/engine';

describe('Num.parse — parser numérico robusto', () => {
  // Casos básicos
  it('parsea enteros', () => expect(Num.parse(42)).toBe(42));
  it('parsea strings simples', () => expect(Num.parse('123.45')).toBe(123.45));
  it('parsea null/undefined/vacío como 0', () => {
    expect(Num.parse(null)).toBe(0);
    expect(Num.parse(undefined)).toBe(0);
    expect(Num.parse('')).toBe(0);
  });

  // Formato español (coma decimal)
  it('parsea formato español: 1.234,56', () => expect(Num.parse('1.234,56')).toBe(1234.56));
  it('parsea formato español: 15,90', () => expect(Num.parse('15,90')).toBe(15.90));

  // Formato anglosajón (punto decimal)
  it('parsea formato anglosajón: 1,234.56', () => expect(Num.parse('1,234.56')).toBe(1234.56));

  // Edge cases de albaranes reales
  it('parsea con símbolo € y espacios', () => expect(Num.parse('  € 234,50 ')).toBe(234.50));
  it('parsea negativos con signo -', () => expect(Num.parse('-15,30')).toBe(-15.30));
  it('parsea negativos con paréntesis (15.30)', () => expect(Num.parse('(15.30)')).toBe(-15.30));

  // Caso trampa: 3 decimales después de separador = son miles, no decimales
  it('trata 3 dígitos tras separador como miles: 1.500 → 1500', () => expect(Num.parse('1.500')).toBe(1500));
  it('trata 2 dígitos tras separador como decimales: 1.50 → 1.50', () => expect(Num.parse('1.50')).toBe(1.50));

  // Basura
  it('parsea basura como 0', () => expect(Num.parse('abc')).toBe(0));
});

describe('Num.round2 — redondeo a 2 decimales', () => {
  it('redondea 1.005 correctamente', () => expect(Num.round2(1.005)).toBe(1.01));
  it('no toca 1.50', () => expect(Num.round2(1.50)).toBe(1.50));
  it('redondea 99.999', () => expect(Num.round2(99.999)).toBe(100.00));
});

describe('Num.fmt — formateo a EUR', () => {
  it('formatea 1234.5 como moneda española', () => {
    const formatted = Num.fmt(1234.5);
    // Debe contener 1.234,50 (separador de miles español)
    expect(formatted).toMatch(/1\.234,50/);
  });
  it('formatea 0 sin petar', () => {
    expect(Num.fmt(0)).toMatch(/0,00/);
  });
  it('formatea null como 0', () => {
    expect(Num.fmt(null)).toMatch(/0,00/);
  });
});

describe('DateUtil', () => {
  it('today() devuelve formato YYYY-MM-DD', () => {
    expect(DateUtil.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parse formato español dd/mm/yyyy', () => {
    const d = DateUtil.parse('15/03/2025');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2); // marzo = 2 (0-indexed)
    expect(d.getDate()).toBe(15);
  });

  it('parse formato ISO yyyy-mm-dd', () => {
    const d = DateUtil.parse('2025-03-15');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2);
  });

  it('parse null devuelve fecha válida (hoy)', () => {
    const d = DateUtil.parse(null);
    expect(d).toBeInstanceOf(Date);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it('getMonthBounds genera rango correcto', () => {
    const { start, end } = DateUtil.getMonthBounds(3, 2025); // marzo 2025
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(31);
  });
});
