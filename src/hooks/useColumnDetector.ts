import { useState } from 'react';
import { Num } from '../services/engine';

// 🚀 INNOVACIÓN 1: Estructura de mapeo ampliada (Estilo Zoho Books)
export interface ColumnMapping {
  name: number;
  qty: number;
  price: number;
  total: number;
  date: number; // NUEVO: Detecta cuándo se hizo la venta
  tax: number;  // NUEVO: Detecta el impuesto aplicado
}

export interface ImportProfile {
  id: string;
  name: string; // NUEVO: Preparado para guardar como "Plantilla Glovo", "TPV Madis", etc.
  signature: string; 
  mapping: ColumnMapping;
  lastUsed: string;
}

export function useColumnDetector() {
  const [profiles, setProfiles] = useState<ImportProfile[]>(() => {
    try { return JSON.parse(localStorage.getItem('arume_tpv_profiles') || '[]'); } 
    catch { return []; }
  });

  const getSignature = (rows: any[][]) => {
    if (!rows || rows.length === 0) return '';
    const colCount = rows[0].length;
    // Creamos una huella dactilar única basada en el número de columnas y sus nombres
    const headerStr = rows[0].map(c => String(c || '').trim().toLowerCase()).join('|');
    return `${colCount}-${headerStr}`;
  };

  const analyzeColumns = (rows: any[][]) => {
    const signature = getSignature(rows);
    const existingProfile = profiles.find(p => p.signature === signature);
    
    // MEMORIA INTELIGENTE: Si la estructura es idéntica a una que ya enseñamos, la usamos.
    if (existingProfile) {
      // Actualizamos la fecha de último uso en segundo plano
      existingProfile.lastUsed = new Date().toISOString();
      localStorage.setItem('arume_tpv_profiles', JSON.stringify(profiles));
      return { mapping: existingProfile.mapping, confidence: 100, isKnown: true, profileName: existingProfile.name };
    }

    // 🚀 INNOVACIÓN 2: DETECCIÓN ESTADÍSTICA AVANZADA
    const headers = rows[0] ? rows[0].map(c => String(c || '').trim().toLowerCase()) : [];
    const colCount = headers.length;
    const sample = rows.slice(1, Math.min(rows.length, 50)).filter(r => r.length > 0); // Tomamos hasta 50 filas de muestra
    
    const scores = Array.from({ length: colCount }).map(() => ({ name: 0, qty: 0, price: 0, date: 0, tax: 0 }));

    // Diccionarios de Cabeceras (El "Cheat Code" Semántico)
    const dictName = ['nombre', 'producto', 'artículo', 'articulo', 'concepto', 'descripción', 'item', 'plato', 'desc'];
    const dictQty = ['cant', 'cantidad', 'qty', 'uds', 'unidades', 'vendido', 'volumen'];
    const dictPrice = ['precio', 'importe', 'total', 'subtotal', 'pvp', 'venta', 'bruto', 'neto', 'facturado', 'monto'];
    const dictDate = ['fecha', 'date', 'día', 'dia', 'creado', 'emisión', 'registro', 'hora'];
    const dictTax = ['iva', 'impuesto', 'tax', 'cuota', 'tasa', '%'];

    for (let c = 0; c < colCount; c++) {
      const header = headers[c];
      
      // A. Puntuación por Cabecera (Premio gordo si coincide exactamente)
      if (dictName.some(k => header.includes(k))) scores[c].name += 150;
      if (dictQty.some(k => header.includes(k))) scores[c].qty += 150;
      if (dictPrice.some(k => header.includes(k))) scores[c].price += 150;
      if (dictDate.some(k => header.includes(k))) scores[c].date += 150;
      if (dictTax.some(k => header.includes(k))) scores[c].tax += 150;

      // B. Puntuación por Datos (Reconocimiento de Patrones Visuales)
      sample.forEach(row => {
        const val = String(row[c] || '').trim();
        if (!val) return;
        
        const cleanVal = val.replace(/[€$a-zA-Z\s]/g, '');
        const isNumeric = /^[\d.,\-+]+$/.test(cleanVal) && cleanVal.length > 0;
        const numVal = Num.parse(val);

        // 1. Detectar Fechas (Formatos: DD/MM/YYYY, YYYY-MM-DD, etc.)
        if (/^(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic).*)$/i.test(val)) {
          scores[c].date += 5; 
        }

        // 2. Detectar Porcentajes (Impuestos)
        if (val.includes('%') || (numVal > 0 && numVal <= 21 && (numVal === 4 || numVal === 10 || numVal === 21))) {
          scores[c].tax += 3;
        }

        // 3. Detectar Nombres / Conceptos
        if (!isNumeric && val.length > 3 && !scores[c].date) {
          scores[c].name += 2; 
        } 
        
        // 4. Detectar Cantidades vs Precios
        if (isNumeric) {
          // Si es un número entero pequeño sin decimales, suele ser cantidad
          if (Number.isInteger(numVal) && numVal < 1000 && numVal > 0 && !val.includes(',') && !val.includes('.')) {
            scores[c].qty += 2; 
          }
          // Si tiene decimales o formato de moneda, es un precio
          if (numVal > 0 && (val.includes(',') || val.includes('.') || val.includes('€') || val.includes('$'))) {
            scores[c].price += 2; 
          }
        }
      });
    }

    // 3. SELECCIÓN EXCLUYENTE TIPO "SUDOKU" (Asignación competitiva)
    // Buscamos al ganador para cada categoría, asegurando que nadie robe la columna del otro
    let bestName = -1, bestQty = -1, bestPrice = -1, bestDate = -1, bestTax = -1;

    const findBestCol = (prop: keyof typeof scores[0], exclude: number[]) => {
      let maxScore = 0;
      let bestIdx = -1;
      scores.forEach((s, idx) => {
        if (!exclude.includes(idx) && s[prop] > maxScore) {
          maxScore = s[prop];
          bestIdx = idx;
        }
      });
      return { bestIdx, maxScore };
    };

    // Asignamos por orden de importancia/claridad de los datos
    const dateMatch = findBestCol('date', []);
    if (dateMatch.maxScore > 10) bestDate = dateMatch.bestIdx;

    const nameMatch = findBestCol('name', [bestDate]);
    if (nameMatch.maxScore > 0) bestName = nameMatch.bestIdx;

    const priceMatch = findBestCol('price', [bestDate, bestName]);
    if (priceMatch.maxScore > 0) bestPrice = priceMatch.bestIdx;

    const qtyMatch = findBestCol('qty', [bestDate, bestName, bestPrice]);
    if (qtyMatch.maxScore > 0) bestQty = qtyMatch.bestIdx;

    const taxMatch = findBestCol('tax', [bestDate, bestName, bestPrice, bestQty]);
    if (taxMatch.maxScore > 10) bestTax = taxMatch.bestIdx;

    const mapping: ColumnMapping = { 
      name: bestName, 
      qty: bestQty, 
      price: bestPrice, 
      total: -1, // Se calculará multiplicando qty * price si es necesario
      date: bestDate,
      tax: bestTax
    };
    
    // 4. CÁLCULO DE CONFIANZA (Para decidir si pedir confirmación manual al usuario)
    let confidence = 40;
    if (bestName > -1) confidence += 20; 
    if (bestQty > -1) confidence += 20;  
    if (bestPrice > -1) confidence += 20; 

    return { mapping, confidence: Math.min(confidence, 100), isKnown: false, profileName: 'Nuevo Formato Detectado' };
  };

  const saveProfile = (rows: any[][], mapping: ColumnMapping, customName?: string) => {
    const signature = getSignature(rows);
    if (!profiles.some(p => p.signature === signature)) {
      const newProfile: ImportProfile = { 
        id: Date.now().toString(), 
        name: customName || `Plantilla Auto ${new Date().toLocaleDateString()}`,
        signature, 
        mapping,
        lastUsed: new Date().toISOString()
      };
      const newProfiles = [...profiles, newProfile];
      setProfiles(newProfiles);
      localStorage.setItem('arume_tpv_profiles', JSON.stringify(newProfiles));
    }
  };

  return { analyzeColumns, saveProfile };
}
