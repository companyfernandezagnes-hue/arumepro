import { useState } from 'react';
import { Num } from '../services/engine';

export interface ColumnMapping {
  name: number;
  qty: number;
  price: number;
  total: number;
}

export interface ImportProfile {
  id: string;
  signature: string; // Ej: numero de columnas + cabeceras
  mapping: ColumnMapping;
}

export function useColumnDetector() {
  const [profiles, setProfiles] = useState<ImportProfile[]>(() => {
    try { return JSON.parse(localStorage.getItem('arume_tpv_profiles') || '[]'); } 
    catch { return []; }
  });

  const getSignature = (rows: any[][]) => {
    if (!rows || rows.length === 0) return '';
    const colCount = rows[0].length;
    const headerStr = rows[0].map(c => String(c || '').trim().toLowerCase()).join('|');
    return `${colCount}-${headerStr}`;
  };

  const analyzeColumns = (rows: any[][]) => {
    const signature = getSignature(rows);
    const existingProfile = profiles.find(p => p.signature === signature);
    
    // 1. MEMORIA INTELIGENTE: Si ya hemos importado un TPV igual, usamos su perfil
    if (existingProfile) {
      return { mapping: existingProfile.mapping, confidence: 100, isKnown: true };
    }

    // 2. DETECCIÓN ESTADÍSTICA (Si es un TPV nuevo)
    // Cogemos una muestra de las primeras 30 filas (saltando la cabecera)
    const sample = rows.slice(1, 30).filter(r => r.length > 0);
    const colCount = Math.max(...sample.map(r => r.length));
    
    const scores = Array.from({ length: colCount }).map(() => ({ name: 0, qty: 0, price: 0, total: 0 }));

    for (let c = 0; c < colCount; c++) {
      let textCount = 0, intCount = 0, decCount = 0, avgLength = 0;
      
      sample.forEach(row => {
        const val = String(row[c] || '').trim();
        if (!val) return;
        
        avgLength += val.length;
        if (/^[a-zA-ZáéíóúÁÉÍÓÚñÑ ]{4,}$/.test(val)) textCount++; // Tiene pinta de nombre de plato
        else if (/^\d+$/.test(val) && Number(val) < 1000) intCount++; // Tiene pinta de Cantidad (1, 2, 5...)
        else if (/^\d+([.,]\d{1,2})?$/.test(val)) decCount++; // Tiene pinta de Precio/Total (14.50)
      });

      avgLength = sample.length > 0 ? avgLength / sample.length : 0;

      // Asignación de puntos
      scores[c].name = (textCount * 3) + avgLength;
      scores[c].qty = (intCount * 3) - textCount;
      scores[c].price = decCount * 2;
      scores[c].total = decCount * 2; 
    }

    // 3. SELECCIÓN DE LAS MEJORES COLUMNAS
    let bestName = 0, bestQty = 0, bestPrice = 0, bestTotal = 0;
    let maxName = -999, maxQty = -999, maxPrice = -999, maxTotal = -999;

    scores.forEach((s, idx) => {
      if (s.name > maxName) { maxName = s.name; bestName = idx; }
      if (s.qty > maxQty && idx !== bestName) { maxQty = s.qty; bestQty = idx; }
    });

    // Para diferenciar Precio Unitario de Total Línea, evaluamos la coherencia matemática
    scores.forEach((s, idx) => {
      if (idx !== bestName && idx !== bestQty && s.price > 0) {
        // Hacemos validación cruzada: qty * precio ≈ total?
        let isPriceMatch = 0;
        let isTotalMatch = 0;
        sample.forEach(row => {
          const q = Num.parse(row[bestQty]);
          const v = Num.parse(row[idx]);
          if (q > 0 && v > 0 && q * v === v) isPriceMatch++; // Si q*v=v, q=1. Podría ser precio
        });
        if (s.price > maxPrice) { maxPrice = s.price; bestPrice = idx; }
      }
    });

    const mapping: ColumnMapping = { name: bestName, qty: bestQty, price: bestPrice, total: -1 };
    
    // Calculamos confianza (0-100)
    let confidence = 50;
    if (maxName > 10 && maxQty > 5) confidence = 85;

    return { mapping, confidence, isKnown: false };
  };

  const saveProfile = (rows: any[][], mapping: ColumnMapping) => {
    const signature = getSignature(rows);
    if (!profiles.some(p => p.signature === signature)) {
      const newProfiles = [...profiles, { id: Date.now().toString(), signature, mapping }];
      setProfiles(newProfiles);
      localStorage.setItem('arume_tpv_profiles', JSON.stringify(newProfiles));
    }
  };

  return { analyzeColumns, saveProfile };
}
