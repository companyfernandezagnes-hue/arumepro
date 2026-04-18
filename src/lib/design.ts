// ==========================================================================
// 🎨 Arume Pro — Design System
// Un único sitio donde vive la identidad visual de la app.
// Opción C híbrida: claro para trabajar, oscuro para módulos "vitrina".
// ==========================================================================

/**
 * IDENTIDAD
 * --------------------------------------------------------------------------
 * Arume Sake Bar es gastronomía japonesa premium. La app tiene que transmitir
 * precisión, calma y elegancia. Pero es también una herramienta de trabajo
 * diario — por eso el modo por defecto es claro (productividad) y solo los
 * módulos de "vitrina" (Dashboard, Marketing) usan tonos oscuros/cálidos.
 */

// ── PALETA ──────────────────────────────────────────────────────────────────
// 3 colores base + 4 estados. Punto.
export const colors = {
  // BASE
  ink:    '#0B0B0C',   // negro casi puro — títulos, texto principal
  paper:  '#FAFAF7',   // blanco hueso cálido — fondo claro
  night:  '#131317',   // carbón — fondo oscuro vitrina
  gold:   '#C9A86A',   // dorado Arume — acento premium
  accent: '#8B1E2B',   // rojo japonés sutil — acento secundario

  // ESTADOS (funcionales)
  ok:     '#15803D',   // verde bosque — positivo
  warn:   '#B45309',   // ámbar oscuro — atención
  danger: '#991B1B',   // rojo oscuro — error/urgente
  info:   '#1E40AF',   // azul oscuro — informativo

  // GRISES (1 escala coherente)
  gray: {
    50:  '#F7F7F5',
    100: '#ECECE9',
    200: '#D8D8D3',
    300: '#B8B8B1',
    400: '#8C8C84',
    500: '#656560',
    600: '#474744',
    700: '#2E2E2C',
    800: '#1C1C1B',
    900: '#0E0E0D',
  },
} as const;

// ── TIPOGRAFÍA ──────────────────────────────────────────────────────────────
// Escala simple. 4 tamaños, 3 pesos. No mezclar más.
export const typography = {
  // Tamaños (clases Tailwind correspondientes)
  size: {
    xs:  'text-[11px]',     // meta, etiquetas, timestamps
    sm:  'text-sm',         // cuerpo secundario (14px)
    md:  'text-base',       // cuerpo principal (16px)
    lg:  'text-2xl',        // títulos de sección (24px)
    xl:  'text-4xl',        // números hero, grandes KPIs (36px)
  },
  // Pesos
  weight: {
    regular: 'font-normal',   // 400 — cuerpo
    medium:  'font-semibold', // 600 — énfasis, labels
    bold:    'font-bold',     // 700 — títulos, números importantes
  },
  // Tracking (letter-spacing)
  tracking: {
    tight:  'tracking-tight',
    normal: 'tracking-normal',
    label:  'uppercase tracking-[0.15em]', // labels de tarjeta estilo editorial
  },
} as const;

// ── RADIOS ──────────────────────────────────────────────────────────────────
// 3 tamaños. No hay más.
export const radius = {
  sm: 'rounded-lg',     // botones pequeños, inputs
  md: 'rounded-2xl',    // tarjetas, paneles, modales
  lg: 'rounded-3xl',    // heroes, dashboards destacados
  pill: 'rounded-full', // badges, pills
} as const;

// ── SOMBRAS ─────────────────────────────────────────────────────────────────
export const shadow = {
  none: '',
  sm:   'shadow-sm',                                   // tarjetas normales
  md:   'shadow-[0_4px_16px_rgba(11,11,12,0.06)]',     // tarjetas destacadas
  lg:   'shadow-[0_12px_40px_rgba(11,11,12,0.12)]',    // modales, overlays
} as const;

// ── ESPACIADO ───────────────────────────────────────────────────────────────
// Grid de 4px. Solo estos valores.
export const space = {
  xs: 'gap-1',   // 4px
  sm: 'gap-2',   // 8px
  md: 'gap-4',   // 16px
  lg: 'gap-6',   // 24px
  xl: 'gap-10',  // 40px
} as const;

// ── COMBINACIONES LISTAS PARA USAR ──────────────────────────────────────────
// Atajos para patrones que se repiten. Usa estos en los componentes.
export const ui = {
  /** Tarjeta clara estándar. Fondo blanco, borde gris suave, radio medio. */
  card:       'bg-white border border-[color:var(--arume-gray-100)] rounded-2xl shadow-sm',
  /** Tarjeta oscura para "vitrina" (Dashboard, Marketing). */
  cardDark:   'bg-[color:var(--arume-night)] text-[color:var(--arume-paper)] rounded-2xl shadow-[0_12px_40px_rgba(11,11,12,0.4)]',
  /** Botón primario. Acción principal. */
  btnPrimary: 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[color:var(--arume-ink)] text-[color:var(--arume-paper)] font-semibold text-sm hover:bg-[color:var(--arume-gray-700)] transition-colors active:scale-[0.98]',
  /** Botón secundario. Acción neutra. */
  btnGhost:   'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-transparent border border-[color:var(--arume-gray-200)] text-[color:var(--arume-ink)] font-semibold text-sm hover:bg-[color:var(--arume-gray-50)] transition-colors',
  /** Botón de acento (dorado). Úsese con MESURA, 1 por pantalla. */
  btnGold:    'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[color:var(--arume-gold)] text-[color:var(--arume-ink)] font-bold text-sm hover:brightness-95 transition active:scale-[0.98]',
  /** Label estilo editorial. 11px, uppercase, letter-spacing amplio. */
  label:      'text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--arume-gray-500)]',
  /** Valor hero (KPIs grandes). */
  heroValue:  'text-4xl font-bold tabular-nums tracking-tight text-[color:var(--arume-ink)]',
  /** Pill / badge. */
  pill:       'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
} as const;

// ── CSS VARIABLES ───────────────────────────────────────────────────────────
// Inyectadas en :root (ver index.css). Permite usar los colores en clases
// arbitrarias `bg-[color:var(--arume-ink)]` y mantener coherencia.
export const cssVariables = `
  :root {
    --arume-ink:    ${colors.ink};
    --arume-paper:  ${colors.paper};
    --arume-night:  ${colors.night};
    --arume-gold:   ${colors.gold};
    --arume-accent: ${colors.accent};
    --arume-ok:     ${colors.ok};
    --arume-warn:   ${colors.warn};
    --arume-danger: ${colors.danger};
    --arume-info:   ${colors.info};
    --arume-gray-50:  ${colors.gray[50]};
    --arume-gray-100: ${colors.gray[100]};
    --arume-gray-200: ${colors.gray[200]};
    --arume-gray-300: ${colors.gray[300]};
    --arume-gray-400: ${colors.gray[400]};
    --arume-gray-500: ${colors.gray[500]};
    --arume-gray-600: ${colors.gray[600]};
    --arume-gray-700: ${colors.gray[700]};
    --arume-gray-800: ${colors.gray[800]};
    --arume-gray-900: ${colors.gray[900]};
  }
`;
