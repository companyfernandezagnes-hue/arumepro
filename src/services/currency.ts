// ==========================================
// 💱 currency.ts — Servicio de Multi-Divisa
// ==========================================

export type CurrencyCode = 'EUR' | 'JPY' | 'USD' | 'GBP' | 'CHF' | 'CNY' | 'KRW';

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  symbol: string;
  flag: string;
  decimals: number;         // JPY y KRW no usan decimales
  country: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'EUR', name: 'Euro',                  symbol: '€', flag: '🇪🇺', decimals: 2, country: 'Europa' },
  { code: 'JPY', name: 'Yen japonés',           symbol: '¥', flag: '🇯🇵', decimals: 0, country: 'Japón' },
  { code: 'USD', name: 'Dólar estadounidense',  symbol: '$', flag: '🇺🇸', decimals: 2, country: 'EE.UU.' },
  { code: 'GBP', name: 'Libra esterlina',       symbol: '£', flag: '🇬🇧', decimals: 2, country: 'Reino Unido' },
  { code: 'CHF', name: 'Franco suizo',          symbol: 'Fr', flag: '🇨🇭', decimals: 2, country: 'Suiza' },
  { code: 'CNY', name: 'Yuan chino',            symbol: '¥', flag: '🇨🇳', decimals: 2, country: 'China' },
  { code: 'KRW', name: 'Won surcoreano',        symbol: '₩', flag: '🇰🇷', decimals: 0, country: 'Corea del Sur' },
];

export const getCurrencyInfo = (code: string): CurrencyInfo =>
  CURRENCIES.find(c => c.code === code) || CURRENCIES[0];

// ── Tasas de cambio por defecto (referencia BCE, actualizables) ──────────
// Estas son tasas orientativas. Se pueden actualizar manualmente o vía API.
const DEFAULT_RATES: Record<string, number> = {
  'EUR': 1,
  'JPY': 162.5,    // 1 EUR = ~162.5 JPY (abril 2026 aprox)
  'USD': 1.08,     // 1 EUR = ~1.08 USD
  'GBP': 0.86,     // 1 EUR = ~0.86 GBP
  'CHF': 0.97,     // 1 EUR = ~0.97 CHF
  'CNY': 7.85,     // 1 EUR = ~7.85 CNY
  'KRW': 1480,     // 1 EUR = ~1480 KRW
};

export interface ExchangeRates {
  base: 'EUR';
  date: string;
  rates: Record<string, number>;
}

// ── Clase principal ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'arume_exchange_rates';

export class CurrencyService {

  /** Obtener tasas guardadas o las por defecto */
  static getRates(): ExchangeRates {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed as ExchangeRates;
      }
    } catch { /* ignore */ }
    return { base: 'EUR', date: new Date().toISOString().split('T')[0], rates: { ...DEFAULT_RATES } };
  }

  /** Guardar tasas actualizadas */
  static saveRates(rates: ExchangeRates): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
  }

  /** Actualizar tasas desde la API pública de frankfurter.app (BCE) */
  static async fetchLatestRates(): Promise<ExchangeRates> {
    try {
      const symbols = Object.keys(DEFAULT_RATES).filter(c => c !== 'EUR').join(',');
      const res = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=${symbols}`);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const rates: Record<string, number> = { EUR: 1 };
      Object.entries(data.rates || {}).forEach(([k, v]) => { rates[k] = v as number; });
      const result: ExchangeRates = { base: 'EUR', date: data.date || new Date().toISOString().split('T')[0], rates };
      CurrencyService.saveRates(result);
      return result;
    } catch {
      // Si falla la API, devolver las guardadas/default
      return CurrencyService.getRates();
    }
  }

  /** Convertir un importe de una divisa a EUR */
  static toEUR(amount: number, fromCurrency: string, rates?: ExchangeRates): number {
    if (fromCurrency === 'EUR') return amount;
    const r = (rates || CurrencyService.getRates()).rates;
    const rate = r[fromCurrency];
    if (!rate || rate === 0) return amount;
    return Math.round((amount / rate) * 100) / 100;
  }

  /** Convertir de EUR a otra divisa */
  static fromEUR(amountEUR: number, toCurrency: string, rates?: ExchangeRates): number {
    if (toCurrency === 'EUR') return amountEUR;
    const r = (rates || CurrencyService.getRates()).rates;
    const rate = r[toCurrency];
    if (!rate) return amountEUR;
    const info = getCurrencyInfo(toCurrency);
    const factor = Math.pow(10, info.decimals);
    return Math.round(amountEUR * rate * factor) / factor;
  }

  /** Convertir entre dos divisas cualesquiera */
  static convert(amount: number, from: string, to: string, rates?: ExchangeRates): number {
    if (from === to) return amount;
    const eur = CurrencyService.toEUR(amount, from, rates);
    return CurrencyService.fromEUR(eur, to, rates);
  }

  /** Obtener tipo de cambio directo entre dos divisas */
  static getRate(from: string, to: string, rates?: ExchangeRates): number {
    if (from === to) return 1;
    const r = (rates || CurrencyService.getRates()).rates;
    const fromRate = r[from] || 1;
    const toRate = r[to] || 1;
    return toRate / fromRate;
  }

  /** Formatear un importe con su símbolo de divisa */
  static format(amount: number, currencyCode: string): string {
    const info = getCurrencyInfo(currencyCode);
    const formatted = amount.toLocaleString('es-ES', {
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    });
    return `${formatted} ${info.symbol}`;
  }
}
